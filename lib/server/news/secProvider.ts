// The SEC filings adapter.
//
// Step 5 of claude/news-adapter-spec-2026-09-13.md, behind NEWS_PROVIDER — which
// step 7 flipped to default "free", so this is live.
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
//
// The default now DERIVES from lib/server/news/userAgent.ts rather than being a
// second literal here, so there is one string to keep truthful instead of two
// that drift. SEC_USER_AGENT still wins wherever it is set, so nothing moves in
// any environment that sets it. Unlike the wires, sec.gov keeps a variable at
// all because the contact address it publishes is something the operator must
// be able to change without a deploy — that asymmetry is deliberate and the
// reasoning is written down in that file.
import cikMap from "@/data/cik-map.json";
import { eventTypeFromForm } from "./eventType";
import { stripHtmlTags } from "./text";
import { secUserAgent } from "./userAgent";
import type { NewsItem, NewsProvider } from "./types";
import { lookupOneWay, toDashed } from "@/lib/symbolSpellings.mjs";

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
/**
 * Symbol -> CIK, tolerating the dot/dash split.
 *
 * BRK.B WAS ONE OF ELEVEN MISSES IN RELAY RUN 47 AND THE ONLY ONE THAT WAS OURS.
 * `BRK-B` is in the map (CIK 0001067983); `BRK.B` is not. SEC writes the dashed
 * form, this repo's screener cache writes the dashed form, and the pickers
 * universe carries the dotted one — so the two spellings of one company sit in
 * our own data and nothing bridged them.
 *
 * This is the SAME BUG as the one #448 fixed for taxonomy, re-landing on a
 * different lookup: claude/symbol-spelling-split-2026-09-12.md measured BRK.B as
 * the only universe symbol missing both sector and industry, for exactly this
 * reason. scripts/check-symbol-spelling.mjs exists because of it, and its own
 * header names the vector — a person typing a ticker the way a human writes it
 * into a hardcoded list, which is a standing practice here rather than a
 * one-off. So this WILL happen again to the next dotted ticker that enters the
 * universe, and normalising at the lookup is what makes that harmless.
 *
 * ONE DIRECTION ONLY, deliberately. The dashed spelling is canonical everywhere
 * this repo stores data, so the fallback converts dots to dashes and never the
 * reverse. A two-way normalisation would invite writing the dotted form as if it
 * were equally valid, which is the habit that caused this.
 *
 * It cannot collide: a CIK map key contains at most one of the two separators,
 * and the exact match is always tried first, so a symbol that legitimately holds
 * a dot resolves to itself before any rewriting happens.
 */
/*
 * `ciks` IS A PARAMETER SO THE PROPERTY CAN BE TESTED, not for flexibility --
 * every caller uses the default. "Exact match wins over the rewrite" is
 * indistinguishable from "the rewrite wins" against the real map, because no
 * key in it both contains a dot and exists in its own right, so the branch that
 * separates the two implementations is never taken. A mutation swapping their
 * order survived every assertion written against the live data. Handing the
 * function a crafted map -- {"A.B": x, "A-B": y} -- is the only thing that
 * discriminates. Third time this pattern has come up today; see
 * classifyProviderStats and cikCoverage.
 */
export function cikFor(
  symbol: string,
  ciks: Record<string, string> = CIK_BY_SYMBOL
): string | undefined {
  // Through the shared helper, and ONE-WAY on purpose. The CIK map has a
  // single canonical spelling -- the dash -- so a dotted symbol may reach a
  // dashed key and a dashed miss must NOT reach a dotted one. Routing this
  // through the full candidate list widened it in both directions, and
  // check-sec-adapter.mjs caught it the same run.
  return lookupOneWay(ciks, symbol, toDashed);
}

/**
 * Symbols that cannot be resolved by a ticker join AT ALL, and why.
 *
 * NOT A TODO LIST AND NOT A DENYLIST. It exists so the warning below stops
 * telling the next reader to regenerate the CIK map, which for these two is
 * wrong advice that costs a relay dispatch to disprove. Runs 47-50 spent four
 * dispatches getting here; this is the receipt.
 *
 * BOTH ARE LIVE NASDAQ LISTINGS — the raw directory rows prove it — and both
 * are ABSENT from SEC's company_tickers.json. That file does not index every
 * filer's ticker, so no fix to the join reaches them. Name matching does not
 * either: NBN's "Northeast Bank" is one token from NorthEast Community Bancorp,
 * a genuinely different company, and TowneBank's only sub-floor candidate was
 * The Bancorp Inc.
 *
 * 2 unresolved out of 2,620 is 99.92%. Building a second lookup path for two
 * banks would cost more than it returns, and the SEC leg is a supplement to the
 * feed rather than the feed itself. Recorded and stopped.
 */
const NO_CIK_BY_DESIGN = new Map([
  ["NBN", "Northeast Bank — live on Nasdaq, absent from SEC's company_tickers.json"],
  ["TOWN", "TowneBank — live on Nasdaq, absent from SEC's company_tickers.json"],
]);

async function fetchForSymbol(
  symbol: string,
  _companyName: string,
  _sinceIso: string | null
): Promise<NewsItem[]> {
  const upper = symbol.trim().toUpperCase();
  const cik = cikFor(upper);

  if (!cik) {
    // THE REFRESH TRIGGER FOR data/cik-map.json.
    //
    // CORRECTED 2026-09-14. This used to say the map is trimmed to the universe
    // so "a symbol entering the universe is exactly when it needs
    // regenerating". That described misses that are transient and self-
    // announcing. The real ones were not: the map was built against the PICKERS
    // universe while this function is called for any symbol with a stock page,
    // so 1,924 of 2,619 profiled symbols -- 73.5%, AOS among them -- had no CIK
    // permanently, and regenerating against the same denominator fixed none of
    // them. scripts/sec-probe.mjs now builds against the union with
    // data/static-profile.json's rows.
    // See claude/cik-map-coverage-2026-09-14.md.
    const known = NO_CIK_BY_DESIGN.get(upper);
    if (known) {
      // Deliberately not silent — the leg really is empty — but it must not
      // send anyone to regenerate a map that cannot contain this symbol.
      console.warn(`[sec] ${upper}: no CIK, known-unresolvable — ${known}`);
      return [];
    }
    console.warn(`[sec] ${upper}: no CIK in data/cik-map.json — regenerate it (relay task "sec", symbols=cik-map)`);
    return [];
  }

  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "user-agent": secUserAgent(), accept: "application/json" },
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
