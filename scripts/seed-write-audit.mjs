// WHAT THE PREVIEW SEEDING ACTUALLY WROTE, AND WHETHER MAIN CAN READ IT.
//
// Read-only. Named `write-` ONLY because the relay routes credentialled tasks
// by that prefix — it performs no writes, and the assertion below is that it
// cannot: no set/zadd/incr/del appears in this file.
//
// THE QUESTION THIS ANSWERS IS NOT "did it work". It is whether the code on
// MAIN — which knows nothing about `lv`, nothing about the report-dates prefix,
// and would produce different labels from the same payload — reads these
// records without refetching them. A set main considers stale is a set main
// re-fetches, and 786 unnecessary companyfacts reads is a real cost.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";

const redis = Redis.fromEnv();
const pick = (file, name) =>
  (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];

const SEC_MANIFEST_KEY = pick("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = pick("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const DATES_PREFIX = pick("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const COLD_QUEUE_KEY = pick("lib/server/secColdFetch.ts", "SEC_COLD_QUEUE_KEY");
const COLD_CIK_KEY = pick("lib/server/secColdCik.ts", "SEC_COLD_CIK_KEY");

// ── THE HASHES MAIN GATES ON, computed from THIS checkout ────────────────
// `h` is a correctness gate: a stored set whose `h` differs from the reader's
// is discarded and refetched. If this PR had moved SEC_FIELD_KEYS, every
// refreshed set would be a guaranteed cold fetch on main. So it is computed
// rather than assumed.
const { lift } = await import("./lib/earnings-plan.mjs");
const fieldsMod = await lift(
  `${readCodeOnly("lib/server/secFields.ts")}\nexport { secFieldsHash, secChainsHash };`
);
const H = fieldsMod.secFieldsHash();
const C = fieldsMod.secChainsHash();
console.log(`secFieldsHash ${H}   secChainsHash ${C}\n`);

const scan = async (match) => {
  const keys = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 1000 });
    cursor = String(next);
    keys.push(...batch);
  } while (cursor !== "0");
  return keys.sort();
};

console.log("=".repeat(78));
console.log("1. WHAT EXISTS, BY PREFIX");
const dateKeys = await scan(`${DATES_PREFIX}:*`);
const factKeys = await scan(`${SEC_FACTS_PREFIX}:*`);
console.log(`   ${DATES_PREFIX}:*   ${dateKeys.length} keys   (NEW — nothing on main reads this prefix)`);
console.log(`   ${SEC_FACTS_PREFIX}:*   ${factKeys.length} keys   (EXISTING — production reads it on every render)`);

console.log("\n2. THE REPORT-DATE RECORDS — shape and size");
{
  const sample = dateKeys.slice(0, 400);
  let bytes = 0, withPending = 0, withEvents = 0;
  const fields = new Set();
  for (let i = 0; i < sample.length; i += 50) {
    const recs = await Promise.all(sample.slice(i, i + 50).map((k) => redis.get(k)));
    for (const r of recs) {
      if (!r) continue;
      bytes += JSON.stringify(r).length;
      for (const k of Object.keys(r)) fields.add(k);
      if (r.pending) withPending++;
      if (r.events?.length) withEvents++;
    }
  }
  console.log(`   sampled ${sample.length} · fields: ${[...fields].sort().join(", ")}`);
  console.log(`   mean ${Math.round(bytes / Math.max(1, sample.length))} bytes · total for ${dateKeys.length} keys ≈ ${Math.round(bytes / Math.max(1, sample.length) * dateKeys.length / 1024)} KB`);
  console.log(`   ${withEvents} of ${sample.length} hold events · ${withPending} hold a pending notice`);
  console.log(`   => inert on main: no module on main imports this prefix, so these are storage and nothing else`);
}

console.log("\n3. THE FACT SETS — can MAIN read them without refetching?");
{
  // Which sets carry the new field, and does anything about them fail main's
  // two gates: `h` (correctness, discards and refetches) and needsReread
  // (freshness, queues a re-read).
  const sample = factKeys;
  let lvSeen = 0, hMismatch = [], cMismatch = [], noQuarters = [];
  const lvValues = new Map();
  for (let i = 0; i < sample.length; i += 50) {
    const recs = await Promise.all(sample.slice(i, i + 50).map((k) => redis.get(k)));
    recs.forEach((r, j) => {
      const key = sample[i + j];
      if (!r) return;
      if (r.lv !== undefined) { lvSeen++; lvValues.set(r.lv, (lvValues.get(r.lv) ?? 0) + 1); }
      if (r.h !== H) hMismatch.push(`${key} h=${r.h}`);
      if ((r.c ?? null) !== C) cMismatch.push(`${key} c=${r.c ?? "absent"}`);
      if (!Array.isArray(r.quarters)) noQuarters.push(key);
    });
  }
  console.log(`   ${lvSeen} of ${sample.length} sets carry the new \`lv\` field — ${[...lvValues].map(([k, v]) => `lv=${k}: ${v}`).join(", ")}`);
  console.log(`   => main's StoredFactSet type has no \`lv\`; an extra JSON field is ignored by readFactSet`);
  console.log(`   h MISMATCH (main would DISCARD and refetch): ${hMismatch.length}`);
  for (const l of hMismatch.slice(0, 5)) console.log(`     ${l}`);
  console.log(`   c mismatch (main would queue a re-read): ${cMismatch.length}`);
  for (const l of cMismatch.slice(0, 5)) console.log(`     ${l}`);
  console.log(`   not an array of quarters (main would treat as a miss): ${noQuarters.length}`);
}

console.log("\n4. THE MANIFEST — the fields main selects on");
{
  const manifest = await redis.get(SEC_MANIFEST_KEY);
  const entries = Object.entries(manifest?.symbols ?? {});
  const withLv = entries.filter(([, e]) => e.lv !== undefined);
  const staleOnMain = entries.filter(([, e]) => e.cik && e.contentHash !== null &&
    ((e.w ?? 8) < 12 || (e.y ?? 5) < 6 || (e.c ?? null) !== C));
  console.log(`   ${entries.length} symbols · ${withLv.length} carry \`lv\` (unknown to main, ignored)`);
  console.log(`   lv values: ${[...new Set(withLv.map(([, e]) => e.lv))].join(", ")}`);
  console.log(`   MAIN's needsReread (w<12 || y<6 || c!==chains) selects: ${staleOnMain.length} symbols`);
  console.log(`   => that is the rewindow queue main would drain; the seed must not have grown it`);
  console.log(`   manifest updatedAt: ${manifest?.updatedAt ? new Date(manifest.updatedAt).toISOString() : "unset"}`);
}

console.log("\n5. THE COLD-FETCH COUNTERS SINCE THE SEED");
{
  const rate = await scan("msh:sec:cold-rate:v1:*");
  const exhausted = await scan("msh:sec:cold-exhausted:v1:*");
  const queue = await redis.zcard(COLD_QUEUE_KEY).catch(() => null);
  const cik = await redis.hlen(COLD_CIK_KEY).catch(() => null);
  console.log(`   cold-rate minute keys alive: ${rate.length}`);
  for (const k of rate.slice(-8)) console.log(`     ${k} = ${await redis.get(k)}`);
  console.log(`   cold-exhausted day keys: ${exhausted.length}`);
  for (const k of exhausted) console.log(`     ${k} = ${await redis.get(k)}`);
  console.log(`   cold queue depth (symbols waiting on a cron fetch): ${queue}`);
  console.log(`   cold CIK hash size: ${cik}`);
  console.log(`   => a cold fetch happens only when a RENDER finds no set; a seeded set prevents one`);
}

console.log("\n6. THE LAST sec-facts CRON RUNS");
{
  const runs = await scan("msh:job-run:v1*");
  for (const k of runs.filter((k) => k.includes("sec-facts")).slice(0, 4)) {
    const v = await redis.get(k);
    const rows = Array.isArray(v) ? v.slice(0, 3) : [v];
    for (const r of rows) {
      if (!r) continue;
      const s = r.summary ?? r;
      console.log(`     ${r.at ? new Date(r.at).toISOString() : "?"} attempted=${s.attempted} written=${s.written} ` +
        `unchanged=${s.unchanged} failed=${s.failed} coldTaken=${s.coldTaken} rewindowBacklog=${s.rewindowBacklog}`);
    }
  }
}

// ── THE FILE CANNOT WRITE, AND THAT IS ASSERTED RATHER THAN PROMISED ─────
const self = fs.readFileSync("scripts/seed-write-audit.mjs", "utf8");
const writes = self.match(/redis\.(set|zadd|incr|del|hset|expire|zrem|lpush)\b/g) ?? [];
console.log(`\n7. THIS SCRIPT'S OWN WRITE CALLS: ${writes.length} — ${writes.length ? writes.join(", ") : "none"}`);
if (writes.length) { console.error("FATAL: an audit that writes is not an audit"); process.exit(2); }
