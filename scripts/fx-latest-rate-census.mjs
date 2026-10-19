// WHICH FILERS' "ABOUT THESE FIGURES" RATE CHANGES (fix/fx-latest-rate-fy).
//
// Every stored set in a currency other than USD, through main's view and this
// branch's: the latest period, and the rate and basis the currency note quotes
// on each side. Only the sets whose quoted rate differs are listed, with the
// stored rate entries for that end so the cause can be read off.
//
// CREDENTIALLED, READ-ONLY: the manifest GET and MGETs of the stored fact sets,
// 20 at a time. No write verb is sent. SYMBOLS="SHARD i/n" splits the manifest.
//   relay task: write-fx-latest-rate-census
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";

const { NEW, OLD } = await loadMainAndBranch();
if (!OLD) { console.error("FATAL: main's source is needed for the before column"); process.exit(2); }
const src = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const MANIFEST_KEY = (src.match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
const FACTS_PREFIX = (src.match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
if (!MANIFEST_KEY || !FACTS_PREFIX) { console.error("FATAL: could not read the store keys from source"); process.exit(2); }

const redis = Redis.fromEnv();
const manifest = await redis.get(MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const all = Object.keys(manifest.symbols).filter((s) => manifest.symbols[s]?.cik).sort();
const m = String(process.env.SYMBOLS || "").match(/SHARD\s+(\d+)\s*\/\s*(\d+)/i);
const [shard, shards] = m ? [Number(m[1]), Number(m[2])] : [0, 1];
const targets = all.filter((_, i) => i % shards === shard);
console.log(`manifest symbols with a CIK: ${all.length}; this shard ${shard}/${shards}: ${targets.length}\n`);

let sets = 0, foreign = 0, yearLatest = 0, errors = 0;
const changed = [];
const note = (M, set) => { const v = M.buildSecEarningsView(set); return { basis: v?.basis ?? null, rate: v?.currency?.latestRate ?? null, kind: v?.currency?.latestBasis ?? null }; };
for (let i = 0; i < targets.length; i += 20) {
  const batch = targets.slice(i, i + 20);
  const got = await redis.mget(...batch.map((s) => `${FACTS_PREFIX}:${s}`));
  batch.forEach((sym, j) => {
    const set = got[j];
    if (!set?.quarters) return;
    sets++;
    if ((set.cur ?? "USD") === "USD") return;
    foreign++;
    try {
      const a = note(OLD, set), b = note(NEW, set);
      if (b.basis === "year") yearLatest++;
      if (a.rate === b.rate && a.kind === b.kind) return;
      const latest = b.basis === "year" ? set.years[0] : set.quarters[0];
      const entries = (set.fx?.applied ?? []).filter((x) => x.end === latest?.e)
        .map((x) => `${x.basis[0]}${x.usdPerUnit}${x.start !== undefined ? `@${x.start}` : ""}`).join(",");
      changed.push(`${sym} ${set.cur} ${b.basis} ${latest?.s ?? "-"}..${latest?.e} main ${a.rate} (${a.kind}) -> branch ${b.rate} (${b.kind}) entries ${entries || "-"} set at ${String(set.at).slice(0, 10)}`);
    } catch (e) {
      errors++;
      console.log(`  error ${sym}: ${e.message}`);
    }
  });
}
console.log(`SETS ${sets}, non-USD ${foreign}, latest is a year ${yearLatest}, view errors ${errors}, quoted rate changes ${changed.length}`);
for (const c of changed) console.log(`  changed ${c}`);
