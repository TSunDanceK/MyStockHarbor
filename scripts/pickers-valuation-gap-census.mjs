// THE EMPTY PICKERS VALUATION CELLS, BY CAUSE (#552 COWORK #171). READ-ONLY.
//
// Over the Pickers universe (the last build's own symbol list), for Market cap,
// Ent. value, P/E, P/S, P/B and P/FCF: which cells the grid leaves empty, and
// why. The cells and their reason codes come from the SHIPPED functions the
// page runs (readSecPickerRows → applySecPickerRow / applySecEarnings →
// secPickerWhy), at the pool price, so an empty cell here is an empty cell on
// the page. Each code is then put in one of COWORK #171's causes:
//
//   design   not meaningful by design (bank/insurer EV, P/S, P/FCF; negative or
//            zero FCF; a loss or near-zero EPS; equity ≤ 0 or too small; an
//            incomplete revenue line; a debt security) — correct as is;
//   debt     Ent. value refused for a missing debt line (the B2 gap);
//   foreign  a 20-F/40-F filer (or a non-USD set / ADS ratio) whatever the code;
//   class    a share class or ticker with no own row (multi-class shares, or
//            no filings row where the base ticker has one);
//   shares   no usable cover-page share count (none, or stale), US filers;
//   other    anything else, by code.
//
// Then, for each fillable cause, a MEASURE of the fix (never a build):
//   debt     option (c), sum the debt components at the balance-sheet date:
//            the cells it would fill, and a BACK-TEST on filers that DO tag the
//            line — the component sum against the filed line, and the EV that
//            follows, against the ≈ rule (within 5% for 9 in 10);
//   shares   balance-sheet CommonStockSharesOutstanding in place of the cover
//            count: the cells it would fill, and the same back-test (balance-
//            sheet count against the cover count, within 5% for 9 in 10);
//   foreign  annual-only figures: months since each filer's latest fiscal
//            year end, and which empty cells a fiscal-year figure exists for;
//   class    whether the base ticker has a row (P/E could follow; cap-based
//            columns need every class's price).
//
// READ-ONLY, ENFORCED: every Upstash request is inspected and any non-read verb
// is refused before it is sent. FMP is never called. SEC: one companyfacts per
// measured filer, paced at ≤ 8/s. PUBLIC LOG: counts, symbols and codes only;
// no prices and no figures.
//
//   relay task: write-pickers-valuation-gap-census (READ-ONLY despite the
//   prefix: the credentials live in that job).
import { register } from "node:module";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

delete process.env.FMP_API_KEY;
// THE PRICE THE PAGE DIVIDES BY: production serves the pool from Tiingo
// (PRICE_PROVIDER_POOL=tiingo); the relay job does not set it, and without it
// the read returns the retired FMP rows — every cell then reads "no price".
process.env.PRICE_PROVIDER_POOL = "tiingo";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("FATAL: needs the Upstash credentials (write- relay job).");
  process.exit(2);
}

const READ_VERBS = new Set(["GET", "MGET", "HGET", "HMGET", "HGETALL", "HKEYS", "HLEN", "EXISTS", "TTL", "PTTL", "STRLEN", "TYPE", "SMEMBERS", "SCARD"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
const meter = { commands: 0, refused: 0, sec: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    for (const c of cmds) {
      const verb = String(c?.[0] ?? "").toUpperCase();
      if (!READ_VERBS.has(verb)) { meter.refused++; throw new Error(`census is read-only: refused ${verb}`); }
    }
    meter.commands += cmds.length || 1;
  }
  return realFetch(input, init);
};

const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();
const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
const S = await import("../lib/server/pickersSecFundamentals.ts");
const { readPricePoolBulk } = await import("../lib/server/pricePool.ts");
const { resolveProfileBulk } = await import("../lib/server/staticProfile.ts");
const { registrantFor } = await import("../lib/server/stockProfile.ts");
const { enterpriseValueOf } = await import("../lib/server/secEstimates.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const { balanceSheetInstant, valueOf } = await import("../lib/server/secFactCodec.ts");
const { dotDashSpellings } = await import("../lib/server/secManifest.ts");
const { factKey } = await import("../lib/server/secFactStore.ts");
const { isBankOrInsurer } = await import("../lib/pickerCellWhy.ts");
const { secUserAgent } = await import("../lib/server/news/userAgent.ts");

const COLS = ["marketCap", "ev", "pe", "ps", "pb", "pfcf"];
const LABEL = { marketCap: "Market cap", ev: "Ent. value", pe: "P/E", ps: "P/S", pb: "P/B", pfcf: "P/FCF" };
const CAUSES = ["design", "debt", "foreign", "class", "shares", "other"];
const DESIGN = new Set(["naEv", "naPs", "naFcf", "fcfNeg", "fcf0", "epsNeg", "eps0", "eqNeg", "eqSmall", "ebitNeg", "revInc", "debt"]);
const TODAY = new Date().toISOString().slice(0, 10);
const months = (iso) => (Date.parse(TODAY) - Date.parse(iso)) / (86400000 * 30.44);
const list = (a, n = 30) => (a.length ? ` [${a.slice(0, n).join(" ")}${a.length > n ? ` +${a.length - n}` : ""}]` : "");
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

// ── the universe, its rows, prices, industry labels and stored sets ─────────
const raw = await redis.get(PICKERS_SYMBOLS_KEY);
const listed = typeof raw === "string" ? JSON.parse(raw) : raw;
const universe = Array.isArray(listed) ? listed.map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [];
if (!universe.length) { console.error("FATAL: no Pickers symbol list in the store."); process.exit(1); }
const rows = await S.readSecPickerRows(universe);
const pool = await readPricePoolBulk(universe);
const taxonomy = resolveProfileBulk(universe.map((s) => ({ symbol: s, cached: null })), "valuation gap census");
const keys = [...new Set(universe.flatMap((s) => dotDashSpellings(s).map(factKey)))];
const sets = new Map();
for (let i = 0; i < keys.length; i += 40) {
  const b = keys.slice(i, i + 40);
  const v = await redis.mget(...b);
  b.forEach((k, j) => { if (v[j]) sets.set(k, typeof v[j] === "string" ? JSON.parse(v[j]) : v[j]); });
}
const setOf = (s) => {
  const x = dotDashSpellings(s).map((sp) => sets.get(factKey(sp))).find(Boolean);
  return x && x.h === secFieldsHash() ? x : null;
};
console.log(`universe (last build's list): ${universe.length} · filings rows: ${[...rows.keys()].length} · current stored sets: ${universe.filter(setOf).length}`);

const foreignOf = (s) => {
  const f = registrantFor(s)?.annualForm ?? "";
  return /^(20-F|40-F)/.test(f);
};
const baseOf = (s) => s.split(/[-.]/)[0];

// ── 1. every empty cell, its code and its cause ─────────────────────────────
const cells = []; // { s, col, code, cause, evMissing? }
for (const s of universe) {
  const row = rows.get(s);
  const foreign = foreignOf(s);
  if (!row) {
    const classLike = /[-.]/.test(s) && (rows.has(baseOf(s)) || [...rows.keys()].some((k) => baseOf(k) === baseOf(s)));
    const cause = classLike ? "class" : foreign ? "foreign" : "other";
    const code = classLike ? "noRow:class" : !registrantFor(s) ? "noRow:noRegistrant" : "noRow";
    for (const col of COLS) cells.push({ s, col, code, cause });
    continue;
  }
  const p = pool.get(s)?.price;
  const price = typeof p === "number" && Number.isFinite(p) ? p : null;
  const f = S.applySecPickerRow(row, price);
  const e = S.applySecEarnings(row, price);
  const why = S.secPickerWhy(row, price, f, e, taxonomy.get(s)?.industry ?? null);
  for (const col of COLS) {
    const code = why[col];
    if (!code) continue;
    let cause;
    let evMissing;
    if (DESIGN.has(code)) cause = "design";
    else if (foreign || code === "fx" || code === "adsS" || code === "adsE") cause = "foreign";
    else if (code === "multi") cause = "class";
    else if (code === "noShr" || code === "shOld") cause = "shares";
    else if (code === "evIn") {
      const ev = enterpriseValueOf(f.marketCap, row.m.balanceSheet, row.inputs.sic ?? null);
      evMissing = ev.missing ?? [];
      cause = evMissing.some((m) => /debt/.test(m)) ? "debt" : "other";
    } else cause = "other";
    cells.push({ s, col, code: evMissing && cause === "other" ? `evIn:${evMissing.join("+") || "?"}` : code, cause, evMissing });
  }
}

console.log("\n## 1. EMPTY CELLS BY COLUMN AND CAUSE");
console.log(`| Column | Empty | ${CAUSES.join(" | ")} |`);
console.log(`|---|---|${CAUSES.map(() => "---").join("|")}|`);
for (const col of COLS) {
  const c = cells.filter((x) => x.col === col);
  console.log(`| ${LABEL[col]} | ${c.length} | ${CAUSES.map((k) => c.filter((x) => x.cause === k).length).join(" | ")} |`);
}
const all = cells.length;
console.log(`| **All six** | ${all} | ${CAUSES.map((k) => cells.filter((x) => x.cause === k).length).join(" | ")} |`);
console.log("\nCodes within each cause (cells · distinct symbols):");
for (const k of CAUSES) {
  const byCode = new Map();
  for (const x of cells.filter((y) => y.cause === k)) {
    if (!byCode.has(x.code)) byCode.set(x.code, { n: 0, syms: new Set() });
    byCode.get(x.code).n++; byCode.get(x.code).syms.add(x.s);
  }
  const parts = [...byCode.entries()].sort((a, b) => b[1].n - a[1].n).map(([c, v]) => `${c} ${v.n} (${v.syms.size}${v.syms.size <= 8 ? `: ${[...v.syms].join(" ")}` : ""})`);
  console.log(`  ${k}: ${parts.join(" · ") || "none"}`);
}

// ── SEC reads, paced ────────────────────────────────────────────────────────
let last = 0;
const factsCache = new Map();
async function companyFacts(cik) {
  if (factsCache.has(cik)) return factsCache.get(cik);
  const wait = last + 125 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); meter.sec++;
  const r = await realFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`, { headers: { "user-agent": secUserAgent(), accept: "application/json" } });
  const f = r.ok ? await r.json() : null;
  factsCache.set(cik, f);
  return f;
}
const instantAt = (f, tax, c, end, unit = "USD") => {
  const rows = (f?.facts?.[tax]?.[c]?.units?.[unit] ?? []).filter((x) => x.end === end && !x.start);
  rows.sort((a, z) => (a.filed < z.filed ? 1 : -1));
  return rows[0]?.val ?? null;
};
const newestInstant = (f, tax, c, unit) => {
  const rows = (f?.facts?.[tax]?.[c]?.units?.[unit] ?? []).filter((x) => !x.start);
  rows.sort((a, z) => (a.end < z.end ? 1 : a.end > z.end ? -1 : a.filed < z.filed ? 1 : -1));
  return rows[0] ?? null;
};

// ── 2. debt: option (c), the component sum ──────────────────────────────────
// Components of each line (never its totals, which the chain already reads).
// Leases are left out: whether a lease belongs in "debt" is the chain's call.
const COMPONENTS = {
  shortTermDebt: ["LongTermDebtAndCapitalLeaseObligationsCurrent", "CommercialPaper", "OtherShortTermBorrowings", "LinesOfCreditCurrent", "NotesPayableCurrent", "BankOverdrafts", "ConvertibleNotesPayableCurrent", "SecuredDebtCurrent", "UnsecuredDebtCurrent"],
  longTermDebt: ["ConvertibleDebtNoncurrent", "SeniorNotes", "SecuredDebt", "UnsecuredDebt", "LongTermNotesPayable", "ConvertibleNotesPayable", "OtherLongTermDebtNoncurrent", "LongTermLineOfCredit", "SecuredLongTermDebt", "UnsecuredLongTermDebt", "SeniorLongTermNotes", "JuniorSubordinatedNotes"],
};
/** The sum of a line's components at one date; a value equal to one already counted is a restatement, not an addend. */
function componentSum(f, line, end) {
  const vals = [];
  for (const c of COMPONENTS[line]) {
    const v = instantAt(f, "us-gaap", c, end);
    if (v === null) continue;
    if (vals.some((u) => Math.abs(u - v) <= Math.max(1, Math.abs(v) * 0.005))) continue;
    vals.push(v);
  }
  return vals.length ? { sum: vals.reduce((a, b) => a + b, 0), n: vals.length } : null;
}
console.log("\n## 2. DEBT LINE MISSING — option (c), sum the components");
{
  const debtCells = cells.filter((x) => x.cause === "debt");
  const syms = [...new Set(debtCells.map((x) => x.s))];
  let fills = 0; const filled = [], notFilled = [];
  for (const s of syms) {
    const set = setOf(s); const b = set && balanceSheetInstant(set);
    if (!set || !b || !(set.tx ?? []).includes("us-gaap")) { notFilled.push(s); continue; }
    const f = await companyFacts(set.cik);
    const missing = Object.keys(COMPONENTS).filter((k) => valueOf(b, k) === null);
    // EV fills when both lines are found (filed, or a component sum) and cash is on file. A row
    // here was refused, so A's ≈ M2 (short-term untagged) did not apply to it: both are needed.
    const ltdOk = valueOf(b, "longTermDebt") !== null || componentSum(f, "longTermDebt", b.e) !== null;
    const stdOk = valueOf(b, "shortTermDebt") !== null || componentSum(f, "shortTermDebt", b.e) !== null;
    const cashOk = valueOf(b, "cash") !== null || valueOf(b, "cashIncludingRestricted") !== null;
    if (missing.length && ltdOk && stdOk && cashOk) { fills++; filled.push(s); } else notFilled.push(s);
  }
  console.log(`Ent. value cells refused for a missing debt line: ${debtCells.length} (${syms.length} symbols)`);
  console.log(`  would fill with the component sum: ${fills}${list(filled)}`);
  console.log(`  would not (no component filed at the balance-sheet date, or no cash): ${notFilled.length}${list(notFilled)}`);

  // BACK-TEST: filers that DO tag the line; the component sum against the filed figure.
  const sample = universe.filter((s) => {
    const set = setOf(s); const b = set && balanceSheetInstant(set);
    return set && b && (set.tx ?? []).includes("us-gaap") && !foreignOf(s) && valueOf(b, "longTermDebt") !== null && valueOf(b, "cash") !== null
      && !isBankOrInsurer(taxonomy.get(s)?.industry ?? null) && typeof pool.get(s)?.price === "number";
  }).filter((_, i) => i % 4 === 0).slice(0, 80);
  const line = { shortTermDebt: [], longTermDebt: [] }; const evErr = [];
  for (const s of sample) {
    const set = setOf(s); const b = balanceSheetInstant(set);
    const f = await companyFacts(set.cik);
    const sums = {};
    for (const k of Object.keys(COMPONENTS)) {
      const filedV = valueOf(b, k);
      const cs = componentSum(f, k, b.e);
      sums[k] = cs?.sum ?? null;
      if (filedV !== null && filedV > 0 && cs) line[k].push(Math.abs(cs.sum - filedV) / filedV);
    }
    const row = rows.get(s); if (!row) continue;
    const cap = S.applySecPickerRow(row, pool.get(s).price).marketCap;
    if (cap == null || sums.longTermDebt === null) continue;
    const std = valueOf(b, "shortTermDebt") ?? 0, ltd = valueOf(b, "longTermDebt"), cash = valueOf(b, "cash");
    const evFiled = cap + std + ltd - cash;
    const evSum = cap + (sums.shortTermDebt ?? std) + sums.longTermDebt - cash;
    if (evFiled > 0) evErr.push(Math.abs(evSum - evFiled) / evFiled);
  }
  const within = (a, t = 0.05) => a.filter((x) => x <= t).length;
  for (const k of Object.keys(COMPONENTS)) {
    const a = line[k];
    console.log(`  BACK-TEST ${k}: ${a.length} filers with the line filed AND ≥ 1 component · sum within 5% of the filed line: ${within(a)} (${pct(within(a), a.length)}) · over by > 5% (double count): ${a.filter((x, i) => x > 0.05).length}`);
  }
  console.log(`  BACK-TEST EV (the ≈ rule): ${evErr.length} filers · within 5%: ${within(evErr)} (${pct(within(evErr), evErr.length)}) · rule: 9 in 10`);
}

// ── 3. shares: the balance-sheet count ──────────────────────────────────────
console.log("\n## 3. NO USABLE COVER-PAGE SHARE COUNT (US filers)");
{
  const shareCells = cells.filter((x) => x.cause === "shares");
  const syms = [...new Set(shareCells.map((x) => x.s))];
  const fillable = [], none = [];
  for (const s of syms) {
    const set = setOf(s);
    if (!set) { none.push(s); continue; }
    const f = await companyFacts(set.cik);
    const bs = newestInstant(f, "us-gaap", "CommonStockSharesOutstanding", "shares");
    if (bs && months(bs.end) <= 15) fillable.push(s); else none.push(s);
  }
  const fillCells = shareCells.filter((x) => fillable.includes(x.s));
  console.log(`cells: ${shareCells.length} (${syms.length} symbols) · codes: ${[...new Set(shareCells.map((x) => x.code))].join(", ")}`);
  console.log(`  a balance-sheet share count within 15 months: ${fillable.length} symbols, ${fillCells.length} cells — by column: ${COLS.map((c) => `${LABEL[c]} ${fillCells.filter((x) => x.col === c).length}`).join(" · ")}${list(fillable)}`);
  console.log(`  none usable: ${none.length}${list(none)}`);
  // BACK-TEST: filers with both; the balance-sheet count against the cover count.
  const sample = universe.filter((s) => setOf(s) && !foreignOf(s) && rows.get(s)?.inputs?.shares).filter((_, i) => i % 6 === 0).slice(0, 60);
  const err = [];
  for (const s of sample) {
    const f = await companyFacts(setOf(s).cik);
    const cover = newestInstant(f, "dei", "EntityCommonStockSharesOutstanding", "shares");
    const bs = newestInstant(f, "us-gaap", "CommonStockSharesOutstanding", "shares");
    if (cover && bs && cover.val > 0) err.push(Math.abs(bs.val - cover.val) / cover.val);
  }
  const w = err.filter((x) => x <= 0.05).length;
  console.log(`  BACK-TEST: ${err.length} filers with both counts · balance-sheet count within 5% of the cover count: ${w} (${pct(w, err.length)}) · rule: 9 in 10`);
}

// ── 4. foreign / IFRS: annual-only figures and how stale they are ──────────
console.log("\n## 4. FOREIGN OR IFRS FILERS — annual-only figures");
{
  const fc = cells.filter((x) => x.cause === "foreign");
  const syms = [...new Set(fc.map((x) => x.s))];
  const ages = [], withYear = [], noSet = [];
  for (const s of syms) {
    const set = setOf(s);
    const fy = set?.years?.length ? [...set.years].sort((a, b) => (a.e < b.e ? 1 : -1))[0] : null;
    if (!fy) { noSet.push(s); continue; }
    withYear.push(s); ages.push(months(fy.e));
  }
  ages.sort((a, b) => a - b);
  const q = (p) => (ages.length ? ages[Math.min(ages.length - 1, Math.floor(p * ages.length))].toFixed(1) : "—");
  console.log(`cells: ${fc.length} (${syms.length} symbols) — by column: ${COLS.map((c) => `${LABEL[c]} ${fc.filter((x) => x.col === c).length}`).join(" · ")}`);
  console.log(`  codes: ${[...new Set(fc.map((x) => x.code))].map((c) => `${c} ${fc.filter((x) => x.code === c).length}`).join(" · ")}`);
  console.log(`  with a stored fiscal year: ${withYear.length} · months since that year end: median ${q(0.5)}, p90 ${q(0.9)}, max ${ages.length ? ages[ages.length - 1].toFixed(1) : "—"} · no stored set: ${noSet.length}${list(noSet)}`);
}

// ── 5. share class ─────────────────────────────────────────────────────────
console.log("\n## 5. SHARE CLASS OR TICKER WITH NO OWN ROW");
{
  const cc = cells.filter((x) => x.cause === "class");
  const syms = [...new Set(cc.map((x) => x.s))];
  console.log(`cells: ${cc.length} (${syms.length} symbols)${list(syms)} · codes: ${[...new Set(cc.map((x) => x.code))].join(", ")}`);
  console.log(`  base ticker has a row: ${syms.filter((s) => rows.has(baseOf(s))).length} (P/E could follow the base; the cap-based columns need every class's price)`);
}

console.log(`\nRedis commands: ${meter.commands} (read-only, ${meter.refused} refused) · SEC requests: ${meter.sec} at ≤ 8/s · nothing written`);
process.exit(meter.refused ? 1 : 0);
