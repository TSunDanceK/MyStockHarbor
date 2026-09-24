// REGISTRANT ROWS FOLLOW A TICKER CHANGE BY CIK (#552 COWORK #36 §1).
//
// data/sec/registrants.json is keyed by ticker, but a registrant is its CIK.
// When a company renames its ticker (BK → BNY), SEC's ticker file lists the
// same CIK under the new ticker and drops the old one — and the refresh used
// to drop the row with it. This plans the move from the ticker file alone:
//
//   - the old ticker is GONE from the ticker file (not merely re-pointed),
//   - its CIK now appears under exactly ONE ticker that has no row yet;
//
// then the row moves to the new ticker and the old one stays as an ALIAS
// (`aliasOf`), so lookups and old links keep resolving. A CIK under two or
// more new tickers (share classes, units) is reported and left alone: picking
// one would be a guess. PURE — the refresh (scripts/sec-registrants.mjs)
// applies it and prints each move.

export type RenameRow = { cik: string | null; aliasOf?: string };
export type Rename = { from: string; to: string; cik: string };
export type RenamePlan = { renames: Rename[]; ambiguous: { from: string; cik: string; candidates: string[] }[] };

function pad(c: string | number | null | undefined): string {
  return c == null ? "" : String(c).replace(/\D/g, "").padStart(10, "0");
}

export function planRenames(rows: Record<string, RenameRow>, tickerCik: Map<string, string>): RenamePlan {
  const byCik = new Map<string, string[]>();
  for (const [t, c] of tickerCik) {
    const k = pad(c);
    const list = byCik.get(k);
    if (list) list.push(t); else byCik.set(k, [t]);
  }
  const hasRow = (t: string) => !!rows[t] && !rows[t].aliasOf;
  const renames: Rename[] = [];
  const ambiguous: RenamePlan["ambiguous"] = [];
  for (const [sym, row] of Object.entries(rows)) {
    if (row.aliasOf || !row.cik) continue;
    if (tickerCik.has(sym)) continue; // still listed under this ticker
    const cik = pad(row.cik);
    const candidates = (byCik.get(cik) ?? []).filter((t) => !hasRow(t)).sort();
    if (candidates.length === 1) renames.push({ from: sym, to: candidates[0], cik });
    else if (candidates.length > 1) ambiguous.push({ from: sym, cik, candidates });
  }
  return { renames, ambiguous };
}
