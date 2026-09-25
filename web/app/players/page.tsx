import { Suspense } from "react";
import type { Metadata } from "next";
import PlayerProfiles from "@/components/PlayerProfiles";

export const metadata: Metadata = {
  title: "Player profiles — COURTSIDE",
  description: "Compare a player's observed shot patterns and movement across analyzed singles matches.",
};

export default function PlayersPage() {
  return <Suspense fallback={<main className="max-w-6xl mx-auto w-full px-5 py-12" role="status">Loading player profiles…</main>}>
    <PlayerProfiles />
  </Suspense>;
}
