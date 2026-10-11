// THE READER VOTE ON AN INSIGHT POST (#563 COWORK #132/#133, PR 2; the approved
// mock-up's "Your read" card). Pure: no Redis, no fetch, so
// scripts/check-insight-vote.mjs runs it on fixtures.
//
//   the question   "Where do you think {SYM} goes into its next report?"
//                  Higher / Sideways / Lower. A reader poll, never advice.
//   the window     votes reset at each report: the window opens on the newest
//                  results announcement on or before today (SEC report dates)
//                  and closes at the next one. Its id is that date, or "open"
//                  before the first one we hold.
//   the result     after a report, the page shows how readers called the
//                  window that just closed: the split, and the stock's move
//                  from the window's first close to its report-day close.
//                  A move inside ±CALLED_BAND_PCT counts as sideways.
//   one per window a cookie per post holds "{window}:{choice}"; the route
//                  refuses a second vote in the same window.

export const VOTE_CHOICES = [
  { key: "higher", label: "Higher", mark: "▲" },
  { key: "sideways", label: "Sideways", mark: "●" },
  { key: "lower", label: "Lower", mark: "▼" },
] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number]["key"];
export type VoteTally = Record<VoteChoice, number>;

export const isVoteChoice = (v: unknown): v is VoteChoice => VOTE_CHOICES.some((c) => c.key === v);
export const EMPTY_TALLY: VoteTally = { higher: 0, sideways: 0, lower: 0 };

/** A window id: a results-announcement date, or "open" before the first one on file. */
export const VOTE_WINDOW_RE = /^(?:\d{4}-\d{2}-\d{2}|open)$/;
export const isVoteWindow = (v: unknown): v is string => typeof v === "string" && VOTE_WINDOW_RE.test(v);

/** Slugs are lower-case words and digits joined by hyphens (content/insights file names). */
export const VOTE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A move within this band, either way, is "sideways" when the page says how readers called it. */
export const CALLED_BAND_PCT = 2;
/** Fewer votes than this in a closed window, and the page says nothing about it. */
export const MIN_VOTES_SHOWN = 5;

export type VoteWindows = {
  current: { id: string; since: string | null };
  /** The window the newest report closed, when there was one before it. */
  previous: { id: string; from: string | null; to: string } | null;
};

/**
 * The windows from the announcement dates (any order). Dates after `today`
 * are ignored; the newest one on or before today opens the current window.
 */
export function voteWindows(announced: readonly string[], today: string): VoteWindows {
  const past = [...new Set(announced.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today))].sort().reverse();
  if (!past.length) return { current: { id: "open", since: null }, previous: null };
  return {
    current: { id: past[0], since: past[0] },
    previous: { id: past[1] ?? "open", from: past[1] ?? null, to: past[0] },
  };
}

/** Whole-number shares that add up to 100 (largest remainder), and the total. */
export function tallyShares(t: VoteTally): { total: number; pct: VoteTally } {
  const total = t.higher + t.sideways + t.lower;
  if (!total) return { total: 0, pct: { ...EMPTY_TALLY } };
  const keys = VOTE_CHOICES.map((c) => c.key);
  const raw = keys.map((k) => (t[k] / total) * 100);
  const floor = raw.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - floor[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; floor[i]++; left--; }
  return { total, pct: { higher: floor[0], sideways: floor[1], lower: floor[2] } };
}

/** What the stock did over a closed window, on the same three choices. */
export function calledAs(movePct: number): VoteChoice {
  return movePct >= CALLED_BAND_PCT ? "higher" : movePct <= -CALLED_BAND_PCT ? "lower" : "sideways";
}

const LABEL: Record<VoteChoice, string> = { higher: "higher", sideways: "sideways", lower: "lower" };

/**
 * How readers called the window that closed, in words, or null when too few
 * voted. Describes; never grades the reader or the stock.
 */
export function calledWords(sym: string, t: VoteTally, movePct: number | null, reportDay: string): string | null {
  const { total, pct } = tallyShares(t);
  if (total < MIN_VOTES_SHOWN) return null;
  const top = VOTE_CHOICES.map((c) => c.key).sort((a, b) => t[b] - t[a])[0];
  const split = `${pct[top]}% of ${total} readers said ${LABEL[top]}`;
  if (movePct === null || !Number.isFinite(movePct)) return `Before the ${reportDay} report, ${split}.`;
  const went = calledAs(movePct);
  const move = `${movePct > 0 ? "+" : movePct < 0 ? "−" : ""}${Math.abs(movePct).toFixed(1)}%`;
  return `Before the ${reportDay} report, ${split}. ${sym} closed ${move} over that window, which counts as ${LABEL[went]} here (within ±${CALLED_BAND_PCT}% is sideways).`;
}

/** The cookie that remembers this browser's vote on one post: "{window}:{choice}". */
export const voteCookieName = (slug: string) => `msh_vote_${slug}`;
export function parseVoteCookie(v: string | undefined | null): { window: string; choice: VoteChoice } | null {
  const m = /^((?:\d{4}-\d{2}-\d{2})|open):(higher|sideways|lower)$/.exec(v ?? "");
  return m ? { window: m[1], choice: m[2] as VoteChoice } : null;
}
/** Long enough to outlast a quarter's window; the window id, not the expiry, decides a repeat. */
export const VOTE_COOKIE_MAX_AGE = 200 * 24 * 60 * 60;
