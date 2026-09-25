"use client";

import { useJson } from "./json";
import type { IndexData, MatchData, Replay, Showcase, Source } from "./types";

export const useIndex = () => useJson<IndexData>("/data/index.json");

export const useMatch = (id: string, src: Source) =>
  useJson<MatchData>(`/data/${id}/${src}.json`);

export const useShowcase = (id: string) => useJson<Showcase>(`/data/${id}/showcase.json`);

export const useReplay = (id: string, src: Source, set: number | null, rally: number | null) =>
  useJson<Replay>(set != null && rally != null ? `/data/${id}/replay/${src}/s${set}r${rally}.json` : null);
