// Every spelling one ticker wears, in one place.
//
// THE PROBLEM, NOW SEEN THREE TIMES. The same security is spelled differently by
// every source this project joins against:
//
//   repo / universe      BRK.B     MER-PK    EP-PC     MKC-V
//   Nasdaq Trader        BRK.B?    BAC$K     T$A       ...$<series>
//   SEC ticker file      BRK-B     (absent -- preferreds resolve to the parent)
//
// Dot-versus-dash was handled by a local `alts()` in listing-split.mjs, copied
// into listing-venue-diff.mjs, and written a third time inline in
// sec-window-fixture.mjs. The DOLLAR form appears in none of them.
//
// WHY THAT IS DANGEROUS RATHER THAN MERELY UNTIDY. The preferred/baby-bond
// exclusion test joins the universe against nasdaqtraded.txt's Security Name to
// decide whether a symbol is a preferred. Nasdaq Trader spells suffixed
// preferreds with "$" (BAC$K) and the universe spells them with a dash
// (MER-PK), so a naive join returns NULL for exactly those rows -- and a null
// Security Name reads as "no name, so not a preferred".
//
// The test then PASSES THROUGH the securities it exists to catch, fails open,
// and is indistinguishable from a working test that found nothing. Callers must
// treat an unresolved name as UNKNOWN, never as "common stock" -- see
// `classifySecurityName` below.
//
// AND THE TWO SHAPES DIFFER, so a spot check misleads: suffixed preferreds
// (MER-PK, MKC-V, EP-PC) need the "$" form, while baby bonds carry plain
// alphabetic tickers (TBB, PFH, UNMA) and join correctly as-is. Checking TBB
// alone passes and says nothing about the suffixed half.

/**
 * Candidate spellings for one ticker, most-likely first, de-duplicated.
 *
 * Deliberately GENERATIVE rather than a lookup table: a table of known
 * preferreds is a September 2026 snapshot that returns a wrong answer silently
 * forever, which this repo has already refused twice.
 */
export function symbolSpellings(symbol) {
  const raw = String(symbol ?? "").trim().toUpperCase();
  if (!raw) return [];
  const out = [raw];
  const push = (s) => {
    if (s && s !== raw && !out.includes(s)) out.push(s);
  };

  // 1. Dot/dash, the pair the existing copies handled.
  push(raw.replace(/\./g, "-"));
  push(raw.replace(/-/g, "."));

  // 2. The DOLLAR forms. "-P<series>" is the universe's spelling for a preferred
  //    series (MER-PK = series K); Nasdaq Trader writes "$<series>". Emitted
  //    before the looser rule below so the more specific pattern is tried first.
  push(raw.replace(/-P([A-Z])$/, "$$$1"));

  // 3. The looser suffix rule, for share classes and non-P series that Nasdaq
  //    may also write with "$": MKC-V -> MKC$V, PBR-A -> PBR$A. Generated
  //    rather than assumed correct -- an extra candidate that matches nothing
  //    costs one map lookup, while a missing one fails open.
  push(raw.replace(/[.-]([A-Z])$/, "$$$1"));

  return out;
}

/** First hit across every spelling. Returns the value AND which spelling won. */
export function lookupBySpelling(map, symbol) {
  for (const spelling of symbolSpellings(symbol)) {
    if (map.has(spelling)) return { value: map.get(spelling), matched: spelling };
  }
  return null;
}

/**
 * TWO STAGES, REJECT FIRST. Neither direction works alone.
 *
 * A positive list of BAD words catches one in six: "Preferred" appears only in
 * EP$C, while MER$K is "Income Capital Obligation Notes" -- a name nobody
 * enumerates.
 *
 * A single known-good ACCEPT list rejects ARM. Measured live against 25 ADRs in
 * the universe, nine failed it:
 *
 *   ARM   "Arm Holdings plc - American Depositary Shares"
 *   BIDU  "Baidu, Inc. - American Depositary Shares, each representing 8..."
 *   VALE  "VALE S.A.  American Depositary Shares Each Representing one co..."
 *   ABEV, ZTO, LYG, GMAB, EC, SAN
 *
 * and the ones that passed did so BY ACCIDENT -- GSK on a parenthetical
 * ("(Each representing two Ordinary...)") that ARM's name simply does not have.
 * Pass/fail depended on whether the exchange spelled out what the receipt
 * represents, which is a coin flip rather than a rule.
 *
 * THIS IS NOT A TAIL CASE. 49 of the 55 periodic filers in the measured window
 * were 6-K filers -- foreign private issuers, i.e. ADRs. They are the majority
 * of the universe's earnings activity, and ARM is the symbol this project was
 * audited against.
 *
 * WHY ONE INVERSION CANNOT WORK: "Depositary Shares" appears on BOTH sides.
 *
 *   ARM    "American Depositary Shares"                          -> ACCEPT
 *          the tradeable common-equity proxy
 *   BAC$K  "Depositary Shares, each representing a 1/1,000th
 *           interest in a share of 5.875% Non-Cumulative
 *           Preferred Stock, Series HH"                          -> REJECT
 *
 * So: reject on security-type markers FIRST, then accept on equity markers,
 * then "unknown" -- which is reported and counted, never silently included.
 * BAC$K matches both stages and the reject has to win.
 */

// Stage 1. A security TYPE marker -- these never appear in the name of ordinary
// tradeable equity. Word-bounded: "Wright" does not contain a \bright\b, and
// "United" does not contain a \bunit\b.
const SECURITY_TYPE_MARKER =
  /\b(?:preferred|notes?|debentures?|subordinated|warrants?|units?|rights?)\b/i;

// Stage 2. An equity marker. The Class qualifier is KEPT even though stage 1
// now catches "Class A Preferred Stock" -- the belt to that braces, and the
// same failure one level down if it were removed.
const EQUITY_MARKER = [
  /\bcommon stock\b/i,
  /\bcommon shares?\b/i,
  /\bordinary shares?\b/i,
  /\bclass\s+[A-Z0-9]+\s+(?:common|capital|ordinary)\s+(?:stock|shares?)\b/i,
  // The ADR forms. ARM's full name is exactly "Arm Holdings plc - American
  // Depositary Shares" with nothing after it, so anything requiring the
  // underlying to be spelled out excludes the largest population in the universe.
  /\bamerican depositary shares?\b/i,
  /\bamerican depositary receipts?\b/i,
  /\bADRs?\b/,
];

/**
 * "common" | "not-common" | "unknown".
 *
 * THREE STATES, NOT TWO. "unknown" (no name, or a name matching neither stage)
 * is kept distinct from "not-common" (matched a security-type marker) because
 * they mean different things in a report, even though both exclude. Returning
 * "common" for either is the fail-open path that makes the exclusion useless.
 */
export function classifySecurityName(securityName) {
  if (securityName == null || String(securityName).trim() === "") return "unknown";
  const name = String(securityName);
  // ORDER IS LOAD-BEARING. BAC$K is "Depositary Shares ... Preferred Stock":
  // it matches stage 2's ADR-adjacent wording and stage 1's "preferred", and
  // the reject must win.
  if (SECURITY_TYPE_MARKER.test(name)) return "not-common";
  if (EQUITY_MARKER.some((re) => re.test(name))) return "common";
  return "unknown";
}

/**
 * A finer label for REPORTING only -- never the include/exclude decision, which
 * is classifySecurityName's. Its fallback is "other", not "common": the same
 * inversion, so a security type nobody enumerated cannot become an included
 * symbol by default.
 */
export function describeSecurityName(securityName) {
  const verdict = classifySecurityName(securityName);
  if (verdict === "unknown") return "unknown";
  const name = String(securityName);
  if (verdict === "common") return /\bamerican depositary|ADRs?\b/i.test(name) ? "adr" : "common";
  if (/\bwarrants?\b/i.test(name)) return "warrant";
  if (/\bunits?\b/i.test(name)) return "unit";
  if (/\bnotes?\b|\bdebentures?\b|\bsubordinated\b/i.test(name)) return "note";
  if (/\bpreferred\b/i.test(name)) return "preferred";
  if (/\brights?\b/i.test(name)) return "right";
  return "other";
}
