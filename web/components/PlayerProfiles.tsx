"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useIndex } from "@/lib/data";
import { fetchJson } from "@/lib/json";
import { aggregateProfile, loadProfileMatches, profileMatches, profilePlayers, shotEvidence, type PlayerProfile } from "@/lib/profiles";
import type { Source } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";
import GitHubLink from "@/components/GitHubLink";
import SiteFooter from "@/components/SiteFooter";
import { Card, Metric, Section } from "@/components/ui";

const sourceLabel = { ai: "AI Vision", labels: "Ground truth" };
const percent = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;

export default function PlayerProfiles() {
  const { data: index, error: indexError, retry: retryIndex } = useIndex();
  const query = useSearchParams();
  const players = useMemo(() => index ? profilePlayers(index) : [], [index]);
  const requestedPlayer = query.get("player");
  const player = requestedPlayer ?? players[0]?.name ?? "";
  const source: Source = query.get("source") === "labels" ? "labels" : "ai";
  const knownPlayer = players.some((entry) => entry.name === player);
  const expected = index && knownPlayer ? profileMatches(index, player, source).length : 0;
  const requestKey = `${source}:${player}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; profile?: PlayerProfile; error?: string }>({ key: "" });

  useEffect(() => {
    if (!index || !knownPlayer) return;
    let active = true;
    loadProfileMatches(index, player, source, fetchJson).then(
      (matches) => aggregateProfile(player, source, matches),
    ).then(
      (profile) => active && setResult({ key: requestKey, profile }),
      (error) => active && setResult({ key: requestKey, error: String(error) }),
    );
    return () => { active = false; };
  }, [index, player, source, knownPlayer, requestKey, attempt]);

  const profile = result.key === requestKey ? result.profile : undefined;
  const error = result.key === requestKey ? result.error : undefined;
  function choose(nextPlayer: string, nextSource: Source) {
    const params = new URLSearchParams({ player: nextPlayer, source: nextSource });
    window.history.pushState(null, "", `/players/?${params}`);
  }
  function retryMatches() {
    setResult({ key: requestKey });
    setAttempt((value) => value + 1);
  }

  return <main className="max-w-6xl mx-auto w-full px-5 sm:px-6 pt-5 pb-14">
    <nav aria-label="Site navigation" className="flex flex-wrap items-center gap-3 border-b border-[var(--line-soft)] pb-5">
      <Link href="/" className="disp font-bold text-[1.15rem] tracking-tight shrink-0">COURT<span style={{ color: "var(--ai)" }}>SIDE</span></Link>
      <Link href="/matches/" className="text-[13px] text-mut hover:text-ink">Matches</Link>
      <div className="ml-auto flex items-center gap-2"><GitHubLink /><ThemeToggle /></div>
    </nav>

    <header className="mt-9 mb-7">
      <p className="text-mut text-[14px] mb-2">Player profiles</p>
      <h1 className="text-[clamp(2.2rem,6vw,4rem)] leading-tight font-semibold tracking-tight break-words">{knownPlayer ? player : "Follow the player"}</h1>
      <p className="text-mut mt-3 max-w-2xl leading-relaxed text-[14px]">Compare the same player across observed singles matches. Shot counts and court movement keep their match context.</p>
    </header>

    {indexError ? <div role="alert" className="card p-5">Could not load the player roster. <button className="underline ml-2" onClick={retryIndex}>Retry roster</button></div> : !index ? <p role="status">Loading player roster…</p> : <>
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-8">
        <label className="flex flex-col gap-2 text-[13px] text-mut sm:min-w-72">
          Player
          <select value={knownPlayer ? player : ""} onChange={(event) => choose(event.target.value, source)} className="w-full rounded-md border border-[var(--line)] bg-[var(--panel-solid)] text-ink px-3 py-2.5 min-h-11">
            {!knownPlayer && <option value="" disabled>Choose a player</option>}
            {players.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} ({entry.matches} {entry.matches === 1 ? "match" : "matches"})</option>)}
          </select>
        </label>
        <fieldset className="min-w-0">
          <legend className="text-[13px] text-mut mb-2">Data source</legend>
          <div className="flex gap-2">{(["ai", "labels"] as const).map((value) => <button key={value} aria-pressed={source === value} onClick={() => choose(player, value)} className="rounded-md border px-4 py-2.5 min-h-11 text-[13px]" style={{ borderColor: source === value ? "var(--ai)" : "var(--line)", background: source === value ? "var(--ai-soft)" : "transparent", color: source === value ? "var(--ink)" : "var(--mut)" }}>{sourceLabel[value]}</button>)}</div>
        </fieldset>
      </div>

      {!knownPlayer ? <p role="status" className="card p-5">{requestedPlayer ? `No exact roster match for “${requestedPlayer}”. Choose a listed player.` : "No players are available yet."}</p>
        : !expected ? <p role="status" className="card p-5">No {sourceLabel[source]} matches are available for {player}. Choose another source or player.</p>
          : error ? <div role="alert" className="card p-5"><p>Could not load all {expected} matches. Profile totals are unavailable until every match loads.</p><button className="mt-3 underline" onClick={retryMatches}>Retry all matches</button></div>
            : !profile ? <p role="status" className="card p-5">Loading {expected} {sourceLabel[source]} {expected === 1 ? "match" : "matches"}…</p>
              : <ProfileContent profile={profile} />}
    </>}
    <SiteFooter />
  </main>;
}

function ProfileContent({ profile }: { profile: PlayerProfile }) {
  return <div>
    <div className="grid grid-cols-3 gap-3 border-y border-[var(--line)] py-5 mb-5">
      <Metric label="Observed matches" value={profile.matches.length} size="text-[clamp(1.6rem,4vw,2.4rem)]" />
      <Metric label="Rallies" value={profile.rallies.toLocaleString()} size="text-[clamp(1.6rem,4vw,2.4rem)]" />
      <Metric label="Player shots" value={profile.ownShots.toLocaleString()} size="text-[clamp(1.6rem,4vw,2.4rem)]" />
    </div>
    <p className="text-[13px] text-mut leading-relaxed mb-9 max-w-3xl">{sourceLabel[profile.source]} only. {profile.matches.length === 1 ? "One observed match; cross-match comparisons need another match." : `These ${profile.matches.length} matches are a small sample, not a career record.`} {profile.source === "ai" && "Shot and outcome labels are machine estimates."} {profile.unknownWinners} rallies have an unknown winner.</p>

    <section aria-labelledby="profile-shots-heading" className="mb-10">
      <h2 id="profile-shots-heading" className="text-[1.45rem] font-semibold">Shot mix and recorded outcomes</h2>
      <p className="text-[13px] text-mut mt-2 mb-4 max-w-3xl">Shares use {profile.classified.toLocaleString()} classified player shots, pooled by count. Winner and error rates divide recorded endings by all player shots of that type. {Math.max(0, profile.ownShots - profile.classified)} shots have no recognized type; {profile.unratedEndings} player endings are unrated.</p>
      <div className="card overflow-x-auto" role="region" aria-label="Player shot comparison" tabIndex={0}>
        <table className="w-full text-[13px] min-w-[550px]">
          <thead><tr className="text-mut border-b border-[var(--line)] text-left"><th className="p-4 font-medium">Shot</th><th className="p-4 font-medium">Share · shots</th><th className="p-4 font-medium text-right">Winner / shot</th><th className="p-4 font-medium text-right">Error / shot</th><th className="p-4 font-medium text-right">Unrated endings</th></tr></thead>
          <tbody>{profile.shotMix.map((row) => <tr key={row.shot} className="border-b border-[var(--line-soft)] last:border-0">
            <th scope="row" className="p-4 font-medium text-left whitespace-nowrap">{row.shot}</th>
            <td className="p-4 min-w-36"><div className="mono text-[12px]">{percent(row.pct)} <span className="text-mut">· {row.n}</span></div><div className="h-1 mt-2 bg-[var(--line)] rounded-full"><div className="h-1 rounded-full bg-[var(--ai)]" style={{ width: `${row.pct}%` }} /></div></td>
            <td className="p-4 text-right mono">{percent(row.winnerPct)} <span className="text-mut text-[11px]">({row.w}/{row.n})</span></td>
            <td className="p-4 text-right mono">{percent(row.errorPct)} <span className="text-mut text-[11px]">({row.e}/{row.n})</span></td>
            <td className="p-4 text-right mono">{row.unrated}</td>
          </tr>)}</tbody>
        </table>
        {!profile.shotMix.length && <p className="p-5 text-mut">No classified player shots in these matches.</p>}
      </div>
    </section>

    <section className="mb-10">
      <Section title="Tracked movement" hint="Rally-scoped court movement from player tracks. Overall speed is total distance divided by tracked time, rather than an average of match averages." />
      <Card><div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Metric label="Distance" value={profile.movement.matches ? `${profile.movement.distance.toLocaleString()} m` : "—"} />
        <Metric label="Tracked time" value={profile.movement.matches ? `${(profile.movement.seconds / 60).toFixed(1)} min` : "—"} />
        <Metric label="Mean speed" value={profile.movement.speed == null ? "—" : `${profile.movement.speed.toFixed(2)} m/s`} />
      </div><p className="text-[12px] text-mut mt-4">Valid movement data in {profile.movement.matches} of {profile.matches.length} matches. Both sources use computer-vision tracks; their rally windows can differ.</p></Card>
    </section>

    <section>
      <Section title="Match by match" hint="Scores are shown player first. Open the match or inspect rallies containing that player's most frequent shots." />
      <div className="grid lg:grid-cols-2 gap-4">{profile.matches.map((match) => {
        const meta = match.data.meta;
        const topShots = match.data.insights.shotMix.filter((row) => row.p === match.side).sort((a, b) => b.n - a.n).slice(0, 3);
        return <Card key={meta.id}>
          <div className="text-[12px] text-mut">{meta.date} · {meta.round}</div>
          <h3 className="text-xl font-semibold mt-2">vs {match.opponent}</h3>
          <p className="text-[13px] text-mut mt-1">{meta.tournament}</p>
          <p className="mono text-[17px] mt-4">{meta.sets.map((set) => match.side === "A" ? `${set.a}–${set.b}` : `${set.b}–${set.a}`).join("  ·  ")}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] my-5">
            <div><dt className="text-mut">Observed rallies</dt><dd className="mono mt-1">{match.data.rallies.length}</dd></div>
            <div><dt className="text-mut">Player shots</dt><dd className="mono mt-1">{match.shots}</dd></div>
            <div><dt className="text-mut">Tracked distance</dt><dd className="mono mt-1">{match.movement ? `${match.movement.distance.toLocaleString()} m` : "Unavailable"}</dd></div>
            <div><dt className="text-mut">Mean speed</dt><dd className="mono mt-1">{match.movement ? `${match.movement.speed.toFixed(2)} m/s` : "Unavailable"}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2 mb-4">{topShots.map((row) => {
            const href = shotEvidence(match.data, match.side, row.shot);
            return href ? <Link key={row.shot} href={href} className="text-[12px] px-2.5 py-2 rounded border border-[var(--line)] hover:border-[var(--mut)]">{row.shot} · {row.n} shots</Link> : null;
          })}</div>
          <Link href={`/m/${meta.id}/${profile.source}/overview/`} className="text-[13px] underline underline-offset-4">Open match report</Link>
        </Card>;
      })}</div>
    </section>
  </div>;
}
