// P/E, EPS and Payout Ratio in Pickers: FMP today vs secValuation (Relay B,
// #553 COWORK #18/#19, "measure first"). READ-ONLY.
//
// For the 700-symbol Pickers universe:
//   TODAY    P/E = price pool `pe`, else the stored fundamentals row's peRatio
//            (the page's layering order); EPS and Payout from stockDataCache.
//   SEC      valuationInputs (post-#577 TTM EPS, basis labelled) and peRatio
//            at the pool price; Payout = TTM declared DPS / that EPS, and
//            whether the two share a basis and period end.
//   PRESETS  row counts for low-P/E (<=15), cash-rich (FCF >= $10B, P/E <= 20),
//            cheap-tech (Technology, P/E <= 25), high-dividend (yield >= 4) and
//            dividend-growth (yield >= 2, growth >= 5), today vs shipped, after
//            the fundamentals presets' debt/preferred exclusion.
// Also the 189 refused Market Caps per reason, for A (COWORK #19).
//
//   relay task: write-pickers-pe-census
//   Redis: 1 GET (universe) + 1 HMGET (pool) + fundamentals bulk + stock-data
//   bulk + 1 HMGET (SEC rows) + 700 GET (fact sets) = ~710, once.
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";

const V = await import("../lib/server/secValuation.ts");
const P = await import("../lib/server/pickersSecFundamentals.ts");
const S = await import("../lib/server/secFactStore.ts");
const F = await import("../lib/server/fundamentalsCache.ts");
const SD = await import("../lib/server/stockDataCache.ts");
const { registrantFor } = await import("../lib/server/stockProfile.ts");
const { excludedFromFundamentals } = await import("../lib/server/pickerEquity.ts");
const { resolveProfileBulk } = await import("../lib/server/staticProfile.ts");
const redis = Redis.fromEnv();
const today = new Date().toISOString().slice(0, 10);

const raw = await redis.get("msh:pickers:v10:symbols");
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.symbols) ? raw.symbols : [];
const universe = [...new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean))];
const poolRaw = await redis.hmget("msh:price-pool:v1", ...universe);
const pool = new Map();
universe.forEach((s, i) => {
  let r = Array.isArray(poolRaw) ? poolRaw[i] : poolRaw?.[s];
  if (typeof r === "string") try { r = JSON.parse(r); } catch { r = null; }
  if (r && typeof r === "object") pool.set(s, r);
});
const fund = await F.readCachedFundamentalsBulk(universe);
const extra = await SD.readCachedStockDataBulk(universe);
const secRows = await P.readSecPickerRows(universe);
const profiles = await resolveProfileBulk(universe.map((symbol) => ({ symbol, cached: null })), "pe census");
// The sector the page shows TODAY (stored row; #578 is held), on both sides,
// so only P/E differs between the two counts.
const sectorOf = (s) => fund.get(s)?.sector ?? profiles.get(s)?.sector ?? null;

const sets = new Map();
for (let i = 0; i < universe.length; i += 25) {
  const batch = universe.slice(i, i + 25);
  const got = await Promise.all(batch.map((s) => S.readFactSet(s).catch(() => null)));
  batch.forEach((s, j) => { if (got[j]) sets.set(s, got[j]); });
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const inc = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
const push = (o, k, v, cap = 400) => { if ((o[k] ??= []).length < cap) o[k].push(v); };
const t = { fmpPe: 0, fmpPeNeg: 0, secPe: 0, secRefused: {}, secNull: 0, noSet: 0, both: 0, agree5: 0, agree20: 0, off: 0,
  basis: {}, fyLabels: {}, derivedQ4: 0, fmpEps: 0, secEps: 0, epsAgree5: 0, epsBoth: 0,
  fmpPayout: 0, secPayout: 0, payoutSameBasis: 0, payoutMixed: 0, payoutBoth: 0, payoutAgree5: 0 };
const ex = { secRefused: {}, off: [], fmpPeNeg: [], payoutMixed: [], capRefused: {} };
const rows = [];
for (const s of universe) {
  const p = pool.get(s);
  const price = num(p?.price);
  const fmpPe = num(p?.pe) ?? num(fund.get(s)?.peRatio);
  const d = extra.get(s);
  const fmpEps = num(d?.epsTtm);
  const fmpPayout = num(d?.payoutRatio);
  if (fmpPe !== null) { t.fmpPe++; if (fmpPe <= 0) { t.fmpPeNeg++; if (ex.fmpPeNeg.length < 30) ex.fmpPeNeg.push(`${s}:${fmpPe.toFixed(1)}`); } }
  if (fmpEps !== null) t.fmpEps++;
  if (fmpPayout !== null) t.fmpPayout++;

  const set = sets.get(s);
  let secPe = null, secEps = null, secPayout = null;
  if (!set) t.noSet++;
  else {
    const inputs = V.valuationInputs(set, today, registrantFor(s) ?? {});
    const fig = V.peRatio(inputs, price);
    if (fig?.ok) { secPe = fig.val; t.secPe++; }
    else if (fig) { inc(t.secRefused, fig.why); push(ex.secRefused, fig.why, s, 12); }
    else t.secNull++;
    if (inputs.eps && !inputs.refusals.includes("ads-ratio-makes-eps-incomparable")) {
      secEps = inputs.eps.val; t.secEps++;
      const b = inputs.eps.basis === "fiscal-year" ? `FY${inputs.eps.fiscalYear ?? "?"}` : "TTM";
      inc(t.basis, inputs.eps.basis === "fiscal-year" ? "fiscal-year" : inputs.eps.derivedQ4 ? "TTM (Q4 derived)" : "TTM (4 filed quarters)");
      if (inputs.eps.basis === "fiscal-year") inc(t.fyLabels, b);
      const dps = V.twelveMonthsOf(set, ["dividendsDeclaredPerShare"]);
      if (dps && secEps > 0) {
        secPayout = (dps.vals.dividendsDeclaredPerShare / secEps) * 100; t.secPayout++;
        const same = dps.basis === inputs.eps.basis && dps.periodEnd === inputs.eps.periodEnd;
        if (same) t.payoutSameBasis++;
        else { t.payoutMixed++; if (ex.payoutMixed.length < 25) ex.payoutMixed.push(`${s}(eps ${inputs.eps.basis} ${inputs.eps.periodEnd} / dps ${dps.basis} ${dps.periodEnd})`); }
      }
    }
    const row = secRows.get(s);
    if (row) {
      const cap = V.marketCap({ shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals }, price);
      if (cap && !cap.ok) push(ex.capRefused, cap.why, s);
    }
  }
  if (fmpPe !== null && secPe !== null) {
    t.both++;
    const r = Math.abs(secPe / fmpPe - 1);
    if (r <= 0.05) t.agree5++; else if (r <= 0.2) t.agree20++; else { t.off++; ex.off.push([s, fmpPe, secPe]); }
  }
  if (fmpEps !== null && secEps !== null) { t.epsBoth++; if (Math.abs(secEps / fmpEps - 1) <= 0.05) t.epsAgree5++; }
  if (fmpPayout !== null && secPayout !== null) { t.payoutBoth++; if (Math.abs(secPayout - fmpPayout) <= 5) t.payoutAgree5++; }

  const row = secRows.get(s);
  const secFig = row ? P.applySecPickerRow(row, price) : null;
  rows.push({ s, fmpPe, secPe, fcf: secFig?.freeCashFlow ?? null, divYield: secFig?.divYield ?? null, divGrowth: secFig?.divGrowth ?? null, sector: sectorOf(s), excluded: excludedFromFundamentals(s) !== null });
}

const presets = {
  "low-pe (P/E <= 15)": (r, pe) => pe !== null && pe <= 15,
  "cash-rich (FCF >= 10B, P/E <= 20)": (r, pe) => pe !== null && pe <= 20 && r.fcf !== null && r.fcf >= 1e10,
  "cheap-tech (Technology, P/E <= 25)": (r, pe) => pe !== null && pe <= 25 && r.sector === "Technology",
  "high-dividend (yield >= 4)": (r) => r.divYield !== null && r.divYield >= 4,
  "dividend-growth (yield >= 2, growth >= 5)": (r) => r.divYield !== null && r.divYield >= 2 && r.divGrowth !== null && r.divGrowth >= 5,
};
console.log(`Pickers universe ${universe.length}; fact sets ${sets.size}; SEC rows ${secRows.size}; pool ${pool.size}; stock-data ${extra.size}`);
console.log("\n== P/E");
console.log(`FMP today: ${t.fmpPe} rows (${t.fmpPeNeg} of them zero/negative, which the <= presets admit): ${ex.fmpPeNeg.join(" ")}`);
console.log(`SEC: ${t.secPe} P/E; refused ${JSON.stringify(t.secRefused)}; no price/unstated ${t.secNull}; no fact set ${t.noSet}`);
for (const [why, xs] of Object.entries(ex.secRefused)) console.log(`  ${why}: ${xs.join(" ")}`);
console.log(`both present ${t.both}: within 5% ${t.agree5}, 5-20% ${t.agree20}, over 20% ${t.off}`);
ex.off.sort((a, b) => Math.abs(b[2] / b[1] - 1) - Math.abs(a[2] / a[1] - 1));
console.log(`  largest disagreements (sym FMP SEC): ${ex.off.slice(0, 25).map(([s, a, b]) => `${s} ${a.toFixed(1)} ${b.toFixed(1)}`).join("; ")}`);
console.log("\n== EPS basis (SEC)");
console.log(`${JSON.stringify(t.basis)}; FY labels ${JSON.stringify(t.fyLabels)}`);
console.log(`EPS: FMP ${t.fmpEps}, SEC ${t.secEps}; both ${t.epsBoth}, within 5% ${t.epsAgree5}`);
console.log("\n== Payout");
console.log(`FMP ${t.fmpPayout}; SEC ${t.secPayout} (same basis+period ${t.payoutSameBasis}, MIXED ${t.payoutMixed}); both ${t.payoutBoth}, within 5 points ${t.payoutAgree5}`);
console.log(`  mixed examples: ${ex.payoutMixed.join("; ")}`);
console.log("\n== Presets (after the debt/preferred exclusion): today -> shipped");
for (const [name, fn] of Object.entries(presets)) {
  const kept = rows.filter((r) => !r.excluded);
  const now = kept.filter((r) => fn(r, r.fmpPe)).map((r) => r.s);
  const then = kept.filter((r) => fn(r, r.secPe)).map((r) => r.s);
  const left = now.filter((s) => !then.includes(s));
  const joined = then.filter((s) => !now.includes(s));
  console.log(`${name}: ${now.length} -> ${then.length}; leave ${left.length}: ${left.join(" ")}; join ${joined.length}: ${joined.join(" ")}`);
}
console.log("\n== Refused Market Caps, per reason (for A, COWORK #19)");
console.log("REFUSED-CAPS-JSON " + JSON.stringify(ex.capRefused));
console.log(`\nRedis commands: ~${5 + universe.length} (read-only)`);
