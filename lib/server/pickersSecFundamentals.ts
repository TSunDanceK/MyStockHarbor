// PICKER FUNDAMENTALS FROM THE FILINGS (Relay B, #553 COWORK #5, 2026-09-23).
//
// The Valuation / Dividends / Financials tabs on the picker pages read FMP's
// ratios-ttm, income-statement, cash-flow-statement and dividends, cached per
// symbol by warm-stock-data. This moves eleven of those columns onto the SEC
// fact sets the site already stores, using the SHIPPED valuation functions in
// secValuation.ts -- the same ones the stock page uses -- rather than a second
// implementation that could disagree with it.
//
//   Market Cap      price × cover-page shares          secValuation.marketCap
//   PS Ratio        cap ÷ TTM revenue (guarded)        secValuation.valuationMultiples
//   PB Ratio        cap ÷ latest equity                secValuation.valuationMultiples
//   Ent. Value      cap + short + long debt − cash     the evEbitda inputs, all present
//   P/FCF           cap ÷ TTM (OCF − capex)            below
//   Revenue         TTM, refused by revenueLineIncomplete (imported, via multipleInputs)
//   Op. Income, Net Income, FCF    TTM                 secValuation.twelveMonthsOf
//   Div ($)         TTM declared per share             twelveMonthsOf
//   Div Yield       Div ($) ÷ price
//   Div Growth      TTM vs the prior TTM, else FY vs FY
//
// NOT MOVED, BY RULING (COWORK #5 Q1): P/E, EPS and Payout Ratio stay on their
// current source until Relay A fixes the TTM EPS basis in valuationInputs (for
// most filers it currently falls back to the last fiscal year). Sector and
// industry are out of scope too (Q3) -- they move to A's resolver in their own PR.
//
// ── TWO HALVES, AND WHY ────────────────────────────────────────────────────
// A ratio against price has to be divided at READ time or it is frozen at the
// job's price (the grid's own comment on its derived ratios says the same). So:
//   WRITE (daily job):  buildSecPickerRow(set) -- price-INDEPENDENT inputs only,
//                       one JSON field per symbol in ONE hash.
//   READ  (page render): applySecPickerRow(row, price) -- the division, with the
//                       price the page already shows. One HMGET for the page.
// Both halves are pure and exported so scripts/check-pickers-sec.mjs runs them.
//
// ── A REFUSAL IS A DASH, NEVER A FALL BACK TO FMP ──────────────────────────
// When the filings cannot support a figure (an ADS filer's share count, an
// incomplete revenue line, a missing debt line), the cell shows "–". It does
// not quietly show FMP's number instead: a column whose rows come from two
// sources without saying which is the mixed-provenance failure this exit exists
// to end. Only a symbol with NO row at all (the job has not reached it) keeps
// the old values, and that is the pre-merge state rather than a steady one.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { readFactSet } from "./secFactStore";
import { valueOf, type StoredFactSet, type StoredPeriod } from "./secFactCodec";
import { storedInReportingCurrency } from "./secCurrency";
import {
  marketCap,
  multipleInputs,
  twelveMonthsOf,
  valuationInputs,
  valuationMultiples,
  type FilerFacts,
  type MultipleInputs,
  type ValuationInputs,
} from "./secValuation";

export const PICKERS_SEC_KEY = "msh:pickers:sec-fundamentals:v1";
/** Survives two missed daily runs; a row older than this is served as absent. */
export const PICKERS_SEC_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * The rollback. PICKERS_FUNDAMENTALS=fmp restores the FMP columns exactly as
 * before (the FMP warm jobs keep running until this is verified -- the owner's
 * rule that FMP stays on until each replacement is). Anything else reads SEC.
 * An env read, so a change needs a production redeploy to take effect.
 */
export function pickersFundamentalsSource(): "sec" | "fmp" {
  return process.env.PICKERS_FUNDAMENTALS === "fmp" ? "fmp" : "sec";
}

/**
 * THE UNIT EVERY MONEY FIGURE IN A ROW IS IN (#553 COWORK #11, 2026-09-23).
 *
 * The #559 preview showed EC (Ecopetrol) revenue 123.86T and HMY 179.91B:
 * Colombian pesos and rand, filed on a 20-F, printed against a USD price. A
 * fact set records its reporting currency (`cur`, absent = USD) and, when
 * Relay A's FX module could convert it, how (`fx`, period-matched rates applied
 * at extraction -- lib/server/secCurrency.ts). So:
 *   USD                        figures as stored
 *   non-USD WITH fx            figures as stored (already USD, per period);
 *                              growth taken in the REPORTING currency, as A's
 *                              module requires, so an FX move is not growth
 *   non-USD WITHOUT fx         every money figure REFUSED ("–"), never shown raw
 * Market cap is price × share count -- no reporting-currency figure in it -- so
 * it is unaffected (the ADS/20-F share rule still applies to it separately).
 * The same rule as secEarningsView's "a set that is not in dollars does not
 * render".
 */
export type SecPickerUnit = { reporting: string; converted: boolean };

export function unitOf(set: Pick<StoredFactSet, "cur" | "fx">): SecPickerUnit {
  const reporting = (set.cur ?? "USD").toUpperCase();
  return { reporting, converted: reporting !== "USD" && Boolean(set.fx) };
}

/** Whether a set's stored money figures are in US dollars. */
export const moneyIsUsd = (u: SecPickerUnit) => u.reporting === "USD" || u.converted;

/** Everything price-independent that the eleven columns need. JSON-safe. */
export type SecPickerRow = {
  v: 1;
  unit: SecPickerUnit;
  /** When the job built it (ms). */
  at: number;
  inputs: Pick<ValuationInputs, "shares" | "refusals">;
  m: MultipleInputs;
  operatingIncome: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  divPerShare: number | null;
  divGrowth: number | null;
};

/** The columns a row can fill, as the picker entry names them. */
export type SecPickerFigures = {
  marketCap: number | null;
  psRatio: number | null;
  pbRatio: number | null;
  enterpriseValue: number | null;
  pfcfRatio: number | null;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  freeCashFlow: number | null;
  divPerShare: number | null;
  divYield: number | null;
  divGrowth: number | null;
};

/** The fields applySecPickerRow owns, in one place for the page and the check. */
export const SEC_PICKER_FIELDS: (keyof SecPickerFigures)[] = [
  "marketCap", "psRatio", "pbRatio", "enterpriseValue", "pfcfRatio", "revenue",
  "operatingIncome", "netIncome", "freeCashFlow", "divPerShare", "divYield", "divGrowth",
];

/**
 * A stored period in the filer's REPORTING currency, for growth. Identity for a
 * USD or unconverted set; for a converted one, A's storedInReportingCurrency
 * (null when no rate was recorded for that period -- then there is no growth).
 */
function home(set: StoredFactSet, p: StoredPeriod | undefined): StoredPeriod | null {
  if (!p) return null;
  return set.fx ? storedInReportingCurrency(p, set.fx) : p;
}

/** The four consecutive quarters `offset` back, summed, or null. secValuation's period rule. */
function fourQuartersFrom(set: StoredFactSet, key: string, offset: number): number | null {
  const four = set.quarters.slice(offset, offset + 4).map((q) => home(set, q));
  if (four.length < 4 || four.some((q) => q === null)) return null;
  const parts = four.map((q) => valueOf(q, key));
  if (parts.some((v) => v === null)) return null;
  return (parts as number[]).reduce((a, b) => a + b, 0);
}

/**
 * Dividend growth, percent: the newest TTM against the TTM before it, else the
 * newest fiscal year against the one before. Null when either side is missing
 * or the older one is not positive -- growth from nothing is not a percentage.
 */
function dividendGrowth(set: StoredFactSet): number | null {
  const now = fourQuartersFrom(set, "dividendsDeclaredPerShare", 0);
  const prior = fourQuartersFrom(set, "dividendsDeclaredPerShare", 4);
  if (now !== null && prior !== null && prior > 0) return ((now - prior) / prior) * 100;
  const a = valueOf(home(set, set.years[0]), "dividendsDeclaredPerShare");
  const b = valueOf(home(set, set.years[1]), "dividendsDeclaredPerShare");
  return a !== null && b !== null && b > 0 ? ((a - b) / b) * 100 : null;
}

/** WRITE half. Pure. */
export function buildSecPickerRow(
  set: StoredFactSet,
  today: string,
  filer: FilerFacts,
  nowMs: number
): SecPickerRow {
  const inputs = valuationInputs(set, today, filer);
  const unit = unitOf(set);
  if (!moneyIsUsd(unit)) {
    // NOT IN DOLLARS AND NOT CONVERTIBLE: nothing money-denominated leaves this
    // function. The share count stays (market cap is price × shares).
    return {
      v: 1,
      at: nowMs,
      unit,
      inputs: { shares: inputs.shares, refusals: inputs.refusals },
      m: { revenue: null, revenueIncomplete: false, ebitda: null, balanceSheet: null },
      operatingIncome: null,
      netIncome: null,
      freeCashFlow: null,
      divPerShare: null,
      divGrowth: null,
    };
  }
  const oi = twelveMonthsOf(set, ["operatingIncome"]);
  const ni = twelveMonthsOf(set, ["netIncome"]);
  const cf = twelveMonthsOf(set, ["operatingCashFlow", "capex"]);
  const dps = twelveMonthsOf(set, ["dividendsDeclaredPerShare"]);
  return {
    v: 1,
    at: nowMs,
    unit,
    inputs: { shares: inputs.shares, refusals: inputs.refusals },
    m: multipleInputs(set),
    operatingIncome: oi ? oi.vals.operatingIncome : null,
    netIncome: ni ? ni.vals.netIncome : null,
    // capex is stored as the positive payment (PaymentsToAcquire...); abs() so a
    // filer that tags it negative cannot turn FCF into OCF + capex.
    freeCashFlow: cf ? cf.vals.operatingCashFlow - Math.abs(cf.vals.capex) : null,
    divPerShare: dps ? dps.vals.dividendsDeclaredPerShare : null,
    divGrowth: dividendGrowth(set),
  };
}

const ok = (f: { ok: true; val: number } | { ok: false } | null): number | null =>
  f && f.ok ? f.val : null;

/** READ half. Pure. `price` is the price the page shows for the row. */
export function applySecPickerRow(row: SecPickerRow, price: number | null): SecPickerFigures {
  // BELT AND BRACES: a row whose money is not in dollars yields no money
  // figure here either, whatever its fields hold.
  const usd = moneyIsUsd(row.unit);
  const inputs: ValuationInputs = { shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals };
  const cap = ok(marketCap(inputs, price));
  const mult = valuationMultiples(inputs, row.m, price);

  const bs = row.m.balanceSheet;
  const enterpriseValue =
    cap !== null && bs && bs.shortTermDebt !== null && bs.longTermDebt !== null && bs.cash !== null
      ? cap + bs.shortTermDebt + bs.longTermDebt - bs.cash
      : null;

  // P/FCF is refused on a non-positive FCF, like P/E on a loss: a negative
  // multiple sorts to the top of a cheapest-first column.
  const pfcfRatio = cap !== null && row.freeCashFlow !== null && row.freeCashFlow > 0 ? cap / row.freeCashFlow : null;

  // Revenue carries the SAME refusal as P/S: an incomplete revenue line is not
  // a revenue figure either (the shared guard, applied inside multipleInputs).
  const revenue = row.m.revenueIncomplete ? null : row.m.revenue?.vals.revenue ?? null;

  const divYield =
    row.divPerShare !== null && price !== null && Number.isFinite(price) && price > 0
      ? (row.divPerShare / price) * 100
      : null;

  const money = <T,>(v: T | null): T | null => (usd ? v : null);
  return {
    marketCap: cap,
    psRatio: money(ok(mult.ps)),
    pbRatio: money(ok(mult.pb)),
    enterpriseValue: money(enterpriseValue),
    pfcfRatio: money(pfcfRatio),
    revenue: money(revenue),
    operatingIncome: money(row.operatingIncome),
    netIncome: money(row.netIncome),
    freeCashFlow: money(row.freeCashFlow),
    divPerShare: money(row.divPerShare),
    divYield: money(divYield),
    divGrowth: money(row.divGrowth),
  };
}

// ─────────────────────────────────────────────────────────────────── I/O

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

// A ROW WITHOUT `unit` predates the currency rule (the preview seed of
// 2026-09-23) and may hold local-currency figures; it reads as absent, and the
// next job run rewrites it.
function isRow(v: unknown): v is SecPickerRow {
  const r = v as SecPickerRow;
  return Boolean(v && typeof v === "object" && r.v === 1 && r.m && r.unit && typeof r.unit.reporting === "string");
}

/**
 * The page's read: ONE HMGET for every symbol on the page. A missing or
 * malformed field is simply absent from the map; a Redis failure is an empty
 * map (the page then keeps its previous values, the pre-merge state).
 */
export async function readSecPickerRows(symbols: string[]): Promise<Map<string, SecPickerRow>> {
  const out = new Map<string, SecPickerRow>();
  const fields = [...new Set(symbols.filter(Boolean))];
  if (!redis || !fields.length) return out;
  try {
    const raw = (await redis.hmget(PICKERS_SEC_KEY, ...fields)) as unknown;
    const get = (sym: string, i: number): unknown =>
      Array.isArray(raw) ? raw[i] : raw && typeof raw === "object" ? (raw as Record<string, unknown>)[sym] : null;
    const staleBefore = Date.now() - PICKERS_SEC_TTL_SECONDS * 1000;
    fields.forEach((sym, i) => {
      const row = get(sym, i);
      if (isRow(row) && row.at >= staleBefore) out.set(sym, row);
    });
  } catch {
    // Absent, not an error the reader sees.
  }
  return out;
}

export type WarmPickersSecResult = {
  ok: boolean;
  symbols: number;
  written: number;
  noFactSet: number;
  stoppedEarly: string | null;
  commands: number;
};

/**
 * The daily job's work. RUNAWAY GUARDS, stated as numbers:
 *   - at most MAX_SYMBOLS_PER_RUN symbols (the universe is ~850 today);
 *   - one GET per symbol (readFactSet) + one HSET per 100 symbols + one EXPIRE;
 *   - the FIRST Redis write error stops the run -- a failing store is not
 *     retried 850 times.
 * So a run costs about 850 + 9 + 1 ≈ 860 commands, and cannot exceed ~2,050.
 */
export const MAX_SYMBOLS_PER_RUN = 2_000;

export async function warmPickersSec(
  symbols: string[],
  registrantFor: (symbol: string) => { annualForm?: string | null } | null,
  nowMs = Date.now()
): Promise<WarmPickersSecResult> {
  const result: WarmPickersSecResult = {
    ok: true, symbols: 0, written: 0, noFactSet: 0, stoppedEarly: null, commands: 0,
  };
  if (!redis) return { ...result, ok: false, stoppedEarly: "no-redis" };

  const list = [...new Set(symbols.filter(Boolean))].slice(0, MAX_SYMBOLS_PER_RUN);
  result.symbols = list.length;
  const today = new Date(nowMs).toISOString().slice(0, 10);

  let batch: Record<string, SecPickerRow> = {};
  const flush = async () => {
    const n = Object.keys(batch).length;
    if (!n) return true;
    try {
      await redis.hset(PICKERS_SEC_KEY, batch);
      result.commands++;
      result.written += n;
      batch = {};
      return true;
    } catch (err) {
      result.ok = false;
      result.stoppedEarly = `redis-write-failed: ${String(err).slice(0, 120)}`;
      return false;
    }
  };

  for (const symbol of list) {
    const set = await readFactSet(symbol).catch(() => null);
    result.commands++;
    if (!set) {
      result.noFactSet++;
      continue;
    }
    batch[symbol] = buildSecPickerRow(set, today, { annualForm: registrantFor(symbol)?.annualForm ?? null }, nowMs);
    if (Object.keys(batch).length >= 100 && !(await flush())) return result;
  }
  if (!(await flush())) return result;

  try {
    await redis.expire(PICKERS_SEC_KEY, PICKERS_SEC_TTL_SECONDS);
    result.commands++;
  } catch {
    // The rows carry their own `at`; a missed EXPIRE is not a correctness issue.
  }
  return result;
}
