// EARNINGS AUDIT ROUND 1 — THE BROAD SCAN, main against this branch, over the
// SEC manifest (fix/earnings-audit-r1).
//
// Per filer in the manifest, companyfacts through main's shipped extraction and
// through this branch's, counting the classes of problem the audit found:
//
//   yoy60      a fiscal-year or quarter revenue YoY beyond ±60% while net
//              income's YoY for the same period is not beyond ±60% the same way
//   fyBelowQ   a fiscal year's revenue more than 5% below the sum of its four
//              quarters (all four on the same revenue concept as the year)
//   mixed      the revenue series uses more than one concept (years and
//              quarters together; computed cells excluded)
//   subLine    a period whose revenue is the contract line while `Revenues`
//              for the same frame is filed and more than 5% larger
//   bankLow    revenue more than 10% below InterestIncomeExpenseNet alone for
//              the same frame (banks, insurers, brokers)
//   bankJump   revenue YoY above +50% on a filer that tags net interest income
//   changed    any revenue cell that differs main -> branch (the fix's reach)
//   filled     a filer whose revenue was blank on every period and is not now
//
// And from the STORED report-date records (no companyfacts needed): every
// `pending` notice whose announcement date is before the quarter it names.
//
// CREDENTIALLED, READ-ONLY: the manifest GET and one MGET per 50 report-date
// records. No write verb is sent. Fetches companyfacts at 250ms spacing per
// shard; SYMBOLS="SHARD i/n" splits the manifest.
//   relay task: write-earnings-audit-r1-scan
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; earnings audit round 1 scan)";
const { NEW, OLD } = await loadMainAndBranch();
if (!OLD) { console.error("FATAL: main's source is needed for the before column"); process.exit(2); }

const MANIFEST_KEY = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
const DATES_PREFIX = (fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8").match(/SEC_REPORT_DATES_PREFIX = "([^"]+)"/) ?? [])[1];
if (!MANIFEST_KEY || !DATES_PREFIX) { console.error("FATAL: could not read the store keys from source"); process.exit(2); }

const redis = Redis.fromEnv();
const manifest = await redis.get(MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const all = Object.entries(manifest.symbols).filter(([, e]) => e?.cik).map(([s, e]) => [s, String(e.cik).padStart(10, "0")]).sort();
const m = String(process.env.SYMBOLS || "").match(/SHARD\s+(\d+)\s*\/\s*(\d+)/i);
const [shard, shards] = m ? [Number(m[1]), Number(m[2])] : [0, 1];
const targets = all.filter((_, i) => i % shards === shard);
console.log(`manifest symbols with a CIK: ${all.length}; this shard ${shard}/${shards}: ${targets.length}\n`);

// ── the pending notices, from the store ────────────────────────────────────
{
  let records = 0, pending = 0;
  const bad = [];
  for (let i = 0; i < targets.length; i += 50) {
    const batch = targets.slice(i, i + 50);
    const got = await redis.mget(...batch.map(([s]) => `${DATES_PREFIX}:${s}`));
    batch.forEach(([s], j) => {
      const rec = got[j];
      if (!rec) return;
      records++;
      if (!rec.pending) return;
      pending++;
      if (rec.pending.announcedOn < rec.pending.periodEnd) bad.push(`${s} (${rec.pending.periodEnd} announced ${rec.pending.announcedOn}, record at ${String(rec.at).slice(0, 10)})`);
    });
  }
  console.log(`PENDING: records ${records}, with a pending notice ${pending}, announced before the period end ${bad.length}`);
  for (const b of bad) console.log(`  pending-before-end ${b}`);
  console.log("");
}

// ── the STORED sets the audit named: what the page renders today, and the
// growth it computes with main's rate lookup and with this branch's ──────────
const FACTS_PREFIX = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
if (shard === 0 && FACTS_PREFIX) {
  const FOCUS = ["GIB", "CM", "KEY", "CRCL", "XEL"];
  const sets = await redis.mget(...FOCUS.map((s) => `${FACTS_PREFIX}:${s}`));
  FOCUS.forEach((sym, j) => {
    const set = sets[j];
    if (!set) { console.log(`STORED ${sym}: none`); return; }
    const ri = NEW.SEC_FIELD_KEYS.indexOf("revenue");
    console.log(`STORED ${sym}: at ${String(set.at).slice(0, 10)} cur ${set.cur ?? "USD"} q=${set.quarters.length} y=${set.years.length} c=${set.c ?? "-"}`);
    for (const p of set.years) {
      const prior = NEW.priorYearOf(set.years, p);
      const g = (M) => {
        const a = M.storedInReportingCurrency(p, set.fx)?.v[ri], b = prior ? M.storedInReportingCurrency(prior, set.fx)?.v[ri] : null;
        return a != null && b != null && b > 0 ? `${(((a - b) / b) * 100).toFixed(1)}%` : "—";
      };
      const home = NEW.storedInReportingCurrency(p, set.fx)?.v[ri];
      const rates = (set.fx?.applied ?? []).filter((x) => x.end === p.e).map((x) => `${x.basis[0]}${x.usdPerUnit.toFixed(4)}${x.start !== undefined ? `@${x.start}` : ""}`).join(",");
      console.log(`  ${p.e} FY${p.fy} USD ${p.v[ri] == null ? "—" : (p.v[ri] / 1e6).toFixed(1)}M home ${home == null ? "—" : (home / 1e6).toFixed(1)}M (${p.d?.[ri] ?? "?"}) a=${p.a ?? "-"} rates ${rates || "-"} YoY main ${g(OLD)} branch ${g(NEW)}`);
    }
  });
  console.log("");
}

const counts = {};
const examples = {};
const hit = (cls, side, sym, detail) => {
  const k = `${cls}|${side}`;
  counts[k] = (counts[k] ?? 0) + 1;
  (examples[k] ??= []).push(`${sym} ${detail}`);
};

function bankHalves(facts) {
  const rows = facts.facts?.["us-gaap"]?.InterestIncomeExpenseNet?.units?.USD ?? [];
  const byFrame = new Map();
  for (const r of rows) {
    if (!r.start) continue;
    const k = `${r.start}..${r.end}`;
    const prev = byFrame.get(k);
    if (!prev || String(r.filed) > String(prev.filed)) byFrame.set(k, r);
  }
  return byFrame;
}
function revenuesByFrame(facts) {
  const out = new Map();
  for (const r of facts.facts?.["us-gaap"]?.Revenues?.units?.USD ?? []) {
    if (!r.start) continue;
    const k = `${r.start}..${r.end}`;
    const prev = out.get(k);
    if (!prev || String(r.filed) > String(prev.filed)) out.set(k, r);
  }
  return out;
}

function judge(M, ex, sym, side, facts) {
  const ri = M.SEC_FIELD_KEYS.indexOf("revenue"), ni = M.SEC_FIELD_KEYS.indexOf("netIncome");
  const cell = (p, i) => p.values[i] ?? null;
  const nii = bankHalves(facts), rv = revenuesByFrame(facts);
  const tags = new Set();
  let flagged = { yoy60: null, fyBelowQ: null, subLine: null, bankLow: null, bankJump: null };
  for (const list of [ex.years, ex.quarters]) {
    const byEnd = new Map(list.map((p) => [p.end, p]));
    for (const p of list) {
      const r = cell(p, ri);
      if (r?.val == null) continue;
      if (r.tag && r.derived !== "computed") tags.add(r.tag);
      const k = `${p.start}..${p.end}`;
      // sub-line: contract line where Revenues for the frame is materially larger.
      const total = rv.get(k);
      if (r.tag === "RevenueFromContractWithCustomerExcludingAssessedTax" && total && total.val > r.val * 1.05 && !flagged.subLine) flagged.subLine = `${p.fp ?? ""}${p.fy ?? ""} ${(r.val / 1e6).toFixed(1)}M vs Revenues ${(total.val / 1e6).toFixed(1)}M`;
      const n = nii.get(k);
      if (n && n.val > 0 && r.val < 0.9 * n.val && !flagged.bankLow) flagged.bankLow = `${p.fp ?? ""}${p.fy ?? ""} rev ${(r.val / 1e6).toFixed(1)}M < NII ${(n.val / 1e6).toFixed(1)}M`;
      // the same period a year earlier, by end date ±10 days.
      const ago = [...byEnd.values()].find((q) => Math.abs(Date.parse(q.end) - (Date.parse(p.end) - 365.25 * 864e5)) < 10 * 864e5 && (q.start ? 1 : 0) === (p.start ? 1 : 0));
      const r0 = ago ? cell(ago, ri)?.val : null;
      if (r0 != null && r0 > 0) {
        const g = (r.val - r0) / r0;
        const n1 = cell(p, ni)?.val, n0 = ago ? cell(ago, ni)?.val : null;
        const ng = n1 != null && n0 != null && n0 > 0 ? (n1 - n0) / n0 : null;
        const matched = ng != null && Math.abs(ng) > 0.6 && Math.sign(ng) === Math.sign(g);
        if (Math.abs(g) > 0.6 && !matched && !flagged.yoy60) flagged.yoy60 = `${p.fp ?? ""}${p.fy ?? ""} rev ${(g * 100).toFixed(0)}% NI ${ng == null ? "n/a" : `${(ng * 100).toFixed(0)}%`}`;
        if (nii.size && g > 0.5 && !flagged.bankJump) flagged.bankJump = `${p.fp ?? ""}${p.fy ?? ""} rev +${(g * 100).toFixed(0)}%`;
      }
    }
  }
  for (const y of ex.years) {
    const r = cell(y, ri);
    if (r?.val == null) continue;
    const qs = ex.quarters.filter((q) => q.start >= y.start && q.end <= y.end);
    if (qs.length !== 4) continue;
    const vals = qs.map((q) => cell(q, ri));
    if (vals.some((v) => v?.val == null || v.tag !== r.tag)) continue;
    const sum = vals.reduce((a, v) => a + v.val, 0);
    if (r.val < sum * 0.95 && !flagged.fyBelowQ) flagged.fyBelowQ = `FY${y.fy} ${(r.val / 1e6).toFixed(1)}M vs quarters ${(sum / 1e6).toFixed(1)}M`;
  }
  for (const [cls, d] of Object.entries(flagged)) if (d) hit(cls, side, sym, d);
  if (tags.size > 1) hit("mixed", side, sym, [...tags].map((t) => t.replace(/^RevenueFromContractWithCustomer/, "RFCWC")).join("+"));
  return { tags };
}

let done = 0, failed = 0;
for (const [sym, cik] of targets) {
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) { failed++; await new Promise((r) => setTimeout(r, 250)); continue; }
    facts = await res.json();
  } catch { failed++; continue; }
  try {
    const a = OLD.extractCompanyFacts(sym, facts), b = NEW.extractCompanyFacts(sym, facts);
    judge(OLD, a, sym, "main", facts);
    judge(NEW, b, sym, "branch", facts);
    const ri = NEW.SEC_FIELD_KEYS.indexOf("revenue");
    const cells = (ex) => new Map([...ex.years, ...ex.quarters].map((p) => [`${p.start}..${p.end}`, p.values[ri]?.val ?? null]));
    const ca = cells(a), cb = cells(b);
    let changed = 0;
    for (const k of new Set([...ca.keys(), ...cb.keys()])) if ((ca.get(k) ?? null) !== (cb.get(k) ?? null)) changed++;
    if (changed) {
      const tagB = [...new Set([...b.years, ...b.quarters].map((p) => p.values[ri]?.tag).filter(Boolean))].join("+");
      const why = /RegulatedAndUnregulated/.test(tagB) ? "utility"
        : (b.notes ?? []).some((n) => /^revenue: (Revenues|the gap)/.test(n)) ? "total-over-contract" : "other";
      hit("changed", why, sym, `${changed} cell(s) -> ${tagB}`);
    }
    if ([...ca.values()].every((v) => v == null) && [...cb.values()].some((v) => v != null)) hit("filled", "branch", sym, [...new Set([...b.years].map((p) => p.values[ri]?.tag))].join("+"));
  } catch (e) {
    failed++;
    console.log(`  ${sym}: extraction failed: ${String(e?.message).slice(0, 160)}`);
  }
  done++;
  await new Promise((r) => setTimeout(r, 250));
}

console.log(`\nSCANNED ${done}, failed ${failed}`);
const classes = ["yoy60", "fyBelowQ", "mixed", "subLine", "bankLow", "bankJump"];
for (const c of classes) {
  console.log(`${c}: main ${counts[`${c}|main`] ?? 0} -> branch ${counts[`${c}|branch`] ?? 0}`);
  for (const side of ["main", "branch"]) {
    const ex = examples[`${c}|${side}`] ?? [];
    console.log(`  ${side}: ${ex.join("; ").slice(0, 3000)}`);
  }
}
for (const why of ["total-over-contract", "utility", "other"]) {
  const ex = examples[`changed|${why}`] ?? [];
  console.log(`changed (${why}): ${ex.length} filer(s)`);
  if (ex.length) console.log(`  ${ex.join("; ").slice(0, 4000)}`);
}
console.log(`filled (revenue blank everywhere on main): ${(examples["filled|branch"] ?? []).length}`);
if (examples["filled|branch"]) console.log(`  ${examples["filled|branch"].join("; ").slice(0, 2000)}`);
console.log("\nNo writes were performed.");
