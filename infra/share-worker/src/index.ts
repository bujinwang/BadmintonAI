/**
 * Share worker — the only server in the Plan-B architecture.
 *
 * It does exactly three things and nothing else:
 *   1. hands out short-lived presigned PUTs, so bytes travel phone -> R2 directly
 *      (proxying uploads through a Worker would burn its CPU and buy nothing)
 *   2. mints and revokes share tokens — a share link is a token, never a bucket URL
 *   3. serves the viewer shell, and 302s its asset requests to presigned GETs
 *
 * No transcoding, no queue, no video in flight through this process.
 *
 * NOT YET DEPLOYED OR EXERCISED. Secrets below must exist before `wrangler deploy`.
 */

import { AwsClient } from "aws4fetch";

export interface Env {
  DB: D1Database;
  /** Used for head() only — never put()/get() of media, which would proxy bytes. */
  BUCKET: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  SHARE_SECRET: string;
  /** TODO: replace with Sign in with Apple → user id. See requireOwner(). */
  DEVICE_SECRET: string;
}

const MEDIA_TTL = 6 * 3600;   // seconds a presigned GET stays valid
const UPLOAD_TTL = 15 * 60;   // keep upload windows short: they are bearer tokens too

/** Objects above this need multipart (each part is a Class A op, so cut 50-100 MiB). */
const SINGLE_PUT_LIMIT = 200 * 1024 * 1024;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

const bad = (msg: string, s = 400) => json({ error: msg }, s);

const now = () => Math.floor(Date.now() / 1000);

const keyFor = (sessionId: string, name: string) => `m/${sessionId}/${name}`;

/** Upload names are a closed set — a share cannot smuggle arbitrary keys into the bucket. */
const ASSET_NAMES = ["manifest.json", "events.json", "poster.jpg", "highlights.mp4"] as const;

async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish compare; both sides are hex digests of equal length. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Owner identity. A v1 stub: the app presents an HMAC of its device id, minted at
 * first launch. Swap for a Sign in with Apple identity token before shipping — a
 * device-scoped secret cannot survive a reinstall and cannot be revoked centrally.
 */
async function requireOwner(req: Request, env: Env): Promise<string | null> {
  // An empty secret would make HMAC throw deep inside the handler; say what is
  // actually wrong instead (`.dev.vars` missing is the usual cause in dev).
  if (!env.DEVICE_SECRET) throw new Error("DEVICE_SECRET is not set");
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(auth);
  if (!m) return null;
  const [deviceId, sig] = m[1].split(".");
  if (!deviceId || !sig) return null;
  return safeEqual(await hmac(env.DEVICE_SECRET, deviceId), sig) ? deviceId : null;
}

async function presign(env: Env, key: string, method: "PUT" | "GET", ttl: number): Promise<string> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`);
  const signed = await client.sign(url.toString(), {
    method,
    headers: {
      // R2 does not need the body hashed for presigned PUTs; signing it would
      // force the client to compute a SHA-256 of a 100 MB file it is streaming.
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-expires": String(ttl),
    },
    aws: { signQuery: true },
  });
  return signed.url;
}

async function newSession(req: Request, env: Env, owner: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { matchId?: string; assets?: { name: string; bytes: number }[] }
    | null;
  if (!body?.matchId || !Array.isArray(body.assets) || !body.assets.length) {
    return bad("matchId and assets[] are required");
  }
  for (const a of body.assets) {
    if (!ASSET_NAMES.includes(a.name as (typeof ASSET_NAMES)[number])) return bad(`unknown asset ${a.name}`);
    if (a.name === "highlights.mp4" && a.bytes > SINGLE_PUT_LIMIT) {
      return bad("highlight exceeds the single-PUT limit; multipart is not wired up yet", 501);
    }
  }

  const id = crypto.randomUUID();
  const stmts = [
    env.DB.prepare(
      "INSERT INTO sessions (id, owner, match_id, status, created_at) VALUES (?,?,?,'draft',?)",
    ).bind(id, owner, body.matchId, now()),
    // bytes starts at 0 and is only set by /confirm, from what R2 actually has.
    // Taking the client's declared size here would make the publish gate a no-op.
    ...body.assets.map((a) =>
      env.DB.prepare("INSERT INTO assets (session_id, name, key, bytes) VALUES (?,?,?,0)").bind(
        id, a.name, keyFor(id, a.name),
      ),
    ),
  ];
  await env.DB.batch(stmts);

  const uploads = await Promise.all(
    body.assets.map(async (a) => ({
      name: a.name,
      url: await presign(env, keyFor(id, a.name), "PUT", UPLOAD_TTL),
      method: "PUT" as const,
    })),
  );
  return json({ sessionId: id, uploads, expiresIn: UPLOAD_TTL });
}

/**
 * Ask R2 what it actually received. HEAD is metadata only — no bytes move, which
 * is why the binding is acceptable here and unacceptable for uploads/downloads.
 */
async function confirm(req: Request, env: Env, owner: string, sessionId: string): Promise<Response> {
  const s = await env.DB.prepare("SELECT owner FROM sessions WHERE id = ?")
    .bind(sessionId).first<{ owner: string }>();
  if (!s) return bad("no such session", 404);
  if (s.owner !== owner) return bad("not yours", 403);

  const rows = await env.DB.prepare("SELECT name, key FROM assets WHERE session_id = ?")
    .bind(sessionId).all<{ name: string; key: string }>();
  const report: Record<string, number | null> = {};
  for (const r of rows.results ?? []) {
    const head = await env.BUCKET.head(r.key);
    report[r.name] = head?.size ?? null;
    if (head) {
      await env.DB.prepare("UPDATE assets SET bytes = ? WHERE session_id = ? AND name = ?")
        .bind(head.size, sessionId, r.name).run();
    }
  }
  const ok = ["manifest.json", "events.json", "highlights.mp4"].every((n) => report[n]);
  return json({ ok, received: report }, ok ? 200 : 409);
}

async function publish(req: Request, env: Env, owner: string, sessionId: string): Promise<Response> {
  const s = await env.DB.prepare("SELECT id, owner, status FROM sessions WHERE id = ?")
    .bind(sessionId).first<{ id: string; owner: string; status: string }>();
  if (!s) return bad("no such session", 404);
  if (s.owner !== owner) return bad("not yours", 403);

  // Refuse to publish a half-uploaded bundle: the viewer trusts the manifest.
  const missing = await env.DB.prepare(
    "SELECT name FROM assets WHERE session_id = ? AND bytes > 0",
  ).bind(sessionId).all<{ name: string }>();
  const have = new Set((missing.results ?? []).map((r) => r.name));
  for (const n of ["manifest.json", "events.json", "highlights.mp4"]) {
    if (!have.has(n)) return bad(`bundle incomplete: ${n} missing`, 409);
  }

  const token = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.batch([
    env.DB.prepare("UPDATE sessions SET status='published', published_at=? WHERE id=?")
      .bind(now(), sessionId),
    env.DB.prepare("INSERT INTO shares (token, session_id, created_at) VALUES (?,?,?)")
      .bind(token, sessionId, now()),
  ]);
  return json({ token, path: `/s/${token}` });
}

async function revoke(req: Request, env: Env, owner: string, sessionId: string): Promise<Response> {
  const s = await env.DB.prepare("SELECT owner FROM sessions WHERE id = ?")
    .bind(sessionId).first<{ owner: string }>();
  if (!s) return bad("no such session", 404);
  if (s.owner !== owner) return bad("not yours", 403);
  // Revoking the token is enough: media URLs can only be obtained through it.
  await env.DB.prepare("UPDATE shares SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL")
    .bind(now(), sessionId).run();
  return json({ ok: true });
}

async function shareLookup(env: Env, token: string) {
  return env.DB.prepare(
    `SELECT s.id, s.match_id, sh.token FROM shares sh
       JOIN sessions s ON s.id = sh.session_id
      WHERE sh.token = ? AND sh.revoked_at IS NULL AND s.status = 'published'`,
  ).bind(token).first<{ id: string; match_id: string; token: string }>();
}

const SHELL = (matchId: string, token: string) => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${matchId}</title>
<meta property="og:image" content="/s/${token}/a/poster.jpg">
<style>
 :root{--bg:#0f1115;--fg:#e9edf2;--mut:#8b94a3;--line:#242a34}
 body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,system-ui,sans-serif}
 main{max-width:960px;margin:0 auto;padding:24px}
 h1{font-size:18px;font-weight:500;margin:0 0 4px}
 .mut{color:var(--mut);font-size:13px}
 video{width:100%;border-radius:12px;background:#000;margin:16px 0}
 .row{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}
 .card{flex:1 1 120px;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
 .card b{display:block;font-size:20px;font-weight:500}
 ol{padding-left:0;list-style:none;max-height:320px;overflow:auto;margin:0}
 li{padding:7px 10px;border-bottom:1px solid var(--line);cursor:pointer;font-size:13px}
 li:hover{background:#171b22}
</style></head>
<body><main>
 <h1 id="title">…</h1><div class="mut" id="sub"></div>
 <video id="v" controls playsinline preload="metadata" src="/s/${token}/a/highlights.mp4"></video>
 <div class="row" id="stats"></div>
 <div class="mut" style="margin:16px 0 6px">回合 · 点击跳转</div>
 <ol id="rallies"></ol>
</main>
<script>
const v = document.getElementById('v');
fetch('/s/${token}/a/manifest.json').then(r => r.json()).then(m => {
  document.title = (m.meta.teams?.A || '') + ' vs ' + (m.meta.teams?.B || '');
  document.getElementById('title').textContent = document.title;
  document.getElementById('sub').textContent =
    [m.meta.tournament, m.meta.round].filter(Boolean).join(' · ');
  const t = m.summary || {};
  document.getElementById('stats').innerHTML = [
    ['回合', t.rallies], ['有效时间', t.rallySecs ? Math.round(t.rallySecs/60) + ' 分' : null],
    ['盘数', t.sets]
  ].filter(([, x]) => x != null).map(([k, x]) => '<div class="card"><b>' + x + '</b>' + k + '</div>').join('');
  document.getElementById('rallies').innerHTML = (m.chapters || []).map(c =>
    '<li data-at="' + c.at + '">第 ' + (c.rally ?? '—') + ' 回合 · ' + c.dur.toFixed(1) + 's</li>').join('');
  document.querySelectorAll('#rallies li').forEach(li => li.onclick = () => {
    v.currentTime = parseFloat(li.dataset.at) + 0.05; v.play();
  });
});
</script></body></html>`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/api/sessions" && req.method === "POST") {
      const owner = await requireOwner(req, env);
      if (!owner) return bad("unauthorized", 401);
      return newSession(req, env, owner);
    }

    let m = /^\/api\/sessions\/([\w-]+)\/confirm$/.exec(p);
    if (m && req.method === "POST") {
      const owner = await requireOwner(req, env);
      if (!owner) return bad("unauthorized", 401);
      return confirm(req, env, owner, m[1]);
    }

    m = /^\/api\/sessions\/([\w-]+)\/publish$/.exec(p);
    if (m && req.method === "POST") {
      const owner = await requireOwner(req, env);
      if (!owner) return bad("unauthorized", 401);
      return publish(req, env, owner, m[1]);
    }

    m = /^\/api\/sessions\/([\w-]+)\/revoke$/.exec(p);
    if (m && req.method === "POST") {
      const owner = await requireOwner(req, env);
      if (!owner) return bad("unauthorized", 401);
      return revoke(req, env, owner, m[1]);
    }

    // Viewer: the token is the only credential a recipient ever holds.
    m = /^\/s\/([0-9a-f]{32})$/.exec(p);
    if (m) {
      const row = await shareLookup(env, m[1]);
      if (!row) return new Response("链接已失效", { status: 404 });
      return new Response(SHELL(row.match_id, row.token), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    m = /^\/s\/([0-9a-f]{32})\/a\/([\w.]+)$/.exec(p);
    if (m) {
      const row = await shareLookup(env, m[1]);
      if (!row) return new Response("链接已失效", { status: 404 });
      if (!ASSET_NAMES.includes(m[2] as (typeof ASSET_NAMES)[number])) return bad("no such asset", 404);
      // 302 rather than streaming: the browser talks to R2 directly, so this
      // worker never carries video bytes and never becomes the bottleneck.
      return Response.redirect(await presign(env, keyFor(row.id, m[2]), "GET", MEDIA_TTL), 302);
    }

    return bad("not found", 404);
  },
};
