// HAS THE COMMITTED RE-READ QUEUE DRAINED? (#552 COWORK #39). Reads only.
// For every symbol in data/sec/reread-requests.json: whether its re-read has
// landed (manifest verifiedAt >= requestedAt), whether it is still queued, and
// what its stored set now gives through the SHIPPED valuationInputs: TTM EPS
// basis/value/period and the cover count (SEC values only).
//   relay task: write-reread-drain-probe
//   Redis cost: 1 GET (manifest) + 1 MGET per 25 symbols ≈ 4 commands.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const V = await import("../lib/server/secValuation.ts");
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const MANIFEST = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const REQ = JSON.parse(fs.readFileSync("data/sec/reread-requests.json", "utf8")).requests;
const TODAY = new Date().toISOString().slice(0, 10);
let commands = 1;
const manifest = await redis.get(MANIFEST);
const syms = REQ.map((r) => r.symbol);
const sets = new Map();
for (let i = 0; i < syms.length; i += 25) {
  commands++;
  const chunk = syms.slice(i, i + 25);
  const got = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => sets.set(s, got[j]));
}
let landed = 0, queued = 0;
for (const r of REQ) {
  const e = manifest?.symbols?.[r.symbol] ?? {};
  const done = (e.verifiedAt ?? 0) >= Date.parse(r.requestedAt);
  if (done) landed++; else queued++;
  const set = sets.get(r.symbol);
  let eps = "-", cover = "-";
  if (set && Array.isArray(set.quarters)) {
    const inp = V.valuationInputs(set, TODAY, { annualForm: REG[r.symbol]?.annualForm ?? REG[r.symbol.replace(".", "-")]?.annualForm ?? null });
    eps = inp.eps ? `${inp.eps.basis}${inp.eps.kind ? "/" + inp.eps.kind : ""} ${Math.round(inp.eps.val * 100) / 100} to ${inp.eps.periodEnd}` : `refused (${inp.refusals.filter((x) => /eps/.test(x)).join(",") || "-"})`;
    cover = set.cover?.val ? `${set.cover.val.toLocaleString("en-US")} as of ${set.cover.asOf}${set.cover.derived === "computed" ? " (classes)" : ""}` : "none";
  }
  console.log(`  ${done ? "LANDED" : "QUEUED"}  ${r.symbol.padEnd(6)} verified ${e.verifiedAt ? new Date(e.verifiedAt).toISOString().slice(0, 16) : "never"}${e.needsReverify ? " (needsReverify)" : ""} | EPS ${eps} | cover ${cover}`);
}
console.log(`\nlanded ${landed} of ${REQ.length}, still queued ${queued}`);
console.log(`Redis commands: ${commands}`);
