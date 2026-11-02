// AUDIT ROUND 6, READ FROM THE STORE (reads only).
//   SYMBOLS="cells:NEE,SO|netIncome,epsDiluted"  the named fields per stored period,
//     with derivation codes, ff/lg, chains stamp and manifest verifiedAt; a stored
//     Q4 also prints secValuation.derivedQ4Eps and the operands it used.
//   SYMBOLS="gaps"  every populated stored set whose two newest quarters are more
//     than a quarter apart, with its ff/lg (the NEE shape).
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

if (mode === "cells") {
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
  const hits = [];
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
    });
  }
  console.log(`populated sets read: ${read} of ${syms.length}`);
  console.log(`two newest quarters more than 120 days apart: ${hits.length}`);
  for (const h of hits) console.log(h);
  console.log(`  of which carry ff: ${hits.filter((h) => !h.includes("| ff - |")).length}`);
}
