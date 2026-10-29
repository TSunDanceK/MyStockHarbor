// WHICH FILERS' NEWEST 10-Q/10-K IS NOT IN COMPANYFACTS (audit r4, item 2). Reads only.
//
// A stored set carries `ff` when its newest period was read from the filing's
// own XBRL instance because companyfacts had not published it, and `lg` when
// neither source could read a newer filing. Counts both across the Pickers
// universe and lists each with the filing it names.
//
//   relay task: write-filing-fill-census  (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
let commands = 0;
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SYMBOLS_KEY = keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY");
const FACTS = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
if (!SYMBOLS_KEY || !FACTS) { console.error("FATAL: key names not readable"); process.exit(2); }

commands++;
const u = ((await redis.get(SYMBOLS_KEY)) ?? []).map((s) => String(s).toUpperCase());
const ff = [], lg = [];
let read = 0;
for (let i = 0; i < u.length; i += 25) {
  const chunk = u.slice(i, i + 25);
  commands++;
  const vals = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => {
    const v = vals[j];
    if (!v) return;
    read++;
    if (v.ff) ff.push([s, v.ff]);
    if (v.lg) lg.push([s, v.lg]);
  });
}
const fmt = ([s, f]) => `  ${s} | ${f.form ?? "?"} | ${f.accn ?? "?"} | filed ${f.filed ?? "?"} | period ${f.reportDate ?? "?"}`;
console.log(`Pickers universe: ${u.length}; fact sets read: ${read}`);
console.log(`newest filing read from its own XBRL (ff, companyfacts lacks it): ${ff.length}`);
console.log(`newest filing neither source could read (lg): ${lg.length}`);
const byForm = (xs) => Object.entries(xs.reduce((m, [, f]) => ((m[f.form ?? "?"] = (m[f.form ?? "?"] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(", ");
console.log(`ff by form: ${byForm(ff) || "none"}; lg by form: ${byForm(lg) || "none"}`);
console.log(`\nff: symbol | form | accession | filed | period`);
for (const r of ff.sort((a, b) => a[0].localeCompare(b[0]))) console.log(fmt(r));
console.log(`\nlg: symbol | form | accession | filed | period`);
for (const r of lg.sort((a, b) => a[0].localeCompare(b[0]))) console.log(fmt(r));
console.log(`Redis commands used by this read: ${commands}`);
