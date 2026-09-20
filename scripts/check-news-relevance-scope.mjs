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
import { anchoredNameSignalMirror } from "./lib/anchored-name-signal.mjs";

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
src += "\nexport { rankNews, isClearlyAboutRequestedCompany, articleMatchesRequestedSymbol, companyNameVariants, getCleanCompanyName, anchoredNameSignal };\n";
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

console.log("\n  -- the anchored fallback for names too short to be a needle --\n");

// 66 of the 2,610 committed names produce NO variant once cleanName has run
// over them: every candidate is under the guard, `.some()` on an empty array is
// false by construction, and only an explicit ticker signal can match. Most are
// names that ARE their ticker (CSX, RTX, KKR, LKQ, EQT, XPO, PVH …); the rest
// are short but different — 3M/MMM, HP/HPQ, F5/FFIV, KLA/KLAC.
//
// THE COUNT WAS 55 IN AN EARLIER PASS, and the difference is the normaliser,
// not the population: 55 counted the RAW directory names in
// data/company-names.json ("Dow Inc. Common Stock"), 66 counts them after
// cleanName strips the instrument suffix, which is the form the live path
// actually hands to the matcher. 66 is the number that describes production.
//
// MMM was the confirmed live case: 88 items fetched, 2 cards, both carrying a
// literal "(MMM)".
const SHORT = {
  MMM: "3M Company Common Stock",
  CSX: "CSX Corporation - Common Stock",
  DOW: "Dow Inc. Common Stock",
  BOX: "Box, Inc. Class A Common Stock",
  RH: "RH Common Stock",
  VFC: "V.F. Corporation Common Stock",
  T: "AT&T Inc.",
  GAP: "Gap, Inc. Common Stock",
};
const about = (sym, title) =>
  mod.isClearlyAboutRequestedCompany({ title, description: "", source: "" }, sym, SHORT[sym]);

check(
  "MMM matches its own headlines — the live case",
  about("MMM", "3M Company Reports Second Quarter 2026 Results") &&
    about("MMM", "3M raises full-year guidance"),
  "the company is spelled 3M and the ticker is MMM: they share no characters, " +
    "so no ticker signal and no substring needle could reach it"
);
check(
  "VFC matches 'V.F. Corporation' — the punctuated form is carried too",
  about("VFC", "V.F. Corporation Reports Second Quarter Results"),
  "its alphanumerics are VF, and \\bVF\\b does not match the text 'V.F.' — the " +
    "letters are not adjacent there"
);
check(
  "...and 'Roe v. Ford' still does not match VFC",
  !about("VFC", "Roe v. Ford settled out of court"),
  "this is the exact string the old four-character needle matched"
);
check(
  "T matches AT&T and not ordinary English",
  about("T", "AT&T adds 400,000 wireless subscribers") &&
    !about("T", "what the market did today, flat tires and all"),
  "the old needle was 'at t', which matches 'what the', 'that time', 'flat tire'"
);

// CASING IS THE DISCRIMINATOR, AND IT COMES FROM THE DATA. No list: the
// company's own name says which shape to demand, so "CSX Corporation" requires
// caps and "Dow Inc." requires a capitalised word.
for (const [sym, title, want, why] of [
  ["CSX", "CSX Corporation reports record intermodal volume", true, "all-caps name, all-caps in the headline"],
  ["CSX", "the csx line was closed for maintenance", false, "lowercase prose must not trip an all-caps name"],
  // DOW WAS HERE, EXPECTING true, AND THE MEASUREMENT RETIRED IT. The row read
  // ["DOW", "Dow Inc. beats on packaging demand", true, ...] and it was a fair
  // test of the rule as designed — a capitalised name, capitalised in the
  // headline. It is now the COST of INDEX_TOKENS, restated rather than deleted:
  // a real Dow Inc. headline with no ticker in it is one of the 6 genuine items
  // the index rejection gives up to remove 57 index stories. GAP keeps the shape
  // the row was testing, so the property has not quietly stopped being tested.
  ["DOW", "Dow Inc. beats on packaging demand", false, "the cost of the index rule: 6 real items, priced against 57"],
  ["GAP", "Gap, Inc. raises its full-year outlook", true, "capitalised name, capitalised in the headline — the shape DOW used to carry"],
  ["DOW", "shares were flat as the market closed down", false, "no capitalised Dow anywhere"],
  ["BOX", "Box, Inc. raises subscription outlook", true, "capitalised"],
  ["BOX", "he opened the box and found nothing", false, "the common noun is lowercase"],
  ["RH", "RH reports weaker demand for luxury furnishings", true, "two letters, but anchored and capitalised"],
  ["RH", "growth slowed through the quarter", false, "'rh' inside 'growth' — the substring failure this avoids"],
]) {
  check(`${sym}: ${why}`, about(sym, title) === want, title.slice(0, 50));
}

check(
  "the anchored rule is STRICTLY ADDITIVE — it cannot fire where variants exist",
  (() => {
    // Reached only when companyNameVariants returned nothing, so no symbol that
    // matches today can change behaviour. Structural, because the guard is a
    // control-flow fact rather than an output one.
    const code = readCodeOnly("lib/stock-news-data.ts");
    return /if \(!variants\.length\) \{[\s\S]{0,240}?anchoredNameSignal\(companyName\)/.test(code);
  })(),
  "a fallback that could override a working rule is not a fallback"
);
check(
  "...and the long names are unmoved",
  (() => {
    const N = {
      FAST: "Fastenal Company - Common Stock",
      AOS: "A.O. Smith Corporation Common Stock",
      SNA: "Snap-On Incorporated Common Stock",
    };
    return mod.isClearlyAboutRequestedCompany(
        { title: "All You Need to Know About Fastenal (FAST) Rating Upgrade", description: "", source: "" }, "FAST", N.FAST) &&
      mod.isClearlyAboutRequestedCompany(
        { title: "A. O. Smith Reports Second Quarter 2026 Results", description: "", source: "" }, "AOS", N.AOS) &&
      mod.isClearlyAboutRequestedCompany(
        { title: "Snap on Tools parent beats estimates", description: "", source: "" }, "SNA", N.SNA);
  })()
);
check(
  "a long FIRST TOKEN yields no anchored needle",
  (() => {
    // THIS ASSERTION FIRST CLAIMED "a name long enough for a variant gets NO
    // anchored needle" AND FAILED, correctly. "A.O. Smith" has usable variants
    // yet its first token "A.O." is two alphanumerics, so the builder does
    // return a needle for it.
    //
    // That is not a defect: the fallback-only property lives at the CALL SITE,
    // which gates on `!variants.length` and is asserted separately above. The
    // builder is a needle factory and knows nothing about variants. The
    // assertion was claiming a guarantee the function does not make — the same
    // error as the "no usable variant" one this pass is here to fix.
    return mod.anchoredNameSignal("Fastenal Company - Common Stock") === null &&
      mod.anchoredNameSignal("Microsoft Corporation Common Stock") === null;
  })(),
  "five or more alphanumerics means companyNameVariants already has a substring needle"
);
check(
  "the needle is ANCHORED — an uppercase substring inside a longer word is not a match",
  (() => {
    // Removing the word boundaries survived every other probe, because the
    // case-sensitivity alone rejects lowercase prose. The property only shows
    // when the letters appear UPPERCASE inside a longer all-caps token, which
    // is common in headlines.
    //
    //   NATO     contains AT   -> must not match T
    //   OVERHAUL contains RH   -> must not match RH
    return !about("T", "NATO SUMMIT OPENS IN BRUSSELS") &&
      !about("RH", "AIRLINE ANNOUNCES FLEET OVERHAUL");
  })(),
  "an unanchored two-letter needle matches a large share of ordinary all-caps text"
);
check(
  "a one-character name yields no needle",
  mod.anchoredNameSignal("X Corporation Common Stock") === null &&
    mod.anchoredNameSignal("Z Inc.") === null,
  "a single letter is not a name, and \\bX\\b appears in ordinary text constantly"
);
check(
  "a lowercase token yields no needle",
  mod.anchoredNameSignal("acme common stock") === null,
  "anchoring a lowercase word is the substring problem again with extra steps"
);

console.log("\n  -- the probe\'s mirror cannot drift from the real function --\n");

// THE RELAY'S READ-ONLY JOB RUNS NO `npm ci` ON PURPOSE — "not installing the
// Upstash client keeps the job unable to reach the database even if a future
// edit tried to". That is an isolation guarantee, so the probe cannot load the
// TypeScript function and carries a mirror instead. Adding `npm ci` to buy the
// ── THE INDEX-NAME REJECTION, AND WHAT IT MUST NOT ALSO REJECT ───────────
// Relay runs 77 and 78 measured the anchored fallback's MARGINAL set -- the
// items it adds on top of the explicit ticker signals -- across ten real pools.
// \bDow\b scored 10% (57 of 63 added items were index copy) against a floor of
// 68% for every other name. That is the gap INDEX_TOKENS closes.
//
// THE DANGER IN THIS FIX IS OVER-REACH, not under-reach: a rule that also swept
// up Box, Gap, Aon or Fox would delete 195 measured-good items to remove 57 bad
// ones. Three of these assertions exist to fail if it starts doing that.
console.log("\n  -- the index-name rejection --\n");
{
  check(
    "a market-index name yields NO anchored needle",
    mod.anchoredNameSignal("Dow Inc.") === null,
    "measured: 57 of the 63 items \\bDow\\b added were the DJIA, its members or S&P Dow Jones Indices"
  );
  // THE OTHER HALF, and it is the one that matters. Rejecting DOW is easy;
  // rejecting DOW WITHOUT rejecting the names that measured clean is the fix.
  const stillAnchored = ["Box, Inc.", "Gap, Inc.", "Aon plc", "Fox Corporation",
                         "CSX Corporation", "RTX Corporation", "NOV Inc.", "AT&T Inc.", "RH"];
  const lost = stillAnchored.filter((n) => mod.anchoredNameSignal(n) === null);
  check(
    "...and every OTHER measured name keeps its needle",
    lost.length === 0,
    lost.length
      ? `${lost.join(", ")} lost theirs — Box measured 68%, Gap 70%, Fox 92%, Aon 100%`
      : `${stillAnchored.length} names unaffected, including the two common words kept on purpose`
  );
  // DOW IS NOT BLANKED. The explicit ticker signals matched 26 of its 89 items
  // with the anchor switched off; this is one of them, verbatim from the pool.
  check(
    "DOW still matches its own news through the explicit ticker signals",
    mod.isClearlyAboutRequestedCompany(
      { title: "Dow Inc. (DOW) Stock Sinks As Market Gains: Here's Why", description: "" },
      "DOW", "Dow Inc."
    ),
    "removing the needle must not take the company's real coverage with it"
  );
  // ...and the item the fix exists to drop, also verbatim from the pool.
  check(
    "...while the index copy the needle was admitting is now refused",
    !mod.isClearlyAboutRequestedCompany(
      { title: "Dow Jones Industrial Average loses another round to rising bond yields", description: "" },
      "DOW", "Dow Inc."
    ),
    "this headline is about no company at all"
  );
  // A MUTATION GUARD. Emptying INDEX_TOKENS, or misspelling the membership
  // test, restores the old behaviour silently -- the checker above would still
  // pass on the "other names keep their needle" half. This one would not.
  check(
    "the rejection is keyed on the TOKEN, not on the symbol",
    mod.anchoredNameSignal("Dow Chemical") === null &&
      mod.anchoredNameSignal("Nasdaq Co.") === null,
    "no ticker is in scope here — anchoredNameSignal never sees one"
  );
  check(
    "...and a name that merely CONTAINS an index word keeps its needle",
    mod.anchoredNameSignal("Fox Corporation") !== null &&
      mod.anchoredNameSignal("SPY Inc.") !== null,
    "the test is on the first token, not a substring sweep"
  );
}

// import would trade the guarantee for convenience.
//
// The duplication is therefore CHECKED rather than trusted: identical patterns
// for every name the probe measures, plus the shapes that define the rule.
{
  const PROBE_NAMES = [
    "Dow Inc.", "AT&T Inc.", "NOV Inc.", "Box, Inc.", "RH",
    "CSX Corporation", "RTX Corporation",
    // Round 2's names. "Aon plc" and "Fox Corporation" are the two that killed
    // the "a capitalised-word needle is the dirty shape" generalisation, and
    // "Gap, Inc." is the one it would have swept up wrongly.
    "Aon plc", "Fox Corporation", "Gap, Inc.",
    // and the boundary shapes, so agreement is not only tested where it is easy
    "V.F. Corporation Common Stock", "3M Company Common Stock",
    "Fastenal Company - Common Stock", "A.O. Smith Corporation Common Stock",
    "X Corporation Common Stock", "acme common stock",
    // FIVE- AND SIX-CHARACTER FIRST TOKENS, which is where the upper bound
    // lives. Without one of these a mutation moving the bound from 4 to 6
    // changes no answer in this list and survives.
    "Cisco Systems Inc.", "Chevron Corporation", "Pfizer Inc.",
  ];
  const disagreements = PROBE_NAMES.filter((name) => {
    const real = mod.anchoredNameSignal(name);
    const mirror = anchoredNameSignalMirror(name);
    return String(real) !== String(mirror);
  });
  check(
    "the probe's mirror matches anchoredNameSignal on every name it measures",
    disagreements.length === 0,
    disagreements.length
      ? `${disagreements.join(", ")} — change scripts/lib/anchored-name-signal.mjs to match`
      : `${PROBE_NAMES.length} names agree, including the null cases`
  );
  check(
    "...and the comparison is not vacuous — some of those names DO yield a needle",
    PROBE_NAMES.filter((n) => anchoredNameSignalMirror(n) !== null).length >= 5,
    "if every name returned null the agreement above would be null === null"
  );
  check(
    "the read-only relay job still installs nothing",
    (() => {
      // If this ever gains `npm ci`, the mirror's whole justification is gone —
      // and so is the isolation property that justified it.
      // SLICED ON THE JOB KEYS, not on the word "stateful". The first version
      // cut at wf.indexOf("stateful"), which lands in the header comment on
      // line ~31 — the read-only job body was never examined and an inserted
      // `npm ci` survived the check.
      const wf = fs.readFileSync(".github/workflows/relay.yml", "utf8");
      const start = wf.indexOf("\n  read-only:");
      const end = wf.indexOf("\n  stateful:");
      if (start < 0 || end < 0 || end <= start) return false;
      // MATCHED ON THE DIRECTIVE, NOT THE WORDS. A bare /npm ci/ over that
      // slice is TRUE today, because the job carries a comment that says
      // "# No `npm ci`." — the grep finds the comment explaining the
      // construct's absence and concludes it is present.
      // claude/traps/grep-finds-the-comment-not-the-code.md, landing on the
      // assertion written to protect against exactly this kind of drift.
      const body = wf.slice(start, end)
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      return !/^\s*-\s*run:.*npm ci/m.test(body);
    })(),
    "the mirror exists because of this; if it changes, import the real function instead"
  );
}

console.log("\n  -- the asymmetry, pinned at both ends --\n");

// THE MISMATCH ONLY EXISTS BETWEEN THE TWO FUNCTIONS, which is why it survived
// review of each. Neither class is wrong on its own: the headline keeps `:$.-`
// so the ticker signals can match, and the name strips punctuation so spacing
// does not matter. Read either one alone and nothing looks amiss.
//
// So the COUPLING is pinned rather than left to a comment, and pinned from both
// ends — a checker that only looked at one side would have the same blind spot
// the code had.
{
  const rawSrc = fs.readFileSync("lib/stock-news-data.ts", "utf8");
  check(
    "the NAME normaliser still strips punctuation",
    /function getCleanCompanyName[\s\S]{0,600}?\.replace\(\/\[\^\\w\\s\]\/g, " "\)/.test(rawSrc),
    "if this starts keeping dots, companyNameVariants' dotted forms become the only ones that can match"
  );
  check(
    "...and the HEADLINE normaliser still keeps dots and hyphens",
    /const text = rawText\.replace\(\/\[\^\\w\\s:\$\.-\]\/g, " "\)/.test(rawSrc),
    "if this starts stripping them, the dotted variants stop matching and the ticker signals break too"
  );
  check(
    "both sites say the other exists",
    (() => {
      // A comment at one end only is how the next person rediscovers this from
      // one function, which is exactly what happened the first time.
      const nameSite = rawSrc.slice(rawSrc.indexOf("THIS SIDE STRIPS PUNCTUATION"), rawSrc.indexOf("function getCleanCompanyName"));
      const textSite = rawSrc.slice(rawSrc.indexOf("THIS SIDE KEEPS DOTS"), rawSrc.indexOf("const text = rawText"));
      return /isClearlyAboutRequestedCompany/.test(nameSite) && /companyNameVariants/.test(nameSite) &&
        /getCleanCompanyName/.test(textSite) && /companyNameVariants/.test(textSite);
    })(),
    "each note has to name the other function AND the thing that spans them"
  );
}

console.log("\n  -- the guard that was NOT lowered --\n");

check(
  "every variant is at least 4 characters",
  Object.values(NAMES).every((name) =>
    mod.companyNameVariants(name).every((v) => v.length >= 4)),
  "lowering the minimum token length would let 'a' and 'o' match half the market — " +
    "the same failure one level down, which is why the NAME was varied instead"
);
check(
  "a name that is nothing but initials yields NO variant at all",
  (() => {
    // THIS ASSERTION USED TO CLAIM MORE THAN IT TESTED. Its name said "no
    // usable variant"; its body only checked `.every(v => v.length >= 4)`,
    // which an initials-only name can satisfy — so it passed against code with
    // the property AND against code without it.
    //
    // A real committed row proves it: VFC's "V.F. Corporation Common Stock"
    // produced ["v. f"]. Four characters, so the old guard passed it, and as a
    // substring needle it matches any text where a word ending in v precedes a
    // period and a word starting with f — "Roe v. Ford". The invented "A.B."
    // never exercised that.
    //
    // Now it tests the property the name claims: the list is EMPTY.
    const vfc = mod.companyNameVariants("V.F. Corporation Common Stock");
    const att = mod.companyNameVariants("AT&T Inc.");
    return vfc.length === 0 && att.length === 0;
  })(),
  `VFC -> ${JSON.stringify(mod.companyNameVariants("V.F. Corporation Common Stock"))}, ` +
    `T -> ${JSON.stringify(mod.companyNameVariants("AT&T Inc."))} — both must be []`
);
check(
  "the guard counts ALPHANUMERICS, not characters",
  (() => {
    // "at t" is four characters and three letters; "v. f" is four characters
    // and two. Counting length let both through. assessCompanyName already
    // counts letters on the QUERY side (`letters.length <= 2`), so the two
    // sides now judge a name the same way.
    const code = readCodeOnly("lib/stock-news-data.ts");
    return /\.filter\(\(v\) => v\.replace\(\/\[\^a-z0-9\]\/gi, ""\)\.length >= 4\)/.test(code);
  })(),
  "a needle padded out by dots and spaces is not four characters of evidence"
);
check(
  "...and it is a TIGHTENING — every real name still yields its variants",
  (() => {
    const unchanged = [
      ["Fastenal Company - Common Stock", 1],
      ["A.O. Smith Corporation Common Stock", 4],
      ["Snap-On Incorporated Common Stock", 3],
      ["The J.M. Smucker Company Common Stock", 4],
    ];
    return unchanged.every(([name, n]) => mod.companyNameVariants(name).length === n);
  })(),
  "the fix for the short names must not cost the long ones anything"
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
