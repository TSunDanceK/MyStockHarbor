// RELAY A WEEKLY CHECK-IN (#552 COWORK #204). READ-ONLY.
//   1. Fact sets by chains hash (current vs older), written per day, the
//      254-name priority list, and the manifest's re-read / rewindow queues.
//   2. SONY: re-read, proven splits, adjusted EPS.
//   3. #834's 15 filers: re-read since #834; OXY FY2025 Q4 revenue.
//   4. Filing jobs: KO, DUK, V, F, TSM (lag record, ff / lg, kept-open holds),
//      plus every manifest entry with a filing lag notice or a held-open re-read.
//   5. The bandwidth meter's per-source run counts, last 8 days.
// Store: GET, SCAN, MGET, HGETALL only (guarded). No SEC requests. No figures
// beyond SEC-filed values and counts; no prices.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["get", "scan", "mget", "hgetall"]);
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
const { needsReread, staleReasons } = await import("../lib/server/secStaleness.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const MANIFEST = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
if (!FACTS || !MANIFEST) { console.error("FATAL: a key moved"); process.exit(2); }
const PRIORITY = new Set(JSON.parse(fs.readFileSync("data/sec/rewindow-priority.json", "utf8")).symbols);
const M811 = Date.parse("2026-10-07T07:06:27Z"), M834 = Date.parse("2026-10-11T07:18:26Z"), M878 = Date.parse("2026-10-13T22:28:26Z");
const CURRENT = secChainsHash();
const redis = Redis.fromEnv();
const iso = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "-");

// ── 1. fact sets ──────────────────────────────────────────────────────────
const keys = [];
let cursor = "0";
do { const [next, batch] = await redis.scan(cursor, { match: `${FACTS}:*`, count: 1000 }); cursor = String(next); keys.push(...batch); } while (cursor !== "0");
const sets = new Map();
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => { if (raw[j]) sets.set(k.slice(FACTS.length + 1), raw[j]); });
}
const byHash = new Map(), byDay = new Map();
let current = 0, since811 = 0, since878 = 0;
const prPending = [];
let prSeen = 0, prCurrent = 0;
for (const [sym, set] of sets) {
  const h = set.c ?? "none";
  const e = byHash.get(h) ?? { n: 0, newest: 0 };
  e.n++; e.newest = Math.max(e.newest, set.at ?? 0); byHash.set(h, e);
  if (set.c === CURRENT) current++;
  if ((set.at ?? 0) >= M811) since811++;
  if ((set.at ?? 0) >= M878) since878++;
  if ((set.at ?? 0) >= Date.parse("2026-10-07T00:00:00Z")) { const d = new Date(set.at).toISOString().slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + 1); }
  if (PRIORITY.has(sym)) { prSeen++; if (set.c === CURRENT) prCurrent++; else prPending.push(sym); }
}
console.log(`1. FACT SETS: stored ${sets.size} · on the current chains hash (${CURRENT}) ${current} · written since #811 ${since811} · since #878 ${since878}`);
console.log(`  by chains hash: ${[...byHash].sort((a, b) => b[1].n - a[1].n).map(([h, e]) => `${h}=${e.n} (newest write ${iso(e.newest)})`).join(" · ")}`);
console.log(`  sets written per day (UTC): ${[...byDay].sort().map(([d, n]) => `${d} ${n}`).join(" · ")}`);
console.log(`  priority list (${PRIORITY.size}): stored ${prSeen} · on the current hash ${prCurrent} · pending ${prPending.length}${prPending.length && prPending.length <= 60 ? ` (${prPending.sort().join(" ")})` : ""}`);

const manifest = await redis.get(MANIFEST);
const entries = Object.entries(manifest?.symbols ?? {});
const reasons = {}, stale = {};
let reverify = 0, rewindow = 0;
for (const [, e] of entries) {
  if (e?.needsReverify) { reverify++; reasons[e.reverifyReason ?? "unspecified"] = (reasons[e.reverifyReason ?? "unspecified"] ?? 0) + 1; }
  if (e && e.contentHash != null && needsReread(e)) { rewindow++; for (const r of staleReasons(e)) stale[r] = (stale[r] ?? 0) + 1; }
}
console.log(`  manifest: ${entries.length} symbols · reverify queue ${reverify} ${JSON.stringify(reasons)} · rewindow (stamps behind the code) ${rewindow} ${JSON.stringify(stale)}`);
for (const k of Object.keys(manifest ?? {})) if (k !== "symbols" && typeof manifest[k] !== "object") console.log(`  ${k}: ${manifest[k]}`);

// ── 2. SONY ───────────────────────────────────────────────────────────────
{
  const set = sets.get("SONY"), e = manifest?.symbols?.SONY;
  console.log(`\n2. SONY: set written ${iso(set?.at)} · hash ${set?.c === CURRENT ? "current" : `older (${set?.c ?? "-"})`} · verifiedAt ${iso(e?.verifiedAt)} · needsReverify ${e?.needsReverify ?? "-"}`);
  if (set?.years) {
    const adj = splitAdjusted(set);
    const eps = (ps) => [...ps].sort((a, b) => (a.e < b.e ? 1 : -1)).slice(0, 5).map((p) => `${p.e}:${valueOf(p, "epsDiluted")}`).join(" ");
    console.log(`  asr ${set.asr ? `present (${set.asr.length})` : "absent"} · proven splits ${JSON.stringify(provenSplits(set))} · spa ${adj.spa ? JSON.stringify(adj.spa) : "none"}`);
    console.log(`  years EPS stored:   ${eps(set.years)}`);
    console.log(`  years EPS adjusted: ${eps(adj.years ?? [])}`);
  }
}

// ── 3. #834's 15 ──────────────────────────────────────────────────────────
{
  const L = "AD AMLX APLD CNA COF ECPG FIX FRO GPRE HLIT OSCR OXY RLAY TDS VAL".split(" ");
  const done = L.filter((s) => (sets.get(s)?.at ?? 0) >= M834);
  console.log(`\n3. #834's 15: re-read since #834 ${done.length}/15 · pending ${L.filter((s) => !done.includes(s)).join(" ") || "none"}`);
  for (const s of L) console.log(`  ${s}: written ${iso(sets.get(s)?.at)} · hash ${sets.get(s)?.c === CURRENT ? "current" : "older"}`);
  const oxy = sets.get("OXY");
  const q4 = (oxy?.quarters ?? []).find((p) => p.e === "2025-12-31");
  console.log(`  OXY FY2025 Q4 (2025-12-31) revenue: ${q4 ? (valueOf(q4, "revenue") == null ? "null (withheld: Not reported)" : valueOf(q4, "revenue")) : "no such quarter stored"}`);
}

// ── 4. filing jobs ────────────────────────────────────────────────────────
console.log("\n4. FILING JOBS");
for (const s of ["KO", "DUK", "V", "F", "TSM"]) {
  const set = sets.get(s), e = manifest?.symbols?.[s];
  const newest = [...(set?.quarters ?? []), ...(set?.years ?? [])].map((p) => p.e).sort().at(-1);
  console.log(`  ${s}: lastFiled ${e?.lastFiled ?? "-"} · filingCheckAt ${iso(e?.filingCheckAt)} · filingLag ${JSON.stringify(e?.filingLag ?? null)} · keptOpen ${JSON.stringify(e?.keptOpen ?? null)} · set ${iso(set?.at)} newest period ${newest ?? "-"} · ff ${set?.ff ? `${set.ff.form ?? ""} ${set.ff.reportDate}` : "none"} · lg ${set?.lg ? set.lg.reportDate : "none"}`);
}
const lags = entries.filter(([, e]) => e?.filingLag);
const notices = lags.filter(([, e]) => e.filingLag.kind === "notice");
const kept = entries.filter(([, e]) => e?.keptOpen);
console.log(`  all symbols: filing lag recorded ${lags.length} (filled ${lags.length - notices.length}, notice ${notices.length}) · kept open ${kept.length}${kept.length ? `: ${kept.map(([s, e]) => `${s} since ${iso(e.keptOpen.since)} feed ${e.keptOpen.feedEnd} vs ff ${e.keptOpen.ff}`).join("; ")}` : ""}`);
if (notices.length) console.log(`  notices: ${notices.map(([s, e]) => `${s} ${e.filingLag.reportDate}`).join(" · ")}`);
const stalledVerify = entries.filter(([, e]) => e?.needsReverify && e.enqueuedAt && Date.now() - e.enqueuedAt > 7 * 864e5);
console.log(`  re-read requests queued more than 7 days: ${stalledVerify.length}${stalledVerify.length ? ` (${stalledVerify.slice(0, 30).map(([s]) => s).join(" ")})` : ""}`);

// ── 5. bandwidth meter, per-source run counts ─────────────────────────────
console.log("\n5. METER (msh:redis-units:v1:<day>, '<source>:reads' = runs that read)");
for (let d = 7; d >= 0; d--) {
  const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  const h = await redis.hgetall(`msh:redis-units:v1:${day}`);
  const sec = Object.entries(h ?? {}).filter(([k]) => /sec|facts|report|earnings|filing/i.test(k) && k.endsWith(":reads"));
  console.log(`  ${day}: ${sec.map(([k, v]) => `${k.replace(/:reads$/, "")}=${v}`).join(" · ") || "no SEC sources"}`);
}
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
