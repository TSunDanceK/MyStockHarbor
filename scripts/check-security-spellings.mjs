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
]);

// ASSERT ON THE SHAPES, NOT ON ONE SYMBOL. These five behave differently, and
// one passing proves nothing about the others -- which is exactly what this
// round demonstrated.
const SHAPES = [
  ["EP-PC", "EP$C", "not-common", "$ preferred"],
  ["MER-PK", "MER$K", "not-common", "$ note (contains no 'Preferred' at all)"],
  ["MKC-V", "MKC.V", "common", ". share class — SAME name as its parent"],
  ["TBB", "TBB", "not-common", "plain-ticker note"],
  ["EMBJ", "EMBJ", "common", "plain-ticker common stock"],
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
]) {
  const name = NASDAQ_NAMES.get(sym);
  check(`${sym.padEnd(6)} ${wantClass}/${wantKind}`,
    classifySecurityName(name) === wantClass && describeSecurityName(name) === wantKind,
    `${classifySecurityName(name)}/${describeSecurityName(name)} · "${name.slice(0, 44)}…"`);
}
// THE INVERSION, ASSERTED DIRECTLY. A name nobody enumerated must not become an
// included symbol -- which is the property a bad-word list cannot have.
check("an unenumerated security type is not-common, not common",
  classifySecurityName("Acme Inc. Contingent Value Rights") === "not-common" &&
    describeSecurityName("Acme Inc. Contingent Value Rights") === "other",
  "the known-good match needs no list of what a note can be called");
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
