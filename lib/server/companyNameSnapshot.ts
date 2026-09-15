// The committed company-name snapshot — the floor under the live directory fetch.
//
// ── ITS OWN MODULE, AND THAT IS THE POINT ─────────────────────────────────
// This began inside lib/server/companyNames.ts and broke two harnesses on the
// first run: check-company-name.mjs and check-gnews-adapter.mjs both INLINE that
// file to run it offline, and a `import ... from "@/data/company-names.json"`
// is an import they cannot resolve. Patching both harnesses would have been the
// smaller diff and the wrong fix — companyNames.ts is pure string work, it is
// loaded by things that must stay loadable, and hanging 128 KB of data off it
// makes every one of those pay for it.
//
// Same reasoning that split filingChurn and providerStats out, and the same
// reasoning behind newsMerge's "imports nothing outside its allowlist" rule: a
// module other code has to be able to LOAD should not acquire a data
// dependency. The split is the fix; the harnesses need no change.

// ── THE COMMITTED FALLBACK, AND THE GAP IT CLOSES ─────────────────────────
// fetchCompanyName reaches www.nasdaqtrader.com at render time and returns ""
// on any failure. Until now "" was the end of the line, and an empty name is
// not a cosmetic loss: gnewsProvider SKIPS THE SYMBOL ENTIRELY
// ("no usable company name"), so the leg that carries the news page goes quiet.
// That is the other half of any genuinely empty stock page, and it had no
// floor under it — the taxonomy survived the FMP exit because it happened to be
// cached, and the names did not.
//
// data/company-names.json is that floor: 2,592 symbols captured from the SAME
// two directory files fetchCompanyName reads, so the fallback and the live path
// cannot disagree about what a company is called. Raw Security Name values,
// uncleaned, because cleanName below is the normaliser and running it twice
// over pre-cleaned data would make one of the two passes invisible.
//
// ── WHY THE SEPARATOR FALLBACK IS NOT OPTIONAL ───────────────────────────
// The two national sources DISAGREE about the separator, which is the detail
// that makes a single canonical spelling impossible:
//
//   SEC company_tickers.json   BRK-B   dashed
//   Nasdaq Trader ACT Symbol   BRK.B   dotted
//
// and otherlisted.txt's `NASDAQ Symbol` column — the dashed alternative — is
// EMPTY for NYSE-listed dual-class and preferred names, because they have no
// Nasdaq symbol. So the directory offers those only under the dotted spelling
// while this repo stores them dashed.
//
// Measured on the snapshot: 18 of its 28 missing symbols are exactly that set
// — BF-B, BRK-A, BRK-B, CIG-C, CMS-PB, CTA-PA, CTA-PB, EP-PC, FITB-PA,
// FITB-PM, MER-PK, MKC-V, MOG-A, OAK-PA, OAK-PB, PBR-A, SEAL-PB, TRTN-PC —
// the same 18 claude/symbol-spelling-split-2026-09-12.md enumerates. BRK-B is
// in the preset universe, so this is a guaranteed slot losing its news leg.
//
// The direction here is dashed -> dotted, the OPPOSITE of cikFor in
// lib/server/news/secProvider.ts, and deliberately so: each lookup normalises
// toward ITS OWN source's convention. One global canonical spelling would be
// wrong for one of the two sources no matter which it picked.
import companyNameSnapshot from "@/data/company-names.json";
import { lookupOneWay, toDotted } from "@/lib/symbolSpellings.mjs";

const SNAPSHOT_NAMES = (companyNameSnapshot as { rows?: Record<string, string> }).rows ?? {};

/** How many symbols the committed snapshot covers. For /cache-health. */
export const COMPANY_NAME_SNAPSHOT_SIZE: number = Object.keys(SNAPSHOT_NAMES).length;
export const COMPANY_NAME_SNAPSHOT_AS_OF: string =
  (companyNameSnapshot as { asOf?: string }).asOf ?? "";

/**
 * The committed name for a symbol, or "" — exact spelling first, then the
 * dot-for-dash rewrite the directory's own convention requires.
 */
export function snapshotCompanyName(symbol: string): string {
  const upper = String(symbol ?? "").trim().toUpperCase();
  if (!upper) return "";
  // ONE-WAY, preserving the original direction exactly. The snapshot is keyed
  // by the exchange directory's spelling, so a dashed universe symbol may reach
  // a dotted key; the reverse is not a miss this map can have.
  return lookupOneWay(SNAPSHOT_NAMES, upper, toDotted) ?? "";
}
