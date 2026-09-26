// WHAT THE PAGE DOES AFTER ASKING FOR A COLD FILL (#552 COWORK #46).
//
// Production, 2026-09-24, AXTI: the fill succeeded ~12s in, but the client had
// already settled on "taking longer than usual" and never looked again; only a
// manual reload showed the figures. The rule now:
//
//   - The data swaps in by itself: a soft refresh (router.refresh(), scroll
//     kept) the moment the store has the set, plus a "SEC data loaded" notice.
//   - The store is asked, not guessed: a no-store status check (a server
//     action, so never a CDN or ISR copy), backing off 2s → 4s → 8s, capped.
//   - After STILL_WORKING_AFTER_MS the words say it is still working.
//   - After POLL_GIVE_UP_MS it says "Taking longer than expected" and offers
//     Refresh (retry()): it asks the store at once — stored, it lands as above;
//     not yet, it polls again from the start.
//   - A hidden tab does not poll; it resumes the moment it is visible.
//
// PURE and import-free (type-only imports): every effect — the request, the
// status check, the refresh, the notice, timers, the clock, visibility — is
// injected, so a check can run a 45-second fill on a virtual clock.
import type { ColdFillPhase, ColdFillStep } from "./coldFillSettle";

/** Delay before each status poll: 2s, 4s, then 8s each (COWORK #46's cap). */
export const POLL_BACKOFF_MS = [2_000, 4_000, 8_000] as const;
export const pollDelayMs = (n: number): number => POLL_BACKOFF_MS[Math.min(Math.max(0, n), POLL_BACKOFF_MS.length - 1)];
/** When "reading" becomes "still reading". */
export const STILL_WORKING_AFTER_MS = 20_000;
/** When polling stops and Refresh is offered, counted from the start (or from the last Refresh). */
export const POLL_GIVE_UP_MS = 150_000;
/** After a soft refresh, how long a page that is still cold waits before offering Refresh. */
export const LANDED_GRACE_MS = 6_000;

export type ColdFillView = ColdFillPhase | "still" | "gave-up" | "loaded";

/** The words for each state. `symbol` is the page's own ticker. */
export function coldFillWords(view: ColdFillView, symbol: string, fixed: Record<ColdFillPhase, string>): string {
  switch (view) {
    case "reading": return `Reading ${symbol}'s SEC filings — this can take a few seconds.`;
    case "still": return `Still reading ${symbol}'s SEC filings; this can take up to a minute for a company we haven't loaded before.`;
    case "gave-up": return "Taking longer than expected.";
    case "loaded": return "SEC data loaded — updating the page.";
    default: return fixed[view];
  }
}

export type ColdFillDeps = {
  /** The one fill request, already settled (settleColdFill). */
  request: () => Promise<ColdFillStep>;
  /** Is the symbol's set stored now? A no-store read; a throw counts as "not yet". */
  status: () => Promise<boolean>;
  /** Re-render from the server, in place. */
  refresh: () => void;
  /** Show and speak "SEC data loaded". */
  announce: () => void;
  view: (v: ColdFillView) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  hidden: () => boolean;
  /** Call `fn` whenever the tab becomes visible; returns the unsubscribe. */
  onVisible: (fn: () => void) => () => void;
};

export type ColdFillRun = { cancel: () => void; retry: () => void };

export function runColdFill(d: ColdFillDeps): ColdFillRun {
  let cancelled = false;
  let landed = false;
  let stopped = false; // a final phase, or gave up
  let paused = false;
  let polling = false;
  let n = 0;
  let start = d.now();
  let current: ColdFillView = "reading";
  const timers = new Set<unknown>();
  const show = (v: ColdFillView) => { current = v; d.view(v); };
  const later = (fn: () => void, ms: number) => {
    const h = d.setTimer(() => { timers.delete(h); if (!cancelled) fn(); }, ms);
    timers.add(h);
  };
  const clearAll = () => { for (const h of timers) d.clearTimer(h); timers.clear(); };
  const armStill = () => later(() => { if (current === "reading") show("still"); }, STILL_WORKING_AFTER_MS);

  const land = () => {
    if (landed || cancelled) return;
    landed = true;
    clearAll();
    show("loaded");
    d.refresh();
    d.announce();
    // A filled page re-renders WITHOUT this component, which cancels the run.
    // Still here after the grace: the refresh came back cold — offer Refresh.
    later(() => { landed = false; stopped = true; show("gave-up"); }, LANDED_GRACE_MS);
  };

  const tick = async () => {
    if (cancelled || landed || stopped || polling) return;
    if (d.hidden()) { paused = true; return; }
    polling = true;
    let ready = false;
    try { ready = await d.status(); } catch { ready = false; }
    polling = false;
    if (cancelled || landed || stopped) return;
    if (ready) { land(); return; }
    if (d.now() - start >= POLL_GIVE_UP_MS) { stopped = true; clearAll(); show("gave-up"); return; }
    later(() => void tick(), pollDelayMs(n++));
  };
  const unsubscribe = d.onVisible(() => {
    if (paused && !cancelled && !landed && !stopped) { paused = false; void tick(); }
  });

  show("reading");
  armStill();
  void d.request().then((step) => {
    if (cancelled || landed || stopped) return;
    if (step.kind === "filled") { land(); return; }
    if (step.kind === "phase") { stopped = true; clearAll(); show(step.phase); return; }
    later(() => void tick(), pollDelayMs(n++));
  }, () => { if (!cancelled) later(() => void tick(), pollDelayMs(n++)); });

  return {
    cancel: () => { cancelled = true; clearAll(); unsubscribe(); },
    retry: () => {
      if (cancelled) return;
      clearAll();
      stopped = false; landed = false; paused = false; n = 0; start = d.now();
      show("reading");
      armStill();
      // THE STORE FIRST, THEN THE REFRESH: a set already stored lands exactly
      // as the automatic swap does (refresh + notice); refreshing blind would
      // replace this block before it could announce anything.
      void tick();
    },
  };
}
