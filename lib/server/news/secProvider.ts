// The SEC filings adapter.
//
// Step 5 of claude/news-adapter-spec-2026-09-13.md. Behind NEWS_PROVIDER, which
// still defaults to "fmp".
//
// ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
// A filing is the only source in the free stack that is unambiguously about the
// company: it is the company's own submission, keyed by CIK. Google News is a
// text search and the wires resolved 2 of 40 items to a universe symbol, so this
// is the leg where per-symbol attribution is exact.
//
// ── LAZY, LIKE EVERYTHING ELSE ─────────────────────────────────────────────
// One request per symbol, only when that symbol's store is cold or due. There is
// NO universe sweep here and must not be: 700 symbols of submissions on a
// schedule is the warm cron the stored-dataset design exists to avoid.
//
// ── FAIR ACCESS ────────────────────────────────────────────────────────────
// data.sec.gov answers without a declared User-Agent, but the fair-access policy
// asks for identification and caps at 10 req/sec. SEC_USER_AGENT is sent when
// set and a truthful default is sent when it is not — an anonymous request that
// works is still a request that should not be made anonymously.
import cikMap from "@/data/cik-map.json";
import { eventTypeFromForm } from "./eventType";
import { stripHtmlTags } from "./text";
import type { NewsItem, NewsProvider } from "./types";

const CIK_BY_SYMBOL = cikMap as Record<string, string>;

/** The filing window the store keeps, matching the other adapters. */
export const SEC_STORE_MAX_AGE_DAYS = 120;

/** How many recent filings are considered. The store caps at 40 overall anyway. */
const MAX_FILINGS = 20;

/**
 * Insider and holder paperwork, as opposed to company news.
 *
 * ── WHY THIS EXISTS, MEASURED ──────────────────────────────────────────────
 * MU's real submissions feed (scripts/fixtures/sec-submissions-mu.json, a live
 * capture) is 25 filings, of which 22 are Form 4 or Form 144. Taking simply the
 * newest MAX_FILINGS would have dropped the 10-Q at position 21 and the earnings
 * 8-K at position 22 — the two filings a reader actually wants — in favour of
 * twenty rows reading "Form 4 — insider transaction". Newest-first is the wrong
 * selection rule for a feed whose volume is dominated by routine paperwork.
 *
 * So routine forms are capped rather than excluded: a handful of insider
 * transactions is genuine signal, twenty of them is a wall. Amendments ("4/A")
 * count as their base form.
 */
const ROUTINE_FORMS = new Set(["3", "4", "5", "144"]);
const MAX_ROUTINE_FILINGS = 3;

function isRoutineForm(form: string): boolean {
  return ROUTINE_FORMS.has(form.replace(/\/A$/, "").trim());
}

function userAgent(): string {
  return process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (contact@mystockharbor.com)";
}

/**
 * Plain English for a filing.
 *
 * "Form 8-K — Item 5.02, officer appointment". The form alone says almost
 * nothing to a reader ("8-K" is "something happened"), and the item codes are
 * where the actual event lives, so both go in the title.
 *
 * UNKNOWN CODES ARE KEPT AS CODES rather than dropped: "Item 9.01" is at least
 * a pointer a reader can look up, where silence is not. The list covers the
 * codes that actually appear on a market-cap-weighted universe; anything else
 * degrades to the bare code.
 */
const ITEM_DESCRIPTIONS: Record<string, string> = {
  "1.01": "material agreement entered",
  "1.02": "material agreement terminated",
  "2.01": "acquisition or disposition completed",
  "2.02": "results of operations",
  "2.03": "financial obligation created",
  "2.05": "costs from exit or disposal",
  "3.01": "listing rule non-compliance",
  "4.01": "change of accountant",
  "4.02": "previously issued statements not reliable",
  "5.01": "change in control",
  "5.02": "officer appointment or departure",
  "5.03": "articles or bylaws amended",
  "5.07": "shareholder vote results",
  "7.01": "regulation FD disclosure",
  "8.01": "other events",
  "9.01": "financial statements and exhibits",
};

const FORM_DESCRIPTIONS: Record<string, string> = {
  "10-K": "annual report",
  "10-Q": "quarterly report",
  "8-K": "current report",
  "S-1": "registration statement",
  "S-3": "shelf registration",
  "DEF 14A": "proxy statement",
  "SC 13D": "beneficial ownership, activist",
  "SC 13G": "beneficial ownership, passive",
  "4": "insider transaction",
  "3": "initial insider holdings",
  "144": "proposed sale of restricted stock",
};

export function filingTitle(form: string, items: string): string {
  const cleanForm = stripHtmlTags(String(form ?? "")).trim();
  if (!cleanForm) return "";

  const codes = String(items ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  if (codes.length) {
    const described = codes
      .slice(0, 2)
      .map((code) => {
        const text = ITEM_DESCRIPTIONS[code];
        return text ? `Item ${code}, ${text}` : `Item ${code}`;
      })
      .join("; ");
    return `Form ${cleanForm} — ${described}`;
  }

  const formText = FORM_DESCRIPTIONS[cleanForm];
  return formText ? `Form ${cleanForm} — ${formText}` : `Form ${cleanForm}`;
}

type SubmissionsShape = {
  cik?: string | number;
  name?: string;
  tickers?: string[];
  sicDescription?: string;
  filings?: { recent?: Record<string, unknown[]> };
};

/**
 * Submissions JSON into NewsItems.
 *
 * Exported for the harness: the sandbox cannot reach data.sec.gov, so the
 * parser is the half that has to be testable offline.
 *
 * ── eventType COMES FROM THE FORM, and it is §7's strongest signal ─────────
 * Implemented in step 6. A form is assigned by the filer, not matched out of
 * prose, so this leg cannot be wrong the way the title leg can — and it has a
 * truthful floor: when the form says nothing more specific, "filing" is still
 * literally what the item is. See lib/server/news/eventType.ts.
 */
export function parseSubmissions(
  body: SubmissionsShape,
  symbol: string,
  nowMs = Date.now()
): NewsItem[] {
  const recent = body?.filings?.recent ?? {};
  const forms = (recent.form ?? []) as string[];
  const dates = (recent.filingDate ?? []) as string[];
  const items = (recent.items ?? []) as string[];
  const accessions = (recent.accessionNumber ?? []) as string[];
  const docs = (recent.primaryDocument ?? []) as string[];

  // PADDED FOR THE API, UNPADDED FOR THE ARCHIVE. The submissions JSON gives
  // "0000723125" and the submissions endpoint requires that padding, but the
  // archive path is /Archives/edgar/data/723125/ — the integer, not the padded
  // form. Two different spellings of the same number, and the link is the half
  // a reader clicks.
  const cik = String(body?.cik ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const oldestAllowedMs = nowMs - SEC_STORE_MAX_AGE_DAYS * 86_400_000;
  const out: NewsItem[] = [];
  // Parallel to `out`: whether each candidate is routine paperwork.
  const routine: boolean[] = [];

  for (let i = 0; i < forms.length; i += 1) {
    const title = filingTitle(forms[i], items[i] ?? "");
    if (!title) continue;

    const ms = Date.parse(`${dates[i]}T00:00:00Z`);
    if (!Number.isFinite(ms) || ms < oldestAllowedMs) continue;

    const accession = String(accessions[i] ?? "").replace(/-/g, "");
    if (!cik || !accession) continue;

    routine.push(isRoutineForm(String(forms[i] ?? "")));
    out.push({
      title,
      // The filing index page, not the primary document: it is stable, it works
      // for every form type, and it is what a reader can navigate from.
      link: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${docs[i] || ""}`.replace(/\/$/, ""),
      pubDate: new Date(ms).toISOString(),
      source: "SEC EDGAR",
      // NO SNIPPET BY NATURE. A filing has no summary, and step 3 established
      // that the page already renders the algorithmic line from
      // lib/stock-news-templates.ts for any item without a description.
      description: null,
      guid: accessions[i] ?? null,
      // ATTRIBUTION, NOT A MODE SWITCH — see the note on fetchForSymbol.
      tickers: [symbol.toUpperCase()],
      // Step 6: the FORM leg, §7's highest-priority signal, now implemented in
      // lib/server/news/eventType.ts. It never returns null — "filing" is the
      // truthful floor for anything filed — so every SEC item selects event art.
      eventType: eventTypeFromForm(forms[i], items[i] ?? ""),
      provider: "sec",
    });
  }

  // Material filings first, then routine paperwork up to its own cap, then back
  // into date order. Both passes walk the source order, which is newest-first.
  const selected: NewsItem[] = [];
  for (let i = 0; i < out.length && selected.length < MAX_FILINGS; i += 1) {
    if (!routine[i]) selected.push(out[i]);
  }
  let routineTaken = 0;
  for (let i = 0; i < out.length && selected.length < MAX_FILINGS; i += 1) {
    if (routine[i] && routineTaken < MAX_ROUTINE_FILINGS) {
      selected.push(out[i]);
      routineTaken += 1;
    }
  }

  return selected.sort((a, b) => Date.parse(b.pubDate ?? "") - Date.parse(a.pubDate ?? ""));
}

/**
 * Per-symbol filings.
 *
 * ── fmpSymbolMatched IS STILL NOT STAMPED, and the temptation is real ──────
 * A CIK filing genuinely IS about this symbol — stronger evidence than FMP's own
 * match, and stronger than the wires' category. It changes nothing, because the
 * field is not a confidence signal: rankNews treats symbol-confirmed as a HARD
 * PREFERENCE, and if any item carries it the feed uses ONLY those items. Stamping
 * it here would mean a single Form 4 discards the entire Google News feed for
 * that symbol — the strongest evidence producing the worst page. The attribution
 * goes in `tickers`, which nothing reads as a filter.
 */
async function fetchForSymbol(
  symbol: string,
  _companyName: string,
  _sinceIso: string | null
): Promise<NewsItem[]> {
  const upper = symbol.trim().toUpperCase();
  const cik = CIK_BY_SYMBOL[upper];

  if (!cik) {
    // THE REFRESH TRIGGER FOR data/cik-map.json, and the reason it is a log line
    // rather than a calendar reminder: the map is trimmed to the universe, so a
    // symbol entering the universe is exactly when it needs regenerating, and
    // this is the event that says so.
    console.warn(`[sec] ${upper}: no CIK in data/cik-map.json — regenerate it (relay task "sec", symbols=cik-map)`);
    return [];
  }

  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "user-agent": userAgent(), accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    return parseSubmissions((await res.json()) as SubmissionsShape, upper);
  } catch {
    return [];
  }
}

/**
 * Market-wide: not this adapter's job.
 *
 * There is no cross-company filings feed worth polling here — EDGAR's full-text
 * firehose is a different shape and a different budget — and §4 gives /headlines
 * to the wires and the two publishers. Returning [] rather than inventing one.
 */
async function fetchMarket(): Promise<NewsItem[]> {
  return [];
}

export const secProvider: NewsProvider = {
  id: "sec",
  fetchForSymbol,
  fetchMarket,
};
