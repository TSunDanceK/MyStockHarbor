// Q4_SPLIT BEFORE/AFTER ON LIVE RECORDS (#535 COWORK #8) — read-only.
//
// For each symbol: the stored report-date record and fact set are read from
// Upstash. BEFORE is the record as stored (no `fye` yet, so the shipped single
// pool). AFTER is the same record with `fye` taken from the set's newest annual
// period end — exactly what the writer will stamp on its next write. Both go
// through the real outlook module graph; the headline, hedge and evidence are
// the strings the tile and the earnings card print.
//   relay task: write-q4-split-render   (SYMBOLS overrides the default four)
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadOutlookGraph } from "./lib/outlook-module.mjs";

const redis = Redis.fromEnv();
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const asked = (process.env.SYMBOLS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const symbols = asked.length ? asked : ["TSLA", "KO", "AAPL", "ABBV"];
const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const FACTS = (manifestSrc.match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
const DATES = (fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8").match(/SEC_REPORT_DATES_PREFIX = "([^"]+)"/) ?? [])[1];
const g = await loadOutlookGraph();
const show = (o) => `kind=${o.kind}${o.reason ? `:${o.reason}` : ""}\n      headline: ${o.headline}\n      hedge: ${o.hedge ?? "—"}\n      evidence: ${(o.evidence ?? []).join(" | ") || "—"}`;
for (const s of symbols) {
  const [rec, set] = await Promise.all([redis.get(`${DATES}:${s}`), redis.get(`${FACTS}:${s}`)]);
  const fye = [...(set?.years ?? []).map((y) => y.e)].filter(Boolean).sort().at(-1)?.slice(5) ?? null;
  const before = rec ? { ...rec, fye: undefined } : null;
  const after = rec ? { ...rec, fye } : null;
  console.log(`\n══ ${s}  (fye ${fye ?? "none"}, next period ${rec?.nextPeriodEnd ?? "—"}, ${rec?.events?.length ?? 0} events, today ${TODAY})`);
  console.log(`  BEFORE ${show(g.mod.outlookFrom(s, before, TODAY))}`);
  console.log(`  AFTER  ${show(g.mod.outlookFrom(s, after, TODAY))}`);
  const h0 = g.expected.lagHabit(before), h1 = g.expected.lagHabit(after);
  console.log(`  habit: before median ${h0.medianLagDays}d over ${h0.fromPeriods}, precision ${h0.scored?.precision?.toFixed(3) ?? "—"} · after median ${h1.medianLagDays}d over ${h1.fromPeriods}, precision ${h1.scored?.precision?.toFixed(3) ?? "—"}`);
}
g.cleanup();
