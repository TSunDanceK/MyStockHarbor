// Name matching against SEC's `title` — the fallback for when the ticker key
// fails, and the guardrails that make it legitimate rather than guessing.
//
//   node scripts/check-sec-title-match.mjs
//
// ── WHAT IS AT RISK ────────────────────────────────────────────────────────
//   1. A WRONG MATCH BEING APPLIED. The whole design rests on the output being
//      a reviewable candidate list rather than something a pipeline commits. If
//      that ever stops being true, this becomes the text guessing
//      lib/server/news/wireProvider.ts is right to refuse, with a reader on the
//      other end instead of a human reviewer.
//   2. THE MATCHER GETTING LOOSER. Every loosening is invisible: it produces
//      more candidates, which looks like more coverage.
//   3. AMBIGUITY BEING RESOLVED SILENTLY. Two filers at the same top tier is
//      the case where an automatic pick is confidently wrong.
//   4. A FAIL-GREEN PASS. A run that fetched nothing produces "no candidates
//      for anybody", which reads exactly like a real negative result.
import assert from "node:assert";
import ts from "typescript";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { symbolSpellings } from "./lib/symbol-spellings.mjs";
import {
  parseDirectory,
  nameMap,
  stripInstrumentClause,
  NASDAQ_LISTED_URL,
  OTHER_LISTED_URL,
} from "./lib/nasdaq-directory.mjs";
import { scoreNames, rankCandidates, nameTokens, PARTIAL_FLOOR } from "./lib/sec-title-match.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n=== 1. THE THREE CASES THAT ARE KNOWN TRUE ===\n");

// Resolved by hand against SEC's own file. These are the acceptance test: a
// matcher that cannot bridge them is not worth running, and one that needs a
// looser tier than `exact` to bridge them is tuned to its own examples.
const KNOWN = [
  ["MMC", "Marsh & McLennan Companies", "MARSH & MCLENNAN COMPANIES, INC.", "0000062709"],
  ["FI", "Fiserv, Inc.", "FISERV INC", "0000798354"],
  ["BK", "The Bank of New York Mellon Corporation", "Bank of New York Mellon Corp", "0001390777"],
];
for (const [symbol, ours, secTitle] of KNOWN) {
  check(
    `${symbol}: "${ours}" matches SEC's "${secTitle}" at the EXACT tier`,
    scoreNames(ours, secTitle).tier === "exact",
    "if this needs a looser tier, the tier thresholds are fitted to the examples"
  );
}
check(
  "'&' and the word 'and' reduce identically — neither is identifying",
  (() => {
    // NOT "the ampersand handling is what makes MMC work". It is not: a
    // mutation replacing the &->AND expansion with a plain space survived every
    // assertion, because the two are equivalent. The expansion is gone and the
    // real property is asserted instead — both spellings reaching the same
    // tokens, which IS what MMC depends on.
    const amp = nameTokens("Marsh & McLennan Companies").join(",");
    const word = nameTokens("Marsh and McLennan Companies").join(",");
    return amp === "MARSH,MCLENNAN" && word === amp;
  })(),
  `got ${JSON.stringify(nameTokens("Marsh & McLennan Companies"))}`
);

console.log("\n=== 2. IT REJECTS THE THINGS IT MUST REJECT ===\n");

// The floor is not decoration: one shared token between two multi-token names
// is noise, and these are the shapes that produce it.
const MUST_NOT_MATCH = [
  ["American Airlines Group Inc.", "AMERICAN EXPRESS COMPANY", "one shared token — 'American' is not evidence"],
  ["First Republic Bank", "First Solar, Inc.", "'First' is the single most common company-name token there is"],
  ["Webster Financial Corporation", "Western Alliance Bancorporation", "similar-looking, entirely different filers"],
  ["Kellanova", "Kellogg Co", "a rename is NOT a name match; only the filer's record settles it"],
];
for (const [ours, theirs, why] of MUST_NOT_MATCH) {
  const got = scoreNames(ours, theirs);
  check(`"${ours}" does NOT match "${theirs}"`, got.tier === "none", `${why} (got ${got.tier})`);
}
check(
  "an empty or junk name scores nothing rather than matching everything",
  scoreNames("", "FISERV INC").tier === "none" &&
    scoreNames("Inc.", "FISERV INC").tier === "none" &&
    scoreNames(null, "FISERV INC").tier === "none",
  "a name that reduces to no tokens must not become a wildcard"
);

console.log("\n=== 3. THE TIERS MEAN DIFFERENT THINGS, AND STAY DIFFERENT ===\n");

check(
  "a containment is `subset`, not `exact`",
  scoreNames("Fiserv", "Fiserv Solutions Inc").tier === "subset",
  "a parent swallowing a subsidiary has exactly this shape, so it is a candidate and never a conclusion"
);
check(
  "two filers differing ONLY by a structural word are not `exact`",
  (() => {
    // THE PAIR HAS TO DIFFER BY NOTHING ELSE, or the assertion passes for the
    // wrong reason. The first version used "Brookfield Corporation" vs
    // "Brookfield Infrastructure Partners", which also differ by
    // INFRASTRUCTURE — so it would have held even with structural words dropped
    // everywhere, and the mutation that does exactly that survived.
    //
    // "Brookfield Corporation" vs "Brookfield Partners" differ by PARTNERS and
    // nothing else. Drop structural words on both sides and they collapse to
    // {BROOKFIELD} = {BROOKFIELD}: two distinct filers reported as certain.
    const got = scoreNames("Brookfield Corporation", "Brookfield Partners");
    return got.tier !== "exact";
  })(),
  `got ${scoreNames("Brookfield Corporation", "Brookfield Partners").tier} — ` +
    "dropping HOLDINGS/GROUP/PARTNERS on both sides would collapse distinct filers onto one another"
);
check(
  "ONE shared token never reaches `partial`, at any name shape",
  (() => {
    // The `shared >= 2` guard in the matcher is unreachable at the current
    // floor and no mutation can kill it, so the INVARIANT is asserted here
    // instead of the guard. Enumerated rather than sampled: with one token in
    // common and neither side a subset, the union is at least three, so the
    // score cannot exceed 1/3.
    const cases = [
      ["Alpha Systems", "Alpha Networks"],
      ["American Airlines Group", "American Express"],
      ["Pacific Gas Electric", "Pacific Premier"],
      ["Alpha Systems Global", "Alpha Networks Digital"],
    ];
    return cases.every(([a, b]) => {
      const got = scoreNames(a, b);
      return got.shared !== 1 || got.tier !== "partial";
    });
  })(),
  "lowering PARTIAL_FLOOR is a one-character edit and this is what it would let through"
);
check(
  "the partial floor is a real threshold, not 0",
  PARTIAL_FLOOR > 0.5 && PARTIAL_FLOOR <= 1,
  `${PARTIAL_FLOOR}`
);

console.log("\n=== 3b. THE TWO SHAPES THAT DEFEATED A TOKEN FLOOR ===\n");

// RUN 49'S ONLY TWO MATCHABLE SYMBOLS WERE BOTH BANKS, and both scored nothing
// for reasons that were about our tokeniser rather than about SEC.
//
// THESE TITLES ARE HYPOTHESISED, NOT OBSERVED. We do not have SEC's actual
// titles for NBN or TOWN — the whole point of the next run is to get them. So
// what is asserted here is a CAPABILITY: if the title has this shape, the
// matcher now surfaces it as a candidate. Whether it does is for the run to
// say, and these assertions must not be read as a claim that it will.
check(
  "a compound-word spacing difference is caught — 'Towne Bank' vs 'TOWNEBANK'",
  scoreNames("Towne Bank", "TOWNEBANK").tier === "compound",
  "zero shared tokens and score 0 under the old rule: not a weak match, an invisible one"
);
check(
  "...and word ORDER still matters — 'Bank Towne' is not 'TOWNEBANK'",
  scoreNames("Bank Towne", "TOWNEBANK").tier === "none",
  "the first squash sorted the tokens, which broke the very case it was for AND " +
    "would have matched any anagram of the words"
);
check(
  "bank legal forms are FOLDED onto one token — 'Northeast Bank' vs 'NORTHEAST BANCORP'",
  scoreNames("Northeast Bank", "NORTHEAST BANCORP").tier === "exact",
  "1 of 3 shared tokens = 0.33 under the old rule, below the floor"
);
check(
  "folded, NOT dropped — the form token still carries information",
  (() => {
    // Dropping BANK/BANCORP would make bare "Northeast" match either, which
    // throws away a real distinction. Folding keeps the token and only equates
    // its spellings.
    return scoreNames("Northeast", "NORTHEAST BANCORP").tier !== "exact";
  })(),
  "a dropped form word makes every 'X' match every 'X Bank'"
);
check(
  "two filers differing only by bank form now TIE, which sets ambiguous",
  rankCandidates("Summit Bank", [
    { ticker: "AAA", cik: "0000000001", title: "Summit Bancorp" },
    { ticker: "BBB", cik: "0000000002", title: "Summit Bankshares" },
  ]).ambiguous === true,
  "folding is safe precisely BECAUSE two real candidates tie and refuse to confirm"
);
check(
  "the corroborated cases are unmoved by any of this",
  scoreNames("Fiserv, Inc.", "FISERV INC").tier === "exact" &&
    scoreNames("The Bank of New York Mellon Corporation", "Bank of New York Mellon Corp").tier === "exact",
  "BK's name contains 'Bank', so the fold had to be checked against it specifically"
);
check(
  "the fold is confined to BANK spellings — it does not swallow sector words",
  (() => {
    // A mutation widening the alias map to FINANCIAL -> BANK and ALLIANCE ->
    // BANK survived, because the pair I was testing differed by a second token
    // anyway. The property is that a financial-services company and a bank with
    // the same first word must NOT become the same filer.
    return scoreNames("Summit Financial", "Summit Bank").tier !== "exact" &&
      scoreNames("Summit Financial", "Summit Bancorp").tier !== "exact" &&
      scoreNames("Summit Alliance", "Summit Bank").tier !== "exact";
  })(),
  "BANCORP and BANKSHARES are spellings of one legal form; FINANCIAL is a different word"
);
check(
  "an EXACT candidate outranks a COMPOUND one when both are present",
  (() => {
    // Nothing else here has both tiers in the same candidate list, so a
    // mutation swapping their rank survived. Identical tokens is a stricter
    // agreement than same-characters-different-boundary, and must lead.
    const r = rankCandidates("Towne Bank", [
      { ticker: "AAA", cik: "0000000001", title: "TOWNEBANK" },
      { ticker: "BBB", cik: "0000000002", title: "Towne Bank Inc" },
    ]);
    return r.topTier === "exact" && r.candidates[0].cik === "0000000002" &&
      r.candidates[1].tier === "compound";
  })(),
  "both are surfaced — the reviewer sees both — but the stricter one leads"
);
check(
  "and the rejections still reject",
  scoreNames("Webster Financial Corporation", "Western Alliance Bancorporation").tier === "none" &&
    scoreNames("First Bank", "First Solar, Inc.").tier === "none",
  "two banks with different names must not meet just because both are banks"
);

console.log("\n=== 3c. A GENERIC TOKEN NORMALISES; IT NEVER COUNTS ===\n");

// THE FOLD SHIPPED AND IMMEDIATELY MATCHED TWO WRONG COMPANIES. Run 50:
//
//   TOWN "Towne Bank"     -> 0.50  TBBK  "Bancorp, Inc."
//   NBN  "Northeast Bank" -> 0.50  TBBK  "Bancorp, Inc."
//
// TowneBank is not The Bancorp Inc, and that match rested on exactly one shared
// token: the folded BANK. The inverse of the rule learned an hour earlier —
// a token you DROP is a distinction you can no longer make; a token you FOLD
// becomes a token that matches EVERYTHING.
check(
  "a name that is nothing but sector boilerplate matches nobody",
  scoreNames("Towne Bank", "Bancorp, Inc.").tier === "none" &&
    scoreNames("Northeast Bank", "Bancorp, Inc.").tier === "none" &&
    scoreNames("Anything At All", "Bancorp, Inc.").tier === "none",
  '"Bancorp, Inc." reduces to {BANK} and nothing else — there is no name left in it'
);
check(
  "two filers agreeing ONLY on a generic token do not meet",
  scoreNames("Summit Bank", "Pinnacle Bank").tier === "none" &&
    scoreNames("Summit Financial", "Pinnacle Financial").tier === "none",
  "checked before any tier is awarded, including exact"
);
check(
  "...but the fold still does its job where a distinctive token agrees",
  scoreNames("Northeast Bank", "NORTHEAST BANCORP").tier === "exact",
  "NORTHEAST is doing the work; BANK is only making the two spellings comparable"
);
check(
  "a genuinely close pair still surfaces for a human — it is not over-filtered",
  (() => {
    // NBN vs NorthEast Community Bancorp IS ambiguous, and surfacing it is
    // correct: that is what the ambiguous flag and human confirmation are for.
    // Filtering it out would be the opposite error to the one just fixed.
    const got = scoreNames("Northeast Bank", "NorthEast Community Bancorp, Inc./MD/");
    return got.tier !== "none" && got.shared >= 1;
  })(),
  "the fix must reject boilerplate agreement, not reject every hard case"
);
check(
  "the compound tier survives the distinctive rule",
  scoreNames("Towne Bank", "TOWNEBANK").tier === "compound",
  "TOWNEBANK shares no TOKEN with {TOWNE,BANK}; the squash equality is its evidence"
);
check(
  "...and a compound match made only of generic words is still refused",
  scoreNames("Bank", "BANK").tier === "none",
  "otherwise the squash path becomes a way around the rule"
);
check(
  "GENERIC_TOKENS stays tiny and is paired with the fold",
  (() => {
    const code = readCodeOnly("scripts/lib/sec-title-match.mjs");
    const set = /const GENERIC_TOKENS = new Set\(\[([^\]]*)\]\)/.exec(code);
    if (!set) return false;
    const entries = set[1].split(",").map((t) => t.trim()).filter(Boolean);
    // BANK is generic BECAUSE the alias map folds four spellings onto it. If
    // the fold were ever removed, this entry would be doing nothing.
    return entries.length <= 3 && /"BANK"/.test(set[1]) &&
      /BANK_FORM_ALIASES/.test(code);
  })(),
  "every list in this file that grew on plausibility rather than a measured case has been wrong"
);
check(
  "NO pair can score on generic agreement alone — the invariant, enumerated",
  (() => {
    // The guard that enforces this is UNREACHABLE at |GENERIC_TOKENS| = 2 (the
    // proof is in the module), so no mutation can kill the line and asserting
    // the line would be theatre. The PROPERTY is what matters, and it is
    // checked by enumeration over names built from distinctive and generic
    // words — including the shapes that would land exactly on the 0.6 floor if
    // a third generic token were ever added.
    const D = ["Alpha", "Beta", "Gamma"], G = ["Bank", "Financial"];
    const names = [];
    for (const d of D) {
      names.push(d);
      for (const g of G) names.push(`${d} ${g}`, `${d} ${g} Inc`);
    }
    for (const g of G) names.push(g, `${g} Inc`);
    for (const a of D) for (const b of D) if (a !== b) names.push(`${a} ${b}`, `${a} ${b} Bank`);

    const generic = new Set(["BANK", "FINANCIAL"]);
    for (const x of names) {
      for (const y of names) {
        const got = scoreNames(x, y);
        if (got.tier === "none" || got.tier === "compound") continue;
        const xs = new Set(nameTokens(x)), ys = new Set(nameTokens(y));
        const sharedDistinctive = [...xs].filter((t) => ys.has(t) && !generic.has(t));
        if (!sharedDistinctive.length) return false;
      }
    }
    return true;
  })(),
  "a tier awarded on BANK alone is what matched TowneBank to The Bancorp Inc"
);
check(
  "the inverse rule is written down beside the one it mirrors",
  (() => {
    const raw = fs.readFileSync("scripts/lib/sec-title-match.mjs", "utf8");
    return /A token you DROP is a distinction you can no longer make/.test(raw) &&
      /A token you FOLD becomes a token that matches EVERYTHING/.test(raw);
  })(),
  "half a rule is what produced the second bug an hour after the first"
);

console.log("\n=== 4. AMBIGUITY IS REPORTED, NEVER RESOLVED ===\n");

// THE REAL AMBIGUITY SHAPE IS TWO FILERS DIFFERING ONLY BY LEGAL FORM, which
// is common — a group files as both "X Corp" and "X Inc" under separate CIKs.
// Both reduce to the same tokens, so both land on `exact` and neither is more
// right than the other.
//
// The first fixture here used "Brookfield Renewable Partners" vs "... Corporation"
// and stopped being a tie once structural words were no longer dropped: PARTNERS
// survives, so one is exact and the other subset. The assertion then failed —
// correctly. A fixture that no longer exhibits the property it was written for
// is a passing test waiting to happen.
const ROWS = [
  { ticker: "AAA", cik: "0000000001", title: "Brookfield Renewable Corporation" },
  { ticker: "BBB", cik: "0000000002", title: "Brookfield Renewable Inc" },
  { ticker: "FISV", cik: "0000798354", title: "FISERV INC" },
];
check(
  "two filers at the same top tier set `ambiguous`",
  rankCandidates("Brookfield Renewable", ROWS).ambiguous === true,
  "an automatic pick here would be confidently wrong, which is the failure mode name matching has"
);
check(
  "...and an unambiguous leader does not",
  rankCandidates("Fiserv, Inc.", ROWS).ambiguous === false
);
check(
  "a name matching nothing returns no candidates and topTier 'none'",
  (() => {
    const r = rankCandidates("Nothing Like These", ROWS);
    return r.candidates.length === 0 && r.topTier === "none" && r.ambiguous === false;
  })(),
  "an empty candidate list is a REAL negative — that is the whole point of matching the full file"
);
check(
  "candidates come back ranked, best tier first",
  (() => {
    const r = rankCandidates("Fiserv", ROWS);
    return r.candidates[0]?.cik === "0000798354";
  })()
);

console.log("\n=== 5. THE OUTPUT CANNOT BE APPLIED BY ACCIDENT ===\n");

// This is the assertion that keeps the wireProvider exception honest. The
// argument for allowing name matching here is entirely that a human approves
// before anything ships; if the script could write the map, that argument is
// gone and so is the justification.
const script = readCodeOnly("scripts/sec-title-candidates.mjs");
check(
  "the script never writes a file",
  !/writeFileSync|createWriteStream|appendFileSync|fs\.write/.test(script),
  "print-and-review is the entire basis for allowing a name match in this repo"
);
check(
  "...and does not emit a payload named like the map it must not become",
  /emitPayload\("cik-candidates"/.test(script) && !/emitPayload\("cik-map"/.test(script),
  'a payload called "cik-map" is one copy-paste from being committed as one'
);
check(
  "the emitted shape is a LIST of records, not a symbol -> CIK object",
  /report,\s*\n\s*\}, null, 2\)\)/.test(script) && /const report = \[\]/.test(script),
  "an object keyed by symbol is committable as data/cik-map.json in a single move"
);
check(
  "the payload says in words that it is not a map",
  /CANDIDATES, NOT A MAP/.test(script),
  "the reader of the log is the safety mechanism, so tell them"
);
check(
  "it is registered on the READ-ONLY relay job",
  (() => {
    const router = readCodeOnly("scripts/relay-run.mjs");
    return /"sec-titles": \{/.test(router) && !/"write-sec-titles"/.test(router);
  })(),
  "the write- prefix routes to the credentialled job; this task has no business there"
);

console.log("\n=== 5a. THE DIRECTORY PARSER, RUN RATHER THAN DESCRIBED ===\n");

// THE FIRST DRAFT OF THIS SUITE ASSERTED THE PARSER'S PROSE AND NEVER CALLED
// IT: five mutations survived, including dropping the test-issue filter, the
// HTML guard and the instrument strip. A module with a well-argued header and
// no behavioural test is an untested module with a good reputation.
const NASDAQ_FIXTURE = [
  "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares",
  "EA|Electronic Arts Inc. - Common Stock|Q|N|N|100|N|N",
  "ZZZZZ|Nasdaq Test Stock|Q|Y|N|100|N|N",
  "File Creation Time: 0914202612:00|||||||",
].join("\n");
const OTHER_FIXTURE = [
  "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol",
  "BRK.B|Berkshire Hathaway Inc. Class B|N|BRK B|N|100|N|BRK-B",
  "MMC|Marsh & McLennan Companies, Inc. Common Stock|N|MMC|N|100|N|MMC",
].join("\n");

const nasdaqRows = parseDirectory(NASDAQ_FIXTURE);
const otherRows = parseDirectory(OTHER_FIXTURE);

check(
  "both header shapes parse — `Symbol` and `ACT Symbol`",
  nasdaqRows.length === 1 && otherRows.length === 2,
  `got ${nasdaqRows.length} and ${otherRows.length}; the two files do not share a first column name`
);
check(
  "a Test Issue row is dropped",
  !nasdaqRows.some((r) => r.symbol === "ZZZZZ"),
  "the directory carries deliberately fake rows; one shadowing a live symbol would " +
    "attach a nonsense company name to a real page"
);
check(
  "the trailing 'File Creation Time' line is not a row",
  !nasdaqRows.some((r) => /File Creation/i.test(r.symbol))
);
check(
  "HTML behind a 200 parses to nothing rather than to garbage rows",
  parseDirectory("<html><body>maintenance</body></html>").length === 0 &&
    parseDirectory("<table><tr><td>Symbol|Name</td></tr></table>").length === 0,
  "a 200 carrying HTML is how these hosts report an outage — the header check " +
    "is what rejects it, which is why the separate looks-like-HTML test was removed"
);
check(
  "parseDirectory APPLIES the instrument strip, it does not merely export it",
  (() => {
    // stripInstrumentClause can be perfect and unused. A mutation setting
    // `name = rawName` left every direct test of the stripper passing.
    const row = parseDirectory(NASDAQ_FIXTURE)[0];
    return row.name === "Electronic Arts Inc." &&
      row.rawName === "Electronic Arts Inc. - Common Stock" &&
      row.name !== row.rawName;
  })(),
  "the matcher reads `name`; an unstripped one downgrades every EXACT to a SUBSET"
);
check(
  "...and keeps the raw value too, for the committed snapshot",
  parseDirectory(NASDAQ_FIXTURE)[0].rawName === "Electronic Arts Inc. - Common Stock",
  "storing this script's cleaning would bake one normaliser into data the app then cleans again"
);
check(
  "an unrecognised header yields NO rows — never a positional guess",
  parseDirectory("Col A|Col B|Col C\nX|Y|Z").length === 0,
  "guessing 0/1 is how a 'Nasdaq Traded' Y/N flag becomes a ticker"
);
check(
  "...but a header that names its columns differently still works",
  (() => {
    // nasdaqtraded.txt puts the symbol at index 1, behind a "Nasdaq Traded"
    // flag. Header-driven parsing handles it; every positional parser in this
    // repo would read "Y" as the ticker.
    const traded = parseDirectory("Nasdaq Traded|Symbol|Security Name\nY|EA|Electronic Arts Inc.");
    return traded.length === 1 && traded[0].symbol === "EA";
  })(),
  "this is the concrete reason the header is read rather than the position"
);
check(
  "both spellings of a dual-class symbol resolve to the same name",
  (() => {
    const map = nameMap(nasdaqRows, otherRows);
    return map.get("BRK.B") === map.get("BRK-B") && Boolean(map.get("BRK-B"));
  })(),
  "otherlisted carries ACT Symbol (dotted) and NASDAQ Symbol (dashed); the same " +
    "dot/dash split that cost the CIK lookup a symbol, handled at the source"
);

console.log("\n  -- the instrument clause, against the committed 155-name fixture --\n");

// REAL NAMES, NOT INVENTED ONES. scripts/fixtures/company-names.txt is a
// capture of the actual directory and its header says why: half of these join
// the instrument clause with a plain space rather than the " - " the spec
// describes, "a fact no invented fixture would have contained".
const REAL = fs.readFileSync("scripts/fixtures/company-names.txt", "utf8")
  .split("\n")
  .filter((l) => l.includes("|") && !l.startsWith("#"))
  .map((l) => l.split("|"));
check(
  "the fixture is actually loaded (positive control)",
  REAL.length > 100,
  `${REAL.length} rows — a negative assertion against an empty list passes for the wrong reason`
);
check(
  "the clause is stripped from a substantial share of real names",
  (() => {
    const changed = REAL.filter(([, raw]) => stripInstrumentClause(raw) !== raw).length;
    return changed > REAL.length / 2;
  })(),
  `${REAL.filter(([, raw]) => stripInstrumentClause(raw) !== raw).length}/${REAL.length} changed`
);
check(
  "both join styles are handled — ' - Common Stock' and a plain space",
  stripInstrumentClause("Electronic Arts Inc. - Common Stock") === "Electronic Arts Inc." &&
    stripInstrumentClause("Archer Aviation Inc. Class A Common Stock") === "Archer Aviation Inc.",
  "a ' - ' cut alone leaves half of this directory intact"
);
check(
  "a trailing parenthetical goes, and the suffix behind it goes too",
  stripInstrumentClause("Boeing Company (The) Common Stock") === "Boeing Company"
);
check(
  "AMERICAN survives — the clause is a PHRASE rule, never a token rule",
  (() => {
    // This is the assertion that keeps the rule in the parser instead of in the
    // matcher's stopword list. "american depositary shares" is noise; the token
    // AMERICAN is not, and dropping it would collapse three large caps toward
    // each other.
    const kept = [
      "American Airlines Group, Inc. - Common Stock",
      "American Express Company",
      "American Tower Corporation (REIT)",
    ].map(stripInstrumentClause);
    return kept.every((n) => /American/.test(n)) &&
      stripInstrumentClause("Grab Holdings Ltd American Depositary Shares") === "Grab Holdings Ltd";
  })(),
  "American Airlines, American Express and American Tower all survive; the ADS clause does not"
);
check(
  "a name that is ONLY an instrument clause does not become empty-and-matchable",
  (() => {
    const got = stripInstrumentClause("Common Stock");
    // Either it is left alone or it reduces to nothing -- what matters is that
    // scoreNames refuses it, which section 2 already asserts for empty input.
    return got === "Common Stock" || got === "";
  })()
);

console.log("\n=== 5b. THE SCRIPT ACTUALLY RUNS — no undefined names ===\n");

// THIS SECTION EXISTS BECAUSE EVERY ASSERTION IN SECTION 6 PASSED AGAINST A
// SCRIPT THAT WOULD HAVE CRASHED ON LINE 129.
//
// Repointing the name source deleted the block that defined `fieldHits` and
// left a console.log still referencing it. `node --check` passed (it only
// parses). `npx eslint` passed (this repo's config has no-undef off, as
// TS-centric configs usually do). And the section-6 greps passed, because the
// STRING they look for was still in the file — a grep-based assertion agreeing
// with broken code, which is the exact trap
// claude/traps/grep-finds-the-comment-not-the-code.md is about, arriving from
// the other direction.
//
// A relay script gets one shot: it runs once, on a runner, three minutes into a
// dispatch. A ReferenceError there costs a whole cycle — which is what run 48
// cost in a different form. So the property is checked with the only tool in
// this repo that catches it: the TypeScript compiler in checkJs mode, which
// reports "Cannot find name" on plain .mjs.
const SCRIPTS_THAT_MUST_RUN = [
  "scripts/sec-title-candidates.mjs",
  "scripts/lib/sec-title-match.mjs",
  "scripts/lib/nasdaq-directory.mjs",
];
{
  const program = ts.createProgram(SCRIPTS_THAT_MUST_RUN, {
    allowJs: true, checkJs: true, noEmit: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, types: [],
  });
  // 2304/2552 are "Cannot find name" with and without a spelling suggestion.
  // Deliberately NOT the compiler's full diagnostic set: these are plain .mjs
  // and type errors are not the property being asserted — a reference to
  // something that does not exist is.
  const undefined_ = ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file && SCRIPTS_THAT_MUST_RUN.some((f) => d.file.fileName.endsWith(f.split("/").pop())))
    .filter((d) => d.code === 2304 || d.code === 2552);

  // POSITIVE CONTROL FIRST. A misconfigured program reports zero diagnostics
  // for everything, which would make the assertion below pass vacuously — the
  // same fail-green shape it was written to catch.
  const canary = ts.createProgram(["scripts/check-sec-title-match.mjs"], {
    allowJs: true, checkJs: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true, types: [],
  });
  const canarySource = canary.getSourceFile("scripts/check-sec-title-match.mjs");
  check(
    "the compiler is actually parsing these files (positive control)",
    Boolean(canarySource && canarySource.statements.length > 5),
    "a program that loaded nothing reports no errors about anything"
  );
  check(
    "no reference to an undefined name in the relay script or its modules",
    undefined_.length === 0,
    undefined_.length
      ? undefined_.map((d) =>
          `${d.file.fileName.split("/").pop()}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`).join(" | ")
      : `${SCRIPTS_THAT_MUST_RUN.length} files clean — neither node --check nor eslint catches this class`
  );
}

console.log("\n=== 6. IT CANNOT PASS BY MEASURING NOTHING ===\n");

check(
  "the raw substring search runs on the DOWNLOADED BYTES, before any parsing",
  (() => {
    // THE ONLY FORK THAT MATTERS: absent from the file, or dropped by us. It is
    // worthless if it reads the parsed rows, so the raw text must be captured
    // before parseDirectory and JSON.parse and searched directly.
    const rawKept = /const nasdaqText = nasdaqRes\.ok \? await nasdaqRes\.text\(\)/.test(script) &&
      /const secText = await res\.text\(\)/.test(script) &&
      /JSON\.parse\(secText\)/.test(script);
    const searchesRaw = /\[\["nasdaqlisted", nasdaqText\], \["otherlisted", otherText\]\]/.test(script) &&
      /secText\.match\(new RegExp\(`"\$\{esc\}"`/.test(script);
    return rawKept && searchesRaw;
  })(),
  "searching the parsed rows would measure our own filters again, which is the thing in question"
);
check(
  "...and reports delimited AND loose hits, which fail differently",
  /delimited=\$\{delimited\.length\} loose=\$\{loose\}/.test(script) &&
    /quoted=\$\{quoted\} loose=\$\{looseSec\}/.test(script),
  "a loose hit with no delimited hit means the symbol is in the file under another " +
    "column or inside another word — a third answer neither alone would show"
);
check(
  "the raw search states a verdict per symbol, and a narrow one",
  (() => {
    // The three outcomes must be distinguishable in the output, or the reader
    // is back to inferring from counts. And the absent case must NOT assert a
    // rename: "not listed under this spelling" is what the bytes support.
    return /PRESENT IN BOTH RAW SOURCES — if we reported it missing, the bug is ours/.test(script) &&
      /PRESENT IN \$\{inDirectory \? "THE DIRECTORY" : "SEC"\} ONLY/.test(script) &&
      /ABSENT FROM BOTH RAW SOURCES — not currently listed under this spelling/.test(script) &&
      /the successor is a separate question/.test(script);
  })(),
  "the fork is absent-vs-dropped; naming a successor is a further claim needing further evidence"
);
check(
  "carriesOurSymbol is read THROUGH the raw verdict, not glossed once",
  (() => {
    // false means opposite things in the two cases: confirmation for a retired
    // spelling, refutation for a live one. One gloss for both would print a
    // refutation as agreement.
    return /const raw = rawVerdict\.get\(entry\.symbol\)/.test(script) &&
      /raw\?\.inDirectory/.test(script) &&
      /REFUTED — our symbol is LIVE in the directory/.test(script) &&
      /CONSISTENT WITH A RENAME/.test(script) &&
      /CONFIRMED — the filer claims our exact symbol/.test(script);
  })(),
  "NBN and TOWN are the refutation case; the old single gloss would have read as agreement"
);
check(
  "...and the verdict map is populated by the raw search that precedes it",
  /rawVerdict\.set\(symbol, \{ inDirectory, inSec, verdict \}\)/.test(script) &&
    script.indexOf("rawVerdict.set(") < script.indexOf("const raw = rawVerdict.get("),
  "reading it before the raw search ran would silently take the rename branch every time"
);
check(
  "the name snapshot tries EVERY spelling for a suffixed universe symbol",
  (() => {
    // 17 of the first snapshot's 28 misses were dashed dual-class and preferred
    // names. The directory lists those under the dotted ACT Symbol only,
    // because their NASDAQ Symbol column is empty — they are NYSE-listed.
    //
    // ASSERTS THE BEHAVIOUR, NOT THE SPELLING OF IT, and this assertion used to
    // pin a hand-rolled dash->dot form — testing the wrong thing rather than
    // nothing, since the shape it pinned recovered ZERO of the 18 suffixed
    // symbols in the universe. Dot is not the spelling Nasdaq Trader uses for a
    // suffixed preferred; it writes MER$K, not MER.PK, and only symbolSpellings
    // emits that. The property is "every spelling the helper knows", so that is
    // what is pinned now — matched through the import rather than one phrasing,
    // because a check pinned to a phrasing fails on every correct refactor.
    return /const findRow = \(sym\) =>/.test(script) &&
      /symbolSpellings\(symbol\)\.map\(findRow\)/.test(script) &&
      /from "\.\/lib\/symbol-spellings\.mjs"/.test(script);
  })(),
  "BRK-B is in the preset universe, so this is a guaranteed slot losing its news leg"
);
check(
  "...and the helper it calls really emits more than the dot/dash pair",
  (() => {
    // Without this the assertion above would pass against a symbolSpellings that
    // had quietly lost the dollar rule — the exact failure it was written for.
    // THE DOTTED FORM IS ASSERTED BY SHAPE, NOT BY LITERAL. Writing it out makes
    // this file carry a dotted ticker string, which check-symbol-spelling.mjs
    // scans for as a real defect — it parses string literals, so a fixture and a
    // live spelling look identical to it, correctly.
    const spellings = symbolSpellings("MER-PK");
    return spellings[0] === "MER-PK" && spellings.includes("MER$K") &&
      spellings.some((v) => v.includes("."));
  })(),
  "MER-PK -> MER$K is the form the directory actually carries; a dot-only helper would be the old bug with a new caller"
);
check(
  "...and stores it under the UNIVERSE's spelling, which is what callers ask with",
  /snapshot\[symbol\] = row\.rawName/.test(script),
  "keying it by the directory's spelling would move the miss rather than fix it"
);
check(
  "the 'REAL negative' gloss is gone",
  !/REAL negative/.test(script) &&
    /statement about this matcher, NOT evidence the filer is absent/.test(script),
  "the SEARCH was exhaustive; the MATCHER is not, and TOWN proved the difference"
);
check(
  "the script refuses to continue if SEC's file does not return 200",
  /FATAL: company_tickers\.json did not return 200/.test(script),
  "a failed fetch would otherwise print 'no candidates' for every symbol"
);
check(
  "...and if the parsed file has no rows or no control row",
  /FATAL: the SEC file is not usable/.test(script) && /FISERV/.test(script),
  "'no candidates for anybody' reads exactly like a real negative result"
);
check(
  "symbols with NO NAME are reported separately from symbols with no match",
  /NO NAME AVAILABLE, so not matchable/.test(script),
  "collapsing them recreates the ambiguity this task exists to remove — " +
    "an unmatchable symbol is not evidence of absence at SEC"
);
check(
  "the name source and its coverage are printed",
  /name source: Nasdaq Trader symdir/.test(script) && /covering \$\{/.test(script),
  "run 48's 'name fields found: NONE' is the only reason that void run was legible " +
    "rather than read as ten real negatives; the replacement source states its coverage the same way"
);
check(
  "names come from the directory, not from the dump's FMP rows",
  (() => {
    // BOTH files, by their real URLs. Asserting only that the module is
    // imported let a mutation aliasing one URL to the other survive — half the
    // directory silently missing, and every symbol on the other half reported
    // as unmatchable.
    // NO ALIASING IN THE IMPORT. Checking that both identifiers appear was not
    // enough: `OTHER_LISTED_URL as NASDAQ_LISTED_URL` keeps both spellings in
    // the file while fetching one file twice — half the directory silently
    // missing, and every symbol on the other half reported unmatchable.
    const importLine = /import \{([^}]*)\} from "\.\/lib\/nasdaq-directory\.mjs"/.exec(script);
    return Boolean(importLine) && !/\bas\b/.test(importLine[1]) &&
      /NASDAQ_LISTED_URL/.test(importLine[1]) && /OTHER_LISTED_URL/.test(importLine[1]) &&
      /fetch\(NASDAQ_LISTED_URL/.test(script) && /fetch\(OTHER_LISTED_URL/.test(script) &&
      !/NAME_FIELDS/.test(script);
  })(),
  "run 48 established those rows carry sector and industry and no company name at all"
);
check(
  "the two directory URLs are distinct and are the ones the render path uses",
  NASDAQ_LISTED_URL !== OTHER_LISTED_URL &&
    /nasdaqlisted\.txt$/.test(NASDAQ_LISTED_URL) && /otherlisted\.txt$/.test(OTHER_LISTED_URL),
  "lib/stock-news-data.ts fetchCompanyName reads these same two files"
);
check(
  "a directory that parsed to nothing is FATAL, not an empty result",
  (() => {
    // The THRESHOLD matters, not just the message: `if (false)` keeps the
    // FATAL text in the file while never reaching it, and that mutation
    // survived an assertion that only grepped for the string.
    return /FATAL: the symbol directory is not usable/.test(script) &&
      /if \(nasdaqRows\.length \+ otherRows\.length < \d{3,}\) \{/.test(script) &&
      /process\.exit\(1\)/.test(script);
  })(),
  "HTML behind a 200, or a changed header, would otherwise report every symbol unmatchable — a void run dressed as a result"
);
check(
  "the spelling fallback is applied before calling a symbol unresolved",
  // Also restated from a pinned `s.replace(/\./g, "-")`. The CIK map is where a
  // dot/dash miss actually mattered (BRK.B), and it still does — what changed is
  // that the caller no longer decides which single alternative to try: the
  // helper subsumes the inline line and widens it to the dollar forms too.
  /lookupSpellingIn\(cikMap, s\)/.test(script),
  "otherwise BRK.B is queued for human adjudication of a bug already fixed at the lookup"
);
check(
  "...and BRK.B really resolves through it, rather than the regex merely matching",
  (() => {
    const cikMap = { "BRK-B": 1067983 };
    return symbolSpellings("BRK.B").some((spelling) => Boolean(cikMap[spelling]));
  })(),
  "the structural check above passes on a call that returns nothing; this one runs it"
);

console.log("\n=== 7. THE EXCEPTION TO wireProvider'S RULE IS WRITTEN DOWN ===\n");

// wireProvider.ts refuses name matching in as many words. That refusal is
// correct there. If this module does not say why it is different, the two read
// as an inconsistency and the next person resolves it in whichever direction
// they happen to prefer.
const matcher = readCodeOnly("scripts/lib/sec-title-match.mjs");
const matcherRaw = (await import("node:fs")).readFileSync("scripts/lib/sec-title-match.mjs", "utf8");
check(
  "the matcher quotes wireProvider's refusal, not merely the word",
  (() => {
    // A BARE /wireProvider/ GREP WAS NOT ENOUGH: the word also appears as a
    // column heading in the comparison table, so a mutation deleting the
    // sentence that states the refusal survived. The quoted refusal itself is
    // the thing that must be present.
    return /REFUSES name matching/.test(matcherRaw) &&
      /reintroduce exactly the text guessing the structured field avoids/.test(matcherRaw);
  })(),
  "an unexplained exception to a stated rule is how the rule gets dropped"
);
check(
  "...and gives the distinction rather than just asserting one",
  /every render, per symbol/.test(matcherRaw) &&
    /once, at build time/.test(matcherRaw) &&
    /approves before commit/.test(matcherRaw) &&
    /structured field IS the thing that failed/.test(matcherRaw),
  "the difference is render-time-and-served vs build-time-and-reviewed, and it has to be legible"
);
assert(matcher.length > 500, "the matcher source was over-stripped; assertions above are not measuring it");

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
