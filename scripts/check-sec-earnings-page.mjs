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
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const PAGE = "app/stock/[symbol]/earnings/page.tsx";
const CARDS = "app/stock/[symbol]/earnings/SecEarningsCards.tsx";
const VIEW = "lib/server/secEarningsView.ts";

const pageRaw = fs.readFileSync(PAGE, "utf8");
// readCodeOnly strips /* */ and // — it does NOT strip {/* ... */}, which is a
// JSX EXPRESSION containing a comment, and the page is full of them recording
// what moved off FMP. Scanning for user-visible text has to drop those too, or
// the record of the migration reads as a promise the page is still making.
const stripJsxComments = (src) => src.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");
const pageCode = stripJsxComments(readCodeOnly(PAGE));
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
// /earnings STAYS, and on purpose: the announcement date and its bmo/amc timing
// are not in SEC filings, and the price-reaction card needs the session the
// market reacted in. Asserted so a later tidy-up does not remove it silently.
check("/earnings IS still called — the announcement date is not in SEC filings",
  pageCode.includes("`/earnings?symbol="),
  "price-derived, and this pass does not touch price-derived data");

console.log("\n5. labels");

check("EPS is labelled GAAP wherever it is named",
  (cardsRaw.match(/EPS \(GAAP\)/g) ?? []).length >= 3,
  `${(cardsRaw.match(/EPS \(GAAP\)/g) ?? []).length} occurrences`);
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
check("and the page says the labels are the company's own fiscal calendar",
  /own fiscal calendar/.test(cardsRaw));

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
  const viewMod = await lift(
    fs.readFileSync(VIEW, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
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
  const expl = (pageRaw.match(/function scoreExplanation[\s\S]*?\n\}/) ?? [""])[0];
  check("the cash clause is guarded by the cash component having run",
    /if \(ran\.has\("cashConversion"\)\) \{[\s\S]{0,160}backed by cash/.test(expl),
    "it used to be emitted from the tone alone");
  check("no cash wording sits outside that guard",
    (expl.match(new RegExp(cashClause, "g")) ?? []).length ===
      (expl.match(/ran\.has\("cashConversion"\)[\s\S]{0,200}?backed by cash[\s\S]{0,80}?cash conversion is weak/) ? 2 : -1),
    "both the good and the weak phrasing must be inside the one branch");
  check("the score reports WHICH components it could not read",
    /unavailable: scoreGaps\(ran\)/.test(pageRaw) && /function scoreGaps/.test(pageRaw),
    "a count would hide the one that mattered");
  check("...and the page renders that list on the score card itself",
    /score\.available && score\.unavailable\.length/.test(pageRaw),
    "the number is only readable next to its own gaps");
  check("an absent input adds no points and no signal",
    /if \(acc != null && ni != null && ni !== 0\) \{[\s\S]{0,160}ran\.add\("cashConversion"\)/.test(pageRaw),
    "the guard is on the value, so a null chain cannot contribute a default");
  check("the side-column cash bullet is conditional too",
    /score\.unavailable\.includes\(SCORE_COMPONENTS\.cashConversion\)/.test(pageRaw),
    "it read as a claim on a page where the chain is empty");
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
  const seed = Number((pageRaw.match(/const SCORE_SEED = (\d+)/) ?? [])[1]);
  const maxes = Object.fromEntries(
    [...(pageRaw.match(/SCORE_MAX_CONTRIBUTION: Record<ScoreComponent, number> = \{([\s\S]*?)\};/) ?? ["", ""])[1]
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
  const strongAt = Number((pageRaw.match(/rounded >= (\d+) \? "good"/) ?? [])[1]);
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
      /if \(s\.revenueYoY != null\) contribute\(/.test(pageRaw) &&
      /if \(s\.epsYoY != null\) contribute\(/.test(pageRaw) &&
      /if \(s\.netIncome\.val != null\) contribute\(/.test(pageRaw) &&
      /if \(opMargins\.length >= 2\) \{\s*contribute\(/.test(pageRaw) &&
      /if \(acc != null && ni != null && ni !== 0\) \{\s*contribute\(/.test(pageRaw),
    "every contribute() sits behind a guard on its own input, with no else");
  check("points, membership and the recorded amount are ONE act",
    /const contribute = \(key: ScoreComponent, points: number\) => \{[\s\S]{0,200}score \+= points;[\s\S]{0,120}ran\.add\(key\);[\s\S]{0,120}contributions\[key\] = points;/
      .test(pageRaw),
    "three separate statements are three chances for the total and the list to disagree");
  check("no component adds points outside contribute()",
    (pageRaw.match(/score \+=/g) ?? []).length === 1,
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
  check("the score's narrative names the period when the cash leg is annual",
    /cashBasis === "year" \? ` over \$\{cashPeriod\}`/.test(pageRaw),
    "otherwise quarterly growth and annual cash are described as one period");
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
