// TWO ESTIMATES, BACK-TESTED BEFORE EITHER SHIPS (#552 COWORK #162 §2/§3).
// Reads only.
//
// The owner's estimates rule (2 Oct; secEstimates' header): a method may carry
// a marked "≈" figure only if it lands within ±5% of the filed figure for at
// least 9 in 10 cases.
//
// A2. DIVIDEND PER SHARE FROM CASH PAID. On US-GAAP filers that file BOTH a
//     per-share dividend and cash dividends paid for the same fiscal year,
//     estimate = cash paid ÷ weighted-average basic shares, against the filed
//     per-share figure. Read from companyfacts (one request per payer, ≤ 8/s)
//     so each concept is known: PaymentsOfDividendsCommonStock is preferred
//     over PaymentsOfDividends (which may include preferred), …PerShareCashPaid
//     is compared where filed (paid vs paid) as well as …Declared. Every miss
//     is printed with the flags that may explain it.
//
// B1. EV WITH CASH INCLUDING RESTRICTED. On stored sets whose balance sheet
//     files cash, cash incl. restricted, short- and long-term debt at the same
//     date, EV computed with cash incl. restricted against the full EV, at the
//     pool price and the shipped market cap (applySecPickerRow). Banks
//     (SIC 6000–6299) excluded, as the estimate layer excludes them.
//
//   relay task: write-sec-estimate-accuracy (READ-ONLY despite the prefix).
//   Redis: SMEMBERS + MGET of the stored sets + HMGET of the price pool.
import "./lib/register-ts-app.mjs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { SEC_FACTS_INDEX_KEY, dotDashSpellings } = await import("../lib/server/secManifest.ts");
const { factKey } = await import("../lib/server/secFactStore.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const { valueOf, balanceSheetInstant } = await import("../lib/server/secFactCodec.ts");
const { buildSecPickerRow, applySecPickerRow } = await import("../lib/server/pickersSecFundamentals.ts");
const { sicAllowsEstimate } = await import("../lib/server/secEstimates.ts");
const { readPricePoolBulk } = await import("../lib/server/pricePool.ts");
const { registrantFor } = await import("../lib/server/stockProfile.ts");
const { adsRatioFor } = await import("../lib/server/secAdsMap.ts");
const { citedCoverFor, nonEquityListingOf } = await import("../lib/server/secPrimaryListing.ts");
const { secUserAgent } = await import("../lib/server/news/userAgent.ts");

const TODAY = new Date().toISOString().slice(0, 10);
const filerOf = (s) => ({ annualForm: registrantFor(s)?.annualForm ?? null, ads: adsRatioFor(s), nonEquity: nonEquityListingOf(s), sic: registrantFor(s)?.sic ?? null, citedCover: citedCoverFor(s) });
let commands = 0;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const quant = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

commands++;
const indexed = (await redis.smembers(SEC_FACTS_INDEX_KEY)).map(String);
const sets = new Map();
{
  const keys = [...new Set(indexed.flatMap((s) => dotDashSpellings(s).map(factKey)))];
  for (let i = 0; i < keys.length; i += 40) {
    commands++;
    const batch = keys.slice(i, i + 40);
    const vals = await redis.mget(...batch);
    batch.forEach((k, j) => {
      const v = vals[j]; if (!v) return;
      const set = typeof v === "string" ? JSON.parse(v) : v;
      if (set.h === secFieldsHash() && Array.isArray(set.quarters)) sets.set(set.symbol ?? k.split(":").pop(), set);
    });
  }
}
console.log(`stored sets read: ${sets.size}`);

// ── B1 ─────────────────────────────────────────────────────────────────────
{
  const syms = [...sets.keys()];
  commands++;
  const pool = await readPricePoolBulk(syms);
  const errs = [], misses = [];
  let eligible = 0, bank = 0, noPrice = 0, noCap = 0;
  for (const [s, set] of sets) {
    const b = balanceSheetInstant(set);
    if (!b) continue;
    const cash = valueOf(b, "cash"), cir = valueOf(b, "cashIncludingRestricted");
    const std = valueOf(b, "shortTermDebt"), ltd = valueOf(b, "longTermDebt");
    if ([cash, cir, std, ltd].some((v) => v === null)) continue;
    if (!sicAllowsEstimate(filerOf(s).sic)) { bank++; continue; }
    const price = pool.get(s)?.price ?? null;
    if (price === null) { noPrice++; continue; }
    const cap = applySecPickerRow(buildSecPickerRow(set, TODAY, filerOf(s), Date.now()), price).marketCap;
    if (cap == null) { noCap++; continue; }
    eligible++;
    const full = cap + std + ltd - cash, est = cap + std + ltd - cir;
    if (full <= 0) continue;
    const e = Math.abs(est - full) / full;
    errs.push(e);
    if (e > 0.05) misses.push(`${s} ${(e * 100).toFixed(1)}% (cash ${(cash / 1e6).toFixed(0)}M, incl. restricted ${(cir / 1e6).toFixed(0)}M, EV ${(full / 1e9).toFixed(2)}B, ${b.e})`);
  }
  const within = errs.filter((e) => e <= 0.05).length;
  console.log(`\n## B1 — EV with cash incl. restricted vs the full EV`);
  console.log(`cases (all four lines filed at one date, not a bank, priced, with a cap): ${errs.length} · banks excluded ${bank} · no pool price ${noPrice} · no cap ${noCap}`);
  console.log(`within ±5%: ${within}/${errs.length} (${pct(within, errs.length)}) · median ${((quant(errs, 0.5) ?? 0) * 100).toFixed(2)}% · p90 ${((quant(errs, 0.9) ?? 0) * 100).toFixed(2)}% · max ${((quant(errs, 1) ?? 0) * 100).toFixed(2)}%`);
  console.log(`identical (restricted cash 0): ${errs.filter((e) => e === 0).length}`);
  for (const m of misses.slice(0, 25)) console.log(`  miss ${m}`);
}

// ── A2 ─────────────────────────────────────────────────────────────────────
const GAP_MS = 125;
let last = 0, sec = 0;
async function facts(cik) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); sec++;
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "user-agent": secUserAgent(), accept: "application/json" } });
  return res.ok ? res.json() : null;
}
/** Annual (≥ 350-day) facts of one concept, by "start|end", newest filing wins. */
function annual(f, concept, unitTest) {
  const units = f?.facts?.["us-gaap"]?.[concept]?.units ?? {};
  const out = new Map();
  for (const [u, arr] of Object.entries(units)) {
    if (!unitTest(u)) continue;
    for (const x of arr) {
      if (!x.start || (Date.parse(x.end) - Date.parse(x.start)) / 86400000 < 350) continue;
      const k = `${x.start}|${x.end}`;
      const prev = out.get(k);
      if (!prev || x.filed > prev.filed) out.set(k, x);
    }
  }
  return out;
}
const USD = (u) => u === "USD";
const PER = (u) => u === "USD/shares" || u === "USD/share";
const SH = (u) => u === "shares";
{
  const payers = [...sets.entries()].filter(([, set]) => {
    const tx = set.tx ?? [];
    if (!tx.includes("us-gaap")) return false;
    return [...set.quarters, ...set.years].some((p) => Math.abs(valueOf(p, "dividendsPaid") ?? 0) > 0);
  });
  const rows = [];
  for (const [s, set] of payers) {
    const f = await facts(set.cik);
    if (!f) continue;
    const dec = annual(f, "CommonStockDividendsPerShareDeclared", PER);
    const cp = annual(f, "CommonStockDividendsPerShareCashPaid", PER);
    const payC = annual(f, "PaymentsOfDividendsCommonStock", USD);
    const pay = annual(f, "PaymentsOfDividends", USD);
    const pref = annual(f, "DividendsPreferredStock", USD);
    const sh = annual(f, "WeightedAverageNumberOfSharesOutstandingBasic", SH);
    // The newest fiscal year with a filed per-share figure, cash paid and shares.
    const ends = [...new Set([...dec.keys(), ...cp.keys()])].filter((k) => (payC.has(k) || pay.has(k)) && sh.has(k)).sort((a, b) => (a.split("|")[1] < b.split("|")[1] ? 1 : -1));
    const k = ends[0];
    if (!k || Date.parse(k.split("|")[1]) < Date.parse(TODAY) - 3 * 365 * 86400000) continue;
    const paidC = payC.get(k)?.val ?? null, paidAll = pay.get(k)?.val ?? null;
    const paid = Math.abs(paidC ?? paidAll);
    const shares = sh.get(k).val;
    const est = paid / shares;
    const filed = cp.get(k)?.val ?? dec.get(k)?.val;
    const filedConcept = cp.has(k) ? "CashPaid" : "Declared";
    if (!(filed > 0) || !(shares > 0)) continue;
    const err = Math.abs(est - filed) / filed;
    const flags = [];
    if (paidC === null) flags.push("paid is PaymentsOfDividends (may include preferred)");
    if ((pref.get(k)?.val ?? 0) > 0) flags.push(`preferred dividends ${(pref.get(k).val / 1e6).toFixed(0)}M tagged`);
    if (filedConcept === "Declared" && cp.has(k) === false && dec.has(k)) flags.push("declared vs paid timing possible");
    if (est > filed * 1.05) flags.push("estimate HIGH (special dividend, or paid > declared)");
    if (est < filed * 0.95) flags.push("estimate LOW (share count, or paid < declared)");
    rows.push({ s, k, est, filed, filedConcept, err, paidConcept: paidC !== null ? "CommonStock" : "All", flags });
  }
  const within = (rs) => rs.filter((r) => r.err <= 0.05).length;
  const by = (pred) => rows.filter(pred);
  console.log(`\n## A2 — cash paid ÷ weighted-average basic shares vs the filed per-share dividend (newest FY with all three)`);
  console.log(`US-GAAP payers read: ${payers.length} · cases with all three in one fiscal year (within 3 years): ${rows.length}`);
  console.log(`within ±5%: ${within(rows)}/${rows.length} (${pct(within(rows), rows.length)}) · median ${((quant(rows.map((r) => r.err), 0.5) ?? 0) * 100).toFixed(2)}% · p90 ${((quant(rows.map((r) => r.err), 0.9) ?? 0) * 100).toFixed(2)}%`);
  for (const [label, pred] of [
    ["filed figure is …CashPaid (paid vs paid)", (r) => r.filedConcept === "CashPaid"],
    ["filed figure is …Declared", (r) => r.filedConcept === "Declared"],
    ["paid from PaymentsOfDividendsCommonStock", (r) => r.paidConcept === "CommonStock"],
    ["paid from PaymentsOfDividends", (r) => r.paidConcept === "All"],
  ]) { const g = by(pred); console.log(`  ${label}: ${within(g)}/${g.length} (${pct(within(g), g.length)})`); }
  const misses = rows.filter((r) => r.err > 0.05).sort((a, b) => b.err - a.err);
  console.log(`misses (${misses.length}):`);
  for (const r of misses.slice(0, 60)) console.log(`  ${r.s} FY to ${r.k.split("|")[1]}: est ${r.est.toFixed(3)} vs filed ${r.filed.toFixed(3)} (${r.filedConcept}) ${(r.err * 100).toFixed(1)}% — ${r.flags.join("; ") || "no flag"}`);
}

console.log(`\nRedis commands: ${commands} (SMEMBERS/MGET/HMGET), read-only · SEC requests: ${sec} at ≤ 8/s · nothing written`);
