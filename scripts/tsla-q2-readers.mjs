// COWORK #198, READ-ONLY: two readers disagree on TSLA's Q2 FY2026 (snapshot
// $0.68 / 35.0% vs dashboard $0.32 / 1.4%). Prints, for SYMBOLS (default TSLA):
//   A. companyfacts' own EPS / operating income / revenue facts since 2025,
//      with each fact's span (days), fy/fp, form and frame;
//   B. the stored set's newest quarters and years: span, label, the three
//      values and their derivation codes;
//   C. both readers on that set: the stock page's snapshot (view.snapshot +
//      view.margins.at(-1)) and the dashboard tab (recentPeriods + growth
//      visuals' opPct), exactly as each builds them;
// then D. a census over every stored set: where the two readers disagree on
// the same newest quarter, and where a stored QUARTER spans more than ~100
// days (a year-to-date value in a quarter slot).
// Store: GET / SCAN / MGET only. SEC: one companyfacts request per symbol.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["get", "scan", "mget"]);
const counts = {};
let secCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  } else if (/^https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts\/CIK\d{10}\.json$/.test(url)) {
    if (++secCalls > 3) throw new Error("read guard: SEC request cap");
  } else if (!url.startsWith("data:")) throw new Error("read guard: host refused");
  return realFetch(input, init);
};

const { buildSecEarningsView } = await import("../lib/server/secEarningsView.ts");
const { buildGrowthVisuals } = await import("../lib/growthVisuals.ts");
const { annualOnlyForm } = await import("../lib/server/annualOnly.ts");
const { registrantFor } = await import("../lib/server/stockProfile.ts");
const { valueOf, cell, periodLabel } = await import("../lib/server/secFactCodec.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");

const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; read-only reader check)";
const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const today = new Date().toISOString().slice(0, 10);
const days = (s, e) => (s && e ? Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1 : null);
const f2 = (v) => (typeof v === "number" ? (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : v.toFixed(4)) : "—");
const pct = (v) => (typeof v === "number" ? `${(v * (Math.abs(v) <= 1.5 ? 100 : 1)).toFixed(1)}%` : "—");

/** The two readers, each built as its own module builds it. */
function readers(symbol, set) {
  const annualForm = annualOnlyForm(registrantFor(symbol)?.annualForm, set, today);
  const view = buildSecEarningsView(set, { annualForm });
  if (!view) return null;
  const m = view.margins.at(-1) ?? null;
  const snap = { label: view.latestLabel, end: view.latestEnd, basis: view.basis, eps: view.snapshot.epsDiluted?.val ?? null, epsYoY: view.snapshot.epsYoY, opMargin: m?.operating ?? null, marginLabel: m?.label ?? null, yearAgo: view.snapshot.comparedWith };
  const series = buildGrowthVisuals(view, { oneOffs: view.oneOffs, unchecked: view.oneOffUnchecked }).quarters;
  const opOf = new Map((series?.periods ?? []).map((p) => [p.label, p]));
  const dash = view.recentPeriods.filter((p) => typeof p.epsDiluted.val === "number").slice(0, 8)
    .map((p) => ({ label: p.label, end: p.end, eps: p.epsDiluted.val, opPct: opOf.get(p.label)?.opPct ?? null }));
  return { view, snap, dash, margins: view.margins.slice(-6) };
}

const symbols = (process.env.SYMBOLS || "TSLA").split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase());
for (const symbol of symbols) {
  console.log(`\n================ ${symbol} ================`);
  // ── A. companyfacts ────────────────────────────────────────────────────
  const cik = cikMap[symbol] ? String(cikMap[symbol]).padStart(10, "0") : null;
  if (cik) {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
    const json = res.ok ? await res.json() : null;
    console.log(`A. companyfacts: HTTP ${res.status}`);
    for (const concept of ["EarningsPerShareDiluted", "OperatingIncomeLoss", "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "NetIncomeLoss"]) {
      const units = json?.facts?.["us-gaap"]?.[concept]?.units ?? {};
      for (const [unit, rows] of Object.entries(units)) {
        const recent = rows.filter((r) => r.end >= "2025-01-01").sort((a, b) => (a.end + a.filed).localeCompare(b.end + b.filed));
        if (!recent.length) continue;
        console.log(`  ${concept} [${unit}]`);
        for (const r of recent) console.log(`    ${r.start ?? "—"} → ${r.end} (${days(r.start, r.end) ?? "inst"}d)  ${f2(r.val)}  fy=${r.fy} fp=${r.fp} ${r.form} filed=${r.filed}${r.frame ? ` frame=${r.frame}` : ""}`);
      }
    }
  } else console.log("A. no CIK in data/cik-map.json");
  // ── B. stored set ──────────────────────────────────────────────────────
  const set = await redis.get(`${FACTS}:${symbol}`);
  if (!set) { console.log("B. no stored set"); continue; }
  console.log(`B. stored set: hash ${set.h === secFieldsHash() ? "current" : "STALE"} · ${set.quarters.length} quarters · ${set.years.length} years · yt ${set.yt ? `${set.yt.s}→${set.yt.e}` : "none"}`);
  const row = (p) => `${periodLabel(p).padEnd(11)} ${p.s} → ${p.e} (${days(p.s, p.e)}d)  rev ${f2(valueOf(p, "revenue"))}[${cell(p, "revenue").derived ?? "-"}]  opInc ${f2(valueOf(p, "operatingIncome"))}[${cell(p, "operatingIncome").derived ?? "-"}]  epsD ${f2(valueOf(p, "epsDiluted"))}[${cell(p, "epsDiluted").derived ?? "-"}]  NI ${f2(valueOf(p, "netIncome"))}  acc ${p.a ?? "—"} filed ${p.f ?? "—"}`;
  console.log("  quarters (stored order):"); for (const p of set.quarters.slice(0, 8)) console.log(`    ${row(p)}`);
  console.log("  years:"); for (const p of set.years.slice(0, 4)) console.log(`    ${row(p)}`);
  // ── C. the two readers ─────────────────────────────────────────────────
  const r = readers(symbol, set);
  if (!r) { console.log("C. no view"); continue; }
  console.log(`C1. stock-page snapshot: ${r.snap.label} (end ${r.snap.end}, basis ${r.snap.basis}) · EPS ${f2(r.snap.eps)} · YoY ${JSON.stringify(r.snap.epsYoY)} · op margin ${pct(r.snap.opMargin)} from margin row "${r.snap.marginLabel}" · vs ${r.snap.yearAgo}`);
  console.log(`    margin rows (oldest→newest): ${r.margins.map((x) => `${x.label} op ${pct(x.operating)}`).join(" · ")}`);
  console.log(`C2. dashboard tab: ${r.dash.map((d) => `${d.label} EPS ${f2(d.eps)} op ${d.opPct ?? "—"}%`).join(" · ")}`);
}

// ── D. census over every stored set ────────────────────────────────────────
console.log("\nD. census: every stored set");
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");
let built = 0, epsDiff = 0, opDiff = 0, longQ = 0, labelOff = 0;
const ex = { eps: [], op: [], long: [], label: [] };
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => {
    const set = raw[j];
    const sym = k.slice(FACTS.length + 1).toUpperCase();
    if (!set?.quarters || set.h !== secFieldsHash()) return;
    for (const q of set.quarters) if ((days(q.s, q.e) ?? 0) > 100) { longQ++; if (ex.long.length < 25) ex.long.push(`${sym} ${periodLabel(q)} ${q.s}→${q.e}`); break; }
    let r; try { r = readers(sym, set); } catch { return; }
    if (!r || r.snap.basis !== "quarter") return;
    built++;
    const d0 = r.dash.at(0);
    if (d0 && d0.label !== r.snap.label) { labelOff++; if (ex.label.length < 25) ex.label.push(`${sym} snap ${r.snap.label} / dash ${d0.label}`); }
    const same = r.dash.find((d) => d.label === r.snap.label);
    if (same && typeof r.snap.eps === "number" && Math.abs(same.eps - r.snap.eps) > 0.005) { epsDiff++; if (ex.eps.length < 25) ex.eps.push(`${sym} ${r.snap.label} ${f2(r.snap.eps)} vs ${f2(same.eps)}`); }
    const snapOp = typeof r.snap.opMargin === "number" ? r.snap.opMargin * (Math.abs(r.snap.opMargin) <= 1.5 ? 100 : 1) : null;
    if (same && snapOp !== null && same.opPct !== null && Math.abs(snapOp - same.opPct) > 1) { opDiff++; if (ex.op.length < 25) ex.op.push(`${sym} ${r.snap.label} ${snapOp.toFixed(1)}% vs ${same.opPct}%`); }
  });
}
console.log(`  stored sets ${keys.length} · quarter-basis views built ${built}`);
console.log(`  a stored QUARTER spanning > 100 days: ${longQ} sets${ex.long.length ? ` · ${ex.long.join(" | ")}` : ""}`);
console.log(`  snapshot period != dashboard newest period: ${labelOff}${ex.label.length ? ` · ${ex.label.join(" | ")}` : ""}`);
console.log(`  same period, EPS differs: ${epsDiff}${ex.eps.length ? ` · ${ex.eps.join(" | ")}` : ""}`);
console.log(`  same period, operating margin differs > 1 pt: ${opDiff}${ex.op.length ? ` · ${ex.op.join(" | ")}` : ""}`);
console.log(`\nStore commands: ${JSON.stringify(counts)} · SEC requests: ${secCalls} · No writes were performed.`);
