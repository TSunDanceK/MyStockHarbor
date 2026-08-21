// Recently added-to-index stocks (S&P 500, Nasdaq 100, Dow Jones), sourced
// from FMP's historical constituent-change endpoints, cross-referenced
// with a single batched quote call for price / market cap.
//
// Same defensive field-name-variant parsing strategy as ipoCalendar.ts, for
// the same reason: FMP's docs pages for these endpoints are a JS-rendered
// API playground that doesn't expose the full field list from this
// environment, and this sandbox has no FMP_API_KEY to test against
// directly. app/api/debug/index-changes/route.ts exists to confirm the
// real field names against live data once deployed -- if FMP's actual
// field names differ from the candidates below, add them there rather
// than guessing further.
//
// Unlike the IPO calendar, these constituent-change endpoints don't accept
// from/to params -- each one returns the *entire* historical change log
// for that index, so the 30-day "recently added" window is applied
// client-side after fetching, and only additions (not removals) are kept.

import { isDynamicServerUsage, readFeed, type Feed } from "./feedCache";

export type IndexAddition = {
  symbol: string;
  company: string;
  indexName: string;
  dateAdded: string;
  reason: string | null;
  price: number | null;
  marketCap: number | null;
};

type FmpRow = Record<string, unknown>;

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

function firstStr(row: FmpRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = str(row[key]);
    if (value) return value;
  }
  return null;
}

function firstNum(row: FmpRow, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(row[key]);
    if (value !== null) return value;
  }
  return null;
}

const INDEXES: { name: string; url: string }[] = [
  {
    name: "S&P 500",
    url: "https://financialmodelingprep.com/stable/historical-sp500-constituent",
  },
  {
    name: "Nasdaq 100",
    url: "https://financialmodelingprep.com/stable/historical-nasdaq-constituent",
  },
  {
    name: "Dow Jones",
    url: "https://financialmodelingprep.com/stable/historical-dowjones-constituent",
  },
];

type ParsedChange = {
  symbol: string;
  company: string;
  dateAdded: string;
  reason: string | null;
};

function parseChangeRow(row: FmpRow): ParsedChange | null {
  // Additions carry the new constituent's own symbol/name (sometimes under
  // "addedSecurity" rather than "name"). Rows that are pure removals with
  // no corresponding addition won't have a usable symbol/name here and
  // are skipped rather than shown as blank rows.
  const symbol = firstStr(row, ["symbol", "addedTicker", "ticker"]);
  const company = firstStr(row, ["name", "addedSecurity", "companyName", "security"]);
  const dateAdded = firstStr(row, ["dateAdded", "date_added", "date"]);

  if (!symbol || !company || !dateAdded) return null;

  return {
    symbol,
    company,
    dateAdded,
    reason: firstStr(row, ["reason"]),
  };
}

// Recently added stocks across S&P 500, Nasdaq 100, and Dow Jones, most
// recent first, with price/market cap filled in from a single batched
// quote call.
export async function getRecentIndexAdditions(): Promise<Feed<IndexAddition>> {
  return readFeed("index:additions", fetchRecentIndexAdditions);
}

async function fetchRecentIndexAdditions(): Promise<IndexAddition[]> {
  const apiKey = process.env.FMP_API_KEY;
  // Throw rather than return [] -- see the note in feedCache.ts. A missing key
  // is "could not answer", not "there were no additions".
  if (!apiKey) throw new Error("FMP_API_KEY is not set");

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // allSettled, not all: one index failing must not zero a page that covers
  // three. FMP returns 402 on the Dow Jones constituent-history endpoint under
  // this plan, and because the previous Promise.all threw on the first non-ok
  // response, that single refusal discarded the S&P 500 and Nasdaq 100 results
  // alongside it. The feed has therefore NEVER once succeeded, its Redis key
  // has never been written, and the page has rendered as unavailable since it
  // was built. It only became visible when #304 stopped DynamicServerError
  // being misreported as an upstream failure.
  const settled = await Promise.allSettled(
    INDEXES.map(async ({ name, url }) => {
      // See the note in lib/server/ipoCalendar.ts: no-store throws
      // DynamicServerError during prerender, marking the route dynamic before
      // readFeed's catch swallows it as an upstream failure. 1800s matches
      // feedCache's FRESH_MS.
      const res = await fetch(`${url}?apikey=${encodeURIComponent(apiKey)}`, {
        next: { revalidate: 1800 },
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`FMP ${name} constituent history failed: ${res.status}`);

      const payload = await res.json();
      const rows: FmpRow[] = Array.isArray(payload) ? payload : [];

      return rows
        .map(parseChangeRow)
        .filter((row): row is ParsedChange => row !== null)
        .filter((row) => {
          const added = new Date(`${row.dateAdded}T00:00:00Z`);
          return !Number.isNaN(added.getTime()) && added >= cutoff;
        })
        .map((row) => ({ ...row, indexName: name }));
    })
  );

  const succeeded: (ParsedChange & { indexName: string })[][] = [];
  const failedIndexes: string[] = [];

  settled.forEach((result, i) => {
    const name = INDEXES[i].name;
    if (result.status === "fulfilled") {
      succeeded.push(result.value);
      return;
    }
    // A DynamicServerError is not an index failure -- it is Next saying this
    // render cannot be static, and allSettled has just caught it where a
    // throw would have propagated. Rethrowing keeps trap 11's guarantee
    // intact: without this, adding allSettled here would quietly reintroduce
    // exactly the bug #304 fixed, one layer further down.
    if (isDynamicServerUsage(result.reason)) throw result.reason;

    failedIndexes.push(name);
    console.error(
      `[index:additions] ${name} constituent history unavailable, continuing ` +
        `without it:`,
      result.reason
    );
  });

  // Every index failed: that is "could not answer", not "no additions", so it
  // must throw for readFeed to serve a cached copy or mark the feed not-ok.
  if (succeeded.length === 0) {
    throw new Error(
      `all ${INDEXES.length} index constituent feeds failed: ${failedIndexes.join(", ")}`
    );
  }

  if (failedIndexes.length > 0) {
    console.warn(
      `[index:additions] serving PARTIAL data -- missing ${failedIndexes.join(", ")}; ` +
        `${INDEXES.length - failedIndexes.length} of ${INDEXES.length} indexes returned`
    );
  }

  const recentChanges = succeeded.flat();

  // A genuine empty: upstream answered, there were simply no additions in
  // the window. Returned as [] (not thrown) so it caches and reads as real.
  if (recentChanges.length === 0) return [];

  // One batched quote call for price + market cap across every symbol
  // found, rather than a per-symbol request -- keeps this page to a
  // small, fixed number of FMP calls regardless of visitor traffic.
  const symbols = Array.from(new Set(recentChanges.map((row) => row.symbol)));
  const quoteUrl = `https://financialmodelingprep.com/stable/batch-quote?symbols=${encodeURIComponent(
    symbols.join(",")
  )}&apikey=${encodeURIComponent(apiKey)}`;

  let quoteBySymbol = new Map<string, FmpRow>();
  try {
    // Same reason as the constituent fetch above.
    const quoteRes = await fetch(quoteUrl, {
      next: { revalidate: 1800 },
      headers: { accept: "application/json" },
    });
    if (quoteRes.ok) {
      const quoteRows = await quoteRes.json();
      for (const row of Array.isArray(quoteRows) ? (quoteRows as FmpRow[]) : []) {
        const sym = firstStr(row, ["symbol"]);
        if (sym) quoteBySymbol.set(sym, row);
      }
    }
  } catch {
    // If the quote call fails, still show the additions themselves --
    // price/market cap just render as "-" -- rather than failing the
    // whole page over a secondary enrichment call.
    quoteBySymbol = new Map();
  }

  const items: IndexAddition[] = recentChanges
    .map((row) => {
      const quote = quoteBySymbol.get(row.symbol);
      return {
        symbol: row.symbol,
        company: row.company,
        indexName: row.indexName,
        dateAdded: row.dateAdded,
        reason: row.reason,
        price: quote ? firstNum(quote, ["price"]) : null,
        marketCap: quote ? firstNum(quote, ["marketCap", "marketcap"]) : null,
      };
    })
    .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));

  return items;
}
