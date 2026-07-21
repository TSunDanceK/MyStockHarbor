import type { Metadata } from "next";
import VerifyClient from "./VerifyClient";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ next?: string }>;
};

// Invisible interstitial: middleware sends an IP here once it's past the
// daily /stock/* real-view limit and hasn't been verified yet today. See
// VerifyClient.tsx for the actual check, and
// claude/stock-daily-rate-limit-2026-07-21.md for the full design.
export default async function VerifyPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return <VerifyClient next={next ?? "/"} />;
}
