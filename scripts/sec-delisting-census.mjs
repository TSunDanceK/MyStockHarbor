// Which universe symbols SEC's ticker file no longer lists (Relay B, #553
// COWORK #20). READ-ONLY. Measures the signal before the sweep acts on it:
// if absence from SEC's ticker map picks out exactly the dead tickers (BK, EQR,
// EA, WBS) and nothing alive, it can evict; if it also names live ETFs or
// share classes, the rule needs a carve-out first.
//
//   relay task: write-sec-delisting-census
//   Redis: 1 GET (Pickers symbols) + 1 GET (SEC ticker map) + the dynamic
//   universe read (2 ZRANGE) = 4, once.
import "./lib/register-ts-here.mjs";
import { Redis } from "@upstash/redis";
import { lookupBySpelling } from "../lib/symbolSpellings.mjs";

const T = await import("../lib/server/secTickerMap.ts");
const D = await import("../lib/server/dynamicUniverseCache.ts");
const { PRESET_UNIVERSE } = await import("../lib/server/presetUniverse.ts");
const redis = Redis.fromEnv();

const raw = await redis.get("msh:pickers:v10:symbols");
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.symbols) ? raw.symbols : [];
const pickers = new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean));
const dynamic = await D.readDynamicUniverse();
const scoreOf = new Map(dynamic.map((e) => [e.symbol, e.score]));
const preset = new Set(PRESET_UNIVERSE.map((s) => s.trim().toUpperCase()));
const all = [...new Set([...pickers, ...scoreOf.keys(), ...preset])].sort();

const live = await T.resolveTickerMap();
const file = T.loadTickerMap();
const ageDays = live.fetchedAt ? ((Date.now() - live.fetchedAt) / 86_400_000).toFixed(1) : "n/a";
console.log(`SEC map: source ${live.source}, ${live.count} tickers, fetched ${ageDays} days ago, stale ${live.stale}, valid ${JSON.stringify(T.validateTickerMap(live.map))}`);
console.log(`committed file: ${file.count} tickers, present ${file.present}`);
console.log(`universe: Pickers ${pickers.size}, dynamic ${scoreOf.size}, preset ${preset.size}, union ${all.length}`);

const absent = [];
for (const s of all) {
  const inLive = Boolean(lookupBySpelling(live.map, s));
  const inFile = Boolean(lookupBySpelling(file.map, s));
  if (!inLive || !inFile) absent.push({ s, inLive, inFile, pickers: pickers.has(s), preset: preset.has(s), score: scoreOf.get(s) ?? null });
}
console.log(`absent from the live map or the committed file: ${absent.length}`);
for (const a of absent) console.log(`  ${a.s.padEnd(8)} live=${a.inLive ? "yes" : "NO "} file=${a.inFile ? "yes" : "NO "} pickers=${a.pickers ? "yes" : "no "} preset=${a.preset ? "YES" : "no "} score=${a.score}`);
for (const s of ["BNY", "VMRK", "BK", "EQR", "EA", "WBS"]) {
  const e = lookupBySpelling(live.map, s)?.value;
  console.log(`  check ${s}: live ${e ? `CIK ${e.cik} ${e.exchange ?? ""}` : "absent"}; pickers ${pickers.has(s)}; score ${scoreOf.get(s) ?? null}`);
}
console.log("Redis commands: ~4 (read-only)");
