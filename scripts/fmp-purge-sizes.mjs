// THE FMP PURGE, DRY RUN WITH SIZES (#553 COWORK #170). READ-ONLY, ENFORCED.
//
// The same plan as scripts/fmp-purge.mjs (scripts/lib/fmp-purge-plan.mjs),
// and the same one SCAN pass, plus an approximate size per group: MEMORY USAGE
// on up to SAMPLE keys of each group, the mean times the group's key count.
// Then the commands the real run (write-fmp-purge, --apply) would send.
//
// PUBLIC LOG (#553): key patterns, counts and byte estimates only. It never
// reads a key's value (no GET / MGET / HGETALL; the insight-snapshot opt-in
// is counted as all snapshots here, its FMP-era share is what
// write-fmp-purge-dry reports), and refuses any verb but SCAN and MEMORY
// before the request leaves.
//
//   node scripts/fmp-purge-sizes.mjs          (relay: write-fmp-purge-sizes)
import { DEFAULT_GROUPS, OPT_IN_GROUPS, classify } from "./lib/fmp-purge-plan.mjs";

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["SCAN", "MEMORY"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("dry run is read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`dry run is read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const { Redis } = await import("@upstash/redis");
const redis = Redis.fromEnv();
const SAMPLE = Number(process.env.SAMPLE || 40);

const byGroup = new Map();
let cursor = "0";
let scanned = 0;
do {
  const [next, batch] = await redis.scan(cursor, { count: 1000 });
  cursor = String(next);
  scanned += batch.length;
  for (const k of batch.map(String)) {
    const g = classify(k);
    if (!g) continue;
    if (k.startsWith("msh:tiingo:")) { console.error("FATAL: a msh:tiingo: key was classified."); process.exit(2); }
    if (!byGroup.has(g.id)) byGroup.set(g.id, []);
    byGroup.get(g.id).push(k);
  }
} while (cursor !== "0");

const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(1)} KB`);
async function sizeOf(keys) {
  if (!keys.length) return { bytes: 0, sampled: 0 };
  const step = Math.max(1, Math.floor(keys.length / SAMPLE));
  const pick = keys.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  let sum = 0, n = 0;
  for (const k of pick) {
    // The client has no MEMORY method, so the one raw REST call (through the
    // read-only guard above, like every other command here).
    const b = await fetch(UPSTASH, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(["MEMORY", "USAGE", k]),
    }).then((r) => r.json()).then((j) => j?.result).catch(() => null);
    if (typeof b === "number") { sum += b; n++; }
  }
  return { bytes: n ? Math.round((sum / n) * keys.length) : 0, sampled: n };
}

console.log(`FMP purge — DRY RUN WITH SIZES (nothing deleted, no value read). Keys scanned: ${scanned}\n`);
let delKeys = 0, delBytes = 0;
const row = async (g, label) => {
  const keys = byGroup.get(g.id) ?? [];
  const { bytes, sampled } = await sizeOf(keys);
  const where = g.exact ?? `${g.prefix}*`;
  console.log(`  ${String(keys.length).padStart(6)} keys  ~${kb(bytes).padStart(9)}  ${g.owner}  ${where}${g.noTtl ? "  [no TTL]" : ""}${g.refills ? "  [refills]" : ""}  — ${label}${keys.length ? ` (size from ${sampled} sampled)` : ""}`);
  return { n: keys.length, bytes };
};
console.log("DEFAULT (deleted by write-fmp-purge):");
for (const g of DEFAULT_GROUPS) { const r = await row(g, "default"); delKeys += r.n; delBytes += r.bytes; }
console.log("\nOPT-IN (listed only; each needs its own flag and the owner's say):");
for (const g of OPT_IN_GROUPS) {
  await row(g, g.id === "pool-figures" ? `${g.flag}: strips FMP figures in rows, never deletes the hash` :
    g.id === "insight-snapshots-fmp" ? `${g.flag}: FMP-era records only (count here is ALL snapshots; write-fmp-purge-dry gives the FMP-era share)` : g.flag);
}
console.log(`\nDEFAULT TOTAL: ${delKeys} keys, ~${kb(delBytes)}`);
console.log(`\nTHE REAL RUN (write-fmp-purge = fmp-purge.mjs --apply), its commands:`);
console.log(`  ${Math.ceil(scanned / 1000)} SCAN (one pass, classify locally) + ${Math.ceil((byGroup.get("insight-snapshots-fmp")?.length ?? 0) / 100)} MGET (insight snapshots, to tell FMP-era from Tiingo)`);
console.log(`  ${Math.ceil(delKeys / 500)} DEL (500 keys each) — default groups only; no HSET without --pool-figures`);
console.log(`  ${Math.ceil(scanned / 1000)} SCAN (the confirming pass; exits 1 if a non-refilling group still has keys)`);
console.log(`\nRedis commands this dry run: ${commands} (read-only: ${[...READ_VERBS].join(", ")})`);
