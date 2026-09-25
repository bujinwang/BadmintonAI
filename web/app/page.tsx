import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { IndexData } from "@/lib/types";
import type { DoublesIndex } from "@/lib/doubles";
import ThemeToggle from "@/components/ThemeToggle";
import { AUTHOR, CHAIN, LINKS } from "@/lib/site";

function readIndex(): IndexData {
  const p = path.join(process.cwd(), "public", "data", "index.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function readDoublesIndex(): DoublesIndex {
  const p = path.join(process.cwd(), "public", "data", "doubles_index.json");
  if (!fs.existsSync(p)) return { matches: [] };
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

export default function Home() {
  const idx = readIndex();
  const dbl = readDoublesIndex();
  return (
    <main className="max-w-6xl mx-auto px-6 py-10 w-full">
      <nav className="flex items-center gap-4 mb-12">
        <span className="disp font-bold text-[1.25rem] tracking-tight">
          COURT<span style={{ color: "var(--ai)" }}>SIDE</span>
        </span>
        <Link
          href="/how/"
          className="text-mut hover:text-ink transition-colors text-[13px]"
        >
          How it works
        </Link>
        <a
          href={LINKS.repo}
          target="_blank"
          rel="noopener noreferrer"
          className="text-mut hover:text-ink transition-colors text-[13px]"
        >
          Source ↗
        </a>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>

      {/* ── hero ── */}
      <header className="rise grid lg:grid-cols-[1.05fr_1fr] gap-x-12 gap-y-8 items-center mb-16">
        <div>
          <div className="kicker mb-3">BADMINTON MATCH INTELLIGENCE</div>
          <h1 className="text-[clamp(2.8rem,7vw,4.6rem)] font-bold leading-[0.94] tracking-tight">
            COURT<span style={{ color: "var(--ai)" }}>SIDE</span>
          </h1>
          <p className="text-mut max-w-xl mt-5 text-[15.5px] leading-relaxed">
            A scouting report from broadcast video. Computer vision tracks both
            players and the shuttle, detects contacts, classifies shots, and reads the
            scoreboard — then writes the coach&apos;s notes. Flip any match to{" "}
            <span style={{ color: "var(--ai)" }} className="font-semibold">
              AI VISION
            </span>{" "}
            to explore machine-derived match data and its measured accuracy.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-7">
            <a
              href="#matches"
              className="px-4 py-2 rounded-md text-[13.5px] font-medium transition-opacity hover:opacity-85"
              style={{ background: "var(--ink)", color: "var(--bg)" }}
            >
              Browse the matches
            </a>
            <Link
              href="/how/"
              className="px-4 py-2 rounded-md text-[13.5px] border border-[var(--line)] text-mut hover:text-ink hover:border-[var(--mut)] transition-colors"
            >
              How it works →
            </Link>
            <Link href="/players/" className="text-[13.5px] text-mut hover:text-ink underline underline-offset-4">Player profiles →</Link>
          </div>
          <div className="mt-7 text-[13px] text-dim">
            Built by <span className="text-mut">{AUTHOR}</span> ·{" "}
            <a
              href={LINKS.site}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink transition-colors"
            >
              jaydenclim.com ↗
            </a>
          </div>
        </div>

        <figure className="rise rise-2 min-w-0">
          <div className="card overflow-hidden p-0">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              className="w-full block"
              src="/hero.mp4"
              poster="/hero.jpg"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="Annotated badminton broadcast showing machine-drawn pose skeletons, tracked shuttle, shot calls and a reprojected 2D court"
            />
          </div>
          <figcaption className="text-dim text-[11.5px] leading-snug mt-2.5">
            Live output, not a mockup: pose skeletons, the tracked shuttle, a shot call with
            model confidence at each contact, the machine-read score, and the reprojected 2D
            court — every element inferred from these pixels.
          </figcaption>
        </figure>
      </header>

      {/* ── the chain ── */}
      <section className="mb-16">
        <Link href="/how/" className="group block">
          <div className="flex items-baseline gap-3 flex-wrap mb-1">
            <h2 className="text-[1.5rem] font-semibold tracking-tight">The label-free chain</h2>
            <span className="text-dim text-[13px] group-hover:text-mut transition-colors">
              read the full write-up →
            </span>
          </div>
          <p className="text-mut text-[14px] max-w-2xl mb-6 leading-relaxed">
            Six models between a broadcast feed and a scouting report. Human annotations are used
            only to grade them — never to run them.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {CHAIN.map((s, i) => (
              <div
                key={s.n}
                className={`card p-4 rise rise-${Math.min(i + 1, 5)} group-hover:border-[var(--line)] transition-colors`}
              >
                <div className="mono text-[9.5px] text-dim tracking-[0.18em] mb-1.5">
                  {s.n} ▸ {s.name.toUpperCase()}
                </div>
                <div className="bignum text-[1.7rem]" style={{ color: "var(--ai)" }}>
                  {s.metric}
                </div>
                <div className="text-[11.5px] text-mut mt-1.5 leading-snug">{s.of}</div>
                <div className="text-[11px] text-dim mt-2 leading-snug border-t border-[var(--line-soft)] pt-2">
                  {s.vs}
                </div>
              </div>
            ))}
          </div>
        </Link>
      </section>

      {/* ── matches ── */}
      <section id="matches" className="scroll-mt-8">
        <h2 className="text-[1.5rem] font-semibold tracking-tight mb-1">Singles</h2>
        <p className="text-mut text-[14px] max-w-2xl mb-6 leading-relaxed">
          Each match carries both readings: the human-annotated{" "}
          <span className="text-ink">ground truth</span> and the pipeline&apos;s own{" "}
          <span style={{ color: "var(--ai)" }} className="font-semibold">
            AI VISION
          </span>
          . Toggling between them inside a match is the honest measure of what the CV gets right.
        </p>
        <div className="grid md:grid-cols-2 gap-5">
          {idx.matches.map((m, i) => (
            <Link
              key={m.id}
              href={`/m/${m.id}/${m.sources.includes("labels") ? "labels" : "ai"}/overview/`}
              className={`card rise rise-${Math.min(i + 2, 5)} p-6 hover:border-[var(--mut)] transition-colors group block`}
            >
              <div className="kicker mb-3">
                {m.tournament} · {m.round}
              </div>
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <div className="disp text-[1.7rem] font-semibold leading-tight">
                    <span style={{ color: "var(--pa)" }}>{m.players.A}</span>
                    <span className="text-dim text-[1.1rem] mx-2">def.</span>
                    <span style={{ color: "var(--pb)" }}>{m.players.B}</span>
                  </div>
                  <div className="mono text-mut text-[13px] mt-2">
                    {m.sets.map((s) => s.join("–")).join("  ·  ")}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="bignum text-[2.4rem] text-ink/90">{m.rallies}</div>
                  <div className="kicker">RALLIES</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-5">
                {m.sources.includes("labels") && (
                  <span className="mono text-[10px] tracking-[0.15em] px-1.5 py-0.5 rounded border border-[var(--line)] text-mut">
                    GROUND TRUTH
                  </span>
                )}
                {m.sources.includes("ai") && (
                  <span className="mono text-[10px] tracking-[0.15em] px-1.5 py-0.5 rounded border border-[var(--ai)]/40 text-[var(--ai)] bg-[var(--ai-soft)]">
                    AI VISION
                  </span>
                )}
                <span className="ml-auto text-dim text-[12px] group-hover:text-mut transition-colors">
                  open match →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {dbl.matches.length > 0 && (
        <section className="mt-14">
          <div className="flex items-baseline gap-3 mb-1">
            <h2 className="text-[1.5rem] font-semibold tracking-tight">Doubles</h2>
            <span className="mono text-[10px] tracking-[0.16em] px-1.5 py-0.5 rounded border border-[var(--line)] text-dim">
              EXPERIMENTAL
            </span>
          </div>
          <p className="text-mut text-[14px] max-w-2xl mb-6 leading-relaxed">
            Four players in identical kit, frequently occluded — so this branch tracks{" "}
            <span style={{ color: "var(--ai)" }} className="font-semibold">
              roles
            </span>{" "}
            rather than names: front and back, attacking versus defending formation, and net
            coverage, held together across three sets and the end-swaps between them.
          </p>
          <div className="grid md:grid-cols-2 gap-5">
            {dbl.matches.map((m, i) => (
              <Link
                key={m.id}
                href={`/d/${m.id}/overview/`}
                className={`card rise rise-${Math.min(i + 2, 5)} p-6 hover:border-[var(--mut)] transition-colors group block`}
              >
                <div className="kicker mb-3">
                  {m.tournament} · {m.round}
                </div>
                <div className="flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <div className="disp text-[1.35rem] font-semibold leading-tight">
                      <span style={{ color: "var(--pa)" }}>{m.pairs.near}</span>
                      <span className="text-dim text-[1rem] mx-2">vs</span>
                      <span style={{ color: "var(--pb)" }}>{m.pairs.far}</span>
                    </div>
                    {m.result && (
                      <div className="mono text-mut text-[13px] mt-2">
                        {m.result.replace(/\s+/g, "  ·  ")}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="bignum text-[2.4rem] text-ink/90">{m.rallies}</div>
                    <div className="kicker">RALLIES</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-5">
                  <span className="mono text-[10px] tracking-[0.15em] px-1.5 py-0.5 rounded border border-[var(--ai)]/40 text-[var(--ai)] bg-[var(--ai-soft)]">
                    AI VISION
                  </span>
                  <span className="ml-auto text-dim text-[12px] group-hover:text-mut transition-colors">
                    open match →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-20 pt-8 border-t border-[var(--line)]">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[13px] mb-4">
          <span className="text-mut">
            Built by <span className="text-ink font-medium">{AUTHOR}</span>
          </span>
          <a
            href={LINKS.repo}
            target="_blank"
            rel="noopener noreferrer"
            className="text-mut hover:text-ink transition-colors"
          >
            Source ↗
          </a>
          <a
            href={LINKS.site}
            target="_blank"
            rel="noopener noreferrer"
            className="text-mut hover:text-ink transition-colors"
          >
            jaydenclim.com ↗
          </a>
          <Link href="/how/" className="text-mut hover:text-ink transition-colors">
            How it works
          </Link>
        </div>
        <div className="text-dim text-[12px] mono leading-relaxed">
          YOLO11 pose · TrackNetV3 · BST-0 (CVPRW&apos;26) · template-matched score OCR —
          validated against ShuttleSet22 human labels across four singles matches.
        </div>
      </footer>
    </main>
  );
}
