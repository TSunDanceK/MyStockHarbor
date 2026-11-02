// DRY RUN (audit r6): every stored set's derived Q4 EPS, main's secValuation
// beside this branch's. Lists each earnings-page Q4 cell that goes to "Not
// available" (main derives it; the year mixes profit and loss), and each
// trailing-twelve-month EPS that moves (expected: none, the TTM is untouched).
// Reads only.   relay task: write-q4-eps-mixed-sign-dry-run
//   Redis cost: 1 GET (manifest) + 1 MGET per 25 symbols.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { Redis } from "@upstash/redis";

execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
const MAIN = `lib/server/.dryrun-main-secValuation-${process.pid}.ts`;
fs.writeFileSync(MAIN, execSync("git show FETCH_HEAD:lib/server/secValuation.ts", { encoding: "utf8" }));
let OLD, NEW;
try {
  OLD = await import(`../${MAIN}`);
  NEW = await import("../lib/server/secValuation.ts");
} finally { fs.rmSync(MAIN, { force: true }); }
const { valueOf } = await import("../lib/server/secFactCodec.ts");
const { splitAdjusted } = await import("../lib/server/secSplitAdjust.ts");

const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const redis = Redis.fromEnv();
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const TODAY = new Date().toISOString().slice(0, 10);
const syms = Object.entries(manifest.symbols).filter(([, e]) => e.cik && e.contentHash !== null).map(([s]) => s).sort();
const r2 = (v) => (v === null || v === undefined ? "—" : (Math.round(v * 100) / 100).toFixed(2));

let read = 0, q4s = 0, derivedBefore = 0;
const blanked = [], ttm = [];
for (let i = 0; i < syms.length; i += 25) {
  const chunk = syms.slice(i, i + 25);
  const sets = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => {
    const raw = sets[j];
    if (!raw?.quarters) return;
    read++;
    // The page derives on the split-adjusted set (secEarningsView); so does this.
    const set = splitAdjusted(raw);
    for (const p of set.quarters) {
      if (p.fp !== "Q4" || valueOf(p, "epsDiluted") !== null) continue;
      q4s++;
      const before = OLD.derivedQ4Eps(set, p), after = NEW.q4EpsSignsMixed(set, p) ? null : NEW.derivedQ4Eps(set, p);
      if (before !== null) derivedBefore++;
      if (before !== null && after === null) {
        const year = set.years.find((y) => y.fy === p.fy && y.e === p.e);
        const qs = ["Q1", "Q2", "Q3"].map((fp) => valueOf(set.quarters.find((q) => q.fy === p.fy && q.fp === fp), "epsDiluted"));
        blanked.push(`  ${s.padEnd(7)} Q4 FY${p.fy} (${p.e}): ${r2(before)} → Not available | FY ${r2(valueOf(year, "epsDiluted"))}, Q1–Q3 ${qs.map(r2).join(" / ")}, Q4 net income ${valueOf(p, "netIncome") === null ? "—" : `${(valueOf(p, "netIncome") / 1e6).toFixed(1)}M`}`);
      }
      if (before === null && after !== null) blanked.push(`  ${s.padEnd(7)} UNEXPECTED: Q4 FY${p.fy} gained a value ${r2(after)}`);
    }
    const filer = { annualForm: REG[s]?.annualForm ?? REG[s.replace(".", "-")]?.annualForm ?? null };
    const a = OLD.valuationInputs(raw, TODAY, filer).eps, b = NEW.valuationInputs(raw, TODAY, filer).eps;
    if ((a?.val ?? null) !== (b?.val ?? null) || a?.basis !== b?.basis) {
      ttm.push(`  ${s.padEnd(7)} TTM EPS ${a ? `${r2(a.val)} (${a.basis} to ${a.periodEnd})` : "none"} → ${b ? `${r2(b.val)} (${b.basis} to ${b.periodEnd})` : "none"}`);
    }
  });
}
const summary = `stored sets read: ${read} of ${syms.length}; Q4 quarters with no filed EPS: ${q4s}; derived on main: ${derivedBefore}`;
console.log(summary);
console.log(`\nQ4 EPS cells that go blank ("Not available"): ${blanked.filter((l) => !l.includes("UNEXPECTED")).length}`);
for (const l of blanked) console.log(l);
console.log(`\ntrailing-twelve-month EPS (valuation inputs) that move: ${ttm.length}`);
for (const l of ttm) console.log(l);
const symbols = new Set(blanked.filter((l) => !l.includes("UNEXPECTED")).map((l) => l.trim().split(/\s+/)[0]));
console.log(`\nSUMMARY: ${summary}; Q4 cells to "Not available": ${blanked.filter((l) => !l.includes("UNEXPECTED")).length} across ${symbols.size} symbols; unexpected: ${blanked.filter((l) => l.includes("UNEXPECTED")).length}; TTM EPS moved: ${ttm.length}`);
