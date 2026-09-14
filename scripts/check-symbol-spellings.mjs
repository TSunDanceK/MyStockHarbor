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
import { symbolSpellings, lookupBySpelling, classifyUnresolvedIsNotCommon } from "./lib/symbol-spellings.mjs";

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

// A LIVE JOIN, SIMULATED AGAINST THE SPELLING NASDAQ ACTUALLY USES.
const nasdaq = new Map([
  ["BAC", "Bank of America Corporation Common Stock"],
  ["BAC$K", "Bank of America Corp. Depositary Shares, 5.875% Non-Cumulative Preferred Stock, Series HH"],
  ["MER$K", "Merrill Lynch Depositary Shares, Preferred Stock Series K"],
  ["TBB", "AT&T Inc. 5.350% Global Notes due 2066"],
  ["GOOG", "Alphabet Inc. - Class C Capital Stock"],
  ["CCXIW", "Churchill Capital Corp XI - Warrants"],
]);
const merrill = lookupBySpelling(nasdaq, "MER-PK");
check("MER-PK resolves to a name containing 'Preferred' — THE test that matters",
  Boolean(merrill) && /preferred/i.test(merrill.value),
  merrill ? `matched as ${merrill.matched}` : "UNRESOLVED — this is the fail-open path");
check("...and a dash-only join would have missed it",
  !nasdaq.has("MER-PK"),
  "which is why a null Security Name must never be read as 'common stock'");

// THE CLASSIFIER MUST NOT FAIL OPEN.
check("an absent Security Name classifies as UNKNOWN, never as common",
  classifyUnresolvedIsNotCommon(null) === "unknown" &&
    classifyUnresolvedIsNotCommon("") === "unknown" &&
    classifyUnresolvedIsNotCommon("   ") === "unknown");
for (const [name, want] of [
  ["Bank of America Corporation Common Stock", "common"],
  ["AT&T Inc. Depositary Shares, 5.000% Perpetual Preferred Stock, Series A", "preferred"],
  ["Alphabet Inc. - Class C Capital Stock", "common"],
  ["Churchill Capital Corp XI - Warrants", "warrant"],
  ["Novanta Inc. - Tangible Equity Units", "unit"],
  ["AT&T Inc. 5.350% Global Notes due 2066", "baby-bond"],
]) check(`"${name.slice(0, 40)}…" -> ${want}`, classifyUnresolvedIsNotCommon(name) === want,
  classifyUnresolvedIsNotCommon(name));

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
  .filter((f) => !EXEMPT.has(f) && f !== "check-symbol-spellings.mjs")
  .filter((f) => ROLLED_OWN.test(fs.readFileSync(`scripts/${f}`, "utf8")));
check("no script rolls its own security-join spelling any more",
  copies.length === 0,
  copies.join(", ") || `${EXEMPT.size} exempt with stated reasons; the rest use the helper`);

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nSpelling helper is sound.\n");
process.exit(failures ? 1 : 0);
