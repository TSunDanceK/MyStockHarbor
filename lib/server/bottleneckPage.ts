// THE INDIVIDUAL BOTTLENECK PAGE'S SERVER DATA (#563 COWORK #158).
//
// The page's own rules live in lib/bottleneckPage.ts (pure). This file reads
// what those rules need, ALL FROM EXISTING CACHES:
//
//   what                       reader                        commands per render
//   today's close and move     readTiingoEodLast (one blob)  0 (shared Data Cache,
//     for the company and          every symbol's newest bar    1 HGETALL per miss/day)
//     every listed partner
//   "names {TICKER} ×N"        buildHubCompanies             0 (the content files)
//   From the filings           getSecEarningsSnapshot        0 while warm: wrapped
//                                 (A's reader, imported)       here per symbol, 12 h;
//                                                              1 GET per miss
//   the Earnings link gate     A's filedEarningsGate         0 while warm (one
//                                 (#552 COWORK #197)           cached index read,
//                                                              shared per render)
//
// With the page's own ISR window (1 h), a page costs at most 2 GETs a day for
// its filings and nothing else of its own.
//
// THE EARNINGS GATE is A's (#552 COWORK #197): a link to /stock/SYM/earnings
// shows only when hasFiledEarnings(SYM), read once per render through
// filedEarningsGate(). The filings card reads only for a symbol that passes it.
import { unstable_cache } from "next/cache";
import { readTiingoEodLast } from "@/lib/server/marketData/read";
import { getSecEarningsSnapshot } from "@/lib/server/secEarningsSnapshot";
import { cikForSymbol } from "@/lib/server/secColdFetch";
import { filedEarningsGate } from "@/lib/server/filedEarnings";
import { sectorOf } from "@/lib/server/sectorOf";
import { registrantFor } from "@/lib/server/stockProfile";
import { getAllBottleneckPosts, type BottleneckPost } from "@/lib/bottlenecks";
import { buildHubCompanies } from "@/lib/bottleneckHub";
import { toDashed } from "@/lib/symbolSpellings.mjs";

export type Move = { close: number; changePct: number | null; date: string };

/** Filed figures for the "From the filings" card, or null to hide it. */
export type FiledRow = { period: string; revenue: string; revenueYoY: number | null; gross: number | null; grossPts: number | null; cogs: string | null };

const money = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(1)}bn` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(0)}m` : `${s}$${a.toFixed(0)}`;
};

const readFiled = (symbol: string) => unstable_cache(
  async (): Promise<FiledRow | null> => {
    const s = await getSecEarningsSnapshot(symbol).catch(() => null);
    if (!s?.available || s.basis !== "quarter" || typeof s.revenue?.value !== "number") return null;
    const rev = s.revenue.value, g = s.margins.gross;
    return {
      period: s.periodLabel ?? "Latest quarter",
      revenue: money(rev),
      revenueYoY: s.revenueYoY?.kind === "pct" ? s.revenueYoY.value : null,
      gross: typeof g === "number" ? g : null,
      grossPts: typeof g === "number" && typeof s.yearAgo?.gross === "number" ? Math.round((g - s.yearAgo.gross) * 10) / 10 : null,
      // Computed, and labelled so: revenue less gross profit.
      cogs: typeof g === "number" ? money(rev * (1 - g / 100)) : null,
    };
  },
  ["bottleneck-filed-v1", symbol],
  { revalidate: 43200, tags: ["bottleneck-filed"] },
)();

export type BottleneckPageData = {
  sector: { name: string; slug: string | null } | null;
  annualForm: string | null;
  /** The registrant's CIK, for the EDGAR filings link under Sources. */
  cik: string | null;
  moves: Record<string, Move>;
  ownMaps: Set<string>;
  namedBy: { count: number; names: string[] };
  filed: FiledRow | null;
  /** hasFiledEarnings for the page's symbol and every listed partner (A's gate). */
  hasFiledEarnings: Record<string, boolean>;
};

export async function getBottleneckPageData(post: BottleneckPost): Promise<BottleneckPageData> {
  const sym = post.symbol.toUpperCase();
  const listed = [...new Set([sym, ...[...post.supplyChain, ...post.customers].map((c) => c.ticker).filter((t): t is string => !!t)])];
  const [eod, hasFiledEarnings] = await Promise.all([readTiingoEodLast().catch(() => null), filedEarningsGate()]);
  const filed = hasFiledEarnings(sym) ? await readFiled(sym).catch(() => null) : null;
  const moves: Record<string, Move> = {};
  for (const t of listed) {
    const r = eod?.[toDashed(t)] ?? eod?.[t];
    if (r && Number.isFinite(r.c)) moves[t] = { close: r.c, changePct: r.pc ? ((r.c - r.pc) / r.pc) * 100 : null, date: r.d };
  }
  const posts = getAllBottleneckPosts();
  const named = buildHubCompanies(posts).find((c) => c.key === sym);
  return {
    sector: sectorOf(sym),
    annualForm: registrantFor(sym)?.annualForm ?? null,
    cik: cikForSymbol(sym) ?? null,
    moves,
    ownMaps: new Set(posts.map((p) => p.symbol.toUpperCase())),
    namedBy: { count: named?.count ?? 0, names: (named?.pages ?? []).filter((p) => p.symbol !== sym).slice(0, 3).map((p) => p.symbol) },
    filed,
    hasFiledEarnings: Object.fromEntries(listed.map((t) => [t, hasFiledEarnings(t)])),
  };
}
