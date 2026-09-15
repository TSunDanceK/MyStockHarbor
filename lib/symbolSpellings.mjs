// THE ONE PLACE A TICKER'S ALTERNATIVE SPELLINGS ARE GENERATED.
//
// WHY IT IS HERE AND NOT UNDER scripts/. It started in scripts/lib/ because
// only probes needed it. Then seedManifest looked a ticker up with a plain
// `map.get(symbol)` and BRK.B got no CIK: the universe spells it with a DOT,
// SEC's exchange file with a DASH, and nothing bridged them. A helper the
// application cannot import is a helper the application will reimplement --
// and this repo already found SEVEN copies of the dot/dash dance once.
//
// So the generator lives in lib/, as plain ESM that both sides import:
// TypeScript under lib/ and app/ (tsconfig has allowJs), and
// scripts/lib/symbol-spellings.mjs, which re-exports these two so every
// existing probe import keeps working. One implementation, two importers.
//
// A .mjs rather than a .ts deliberately: the scripts are plain Node with no
// build step, so a .ts here would need either a compile or a second copy, and
// a second copy is the thing this file exists to prevent.

/**
 * Candidate spellings for one ticker, most-likely first, de-duplicated.
 *
 * Deliberately GENERATIVE rather than a lookup table: a table of known
 * preferreds is a September 2026 snapshot that returns a wrong answer silently
 * forever, which this repo has already refused twice.
 */
/** @param {string} symbol @returns {string[]} */
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

/**
 * First hit across every spelling. Returns the value AND which spelling won.
 *
 * GENERIC VIA JSDOC so TypeScript callers keep their value type. Without the
 * annotation `found?.cik` in seedManifest infers `any`, which is a silent
 * downgrade of exactly the type checking that would catch the next version of
 * this bug.
 *
 * @template V
 * @param {Map<string, V>} map
 * @param {string} symbol
 * @returns {{ value: V, matched: string } | null}
 */
export function lookupBySpelling(map, symbol) {
  for (const spelling of symbolSpellings(symbol)) {
    if (map.has(spelling)) return { value: map.get(spelling), matched: spelling };
  }
  return null;
}

/**
 * The same widening over a plain object rather than a Map.
 *
 * NOT A CONVENIENCE. Three of the five copies this replaced were looking up a
 * `Record<string, T>` -- a CIK map, a name snapshot, a JSON blob -- and
 * requiring a Map at the call site is what made each of them write the
 * dot/dash line locally instead. A helper that does not fit the shape callers
 * hold is a helper callers route around.
 *
 * @template V
 * @param {Record<string, V>} record
 * @param {string} symbol
 * @returns {{ value: V, matched: string } | null}
 */
export function lookupSpellingIn(record, symbol) {
  for (const spelling of symbolSpellings(symbol)) {
    if (Object.prototype.hasOwnProperty.call(record, spelling)) {
      return { value: record[spelling], matched: spelling };
    }
  }
  return null;
}

// ── ONE-WAY RULES ───────────────────────────────────────────────────────────
//
// CENTRALISING A RULE IS NOT THE SAME AS WIDENING IT, and routing two call
// sites through `lookupSpellingIn` widened them by accident. secProvider.cikFor
// is deliberately ONE-WAY -- the CIK map has a single canonical spelling, the
// DASH, so a dotted symbol may reach a dashed key and a dashed miss must NOT
// reach a dotted one. check-sec-adapter.mjs asserts exactly that and caught the
// change: "one canonical spelling, one direction of tolerance."
//
// So the direction lives here as a named rule rather than as a bare replace at
// the call site. One module owns every spelling rule; each caller picks the one
// it means, instead of taking the widest by default.

/** Dotted to dashed. The vendor/SEC spelling. @param {string} s @returns {string} */
export const toDashed = (s) => String(s ?? "").trim().toUpperCase().replace(/\./g, "-");

/** Dashed to dotted. The exchange-directory spelling. @param {string} s @returns {string} */
export const toDotted = (s) => String(s ?? "").trim().toUpperCase().replace(/-/g, ".");

/**
 * A ONE-WAY lookup: the key as given, then ONE rewrite. Not the full candidate
 * list. For maps with a single canonical spelling, where tolerating the other
 * direction would reach a key that should not exist.
 *
 * @template V
 * @param {Record<string, V>} record
 * @param {string} symbol
 * @param {(s: string) => string} rewrite
 * @returns {V | undefined}
 */
export function lookupOneWay(record, symbol, rewrite) {
  const upper = String(symbol ?? "").trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(record, upper)) return record[upper];
  const alt = rewrite(upper);
  return alt === upper ? undefined : record[alt];
}
