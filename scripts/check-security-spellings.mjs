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
  // Common stock and share classes
  ["BAC", "Bank of America Corporation Common Stock"],
  ["MKC.V", "McCormick & Company, Incorporated Common Stock"],
  ["EMBJ", "Embraer S.A. Common Stock"],
  ["BCS", "Barclays PLC Common Stock"],
  ["HSBC", "HSBC Holdings, plc. Common Stock"],
  ["AZN", "AstraZeneca PLC Ordinary Shares"],
  ["GOOG", "Alphabet Inc. - Class C Capital Stock"],
  ["BRK.B", "Berkshire Hathaway Inc. New Common Stock"],
  // ADRs — 49 of the 55 periodic filers in the measured window were 6-K filers,
  // i.e. foreign private issuers. This is the largest population, not a tail.
  ["ARM", "Arm Holdings plc - American Depositary Shares"],
  ["BIDU", "Baidu, Inc. - American Depositary Shares, each representing 8 ordinary share"],
  ["GSK", "GSK plc American Depositary Shares (Each representing two Ordinary Shares)"],
  ["ABEV", "Ambev S.A. American Depositary Shares (Each representing 1 Common Share)"],
  ["VALE", "VALE S.A.  American Depositary Shares Each Representing one common share"],
  ["ZTO", "ZTO Express (Cayman) Inc. American Depositary Shares, each representing one Class A ordinary share."],
  ["LYG", "Lloyds Banking Group Plc American Depositary Shares"],
  ["GMAB", "Genmab A/S - American Depositary Shares"],
  ["EC", "Ecopetrol S.A. American Depositary Shares"],
  ["SAN", "Banco Santander, S.A. Sponsored ADR (Spain)"],
  // Preferreds, notes, warrants, units
  ["EP$C", "El Paso Corporation Preferred Stock"],
  ["MER$K", "Bank of America Corporation Income Capital Obligation Notes initially due December 15, 2066"],
  ["TBB", "AT&T Inc. 5.350% Global Notes due 2066"],
  ["PFH", "Prudential Financial, Inc. 4.125% Junior Subordinated Notes due 2060"],
  ["UNMA", "Unum Group 6.250% Junior Subordinated Notes due 2058"],
  // NOTE THE TYPO IN THE SOURCE: "Non- Cumulative", with a space after the
  // hyphen. Harmless here because the reject fires on "Preferred", but these
  // strings are hand-maintained by the exchange and a pattern keyed on exact
  // phrasing will eventually meet one of these.
  ["BAC$K", "Bank of America Corporation Depositary Shares, each representing a 1/1,000th interest in a share of 5.875% Non- Cumulative Preferred Stock, Series HH"],
  ["T$A", "AT&T Inc. Depositary Shares, each representing a 1/1,000th interest in a share of 5.000% Perpetual Preferred Stock, Series A"],
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
  ["ABEV", "common", "adr"],
  ["VALE", "common", "adr"],
  ["ZTO", "common", "adr"],
  ["LYG", "common", "adr"],
  ["GMAB", "common", "adr"],
  ["EC", "common", "adr"],
  ["SAN", "common", "adr"],
  ["AZN", "common", "common"],
  ["BCS", "common", "common"],
  ["HSBC", "common", "common"],
  ["BRK.B", "common", "common"],
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

// WHICH MARKER ACTUALLY CARRIES EACH ADR. Without this, the equity markers
// could be doing nothing for the whole ADR population and every test would
// still pass on the ADR marker alone -- which was true before the singular
// widening: of these ten, only GSK matched a share marker.
const SHARE_MARKER = /\bcommon (?:stock|shares?)\b|\bordinary (?:stock|shares?)\b/i;
const ADR_MARKER = /\bamerican depositary (?:shares?|receipts?)\b|\bsponsored ADRs?\b|\bADRs?\b/i;
check("the singular widening took effect — BIDU, VALE, ABEV and ZTO now match a SHARE marker",
  ["BIDU", "VALE", "ABEV", "ZTO"].every((k) => SHARE_MARKER.test(NASDAQ_NAMES.get(k))),
  "a plural-only pattern matched none of them: 'ordinary share', 'one common share', '1 Common Share'");
check("...and the ADR marker is the ONLY thing carrying ARM, LYG, GMAB, EC and SAN",
  ["ARM", "LYG", "GMAB", "EC", "SAN"].every(
    (k) => !SHARE_MARKER.test(NASDAQ_NAMES.get(k)) && ADR_MARKER.test(NASDAQ_NAMES.get(k))
  ),
  "their names never say what the receipt represents — removing the ADR marker drops five of ten");
check("'Sponsored ADR' is load-bearing, not redundant with 'American Depositary Shares'",
  !/american depositary/i.test(NASDAQ_NAMES.get("SAN")) &&
    classifySecurityName(NASDAQ_NAMES.get("SAN")) === "common",
  "SAN is the only one of 25 using that wording");

// THE EXCHANGE'S STRINGS ARE HAND-MAINTAINED. BAC$K carries a typo in the
// source -- "Non- Cumulative", a space after the hyphen. Harmless because the
// reject fires on "Preferred", but it is the standing reminder that a pattern
// keyed on exact phrasing will eventually meet one of these.
check("the source typo is preserved in the fixture, not silently corrected",
  NASDAQ_NAMES.get("BAC$K").includes("Non- Cumulative"),
  "captured as the exchange publishes it");
check("...and it classifies correctly anyway, because the marker is a single word",
  classifySecurityName(NASDAQ_NAMES.get("BAC$K")) === "not-common");

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
const EXEMPT = new Set([
  "phase0-adjustment-probe.mjs", "step0-analyse-dump.mjs",
  // NOT A JOIN. buildFmpSymbol constructs an FMP *API symbol* (BRK.B -> BRK-B)
  // for a URL, the same category as phase0's stooq filenames: it has one
  // correct output rather than a list of candidates to try, and routing it
  // through a widening helper would be meaningless at best. Exempt with the
  // reason stated rather than the bar lowered.
  "historyCache.ts",
]);
// BOTH DIRECTIONS. The first version of this regex matched only the dot->dash
// form and reported "no script rolls its own" while four dash->dot sites
// remained -- a check reporting success while testing less than it claimed,
// which is the failure mode named in check-sec-daily-index.mjs's header.
const ROLLED_OWN = /replace\(\/\\\.\/g,\s*"-"\)|replace\(\/-\/g,\s*"\."\)/;
// SCANS lib/ TOO, NOT JUST scripts/. The helper moved to lib/symbolSpellings.mjs
// so the application could import it -- seedManifest needed it and a helper the
// app cannot reach is a helper the app reimplements. A scan that still looked
// only at scripts/ would not notice the next copy appearing in app code, which
// is now the likelier place for one.
const CANONICAL = "lib/symbolSpellings.mjs";
// RECURSIVE. The first version listed three directories by hand and missed
// lib/server/news/secProvider.ts -- which sec-title-candidates.mjs's own
// comment points at as the place the fallback already lives. A scan that
// enumerates directories finds copies only in the directories someone thought
// of, which is the wrong half of the problem.
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(mjs|ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
};
const scan = [...walk("scripts"), ...walk("lib"), ...walk("app")];
const copies = scan
  .filter((f) => !EXEMPT.has(f.split("/").pop()) && !f.endsWith("check-security-spellings.mjs"))
  .filter((f) => f !== CANONICAL)
  .filter((f) => ROLLED_OWN.test(fs.readFileSync(f, "utf8")));
check("no script rolls its own security-join spelling any more",
  copies.length === 0,
  copies.join(", ") || `${EXEMPT.size} exempt with stated reasons; the rest use the helper`);

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nSpelling helper is sound.\n");
process.exit(failures ? 1 : 0);
