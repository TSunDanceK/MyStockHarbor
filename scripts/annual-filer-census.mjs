// HOW MANY SYMBOLS RENDER THE ANNUAL CARD — measured from the stored universe.
//
// Counts, over every symbol in the manifest, which of these each stored fact
// set is:
//
//   annual-only   quarters === 0 && years > 0   -> the annual card is its page
//   quarterly     quarters > 0                  -> normal
//   unusable      nothing that passes the density bar
//   unpopulated   no stored set yet
//
// CREDENTIALLED, AND READ-ONLY IN EFFECT. It performs NO writes. It runs in the
// relay's credentialled job because that is the only place the Upstash secret
// exists — the `write-` prefix in this repo means "has credentials", which
// check-relay-isolation asserts, not "mutates". Every Redis call below is a
// GET or a read of the manifest.
//
// ONE GET PER SYMBOL, ONCE. After this, /api/jobs/sec-facts records
// quarters/years/instants on each manifest entry as it writes, so a later
// census is a single manifest read.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const sec = await lift(
  [
    fs.readFileSync("lib/server/secFields.ts", "utf8"),
    readCodeOnly("lib/server/secExtract.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, ""),
  ].join("\n")
);
const MIN_PERIOD_FIELDS = Number(
  (fs.readFileSync("lib/server/secColdFetch.ts", "utf8").match(/MIN_PERIOD_FIELDS = (\d+)/) ?? [])[1]
);
if (!MIN_PERIOD_FIELDS) { console.error("FATAL: could not read MIN_PERIOD_FIELDS"); process.exit(2); }

const manifest = await redis.get("msh:sec:manifest:v1");
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const symbols = Object.keys(manifest.symbols).sort();
console.log(`manifest holds ${symbols.length} SYMBOLS; density bar is ${MIN_PERIOD_FIELDS} fields in one period\n`);

const usable = (set) => {
  for (const list of [set.quarters ?? [], set.years ?? [], set.instants ?? []]) {
    for (const p of list) {
      let filled = 0;
      for (const v of p.v ?? []) if (v !== null) filled++;
      if (filled >= MIN_PERIOD_FIELDS) return true;
    }
  }
  return false;
};

const bucket = { "annual-only": [], quarterly: [], unusable: [], unpopulated: [] };
const windows = {};
for (let i = 0; i < symbols.length; i += 50) {
  const chunk = symbols.slice(i, i + 50);
  const sets = await redis.mget(...chunk.map((s) => `msh:sec:facts:${s}`));
  chunk.forEach((sym, j) => {
    const set = sets[j];
    if (!set || typeof set !== "object") { bucket.unpopulated.push(sym); return; }
    windows[set.w ?? 8] = (windows[set.w ?? 8] ?? 0) + 1;
    if (!usable(set)) { bucket.unusable.push(sym); return; }
    if ((set.quarters ?? []).length === 0 && (set.years ?? []).length > 0) bucket["annual-only"].push(sym);
    else bucket.quarterly.push(sym);
  });
}

console.log("BY SHAPE, counted in SYMBOLS:");
for (const [k, v] of Object.entries(bucket)) {
  console.log(`  ${k.padEnd(13)} ${String(v.length).padStart(4)} SYMBOLS`);
}
console.log(`\nANNUAL-FILER CARD renders for ${bucket["annual-only"].length} SYMBOLS:`);
console.log("  " + (bucket["annual-only"].join(" ") || "(none)"));
console.log(`\nSTORED QUARTER WINDOW, counted in SYMBOLS: ${JSON.stringify(windows)}`);
console.log("  (anything below 12 is eligible for the rewindow queue)");
