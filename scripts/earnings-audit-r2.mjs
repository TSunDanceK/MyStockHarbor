// EARNINGS AUDIT ROUND 2 — banks below net interest income, fiscal years below
// the sum of their quarters, and the mixed-concept census
// (fix/earnings-audit-r2-banks).
//
// THE SHIPPED MODULES, IMPORTED — not lifted. Two trees: this checkout, and
// main checked out beside it as a git worktree, so "old" is what production
// runs and "new" is this branch. Both import the real .ts files through the
// repo's resolve hook (scripts/lib/register-ts-here.mjs), including the Pickers
// row builder, which a lift cannot reach.
//
// NO REDIS, BY CONSTRUCTION. It runs in the relay's credentialled job only
// because that job has node_modules; the Upstash variables are DELETED from the
// environment before the first import, so no client can authenticate. Every
// figure comes from SEC companyfacts.
//
// MODE (relay env / argv[2]):
//   banks   per filer: old/new revenue per fiscal year beside the SEC's own
//           total, the score, the Pickers revenue inputs, and the frames whose
//           `Revenues` is more than 2% off NII + noninterest income
//   raw     raw companyfacts rows for the hand spot-checks (no pipeline code)
//   fysum   the fiscal years more than 5% below the sum of their quarters,
//           cell by cell beside the raw SEC rows that produced them
//   mixed   the mixed-concept census (main only; investigation, no fix)
//
//   cells   every stored revenue cell that differs, main against this branch
//   relay tasks: write-earnings-audit-r2-banks / -raw / -fysum / -mixed / -cells
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MODE = process.env.MODE || process.argv[2] || "banks";
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; earnings audit round 2)";
const TODAY = new Date().toISOString().slice(0, 10);
const NOW = Date.now();
const ROOT = process.cwd();
const SYMBOLS = (process.env.SYMBOLS || process.argv[3] || "").split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

await import(pathToFileURL(path.join(ROOT, "scripts/lib/register-ts-here.mjs")).href);

// ── the two trees ───────────────────────────────────────────────────────────
const MAIN_TREE = path.join(ROOT, ".main-tree");
function ensureMainTree() {
  if (fs.existsSync(MAIN_TREE)) return;
  execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
  execSync(`git worktree add --detach ${MAIN_TREE} FETCH_HEAD`, { stdio: "ignore" });
  if (fs.existsSync(path.join(ROOT, "node_modules"))) fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(MAIN_TREE, "node_modules"));
}
async function load(tree) {
  const imp = (f) => import(pathToFileURL(path.join(tree, f)).href);
  const [X, B, V, S, P, G, Val, F, C] = await Promise.all([
    imp("lib/server/secExtract.ts"), imp("lib/server/secFactBuild.ts"), imp("lib/server/secEarningsView.ts"),
    imp("lib/server/secEarningsScore.ts"), imp("lib/server/pickersSecFundamentals.ts"),
    imp("lib/server/pickersSecEarningsGrowth.ts"), imp("lib/server/secValuation.ts"),
    imp("lib/server/secFields.ts"), imp("lib/server/secFactCodec.ts"),
  ]);
  return { X, B, V, S, P, G, Val, F, C };
}

const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const cikOf = (s) => (cikMap[s] ? String(cikMap[s]).padStart(10, "0") : null);
async function factsFor(sym) {
  const cik = cikOf(sym);
  if (!cik) return { err: "no CIK in data/cik-map.json" };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return { facts: await res.json(), cik };
      if (res.status === 404) return { err: "HTTP 404" };
    } catch { /* retry once */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { err: "fetch failed twice" };
}
const pause = () => new Promise((r) => setTimeout(r, 200));
const M = (v) => (v == null || !Number.isFinite(v) ? "—" : `${(v / 1e6).toFixed(1)}`);
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

/** The newest-filed row per frame for one concept, USD durations. */
function frames(facts, tag) {
  const out = new Map();
  for (const r of facts.facts?.["us-gaap"]?.[tag]?.units?.USD ?? []) {
    if (!r.start) continue;
    const k = `${r.start}..${r.end}`;
    const prev = out.get(k);
    if (!prev || String(r.filed) > String(prev.filed)) out.set(k, r);
  }
  return out;
}

// The period the r1 scan flagged per filer (main), for the one-row table.
const FLAGGED = Object.fromEntries(`AX:FY2026 BKU:FY2025 CUBI:FY2020 DCOM:FY2025 EFC:FY2022 FITB-PM:FY2023 GBCI:FY2025
HBAN:FY2025 LFWD:FY2023 PFS:FY2025 PVLA:Q1 2024 SMR:Q1 2024 SYBT:FY2020 TBBK:FY2025 TCBK:FY2025 TNGX:Q1 2026
UVSP:FY2021 BFST:FY2025 BPOP:Q1 2026 IMNM:FY2025 ONB:FY2021 SFNC:FY2025 SOFI:FY2025 WTFC:FY2025 ASTS:FY2023
BOH:FY2025 BRTX:FY2024 CFFN:FY2025 COLB:FY2025 MCHB:FY2025 MTB:FY2025 NBHC:FY2025 NBTB:FY2025 PLSE:FY2020
QUBT:FY2025 WAFD:FY2025 ZION:FY2025 BBT:FY2025 BFH:FY2020 CATY:FY2025 CBSH:Q1 2026 CHCO:FY2025 EBC:FY2025
EQBK:FY2023 FBNC:FY2025 FITB:FY2023 FLG:FY2022 FULT:FY2025 MCB:FY2025 OFG:FY2023 PEBO:FY2025 RF:FY2021
SLS:FY2023 UBSI:FY2022 WAL:FY2025`.split(/\s(?=[A-Z-]+:)/).map((x) => x.trim().split(":")));

// ── banks ───────────────────────────────────────────────────────────────────
async function banks() {
  ensureMainTree();
  const OLD = await load(MAIN_TREE), NEW = await load(ROOT);
  const ri = NEW.F.SEC_FIELD_KEYS.indexOf("revenue");
  const off2 = [];
  const belowList = [];
  const gap5 = [];
  console.log("BANKS ticker | FY end | old rev (code) | new rev (code) | SEC value [concept] | match | NII | NonII | score old→new");
  for (const sym of SYMBOLS) {
    const got = await factsFor(sym);
    if (!got.facts) { console.log(`${sym} | — | ${got.err}`); continue; }
    const f = got.facts;
    const rv = frames(f, "Revenues"), rn = frames(f, "RevenuesNetOfInterestExpense");
    const nii = frames(f, "InterestIncomeExpenseNet"), non = frames(f, "NoninterestIncome");
    // THE SEC COLUMN: RevenuesNetOfInterestExpense if filed; else `Revenues`
    // when within 2% of the halves (or no halves to judge it); else the halves'
    // sum, basis labelled. Never "unverifiable" while either half is filed.
    const secOf = (k) => {
      const h = nii.get(k) && non.get(k) ? nii.get(k).val + non.get(k).val : null;
      if (rn.get(k)) return [rn.get(k).val, "RevenuesNetOfInterestExpense", rn.get(k).accn];
      if (rv.get(k) && (h == null || Math.abs(rv.get(k).val - h) <= 0.02 * Math.abs(h))) return [rv.get(k).val, "Revenues", rv.get(k).accn];
      if (h != null) return [h, "InterestIncomeExpenseNet+NoninterestIncome (sum of filed halves)", nii.get(k).accn];
      if (rv.get(k)) return [rv.get(k).val, "Revenues (no halves to judge)", rv.get(k).accn];
      if (nii.get(k)) return [nii.get(k).val, "InterestIncomeExpenseNet only (NonII not filed)", nii.get(k).accn];
      return [null, "none of RNOIE / Revenues / NII filed", ""];
    };
    const side = async (T) => {
      const ex = T.X.extractCompanyFacts(sym, f);
      const set = await T.B.toStoredSet(ex);
      const view = T.V.buildSecEarningsView(set);
      const score = T.S.scoreFromSec(view, sym, { status: "ready", set, cold: false });
      let pick = null;
      try {
        const row = T.P.buildSecPickerRow(set, TODAY, {}, NOW);
        const fig = T.P.applySecPickerRow(JSON.parse(JSON.stringify(row)), 50);
        const growth = T.G.secGrowthFacts(set, TODAY, {}, []);
        const g = growth?.ok ? ((growth.revenue - growth.revenuePrior) / Math.abs(growth.revenuePrior)) * 100 : (growth?.why ?? growth?.reason ?? "refused");
        pick = { ps: fig?.psRatio ?? null, rev: fig?.revenue ?? null, revYoY: g, mi: T.Val.multipleInputs(set) };
      } catch (e) { pick = { err: String(e?.message).slice(0, 120) }; }
      return { ex, set, score, pick, notes: ex.notes ?? [] };
    };
    let o, n;
    try { o = await side(OLD); n = await side(NEW); }
    catch (e) { console.log(`${sym} | FAILED ${String(e?.message).slice(0, 200)}`); continue; }
    const byE = (set) => new Map([...set.years, ...set.quarters].map((p) => [`${p.s}..${p.e}`, p]));
    const ob = byE(o.set), nb = byE(n.set);
    const keys = [...new Set([...ob.keys(), ...nb.keys()])].sort((a, b) => a.split("..")[1].localeCompare(b.split("..")[1]));
    // every frame: the series must not sit below its own NII, and must not step.
    let belowOld = 0, belowNew = 0, changed = 0;
    for (const k of keys) {
      const a = ob.get(k)?.v[ri] ?? null, b = nb.get(k)?.v[ri] ?? null;
      const ni = nii.get(k)?.val ?? null;
      const nn = non.get(k)?.val ?? null;
      // BELOW NII ONLY COUNTS where noninterest income is not itself negative
      // (a securities loss makes net revenue below NII, truthfully).
      if (ni != null && ni > 0 && !(nn != null && nn < 0)) { if (a != null && a < ni) belowOld++; if (b != null && b < ni) { belowNew++; belowList.push(`${sym} ${k} new ${M(b)} < NII ${M(ni)} (NonII ${M(nn)})`); } }
      if (a !== b) changed++;
      const r = rv.get(k), x = ni != null && non.get(k) ? ni + non.get(k).val : null;
      if (r && x && Math.abs(r.val - x) > 0.02 * Math.abs(x)) off2.push(`${sym} ${k} Revenues ${M(r.val)} vs NII+NonII ${M(x)} (${pct(((r.val - x) / x) * 100)}) accn ${r.accn}`);
    }
    for (const y of n.set.years.slice(0, 6)) {
      const k = `${y.s}..${y.e}`;
      const op = ob.get(k), np = nb.get(k);
      const sec = secOf(k);
      const newV = np?.v[ri] ?? null;
      const match = sec[0] != null && newV != null ? (Math.abs(newV - sec[0]) <= 0.02 * Math.abs(sec[0]) ? "Y" : "N") : "—";
      console.log(`${sym} | ${y.e} | ${M(op?.v[ri])} (${op?.d?.[ri] ?? "-"}) | ${M(newV)} (${np?.d?.[ri] ?? "-"}) | ${M(sec[0])} [${sec[1]}] | ${match} | ${M(nii.get(k)?.val)} | ${M(non.get(k)?.val)} | ${o.score.score}→${n.score.score}`);
    }
    // THE r1-FLAGGED PERIOD, one row: "FY2025" or "Q1 2026".
    const flag = FLAGGED[sym];
    if (flag) {
      const [fp, fy] = flag.startsWith("FY") ? ["FY", +flag.slice(2)] : [flag.slice(0, 2), +flag.slice(3)];
      const list = fp === "FY" ? [...n.set.years, ...o.set.years] : [...n.set.quarters, ...o.set.quarters];
      const hit = list.find((p) => p.fy === fy && (fp === "FY" || p.fp === fp));
      if (!hit) console.log(`FLAGGED | ${sym} | ${flag} | period not in either set`);
      else {
        const k = `${hit.s}..${hit.e}`;
        const op = ob.get(k), np = nb.get(k), sec = secOf(k);
        const newV = np?.v[ri] ?? null;
        const match = sec[0] != null && newV != null ? (Math.abs(newV - sec[0]) <= 0.02 * Math.abs(sec[0]) ? "Y" : "N") : "—";
        console.log(`FLAGGED | ${sym} | ${flag} ${k} | ${M(op?.v[ri])} (${op?.d?.[ri] ?? "-"}) | ${M(newV)} (${np?.d?.[ri] ?? "-"}) | ${M(sec[0])} | ${sec[1]} | accn ${sec[2]} | ${match} | filed Revenues ${M(rv.get(k)?.val)} | NII ${M(nii.get(k)?.val)} | NonII ${M(non.get(k)?.val)} | ${o.score.score}→${n.score.score}`);
      }
    }
    // WHICH PERIODS TRIGGERED THE RULE: main's extraction (every period, not
    // only the stored window), revenue more than 2% off NII + NonII.
    {
      const offs = [];
      for (const p of [...o.ex.years, ...o.ex.quarters]) {
        const c = p.values?.[ri], k = `${p.start}..${p.end}`;
        const x = nii.get(k) && non.get(k) ? nii.get(k).val + non.get(k).val : null;
        if (c?.val != null && x != null && x > 0 && Math.abs(c.val - x) > 0.02 * Math.abs(x)) offs.push(`${k} ${M(c.val)} [${c.tag ?? c.derived}] vs ${M(x)}`);
      }
      if (offs.length) console.log(`  ${sym} trigger periods (${offs.length}): ${offs.slice(0, 12).join("; ")}`);
    }
    // A FEW CHANGED FRAMES (controls): name them.
    if (changed > 0 && changed <= 4) for (const k of keys) {
      const a = ob.get(k)?.v[ri] ?? null, b = nb.get(k)?.v[ri] ?? null;
      if (a !== b) console.log(`  ${sym} changed ${k}: ${M(a)} (${ob.get(k)?.d?.[ri] ?? "-"}) → ${M(b)} (${nb.get(k)?.d?.[ri] ?? "-"})`);
    }
    // ABOVE NII BUT MORE THAN 5% BELOW NII + NONII (report only).
    for (const k of keys) {
      const b = nb.get(k)?.v[ri] ?? null, ni = nii.get(k)?.val ?? null, nn = non.get(k)?.val ?? null;
      if (b != null && ni != null && nn != null && nn >= 0 && b >= ni && b < 0.95 * (ni + nn)) gap5.push(`${sym} ${k} new ${M(b)} vs NII ${M(ni)} + NonII ${M(nn)} = ${M(ni + nn)} (${pct(((b - ni - nn) / (ni + nn)) * 100)}) code ${nb.get(k)?.d?.[ri] ?? "-"} tag ${nb.get(k)?.t?.[ri] ?? ""}`);
    }
    const pk = (p) => (p?.err ? `ERR ${p.err}` : `ttmRev ${M(p?.mi?.revenue?.val ?? null)} pickersRev ${M(p?.rev)} incomplete=${p?.mi?.revenueIncomplete ?? "?"} P/S@$50=${typeof p?.ps === "number" ? p.ps.toFixed(2) : JSON.stringify(p?.ps ?? null)} revGrowth=${typeof p?.revYoY === "number" ? p.revYoY.toFixed(1) + "%" : JSON.stringify(p?.revYoY ?? null)}`);
    console.log(`  ${sym} summary: frames ${keys.length}, changed ${changed}, below NII old ${belowOld} → new ${belowNew}; pickers old {${pk(o.pick)}} new {${pk(n.pick)}}`);
    for (const note of n.notes) if (/bank|net interest|NoninterestIncome/i.test(note)) console.log(`  ${sym} note: ${note.slice(0, 220)}`);
    await pause();
  }
  console.log(`\nSTILL BELOW NII WITH NON-NEGATIVE NONINTEREST INCOME (${belowList.length} frames)`);
  for (const l of belowList) console.log(`  ${l}`);
  console.log(`\nREVENUES MORE THAN 2% OFF NII + NONINTEREST INCOME (${off2.length} frames)`);
  for (const l of off2) console.log(`  ${l}`);
  console.log(`\nABOVE NII BUT MORE THAN 5% BELOW NII + NONINTEREST INCOME (${gap5.length} frames)`);
  for (const l of gap5) console.log(`  ${l}`);
}

// ── raw (hand spot-checks) ──────────────────────────────────────────────────
async function raw() {
  const tags = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenuesNetOfInterestExpense", "InterestIncomeExpenseNet", "NoninterestIncome"];
  const end = process.env.END || "2025-12-31";
  for (const sym of SYMBOLS) {
    const got = await factsFor(sym);
    if (!got.facts) { console.log(`${sym}: ${got.err}`); continue; }
    console.log(`\n${sym} (CIK ${got.cik}) — every us-gaap USD row ending ${end}, about a year long`);
    for (const t of tags) {
      for (const r of got.facts.facts?.["us-gaap"]?.[t]?.units?.USD ?? []) {
        if (r.end !== end || !r.start) continue;
        const d = (Date.parse(r.end) - Date.parse(r.start)) / 864e5;
        if (d < 350 || d > 380) continue;
        console.log(`  ${t.padEnd(52)} ${r.start}..${r.end} val ${r.val} form ${r.form} fy ${r.fy}${r.fp} filed ${r.filed} accn ${r.accn}${r.frame ? ` frame ${r.frame}` : ""}`);
      }
    }
    await pause();
  }
}

// ── fysum ───────────────────────────────────────────────────────────────────
async function fysum() {
  ensureMainTree();
  const OLD = await load(MAIN_TREE), NEW = await load(ROOT);
  const ri = NEW.F.SEC_FIELD_KEYS.indexOf("revenue");
  for (const sym of SYMBOLS) {
    const got = await factsFor(sym);
    if (!got.facts) { console.log(`\n${sym}: ${got.err}`); continue; }
    const f = got.facts;
    const o = OLD.X.extractCompanyFacts(sym, f), n = NEW.X.extractCompanyFacts(sym, f);
    console.log(`\n===== ${sym}`);
    for (const y of o.years) {
      const yc = y.values[ri];
      if (yc?.val == null) continue;
      const qs = o.quarters.filter((q) => q.start >= y.start && q.end <= y.end);
      if (qs.length !== 4) continue;
      const cells = qs.map((q) => q.values[ri]);
      const sum = cells.reduce((a, c) => a + (c?.val ?? 0), 0);
      if (!(yc.val < sum * 0.95)) continue;
      const ny = n.years.find((p) => p.end === y.end)?.values[ri];
      console.log(`  FY ${y.start}..${y.end} (${y.fp}${y.fy}) old ${M(yc.val)} [${yc.tag} ${yc.derived}] new ${M(ny?.val)} | quarter sum old ${M(sum)} | accn ${y.accession} filed ${y.filed}`);
      for (const q of qs) {
        const c = q.values[ri], nq = n.quarters.find((p) => p.end === q.end)?.values[ri];
        console.log(`    ${q.fp}${q.fy} ${q.start}..${q.end} old ${M(c?.val)} [${c?.tag} ${c?.derived}${c?.from ? ` from ${c.from.join("→")}` : ""}] new ${M(nq?.val)} | accn ${q.accession}`);
      }
      // THE RAW ROWS of the concepts in play, every duration inside the year.
      const tags = [...new Set([yc.tag, ...cells.map((c) => c?.tag)].filter(Boolean))];
      for (const t of new Set([...tags, "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"])) {
        const rows = (f.facts?.["us-gaap"]?.[t]?.units?.USD ?? []).filter((r) => r.start && r.start >= y.start && r.end <= y.end);
        if (!rows.length) continue;
        console.log(`    raw ${t}:`);
        const seen = new Set();
        for (const r of rows.sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start) || String(a.filed).localeCompare(String(b.filed)))) {
          const k = `${r.start}|${r.end}|${r.val}|${r.accn}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const days = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 864e5);
          console.log(`      ${r.start}..${r.end} (${days}d) ${M(r.val)} ${r.form} ${r.fy}${r.fp} filed ${r.filed} accn ${r.accn}`);
        }
      }
    }
    for (const note of o.notes ?? []) if (/revenue/.test(note) && !/below (operating|pre-tax)/.test(note)) console.log(`  note: ${note.slice(0, 220)}`);
    await pause();
  }
}

// ── mixed (investigation only) ──────────────────────────────────────────────
async function mixed() {
  ensureMainTree();
  const T = await load(MAIN_TREE);
  const ri = T.F.SEC_FIELD_KEYS.indexOf("revenue");
  const classes = {};
  const lines = [];
  let boundary60 = 0, boundaryAny = 0;
  for (const sym of SYMBOLS) {
    const got = await factsFor(sym);
    if (!got.facts) { lines.push(`${sym} | fetch: ${got.err}`); continue; }
    const f = got.facts;
    let ex;
    try { ex = T.X.extractCompanyFacts(sym, f); } catch (e) { lines.push(`${sym} | extract failed ${e.message}`); continue; }
    const periods = [...ex.years.map((p) => ({ ...p, kind: "Y" })), ...ex.quarters.map((p) => ({ ...p, kind: "Q" }))]
      .filter((p) => p.values[ri]?.val != null && p.values[ri].derived !== "computed")
      .sort((a, b) => a.end.localeCompare(b.end));
    const tags = [...new Set(periods.map((p) => p.values[ri].tag))];
    if (tags.length < 2) { lines.push(`${sym} | not mixed on main now (${tags.join("+") || "none"})`); (classes["not mixed now"] ??= []).push(sym); continue; }
    const range = (t) => { const ps = periods.filter((p) => p.values[ri].tag === t); return `${ps[0].end}..${ps.at(-1).end} (${ps.length}; Y${ps.filter((p) => p.kind === "Y").length}/Q${ps.filter((p) => p.kind === "Q").length})`; };
    // the same frame filed under the other concept?
    const byTag = Object.fromEntries(tags.map((t) => [t, frames(f, t)]));
    let bothFiled = 0, diverge = 0;
    for (const p of periods) {
      const k = `${p.start}..${p.end}`, mine = p.values[ri];
      for (const t of tags) {
        if (t === mine.tag) continue;
        const o = byTag[t].get(k);
        if (!o) continue;
        bothFiled++;
        if (Math.abs(o.val - mine.val) > 0.05 * Math.abs(mine.val)) diverge++;
      }
    }
    // the switch pattern: chronological blocks per duration, or interleaved
    const switches = (kind) => { const s = periods.filter((p) => p.kind === kind).map((p) => p.values[ri].tag); let n = 0; for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) n++; return n; };
    const yTags = new Set(periods.filter((p) => p.kind === "Y").map((p) => p.values[ri].tag));
    const qTags = new Set(periods.filter((p) => p.kind === "Q").map((p) => p.values[ri].tag));
    const splitByDuration = yTags.size === 1 && qTags.size === 1 && [...yTags][0] !== [...qTags][0];
    const excise = T.X.filerTagsExcise(f);
    const cls = splitByDuration ? (diverge ? "annual vs quarterly concept, values differ" : "annual vs quarterly concept, values agree")
      : diverge ? (excise ? "excise-tagged filer, total vs line" : "total vs sub-line")
      : switches("Y") + switches("Q") <= 2 ? "concept migration (values agree or not both filed)"
      : "other (interleaved)";
    (classes[cls] ??= []).push(sym);
    // YoY across a boundary: the page's (two concepts) vs one concept where both frames exist
    const bounds = [];
    for (const p of periods) {
      const ago = periods.find((q) => q.kind === p.kind && Math.abs(Date.parse(q.end) - (Date.parse(p.end) - 365.25 * 864e5)) < 10 * 864e5);
      if (!ago) continue;
      const a = p.values[ri], b = ago.values[ri];
      if (a.tag === b.tag || !(b.val > 0)) continue;
      const page = ((a.val - b.val) / b.val) * 100;
      const alt = byTag[a.tag].get(`${ago.start}..${ago.end}`) ?? null; // prior year on the newer concept
      const same = alt && alt.val > 0 ? ((a.val - alt.val) / alt.val) * 100 : null;
      bounds.push({ at: `${p.kind}${p.end}`, from: b.tag, to: a.tag, page, same });
    }
    if (bounds.length) boundaryAny++;
    if (bounds.some((x) => Math.abs(x.page) > 60 && (x.same == null || Math.abs(x.same) <= 60))) boundary60++;
    const short = (t) => t.replace("RevenueFromContractWithCustomer", "RFCWC");
    lines.push(`${sym} | ${cls} | ${tags.map((t) => `${short(t)} ${range(t)}`).join(" ; ")} | both-filed ${bothFiled} diverge>5% ${diverge} | excise ${excise} | boundary YoY ${bounds.slice(0, 3).map((x) => `${x.at} ${short(x.from)}→${short(x.to)} page ${pct(x.page)} one-concept ${pct(x.same)}`).join(" ; ") || "none"}`);
    await pause();
  }
  console.log("MIXED (main as it stands)");
  for (const l of lines) console.log(l);
  console.log("\nCLASSES");
  for (const [c, s] of Object.entries(classes)) console.log(`  ${c}: ${s.length} — ${s.join(" ")}`);
  console.log(`\nfilers with a YoY across a concept boundary: ${boundaryAny}; of them beyond ±60% only because of it: ${boundary60}`);
}

// ── cells: every stored revenue cell that differs, main against this branch ──
async function cells() {
  ensureMainTree();
  const OLD = await load(MAIN_TREE), NEW = await load(ROOT);
  const ri = NEW.F.SEC_FIELD_KEYS.indexOf("revenue");
  for (const sym of SYMBOLS) {
    const got = await factsFor(sym);
    if (!got.facts) { console.log(`${sym}: ${got.err}`); continue; }
    const side = async (T) => T.B.toStoredSet(T.X.extractCompanyFacts(sym, got.facts));
    const o = await side(OLD), n = await side(NEW);
    const byE = (set) => new Map([...set.years, ...set.quarters].map((p) => [`${p.s}..${p.e}`, p]));
    const ob = byE(o), nb = byE(n);
    const keys = [...new Set([...ob.keys(), ...nb.keys()])].sort((a, b) => a.split("..")[1].localeCompare(b.split("..")[1]));
    const diff = keys.filter((k) => (ob.get(k)?.v[ri] ?? null) !== (nb.get(k)?.v[ri] ?? null));
    console.log(`\n===== ${sym}: ${diff.length} of ${keys.length} stored cells differ`);
    const f = got.facts;
    const filed = Object.fromEntries(["RevenuesNetOfInterestExpense", "Revenues", "InterestIncomeExpenseNet", "NoninterestIncome"].map((t) => [t, frames(f, t)]));
    // The extraction's own cell (tag, derivation) and, for a quarter, the
    // 3-month rows ending on its date: a stored quarter's start can be the
    // prior quarter's end, which no raw row carries.
    const ox = OLD.X.extractCompanyFacts(sym, f), nx = NEW.X.extractCompanyFacts(sym, f);
    const meta = (x, k) => {
      const [, e] = k.split("..");
      const want = Date.parse(e) - Date.parse(k.slice(0, 10));
      const p = [...x.years, ...x.quarters].find((q) => q.end === e && Math.abs(Date.parse(q.end) - Date.parse(q.start) - want) < 10 * 864e5);
      const c = p?.values[ri];
      return c ? `${c.tag ?? "?"}/${c.derived ?? "filed"}${c.from ? ` from ${c.from.join("→")}` : ""}` : "-";
    };
    const near = (t, k) => {
      const [st, e] = k.split("..");
      const want = Date.parse(e) - Date.parse(st);
      return [...filed[t].values()].find((r) => r.end === e && Math.abs(Date.parse(r.end) - Date.parse(r.start) - want) < 10 * 864e5) ?? null;
    };
    for (const k of diff) {
      const a = ob.get(k), b = nb.get(k);
      const at = (t) => M((filed[t].get(k) ?? near(t, k))?.val ?? null);
      const nii = (filed.InterestIncomeExpenseNet.get(k) ?? near("InterestIncomeExpenseNet", k))?.val, non = (filed.NoninterestIncome.get(k) ?? near("NoninterestIncome", k))?.val;
      const halves = nii != null && non != null ? nii + non : null;
      console.log(`  ${k} ${(b ?? a).fp ?? ""}${(b ?? a).fy ?? ""} ${M(a?.v[ri] ?? null)} (${a?.d?.[ri] ?? "-"}) → ${M(b?.v[ri] ?? null)} (${b?.d?.[ri] ?? "-"})`
        + ` | filed RNOIE ${at("RevenuesNetOfInterestExpense")} Revenues ${at("Revenues")} NII ${at("InterestIncomeExpenseNet")} NonII ${at("NoninterestIncome")} halves ${M(halves)} | main ${meta(ox, k)} branch ${meta(nx, k)}`);
    }
    await pause();
  }
}

const run = { banks, raw, fysum, mixed, cells }[MODE];
if (!run) { console.error(`FATAL: unknown MODE ${MODE}`); process.exit(2); }
await run();
try { if (fs.existsSync(MAIN_TREE)) execSync(`git worktree remove --force ${MAIN_TREE}`, { stdio: "ignore" }); } catch { /* the runner is discarded */ }
console.log("\nNo Redis client could authenticate (credentials deleted at start); no writes were performed.");
