// "FEDERAL CONTRACTS" on the Capex page (#563 D5): the listed companies that
// received the most US federal contract money over the last 12 months, in real
// dollars as USAspending.gov publishes them.
//
// This is the one panel with a dollar figure that runs from a payer to a
// payee, and it is shown only because that figure is PUBLISHED, not estimated.
// Nothing here is inferred or apportioned.
//
// ── HOW A RECIPIENT BECOMES A TICKER ─────────────────────────────────────────
// Two ways, in this order, and nothing else:
//   1. data/capex/federal-aliases.json — a recipient name that a reviewer has
//      tied to a listed parent, each with its basis ("USAspending parent:
//      ...", "subsidiary named in the parent's 10-K", ...). This is where
//      subsidiaries like "Electric Boat Corporation" become GD, and where
//      out-of-date parents in USAspending (Amentum under AECOM) are corrected.
//      The same file lists names that must NOT map, with the reason.
//   2. An exact match of the normalised recipient name to a company name in
//      SEC's ticker file, and only for a NYSE or Nasdaq listing. OTC tickers
//      (foreign ADRs such as GLCNF) are never used: a US company's contract
//      shown against a foreign OTC line is the mistake the probe found.
// Unmatched recipients are left unmatched, and the job reports the largest of
// them so the alias list can be reviewed — it never guesses a parent.
//
// ── COST ──────────────────────────────────────────────────────────────────
// Weekly data from a daily cron (see the route for why). USAspending, when it
// refreshes: one monthly total and ten pages of 100 recipients. Redis: one GET
// a day for the record's age, one SET a week, plus recordJobRun; the page
// reads the key with one GET per render.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

export const CAPEX_FEDERAL_REDIS_KEY = "msh:capex:federal:v1";
/** Commands a refreshing run spends on the key: one SET (the daily GET is counted by the route). */
export const CAPEX_FEDERAL_COMMANDS_PER_RUN = 1;
/** The record is refreshed when it is at least this old: weekly data. */
export const CAPEX_FEDERAL_FRESH_DAYS = 6.5;
/** Recipients read per run: top 1,000 by obligations, ten pages of 100. */
export const CAPEX_FEDERAL_PAGES = 10;
/** Companies kept in the stored record (the panel shows the top of these). */
export const CAPEX_FEDERAL_KEEP = 40;

export type FederalAlias = { name: string; ticker: string; basis: string };
export type FederalExclusion = { name: string; reason: string };
export type TickerRow = [number, string, string, string | null]; // cik, name, ticker, exchange

export type FederalCompany = {
  ticker: string;
  cik: string;
  name: string;
  /** Contract obligations over the window, US dollars, as USAspending reports them. */
  amount: number;
  /** Recipient entities (UEIs) of this company among the top 1,000. */
  recipients: number;
  /** How the match was made, for the largest recipient: "alias" or "name". */
  via: "alias" | "name";
};

export type StoredFederal = {
  version: 1;
  updatedAt: string;
  window: { start: string; end: string };
  /** All contract obligations in the window. */
  totalObligations: number;
  /** Obligations held by the top 1,000 recipients read. */
  topRecipientsObligations: number;
  recipientsRead: number;
  /** Obligations of the recipients matched to a listed ticker. */
  matchedObligations: number;
  companies: FederalCompany[];
  /** The largest recipients left unmatched, for review of the alias list. */
  unmatchedLargest: { name: string; amount: number }[];
};

// ── Matching (pure; lifted into scripts/check-capex-federal.mjs) ────────────

const SUFFIX =
  /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|LLC|L ?L ?C|L ?P|PLC|N ?V|S ?A|AG|SE|HOLDINGS?|GROUP|THE|DE|NEW)\b/g;

/** "The Boeing Company" and "BOEING CO" both normalise to "BOEING". */
export function normaliseName(name: string): string {
  return ` ${String(name).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ")} `
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LISTED = new Set(["NYSE", "Nasdaq"]);

/**
 * Build the matcher once per run. Aliases win over name matches; an excluded
 * name never matches; a name shared by two different CIKs never matches.
 */
export function buildMatcher(
  tickers: TickerRow[],
  aliases: FederalAlias[],
  exclusions: FederalExclusion[]
): (recipientName: string) => { ticker: string; cik: string; name: string; via: "alias" | "name" } | null {
  const byTicker = new Map<string, { cik: string; name: string; exchange: string | null }>();
  const byName = new Map<string, { ticker: string; cik: string; name: string } | "ambiguous">();
  for (const [cik, name, ticker, exchange] of tickers) {
    if (!byTicker.has(ticker)) byTicker.set(ticker, { cik: String(cik), name, exchange });
    if (!exchange || !LISTED.has(exchange)) continue;
    // Preferred shares and warrants ("C-PN", "SPCE.WS") share the common's
    // name; the plain ticker is the one a reader knows.
    if (/[-.]/.test(ticker)) continue;
    const key = normaliseName(name);
    const prev = byName.get(key);
    if (prev === undefined) byName.set(key, { ticker, cik: String(cik), name });
    else if (prev !== "ambiguous" && prev.cik !== String(cik)) byName.set(key, "ambiguous");
  }
  const aliasMap = new Map(aliases.map((a) => [normaliseName(a.name), a.ticker]));
  const excluded = new Set(exclusions.map((e) => normaliseName(e.name)));
  return (recipientName: string) => {
    const key = normaliseName(recipientName);
    if (excluded.has(key)) return null;
    const aliasTicker = aliasMap.get(key);
    if (aliasTicker) {
      const t = byTicker.get(aliasTicker);
      return t ? { ticker: aliasTicker, cik: t.cik, name: t.name, via: "alias" } : null;
    }
    const hit = byName.get(key);
    return hit && hit !== "ambiguous" ? { ...hit, via: "name" } : null;
  };
}

/**
 * Roll recipient rows up to listed companies. A company's own subsidiaries add
 * to that company; nothing is ever added across different companies.
 */
export function rollUp(
  rows: { name: string; amount: number }[],
  match: ReturnType<typeof buildMatcher>,
  keep: number = CAPEX_FEDERAL_KEEP
): { companies: FederalCompany[]; matched: number; unmatchedLargest: { name: string; amount: number }[] } {
  const byTicker = new Map<string, FederalCompany & { top: number }>();
  const unmatched: { name: string; amount: number }[] = [];
  let matched = 0;
  for (const r of rows) {
    if (!(r.amount > 0)) continue;
    const m = match(r.name);
    if (!m) {
      unmatched.push(r);
      continue;
    }
    matched += r.amount;
    const c = byTicker.get(m.ticker) ?? { ticker: m.ticker, cik: m.cik, name: m.name, amount: 0, recipients: 0, via: m.via, top: 0 };
    c.amount += r.amount;
    c.recipients += 1;
    if (r.amount > c.top) {
      c.top = r.amount;
      c.via = m.via;
    }
    byTicker.set(m.ticker, c);
  }
  const companies = [...byTicker.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, keep)
    .map(({ top: _top, ...c }) => c);
  unmatched.sort((a, b) => b.amount - a.amount);
  return { companies, matched, unmatchedLargest: unmatched.slice(0, 25) };
}

/** The 12 complete months before `now`, as USAspending date strings. */
export function federalWindow(now: Date): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

// ── The fetch and the store (server only) ───────────────────────────────────

const API = "https://api.usaspending.gov/api/v2";
const CONTRACT_TYPES = ["A", "B", "C", "D"];

async function post<T>(path: string, body: unknown, deadline: number): Promise<T> {
  const left = deadline - Date.now();
  if (left < 5_000) throw new Error("deadline");
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "MyStockHarbor/1.0" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.min(60_000, left)),
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return (await res.json()) as T;
}

/** Read the window from USAspending. Throws if any part fails: no partial record. */
export async function fetchFederal(
  now: Date,
  deadline: number,
  pages: number = CAPEX_FEDERAL_PAGES
): Promise<{ window: { start: string; end: string }; total: number; rows: { name: string; amount: number }[] }> {
  const window = federalWindow(now);
  const filters = { time_period: [{ start_date: window.start, end_date: window.end }], award_type_codes: CONTRACT_TYPES };
  const overTime = await post<{ results: { aggregated_amount: number }[] }>(
    "/search/spending_over_time/",
    { group: "month", filters },
    deadline
  );
  const total = overTime.results.reduce((a, r) => a + (r.aggregated_amount ?? 0), 0);
  const rows: { name: string; amount: number }[] = [];
  for (let page = 1; page <= pages; page++) {
    const r = await post<{ results: { name: string | null; amount: number }[]; page_metadata?: { hasNext?: boolean } }>(
      "/search/spending_by_category/recipient/",
      { filters, category: "recipient", limit: 100, page },
      deadline
    );
    for (const x of r.results) if (x.name) rows.push({ name: x.name, amount: x.amount });
    if (!r.page_metadata?.hasNext) break;
  }
  return { window, total, rows };
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export async function readStoredFederal(): Promise<StoredFederal | null> {
  if (!redis) return null;
  try {
    const stored = await redis.get<StoredFederal>(CAPEX_FEDERAL_REDIS_KEY);
    return stored && Array.isArray(stored.companies) ? stored : null;
  } catch (err) {
    console.error("[capex:federal] redis read failed:", err);
    return null;
  }
}

export async function writeStoredFederal(doc: StoredFederal): Promise<{ ok: boolean; reason: string | null }> {
  if (!redis) return { ok: false, reason: "no redis" };
  try {
    await redis.set(CAPEX_FEDERAL_REDIS_KEY, doc);
    return { ok: true, reason: null };
  } catch (err) {
    console.error("[capex:federal] redis write failed:", err);
    return { ok: false, reason: String(err) };
  }
}
