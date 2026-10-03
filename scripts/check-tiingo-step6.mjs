// Tiingo step 6 (#563 COWORK #30/#31): the SPX page on SPY, the video pages,
// and the news page's hero price, each behind its own PRICE_PROVIDER_<SURFACE>.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. TIINGO PRICES INTO AI OUTPUT (contract §5.3(x)): the SPX analysis, the
//      news AI card or "Why this matters" reading a Tiingo-derived value. The
//      news hero price sits on the same page as both news AI calls.
//   2. A SURFACE SWITCHED WITHOUT ITS GATE, or without the FMP fallback that
//      COWORK #30 keeps until the owner flips the env var.
//   3. THE LABEL LIES: yesterday's close shown as today's, or an IEX trade
//      presented as the consolidated close (#553 COWORK #56).
//   4. THE CREDIT IS MISSING OR UNLINKED on a switched figure (COWORK #31 §5).
//   5. THE SPX CHART IS SPY WITHOUT SAYING SO, under copy quoting index levels.
//
// Section 1 runs the real pickSurfacePrice. Sections 2-4 read source; section
// 5 plants a mutant for every static rule, and each must fail.
//
//   node scripts/check-tiingo-step6.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const code = (p) => stripComments(raw(p), { file: p });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const FILES = {
  provider: "lib/server/marketData/provider.ts",
  surface: "lib/server/tiingoSurfacePrice.ts",
  spx: "app/markets/spx/page.tsx",
  spxChart: "app/markets/spx/SPXChartClient.tsx",
  video: "lib/videoStockData.ts",
  videoPage: "app/insights/videos/[videoId]/page.tsx",
  news: "app/stock/[symbol]/news/page.tsx",
  newsData: "lib/stock-news-data.ts",
  newsTech: "lib/server/newsTechHistory.ts",
  aiMarket: "lib/ai-market.ts",
  aiNews: "lib/ai-news-briefs.ts",
  insightRoute: "app/api/stock-news/insight/route.ts",
  whyRoute: "app/api/stock-news/why-it-matters/route.ts",
};

// ── 1. The label rule, on the real module ─────────────────────────────────
console.log("\n=== 1. pickSurfacePrice: the newer of IEX and the EOD close, named ===\n");
const S = await import(pathToFileURL(path.join(ROOT, FILES.surface)).href);
const P = await import(pathToFileURL(path.join(ROOT, FILES.provider)).href);

// 2026-09-29 18:05 UTC = 14:05 EDT; 2026-12-01 19:05 UTC = 14:05 EST.
const TUE_1405_EDT = Date.UTC(2026, 8, 29, 18, 5);
const bar = (date, close) => [date, close, close, close, close, 1000];
const row = (at, price = 101) => ({ price, open: null, high: null, low: null, prevClose: null, at });

let r = S.pickSurfacePrice(row(TUE_1405_EDT), [bar("2026-09-28", 99)], TUE_1405_EDT);
check("in session, IEX newer than the last close: the IEX trade, with its ET time",
  r?.kind === "iex" && r.price === 101 && r.label === "last IEX trade, 14:05 ET", JSON.stringify(r));

r = S.pickSurfacePrice(row(TUE_1405_EDT), [bar("2026-09-29", 100)], TUE_1405_EDT);
check("same trading day: the consolidated close wins the tie",
  r?.kind === "close" && r.price === 100 && r.label === "close, 29 Sep 2026", JSON.stringify(r));

const WED_0300_UTC = Date.UTC(2026, 8, 30, 3, 0); // 23:00 ET Tue, before the EOD job
r = S.pickSurfacePrice(row(Date.UTC(2026, 8, 29, 19, 59)), [bar("2026-09-28", 99)], Date.UTC(2026, 8, 30, 14, 0));
check("an IEX trade from an earlier day names its date",
  r?.kind === "iex" && r.label === "last IEX trade, 15:59 ET, 29 Sep", JSON.stringify(r));
r = S.pickSurfacePrice(row(Date.UTC(2026, 8, 29, 19, 59)), [bar("2026-09-28", 99)], WED_0300_UTC);
check("after the close, before the EOD job: still the IEX trade, never yesterday's close as current",
  r?.kind === "iex" && r.date === "2026-09-29", JSON.stringify(r));

r = S.pickSurfacePrice(row(Date.UTC(2026, 11, 1, 19, 5)), [], Date.UTC(2026, 11, 1, 19, 6));
check("ET across the DST change (EST in December)", r?.label === "last IEX trade, 14:05 ET", JSON.stringify(r));

// THE SESSION SUFFIX (#563 COWORK #35), from the trade's own ET time.
const labelAt = (utcMs, nowMs = utcMs + 60_000) => S.pickSurfacePrice(row(utcMs), [bar("2026-09-28", 99)], nowMs)?.label;
const SESSION_CASES = [
  ["08:40 EDT is pre-market", Date.UTC(2026, 8, 29, 12, 40), "last IEX trade, 08:40 ET (pre-market)"],
  ["10:00 EDT is in session: no suffix", Date.UTC(2026, 8, 29, 14, 0), "last IEX trade, 10:00 ET"],
  ["16:30 EDT is after hours", Date.UTC(2026, 8, 29, 20, 30), "last IEX trade, 16:30 ET (after hours)"],
  ["09:30 and 16:00 themselves are in session", Date.UTC(2026, 8, 29, 13, 30), "last IEX trade, 09:30 ET"],
  ["16:00 EDT is in session", Date.UTC(2026, 8, 29, 20, 0), "last IEX trade, 16:00 ET"],
  // DST: 13:40 UTC is 09:40 EDT on 30 Oct but 08:40 EST on 3 Nov (US clocks change 1 Nov 2026).
  ["across DST, 13:40 UTC on 30 Oct is 09:40 EDT, in session", Date.UTC(2026, 9, 30, 13, 40), "last IEX trade, 09:40 ET"],
  ["across DST, 13:40 UTC on 3 Nov is 08:40 EST, pre-market", Date.UTC(2026, 10, 3, 13, 40), "last IEX trade, 08:40 ET (pre-market)"],
  ["an earlier day's after-hours trade names its date and session",
    Date.UTC(2026, 8, 29, 21, 5), "last IEX trade, 17:05 ET, 29 Sep (after hours)", Date.UTC(2026, 8, 30, 12, 0)],
];
/** Every session case, against a given pickSurfacePrice. */
const sessionLabelsHold = (pick) =>
  SESSION_CASES.every(([, at, want, now]) => pick(row(at), [bar("2026-09-28", 99)], now ?? at + 60_000)?.label === want);
for (const [name, at, want, now] of SESSION_CASES) {
  const got = labelAt(at, now);
  check(`session label: ${name}`, got === want, got);
}

check("no row, no bars: null (the caller keeps FMP), never a zero", S.pickSurfacePrice(null, null, TUE_1405_EDT) === null);
check("a zero or negative price is not a price",
  S.pickSurfacePrice(row(TUE_1405_EDT, 0), [bar("2026-09-28", -1)], TUE_1405_EDT) === null);
r = S.pickSurfacePrice(null, [bar("2026-09-28", 99)], TUE_1405_EDT);
check("no pool row: the close", r?.kind === "close" && r.price === 99, JSON.stringify(r));

check("the credit is the contract's words", S.TIINGO_CREDIT === "Market data from Tiingo.com" && S.TIINGO_URL === "https://www.tiingo.com/");
check("the three surfaces are appended", ["SPX", "VIDEOS", "NEWS_HERO"].every((s) => P.PRICE_SURFACES.includes(s)));
check("and are fmp unless set to tiingo",
  ["SPX", "VIDEOS", "NEWS_HERO"].every((s) => P.priceProviderFor(s, {}) === "fmp" && P.priceProviderFor(s, { [`PRICE_PROVIDER_${s}`]: "tiingo" }) === "tiingo"));
// NEWS_TECH (#563 COWORK #31 (a)): the news page's technical history.
const NT = await import(pathToFileURL(path.join(ROOT, FILES.newsTech)).href);
check("NEWS_TECH is appended, and fmp unless set to tiingo",
  P.PRICE_SURFACES.includes("NEWS_TECH") && P.priceProviderFor("NEWS_TECH", {}) === "fmp" &&
  P.priceProviderFor("NEWS_TECH", { PRICE_PROVIDER_NEWS_TECH: "tiingo" }) === "tiingo");
check("NEWS_TECH off: null without a read (the page keeps its path)", (await NT.readNewsTechHistory("AAPL", {})) === null);
check("NEWS_TECH on, nothing stored: null (the page keeps its path), not a throw",
  (await NT.readNewsTechHistory("AAPL", { PRICE_PROVIDER_NEWS_TECH: "tiingo" })) === null);
check("NEWS_TECH keeps the Yahoo path's window", NT.NEWS_TECH_POINTS === 320);

const readsNone = await S.readSurfacePrice("SPY");
check("with no Redis configured, the read is null, not a throw", readsNone === null);

// THE SUFFIX MUTANT (COWORK #35): the same module with the suffix dropped must
// fail the session cases. The copy sits beside the original so its relative
// imports resolve, and is removed straight after.
{
  const src = raw(FILES.surface);
  const mutated = src.replace("${sessionSuffix(iex.time)}`", "`");
  const copy = path.join(ROOT, "lib/server", `.tiingoSurfacePrice.mutant-${process.pid}.ts`);
  let bites = false;
  if (mutated !== src) {
    fs.writeFileSync(copy, mutated);
    try { bites = !sessionLabelsHold((await import(pathToFileURL(copy).href)).pickSurfacePrice); }
    catch { bites = true; }
    finally { fs.rmSync(copy, { force: true }); }
  }
  check("mutant bites: dropping the session suffix fails the session labels", mutated !== src && bites,
    mutated === src ? "the mutation did not apply" : "");
}

// ── the static rules, each a function of source so section 5 can mutate it ──
const PRICE_READS = /readTiingo|tiingoSurfacePrice|marketData\/|pricePool|historyCache|getDailyHistory|fetchQuote|quoteData/;

const rules = {
  // 1. AI isolation
  "ai-market reads no price and takes no price argument": (src) =>
    !PRICE_READS.test(src) && /async function generateSpxMarketAnalysis\(\s*_timeBucket\?: number\s*\)/.test(src),
  "ai-news-briefs reads no price source": (src) => !PRICE_READS.test(src),
  // NARROWED FOR NEWS_TECH (PR 2): the module may take its technical history from
  // newsTechHistory (gated, history only), never the pool or the hero price. The
  // AI calls it makes are non-price by allow-list (check-news-ai-inputs).
  "the news data module never sees the Tiingo hero price": (src) =>
    !/readTiingoPool|readSurfacePrice|readSurfaceInputs|tiingoSurfacePrice|marketData\/read/.test(src),
  "news tech: the Tiingo history only through the NEWS_TECH gate, Yahoo kept as the fallback": (src) =>
    /import \{ readNewsTechHistory \} from "\.\/server\/newsTechHistory";/.test(src) &&
    /const tiingo = await readNewsTechHistory\(symbol\);\s*if \(tiingo\) return \{ points: tiingo, source: "tiingo" \};\s*return \{ points: await fetchYahooHistory\(symbol\), source: "yahoo" \};/.test(src),
  "news tech: the reader is gated and reads only the stored history": (src) =>
    /if \(priceProviderFor\("NEWS_TECH", env\) !== "tiingo"\) return null;/.test(src) &&
    /readTiingoHistory\(/.test(src) && !/readTiingoPool|fetch\(|tiingo\.com/.test(src),
  "news tech: the linked credit, and one source for the technical text": (src) =>
    /historySource === "tiingo" \? \(\s*<p[^>]*>\s*<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/.test(src) &&
    /const technicalPrice = historySource === "tiingo" \? heroPrice\?\.price \?\? lastClose : quote\?\.price \?\? lastClose;/.test(src) &&
    /buildTechnicalRead\(\{ symbol: upper, price: technicalPrice,/.test(src),
  "the AI routes read no price source": (src) => !PRICE_READS.test(src),
  "the news AI components get no hero price": (src) => {
    const blocks = [...src.matchAll(/<(AiInsightCard|WhyThisMatters)\b[\s\S]*?\/>/g)].map((m) => m[0]);
    return blocks.length >= 2 && blocks.every((b) => !/heroPrice|readSurfacePrice|TIINGO/.test(b));
  },
  // 2. gates and fallbacks
  "SPX: gated, SPY only on the Tiingo path, FMP ^GSPC kept": (src) =>
    /priceProviderFor\("SPX"\) === "tiingo"/.test(src) && /readTiingoHistory\("SPY"\)/.test(src) &&
    /getDailyHistory\("\^GSPC"/.test(src) && !/readTiingoHistory\("\^GSPC"\)/.test(src),
  "videos: gated, FMP path kept after a Tiingo miss": (src) =>
    /priceProviderFor\("VIDEOS"\) === "tiingo"/.test(src) && /if \(tiingo\) return tiingo;/.test(src) &&
    /fetchQuoteSnapshotForRender\(/.test(src),
  "videos: market cap and P/E through A's modules, not copied": (src) =>
    /from "@\/lib\/server\/secValuation"/.test(src) && /marketCap\(valuation, surface\.price\)/.test(src) &&
    /peRatio\(valuation, surface\.price\)/.test(src) && /getStockPageSecFacts\(/.test(src),
  "news hero: gated, and the FMP title reads skipped only when Tiingo answered": (src) =>
    /priceProviderFor\("NEWS_HERO"\) !== "tiingo"\) return null/.test(src) &&
    /const hero = await readNewsHeroPrice\(symbol\);\s*if \(hero\) return \{[^}]*source: "tiingo" \}/.test(src) &&
    /source === "tiingo"\s*\?\s*\[\]\s*:\s*await getDailyHistory\(/.test(src) &&
    /titlePrice = source === "tiingo" \? price : seed\.lastClose/.test(src),
  // 4. credit
  "SPX: the linked credit under the chart": (src) => /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/.test(src),
  "video page: the linked credit with the label": (src) =>
    /stockData\?\.priceLabel/.test(src) && /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/.test(src),
  "news hero: the label and the linked credit": (src) =>
    /\{heroPrice\.label\}/.test(src) && /<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/.test(src),
  // 5. SPY says so
  "SPX: the approved caption, shown only for SPY": (src) =>
    /chartSeries === "SPY" \?/.test(src) &&
    src.includes("Chart shows the SPDR S&amp;P 500 ETF (SPY). Levels quoted in the text refer to the S&amp;P 500 index."),
  "SPX chart: the symbol is passed through, not fixed to SPX": (src) => /symbol=\{symbol\}/.test(src) && !/symbol="SPX"/.test(src),
  // 6. PR 2 video items (#563 COWORK #33/#34, #553 COWORK #88)
  "videos: the IFX -> IFNNY remap applies on the Tiingo path too": (src) =>
    /IFX: "IFNNY"/.test(src) && /const symbol = TICKER_REMAP\[upper\] \?\? upper;/.test(src) &&
    /readSurfaceInputs\(symbol\)/.test(src) && /getStockPageSecFacts\(symbol\)/.test(src),
  "videos: the sector is A's resolver, SEC-only, imported": (src) =>
    /import \{ resolveProfile \} from "@\/lib\/server\/staticProfile";/.test(src) && /sector: resolveProfile\(symbol, null\)\.sector,/.test(src),
  "videos: an MA tile with a price but too few closes says why": (src) =>
    /export const SHORT_HISTORY_NOTE = "Not enough price history stored yet";/.test(src) &&
    /ma50Note: ma50 === null \? SHORT_HISTORY_NOTE : null/.test(src) && /ma200Note: ma200 === null \? SHORT_HISTORY_NOTE : null/.test(src),
  // 7. PR 2 follow-ups (#563 COWORK #45)
  "videos: a withheld market cap says why, in A's words": (src) =>
    /import \{ marketCap, peRatio, REFUSAL_WORDS \} from "@\/lib\/server\/secValuation";/.test(src) &&
    /cap && cap\.ok \? null\s*: cap && !cap\.ok \? capitalise\(cap\.detail \?\? REFUSAL_WORDS\[cap\.why\]\)\s*: NO_SEC_SHARE_COUNT_NOTE/.test(src),
  "video page: the cap tile explains its dash, and the caption names the cap rule only when a cap shows": (src) =>
    /label: "Market cap", value: stockData\.marketCap \?\? "—", note: stockData\.marketCap \? null : stockData\.marketCapNote \?\? null/.test(src) &&
    /\{stockData\.marketCap \? " Market cap is the SEC cover-page share count times that price\." : null\}/.test(src) &&
    !/\. Market cap is the SEC cover-page share count times that price\. Figures/.test(src),
  "video page: the tile notes open on tap, keyboard and hover (A's ReasonedValue)": (src) =>
    /note: stockData\.ma50Note/.test(src) && /note: stockData\.ma200Note/.test(src) && /import \{ ReasonedValue \} from "@\/app\/components\/EstimatedValue";/.test(src) &&
    /<ReasonedValue text=\{value\} reason=\{note\} \/>/.test(src) && !/title=\{note/.test(src),
  // 8. B13 (#563 COWORK #46): the news price never falls back to Yahoo
  "news data: the quote is FMP only, with no Yahoo quote left": (src) =>
    /async function fetchQuote\(symbol: string\): Promise<Quote \| null> \{\s*return fetchFmpQuote\(symbol\);\s*\}/.test(src) &&
    !/fetchYahooQuote|meta\.regularMarketPrice/.test(src),
  "news hero: Tiingo, then FMP, then a hedged no-price state, never a stored close": (src) =>
    /\{heroPrice \? \(/.test(src) && /\) : quote\?\.price != null \? \(/.test(src) &&
    /\{NEWS_HERO_NO_PRICE\}/.test(src) && /const NEWS_HERO_NO_PRICE = "Price not available right now";/.test(src) &&
    !/formatMoney\(quote\?\.price \?\? lastClose\)/.test(src) && !/DATA UNAVAILABLE/.test(src),
};
const sourceOf = {
  "ai-market reads no price and takes no price argument": FILES.aiMarket,
  "ai-news-briefs reads no price source": FILES.aiNews,
  "the news data module never sees the Tiingo hero price": FILES.newsData,
  "news tech: the Tiingo history only through the NEWS_TECH gate, Yahoo kept as the fallback": FILES.newsData,
  "news tech: the reader is gated and reads only the stored history": FILES.newsTech,
  "news tech: the linked credit, and one source for the technical text": FILES.news,
  "the AI routes read no price source": [FILES.insightRoute, FILES.whyRoute],
  "the news AI components get no hero price": FILES.news,
  "SPX: gated, SPY only on the Tiingo path, FMP ^GSPC kept": FILES.spx,
  "videos: gated, FMP path kept after a Tiingo miss": FILES.video,
  "videos: market cap and P/E through A's modules, not copied": FILES.video,
  "news hero: gated, and the FMP title reads skipped only when Tiingo answered": FILES.news,
  "SPX: the linked credit under the chart": FILES.spx,
  "video page: the linked credit with the label": FILES.videoPage,
  "news hero: the label and the linked credit": FILES.news,
  "SPX: the approved caption, shown only for SPY": FILES.spx,
  "SPX chart: the symbol is passed through, not fixed to SPX": FILES.spxChart,
  "videos: the IFX -> IFNNY remap applies on the Tiingo path too": FILES.video,
  "videos: the sector is A's resolver, SEC-only, imported": FILES.video,
  "videos: an MA tile with a price but too few closes says why": FILES.video,
  "video page: the tile notes open on tap, keyboard and hover (A's ReasonedValue)": FILES.videoPage,
  "videos: a withheld market cap says why, in A's words": FILES.video,
  "video page: the cap tile explains its dash, and the caption names the cap rule only when a cap shows": FILES.videoPage,
  "news data: the quote is FMP only, with no Yahoo quote left": FILES.newsData,
  "news hero: Tiingo, then FMP, then a hedged no-price state, never a stored close": FILES.news,
};
const srcFor = (name) => [sourceOf[name]].flat().map((f) => (name.includes("caption") ? raw(f) : code(f))).join("\n");

console.log("\n=== 2-4. AI isolation, gates and fallbacks, the credit and the caption ===\n");
for (const [name, rule] of Object.entries(rules)) check(name, rule(srcFor(name)));

// ── 5. Every static rule bites ────────────────────────────────────────────
console.log("\n=== 5. Mutants: each must FAIL its rule ===\n");
const mutants = [
  ["ai-market reads no price and takes no price argument", (s) => s.replace("_timeBucket?: number", "lastClose: number")],
  ["ai-market reads no price and takes no price argument", (s) => `import { readTiingoHistory } from "@/lib/server/marketData/read";\n${s}`],
  ["ai-news-briefs reads no price source", (s) => `import { readSurfacePrice } from "@/lib/server/tiingoSurfacePrice";\n${s}`],
  ["the news data module never sees the Tiingo hero price", (s) => `import { readTiingoPool } from "@/lib/server/marketData/read";\n${s}`],
  ["the news data module never sees the Tiingo hero price", (s) => `import { readSurfacePrice } from "@/lib/server/tiingoSurfacePrice";\n${s}`],
  ["news tech: the Tiingo history only through the NEWS_TECH gate, Yahoo kept as the fallback", (s) => s.replace('return { points: await fetchYahooHistory(symbol), source: "yahoo" };', 'return { points: [], source: "yahoo" };')],
  ["news tech: the reader is gated and reads only the stored history", (s) => s.replace('if (priceProviderFor("NEWS_TECH", env) !== "tiingo") return null;', "")],
  ["news tech: the linked credit, and one source for the technical text", (s) => s.replace("price: technicalPrice,", "price: quote?.price ?? lastClose,")],
  ["news tech: the linked credit, and one source for the technical text", (s) => s.replace(/historySource === "tiingo" \? \(\s*<p([^>]*)>\s*<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/, 'historySource === "tiingo" ? (<p$1>{TIINGO_CREDIT}')],
  ["the AI routes read no price source", (s) => `${s}\nconst p = getDailyHistory("X");`],
  ["the news AI components get no hero price", (s) => s.replace("<AiInsightCard", "<AiInsightCard heroPrice={heroPrice}")],
  ["SPX: gated, SPY only on the Tiingo path, FMP ^GSPC kept", (s) => s.replace('priceProviderFor("SPX") === "tiingo"', "true")],
  ["SPX: gated, SPY only on the Tiingo path, FMP ^GSPC kept", (s) => s.replace('getDailyHistory("^GSPC"', 'getDailyHistory("SPY"')],
  ["videos: gated, FMP path kept after a Tiingo miss", (s) => s.replace("if (tiingo) return tiingo;", "return tiingo;")],
  ["videos: market cap and P/E through A's modules, not copied", (s) => s.replace("peRatio(valuation, surface.price)", "surface.price / 20")],
  ["news hero: gated, and the FMP title reads skipped only when Tiingo answered", (s) => s.replace('priceProviderFor("NEWS_HERO") !== "tiingo") return null', "false) return null")],
  ["SPX: the linked credit under the chart", (s) => s.replace("<a href={TIINGO_URL}", "<span data-href={TIINGO_URL}")],
  ["video page: the linked credit with the label", (s) => s.replace(/<a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a>/, "{TIINGO_CREDIT}")],
  ["news hero: the label and the linked credit", (s) => s.replace("{heroPrice.label}", "")],
  ["SPX: the approved caption, shown only for SPY", (s) => s.replace("Levels quoted in the text refer to the S&amp;P 500 index.", "")],
  ["SPX chart: the symbol is passed through, not fixed to SPX", (s) => s.replace("symbol={symbol}", 'symbol="SPX"')],
  ["videos: the IFX -> IFNNY remap applies on the Tiingo path too", (s) => s.replace("readSurfaceInputs(symbol)", "readSurfaceInputs(upper)")],
  ["videos: the sector is A's resolver, SEC-only, imported", (s) => s.replace("sector: resolveProfile(symbol, null).sector,", "sector: null,")],
  ["videos: an MA tile with a price but too few closes says why", (s) => s.replace("ma200Note: ma200 === null ? SHORT_HISTORY_NOTE : null", "ma200Note: null")],
  ["video page: the tile notes open on tap, keyboard and hover (A's ReasonedValue)", (s) => s.replace("<ReasonedValue text={value} reason={note} />", "{value}")],
  ["video page: the tile notes open on tap, keyboard and hover (A's ReasonedValue)", (s) => s.replace("<ReasonedValue text={value} reason={note} />", "<span title={note ?? undefined}>{value}</span>")],
  ["videos: a withheld market cap says why, in A's words", (s) => s.replace("capitalise(cap.detail ?? REFUSAL_WORDS[cap.why])", "null")],
  ["video page: the cap tile explains its dash, and the caption names the cap rule only when a cap shows", (s) => s.replace(", note: stockData.marketCap ? null : stockData.marketCapNote ?? null", "")],
  ["video page: the cap tile explains its dash, and the caption names the cap rule only when a cap shows", (s) => s.replace('{stockData.marketCap ? " Market cap is the SEC cover-page share count times that price." : null}', " Market cap is the SEC cover-page share count times that price.")],
  ["news data: the quote is FMP only, with no Yahoo quote left", (s) => s.replace("  return fetchFmpQuote(symbol);\n}", "  return (await fetchFmpQuote(symbol)) ?? fetchYahooQuote(symbol);\n}")],
  ["news hero: Tiingo, then FMP, then a hedged no-price state, never a stored close", (s) => s.replace("<div style={heroMetricValueStyle}>{formatMoney(quote.price)}</div>", "<div style={heroMetricValueStyle}>{formatMoney(quote?.price ?? lastClose)}</div>")],
  ["news hero: Tiingo, then FMP, then a hedged no-price state, never a stored close", (s) => s.replace("{NEWS_HERO_NO_PRICE}</div>", "{formatMoney(lastClose)}</div>")],
];
for (const [name, mutate] of mutants) {
  const before = srcFor(name);
  const after = mutate(before);
  check(`mutant bites: ${name}`, after !== before && !rules[name](after), after === before ? "the mutation did not apply" : "");
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
