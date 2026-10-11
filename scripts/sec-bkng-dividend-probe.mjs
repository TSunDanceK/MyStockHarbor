// BKNG'S DIVIDEND IN THE PICKERS ROW (#552 COWORK #205 item 2). READ-ONLY.
// The row reads $0.79 with +107.6% growth. Prints, for SYMBOLS (default BKNG):
//   A. the stored set's quarters and years: dividend per share, diluted/basic
//      shares and net income ÷ EPS, each as filed and after splitAdjusted, and
//      which periods splitAdjusted moved (spa);
//   B. the proven splits (asr) behind it;
//   C. the stored picker row's divPerShare / divGrowth / div.
// Store: GET (fact set) + HGET (picker row). Anything else is refused. No SEC requests.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);
const READS = new Set(["get", "hget"]);
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
const { valueOf, cell } = await import("../lib/server/secFactCodec.ts");
const { splitAdjusted, provenSplits } = await import("../lib/server/secSplitAdjust.ts");
const { PICKERS_SEC_KEY } = await import("../lib/server/pickersSecFundamentals.ts");
const keyOf = (file, name) => (fs.readFileSync(file, "utf8").match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const redis = Redis.fromEnv();
const n = (v, d = 4) => (typeof v === "number" ? (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v.toFixed(d)) : "—");
for (const sym of (process.env.SYMBOLS || "BKNG").split(/[\s,]+/).filter(Boolean)) {
  console.log(`\n================ ${sym} ================`);
  const set = await redis.get(`${FACTS}:${sym}`);
  if (!set) { console.log("no fact set"); continue; }
  console.log(`set written ${new Date(set.at).toISOString()} · hash ${set.c} · asr ${set.asr ? JSON.stringify(set.asr) : "absent"}`);
  console.log(`B. proven splits: ${JSON.stringify(provenSplits(set))}`);
  const adj = splitAdjusted(set);
  console.log(`   spa: ${JSON.stringify(adj.spa ?? null)}`);
  for (const kind of ["quarters", "years"]) {
    console.log(`\nA. ${kind} (newest first): end fp/fy | DPS filed → adjusted [code] | sharesDil filed → adj | EPSdil filed → adj`);
    const adjBy = new Map((adj[kind] ?? []).map((p) => [p.e, p]));
    for (const p of [...(set[kind] ?? [])].sort((a, b) => (a.e < b.e ? 1 : -1)).slice(0, 12)) {
      const q = adjBy.get(p.e);
      console.log(`  ${p.e} ${p.fp ?? ""}/${p.fy ?? ""} | ${n(valueOf(p, "dividendsDeclaredPerShare"))} → ${n(valueOf(q, "dividendsDeclaredPerShare"))} [${cell(p, "dividendsDeclaredPerShare").derived ?? "-"}] | ${n(valueOf(p, "sharesDiluted"))} → ${n(valueOf(q, "sharesDiluted"))} | ${n(valueOf(p, "epsDiluted"), 2)} → ${n(valueOf(q, "epsDiluted"), 2)}${adj.spa?.adjusted?.includes(p.e) ? "  *moved" : ""}`);
    }
  }
  const raw = await redis.hget(PICKERS_SEC_KEY, sym);
  const row = typeof raw === "string" ? JSON.parse(raw) : raw;
  console.log(`\nC. picker row: ${row ? JSON.stringify({ at: new Date(row.at).toISOString(), divPerShare: row.divPerShare, divGrowth: row.divGrowth, div: row.div ?? null }) : "none"}`);
}
console.log(`\nStore commands: ${JSON.stringify(counts)}`);
