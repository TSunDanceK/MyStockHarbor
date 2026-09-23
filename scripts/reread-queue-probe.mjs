// How many stored sets the shipped staleness rule re-queues, and the queues
// sec-facts will drain (#535 COWORK #14, after #546/#547). Read-only.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";
const redis = Redis.fromEnv();
const fields = fs.readFileSync("lib/server/secFields.ts", "utf8");
const ex = fs.readFileSync("lib/server/secExtract.ts", "utf8");
const pick = (src, n) => src.match(new RegExp(`export const ${n} = [^;]+;`))[0].replace("export ", "");
const st = fs.readFileSync("lib/server/secStaleness.ts", "utf8");
const M = await lift([fields, pick(ex, "SEC_QUARTER_WINDOW"), pick(ex, "SEC_YEAR_WINDOW"), pick(ex, "SEC_LABEL_VERSION"),
  grabFunction(st, "needsReread"), grabFunction(st, "staleReasons")].join("\n") + "\nexport { needsReread, staleReasons, secChainsHash };");
const man = await redis.get("msh:sec:manifest:v1");
const entries = Object.entries(man.symbols);
const withSet = entries.filter(([, e]) => e.cik && e.contentHash && !e.delisted);
const stale = withSet.filter(([, e]) => M.needsReread(e));
const reasons = {};
for (const [, e] of stale) for (const r of M.staleReasons(e)) reasons[r] = (reasons[r] ?? 0) + 1;
console.log(`manifest ${entries.length}; with a stored set ${withSet.length}; STALE under the shipped rule ${stale.length}; reasons ${JSON.stringify(reasons)}; chains hash now ${M.secChainsHash()}`);
console.log(`needsReverify ${entries.filter(([, e]) => e.needsReverify).length}; unpopulated (cik, no contentHash) ${entries.filter(([, e]) => e.cik && !e.contentHash && !e.delisted).length}`);
const state = await redis.hgetall("msh:sec:filing-state:v1");
console.log(`filing-state entries ${state ? Object.keys(state).length : 0}; catch-up flag ${await redis.get("msh:sec:filing-catchup:v1")}`);
