"use client";

// THE PRICE PANEL OF A COLD SYMBOL'S PAGE (#553 COWORK #121/#122/#123).
//
// The server rendered "Price data for X is being prepared" (and `noindex`):
// a crawler that runs no script keeps exactly that. For a person, this asks
// the cold-fill server action once, then polls the store and soft-refreshes
// the page the moment the history is stored, so the price, the chart and the
// Tiingo credit appear within a few seconds (owner-accepted as "first load",
// COWORK #123). Over a cap, for a bot, or on a timeout the symbol is queued
// for tiingo-cold-queue (every 10 minutes) and the words stay true.
//
// The run (backoff, give-up, Refresh, hidden tabs) is A's pure runner
// (coldFillPoll.ts), imported unchanged; only the words and the action are B's.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { requestTiingoColdFill, tiingoColdFillStatus, touchTiingoRequested, type TiingoColdReply } from "./tiingoColdFillAction";
import { runColdFill, type ColdFillRun, type ColdFillView } from "./coldFillPoll";
import type { ColdFillStep } from "./coldFillSettle";

const noSubscribe = () => () => {};
/** The whole request, BotID's challenge included, settles within this. */
const SETTLE_MS = 12_000;

/** What one reply means for the page. Exported for the checks. */
export function tiingoStepForReply(reply: TiingoColdReply): ColdFillStep {
  if (reply.ok) {
    if (reply.outcome === "filled" || reply.outcome === "already") return { kind: "filled" };
    if (reply.outcome === "no-data") return { kind: "phase", phase: "none" };
    return { kind: "poll" }; // queued, busy
  }
  if (reply.refused === "not-supported") return { kind: "phase", phase: "none" };
  if (reply.refused === "no-list" || reply.refused === "token" || reply.refused === "symbol") return { kind: "phase", phase: "waiting" };
  return { kind: "poll" };
}

/** The words for each state. Exported for the checks. */
export function tiingoColdWords(view: ColdFillView, symbol: string): string {
  switch (view) {
    case "loaded": return "Price data loaded; updating the page.";
    case "none": return `Price data for ${symbol} isn't available from our data provider.`;
    case "gave-up": return `Price data for ${symbol} is being prepared; it may take a few minutes.`;
    default: return `Price data for ${symbol} is being prepared; it may take a few minutes.`;
  }
}

function settle(call: () => Promise<TiingoColdReply>): Promise<ColdFillStep> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (s: ColdFillStep) => { if (!done) { done = true; clearTimeout(t); resolve(s); } };
    const t = setTimeout(() => finish({ kind: "poll" }), SETTLE_MS);
    call().then((r) => finish(tiingoStepForReply(r)), () => finish({ kind: "poll" }));
  });
}

export default function TiingoColdFill({ symbol, token }: { symbol: string; token: string }) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [settled, setView] = useState<ColdFillView | null>(null);
  const view: ColdFillView = settled ?? (hydrated ? "reading" : "waiting");
  const run = useRef<ColdFillRun | null>(null);
  // Read through a ref: each server render mints a new token, and a refresh
  // that comes back still cold must not restart the run (see ColdFill.tsx).
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    const r = runColdFill({
      request: () => settle(() => requestTiingoColdFill(symbol, tokenRef.current)),
      status: async () => (await tiingoColdFillStatus(symbol, tokenRef.current)).ready,
      refresh: () => router.refresh(),
      announce: () => {},
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

  return (
    <section className="card" aria-live="polite" data-tiingo-cold={view} style={{ marginBottom: 16 }}>
      <div className="eyebrow">Price</div>
      <p style={{ marginBottom: 0 }}>
        {tiingoColdWords(view, symbol)}
        {view === "gave-up" ? (
          <button
            type="button"
            onClick={() => run.current?.retry()}
            style={{ marginLeft: 10, minHeight: 36, padding: "6px 14px", borderRadius: 10, border: "1px solid rgba(59,130,246,0.40)", background: "rgba(59,130,246,0.14)", color: "#dbeafe", fontWeight: 800, fontSize: 13, cursor: "pointer" }}
          >
            Refresh
          </button>
        ) : null}
      </p>
    </section>
  );
}

/** Keeps an off-universe symbol in the requested set while people view it (one call per page view). */
export function TiingoRequestedTouch({ symbol, token }: { symbol: string; token: string }) {
  const tokenRef = useRef(token);
  useEffect(() => { void touchTiingoRequested(symbol, tokenRef.current).catch(() => {}); }, [symbol]);
  return null;
}
