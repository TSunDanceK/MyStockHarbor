// AUDIT ROUND 6, READ FROM THE STORE (reads only).
//   SYMBOLS="cells:NEE,SO|netIncome,epsDiluted"  the named fields per stored period,
//     with derivation codes, ff/lg, chains stamp and manifest verifiedAt; a stored
//     Q4 also prints secValuation.derivedQ4Eps and the operands it used.
//   SYMBOLS="gaps"  every populated stored set whose two newest quarters are more
//     than a quarter apart, with its ff/lg (the NEE shape).
//   SYMBOLS="rows:ALL|NetIncomeLoss|2024-01-01|2025-12-31"  raw companyfacts duration rows in a window.
//   relay task: write-r6-stored-probe   Redis cost: 1 GET + 1 MGET per 25 symbols.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const C = await import("../lib/server/secFactCodec.ts");
const V = await import("../lib/server/secValuation.ts");
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const MANIFEST = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const [mode, rest = ""] = String(process.env.SYMBOLS || "gaps").split(":");
const manifest = await redis.get(MANIFEST);
const ref = (f) => (f ? `${f.form ?? "?"} ${f.accn ?? "?"} period ${f.reportDate ?? "?"} filed ${f.filed ?? "?"}` : "-");
const day = 864e5;
const label = (p) => `${p.fp ?? "?"}${p.fy ?? ""}`;

if (mode === "rows") {
  // SYMBOLS="rows:ALL|NetIncomeLoss,ProfitLoss|2024-01-01|2025-12-31": every duration row of
  // the named concepts ending in the window, straight from companyfacts (SEC only).
  const [sym, conceptArg, from, to] = rest.split("|");
  const cik = manifest?.symbols?.[sym]?.cik;
  const facts = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`,
    { headers: { "User-Agent": "MyStockHarbor/1.0 (+https://www.mystockharbor.com; audit r6 rows)" } })).json();
  for (const k of conceptArg.split(",")) {
    const ns = Object.keys(facts.facts ?? {}).find((n) => facts.facts[n][k]);
    if (!ns) { console.log(`\n${k}: not filed`); continue; }
    console.log(`\n${ns}:${k}`);
    const seen = new Set();
    for (const [u, rows] of Object.entries(facts.facts[ns][k].units)) {
      for (const r of rows.filter((r) => r.end >= from && r.end <= to).sort((a, b) => a.end.localeCompare(b.end) || String(a.start).localeCompare(String(b.start)) || a.filed.localeCompare(b.filed))) {
        const key = `${r.start}|${r.end}|${r.val}|${r.accn}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const days = r.start ? Math.round((Date.parse(r.end) - Date.parse(r.start)) / day) + 1 : 0;
        console.log(`  [${u}] ${r.start ?? "-"}..${r.end} (${days}d) ${r.val} ${r.form} ${r.accn} fp=${r.fp}${r.fy} filed ${r.filed}${r.frame ? ` ${r.frame}` : ""}`);
      }
    }
  }
} else if (mode === "stamps") {
  // SYMBOLS="stamps:UPS,CME": chains stamp, manifest verifiedAt and the set's newest period only.
  const syms = rest.split(",").filter(Boolean);
  const sets = await redis.mget(...syms.map((s) => `${FACTS}:${s}`));
  syms.forEach((s, i) => {
    const set = sets[i], e = manifest?.symbols?.[s] ?? {};
    console.log(`  ${s.padEnd(6)} c=${set?.c ?? "-"} verified ${e.verifiedAt ? new Date(e.verifiedAt).toISOString().slice(0, 16) : "never"}`
      + ` needsReverify=${Boolean(e.needsReverify)} reason=${e.reverifyReason ?? "-"} cover=${set?.cover?.val ?? "-"}${set?.cover?.derived ? ` (${set.cover.derived})` : ""} asOf ${set?.cover?.asOf ?? "-"}`);
  });
} else if (mode === "cells") {
  const [symArg, fieldArg = "netIncome,epsDiluted,sharesDiluted"] = rest.split("|");
  const syms = symArg.split(",").filter(Boolean);
  const fields = fieldArg.split(",").filter(Boolean);
  const sets = await redis.mget(...syms.map((s) => `${FACTS}:${s}`));
  syms.forEach((s, i) => {
    const set = sets[i], e = manifest?.symbols?.[s] ?? {};
    console.log(`\n=== ${s} c=${set?.c ?? "-"} verified ${e.verifiedAt ? new Date(e.verifiedAt).toISOString().slice(0, 16) : "never"} needsReverify=${Boolean(e.needsReverify)}`);
    if (!set) { console.log("  no stored set"); return; }
    console.log(`  ff: ${ref(set.ff)}\n  lg: ${ref(set.lg)}`);
    for (const [kind, list, n] of [["Y", set.years, 3], ["Q", set.quarters, 14]]) {
      for (const p of list.slice(0, n)) {
        const cells = fields.map((k) => { const c = C.cell(p, k); return `${k}=${c.val ?? "—"}${c.val != null && c.derived ? `(${c.derived})` : ""}`; });
        let extra = "";
        if (kind === "Q" && p.fp === "Q4" && fields.includes("epsDiluted")) {
          const year = set.years.find((y) => y.fy === p.fy && y.e === p.e);
          const qs = ["Q1", "Q2", "Q3"].map((fp) => set.quarters.find((q) => q.fy === p.fy && q.fp === fp));
          extra = ` | derivedQ4Eps=${V.derivedQ4Eps(set, p)} from FY ${C.valueOf(year, "epsDiluted")} − [${qs.map((q) => C.valueOf(q, "epsDiluted")).join(", ")}]`
            + ` shares FY ${C.valueOf(year, "sharesDiluted")} Q1-3 [${qs.map((q) => C.valueOf(q, "sharesDiluted")).join(", ")}]`;
        }
        console.log(`  ${kind} ${label(p).padEnd(8)} ${p.s ?? "?"}..${p.e} ${p.a ?? "-"} filed ${p.f ?? "-"} | ${cells.join(" ")}${extra}`);
      }
    }
  });
} else {
  const syms = Object.entries(manifest?.symbols ?? {}).filter(([, e]) => e.cik && e.contentHash !== null).map(([s]) => s).sort();
  let read = 0;
  const hits = [], holes = [];
  for (let i = 0; i < syms.length; i += 25) {
    const chunk = syms.slice(i, i + 25);
    const vals = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
    chunk.forEach((s, j) => {
      const v = vals[j];
      if (!v?.quarters?.length) return;
      read++;
      const [a, b] = v.quarters;
      const gap = b ? (Date.parse(a.e) - Date.parse(b.e)) / day : null;
      if (gap !== null && gap > 120) hits.push(`  ${s.padEnd(7)} newest ${label(a)} ${a.e} (filed ${a.f ?? "-"}), next ${label(b)} ${b.e}, gap ${Math.round(gap)}d | ff ${ref(v.ff)} | lg ${ref(v.lg)}`);
      // AN EMPTY ROW BETWEEN TWO FILLED ONES (NEE): among the newest four quarters,
      // one with neither revenue nor net income while a newer one has net income.
      const four = v.quarters.slice(0, 4);
      const empty = four.findIndex((q, k) => k > 0 && C.valueOf(q, "netIncome") === null && C.valueOf(q, "revenue") === null
        && four.slice(0, k).some((n) => C.valueOf(n, "netIncome") !== null));
      if (empty > 0) holes.push(`  ${s.padEnd(7)} empty ${label(four[empty])} ${four[empty].e} (row from ${four[empty].a ?? "-"}) under ${label(four[0])} ${four[0].e} | ff ${ref(v.ff)}`);
    });
  }
  console.log(`populated sets read: ${read} of ${syms.length}`);
  console.log(`two newest quarters more than 120 days apart: ${hits.length}`);
  for (const h of hits) console.log(h);
  console.log(`  of which carry ff: ${hits.filter((h) => !h.includes("| ff - |")).length}`);
  console.log(`\nan empty quarter (no revenue, no net income) under a newer filled one, newest four: ${holes.length}`);
  for (const h of holes) console.log(h);
}
