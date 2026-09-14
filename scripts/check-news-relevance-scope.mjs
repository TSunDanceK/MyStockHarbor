// The relevance set the feed computes over, and the scope it is asked for.
//
//   node scripts/check-news-relevance-scope.mjs
//
// ── THE OUTAGE THIS EXISTS FOR ────────────────────────────────────────────
// /stock/FAST/news rendered TWO cards, both five weeks old, above a score
// panel that counted "8 of 14 headlines from the last 14 days". A 14-day
// window cannot legitimately return more than a 45-day one over the same data,
// so the two paths were reading different sets. They were:
//
//   scoreNews  ->  rankNews(news)                      -> every stored item
//   the feed   ->  rankNews(news, upper, companyName)  -> a filtered subset
//
// and the filter was an EXCLUSIVE branch: if any item was symbol-confirmed,
// only those survived. `articleMatchesRequestedSymbol` reads fmpSymbolMatched
// and fmpSymbols, which ONLY fmpProvider writes — so after the provider flip
// the branch selected exactly the pre-flip records still in the store and
// discarded the entire free-stack feed.
//
// ── WHAT IS AT RISK NOW, and each of these is silent ───────────────────────
//   1. THE BRANCH COMES BACK, as a filter or as a sort key. Promoting on
//      fmpSymbolMatched today would promote STALENESS — nothing live writes it,
//      so everything carrying it predates the flip. The field must stay INERT
//      until a live adapter stamps it.
//   2. A FREE ADAPTER STARTS STAMPING IT. That is not a regression, it is the
//      condition under which promotion becomes safe again — so this file fails
//      then too, pointing the other way. The tripwire is deliberately two-sided.
//   3. MARKET SCOPE BECOMES REACHABLE BY OMISSION AGAIN. A default argument is
//      how a stock page silently acquired it.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── THE REAL MODULE, WITH ITS IMPORTS STUBBED ─────────────────────────────
// rankNews reaches scoreNewsItem, dedupeNews, titleTokens and keywordHits, all
// in this file, so extracting it by hand would mean transcribing a chain — and
// a transcription is a second implementation that can disagree with the first.
// Every import is replaced by an inert stub instead: nothing rankNews touches
// comes from one, so the stubs are never called and the code under test is the
// real code.
const raw = read("lib/stock-news-data.ts");
const importLines = [...raw.matchAll(/^import\s+(?:type\s+)?(?:\{([^}]*)\}|(\w+))[^;]*?from\s+"[^"]+";$/gm)];
let src = raw;
for (const m of importLines) {
  const names = (m[1] ?? m[2] ?? "")
    .split(",")
    .map((n) => n.trim().split(/\s+as\s+/).pop().trim())
    .filter((n) => n && /^[A-Za-z_$][\w$]*$/.test(n));
  const stub = names.map((n) => `const ${n} = (() => {});`).join(" ");
  src = src.replace(m[0], stub || "");
}
src += "\nexport { rankNews, isClearlyAboutRequestedCompany, articleMatchesRequestedSymbol, companyNameVariants, getCleanCompanyName };\n";
if (/^import /m.test(src)) {
  console.error("FAIL: an import survived stubbing:\n" +
    src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
// POSITIVE MARKER: a substitution that stops matching must be loud.
if (!src.includes("function rankNews(news, scope)") && !src.includes("function rankNews(")) {
  console.error("FAIL: rankNews was not found after stubbing.");
  process.exit(1);
}
const file = path.join(ROOT, ".check-relevance-scope.mjs");
fs.writeFileSync(file, ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let mod;
try { mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
finally { fs.unlinkSync(file); }

// ── THE FIXTURE: the reported render, in miniature ────────────────────────
// Three headlines the FAST score panel named, plus one legacy FMP-stamped
// record of the kind still sitting in the store. Real titles, because the
// question is whether the relevance rule keeps them and an invented headline
// would be testing the fixture.
const NAME = "Fastenal Company Common Stock";
const SYMBOL = "FAST";
const FRESH = [
  { title: "All You Need to Know About Fastenal (FAST) Rating Upgrade to Buy",
    link: "https://x/1", source: "zacks.com", pubDate: "2026-09-12T00:00:00Z", provider: "gnews" },
  { title: "Fastenal Co. stock holds gains after double-digit Q2 2026 sales growth",
    link: "https://x/2", source: "ad-hoc-news.de", pubDate: "2026-09-11T00:00:00Z", provider: "gnews" },
  { title: "Is Fastenal (FAST) Fairly Valued As Growth Holds Up But Shares Pull Back?",
    link: "https://x/3", source: "gurufocus.com", pubDate: "2026-09-10T00:00:00Z", provider: "gnews" },
];
const LEGACY = {
  title: "Fastenal: A Dividend Stalwart Worth Holding", link: "https://x/legacy",
  source: "seekingalpha.com", pubDate: "2026-08-05T00:00:00Z", provider: "fmp",
  fmpSymbolMatched: true, fmpSymbols: ["FAST"],
};
const SYMBOL_SCOPE = { kind: "symbol", symbol: SYMBOL, companyName: NAME };

console.log("\n=== 1. THE OUTAGE: one legacy record no longer deletes the feed ===\n");

check(
  "all three reported headlines pass the relevance rule",
  FRESH.every((item) => mod.isClearlyAboutRequestedCompany(item, SYMBOL, NAME)),
  "they were never rejected for relevance — the exclusive branch discarded them"
);
check(
  "the legacy record IS symbol-confirmed, so the fixture reproduces the trigger",
  mod.articleMatchesRequestedSymbol(LEGACY, SYMBOL) &&
    FRESH.every((item) => !mod.articleMatchesRequestedSymbol(item, SYMBOL)),
  "if this ever goes false the test below passes for the wrong reason"
);
check(
  "ranking a mixed list keeps the fresh items",
  (() => {
    const out = mod.rankNews([...FRESH, LEGACY], SYMBOL_SCOPE);
    return out.length === 4 && FRESH.every((f) => out.some((o) => o.link === f.link));
  })(),
  `got ${mod.rankNews([...FRESH, LEGACY], SYMBOL_SCOPE).length} of 4 — ` +
    "before the fix this returned 1: the legacy record alone"
);
check(
  "...and it is not merely that the legacy item was dropped instead",
  mod.rankNews([...FRESH, LEGACY], SYMBOL_SCOPE).some((o) => o.link === LEGACY.link),
  "the old item is still a real article; the bug was exclusivity, not its presence"
);
check(
  "an off-topic item is still rejected — the filter was not loosened",
  (() => {
    const offTopic = { title: "Microsoft beats on cloud revenue", link: "https://x/off",
      source: "reuters.com", pubDate: "2026-09-12T00:00:00Z", provider: "gnews" };
    return !mod.rankNews([...FRESH, offTopic], SYMBOL_SCOPE).some((o) => o.link === offTopic.link);
  })(),
  "the fix must not be reachable by widening"
);
check(
  "a symbol whose feed matches nothing still gets its feed, not a blank page",
  (() => {
    const none = [{ title: "Unrelated market wrap", link: "https://x/n1", source: "x.com",
      pubDate: "2026-09-12T00:00:00Z", provider: "gnews" }];
    return mod.rankNews(none, SYMBOL_SCOPE).length === 1;
  })(),
  "the empty-case fallback is unchanged"
);

console.log("\n=== 1b. A DOTTED NAME MUST MATCH ITS OWN HEADLINE ===\n");

// MEASURED FIRST, then fixed. getCleanCompanyName strips all punctuation, so:
//
//   FAST  -> "fastenal"              SNA -> "snap on incorporated"
//   AOS   -> "a o smith"             SJM -> "the j m smucker"
//
// and both content rules died on the dotted pair. Rule 2 wants the cleaned
// string as a contiguous substring, but the HEADLINE normaliser KEEPS dots, so
// the text says "a.o. smith" and never "a o smith" — the two sides were
// normalised differently and could not meet. Rule 3 wants two words of four or
// more characters and "a o smith" offers one. Only an explicit ticker signal
// was left, which is why "JM Smucker (SJM) Stock" survived and "J.M. Smucker
// Co. cuts outlook" did not.
const NAMES = {
  AOS: "A.O. Smith Corporation Common Stock",
  SJM: "The J.M. Smucker Company Common Stock",
  SNA: "Snap-On Incorporated Common Stock",
  FAST: "Fastenal Company - Common Stock",
};

check(
  "the punctuation-stripped form is still what the OLD rule saw (the premise)",
  mod.getCleanCompanyName(NAMES.AOS) === "a o smith" &&
    mod.getCleanCompanyName(NAMES.SJM).includes("j m smucker"),
  "if this changes, the variants below are solving a problem that moved"
);

// THE SPELLINGS ARE THE REAL ONES. An invented headline would be testing the
// fixture; these are the forms the wire and the financial press actually use.
const REAL = [
  ["AOS", "A. O. Smith Reports Second Quarter 2026 Results", "spaced initials"],
  ["AOS", "AO Smith (AOS) Q2 Earnings Beat Estimates", "initials joined"],
  ["AOS", "A.O. Smith Corp. stock rises after guidance raise", "dotted, as written"],
  ["SJM", "The J. M. Smucker Company Announces Fiscal 2027 Q1 Results", "spaced initials behind a leading The"],
  ["SJM", "J.M. Smucker Co. cuts outlook", "dotted, no ticker anywhere"],
  ["SJM", "JM Smucker (SJM) Stock Moves On Coffee Pricing", "initials joined"],
  ["SNA", "Snap-on Incorporated Reports Q2 2026 Results", "hyphenated"],
  ["SNA", "Snap on Tools parent beats estimates", "hyphen as a space, no ticker"],
  ["FAST", "All You Need to Know About Fastenal (FAST) Rating Upgrade to Buy", "single-word control"],
];
for (const [sym, headline, shape] of REAL) {
  check(
    `${sym}: ${shape}`,
    mod.isClearlyAboutRequestedCompany({ title: headline, source: "" }, sym, NAMES[sym]),
    headline.slice(0, 54)
  );
}

check(
  "an off-topic headline is still rejected for every one of the four",
  Object.entries(NAMES).every(([sym, name]) =>
    !mod.isClearlyAboutRequestedCompany(
      { title: "Microsoft beats on cloud revenue as Azure accelerates", source: "" }, sym, name)),
  "variants must widen the SPELLINGS, not the net"
);
check(
  "a same-sector but different company is still rejected",
  !mod.isClearlyAboutRequestedCompany(
    { title: "Grainger tops estimates on industrial demand", source: "" }, "FAST", NAMES.FAST) &&
  !mod.isClearlyAboutRequestedCompany(
    { title: "Rheem raises water heater prices", source: "" }, "AOS", NAMES.AOS),
  "the nearest miss matters more than an obvious one"
);

console.log("\n  -- the guard that was NOT lowered --\n");

check(
  "every variant is at least 4 characters",
  Object.values(NAMES).every((name) =>
    mod.companyNameVariants(name).every((v) => v.length >= 4)),
  "lowering the minimum token length would let 'a' and 'o' match half the market — " +
    "the same failure one level down, which is why the NAME was varied instead"
);
check(
  "a name that is nothing but initials yields no usable variant",
  mod.companyNameVariants("A.B. Inc").every((v) => v.length >= 4),
  "there is no name left to match on, and a 2-character substring would match everywhere"
);
check(
  "the single-word case is unchanged — one variant, not a widened set",
  JSON.stringify(mod.companyNameVariants(NAMES.FAST)) === '["fastenal"]',
  "FAST was already healthy and must not move"
);
check(
  "a leading 'The' is dropped from the variants, not from the headline",
  mod.companyNameVariants(NAMES.SJM).every((v) => !v.startsWith("the ")),
  "substring matching handles its presence in the text; carrying it in the needle breaks every match"
);
check(
  "both dotted spellings AND the joined one are generated",
  (() => {
    const v = mod.companyNameVariants(NAMES.AOS);
    return v.includes("a.o. smith") && v.includes("ao smith") && v.includes("a. o. smith");
  })(),
  "headlines use all three and a single canonical form cannot meet them"
);
check(
  "hyphens vary too — 'snap-on', 'snap on', 'snapon'",
  (() => {
    const v = mod.companyNameVariants(NAMES.SNA);
    return v.includes("snap-on") && v.includes("snap on") && v.includes("snapon");
  })(),
  "'incorporated' is stripped as a legal form, which is what leaves a name short enough to vary"
);

console.log("\n=== 2. THE FIELD STAYS INERT WHILE NOTHING LIVE WRITES IT ===\n");

const rankSource = (() => {
  const code = readCodeOnly("lib/stock-news-data.ts");
  const i = code.indexOf("function rankNews(");
  return code.slice(i, code.indexOf("\n}", i));
})();
check(
  "the harness is reading rankNews and not an empty slice (positive control)",
  rankSource.length > 200 && /relevantNews/.test(rankSource),
  `${rankSource.length} chars`
);
check(
  "rankNews does not branch or sort on articleMatchesRequestedSymbol",
  !/articleMatchesRequestedSymbol/.test(rankSource),
  "promoting on fmpSymbolMatched today would promote STALENESS — nothing live writes it, " +
    "so everything carrying it predates the flip by construction"
);
check(
  "...and does not reach the fields directly either",
  !/fmpSymbolMatched|fmpSymbols/.test(rankSource),
  "the rule is about the field, not about one helper's name"
);
check(
  "the membership rule still admits symbol-confirmed items via the relevance check",
  /isClearlyAboutRequestedCompany/.test(rankSource) &&
    /articleMatchesRequestedSymbol/.test(readCodeOnly("lib/stock-news-data.ts")),
  "confirmed ⊆ text-relevant, because isClearlyAboutRequestedCompany returns true for them " +
    "on its first line — removing the branch removed no members"
);

// THE TWO-SIDED TRIPWIRE. A free adapter stamping the field is not a
// regression: it is the condition that makes promotion safe again. This fails
// then as well, and says so.
const FREE_ADAPTERS = ["gnewsProvider", "wireProvider", "secProvider"];
const stampers = FREE_ADAPTERS.filter((name) => {
  const code = readCodeOnly(`lib/server/news/${name}.ts`);
  return /fmpSymbolMatched\s*:/.test(code) || /fmpSymbols\s*:/.test(code);
});
check(
  "no ACTIVE adapter stamps fmpSymbolMatched / fmpSymbols",
  stampers.length === 0,
  stampers.length
    ? `${stampers.join(", ")} now stamps it — that is not a bug, it is the condition under ` +
      "which promotion becomes safe. Reconsider the inert branch in rankNews, and see " +
      "claude/traps/a-preference-that-filters.md before turning it back on as a FILTER."
    : "so the field is a fossil and must not order anything"
);
check(
  "...and fmpProvider still does, so the tripwire is measuring something",
  /fmpSymbolMatched:/.test(readCodeOnly("lib/server/news/fmpProvider.ts")),
  "if nothing writes it anywhere, the check above is vacuous"
);

console.log("\n=== 3. SCOPE IS ASKED FOR, NEVER FALLEN INTO ===\n");

const code = readCodeOnly("lib/stock-news-data.ts");
check(
  "rankNews takes an explicit scope with no default",
  /function rankNews\(news: NewsItem\[\], scope: NewsScope\)/.test(code) &&
    !/function rankNews\([^)]*=\s*""/.test(code),
  "a default argument is how the stock page acquired market scope by forgetting two of them"
);
check(
  "the stock page asks for SYMBOL scope, naming both parts",
  /rankNews\(news, \{ kind: "symbol", symbol: upper, companyName \}\)/.test(code),
  "the feed is about one company"
);
check(
  "scoreNews asks for MARKET scope explicitly",
  /rankNews\(news, MARKET_NEWS_SCOPE\)/.test(code),
  "this is the second half of the divergence, deliberately unchanged and filed separately — " +
    "the explicit argument is what stops it being invisible while it waits"
);
check(
  "both scopes remain expressible — the no-symbol path is legitimate",
  /kind: "market"/.test(code) && /kind: "symbol"/.test(code),
  "lib/sector-news-data.ts has no symbol to be about; the defect was reachability, not existence"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
