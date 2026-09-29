// THE DIFF RUN'S COMPARISON (#552 COWORK #70): a stored Layer 2 fact set
// against the same symbol rebuilt from the archive. Pure, so the check can
// hold it to fixtures.
//
// Periods are matched by start|end within quarters, years and instants. For a
// period in both, each positional value is compared field by field. A period
// only the rebuild has, and NEWER than the stored set's newest in that group,
// is new data the archive holds (not a disagreement); every other one-sided
// period is a difference. A stored set under another field-order hash is not
// compared value by value at all (its positions mean other fields).
//
// NOT COMPARED HERE, BY DESIGN: the cover share count and the instance-EPS
// frame. The live job takes them from filing documents (withClassCover,
// withInstanceEps), which the archive does not hold; they are reported on
// their own lines by the diff script, never counted as field differences.

const GROUPS = ["quarters", "years", "instants"];
const same = (a, b) => (a === null || a === undefined ? b === null || b === undefined
  : b !== null && b !== undefined && (a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))));

export function compareSets(stored, rebuilt, fieldKeys) {
  const out = { verdict: "identical", hashDiffers: false, fields: {}, newerInArchive: 0, onlyInRebuilt: 0, onlyInStored: 0, sharedPeriods: 0 };
  if (!rebuilt) { out.verdict = "rebuilt-empty"; return out; }
  if (stored.h !== rebuilt.h) { out.verdict = "hash-differs"; out.hashDiffers = true; return out; }
  for (const g of GROUPS) {
    const key = (p) => `${p.s ?? ""}|${p.e}`;
    const S = new Map((stored[g] ?? []).map((p) => [key(p), p]));
    const R = new Map((rebuilt[g] ?? []).map((p) => [key(p), p]));
    const storedNewest = (stored[g] ?? []).reduce((m, p) => (p.e > m ? p.e : m), "");
    for (const [k, r] of R) {
      const s = S.get(k);
      if (!s) { if (r.e > storedNewest) out.newerInArchive++; else out.onlyInRebuilt++; continue; }
      out.sharedPeriods++;
      for (let i = 0; i < fieldKeys.length; i++) {
        if (!same(s.v?.[i], r.v?.[i])) out.fields[fieldKeys[i]] = (out.fields[fieldKeys[i]] ?? 0) + 1;
      }
    }
    for (const k of S.keys()) if (!R.has(k)) out.onlyInStored++;
  }
  const differs = Object.keys(out.fields).length > 0 || out.onlyInRebuilt > 0 || out.onlyInStored > 0;
  out.verdict = differs ? "differs" : out.newerInArchive > 0 ? "identical-plus-newer" : "identical";
  return out;
}
