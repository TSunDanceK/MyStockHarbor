// THE SEC INPUTS FOR THE EMPTY AND DASHED PICKER COLUMNS (#552 COWORK #160 §1).
// Reads only.
//
// Since FMP's stockdata lapsed, the dividend pickers render empty and
// /low-pe-stocks dashes Ent. Value, P/FCF, PS, PB and Market Cap on part of its
// rows. B's picker rows are already built from the stored SEC sets by the
// SHIPPED functions (pickersSecFundamentals.buildSecPickerRow /
// applySecPickerRow, over A's secValuation and secEstimates). This census runs
// exactly those functions, so a "covered" cell here is a cell the grid can
// fill, and a gap is named by which input is missing.
//
// THREE POPULATIONS:
//   1. the Pickers universe (msh:pickers:v10:symbols): a stored set read with
//      MGET (dot/dash spellings, the field-hash gate as readFactSet applies it);
//   2. every stored set (the fact-set index);
//   3. A SAMPLE OF THE BACKFILL (CODE-A #165): eligible universe symbols with
//      no stored set, every k-th of the sorted list, cold-read from
//      companyfacts and built with the shipped extractForSymbol + toStoredSet
//      (FX through the shipped sources), never written anywhere.
// For each: cells per input, "fresh" (period end within 15 months, A's
// EPS_MAX_AGE_MONTHS), split US-GAAP / IFRS / unknown by the set's taxonomy
// list. The sample also counts the RAW dividend concepts in companyfacts,
// including the ones no chain reads (…PerShareCashPaid, the IFRS per-share).
//
// SPOT CHECKS: KO PEP JNJ VZ O and five non-payers. The stored TTM DPS against
// each concept's newest fiscal-year fact in companyfacts, and the lines of the
// latest 10-K's text that state a dividend per share (for a person to read:
// the regex finds candidates, it does not judge them).
//
//   relay task: write-sec-picker-inputs-census (READ-ONLY despite the prefix:
//   the credentials live in that job). Redis GET/MGET/SMEMBERS/HMGET only.
//   SEC: one companyfacts per sampled symbol, plus companyfacts, submissions
//   and the 10-K document per spot-check symbol, paced at ≤ 8/s.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";

const LOCAL = process.env.LOCAL_FIXTURE === "1";
const SAMPLE = Number(process.env.SAMPLE ?? 200);
const TODAY = new Date().toISOString().slice(0, 10);
const FRESH_DAYS = 456; // 15 months, A's EPS_MAX_AGE_MONTHS
const NOMINAL_PRICE = 100; // presence of a ratio cell, not its value

const { buildSecPickerRow, applySecPickerRow, unitOf, moneyIsUsd, PICKERS_SEC_KEY } = await import("../lib/server/pickersSecFundamentals.ts");
const { twelveMonthsOf, multipleInputs } = await import("../lib/server/secValuation.ts");
const { enterpriseValueOf } = await import("../lib/server/secEstimates.ts");
const { valueOf } = await import("../lib/server/secFactCodec.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const { registrantFor } = await import("../lib/server/stockProfile.ts");
const { adsRatioFor } = await import("../lib/server/secAdsMap.ts");
const { citedCoverFor, nonEquityListingOf } = await import("../lib/server/secPrimaryListing.ts");

const filerOf = (s) => ({
  annualForm: registrantFor(s)?.annualForm ?? null,
  ads: adsRatioFor(s),
  nonEquity: nonEquityListingOf(s),
  sic: registrantFor(s)?.sic ?? null,
  citedCover: citedCoverFor(s),
});
const ageDays = (iso) => (Date.parse(TODAY) - Date.parse(iso)) / 86400000;
const fresh = (iso) => Boolean(iso) && ageDays(iso) <= FRESH_DAYS;
const taxOf = (set) => {
  const tx = set.tx ?? null;
  if (!tx) return "unknown";
  if (tx.includes("ifrs-full") && !tx.includes("us-gaap")) return "ifrs";
  return tx.includes("us-gaap") ? "gaap" : "unknown";
};

/** Every input COWORK #160 names, measured on one set with the shipped functions. */
function measure(set) {
  const sym = set.symbol;
  const row = buildSecPickerRow(set, TODAY, filerOf(sym), Date.now());
  const fig = applySecPickerRow(row, NOMINAL_PRICE);
  const usd = moneyIsUsd(unitOf(set));
  const m = row.m ?? multipleInputs(set);
  const bs = m.balanceSheet;
  const dps = twelveMonthsOf(set, ["dividendsDeclaredPerShare"]);
  const paid = twelveMonthsOf(set, ["dividendsPaid"]);
  const ni = twelveMonthsOf(set, ["netIncome"]);
  const cf = twelveMonthsOf(set, ["operatingCashFlow", "capex"]);
  const everDps = [...set.quarters, ...set.years].some((p) => (valueOf(p, "dividendsDeclaredPerShare") ?? 0) > 0);
  const everPaid = [...set.quarters, ...set.years].some((p) => Math.abs(valueOf(p, "dividendsPaid") ?? 0) > 0);
  const ev = enterpriseValueOf(1e9, bs, filerOf(sym).sic);
  const out = {
    tax: taxOf(set),
    usd,
    periods: set.quarters.length + set.years.length > 0,
    // Dividends
    payerByTag: everDps || everPaid,
    dpsTtm: fig.divPerShare != null,
    dpsTtmFresh: fig.divPerShare != null && fresh(dps?.periodEnd),
    dpsBasisQuarters: dps?.basis === "four-quarters",
    paidTtmFresh: usd && paid != null && fresh(paid.periodEnd),
    dpsGrowth: fig.divGrowth != null,
    payout: row.payout != null,
    payoutCash: usd && paid != null && ni != null && ni.vals.netIncome > 0 && fresh(paid.periodEnd),
    // Ratio inputs
    marketCap: fig.marketCap != null,
    evInputs: usd && "val" in ev && ev.val != null && fresh(bs?.asOf),
    evInputsEstimated: usd && ev.val != null && Boolean(ev.est),
    evMissing: usd && ev.val == null ? ev.missing : [],
    evCell: fig.enterpriseValue != null,
    fcf: row.freeCashFlow != null && fresh(cf?.periodEnd),
    pfcfCell: fig.pfcfRatio != null,
    revenue: usd && m.revenue != null && !m.revenueIncomplete && fresh(m.revenue.periodEnd),
    revenueIncomplete: Boolean(m.revenueIncomplete),
    psCell: fig.psRatio != null,
    equity: usd && bs != null && fresh(bs.asOf) && ((bs.equity ?? 0) > 0 || (bs.derivedEquity?.val ?? 0) > 0),
    pbCell: fig.pbRatio != null,
    bsFresh: bs != null && fresh(bs.asOf),
  };
  return out;
}

const KEYS = [
  ["payerByTag", "any dividend tag > 0 on file"],
  ["dpsTtm", "Div ($) cell: TTM declared DPS"],
  ["dpsTtmFresh", "  … period end within 15 months"],
  ["dpsBasisQuarters", "  … from four quarters (else FY)"],
  ["paidTtmFresh", "cash dividends paid, twelve months, fresh (÷ shares fallback)"],
  ["dpsGrowth", "Div Growth cell"],
  ["payout", "Payout cell (one period)"],
  ["payoutCash", "payout by cash paid ÷ net income possible"],
  ["marketCap", "Market Cap cell (shares)"],
  ["evInputs", "EV inputs (debt + cash), fresh"],
  ["evInputsEstimated", "  … of which ≈ (short-term debt untagged)"],
  ["evCell", "Ent. Value cell"],
  ["fcf", "FCF (OCF − capex), fresh"],
  ["pfcfCell", "P/FCF cell"],
  ["revenue", "TTM revenue, complete, fresh"],
  ["psCell", "PS cell"],
  ["equity", "equity > 0, fresh (parent or derived)"],
  ["pbCell", "PB cell"],
];

function table(label, rows) {
  const groups = { all: rows, gaap: rows.filter((r) => r.tax === "gaap"), ifrs: rows.filter((r) => r.tax === "ifrs"), unknown: rows.filter((r) => r.tax === "unknown") };
  const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
  console.log(`\n### ${label}: ${rows.length} sets (US-GAAP ${groups.gaap.length} · IFRS ${groups.ifrs.length} · unknown ${groups.unknown.length}; with periods ${rows.filter((r) => r.periods).length}; money in USD ${rows.filter((r) => r.usd).length})`);
  console.log("| input | all | US-GAAP | IFRS |\n|---|---|---|---|");
  for (const [k, name] of KEYS) {
    const c = (g) => g.filter((r) => r[k]).length;
    console.log(`| ${name} | ${c(groups.all)} (${pct(c(groups.all), groups.all.length)}) | ${c(groups.gaap)} (${pct(c(groups.gaap), groups.gaap.length)}) | ${c(groups.ifrs)} (${pct(c(groups.ifrs), groups.ifrs.length)}) |`);
  }
  const payers = rows.filter((r) => r.payerByTag);
  console.log(`payers by tag: ${payers.length} · of those with a Div ($) cell: ${payers.filter((r) => r.dpsTtm).length} · fresh: ${payers.filter((r) => r.dpsTtmFresh).length} · growth: ${payers.filter((r) => r.dpsGrowth).length} · payout: ${payers.filter((r) => r.payout).length}`);
  const evMiss = {};
  for (const r of rows) for (const m of r.evMissing) evMiss[m] = (evMiss[m] ?? 0) + 1;
  console.log(`EV missing input: ${Object.entries(evMiss).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"} · revenue refused as incomplete: ${rows.filter((r) => r.revenueIncomplete).length} · balance sheet fresh: ${rows.filter((r) => r.bsFresh).length}`);
}

// ── LOCAL: the committed AAPL set, so the measure runs before any relay ───
if (LOCAL) {
  const set = JSON.parse(fs.readFileSync("data/sec/factset-fixture-AAPL.json", "utf8"));
  console.log(set.h === secFieldsHash() ? "fixture hash matches" : `fixture hash ${set.h} != ${secFieldsHash()}`);
  console.log(JSON.stringify(measure(set), null, 1));
  table("local fixture", [measure(set)]);
  process.exit(0);
}

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();
const { SEC_FACTS_INDEX_KEY, dotDashSpellings } = await import("../lib/server/secManifest.ts");
const { factKey } = await import("../lib/server/secFactStore.ts");
const { cikForSymbol } = await import("../lib/server/secColdFetch.ts");
const { secSeedRefusal } = await import("../lib/server/secSeedGate.ts");
const { SEED_WARM_TARGETS_KEYS, warmSymbolsOf, unionSeedUniverse } = await import("../lib/server/secSeedUniverse.ts");
const { TIINGO_UNIVERSE_KEY } = await import("../lib/server/marketData/keys.ts");
const { parseTiingoUniverse } = await import("../lib/server/tiingoUniverse.ts");
const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { toStoredSet } = await import("../lib/server/secFactBuild.ts");
const { secUserAgent } = await import("../lib/server/news/userAgent.ts");

let commands = 0;
const pickersSrc = fs.readFileSync("lib/server/pickersBuilder.ts", "utf8");
const PICKERS_SYMBOLS_KEY = (pickersSrc.match(/export const PICKERS_SYMBOLS_KEY = "([^"]+)";/) ?? [])[1];
const get = async (k) => { commands++; return redis.get(k); };
const HASH = secFieldsHash();

/** Sets for many symbols: MGET in batches over each symbol's spellings; the readFactSet gate. */
async function readSets(symbols) {
  const out = new Map();
  const keys = [...new Set(symbols.flatMap((s) => dotDashSpellings(s).map(factKey)))];
  const got = new Map();
  for (let i = 0; i < keys.length; i += 40) {
    const batch = keys.slice(i, i + 40);
    commands++;
    const vals = await redis.mget(...batch);
    batch.forEach((k, j) => { if (vals[j]) got.set(k, vals[j]); });
  }
  let hashMiss = 0;
  for (const s of symbols) {
    const raw = dotDashSpellings(s).map((sp) => got.get(factKey(sp))).find(Boolean);
    if (!raw) continue;
    const set = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (set.h !== HASH || !Array.isArray(set.quarters)) { hashMiss++; continue; }
    out.set(s, set);
  }
  return { sets: out, hashMiss };
}

// ── SEC pacing, shared by 3 and 4 ─────────────────────────────────────────
const GAP_MS = 125; // 8/s
let last = 0, secRequests = 0;
async function secGet(url, as = "json") {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); secRequests++;
  const res = await fetch(url, { headers: { "user-agent": secUserAgent(), accept: as === "json" ? "application/json" : "text/html" } });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: as === "json" ? await res.json() : await res.text() };
}
const RAW = {
  declared: ["us-gaap", "CommonStockDividendsPerShareDeclared"],
  cashPaid: ["us-gaap", "CommonStockDividendsPerShareCashPaid"],
  paymentsCommon: ["us-gaap", "PaymentsOfDividendsCommonStock"],
  payments: ["us-gaap", "PaymentsOfDividends"],
  ifrsPaid: ["ifrs-full", "DividendsPaidClassifiedAsFinancingActivities"],
  ifrsPaid2: ["ifrs-full", "DividendsPaid"],
  ifrsPerShare: ["ifrs-full", "DividendsRecognisedAsDistributionsToOwnersPerShare"],
};
const rawLatestFy = (facts, [ns, concept]) => {
  const units = facts?.facts?.[ns]?.[concept]?.units;
  if (!units) return null;
  const all = Object.entries(units).flatMap(([u, arr]) => arr.map((f) => ({ ...f, unit: u })));
  const fy = all.filter((f) => f.form?.startsWith("10-K") || f.form?.startsWith("20-F") || f.form?.startsWith("40-F"))
    .filter((f) => f.start && (Date.parse(f.end) - Date.parse(f.start)) / 86400000 > 350);
  fy.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : (a.filed < b.filed ? 1 : -1)));
  return fy[0] ? { val: fy[0].val, end: fy[0].end, unit: fy[0].unit, form: fy[0].form } : { val: null, end: null, any: all.length };
};

// ── FOLLOW-UP (FOLLOWUP=1): which concepts would close the two biggest gaps ─
// Over the Pickers universe's stored sets: (a) payers by tag with no Div ($)
// cell, does companyfacts carry a FRESH CommonStockDividendsPerShareCashPaid
// (filed per share) or only cash paid; (b) the EV gaps, which debt and cash
// concepts the filer tags at its stored balance-sheet date. One companyfacts
// per symbol, paced at ≤ 8/s. Nothing written.
if (process.env.FOLLOWUP === "1") {
  const pk = ((await get(PICKERS_SYMBOLS_KEY)) ?? []).map(String);
  const st = await readSets(pk);
  const DEBT = ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper", "LinesOfCreditCurrent", "NotesPayableCurrent",
    "LongTermDebt", "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebtAndCapitalLeaseObligationsCurrent",
    "LongTermNotesPayable", "ConvertibleNotesPayable", "ConvertibleDebtNoncurrent", "SeniorNotes", "UnsecuredDebt", "SecuredDebt",
    "OtherLongTermDebtNoncurrent", "LongTermLineOfCredit", "DebtInstrumentCarryingAmount", "DebtLongtermAndShorttermCombinedAmount",
    "FinanceLeaseLiability", "FinanceLeaseLiabilityCurrent", "FinanceLeaseLiabilityNoncurrent", "OperatingLeaseLiability"];
  const CASH = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash", "CashAndDueFromBanks", "CashEquivalentsAtCarryingValue"];
  const at = (facts, concept, end) => {
    const units = facts?.facts?.["us-gaap"]?.[concept]?.units;
    if (!units) return { any: false, atEnd: null };
    const arr = Object.values(units).flat();
    const hit = arr.find((f) => f.end === end && !f.start);
    return { any: true, atEnd: hit ? hit.val : null };
  };
  const divGap = [], evGap = [];
  for (const [s, set] of st.sets) {
    const r = measure(set);
    if (r.tax !== "gaap" || !r.usd) continue;
    if (r.payerByTag && !r.dpsTtm) divGap.push([s, set]);
    if (r.evMissing.length && !r.evInputs) evGap.push([s, set, r.evMissing]);
  }
  const need = new Map([...divGap, ...evGap].map(([s, set]) => [s, set]));
  const facts = new Map();
  for (const [s, set] of need) {
    const cik = String(set.cik ?? cikForSymbol(s)).padStart(10, "0");
    const r = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    if (r.body) facts.set(s, r.body);
  }
  // (a) dividends
  let cashPaidFresh = 0, cashPaidStale = 0, declaredFreshRaw = 0, neither = 0;
  const cpSyms = [];
  for (const [s] of divGap) {
    const f = facts.get(s);
    const cp = rawLatestFy(f, RAW.cashPaid), dec = rawLatestFy(f, RAW.declared);
    if (dec?.end && fresh(dec.end)) declaredFreshRaw++;
    if (cp?.end && fresh(cp.end)) { cashPaidFresh++; cpSyms.push(s); }
    else if (cp?.val != null || cp?.any) cashPaidStale++;
    else if (!(dec?.end)) neither++;
  }
  console.log(`\n## Follow-up (a): US-GAAP payers by tag with no Div ($) cell: ${divGap.length}`);
  console.log(`  a FRESH FY CommonStockDividendsPerShareCashPaid: ${cashPaidFresh} · CashPaid only stale/non-FY: ${cashPaidStale} · a fresh FY Declared in companyfacts the set lacks: ${declaredFreshRaw} · no per-share dividend concept at all: ${neither}`);
  console.log(`  CashPaid symbols: ${cpSyms.join(" ")}`);
  // (b) EV
  const tally = {}, cashTally = {};
  let noDebtConceptEver = 0;
  for (const [s, set, missing] of evGap) {
    const f = facts.get(s);
    const end = multipleInputs(set).balanceSheet?.asOf;
    if (!f || !end) continue;
    const debtHits = DEBT.filter((c) => at(f, c, end).atEnd != null);
    if (!DEBT.some((c) => at(f, c, end).any)) noDebtConceptEver++;
    for (const c of debtHits) tally[c] = (tally[c] ?? 0) + 1;
    if (missing.includes("cash")) for (const c of CASH) if (at(f, c, end).atEnd != null) cashTally[c] = (cashTally[c] ?? 0) + 1;
  }
  console.log(`\n## Follow-up (b): US-GAAP sets with an EV input missing: ${evGap.length} · no debt concept ever tagged (likely debt-free, not provable): ${noDebtConceptEver}`);
  console.log(`  debt concepts filed AT the stored balance-sheet date: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`  where cash is missing, cash concepts filed at that date: ${Object.entries(cashTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`);
  console.log(`\nRedis commands: ${commands} · SEC requests: ${secRequests} at ≤ 8/s · nothing written`);
  process.exit(0);
}

// ── 1. The Pickers universe ───────────────────────────────────────────────
const pickers = ((await get(PICKERS_SYMBOLS_KEY)) ?? []).map(String);
const p = await readSets(pickers);
const rows1 = [...p.sets.values()].map(measure);
commands++;
const hashRows = pickers.length ? await redis.hmget(PICKERS_SEC_KEY, ...pickers) : {};
const withRow = pickers.filter((s) => hashRows?.[s] != null).length;
console.log(`## Pickers universe (${PICKERS_SYMBOLS_KEY}): ${pickers.length} symbols · stored set ${p.sets.size} · field-hash miss ${p.hashMiss} · no set ${pickers.length - p.sets.size - p.hashMiss} · row in the pickers SEC hash ${withRow}`);
table("Pickers universe, stored sets", rows1);

// ── 2. Every stored set ───────────────────────────────────────────────────
commands++;
const indexed = (await redis.smembers(SEC_FACTS_INDEX_KEY)).map(String);
const all = await readSets(indexed);
table("every stored set (fact-set index)", [...all.sets.values()].map(measure));

// ── 3. The backfill sample ────────────────────────────────────────────────
let warm = null;
for (const k of SEED_WARM_TARGETS_KEYS) { warm = warmSymbolsOf(await get(k)); if (warm) break; }
const tiingo = parseTiingoUniverse(await get(TIINGO_UNIVERSE_KEY))?.symbols ?? [];
const universe = unionSeedUniverse(warm ?? [], tiingo);
const index = new Set(indexed.map((s) => s.toUpperCase()));
const incoming = universe
  .filter((s) => { const cik = cikForSymbol(s); return cik && !secSeedRefusal(s, cik); })
  .filter((s) => !dotDashSpellings(s).some((k) => index.has(k.toUpperCase())))
  .sort();
const step = Math.max(1, Math.floor(incoming.length / SAMPLE));
const sample = incoming.filter((_, i) => i % step === 0).slice(0, SAMPLE);
const rows3 = [], rawCount = Object.fromEntries(Object.keys(RAW).map((k) => [k, 0]));
const failed = {};
const fxCache = new Map();
for (const s of sample) {
  const cik = String(cikForSymbol(s)).padStart(10, "0");
  try {
    const r = await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    if (!r.body) { failed[`http-${r.status}`] = (failed[`http-${r.status}`] ?? 0) + 1; continue; }
    for (const [k, c] of Object.entries(RAW)) {
      const f = rawLatestFy(r.body, c);
      if (f && f.end && fresh(f.end)) rawCount[k]++;
    }
    const set = await toStoredSet(extractForSymbol(s, r.body), undefined, fxCache);
    rows3.push(measure({ ...set, symbol: set.symbol ?? s }));
  } catch (e) {
    const why = `threw: ${String(e?.message ?? e).slice(0, 50)}`;
    failed[why] = (failed[why] ?? 0) + 1;
  }
}
console.log(`\n## Backfill sample: incoming (eligible, no stored set) ${incoming.length} · every ${step}th · sampled ${sample.length} · built ${rows3.length} · not built ${JSON.stringify(failed)}`);
table("backfill sample, cold-read (projected)", rows3);
console.log(`raw companyfacts, newest FY fact within 15 months (of ${rows3.length + Object.values(failed).reduce((a, b) => a + b, 0) - (failed["http-404"] ?? 0)} read): ` +
  Object.entries(rawCount).map(([k, v]) => `${RAW[k][1]} ${v}`).join(" · "));

// ── 4. Spot checks ────────────────────────────────────────────────────────
const PAYERS = ["KO", "PEP", "JNJ", "VZ", "O"];
const NON_PAYERS = ["AMZN", "TSLA", "BRK.B", "NFLX", "ADBE"];
console.log("\n## Spot checks (stored TTM DPS vs the filings)");
const stored = await readSets([...PAYERS, ...NON_PAYERS]);
for (const s of [...PAYERS, ...NON_PAYERS]) {
  const set = stored.sets.get(s);
  const dps = set ? twelveMonthsOf(set, ["dividendsDeclaredPerShare"]) : null;
  const paid = set ? twelveMonthsOf(set, ["dividendsPaid"]) : null;
  const cik = String(cikForSymbol(s)).padStart(10, "0");
  const facts = (await secGet(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`)).body;
  const dec = rawLatestFy(facts, RAW.declared), cp = rawLatestFy(facts, RAW.cashPaid);
  console.log(`\n${s}: stored TTM DPS ${dps ? `${dps.vals.dividendsDeclaredPerShare.toFixed(4)} (${dps.basis} to ${dps.periodEnd})` : "none"} · stored dividends paid ${paid ? `${(paid.vals.dividendsPaid / 1e6).toFixed(0)}M (${paid.basis} to ${paid.periodEnd})` : "none"}`);
  console.log(`  companyfacts FY: Declared ${dec?.val ?? "—"} (${dec?.end ?? "none"}) · CashPaid ${cp?.val ?? "—"} (${cp?.end ?? "none"})`);
  // The latest 10-K's own words.
  const sub = (await secGet(`https://data.sec.gov/submissions/CIK${cik}.json`)).body;
  const r = sub?.filings?.recent;
  const i = r ? r.form.findIndex((f) => f === "10-K") : -1;
  if (i < 0) { console.log("  10-K: none in recent filings"); continue; }
  const accn = r.accessionNumber[i].replace(/-/g, "");
  const doc = (await secGet(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn}/${r.primaryDocument[i]}`, "text")).body ?? "";
  const text = doc.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const hits = [...text.matchAll(/[^.]{0,120}dividends?[^.]{0,60}per (?:common )?share[^.]{0,120}/gi)]
    .map((m) => m[0].trim()).filter((t) => /\$\s?\d|\d\.\d{2}/.test(t)).slice(0, 3);
  console.log(`  10-K filed ${r.filingDate[i]} (report ${r.reportDate[i]}): ${hits.length ? "" : "no per-share dividend sentence with a figure found"}`);
  for (const h of hits) console.log(`    “${h.slice(0, 260)}”`);
}

console.log(`\nRedis commands: ${commands} (GET/MGET/SMEMBERS/HMGET), read-only · SEC requests: ${secRequests} at ≤ 8/s · nothing written`);
