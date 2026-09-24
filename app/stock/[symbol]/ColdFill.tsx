"use client";

// The figures section of a page whose symbol has no stored SEC set yet.
//
// The server rendered "not yet read" (and `noindex`). For a person, this asks
// the human-gated server action to read the filings, then — however long the
// fill takes — swaps the figures in by itself when the store has them, with a
// "SEC data loaded" notice (coldFillPoll.ts, #552 COWORK #46). A crawler that
// runs no script keeps the "not yet read" note; one BotID refuses settles on
// the fallback sentence. The scheduled jobs fill either.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { coldFillStatus, requestColdFill } from "./coldFillAction";
import { COLD_FILL_WORDS, settleColdFill } from "./coldFillSettle";
import { coldFillWords, runColdFill, type ColdFillRun, type ColdFillView } from "./coldFillPoll";
import { announceSecLoaded } from "@/app/components/secLoadedStore";

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
  // reads "not yet read"; only a hydrated page shows "reading" onwards.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [settled, setView] = useState<ColdFillView | null>(null);
  const view: ColdFillView = settled ?? (hydrated ? "reading" : "waiting");
  const run = useRef<ColdFillRun | null>(null);
  // THE TOKEN IS READ THROUGH A REF, NOT AN EFFECT DEPENDENCY: every server
  // render mints a new one, so a refresh that comes back still cold would
  // otherwise restart the run — a fresh fill request, then another refresh.
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    const r = runColdFill({
      // ALWAYS SETTLES (coldFillSettle.ts): a hang in BotID's challenge or a
      // throw becomes a poll; a bot refusal ends on the fallback sentence.
      request: () => settleColdFill(() => requestColdFill(symbol, tokenRef.current)),
      status: async () => (await coldFillStatus(symbol, tokenRef.current)).ready,
      refresh: () => router.refresh(),
      announce: () => announceSecLoaded(),
      view: setView,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      hidden: () => document.visibilityState === "hidden",
      onVisible: (fn) => {
        const onChange = () => { if (document.visibilityState === "visible") fn(); };
        document.addEventListener("visibilitychange", onChange);
        return () => document.removeEventListener("visibilitychange", onChange);
      },
    });
    run.current = r;
    return () => { r.cancel(); run.current = null; };
  }, [symbol, router]);

  const words = coldFillWords(view, symbol, COLD_FILL_WORDS);
  const refresh = view === "gave-up"
    ? <button type="button" className="coldFillRefresh" onClick={() => run.current?.retry()}>Refresh</button>
    : null;
  const style = <style>{`.coldFillRefresh { display: inline-flex; align-items: center; min-height: 36px; margin-left: 10px; padding: 6px 14px; border-radius: 10px; border: 1px solid rgba(59,130,246,0.40); background: rgba(59,130,246,0.14); color: #dbeafe; font-weight: 800; font-size: 13px; cursor: pointer; }`}</style>;

  if (bare) return <p style={textStyle} aria-live="polite" data-cold-fill={view}>{words}{refresh}{style}</p>;
  return (
    <section className="card" aria-live="polite" data-cold-fill={view}>
      <div className="eyebrow">Financials</div>
      <h2>{headline}</h2>
      <p style={{ marginBottom: 0 }}>{words}{refresh}</p>
      {style}
    </section>
  );
}
