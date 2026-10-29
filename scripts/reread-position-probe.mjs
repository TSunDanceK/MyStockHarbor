// WHERE NAMED SYMBOLS SIT IN THE sec-facts RE-READ QUEUES, under the shipped
// rule. For each symbol: its stored chains stamp against today's secChainsHash,
// why needsReread selects it, which queue it is in, its position there, and the
// run it is taken on if nothing else joins ahead of it. Reads only.
//   SYMBOLS="KEY,NTRS,ZION"   relay task: write-reread-position-probe
//   Redis cost: 1 GET (manifest).
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const pick = (src, name) => (src.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const MANIFEST = pick(fs.readFileSync("lib/server/secManifest.ts", "utf8"), "SEC_MANIFEST_KEY");
const manifest = await redis.get(MANIFEST);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }

const ROUTE = readCodeOnly("app/api/jobs/sec-facts/route.ts");
const STALE = readCodeOnly("lib/server/secStaleness.ts");
const EXTRACT = readCodeOnly("lib/server/secExtract.ts");
const num = (src, name) => Number((src.match(new RegExp(`${name} = (\\d+)`)) ?? [])[1]);
const C = {};
for (const n of ["SEC_QUARTER_WINDOW", "SEC_YEAR_WINDOW", "SEC_LABEL_VERSION", "SEC_SHARE_VERSION"]) C[n] = num(EXTRACT, n);
for (const n of ["SEC_REVERIFY_PER_RUN", "SEC_POPULATE_PER_RUN", "SEC_REWINDOW_PER_RUN", "SEC_POPULATE_SLACK_CEILING"]) C[n] = num(ROUTE, n);
for (const [n, v] of Object.entries(C)) if (!Number.isFinite(v)) { console.error(`FATAL: could not read ${n}`); process.exit(2); }
const mod = await lift([
  readCodeOnly("lib/server/secFields.ts"),
  ...Object.entries(C).map(([n, v]) => `const ${n} = ${v};`),
  grabFunction(STALE, "needsReread").replace("export function", "function"),
  grabFunction(STALE, "staleReasons").replace("export function", "function"),
  grabFunction(ROUTE, "populationQueues").replace("export function", "function"),
  "export { populationQueues, staleReasons, secChainsHash };",
].join("\n"));

const PRIORITY = new Set(JSON.parse(fs.readFileSync("data/sec/rewindow-priority.json", "utf8")).symbols.map((s) => s.toUpperCase()));
const q = mod.populationQueues(manifest, undefined, undefined, PRIORITY);
// The full rewindow order, not the slice one run takes.
const all = mod.populationQueues(manifest, { reverify: 1e9, populate: 1e9, rewindow: 1e9 }, undefined, PRIORITY);
const hash = mod.secChainsHash();
const withSet = Object.values(manifest.symbols).filter((e) => e.cik && e.contentHash !== null);
const stamps = new Map();
for (const e of withSet) stamps.set(e.c ?? "(none)", (stamps.get(e.c ?? "(none)") ?? 0) + 1);

console.log(`secChainsHash now: ${hash}`);
console.log(`populated entries: ${withSet.length}; stamped with today's hash: ${stamps.get(hash) ?? 0}`);
console.log(`stored chains stamps: ${[...stamps].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}=${n}`).join(", ")}`);
console.log(`backlogs: reverify ${q.reverifyBacklog} · populate ${q.populateBacklog} · rewindow ${q.rewindowBacklog}`);
console.log(`next run takes: reverify ${q.reverify.length} · populate ${q.populate.length} · rewindow ${q.rewindow.length} (limit ${q.rewindowLimit})`);
console.log(`priority-list symbols in rewindow: ${all.rewindow.filter((s) => PRIORITY.has(s)).length}\n`);

for (const s of String(process.env.SYMBOLS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean)) {
  const e = manifest.symbols[s];
  if (!e) { console.log(`  ${s.padEnd(6)} not in the manifest`); continue; }
  const rw = all.rewindow.indexOf(s), rv = all.reverify.indexOf(s);
  const where = rv >= 0 ? `reverify #${rv + 1}${rv < q.reverify.length ? " (next run)" : ""}`
    : rw >= 0 ? `rewindow #${rw + 1}${rw < q.rewindow.length ? " (next run)" : ` (~run ${Math.ceil((rw + 1) / q.rewindowLimit)} at ${q.rewindowLimit}/run)`}`
    : "in no queue";
  console.log(`  ${s.padEnd(6)} c=${e.c ?? "-"}${e.c === hash ? " (current)" : ""} verified ${e.verifiedAt ? new Date(e.verifiedAt).toISOString().slice(0, 16) : "never"}`
    + ` needsReverify=${Boolean(e.needsReverify)} stale=[${mod.staleReasons(e).join(",")}] priority=${PRIORITY.has(s)} -> ${where}`);
}
