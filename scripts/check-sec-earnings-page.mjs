// The earnings page is on SEC data — the properties that must stay true.
//
// WHAT THIS CHECKS AND WHY IT IS SOURCE-LEVEL. The page renders from Redis and
// Redis is not reachable from a check, so there is no way to assert a rendered
// number here. What CAN be asserted is everything the owner's rules are actually
// about: that a card with no source is hidden rather than removed, that its
// reason is registered with what went away and when, that no retired FMP
// endpoint is still being called, and that nothing on the page claims a source
// it no longer has. Those are properties of the source, and the source is where
// a future deploy would break them.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const PAGE = "app/stock/[symbol]/earnings/page.tsx";
const CARDS = "app/stock/[symbol]/earnings/SecEarningsCards.tsx";
const VIEW = "lib/server/secEarningsView.ts";
// ── THE SCORER MOVED OUT OF THE PAGE (2026-09-21) ────────────────────────
//
// Every band, component, guard and sentence this file asserts about the score
// used to be read out of PAGE with a regex. It now lives in its own module,
// because the sidebar snapshot card needs the same function and a second copy
// of it would be two scorers for one value.
//
// THE ASSERTIONS ARE UNCHANGED — they read SCORE instead of PAGE. That is
// strictly a better instrument for the same questions: grabbing a function out
// of a 1,200-line page by brace-matching worked, but it could not tell a
// scorer from a lookalike declared elsewhere in the same file, and it broke
// whenever the page was reorganised around it. What still reads PAGE is what
// is genuinely ABOUT the page: the JSX that draws the gauge, the hidden-card
// call sites, and the prose.
const SCORE = "lib/server/secEarningsScore.ts";

const pageRaw = fs.readFileSync(PAGE, "utf8");
const scoreRaw = fs.readFileSync(SCORE, "utf8");
// The lift below supplies its own export list, so a declaration that is
// already exported would be exported twice and the module would not parse.
// Stripping the keyword is what lets the scorer be a real module and still be
// lifted as a fragment.
const unexport = (s) => (s ?? "").replace(/^export /gm, "");
// readCodeOnly strips /* */ and // — it does NOT strip {/* ... */}, which is a
// JSX EXPRESSION containing a comment, and the page is full of them recording
// what moved off FMP. Scanning for user-visible text has to drop those too, or
// the record of the migration reads as a promise the page is still making.
const stripJsxComments = (src) => src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
const pageCode = stripJsxComments(readCodeOnly(PAGE));
// The scorer's own code, comments stripped, for the two assertions that read a
// whole function body rather than matching a line inside it.
const scoreCode = readCodeOnly(SCORE);
const cardsRaw = fs.readFileSync(CARDS, "utf8");
const cardsCode = stripJsxComments(readCodeOnly(CARDS));

// secEarningsView imports only from secFactStore, which imports Redis — so the
// registry is read as source rather than lifted. It is a literal array, and the
// assertions below are about its CONTENT, not its behaviour.
const viewRaw = fs.readFileSync(VIEW, "utf8");
const registryIds = [...viewRaw.matchAll(/^\s{4}id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]);

console.log("\n1. the hide registry");

check("RETIRED_SOURCES has entries", registryIds.length > 0, registryIds.join(", "));
check("ids are unique", new Set(registryIds).size === registryIds.length);

// EVERY ENTRY CARRIES ALL FOUR FIELDS. A missing `retiredOn` is the difference
// between a record and a note.
const entries = [...viewRaw.matchAll(/\{\s*id: "([a-z0-9-]+)",([\s\S]*?)\n  \},/g)];
check("every entry names a label, a source and a date",
  entries.length === registryIds.length &&
    entries.every(([, , body]) => /label:/.test(body) && /source:/.test(body) && /retiredOn: "\d{4}-\d{2}-\d{2}"/.test(body) && /reason:/.test(body)),
  `${entries.length} complete of ${registryIds.length}`);

// THE TWO DIRECTIONS, AND BOTH MATTER. An id used with no entry throws at render
// (retiredSource does not fall back); an entry with no user is a card someone
// deleted instead of hiding, which loses the record the registry exists to keep.
const used = [...pageCode.matchAll(/<HiddenCard\s+id="([a-z0-9-]+)"/g)].map((m) => m[1]);
check("every HiddenCard id has a registry entry",
  used.every((id) => registryIds.includes(id)),
  used.filter((id) => !registryIds.includes(id)).join(", ") || `${used.length} used`);
check("every registry entry is used somewhere on the page",
  registryIds.every((id) => used.includes(id) || pageCode.includes(`"${id}"`) || cardsCode.includes(`"${id}"`)),
  registryIds.filter((id) => !used.includes(id) && !pageCode.includes(`"${id}"`) && !cardsCode.includes(`"${id}"`)).join(", ") || "all used");

// retiredSource must THROW on an unknown id rather than returning a placeholder.
// A soft fallback lets a card ship with an invented reason, which is the exact
// "switched back on with nothing behind it" case the registry exists to stop.
check("retiredSource throws on an unknown id rather than falling back",
  /throw new Error\(`no retired-source entry/.test(viewRaw));

console.log("\n2. hidden, not removed — the comment at the point of hiding");

// THE OWNER'S RULE IS THE COMMENT, NOT JUST THE COMPONENT. Read from the RAW
// source: readCodeOnly strips comments, so asserting on the stripped text would
// pass whatever was written.
for (const id of registryIds) {
  const at = pageRaw.indexOf(`<HiddenCard id="${id}"`);
  if (at === -1) continue;
  // The comment block immediately preceding this card, within ~1400 chars.
  const before = pageRaw.slice(Math.max(0, at - 1400), at);
  const comment = before.lastIndexOf("{/*");
  const body = comment === -1 ? "" : before.slice(comment);
  check(`${id}: the hiding is commented with what went away and when`,
    /2026-\d{2}-\d{2}/.test(body) && /FMP|companyfacts|segment axis/.test(body),
    comment === -1 ? "no comment before the card" : "");
}

console.log("\n3. nothing claims a source it no longer has");

// USER-VISIBLE TEXT ONLY. The file is full of the word FMP in comments, which is
// the record of what moved and must stay; what must not survive is a string the
// reader sees. Checked against the comment-stripped source for that reason.
const visibleFmp = [...pageCode.matchAll(/["'>][^"'<>]*\bFMP\b[^"'<>]*["'<]/g)].map((m) => m[0]);
check("no user-visible string on the page says FMP", visibleFmp.length === 0,
  visibleFmp.slice(0, 3).join(" | "));
check("...nor on the cards", !/\bFMP\b/.test(cardsCode),
  (cardsCode.match(/.{0,60}\bFMP\b.{0,60}/) ?? [""])[0]);

check("the attribution constant names SEC EDGAR",
  /SEC_ATTRIBUTION = "SEC EDGAR filings"/.test(viewRaw));
check("every card that states a source uses the constant, not a literal",
  !/Source: (?!\{SEC_ATTRIBUTION\})/.test(cardsRaw),
  "a second spelling of the source is a second thing to forget to update");

console.log("\n4. the retired endpoints are not still being called");

// The point is cost as well as correctness: a call whose result nothing renders
// is a paid request for nothing, and it is the state the page would be left in
// by deleting only the JSX.
const DEAD_ENDPOINTS = [
  "/analyst-estimates", "/income-statement", "/cash-flow-statement",
  "/balance-sheet-statement", "/revenue-product-segmentation",
  "/revenue-geographic-segmentation", "historical/earning_calendar",
];
for (const ep of DEAD_ENDPOINTS) {
  check(`no call to ${ep}`, !pageCode.includes(ep));
}
// /earnings IS GONE (#535 COWORK #18 §3, 2026-09-23). The announcement date and
// its session now come from the stored SEC report-dates record (the filing's
// acceptance time), and with no record the reaction card is hidden. Asserted
// gone, so an FMP call cannot quietly come back to this page.
check("/earnings is no longer called — every date on the page is from the filings",
  !pageCode.includes("`/earnings?symbol=") && !/financialmodelingprep|fmpFetch/.test(pageCode),
  "the FMP-calendar fallback is what printed 'Dates here come from an earnings calendar'");

console.log("\n5. labels");

// THE STANDARD IS THE FILER'S, NOT A LITERAL. Rendered on AZN / KGC / AAPL in
// check-earnings-render.mjs §15; here, that no card hardcodes it back.
check("EPS labels name the filer's standard wherever EPS is named",
  (cardsRaw.match(/EPS \(\$?\{epsStandardWord\(view\.accounting\)\}\)/g) ?? []).length >= 3 &&
    !/EPS \(GAAP\)/.test(cardsRaw),
  `${(cardsRaw.match(/epsStandardWord\(view\.accounting\)/g) ?? []).length} occurrences`);
// The constant is a concatenation, so the sentence spans a `" +` — matched on
// the two halves rather than on a phrase that only exists once rendered.
check("the GAAP note explains that adjusted figures differ",
  /Companies often headline an adjusted/.test(viewRaw) &&
    /excludes one-off charges/.test(viewRaw));

// A DERIVED FIGURE IS LABELLED. Q4 and every cash-flow quarter but Q1 are
// arithmetic on filed numbers rather than filed numbers, and saying which is
// which is the difference between a figure a reader can check against the 10-Q
// and one they cannot.
check("derivationNote covers all three non-as-filed derivations",
  ["differenced", "computed", "ambiguous"].every((d) => new RegExp(`case "${d}":`).test(viewRaw)));
check("the cards render a derived mark from it",
  /derivedNote/.test(cardsCode) && /DerivedMark/.test(cardsCode));

// FISCAL, NOT CALENDAR. Two companies' "2026" can be nine months apart -- the
// probe set's year-ends are 31 Mar, 26 Sep, 3 Sep, 31 Oct, 31 Dec.
const codecEarly = fs.readFileSync("lib/server/secFactCodec.ts", "utf8");
check("period labels come from periodLabel, which is fiscal",
  /periodLabel/.test(readCodeOnly(VIEW)) && /FY\$\{p\.fy\}/.test(codecEarly));
// THE SENTENCE MOVED INTO THE VOCABULARY, so the assertion follows it. It is
// now one entry per basis in PERIOD_WORDS — and BOTH must carry it, because the
// annual filer is the one that had a quarterly sentence over annual figures.
check("and the page says the labels are the company's own fiscal calendar",
  (readCodeOnly(VIEW).match(/labelled: "[^"]*own (fiscal calendar|year-end)[^"]*"/g) ?? []).length === 2 &&
    /\{w\.labelled\}/.test(cardsRaw),
  "one sentence per basis, rendered from the view rather than written in the card");

console.log("\n6. no zeros standing in for missing data");

// "EPS surprise: 0.00" reads as "came in exactly in line", which is a claim, and
// a false one. Nothing that renders a stored value may coalesce null to 0.
const coalesced = [...cardsCode.matchAll(/(?:cell|val|value)\w*\s*\?\?\s*0\b/g)].map((m) => m[0]);
check("no ?? 0 on a rendered value", coalesced.length === 0, coalesced.join(", "));
check("a null value renders an em dash",
  /return "—"/.test(cardsCode) && /\?\s*"—"/.test(cardsCode));

console.log("\n7. the store's gate");

const storeRaw = fs.readFileSync("lib/server/secFactStore.ts", "utf8");
// The positional codec lives in its own file, with no Redis import, so a relay
// probe can run the whole render path against real filings. The store is the
// I/O half; the assertions below split accordingly.
const codecRaw = fs.readFileSync("lib/server/secFactCodec.ts", "utf8");
check("readFactSet refuses a set whose fieldsHash differs",
  /raw\.h !== secFieldsHash\(\)/.test(storeRaw) && /return null;/.test(storeRaw));
// STRIPPED, NOT RAW. The first version of this matched the store's own comment
// -- "reading them anyway is the silent-wrong-number failure" -- and reported a
// failure for explaining the rule it was checking.
check("...and the mismatch branch returns null with no fallback decode",
  (() => {
    const src = readCodeOnly("lib/server/secFactStore.ts");
    const at = src.indexOf("raw.h !== secFieldsHash()");
    // The next statement after the warn must be the return. A `[^}]*` window
    // cannot be used: the warn's template literal contains a `}` of its own.
    // Exactly this branch: from the condition to the `}` that closes it. A
    // fixed window ran past it into the next guard and read that as a decode.
    const branch = src.slice(at, at + src.slice(at).indexOf("\n    }"));
    return at !== -1 && /return null;/.test(branch) &&
      !/raw\.(?:quarters|years|instants)/.test(branch);
  })(),
  "a positional array read against the wrong field order is 46 wrong numbers");
check("ttm() refuses a partial year",
  /if \(four\.length < 4\) return null;/.test(codecRaw) &&
    /if \(vals\.some\(\(v\) => v === null\)\) return null;/.test(codecRaw),
  "after D1b, Q4 EPS is legitimately null, so the three-quarter case is common");

console.log("\n7b. the YoY base is a FISCAL MATCH, run rather than read");

// ── WHY THIS RUNS THE REAL FUNCTIONS ON A SHAPE, NOT ON A FIXTURE ─────────
// The defect was `q[i + 4]`: four ROWS back, which is one YEAR back only for a
// dense filer. It passed every earlier check because every earlier check used
// AAPL and MU, which are dense. Measured on the preview, AZN rendered
// "+75.9% Compared with Q2 FY2021" against a latest quarter of Q2 FY2025.
//
// So what is asserted is the RULE, exercised against period SHAPES — a series
// with a hole, a series without one — and never against a number anyone chose.
// The rendered figures themselves are measured against real filings by
// scripts/sec-period-match-probe.mjs, which cannot supply its own answer
// because it fetches companyfacts.
{
  // ── THE MODULES secEarningsView READS FROM, LIFTED WITH IT ──────────────
  //
  // Stripping its imports leaves `cell`, `valueOf`, `ttm`, `periodLabel` and
  // `storedInReportingCurrency` free. This check only calls priorYearOf, which
  // touches none of them, so it passed — right up until something here called a
  // function that did. assertLiftIsClosed refuses the open lift outright now,
  // which is how this was found rather than reported later as a stopped run.
  const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  const viewMod = await lift(
    [
      readCodeOnly("lib/server/secFields.ts"),
      strip("lib/server/secExtract.ts"),
      strip("lib/server/fxRates.ts"),
      strip("lib/server/secCurrency.ts"),
      strip("lib/server/secFactCodec.ts"),
      strip(VIEW),
    ].join("\n"),
    "",
    "secEarningsView"
  );
  const P = (fp, fy) => ({ e: `${fy}-06-30`, s: `${fy}-04-01`, fp, fy, v: [], d: "" });
  const dense = [];
  for (let fy = 2026; fy >= 2024; fy--) for (const fp of ["Q4", "Q3", "Q2", "Q1"]) dense.push(P(fp, fy));

  check("a dense series finds the same fiscal quarter one year back",
    dense.slice(0, 4).every((p) => {
      const m = viewMod.priorYearOf(dense, p);
      return m && m.fp === p.fp && m.fy === p.fy - 1;
    }),
    "the regression case: AAPL and MU must not move");
  // AND IT AGREES WITH THE OLD RULE THERE. If it did not, the fix would have
  // changed a number it had no business changing.
  check("...and on a dense series that is exactly what q[i+4] was",
    dense.every((p, i) => {
      const oldBase = dense[i + 4] ?? null;
      const newBase = viewMod.priorYearOf(dense, p);
      return (oldBase?.e ?? null) === (newBase?.e ?? null);
    }),
    "so the dense filers are unaffected BY CONSTRUCTION, not by luck");

  // AZN's actual shape: half-yearly with a three-quarter hole.
  const holed = [P("Q2", 2025), P("Q2", 2024), P("Q2", 2023), P("Q2", 2022),
                 P("Q2", 2021), P("Q1", 2021), P("Q4", 2020), P("Q3", 2020)];
  check("a sparse series matches by label, NOT by four rows back",
    viewMod.priorYearOf(holed, holed[0])?.fy === 2024 &&
      (holed[0 + 4]?.fy) === 2021,
    "q[i+4] here is Q2 FY2021 — four years back, which is what rendered as +75.9%");
  // ── THE CASE THAT DISTINGUISHES THE TWO RULES, AND THE FIRST VERSION OF
  // THIS ASSERTION DID NOT ──────────────────────────────────────────────────
  // It asserted null for holed[5] and holed[6] — rows near the END of the
  // array, where q[i+4] is out of bounds and returns null too. Both rules give
  // the same answer there, so it could not fail. Caught by mutation: restoring
  // the nearest-row fallback left it PASSING.
  //
  // The distinguishing shape is a row where q[i+4] EXISTS and is the wrong
  // year. FY2024 is missing below, so the correct answer is null while q[i+4]
  // is a real period five years back.
  const missingYear = [P("Q2", 2025), P("Q2", 2023), P("Q2", 2022), P("Q2", 2021),
                       P("Q2", 2020), P("Q1", 2020), P("Q4", 2019), P("Q3", 2019)];
  check("...and returns null rather than the nearest row when the year is absent",
    viewMod.priorYearOf(missingYear, missingYear[0]) === null,
    `q[i+4] here is a real period (${missingYear[4].fp} FY${missingYear[4].fy}) and must NOT be used — ` +
      "a wrong base is worse than a blank, because a blank cannot be quoted");
  check("an unlabelled period has no comparator at all",
    viewMod.priorYearOf(holed, { e: "2025-06-30", fp: null, fy: null, v: [], d: "" }) === null,
    "fiscalLabel could not place it, so nothing here can either");
  // Q1 wraps to Q4 of the previous fiscal year, which is the one case an
  // arithmetic-on-fp implementation gets wrong.
  check("consecutiveness wraps Q1 to the prior year's Q4",
    viewMod.isConsecutive(P("Q1", 2026), P("Q4", 2025)) === true &&
      viewMod.isConsecutive(P("Q1", 2026), P("Q4", 2024)) === false &&
      viewMod.isConsecutive(P("Q2", 2025), P("Q2", 2022)) === false);
}

console.log("\n7c. the score cannot claim an input it did not read");

// THE FAILURE SHAPE: a component supplying its own favourable answer. AZN
// rendered GOOD 100/100 with "reported profit is backed by cash" above a
// Quality of Earnings card whose every field was "—". The scorer awarded no
// points for the missing chain; the SENTENCE was canned per tone and said it
// anyway.
{
  const cashClause = /backed by cash|cash conversion/;
  // FROM THE COMMENT-STRIPPED SOURCE. The docblock above this function QUOTES
  // the sentence it is documenting ("reported profit is backed by cash."), and
  // an inline comment names it again — so a containment check run over the raw
  // text finds the phrase outside the guard and fails on prose. The property is
  // about code.
  const expl = (scoreCode.match(/function scoreExplanation[\s\S]*?\n\}/) ?? [""])[0];
  // ── NO CASH CLAUSE AT ALL, NOW ─────────────────────────────────────────
  // The narrative became one hedged sentence built from the page's own
  // revenue, operating-margin and profit figures (cleanup brief A3/A4). The
  // cash card states its own figures; a summary of them here was the AZN
  // defect in the first place, so the property is now the stronger one: the
  // sentence has no cash wording to guard.
  check("the narrative carries no cash wording to mis-state",
    expl.length > 200 && !cashClause.test(expl),
    `scoreExplanation ${expl.length}b`);
  check("...and each clause states its own figure with its own sign, never the overall tone",
    /toneForGrowth\(rev\)/.test(expl) && /toneForMarginDelta\(pp\)/.test(expl) && !/tone === "good"/.test(expl),
    "the old clauses were chosen by the score's tone — AVAV read 'margins are slipping' beside +13.0pp");
  check("...and it instructs nobody",
    !/\b(should|must)\b/i.test(expl) && /may show/.test(expl),
    "'Investors should focus on…' was the old close");
  check("the score reports WHICH components it could not read",
    /unavailable: scoreGaps\(ran, basis\)/.test(scoreRaw) && /function scoreGaps/.test(scoreRaw),
    "a count would hide the one that mattered");
  check("...and the score card renders each one WITH ITS CAUSE",
    /partialScoreNote\(coverage, score\.unavailableWhy/.test(cardsRaw) &&
      /unavailableWhy:[\s\S]{0,200}gapReason\(k, view\)/.test(scoreRaw),
    "the number is only readable next to its own gaps, and 'the filings do not carry it' was false for AVAV's EPS");
  // RUN, not read. The source-level version of this pinned `ran.add(...)` inside
  // the accruals branch and broke when that line became contribute(); the
  // property it was after is that a null chain produces NO entry at all.
  check("an absent input adds no points and no signal",
    /if \(acc != null && ni != null && ni !== 0\) \{\s*contribute\("cashConversion"/.test(scoreRaw),
    "the guard is on the value, so a null chain cannot contribute a default");
  // The behavioural half is section 7e's `absent` case, which scores a shape
  // with accruals: null and asserts the key is missing from contributions.
  check("the side-column cash bullet is conditional too",
    /score\.unavailable\.includes\(SCORE_COMPONENTS\.cashConversion\)/.test(pageRaw),
    "it read as a claim on a page where the chain is empty");
}

/**
 * THE SCORER, LIFTED AND RUNNABLE — built once, used by every section that
 * needs to RUN it rather than read it.
 *
 * Two sections lift the same scorer (7e's period-mixing arithmetic and 7g's
 * bands), and two copies of a 12-line lift is two chances to lift a different
 * subset and assert against different code.
 */
async function liftScorer() {
  const consts = [...scoreRaw.matchAll(/^export const (SCORE_[A-Z_]+)[^=]*= ([\s\S]*?);$/gm)]
    .map((m) => `const ${m[1]} = ${m[2].replace(/ as const$/, "")};`).join("\n");
  // NOTE: `consts` above already picks up SCORE_BANDS — it matches every
  // top-level `const SCORE_*`. Lifting it a second time declares it twice and
  // the module throws, so the type annotation is stripped in place instead.
// THE PERIOD VOCABULARY COMES WITH IT. scoreExplanation and scoreGaps read
// periodWords, and scoreFromSec narrows its inputs with isPct — lifting the
// scorer without them throws at call time rather than asserting anything.
const vocab = [
  (readCodeOnly(VIEW).match(/export const PERIOD_WORDS[\s\S]*?\n\};/) ?? [""])[0]
    .replace("export const", "const").replace(/: Record<[\s\S]*?\}> =/, " ="),
  (readCodeOnly(VIEW).match(/export const periodWords = [^;]+;/) ?? [""])[0].replace("export const", "const"),
  (readCodeOnly(VIEW).match(/export const NOT_MEANINGFUL = [^;]+;/) ?? [""])[0].replace("export const", "const"),
  (readCodeOnly(VIEW).match(/export const isPct = [^;]+;/) ?? [""])[0].replace("export const", "const"),
].join("\n");
const scoreComponentsSrc = unexport((scoreRaw.match(/export const scoreComponents = \(basis: PeriodBasis\)[\s\S]*?\n\};/) ?? [""])[0]);
return lift(
    [vocab, scoreComponentsSrc, consts.replace(/: \{ tone: EarningsTone; label: string; from: number \}\[\]/, ""),
   unexport(grabFunction(scoreRaw, "clamp")), unexport(grabFunction(scoreRaw, "toneLabel")),
   unexport(grabFunction(scoreRaw, "bandFor")),
   // THE NARRATIVE READS THE PAGE'S OWN BANDS AND MARGIN PAIR, and the gap
   // reasons read the view — lifted from their sources, never pinned.
   ...["GROWTH_BAND_PCT", "MARGIN_BAND_PP"].map((n) =>
     (readCodeOnly("lib/server/secPresentation.ts").match(new RegExp(`export const ${n} = [^;]+;`)) ?? [""])[0].replace("export const", "const")),
   unexport(grabFunction(readCodeOnly("lib/server/secPresentation.ts"), "toneForGrowth")),
   unexport(grabFunction(readCodeOnly("lib/server/secPresentation.ts"), "toneForMarginDelta")),
   unexport(grabFunction(scoreRaw, "anchorMarginDelta")), unexport(grabFunction(scoreRaw, "gapReason")),
   unexport(grabFunction(scoreRaw, "scoreExplanation")), unexport(grabFunction(scoreRaw, "scoreGaps")),
   unexport(grabFunction(scoreRaw, "buildScoreResult")), unexport(grabFunction(scoreRaw, "scoreFromSec")),
   // CALLED BY buildScoreResult AND NOT LIFTED WITH IT. Same shape as the view
   // lift above: the assertions here never reached the branch that calls it, so
   // the gap sat unnoticed until assertLiftIsClosed refused the lift.
   unexport(grabFunction(scoreRaw, "noScoreReason")),
 unexport(grabFunction(scoreRaw, "scoreBandNote"))].join("\n") +
    "\nexport { scoreFromSec, scoreComponents, toneLabel, bandFor, scoreBandNote };"
);
}

console.log("\n7d. an absent component leaves the scale — it is not a penalty");

// ── THE MIRROR-IMAGE FAILURE ──────────────────────────────────────────────
// AZN scored 80, which is exactly four fifths, and a percentage over a FIXED
// denominator of five would produce the same number. If that were the scale, a
// filer whose cash chain cannot yield a quarterly figure would be capped at 80
// forever — we would have replaced a score that claimed an input it could not
// see with one that punished the filer for the page's own limit.
//
// It is not that scale, and this asserts the arithmetic rather than saying so.
{
  const seed = Number((scoreRaw.match(/SCORE_SEED = (\d+)/) ?? [])[1]);
  const maxes = Object.fromEntries(
    [...(scoreRaw.match(/SCORE_MAX_CONTRIBUTION: Record<ScoreComponent, number> = \{([\s\S]*?)\};/) ?? ["", ""])[1]
      .matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])])
  );
  check("the scale is a seed plus signed contributions, not a percentage",
    seed === 50 && Object.keys(maxes).length === 5,
    `seed ${seed}, ${Object.keys(maxes).length} components: ${JSON.stringify(maxes)}`);
  // THE DECIDING SUM. Every component except cash, at its maximum, must still
  // reach the top of the scale.
  const withoutCash = seed + Object.entries(maxes)
    .filter(([k]) => k !== "cashConversion").reduce((a, [, v]) => a + v, 0);
  check("a filer with NO cash component can still reach 100",
    withoutCash >= 100,
    `${seed} + ${withoutCash - seed} = ${withoutCash} -> clamps to 100. ` +
      "Anything below 100 here is a silent cap and a penalty for an absent input");
  // ── AND FOR EVERY OTHER COMPONENT, THE HONEST PROPERTY IS NOT "REACHES 100"
  // The first version of this asserted 100 for all five and FAILED on two:
  // without revenueGrowth the reachable maximum is 96 and without epsGrowth 98,
  // because those are the two dominant terms. That is not a deduction — an
  // absent component still contributes exactly 0 — it is simply a lower ceiling
  // when there are fewer signals to add.
  //
  // What must hold is that no component's absence can PREVENT A READING. The
  // tone thresholds are the thing a reader acts on, so the assertion is that
  // every reachable maximum clears STRONG with room, and the actual figures are
  // printed so the 96 and the 98 are on the record rather than hidden by a
  // loosened bound.
  // FROM THE BAND TABLE, which is now the only place a threshold is written.
  // The old regex read `rounded >= 66 ? "good"` out of an inline ternary; that
  // ternary is gone and a regex that matches nothing returns NaN, which every
  // comparison then fails — silently, in the direction that looks like a real
  // finding. Reading the table is both correct and impossible to half-match.
  const strongAt = Number(
    (scoreRaw.match(/\{ tone: "good", label: "[^"]*", from: (\d+) \}/) ?? [])[1]
  );
  check("the STRONG threshold is readable from the band table",
    Number.isFinite(strongAt), `top band starts at ${strongAt}`);
  const reachable = Object.fromEntries(Object.keys(maxes).map((k) => [
    k,
    Math.min(100, seed + Object.entries(maxes).filter(([x]) => x !== k)
      .reduce((a, [, v]) => a + v, 0)),
  ]));
  check("no component's absence can prevent a STRONG reading",
    Object.values(reachable).every((r) => r >= strongAt + 20),
    `STRONG is >= ${strongAt}; reachable maxima without each component: ` +
      JSON.stringify(reachable));
  check("...and an absent component contributes exactly zero, not a default",
    /const pts = sc/.test("") ||
      /if \(isPct\(s\.revenueYoY\)\) contribute\(/.test(scoreRaw) &&
      /if \(isPct\(s\.epsYoY\)\) contribute\(/.test(scoreRaw) &&
      /if \(s\.netIncome\.val != null\) contribute\(/.test(scoreRaw) &&
      /if \(opMargins\.length >= 2\) \{\s*contribute\(/.test(scoreRaw) &&
      /if \(acc != null && ni != null && ni !== 0\) \{\s*contribute\(/.test(scoreRaw),
    "every contribute() sits behind a guard on its own input, with no else");
  check("points, membership and the recorded amount are ONE act",
    /const contribute = \(key: ScoreComponent, points: number\) => \{[\s\S]{0,200}score \+= points;[\s\S]{0,120}ran\.add\(key\);[\s\S]{0,120}contributions\[key\] = points;/
      .test(scoreRaw),
    "three separate statements are three chances for the total and the list to disagree");
  check("no component adds points outside contribute()",
    (scoreRaw.match(/score \+=/g) ?? []).length === 1,
    "the only `score +=` is inside contribute");
}

console.log("\n7e. the cash card is ONE period, and says which");

// THE TRAP: annual operating cash flow against QUARTERLY net income reads as
// roughly 4x cash conversion, and the score would call it STRONG for a purely
// arithmetic reason. Every figure on the card must come from one period.
{
  const viewRaw = fs.readFileSync(VIEW, "utf8");
  check("one period selects the WHOLE card, not a per-row fallback",
    /const cashFrom = /.test(viewRaw) &&
      (viewRaw.match(/view\(cashFrom, "/g) ?? []).length === 4 &&
      /valueOf\(cashFrom, "netIncome"\)/.test(viewRaw),
    "operating cash flow, capex, net income and share-based compensation all read cashFrom");
  // SCOPED TO THE cashQuality BLOCK. The first version scanned the whole file
  // and failed on the SNAPSHOT card's `view(latest, "netIncome", ...)`, which
  // is correctly quarterly — the snapshot is about the quarter. A check that
  // cannot tell the two cards apart would have to be loosened to pass, and a
  // loosened version would stop seeing the real leftover too.
  const cashBlock = viewRaw.slice(
    viewRaw.indexOf("    cashQuality: {"),
    viewRaw.indexOf("    balance: bsAt")
  );
  check("no cash-card figure reads the latest QUARTER directly",
    cashBlock.length > 200 && !/view\(latest,|valueOf\(latest,/.test(cashBlock),
    `cashQuality block ${cashBlock.length}b — non-empty, so a mis-sliced block ` +
      `cannot pass this by being blank`);
  check("the accruals line takes both legs from the same period",
    /accruals:[\s\S]{0,200}valueOf\(cashFrom, "netIncome"\)[\s\S]{0,120}valueOf\(cashFrom, "netIncome"\)!/
      .test(viewRaw),
    "this is the line that would read as 4x");
  check("the card names its own period rather than the page's latest quarter",
    /<h3>Is the profit turning into cash\? — \{c\.period\}<\/h3>/.test(cardsRaw),
    "it used to say view.latestLabel, which is the quarter the rest of the page is about");
  check("...and says so explicitly when the basis is the year",
    /c\.basis === "year" \?/.test(cardsRaw) &&
      /does not publish a quarterly cash-flow statement/.test(cardsRaw),
    "a reader must not have to infer that the numbers changed period");
  check("the score's narrative cannot describe annual cash as the quarter's",
    !/cash/i.test((scoreCode.match(/function scoreExplanation[\s\S]*?\n\}/) ?? [""])[0]),
    "it no longer describes the cash leg at all; the cash card names its own period");

  // ── THE 4x TRAP, RUN RATHER THAN DESCRIBED ────────────────────────────────
  // The mixed comparison is not a style problem, it is a number. The SHIPPED
  // scorer is run over one shape twice — the same annual cash flow against the
  // annual net income, then against the quarterly one — and the difference is
  // the inflation the period rule exists to prevent. No fixture supplies an
  // expected score; both numbers come out of the scorer.
  // AZN's real shape: annual operating cash flow 14.575bn, annual net income
  // 10.225bn, quarterly net income 2.45bn. The accrual is the same either way;
  // only the denominator moves.
  const scorer = await liftScorer();
  const shape = (basis, period, ni) => ({
    snapshot: { revenueYoY: 11.75, epsYoY: 26.6, netIncome: { val: 2.45e9 } },
    margins: [{ operating: 5.0 }, { operating: 21.5 }, { operating: 21.2 }, { operating: 24.3 }],
    cashQuality: { accruals: 4.35e9, netIncome: { val: ni }, basis, period },
  });
  const matched = scorer.scoreFromSec(shape("year", "FY2025", 1.0225e10));
  const mixed = scorer.scoreFromSec(shape("quarter", "Q2 FY2025", 2.45e9));
  const absent = scorer.scoreFromSec({
    ...shape("year", "FY2025", 1.0225e10),
    cashQuality: { accruals: null, netIncome: { val: null }, basis: "year", period: "FY2025" },
  });
  check("matching the periods keeps the cash term inside its range",
    matched.contributions.cashConversion > 0 &&
      matched.contributions.cashConversion < 10,
    `+${matched.contributions.cashConversion.toFixed(2)} of a possible 10 -> ${matched.score}/100`);
  check("...where mixing them PINS it at the maximum",
    mixed.contributions.cashConversion === 10 && mixed.score > matched.score,
    `mixed would score ${mixed.score}/100 against ${matched.score}/100 — ` +
      `+${mixed.score - matched.score} points bought by dividing an annual cash flow ` +
      `by a quarterly profit`);
  check("and neither narrative claims cash, whichever period the cash leg read",
    !/cash/i.test(matched.explanation) && !/cash/i.test(absent.explanation) &&
      /the quarter was profitable/i.test(absent.explanation),
    `"${matched.explanation.slice(-60)}" | "${absent.explanation.slice(-60)}"`);
}

console.log("\n7f. one message per situation, and none of them contradicts a card");

// ── THE DEFECT: ONE SENTENCE SERVING SIX SITUATIONS ───────────────────────
// The unavailable score read "This company's SEC filings have not been read
// into the site yet" whenever the view was null. On /stock/RYAAY/earnings that
// sat at the top of a page whose own card said "Its filings are available now
// on SEC EDGAR" — two statements about the same company contradicting each
// other, three inches apart. RYAAY has been read in; it reports in euros.
{
  const reason = (scoreCode.match(/function noScoreReason[\s\S]*?\n\}/) ?? [""])[0];
  check("the no-score reason branches on the cold status, not on view === null",
    /cold\.status === "no-xbrl"/.test(reason) && /switch \(cold\.why\)/.test(reason),
    "one message for six situations is how a page contradicts itself");
  // EVERY why THE COLD PATH CAN PRODUCE MUST BE ANSWERED, derived from the
  // union in secColdFetch rather than from a list kept here — a new why added
  // there would otherwise fall silently into the default.
  const coldRaw = fs.readFileSync("lib/server/secColdFetch.ts", "utf8");
  const whys = [...(coldRaw.match(/why: "[^"]+"/g) ?? [])]
    .map((m) => m.slice(6, -1)).filter((w, i, a) => a.indexOf(w) === i).sort();
  const answered = whys.filter((w) => new RegExp(`case "${w}":`).test(reason));
  const viaDefault = whys.filter((w) => !answered.includes(w));
  check("every cold `why` is either named or deliberately in the default",
    whys.length >= 4 && /default:/.test(reason),
    `named: ${answered.join(", ") || "none"} | via default: ${viaDefault.join(", ") || "none"} ` +
      `(of ${whys.length} the cold path can produce)`);
  // ── RUN, NOT POSITIONED ───────────────────────────────────────────────────
  // The first version of the two assertions below compared lastIndexOf() of
  // two substrings and called that "the last branch". A mutation that inserted
  // an early `return` at the TOP of the function left both positions unchanged
  // and the check PASSED. That is the third time on this work that a check has
  // measured a position in a file and called it an order of execution.
  //
  // So the function is lifted and called once per state, and the assertion is
  // on the sentence it returns.
  const reasonFn = (await lift(`export ${unexport(grabFunction(scoreRaw, "noScoreReason"))}`)).noScoreReason;
  const say = (cold, hasSet) => reasonFn("RYAAY", cold, hasSet);
  const cases = {
    currency: say({ status: "no-xbrl", why: "currency", taxonomies: ["EUR"] }, true),
    unreadTaxonomy: say({ status: "no-xbrl", why: "unread-taxonomy", taxonomies: ["ffd"] }, true),
    none: say({ status: "no-xbrl", why: "none", taxonomies: [] }, true),
    unknown: say({ status: "no-xbrl", why: "unknown", taxonomies: [] }, true),
    noQuarters: say({ status: "ready" }, true),
    pending: say({ status: "pending", reason: "x" }, false),
  };
  const NOT_READ = "have not been read into the site yet";
  check("'not read in yet' is said for the pending state and NO other",
    cases.pending.includes(NOT_READ) &&
      Object.entries(cases).filter(([k]) => k !== "pending")
        .every(([, v]) => !v.includes(NOT_READ)),
    Object.entries(cases).map(([k, v]) => `${k}: ${v.includes(NOT_READ) ? "SAYS IT" : "ok"}`).join(" | "));
  check("...and RYAAY's own state names the currency instead",
    /reports in EUR/.test(cases.currency) && /have been read/.test(cases.currency),
    `"${cases.currency}"`);
  check("a read-in filer with data but no quarters gets its own sentence",
    /has filed no quarterly periods/.test(cases.noQuarters) &&
      !cases.noQuarters.includes(NOT_READ),
    `"${cases.noQuarters}"`);
  check("every state returns a distinct sentence",
    new Set(Object.values(cases)).size >= 5,
    `${new Set(Object.values(cases)).size} distinct of ${Object.keys(cases).length} states`);
  // AND THE CARD STACK HAS THE SAME BRANCH. The score card was the half the
  // review saw; the cards below fell through to SecPendingCard, which promises
  // a quarter that will never arrive.
  check("...and the card stack no longer renders PENDING for that filer",
    /!secView && data\.cold\.status === "ready" \? \(\s*<SecNoQuartersCard/.test(pageCode),
    "KGC stores 5 years, 8 instants and 24 populated fields, and zero quarters");
  const noQ = (() => {
    const start = cardsRaw.indexOf("export function SecNoQuartersCard(");
    const rest = cardsRaw.slice(start);
    return rest.slice(0, rest.indexOf("\nexport ", 1));
  })();
  check("that card does not read as temporary either",
    noQ.length > 200 && !/check back|being fetched|not loaded yet|coming soon/i.test(noQ),
    `${noQ.length}b — it will never stop being true, so it must not sound like waiting`);
}

console.log("\n7g. explanations a phone can read, and three periods declared");

{
  // HOVER-ONLY IS INVISIBLE ON TOUCH. The gap badge explained itself in an
  // <abbr title>, which most of this audience cannot trigger at all.
  const growthCard = (() => {
    const start = cardsRaw.indexOf("export function SecGrowthMarginsCard(");
    const rest = cardsRaw.slice(start);
    return rest.slice(0, rest.indexOf("\nexport ", 1));
  })();
  const intro = growthCard.slice(growthCard.indexOf("<p>"), growthCard.indexOf("</p>"));
  check("the gap marker is explained in visible text, not only in a title",
    intro.length > 200 && /marked <strong>gap<\/strong>/.test(intro) &&
      /not a consecutive run/.test(intro),
    `intro ${intro.length}b — a title attribute cannot be reached on a touch screen`);
  // THE THREE PERIODS. Said only when they are genuinely far apart, so a
  // normal 10-Q filer does not carry a standing disclaimer.
  check("the balance-sheet card declares its distance from the income statement",
    /BALANCE_SHEET_SPREAD_DAYS = \d+/.test(cardsRaw) &&
      /different date<\/strong> from the income statement above/.test(cardsRaw),
    "income statement, cash flow and balance sheet can be three periods under one lede");
  const days = Number((cardsRaw.match(/BALANCE_SHEET_SPREAD_DAYS = (\d+)/) ?? [])[1]);
  check("...and the threshold is about a quarter, so a 10-Q filer says nothing",
    days >= 80 && days <= 130,
    `${days} days — below this the two dates coincide and the line would be noise`);
  check("the spread is computed in the view, where a check can read it",
    /balanceSheetSpreadDays:/.test(fs.readFileSync(VIEW, "utf8")));
}

console.log("\n7h. the band the number falls in, and the period it was built on");

// ── THE #465 EYE-CHECK: KGC READ "100/100" UNDER A PILL SAYING "Good" ──────
// ...above a gauge whose axis was labelled Weak / Mixed / STRONG. Two
// vocabularies for one scale, and the axis named a top band the pill could
// never produce, so a perfect score looked as though it had fallen short.
//
// NOT A CLAMP BUG. `tone` is derived from `rounded` — the same clamped value
// the card prints — which the first assertion below pins by RUNNING the scorer
// past the top of the scale rather than by reading the source.
{
  const scorer2 = await liftScorer();
  const bands = [...scoreRaw.matchAll(/\{ tone: "(\w+)", label: "([^"]+)", from: (\d+) \}/g)]
    .map((m) => ({ tone: m[1], label: m[2], from: Number(m[3]) }));
  check("there is ONE band table, with a threshold on every band",
    bands.length === 3 && bands.every((b) => Number.isFinite(b.from)),
    bands.map((b) => `${b.label}>=${b.from}`).join(" "));

  // THE AXIS READS THE TABLE. A hardcoded axis is the defect itself, so the
  // assertion is that no band label is written out in the JSX.
  check("the gauge axis is rendered FROM the table, not written out",
    // IN THE CARDS FILE: the score card moved there so the render harness can
    // draw it (cleanup brief C).
    /scoreLabels[\s\S]{0,200}SCORE_BANDS[\s\S]{0,120}map\(/.test(cardsRaw) &&
      !/<span>Weak<\/span>/.test(cardsRaw + pageRaw),
    "Weak/Mixed/Strong as literals is how the axis and the pill drifted apart");

  // AND NO BAND NAME EXISTS THAT THE PILL CANNOT PRODUCE.
  const pillLabels = bands.map((b) => scorer2.toneLabel(b.tone));
  check("every label the axis can show is one the pill can show",
    pillLabels.length === bands.length &&
      bands.every((b, i) => pillLabels[i] === b.label),
    `axis: ${bands.map((b) => b.label).join("/")} | pill: ${pillLabels.join("/")}`);

  // ── CLAMPED, AND THE BAND FOLLOWS THE CLAMPED VALUE ─────────────────────
  // KGC's real arithmetic overflows the scale: 50 + 22 + 20 + 6 + 10 + 4.59.
  // The score prints 100 and the band must be the band for 100, not for 112.
  const over = scorer2.scoreFromSec({
    basis: "year",
    snapshot: { revenueYoY: 36.95, epsYoY: 153.25, netIncome: { val: 2.3901e9 } },
    margins: [{ operating: 2.77 }, { operating: 3.41 }, { operating: 18.9 }, { operating: 29.92 }, { operating: 46.48 }],
    cashQuality: { accruals: 1.3704e9, netIncome: { val: 2.3901e9 }, basis: "year", period: "FY2025" },
  });
  const top = bands[0];
  check("a score that overflows the scale prints 100 and lands in the top band",
    over.score === 100 && over.label === top.label,
    `${over.score}/100 -> "${over.label}"; raw sum was ${(over.seed + Object.values(over.contributions).reduce((a, b) => a + b, 0)).toFixed(2)}`);
  // BEHIND THE AXIS'S INFO MARK now, focusable so a tap shows it — not a
  // paragraph under the gauge (cleanup brief B).
  check("...and the thresholds are stated on the card rather than left implicit",
    new RegExp(`${top.label} is ${top.from} and above`).test(scorer2.scoreBandNote()) &&
      /<InfoTip text=\{scoreBandNote\(\)\}/.test(cardsRaw) && /tabIndex=\{0\}/.test(cardsRaw),
    scorer2.scoreBandNote());

  // ── POINT 5: THE SCORE SAYS WHICH KIND OF PERIOD IT READ ────────────────
  check("an annual filer's score carries its basis, and the card renders it",
    over.basis === "year" && /score\.basis === "year"/.test(cardsRaw) &&
      /files annually<\/strong>, so this score is built on its fiscal/.test(cardsRaw),
    "a reader comparing an annual score with a 10-Q filer's has to be told they differ");
  check("...and the component names follow it too",
    /the prior fiscal year/.test(scorer2.scoreComponents("year").revenueGrowth) &&
      /same quarter a year earlier/.test(scorer2.scoreComponents("quarter").revenueGrowth),
    `year: "${scorer2.scoreComponents("year").revenueGrowth}"`);

  // ── AND AN n/m NEVER REACHES THE ARITHMETIC ─────────────────────────────
  // KGC's FY2023 EPS swing out of a loss computed as +172.3%, which
  // clamp(v * 0.30, -20, 20) turns into the FULL +20 — the largest single
  // contribution the scale allows — for an artefact of a negative base.
  const withNm = scorer2.scoreFromSec({
    basis: "year",
    snapshot: { revenueYoY: 22.71, epsYoY: "n/m", netIncome: { val: 3.0e8 } },
    margins: [{ operating: 3.41 }, { operating: 18.9 }],
    cashQuality: { accruals: null, netIncome: { val: null }, basis: "year", period: "FY2023" },
  });
  const withNumber = scorer2.scoreFromSec({
    basis: "year",
    snapshot: { revenueYoY: 22.71, epsYoY: 172.34, netIncome: { val: 3.0e8 } },
    margins: [{ operating: 3.41 }, { operating: 18.9 }],
    cashQuality: { accruals: null, netIncome: { val: null }, basis: "year", period: "FY2023" },
  });
  check("an n/m EPS change contributes NOTHING to the score",
    withNm.contributions.epsGrowth === undefined,
    `contributions: ${JSON.stringify(withNm.contributions)}`);
  check("...and the identical shape with a real number DOES contribute, so the guard is not blanket",
    withNumber.contributions.epsGrowth === 20 &&
      withNumber.score - withNm.score === 20,
    `+${withNumber.contributions.epsGrowth} points, ${withNumber.score} vs ${withNm.score} — ` +
      "the exact points a sign flip out of a loss used to buy");
  check("and the n/m component is listed as unmeasured rather than silently dropped",
    withNm.unavailable.some((u) => /EPS growth/.test(u)),
    withNm.unavailable.join("; "));
}

console.log("\n7i. the meta description describes the page, not the price chart");

// ── THE #465 EYE-CHECK READ THE RENDERED META ─────────────────────────────
//   AAPL: "...cash flow and balance sheet, Uptrend, with year-over-year..."
//   KGC:  "...balance sheet, Range / Mixed, with..."
//
// A price-chart reading dropped as a bare label into an EARNINGS description.
// Two things wrong with it: this page is built on filed figures and says
// nothing about moving averages, and the label moves with the price, so the
// same page advertises itself differently on different crawls from data that
// is not on it.
//
// RUN, NOT GREPPED. generateMetadata is lifted and executed with its network
// reads stubbed, once per trend label the indicator can produce — so the
// assertion is that the label is absent from what the function RETURNS, with
// a trend deliberately available for it to use.
{
  // THE LABELS COME FROM THE INDICATOR, not from a list typed here: a fourth
  // label added there must not slip past this check.
  const indicators = readCodeOnly("lib/indicators.ts");
  const labels = [...new Set(
    [...indicators.matchAll(/"(Uptrend|Downtrend|Range \/ Mixed)"/g)].map((m) => m[1])
  )];
  check("the trend vocabulary is read from lib/indicators.ts",
    labels.length === 3, labels.join(" / "));

  // BOTH PAGES BUILT FROM THE SAME TEMPLATE. The earnings page's leak was found
  // by eye-check; /stock/[symbol]/news carried the identical `trendStr`
  // expression in the identical position. One of them being fixed is not the
  // property — neither carrying it is.
  const NEWS = "app/stock/[symbol]/news/page.tsx";
  const PAGES = [
    { name: "earnings", src: pageRaw },
    { name: "news", src: fs.readFileSync(NEWS, "utf8") },
  ];

  /** Run one page's generateMetadata with its network reads stubbed. */
  const runMeta = async (src, label, symbol) => {
    const mod = await lift(
      [
        "const cleanSymbol = (s) => String(s).toUpperCase();",
        "const getDailyHistory = async () => [{ date: \"2026-09-15\", close: 200 }];",
        "const fetchQuoteForMeta = async () => ({ price: 200, date: \"2026-09-15\" });",
        // A SEED WITH A TREND IN IT. The point is that one is AVAILABLE and
        // still does not reach the description — a stub returning null would
        // make this pass for the wrong reason.
        `const computeIndicatorSeed = () => ({ lastClose: 200, trend: ${JSON.stringify(label)} });`,
        // THE CIK GATE, STUBBED SO BOTH BRANCHES CAN BE EXERCISED. The earnings
        // page's generateMetadata now reads it to decide `index`, because the
        // no-registrant state is a 200 rather than a 404 and a 200 that can be
        // indexed as thin content is the cost of that. "NOCIK" is the symbol
        // that resolves to nothing; everything else resolves.
        'const cikForSymbol = (s) => (String(s).toUpperCase() === "NOCIK" ? null : "0000320193");',
        // NOT YET READ (#535 COWORK #13): "COLDX" has a CIK and no stored set.
        'const awaitingSecRead = async (s) => String(s).toUpperCase() === "COLDX";',
        grabFunction(src, "generateMetadata"),
      ].join("\n") + "\nexport { generateMetadata };"
    );
    return mod.generateMetadata({ params: Promise.resolve({ symbol }) });
  };

  // ── INDEXABILITY FOLLOWS THE CIK, NOT THE ROUTE ──────────────────────────
  // A symbol with filings is indexable; one with no registrant is not. The
  // second is the new state, and the whole reason the 404 could be dropped
  // safely: this route is enumerated, so a 200 that Google can index as thin
  // content would be a worse outcome than the 404 it replaced.
  {
    const withCik = await runMeta(pageRaw, labels[0], "AAPL");
    const without = await runMeta(pageRaw, labels[0], "NOCIK");
    check("a symbol with a CIK stays indexable",
      withCik.robots?.index === true, JSON.stringify(withCik.robots));
    check("a symbol with no registrant is noindex",
      without.robots?.index === false, JSON.stringify(without.robots));
    check("...and still follow, so a crawler is not stranded",
      without.robots?.follow === true,
      "the card links to a stock page that renders");
    // #535 COWORK #13: noindex exactly while a cold symbol has no stored set.
    const cold = await runMeta(pageRaw, labels[0], "COLDX");
    check("a cold symbol not yet read is noindex (#535 COWORK #13)",
      cold.robots?.index === false && cold.robots?.follow === true, JSON.stringify(cold.robots));
  }

  const metaSrc = grabFunction(pageRaw, "generateMetadata");
  const leaked = [];
  for (const { name, src } of PAGES) {
    for (const label of labels) {
      for (const symbol of ["AAPL", "KGC"]) {
        const meta = await runMeta(src, label, symbol);
        for (const [where, text] of [
          ["description", meta.description],
          ["og:description", meta.openGraph?.description],
          ["twitter:description", meta.twitter?.description],
        ]) {
          if (typeof text === "string" && text.includes(label)) {
            leaked.push(`${name} ${symbol} ${where}: ${label}`);
          }
        }
      }
    }
  }
  check("no trend label reaches description, og:description or twitter:description on EITHER page",
    leaked.length === 0,
    leaked.length ? leaked.join(" | ")
      : `${PAGES.length} pages x ${labels.length} labels x 2 symbols x 3 fields, all clean`);
  check("...and neither page's source still carries the interpolation",
    PAGES.every(({ src }) => !/trendStr/.test(src) && !/\$\{seed\.trend\}/.test(src)),
    PAGES.map(({ name }) => name).join(", "));

  // THE CONTROL. "No description anywhere mentions a trend" would also pass if
  // the trend had been removed from the stock page, where it is the subject.
  const seo = await lift(
    [grabFunction(indicators, "buildSeoDescription")].join("\n") + "\nexport { buildSeoDescription };"
  );
  const stockDesc = seo.buildSeoDescription("AAPL", {
    trend: "Uptrend", rsi: 55, ma50: 190, ma200: 180, lastClose: 200,
    macdLabel: null, trendScore: { known: false, passed: 0, total: 0 },
  });
  check("...while /stock/[symbol], whose subject IS the trend, still states it",
    /uptrend/i.test(stockDesc),
    `"${stockDesc.slice(0, 90)}..." — that page uses buildSeoDescription, which writes it as a sentence`);

  // ── AND IT READS AS ENGLISH ───────────────────────────────────────────────
  // It rendered "AAPL is in a uptrend" in the live meta description — on the
  // one page where the trend IS the subject, so it is the sentence a searcher
  // sees. Asserted on the RENDERED STRING for every trend the builder can
  // reach, not on the article helper in isolation.
  const seedFor = (trend) => ({
    trend, rsi: 55, ma50: 190, ma200: 180, lastClose: 200,
    macdLabel: null, trendScore: { known: false, passed: 0, total: 0 },
  });
  const articleBad = labels
    .map((t) => seo.buildSeoDescription("AAPL", seedFor(t)))
    .filter((d) => /\bis in a [aeiou]/i.test(d));
  check("no trend sentence reads \"a\" before a vowel",
    articleBad.length === 0,
    articleBad.length ? articleBad.map((d) => `"${d.slice(0, 50)}"`).join(" | ")
      : labels.map((t) => `"${seo.buildSeoDescription("AAPL", seedFor(t)).slice(0, 34)}"`).join(" "));

  // MUTATION: put the fixed article back and the vowel case must fail again.
  const badArticle = (src) =>
    src.replace(
      "`${symbol} is in ${article(trend)} ${trend.toLowerCase()}`",
      "`${symbol} is in a ${trend.toLowerCase()}`"
    );
  check("the article mutation actually applied", badArticle(indicators) !== indicators);
  const seoBad = await lift(
    [grabFunction(badArticle(indicators), "buildSeoDescription")].join("\n") +
      "\nexport { buildSeoDescription };"
  );
  check("MUTATION: hardcoding \"a\" brings \"a uptrend\" back",
    /\bis in a uptrend\b/i.test(seoBad.buildSeoDescription("AAPL", seedFor("Uptrend"))),
    "and leaves \"a downtrend\" correct, which is why the bug survived a read-through");

  // ── MUTATION: PUT THE INTERPOLATION BACK ────────────────────────────────
  // An absence is only an assertion if something can make it present. This
  // restores the exact expression that shipped and re-runs the same function.
  const restoreLeak = (src) =>
    src.replace(
      "margins, cash flow and balance sheet, with year-over-year context",
      "margins, cash flow and balance sheet${seed.trend ? `, ${seed.trend}` : \"\"}, with year-over-year context"
    );
  check("the trend-leak mutation actually applied", restoreLeak(metaSrc) !== metaSrc);
  const leakMod = await lift(
    [
      "const cleanSymbol = (s) => String(s).toUpperCase();",
      "const getDailyHistory = async () => [{ date: \"2026-09-15\", close: 200 }];",
      "const fetchQuoteForMeta = async () => ({ price: 200, date: \"2026-09-15\" });",
      "const computeIndicatorSeed = () => ({ lastClose: 200, trend: \"Uptrend\" });",
      // Same stub and same reason as runMeta above — the mutation harness lifts
      // the SAME function, so it needs the same closure.
      'const cikForSymbol = (s) => (String(s).toUpperCase() === "NOCIK" ? null : "0000320193");',
      'const awaitingSecRead = async () => false;',
      restoreLeak(metaSrc),
    ].join("\n") + "\nexport { generateMetadata };"
  );
  const leakedMeta = await leakMod.generateMetadata({ params: Promise.resolve({ symbol: "AAPL" }) });
  check("MUTATION: restoring it puts the bare label back in all three fields",
    [leakedMeta.description, leakedMeta.openGraph?.description, leakedMeta.twitter?.description]
      .every((t) => typeof t === "string" && t.includes("Uptrend")),
    `"${String(leakedMeta.description).slice(50, 130)}" — one variable feeds all three`);
}

console.log("\n8. the population path");

const jobRaw = fs.readFileSync("app/api/jobs/sec-facts/route.ts", "utf8");
check("the job is keyed on contentHash === null, not on a one-off list",
  /e\.contentHash === null/.test(jobRaw));
check("reverify and populate have SEPARATE allowances",
  /SEC_REVERIFY_PER_RUN/.test(jobRaw) && /SEC_POPULATE_PER_RUN/.test(jobRaw) &&
    !/SHARED_PER_RUN/.test(jobRaw));
check("a failed fetch does NOT clear needsReverify",
  /NOT CLEARED ON FAILURE/.test(jobRaw));
check("the run logs one line whatever happens",
  /console\.log\("\[sec-facts\]"/.test(jobRaw));
check("a content-hash move with no filing event is logged as a silent restatement",
  /SILENT RESTATEMENT/.test(jobRaw));
check("it is registered as a cron",
  JSON.parse(fs.readFileSync("vercel.json", "utf8")).crons.some((c) => c.path === "/api/jobs/sec-facts"));

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nThe earnings page's source properties hold.\n");
process.exit(failures ? 1 : 0);
