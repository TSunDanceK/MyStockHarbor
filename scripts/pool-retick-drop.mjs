// DROP RETICKERED SYMBOLS FROM THE PRICE POOL (#553 COWORK #70).
//
// BK and EQR outlived their CIKs' move to BNY and VMRK as price-pool fields,
// with NO CIK on record in the rename sweep's last-seen snapshot (they had left
// the Pickers universe before it existed). This finds them with the Tiingo
// universe's own rule (retickeredOut), taking each old ticker's CIK from the
// sweep's chain -- committed registrants, the committed ticker file, the
// last-seen snapshot -- and, last, from A's SEC manifest entry (read once
// here, never by the 15-minute job). With --apply it deletes exactly those pool
// fields AND records their CIKs in the last-seen snapshot, so the Tiingo jobs'
// guard knows them too. Dry run by default.
//
//   relay tasks: write-pool-retick-drop-dry   (prints, changes nothing)
//                write-pool-retick-drop       (--apply; only on the owner's OK)
//   Redis: 1 HKEYS + 1 HMGET + 1 GET (manifest) (+ 1 HDEL + 1 HSET with
//   --apply) = 3-5, once.
import "./lib/register-capex-ts.mjs";
import { Redis } from "@upstash/redis";
import fs from "node:fs";

if (!process.argv.includes("--allow-writes")) {
  console.error("FATAL: write task invoked without --allow-writes; refusing.");
  process.exit(2);
}
const apply = process.argv.includes("--apply");
const U = await import("../lib/server/marketData/universe.ts");
const { loadTickerMap } = await import("../lib/server/secTickerMap.ts");
const { LAST_SEEN_CIK_KEY } = await import("../lib/server/secListing.ts");
const { SEC_MANIFEST_KEY } = await import("../lib/server/secManifest.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
const { lookupBySpelling } = await import("../lib/symbolSpellings.mjs");
const POOL_KEY = "msh:price-pool:v1";

const redis = Redis.fromEnv();
const fields = ((await redis.hkeys(POOL_KEY)) ?? []).map(String);
const live = loadTickerMap();
if (!live.present) {
  console.log(`no ticker map (${live.error ?? "absent"}): nothing judged, nothing deleted`);
  process.exit(1);
}
const unlisted = fields.filter((s) => !lookupBySpelling(live.map, s));
const raw = unlisted.length ? await redis.hmget(LAST_SEEN_CIK_KEY, ...unlisted) : [];
const lastSeen = new Map();
unlisted.forEach((s, i) => {
  const v = Array.isArray(raw) ? raw[i] : raw?.[s];
  if (v != null && /^\d{10}$/.test(String(v))) lastSeen.set(s, String(v));
});
const fromSnapshot = lastSeen.size;
// The rest of the sweep's chain, then A's manifest (one GET, once).
const pad = (c) => String(c ?? "").replace(/\D/g, "").padStart(10, "0");
const missing = unlisted.filter((s) => !lastSeen.has(s));
let manifest = null;
if (missing.length) {
  const m = await redis.get(SEC_MANIFEST_KEY);
  manifest = typeof m === "string" ? JSON.parse(m) : m;
}
const fromManifest = [];
for (const s of missing) {
  const cik = REG[s]?.cik ?? manifest?.symbols?.[s]?.cik ?? null;
  if (cik && /^\d+$/.test(String(cik).replace(/^0+/, "") || "0")) {
    lastSeen.set(s, pad(cik));
    if (!REG[s]?.cik) fromManifest.push(s);
  }
}
const r = U.retickeredOut(fields, live, lastSeen);
console.log(`pool fields ${fields.length}; not in SEC's ticker file ${unlisted.length}; CIK from the last-seen snapshot ${fromSnapshot}, from registrants or A's manifest ${lastSeen.size - fromSnapshot} (manifest: ${fromManifest.join(" ") || "none"})`);
console.log(`retickered: ${r.dropped.length ? r.dropped.map((d) => `${d.symbol} -> ${d.listed.join("/")}`).join(", ") : "none"}`);
if (!apply || !r.dropped.length) {
  console.log(apply ? "nothing to delete" : "dry run: nothing deleted");
  process.exit(0);
}
const n = await redis.hdel(POOL_KEY, ...r.dropped.map((d) => d.symbol));
console.log(`deleted ${n} field(s) from the price pool`);
// So the Tiingo jobs' guard knows these CIKs if the old ticker ever returns.
const seed = Object.fromEntries(r.dropped.map((d) => [d.symbol, lastSeen.get(d.symbol)]).filter(([, c]) => c));
if (Object.keys(seed).length) {
  await redis.hset(LAST_SEEN_CIK_KEY, seed);
  console.log(`recorded ${Object.keys(seed).length} CIK(s) in the last-seen snapshot: ${Object.keys(seed).join(" ")}`);
}
process.exit(0);
