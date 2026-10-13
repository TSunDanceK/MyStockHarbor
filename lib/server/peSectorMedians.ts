// EACH SECTOR'S MEDIAN TRAILING P/E, FOR THE STOCK PAGE'S P/E LINE
// (#552 COWORK #147 §2). The rules are lib/peSectorLine.ts.
//
// FROM THE DATA CACHE, NOT A NEW REDIS KEY. The inputs are the two blobs the
// price pool already caches — the SEC picker rows (readSecCapRows, written by
// warm-pickers-sec daily) and each symbol's latest stored close
// (readTiingoEodLast) — through the same secCapAndPe the pool overlay uses, so
// a peer's P/E here is the P/E the pickers show. Computed once per 6 hours per
// deployment and cached; a page render costs no Redis command on a hit. No
// Tiingo-derived figure is written anywhere: the medians live only in the
// Data Cache, beside the blobs they come from.
import { unstable_cache } from "next/cache";
import { readSecCapRows } from "./tiingoPool";
import { readTiingoEodLast } from "./marketData/read";
import { secCapAndPe } from "./pickersSecFundamentals";
import { sicProfileFor } from "./staticProfile";
import { registrantFor } from "./stockProfile";
import { BANK_SIC_RANGE } from "./secEstimates";
import { sectorMedians, type SectorMedian } from "../peSectorLine";
import { toDashed, toDotted } from "../symbolSpellings.mjs";

export type PeSectorMedians = { asOf: string; sectors: Record<string, SectorMedian> };

/** Banks (SIC 6000–6299) are left out of the peers and get no line. */
export function isBankSic(sic: string | null | undefined): boolean {
  const n = Number(sic);
  return Boolean(sic) && Number.isFinite(n) && n >= BANK_SIC_RANGE[0] && n <= BANK_SIC_RANGE[1];
}

/** The sector a symbol is compared within: the FMP-free classification. */
export function peSectorOf(symbol: string): string | null {
  return sicProfileFor(symbol)?.sector ?? null;
}

async function loadPeSectorMedians(): Promise<PeSectorMedians | null> {
  const [rows, eod] = await Promise.all([readSecCapRows().catch(() => null), readTiingoEodLast().catch(() => null)]);
  if (!rows || !eod) return null;
  const peers: { sector: string; pe: number }[] = [];
  let asOf = "";
  for (const [sym, row] of Object.entries(rows)) {
    const last = eod[sym] ?? eod[toDashed(sym)] ?? eod[toDotted(sym)];
    if (!last) continue;
    if (isBankSic(registrantFor(sym)?.sic)) continue;
    const sector = peSectorOf(sym);
    if (!sector) continue;
    const pe = secCapAndPe(row, last.c).pe;
    if (pe === null) continue;
    peers.push({ sector, pe });
    if (last.d > asOf) asOf = last.d;
  }
  return { asOf, sectors: sectorMedians(peers) };
}

export const readPeSectorMedians = unstable_cache(loadPeSectorMedians, ["pe-sector-medians-v1"], { revalidate: 6 * 60 * 60 });
