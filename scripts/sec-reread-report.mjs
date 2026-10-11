// THE #811 RE-READ REPORT (#552 COWORK #200 item 3). READ-ONLY.
//   1. How many stored fact sets carry the CURRENT chains hash (re-read under
//      #811's rules) — overall, by day written, and on the 254-name priority list.
//   2. The manifest's re-read queues (counts by reason).
//   3. JPM / BAC / WFC / GS (and MS, C): report-date events, and whether the
//      record was rebuilt by the cron after its backfill.
//   4. SONY: re-read yet, restated share series, proven splits, adjusted EPS.
// Store: GET, SCAN, MGET only. No SEC requests.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["get", "scan", "mget"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  } else if (!url.startsWith("data:")) throw new Error("read guard: only the store may be reached");
  return realFetch(input, init);
};
const { secChainsHash } = await import("../lib/server/secFields.ts");
const { valueOf } = await import("../lib/server/secFactCodec.ts");
const { splitAdjusted, provenSplits } = await import("../lib/server/secSplitAdjust.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const MANIFEST = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const RD = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
if (!FACTS || !MANIFEST || !RD) { console.error("FATAL: a key moved"); process.exit(2); }
const PRIORITY = new Set(JSON.parse(fs.readFileSync("data/sec/rewindow-priority.json", "utf8")).symbols);
const MERGED = Date.parse("2026-10-07T07:00:00Z"); // #811 squash-merged just before 07:07 UTC
const CURRENT = secChainsHash();
const redis = Redis.fromEnv();
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "-");

// ── 1. fact sets ──────────────────────────────────────────────────────────
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");
let total = 0, current = 0, empty = 0, emptyCurrent = 0, prCurrent = 0, prSeen = 0;
const byDay = new Map(), stalePriority = [];
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => {
    const set = raw[j]; if (!set) return;
    const sym = k.slice(FACTS.length + 1);
    total++;
    const isEmpty = !set.quarters?.length && !set.years?.length;
    const ok = set.c === CURRENT;
    if (isEmpty) { empty++; if (ok) emptyCurrent++; }
    if (ok) {
      current++;
      if (set.at >= MERGED) { const d = new Date(set.at).toISOString().slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + 1); }
    }
    if (PRIORITY.has(sym)) { prSeen++; if (ok) prCurrent++; else stalePriority.push(sym); }
  });
}
console.log(`1. FACT SETS (chains hash now ${CURRENT})`);
console.log(`  stored ${total} · on the current hash ${current} (${((current / total) * 100).toFixed(1)}%) · still on an older hash ${total - current}`);
console.log(`  of which empty sets: ${empty} (${emptyCurrent} on the current hash)`);
console.log(`  written on the current hash since #811's merge, by day (UTC): ${[...byDay].sort().map(([d, n]) => `${d} ${n}`).join(" · ")}`);
console.log(`  priority list (254): stored ${prSeen} · current ${prCurrent} · not yet ${prSeen - prCurrent}${stalePriority.length ? ` (${stalePriority.sort().slice(0, 40).join(" ")}${stalePriority.length > 40 ? " …" : ""})` : ""}`);

// ── 2. manifest queues ────────────────────────────────────────────────────
const manifest = await redis.get(MANIFEST);
const syms = Object.entries(manifest?.symbols ?? {});
const reasons = {};
let reverify = 0;
for (const [, e] of syms) if (e?.needsReverify) { reverify++; reasons[e.reverifyReason ?? "unspecified"] = (reasons[e.reverifyReason ?? "unspecified"] ?? 0) + 1; }
console.log(`\n2. MANIFEST: ${syms.length} symbols · flagged for re-read ${reverify} ${JSON.stringify(reasons)} · manifest keys ${Object.keys(manifest ?? {}).filter((k) => k !== "symbols").join(",")}`);
for (const k of Object.keys(manifest ?? {})) if (k !== "symbols" && typeof manifest[k] !== "object") console.log(`  ${k}: ${manifest[k]}`);
for (const k of Object.keys(manifest ?? {})) if (k !== "symbols" && manifest[k] && typeof manifest[k] === "object") console.log(`  ${k}: ${JSON.stringify(manifest[k]).slice(0, 600)}`);

// ── 3. the banks' report dates ────────────────────────────────────────────
console.log("\n3. REPORT-DATE EVENTS (backfills written 2026-10-06 20:38 for JPM/BAC/WFC/GS, 2026-10-07 for MS and C)");
for (const s of ["JPM", "BAC", "WFC", "GS", "MS", "C"]) {
  const r = await redis.get(`${RD}:${s}`);
  console.log(`  ${s}: ${r ? `${r.events?.length ?? 0} events · record at ${r.at} · newest ${r.events?.[0]?.periodEnd ?? "-"} (${r.events?.[0]?.announcedOn ?? "-"}) · next ${JSON.stringify(r.next)}` : "no record"}`);
}

// ── 4. SONY ───────────────────────────────────────────────────────────────
console.log("\n4. SONY");
{
  const set = await redis.get(`${FACTS}:SONY`);
  const e = manifest?.symbols?.SONY ?? null;
  console.log(`  set written ${iso(set?.at)} · hash ${set?.c ?? "-"} (${set?.c === CURRENT ? "current" : "older"}) · manifest ${JSON.stringify(e && { needsReverify: e.needsReverify, reason: e.reverifyReason, verifiedAt: iso(e.verifiedAt) })}`);
  if (set?.years) {
    const proven = provenSplits(set);
    const adj = splitAdjusted(set);
    const eps = (ps) => [...ps].sort((a, b) => (a.e < b.e ? 1 : -1)).slice(0, 5).map((p) => `${p.e}:${valueOf(p, "epsDiluted")}`).join(" ");
    console.log(`  asr ${set.asr ? `present (${set.asr.length})` : "absent"} · proven splits ${JSON.stringify(proven)} · spa ${adj.spa ? JSON.stringify(adj.spa) : "none"}`);
    console.log(`  years EPS stored:   ${eps(set.years)}`);
    console.log(`  years EPS adjusted: ${eps(adj.years ?? [])}`);
  }
}
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
