// The spelling helper, and the fail-open trap it exists to close.
//
// The preferred/baby-bond exclusion joins the universe against
// nasdaqtraded.txt's Security Name. Nasdaq Trader spells suffixed preferreds
// with "$" (BAC$K) and the universe uses a dash (MER-PK), so a naive join
// returns null for exactly those rows -- and a null name reads as "not a
// preferred". The test then passes through the securities it exists to catch
// and is INDISTINGUISHABLE FROM A WORKING TEST THAT FOUND NOTHING.
//
// Everything below is a pure function over strings: no network, no dump.
import fs from "node:fs";
import { symbolSpellings, lookupBySpelling, classifySecurityName, describeSecurityName } from "./lib/symbol-spellings.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
console.log("symbol spellings");

// THE ASSERTION THAT MATTERS, and it is deliberately on a SUFFIXED preferred.
// The two shapes differ: suffixed preferreds (MER-PK, MKC-V, EP-PC) need the
// "$" form, while baby bonds carry plain alphabetic tickers (TBB, PFH, UNMA)
// and join as-is. A spot check on TBB passes and says nothing about the
// suffixed half, which is the half that breaks.
for (const [sym, want] of [["MER-PK", "MER$K"], ["EP-PC", "EP$C"], ["MKC-V", "MKC$V"], ["CTA-PA", "CTA$A"]]) {
  check(`${sym} generates its dollar spelling`, symbolSpellings(sym).includes(want),
    symbolSpellings(sym).join(" "));
}
check("the dot/dash pair still works",
  symbolSpellings("BRK.B").includes("BRK-B") && symbolSpellings("BRK-B").includes("BRK.B"));
check("a plain baby-bond ticker is left alone",
  ["TBB", "PFH", "UNMA"].every((s) => symbolSpellings(s).length === 1),
  "they join correctly as-is, which is why checking one of them proves nothing");

// REAL SECURITY NAMES, CAPTURED FROM nasdaqtraded.txt — NOT INVENTED.
//
// The first version of this fixture contained
//   ["MER$K", "Merrill Lynch Depositary Shares, Preferred Stock Series K"]
// which I made up, and then asserted that MER$K matches /preferred/i. It passed.
// The real name is "Bank of America Corporation Income Capital Obligation Notes
// initially due December 15, 2066" -- no "Preferred" anywhere in it. The
// assertion could never have passed against the real file, so it was passing
// against a fixture written to satisfy it. Same failure as §17.
//
// Every string below is captured. Add to this list only from the live file.
const NASDAQ_NAMES = new Map([
  ["BAC", "Bank of America Corporation Common Stock"],
  ["BAC$K", "Bank of America Corp. Depositary Shares, each representing a 1/1,000th interest in a share of 5.875% Non-Cumulative Preferred Stock, Series HH"],
  ["MER$K", "Bank of America Corporation Income Capital Obligation Notes initially due December 15, 2066"],
  ["EP$C", "El Paso Corporation Preferred Stock"],
  ["T$A", "AT&T Inc. Depositary Shares, 5.000% Perpetual Preferred Stock, Series A"],
  ["TBB", "AT&T Inc. 5.350% Global Notes due 2066"],
  ["PFH", "Prudential Financial 4.125% Junior Subordinated Notes due 2060"],
  ["UNMA", "Unum Group 6.250% Junior Subordinated Notes due 2058"],
  ["EMBJ", "Embraer S.A. Common Stock"],
  ["MKC.V", "McCormick & Company, Incorporated Common Stock"],
  ["GOOG", "Alphabet Inc. - Class C Capital Stock"],
  ["CCXIW", "Churchill Capital Corp XI - Warrants"],
  ["NOVTU", "Novanta Inc. - Tangible Equity Units"],
  // ADRs. THE LARGEST POPULATION IN THE UNIVERSE: 49 of the 55 periodic filers
  // in the measured window were 6-K filers, i.e. foreign private issuers. ARM
  // is the symbol this project was audited against, and a single known-good
  // ACCEPT list rejected it -- along with 8 of the other 24 ADRs tested live.
  ["ARM", "Arm Holdings plc - American Depositary Shares"],
  // TRUNCATED CAPTURES, and marked as such rather than completed by guesswork.
  // The live values ran past the console width; what is stored is the exact
  // captured prefix. That is sufficient for the marker under test -- the accept
  // token appears inside it -- but these are NOT full names and must not be
  // treated as such if anything later needs the whole string.
  ["BIDU", "Baidu, Inc. - American Depositary Shares, each representing 8..."],
  ["GSK", "...American Depositary Shares (Each representing two Ordinary..."],
]);
const TRUNCATED = new Set(["BIDU", "GSK"]);

// ASSERT ON THE SHAPES, NOT ON ONE SYMBOL. These five behave differently, and
// one passing proves nothing about the others -- which is exactly what this
// round demonstrated.
const SHAPES = [
  ["EP-PC", "EP$C", "not-common", "$ preferred"],
  ["MER-PK", "MER$K", "not-common", "$ note (contains no 'Preferred' at all)"],
  ["MKC-V", "MKC.V", "common", ". share class — SAME name as its parent"],
  ["TBB", "TBB", "not-common", "plain-ticker note"],
  ["EMBJ", "EMBJ", "common", "plain-ticker common stock"],
  // THE SIXTH SHAPE, and five was not enough. An ADR whose name does NOT spell
  // out the underlying is the case a single accept list silently rejects.
  ["ARM", "ARM", "common", "ADR — name ends at 'American Depositary Shares'"],
  ["BIDU", "BIDU", "common", "ADR — underlying not spelled out"],
  ["GSK", "GSK", "common", "ADR — underlying IS spelled out; must not be the only passing route"],
];
for (const [universeSym, expectSpelling, expectClass, shape] of SHAPES) {
  const hit = lookupBySpelling(NASDAQ_NAMES, universeSym);
  check(`${universeSym} resolves as ${expectSpelling} — ${shape}`,
    Boolean(hit) && hit.matched === expectSpelling,
    hit ? `matched as ${hit.matched}` : "UNRESOLVED — the fail-open path");
  check(`...and classifies as ${expectClass}`,
    Boolean(hit) && classifySecurityName(hit.value) === expectClass,
    hit ? `${classifySecurityName(hit.value)} · "${String(hit.value).slice(0, 56)}…"` : "no name");
}
check("a dash-only join would have missed the $ and . forms",
  !NASDAQ_NAMES.has("EP-PC") && !NASDAQ_NAMES.has("MER-PK") && !NASDAQ_NAMES.has("MKC-V"),
  "which is why an unresolved name must never be read as common stock");

// THE CLASSIFIER MUST NOT FAIL OPEN.
check("an absent Security Name classifies as UNKNOWN, never as common",
  classifySecurityName(null) === "unknown" &&
    classifySecurityName("") === "unknown" &&
    classifySecurityName("   ") === "unknown");
// THE DECISION FUNCTION IS BINARY-PLUS-UNKNOWN. Every captured name, with the
// include/exclude answer and the reporting label kept separate -- the decision
// must not depend on whether anyone enumerated "Tangible Equity Units".
for (const [sym, wantClass, wantKind] of [
  ["BAC", "common", "common"],
  ["MKC.V", "common", "common"],
  ["EMBJ", "common", "common"],
  ["GOOG", "common", "common"],
  ["EP$C", "not-common", "preferred"],
  ["BAC$K", "not-common", "preferred"],
  ["T$A", "not-common", "preferred"],
  ["MER$K", "not-common", "note"],
  ["TBB", "not-common", "note"],
  ["PFH", "not-common", "note"],
  ["UNMA", "not-common", "note"],
  ["CCXIW", "not-common", "warrant"],
  ["NOVTU", "not-common", "unit"],
  ["ARM", "common", "adr"],
  ["BIDU", "common", "adr"],
  ["GSK", "common", "adr"],
]) {
  const name = NASDAQ_NAMES.get(sym);
  check(`${sym.padEnd(6)} ${wantClass}/${wantKind}`,
    classifySecurityName(name) === wantClass && describeSecurityName(name) === wantKind,
    `${classifySecurityName(name)}/${describeSecurityName(name)} · "${name.slice(0, 44)}…"`);
}
// REJECT MUST RUN BEFORE ACCEPT. BAC$K matches BOTH stages -- "Depositary
// Shares" is ADR-adjacent wording and "Preferred" is a type marker -- so the
// order is the whole rule, not a detail.
check("BAC$K matches an equity marker AND a type marker, and the reject wins",
  /depositary shares/i.test(NASDAQ_NAMES.get("BAC$K")) &&
    /preferred/i.test(NASDAQ_NAMES.get("BAC$K")) &&
    classifySecurityName(NASDAQ_NAMES.get("BAC$K")) === "not-common",
  "accept-first would have included a preferred");
check("...while ARM's ADR wording carries no type marker at all",
  classifySecurityName(NASDAQ_NAMES.get("ARM")) === "common" &&
    describeSecurityName(NASDAQ_NAMES.get("ARM")) === "adr");
check("GSK must not be the only ADR that passes",
  ["ARM", "BIDU", "GSK"].every((s) => classifySecurityName(NASDAQ_NAMES.get(s)) === "common"),
  "GSK passed the single-inversion rule on a parenthetical ARM does not have — a coin flip, not a rule");

// STAGE 3 IS COUNTED, NOT SILENT. An "unknown" is a name matching neither
// stage: reported so an unenumerated shape is visible rather than absorbed.
const unknowns = [...NASDAQ_NAMES.entries()].filter(([, n]) => classifySecurityName(n) === "unknown");
check("no captured name falls through to unknown",
  unknowns.length === 0,
  unknowns.map(([k]) => k).join(", ") || `all ${NASDAQ_NAMES.size} classify`);

// Word boundaries, because the type markers are common English.
check("type markers are word-bounded",
  classifySecurityName("Wright Medical Group Common Stock") === "common" &&
    classifySecurityName("UnitedHealth Group Incorporated Common Stock") === "common",
  "'Wright' is not a right, 'United' is not a unit");

check("truncated captures are marked as such",
  [...TRUNCATED].every((s) => NASDAQ_NAMES.get(s).includes("...")),
  "stored as captured prefixes; sufficient for the marker under test, not full names");

// THE PROPERTY THAT MATTERS, stated as it actually behaves under three stages.
//
// This assertion previously used "Contingent Value Rights" and expected
// not-common/other. Under the two-stage rule "Rights" IS a type marker, so it
// now classifies not-common/right -- and the assertion failed, correctly. The
// genuinely unenumerated case falls to UNKNOWN, which is the third stage:
// excluded and COUNTED, never silently included.
const novel = "Acme Inc. Tracking Series";
check("a security type matching neither stage falls to UNKNOWN, never to common",
  classifySecurityName(novel) === "unknown" && describeSecurityName(novel) === "unknown",
  `${classifySecurityName(novel)} — excluded and counted, so an unenumerated shape is visible`);
check("...and an enumerated type marker still rejects outright",
  classifySecurityName("Acme Inc. Contingent Value Rights") === "not-common" &&
    describeSecurityName("Acme Inc. Contingent Value Rights") === "right");
// The review's figure was 1 of 6 over its own six-symbol list. Over this fuller
// fixture it is 3 of 9 — the point is unchanged and the number is stated as
// measured here rather than carried across from a different sample.
check("a bad-word list on 'Preferred' would catch only 3 of the 9 non-common names",
  [...NASDAQ_NAMES.values()].filter((n) => classifySecurityName(n) === "not-common" && /preferred/i.test(n)).length === 3 &&
    [...NASDAQ_NAMES.values()].filter((n) => classifySecurityName(n) === "not-common").length === 9,
  "a positive bad-word list on 'Preferred' would have caught 3 of 9 captured non-common names");

// NO EIGHTH LOCAL COPY.
//
// This assertion found FOUR copies beyond the three already known -- seven in
// total -- on its first run. Two were the same concern and now use the helper.
// TWO ARE EXEMPT, and the exemptions are named with reasons rather than the bar
// being lowered, because a rule with a silent exception is a rule nobody can
// rely on:
//
//   phase0-adjustment-probe.mjs  builds STOOQ FILENAMES (brk-b.us). A URL
//                                convention, not a security join. The "$" form
//                                would be wrong there.
//   step0-analyse-dump.mjs       STUDIES which of the two spellings the frozen
//                                dump uses. Its subject IS the dot/dash pair;
//                                routing it through the helper would make it
//                                study the helper instead.
const EXEMPT = new Set(["phase0-adjustment-probe.mjs", "step0-analyse-dump.mjs"]);
// BOTH DIRECTIONS. The first version of this regex matched only the dot->dash
// form and reported "no script rolls its own" while four dash->dot sites
// remained -- a check reporting success while testing less than it claimed,
// which is the failure mode named in check-sec-daily-index.mjs's header.
const ROLLED_OWN = /replace\(\/\\\.\/g,\s*"-"\)|replace\(\/-\/g,\s*"\."\)/;
const copies = fs.readdirSync("scripts").filter((f) => f.endsWith(".mjs"))
  .filter((f) => !EXEMPT.has(f) && f !== "check-security-spellings.mjs")
  .filter((f) => ROLLED_OWN.test(fs.readFileSync(`scripts/${f}`, "utf8")));
check("no script rolls its own security-join spelling any more",
  copies.length === 0,
  copies.join(", ") || `${EXEMPT.size} exempt with stated reasons; the rest use the helper`);

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nSpelling helper is sound.\n");
process.exit(failures ? 1 : 0);
