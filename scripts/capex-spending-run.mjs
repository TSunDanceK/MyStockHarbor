// "Who is spending": run the job's own builder from a relay runner (Relay C,
// #563 COWORK #1 D1), against the live SEC fact sets.
//   mode=dry  (default) print the record's sectors and counts. Redis: one
//             MGET per 100 fact-set keys; no write.
//   mode=seed also write msh:capex:spending:v1 (1 SET; a key nothing on main
//             reads). Needs --allow-writes AND the owner's OK.
//   relay task: write-capex-spending
await import("./lib/register-capex-ts.mjs");

const mode = ((process.env.SYMBOLS || "").match(/mode=(\w+)/) ?? [])[1] ?? "dry";
if (mode === "seed" && !process.argv.includes("--allow-writes")) throw new Error("mode=seed needs --allow-writes");

const J = await import("../lib/server/capexSpendingJob.ts");
const t0 = Date.now();
const built = await J.buildSpendingRecord(Date.now());
const r = built.record;
console.log(`symbols ${built.symbols}; fact sets read ${built.setsRead}; stale field order ${built.staleFieldOrder}; Redis commands ${built.commands}; ${((Date.now() - t0) / 1000).toFixed(0)} s${built.error ? `; error ${built.error}` : ""}`);
if (r) {
  console.log(`years ${r.years.join(",")}; companies ${r.companiesRead} (duplicate listings folded ${r.duplicateListings}); other currency ${r.otherCurrency}; unclassified ${r.unclassified}; partial capex history ${r.partial}`);
  const bn = (v) => `${(v / 1e9).toFixed(1)}bn`;
  for (const s of r.sectors)
    console.log(`  ${s.sector.padEnd(24)} cohort ${String(s.cohort).padStart(4)}  capex ${s.capex.map(bn).join(" → ")}  capex/rev ${s.capexToRevenue.map((x) => (x === null ? "-" : `${(x * 100).toFixed(1)}%`)).join(" ")} (n=${s.ratioCohort})  R&D n=${s.rndCohort} ${bn(s.rnd[s.rnd.length - 1])}  top ${s.top.join(",")}`);
  console.log(`record size ${JSON.stringify(r).length} bytes`);
}
const plausible = Boolean(r && built.setsRead >= 200 && r.sectors.length >= 8);
if (mode === "seed" && plausible) {
  const { Redis } = await import("@upstash/redis");
  await Redis.fromEnv().set("msh:capex:spending:v1", r);
  console.log("seeded msh:capex:spending:v1 (1 SET)");
} else console.log(mode === "seed" ? "NOT seeded: implausible build" : "dry run: no write");
