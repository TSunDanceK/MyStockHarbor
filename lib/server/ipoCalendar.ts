// Upcoming confirmed IPOs, sourced from FMP's IPO calendar endpoint.
//
// FMP's public docs pages for this endpoint don't expose a full field list
// from this environment (their docs are a JS-rendered API playground), so
// this parser accepts several plausible field-name variants per value
// rather than betting on one exact schema, and falls back to null/omitted
// for anything it can't find. app/api/debug/ipo-calendar/route.ts exists to
// confirm the real field names against live data once deployed (this
// sandbox has no FMP_API_KEY to test against directly) -- if FMP's actual
// field names differ from the candidates below, add them there rather than
// guessing further.
//
// "Confirmed" here means the deal has been priced -- FMP returns IPO
// calendar rows well before pricing with price range / share count / market
// cap left null, then fills them in once underwriters finalize the deal.
// Only rows with that pricing information present are shown, so the page
// doesn't list speculative/unpriced listings.
//
// Both "upcoming" (next 30 days) and "recent" (past 30 days) views hit the
// same FMP endpoint, just with the date range flipped, and are cached
// separately below.

import { readFeed, warnIfImplausiblyEmpty, type Feed } from "./feedCache";
import { buildSecIpoTables } from "./ipoSecSource";
import { indexByCik } from "./ipoExclusions";
import { resolveTickerMap } from "./secTickerMap";
import { readStoredIpoFilings } from "./ipoSecStore";
// Re-exported so the cadence/staleness constants stay discoverable from the
// module that owns the page's data, even though the rule itself lives with the
// other exclusions.
export { IPO_TERMS_MAX_AGE_DAYS } from "./ipoExclusions";
import { fmpFetch } from "./fmpUsage";

// How often the IPO calendar is re-read from FMP.
//
// DAILY, AND EXPORTED, BECAUSE THREE LAYERS HAVE TO AGREE ON IT. This was
// 1800s in three separate places -- feedCache's freshness, the fetch's
// `next: { revalidate }`, and `export const revalidate` on
// app/upcoming-ipos/page.tsx -- kept in step by comments asking the next
// reader to notice. Each layer can silently veto the others: feedCache decides
// whether the fetch is called at all, Next's Data Cache decides whether that
// call reaches FMP, and the route's own revalidate is capped by the fetch's
// (claude/traps/fetch-revalidate-caps-the-page.md). One exported number is
// what makes "they agree" a fact rather than a habit.
//
// An IPO calendar changes at most once a day: a deal prices, or it doesn't.
// Re-reading it 48 times a day bought nothing and spent FMP bandwidth against
// a cap whose penalty is suspension. The page's own `revalidate` still has to
// be a literal -- Next requires the segment config to be statically
// analysable, so it cannot import this -- and scripts/check-ipo-cadence.mjs is
// what holds the literal to this value.
export const IPO_REVALIDATE_SECONDS = 24 * 60 * 60;


export type ConfirmedIpo = {
  // ROW IDENTITY, AND IT IS NOT THE SYMBOL. A company that has filed to list but
  // has not priced has no ticker yet -- the proposed symbol is a claim in a
  // prospectus, present on roughly half of covers, while the CIK is the
  // identifier the source is organised BY. It is the first column of every EDGAR
  // index row and the join key into secTickerMap.
  //
  // THE ORDERING MATTERS AND IS DELIBERATE: `cik` became required BEFORE `symbol`
  // became nullable. Relaxing the symbol first would have left rowKey() in
  // IpoList.tsx keying on a value that is sometimes absent -- upper-table rows
  // would collide as "null-<date>", and React would bleed expand/collapse state
  // between two companies that amended on the same day.
  cik: string;
  // NULLABLE SINCE the page began showing companies that have filed but not
  // priced. Every consumer must render a fallback; none may use it as identity.
  symbol: string | null;
  company: string;
  date: string;
  exchange: string | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  sharesOffered: number | null;
  dealSize: number | null;
  marketCap: number | null;
};

type FmpIpoRow = Record<string, unknown>;

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const cleaned = value.replace(/[$,]/g, "").trim();
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstStr(row: FmpIpoRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(row[key]);
    if (value) return value;
  }
  return null;
}

function firstNum(row: FmpIpoRow, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(row[key]);
    if (value !== null) return value;
  }
  return null;
}

// Some FMP calendar-style endpoints represent a price range as one string
// field (e.g. "8.00-10.00" or "$8.00 - $10.00") rather than two numeric
// fields. Support both shapes.
function parsePriceRange(row: FmpIpoRow): { low: number | null; high: number | null } {
  const low = firstNum(row, ["priceRangeLow", "priceLow", "rangeLow", "lowPrice"]);
  const high = firstNum(row, ["priceRangeHigh", "priceHigh", "rangeHigh", "highPrice"]);
  if (low !== null || high !== null) return { low, high };

  const rangeStr = firstStr(row, ["priceRange", "range"]);
  if (!rangeStr) return { low: null, high: null };

  const parts = rangeStr
    .replace(/\$/g, "")
    .split(/-|to/i)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));

  if (parts.length === 2) return { low: parts[0], high: parts[1] };
  if (parts.length === 1) return { low: parts[0], high: parts[0] };
  return { low: null, high: null };
}

function isWithdrawnOrPostponed(row: FmpIpoRow): boolean {
  // Live data confirms FMP's actual field for this is "actions" (values seen:
  // "Expected"), not "status"/"ipoStatus" as originally guessed -- kept both
  // as fallbacks in case that varies by row.
  const status = firstStr(row, ["actions", "status", "ipoStatus"]);
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized.includes("withdraw") || normalized.includes("postpone");
}

function parseRow(row: FmpIpoRow): ConfirmedIpo | null {
  const symbol = firstStr(row, ["symbol", "ticker"]);
  const company = firstStr(row, ["company", "companyName", "name"]);
  const date = firstStr(row, ["date", "ipoDate", "expectedDate"]);

  // FMP'S ROWS ARE NOT KNOWN TO CARRY A CIK -- unverified, and unverifiable from
  // a sandbox with no FMP_API_KEY. So identity on this branch is SYNTHESISED from
  // the symbol, which FMP always supplies and which parseRow still requires
  // below. The `fmp:` prefix is what stops a synthesised id being mistaken for a
  // real CIK if the two ever meet in one list.
  //
  // This is the FMP branch only. The SEC branch has a real CIK and must use it.
  const cik = firstStr(row, ["cik", "CIK"]) ?? (symbol ? `fmp:${symbol}` : null);

  // Symbol stays REQUIRED here even though the type now allows null: an FMP
  // "confirmed, priced" row without a ticker is a broken row, not an early-stage
  // filing. The nullable case belongs to the SEC upper table alone.
  if (!symbol || !company || !date || !cik) return null;
  if (isWithdrawnOrPostponed(row)) return null;

  const { low, high } = parsePriceRange(row);
  const sharesOffered = firstNum(row, ["shares", "sharesOffered", "numberOfShares"]);
  const marketCap = firstNum(row, ["marketCap", "marketcap"]);
  const dealSize = firstNum(row, ["dealSize", "totalOfferSize", "offerSize"]);

  // "Confirmed" = pricing has been finalized. If none of the pricing
  // fields FMP would fill in after pricing are present, this listing is
  // still speculative -- skip it rather than showing an all-blank row.
  if (low === null && high === null && sharesOffered === null && dealSize === null) {
    return null;
  }

  return {
    cik,
    symbol,
    company,
    date,
    exchange: firstStr(row, ["exchange"]),
    priceRangeLow: low,
    priceRangeHigh: high,
    sharesOffered,
    // FMP doesn't return a dedicated deal-size field, so this is computed --
    // verified against real confirmed rows that shares x price-range
    // *midpoint* (not the high end) matches the expected deal size (e.g.
    // 50,000,000 shares x $25.00 mid = $1.25B), so mid is used here rather
    // than high.
    dealSize:
      dealSize ??
      (sharesOffered !== null && low !== null && high !== null
        ? sharesOffered * ((low + high) / 2)
        : null),
    marketCap,
  };
}

// ── The SEC branch ─────────────────────────────────────────────────────────
//
// SAME CONTRACT, SAME THROW-VS-EMPTY DISCIPLINE as the FMP branch below: a read
// that could not answer THROWS, and a genuinely quiet window returns []. readFeed
// treats the two completely differently -- a throw serves the last good copy, a []
// is published as "nothing scheduled" -- so collapsing them is how a broken read
// becomes a confident empty page.
//
// The store is populated out of band (the daily-index refresh path), never by a
// render: form.idx is 39.3 MB a quarter and the page must not touch it. The
// render reads what is stored, exactly as the news path does.
async function fetchSecIpoRows(from: string, to: string): Promise<ConfirmedIpo[]> {
  const records = await readStoredIpoFilings();
  if (records === null) {
    // NOT []. A missing store is "could not answer", the same category as a
    // missing FMP_API_KEY -- and the same bug if it is reported as "no IPOs".
    throw new Error(
      "IPO_PROVIDER=sec but no stored SEC filing records were found. The " +
        "daily-index refresh has not run, or its key is wrong. This is a failed " +
        "read, not a quiet market."
    );
  }

  const windowDays = Math.max(
    1,
    Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000
    )
  );
  // The map is resolved HERE, not inside buildSecIpoTables: keeping that
  // function free of @upstash/redis is what lets the seeding script on the relay
  // import and call the very same classifier. One path, not two that agree.
  const { map: tickerMap } = await resolveTickerMap();
  const { upcoming, recent } = buildSecIpoTables(records, indexByCik(tickerMap), windowDays);

  // BOTH TABLES FROM ONE READ. The caller still asks for a date range because
  // the FMP branch needs one; on this branch the split is derived from each
  // filer's own history (see ipoSecSource.ts) and the range only sizes the
  // window. Which half to return is decided by the direction of the range --
  // `from` in the future means the forward table.
  const todayIso = toIsoDate(new Date());
  return from >= todayIso ? upcoming : recent;
}

// WHICH SOURCE THE PAGE RUNS ON. Default "fmp" -- unchanged behaviour until the
// env var is set, which is the owner's standing rule: reversible by a switch,
// not a rewrite.
//
// AN ENV CHANGE NEEDS A PRODUCTION REDEPLOY TO BE SEEN. That is not a guess; it
// is the correction #453 had to make after the NEWS_PROVIDER flip appeared not
// to take effect. Setting this in the Vercel dashboard and waiting will not do
// anything on its own.
export type IpoProvider = "fmp" | "sec";

export function ipoProvider(): IpoProvider {
  return process.env.IPO_PROVIDER === "sec" ? "sec" : "fmp";
}

async function fetchIpoRows(from: string, to: string): Promise<ConfirmedIpo[]> {
  if (ipoProvider() === "sec") return fetchSecIpoRows(from, to);
  const apiKey = process.env.FMP_API_KEY;
  // Throwing (rather than returning []) is deliberate: readFeed treats a throw
  // as "could not answer" and a [] as "genuinely none". A missing key is the
  // former, and used to be silently indistinguishable from the latter.
  if (!apiKey) throw new Error("FMP_API_KEY is not set");

  const url = `https://financialmodelingprep.com/stable/ipos-calendar?from=${encodeURIComponent(
    from
  )}&to=${encodeURIComponent(to)}&apikey=${encodeURIComponent(apiKey)}`;

  // NOT no-store. During prerender -- a build, or an ISR revalidation -- a
  // no-store fetch throws DynamicServerError, which marks the render dynamic
  // IRREVERSIBLY and is then swallowed by readFeed's catch and misreported as
  // an upstream failure, so the route silently ships as dynamic while the log
  // blames FMP. Measured on dpl_FLJxprw2KApWGfwpRTW6SGbn1afc.
  //
  // The revalidate is IPO_REVALIDATE_SECONDS, the same number readFeed is given
  // below. feedCache owns freshness; this is what stops Next's Data Cache
  // holding a different opinion about it.
  const res = await fmpFetch(url, {
    next: { revalidate: IPO_REVALIDATE_SECONDS },
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`FMP IPO calendar failed: ${res.status}`);

  const payload = await res.json();
  const rows: FmpIpoRow[] = Array.isArray(payload) ? payload : [];

  return rows
    .map(parseRow)
    .filter((row): row is ConfirmedIpo => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getUpcomingConfirmedIpos(): Promise<Feed<ConfirmedIpo>> {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return readFeed(
    "ipo:upcoming",
    () => fetchIpoRows(toIsoDate(now), toIsoDate(in30Days)),
    { freshSeconds: IPO_REVALIDATE_SECONDS }
  );
}

// Confirmed IPOs that priced/listed within the last 30 days, most recent
// first.
export async function getRecentIpos(): Promise<Feed<ConfirmedIpo>> {
  const now = new Date();
  const past30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const feed = await readFeed(
    "ipo:recent",
    () => fetchIpoRows(toIsoDate(past30Days), toIsoDate(now)),
    { freshSeconds: IPO_REVALIDATE_SECONDS }
  );

  // This window is a free monitor. A month with zero US IPO listings is
  // essentially unheard of, so a successful-but-empty result here almost
  // always means the read or the parser is broken in a way that did not
  // throw -- worth a log line even though `ok` is true.
  warnIfImplausiblyEmpty(
    feed,
    "ipo:recent",
    "A 30-day window with no US IPO listings is essentially never true -- " +
      "suspect a failed read or a parser drift off FMP's field names, not a quiet market."
  );

  return { ...feed, items: [...feed.items].sort((a, b) => b.date.localeCompare(a.date)) };
}
