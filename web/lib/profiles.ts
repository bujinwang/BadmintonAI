import type { IndexData, MatchData, P, Source } from "./types";

export function profilePlayers(index: IndexData) {
  const counts = new Map<string, number>();
  for (const match of index.matches) {
    for (const name of new Set(Object.values(match.players))) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, matches]) => ({ name, matches }))
    .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
}

export function playerSide(match: MatchData, player: string): P {
  const sides = (["A", "B"] as const).filter((side) => match.meta.players[side] === player);
  if (sides.length !== 1) throw new Error(`Player identity does not match ${match.meta.id}`);
  return sides[0];
}

export function profileMatches(index: IndexData, player: string, source: Source) {
  return index.matches.filter((match) => match.sources.includes(source)
    && Object.values(match.players).includes(player))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** All-or-nothing: failed or inconsistent bundles must never produce partial totals. */
export async function loadProfileMatches(index: IndexData, player: string, source: Source,
  read: (url: string) => Promise<MatchData>) {
  return Promise.all(profileMatches(index, player, source).map(async (entry) => {
    const match = await read(`/data/${encodeURIComponent(entry.id)}/${source}.json`);
    if (match.meta?.id !== entry.id || match.meta.source !== source) {
      throw new Error(`Unexpected match or source in ${entry.id}`);
    }
    playerSide(match, player);
    return match;
  }));
}

function count(value: number) {
  if (!Number.isInteger(value) || value < 0) throw new Error("Invalid profile sample count");
  return value;
}

export function aggregateProfile(player: string, source: Source, bundles: MatchData[]) {
  const ids = new Set<string>();
  const shots = new Map<string, { shot: string; n: number; w: number; e: number; unrated: number }>();
  const matches = bundles.map((data) => {
    if (data.meta.source !== source || ids.has(data.meta.id)) {
      throw new Error("Profiles require unique matches from one data source");
    }
    ids.add(data.meta.id);
    const side = playerSide(data, player);
    const mine = data.strokes.filter((stroke) => stroke.p === side);
    const ownMix = data.insights.shotMix.filter((row) => row.p === side);
    for (const row of ownMix) {
      const total = shots.get(row.shot) ?? { shot: row.shot, n: 0, w: 0, e: 0, unrated: 0 };
      total.n += count(row.n);
      shots.set(row.shot, total);
    }
    for (const row of data.insights.shotOutcomes.filter((outcome) => outcome.p === side)) {
      const total = shots.get(row.shot);
      if (total) { total.w += count(row.w); total.e += count(row.e); }
    }
    const unrated = data.rallies.filter((rally) => rally.endHitter === side
      && (rally.winner == null || rally.category === "—"));
    for (const rally of unrated) {
      const total = shots.get(rally.endShot);
      if (total) total.unrated += 1;
    }
    const movement = data.movement[side];
    const validMovement = movement && Number.isFinite(movement.distM) && movement.distM >= 0
      && Number.isFinite(movement.secs) && movement.secs > 0;
    return {
      data, side, opponent: data.meta.players[side === "A" ? "B" : "A"],
      shots: mine.length, classified: ownMix.reduce((sum, row) => sum + row.n, 0),
      unknownWinners: data.rallies.filter((rally) => rally.winner == null).length,
      unratedEndings: unrated.length,
      movement: validMovement ? { distance: movement.distM, seconds: movement.secs,
        speed: movement.distM / movement.secs } : null,
    };
  });
  const classified = [...shots.values()].reduce((sum, row) => sum + row.n, 0);
  const movements = matches.flatMap((match) => match.movement ? [match.movement] : []);
  const distance = movements.reduce((sum, movement) => sum + movement.distance, 0);
  const seconds = movements.reduce((sum, movement) => sum + movement.seconds, 0);
  return {
    player, source, matches,
    rallies: matches.reduce((sum, match) => sum + match.data.rallies.length, 0),
    ownShots: matches.reduce((sum, match) => sum + match.shots, 0), classified,
    unknownWinners: matches.reduce((sum, match) => sum + match.unknownWinners, 0),
    unratedEndings: matches.reduce((sum, match) => sum + match.unratedEndings, 0),
    movement: { matches: movements.length, distance, seconds, speed: seconds ? distance / seconds : null },
    shotMix: [...shots.values()].sort((a, b) => b.n - a.n || a.shot.localeCompare(b.shot)).map((row) => ({
      ...row, pct: classified ? 100 * row.n / classified : 0,
      winnerPct: row.n ? 100 * row.w / row.n : null,
      errorPct: row.n ? 100 * row.e / row.n : null,
    })),
  };
}

export function shotEvidence(match: MatchData, side: P, shot: string) {
  const keys = [...new Set(match.strokes.filter((stroke) => stroke.p === side && stroke.shot === shot)
    .map((stroke) => `${stroke.set}-${stroke.rally}`))];
  return keys.length ? `/m/${encodeURIComponent(match.meta.id)}/${match.meta.source}/film/?${new URLSearchParams({
    title: `${match.meta.players[side]} · ${shot}`, keys: keys.join("."),
  })}` : null;
}

export type PlayerProfile = ReturnType<typeof aggregateProfile>;
