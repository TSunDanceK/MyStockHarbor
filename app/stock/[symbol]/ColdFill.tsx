"use client";

// The figures section of a page whose symbol has no stored SEC set yet.
//
// The server rendered "not yet read" (and `noindex`). For a person, this asks
// the human-gated server action to read the filings, waits, and refreshes so
// the server re-renders from the stored set. A crawler that runs no script
// keeps the "not yet read" note; one BotID refuses, or whose challenge never
// answers, settles on the fallback sentence. The scheduled jobs fill either.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { requestColdFill } from "./coldFillAction";
import {
  COLD_FILL_WORDS as WORDS,
  REFRESH_GRACE_MS,
  settleColdFill,
  type ColdFillPhase as Phase,
} from "./coldFillSettle";

const noSubscribe = () => () => {};

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
  // sequence settles.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [settled, setPhase] = useState<Phase | null>(null);
  const phase: Phase = settled ?? (hydrated ? "reading" : "waiting");
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // ALWAYS SETTLES (coldFillSettle.ts): a hang in BotID's challenge, a throw
    // or a bot refusal all end on the fallback sentence within the ceiling.
    void settleColdFill(() => requestColdFill(symbol, token)).then((step) => {
      if (cancelled) return;
      if (step.kind === "phase") { setPhase(step.phase); return; }
      timers.push(setTimeout(() => {
        if (cancelled) return;
        router.refresh();
        // A filled page re-renders without this component; one still cold
        // after the refresh settles on the fallback rather than "Reading…".
        timers.push(setTimeout(() => { if (!cancelled) setPhase("slow"); }, REFRESH_GRACE_MS));
      }, step.afterMs));
    });
    return () => { cancelled = true; timers.forEach(clearTimeout); };
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
