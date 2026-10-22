// VIEW DRY RUN — every revenue-growth marker a display-rule change would move,
// main's buildSecEarningsView against this branch's, over the stored fact sets.
// Changes nothing. One line per changed cell: symbol, surface (snapshot /
// quarter / year), period, old -> new, where a value is "shown" or the n/m
// reason; the growth figure and the reporting currency ride along.
//
// CREDENTIALLED, READ-ONLY: one MGET per 25 registrants. SYMBOLS="SHARD i/n"
// splits the registrant list; SYMBOLS="YPF,GGAL" reads only those.
//   relay task: write-view-diff
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";

const { NEW, OLD } = await loadMainAndBranch();
if (!OLD) { console.error("FATAL: main's source is needed for the before column"); process.exit(2); }
const redis = Redis.fromEnv();
const FACTS = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
const arg = String(process.env.SYMBOLS || "").trim();
const shardM = arg.match(/SHARD\s+(\d+)\s*\/\s*(\d+)/i);
const all = Object.keys(JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {}).sort();
const syms = !arg || shardM ? all.filter((_, i) => !shardM || i % Number(shardM[2]) === Number(shardM[1])) : arg.split(",").map((s) => s.trim().toUpperCase());
console.log(`registrants: ${syms.length}\n`);

const mark = (o) => (o?.revenueYoYNotMeaningful ? `n/m (${o.revenueYoYNotMeaningfulReason ?? "?"})` : "shown");
const pct = (v) => (typeof v === "number" ? `${v.toFixed(1)}%` : String(v));
let read = 0, changed = 0, cells = 0, failed = 0;
const byReason = {};
for (let i = 0; i < syms.length; i += 25) {
  const chunk = syms.slice(i, i + 25);
  const got = await redis.mget(...chunk.map((s) => `${FACTS}:${s}`));
  chunk.forEach((s, j) => {
    const set = got[j];
    if (!set || !Array.isArray(set.quarters)) return;
    read++;
    try {
      const a = OLD.buildSecEarningsView(set), b = NEW.buildSecEarningsView(set);
      if (!a || !b) return;
      const lines = [];
      const cmp = (surface, label, x, y) => {
        const ma = mark(x), mb = mark(y);
        if (ma === mb) return;
        lines.push(`${s}\t${set.cur ?? "USD"}\t${surface}\t${label}\t${pct(y?.revenueYoY)}\t${ma} -> ${mb}`);
        byReason[mb] = (byReason[mb] ?? 0) + 1;
      };
      cmp("snapshot", "latest", a.snapshot, b.snapshot);
      // Paired by label AND its occurrence: a row-selection difference must not
      // pair two periods, and a filer with two rows of one label (HAS, ONTO,
      // SAM: a 52/53-week year) must not pair the second with the first.
      const keyed = (rows) => {
        const seen = {};
        return rows.map((g) => [`${g.label}#${(seen[g.label] = (seen[g.label] ?? 0) + 1)}`, g]);
      };
      for (const [surface, key] of [["quarter", "growth"], ["year", "annual"]]) {
        const before = new Map(keyed(a[key]));
        for (const [k, g] of keyed(b[key])) cmp(surface, k.endsWith("#1") ? g.label : k, before.get(k), g);
      }
      if (lines.length) { changed++; cells += lines.length; for (const l of lines) console.log(l); }
    } catch (e) { failed++; console.log(`ERR ${s}: ${String(e).slice(0, 120)}`); }
  });
}
console.log(`\nsets read ${read}; registrants changed ${changed}; cells changed ${cells}; view failures ${failed}`);
for (const [r, n] of Object.entries(byReason).sort((x, y) => y[1] - x[1])) console.log(`  ${r}: ${n}`);
