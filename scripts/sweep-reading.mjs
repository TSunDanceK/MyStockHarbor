// The delisting sweep's latest run record, read-only (Relay B, #553 COWORK #26):
// the SEC listing pass's fields (#586, #593), its change log and the size of
// its last-seen CIK snapshot.
//
//   relay task: write-sweep-reading
//   Redis: 1 GET (run record) + 1 GET (change log) + 1 HLEN (snapshot) = 3.
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const keyOf = (src, name) => (fs.readFileSync(src, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const prefix = keyOf("lib/server/jobRuns.ts", "JOB_RUN_PREFIX");
const changesKey = keyOf("lib/server/secListing.ts", "LISTING_CHANGES_KEY");
const cikKey = keyOf("lib/server/secListing.ts", "LAST_SEEN_CIK_KEY");
if (!prefix || !changesKey || !cikKey) throw new Error("a key constant moved; update this reader");

const redis = Redis.fromEnv();
const run = await redis.get(`${prefix}:warm-screener-fundamentals`);
const changes = await redis.get(changesKey);
const snapshot = await redis.hlen(cikKey);
if (!run) {
  console.log("no run record for warm-screener-fundamentals");
} else {
  const s = run.summary ?? {};
  console.log(`last run: ${new Date(run.at).toISOString()} ok=${run.ok}`);
  for (const k of ["secSweepSkipped", "secUnlisted", "secRenamed", "secFlagged", "evictedBySecListing", "tombstonedBySecListing", "sweepSkipped", "evicted", "presetNeedsHandEdit"]) {
    console.log(`  ${k}: ${JSON.stringify(s[k] ?? null)}`);
  }
}
console.log(`change log entries: ${Array.isArray(changes) ? changes.length : 0}${Array.isArray(changes) && changes.length ? ` -- ${changes.map((c) => `${c.at} ${c.line}`).join(" | ")}` : ""}`);
console.log(`last-seen CIK snapshot fields: ${snapshot}`);
console.log("Redis commands: 3 (read-only)");
