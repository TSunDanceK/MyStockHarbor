"use client";

// The figures section of a page whose symbol has no stored SEC set yet.
//
// The server rendered "not yet read" (and `noindex`). For a person, this asks
// the human-gated server action to read the filings, waits, and refreshes so
// the server re-renders from the stored set. A crawler that runs no script, or
// one BotID refuses, keeps the "not yet read" note; the scheduled jobs fill it.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { requestColdFill } from "./coldFillAction";

type Phase = "reading" | "slow" | "none" | "waiting";

const WORDS: Record<Phase, string> = {
  reading: "Reading this company's SEC filings — this can take a few seconds.",
  slow: "This is taking longer than usual; figures will appear shortly.",
  none: "SEC's data for this company has nothing this page can show yet.",
  waiting: "This company's SEC filings have not been read yet. They are read on a schedule, so figures may appear later.",
};

const noSubscribe = () => () => {};

/** A second visitor while the first one's fill is running: look again after this. */
const IN_FLIGHT_RETRY_MS = 6000;

export default function ColdFill(
  { symbol, token, headline, bare = false, textStyle }:
  {
    symbol: string; token: string; headline: string;
    /** Inside another card (the stock page's earnings snapshot): the sentence only. */
    bare?: boolean;
    textStyle?: React.CSSProperties;
  }
) {
  const router = useRouter();
  // "waiting" IS THE SERVER-RENDERED STATE, so a crawler that runs no script
  // reads "not yet read"; only a hydrated page shows "reading" until the
  // action answers.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [settled, setPhase] = useState<Phase | null>(null);
  const phase: Phase = settled ?? (hydrated ? "reading" : "waiting");
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    let cancelled = false;
    const ask = async (retry: boolean) => {
      try {
        const reply = await requestColdFill(symbol, token);
        if (cancelled) return;
        if (reply.ok) {
          if (reply.outcome === "filled") router.refresh();
          else if (reply.outcome === "no-data") setPhase("none");
          else if (reply.outcome === "queued" || reply.outcome === "busy") setPhase("slow");
          else setPhase("waiting");
        } else if (reply.refused === "in-flight" && !retry) {
          setTimeout(() => { if (!cancelled) router.refresh(); }, IN_FLIGHT_RETRY_MS);
        } else {
          setPhase("waiting");
        }
      } catch {
        if (!cancelled) setPhase("slow");
      }
    };
    void ask(false);
    return () => { cancelled = true; };
  }, [symbol, token, router]);

  if (bare) return <p style={textStyle} aria-live="polite">{WORDS[phase]}</p>;
  return (
    <section className="card" aria-live="polite">
      <div className="eyebrow">Financials</div>
      <h2>{headline}</h2>
      <p style={{ marginBottom: 0 }}>{WORDS[phase]}</p>
    </section>
  );
}
