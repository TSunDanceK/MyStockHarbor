// MANIFEST ENTRIES WHOSE STAMP IS BEHIND THEIR OWN STORED SET — counted, not assumed.
//
// ── THE SHAPE THIS LOOKS FOR, AND WHY IT EXISTS ────────────────────────────
// `entry.w` began being stamped in #465 (64e7bd5, 2026-09-15 20:10). `entry.y`
// and `entry.c` began in #467 (01ea371, 2026-09-16 10:18). For the ~14 hours
// between those merges the sec-facts cron stamped a WINDOW and no YEAR and no
// CHAINS, so every symbol it touched in that window carries `w` alone.
//
// needsReread reads absent `y` as 5 and absent `c` as null, BOTH OF WHICH
// SELECT — correctly, because absence really does mean "older than the field".
// But these entries are not older than the field: the STORED SET they describe
// was written by encodeFactSet, which has always stamped w/y/c/lv together. The
// set is current; only the manifest's record of it is behind.
//
// So the queue re-fetches companyfacts for a symbol whose stored set already
// holds exactly what the re-read would write. THAT is what this counts: not how
// many entries are stale, but how many are stale ONLY because the manifest
// under-records a set that is provably current.
//
// READ-ONLY. It writes nothing; the repair it is evidence for is a separate,
// gated decision.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();

// FROM THE SOURCE, not retyped — the census that retyped this prefix reported
// 759 of 759 unpopulated, because a GET on a wrong key and a symbol that was
// never populated are the same null.
const SEC_FACTS_PREFIX = (
  fs.readFileSync("lib/server/secManifest.ts", "utf8")
    .match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? []
)[1];
if (!SEC_FACTS_PREFIX) { console.error("FATAL: could not read SEC_FACTS_PREFIX"); process.exit(2); }

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift(
  [
    fs.readFileSync("lib/server/secFields.ts", "utf8"),
    strip("lib/server/secExtract.ts"),
    strip("lib/server/secFactCodec.ts"),
    strip("lib/server/secStaleness.ts"),
  ].join("\n")
);

// THE CURRENT VALUES, COMPUTED BY THE SHIPPED FUNCTIONS rather than pinned.
// A literal here would let this census agree with itself against a window that
// had moved underneath it — the failure #474 fixed in the annual-filer census.
const CHAINS_NOW = sec.secChainsHash();
const FIELDS_NOW = sec.secFieldsHash();
const num = (f, n) => Number((readCodeOnly(f).match(new RegExp(`${n} = (\\d+)`)) ?? [])[1]);
const W_NOW = num("lib/server/secExtract.ts", "SEC_QUARTER_WINDOW");
const Y_NOW = num("lib/server/secExtract.ts", "SEC_YEAR_WINDOW");
const LV_NOW = num("lib/server/secExtract.ts", "SEC_LABEL_VERSION");
for (const [n, v] of [["SEC_QUARTER_WINDOW", W_NOW], ["SEC_YEAR_WINDOW", Y_NOW], ["SEC_LABEL_VERSION", LV_NOW]]) {
  if (!v) { console.error(`FATAL: could not read ${n} from the source`); process.exit(2); }
}

const manifest = await redis.get("msh:sec:manifest:v1");
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const entries = Object.entries(manifest.symbols);
console.log("=".repeat(74));
console.log(`MANIFEST: ${entries.length} SYMBOLS`);
console.log(`current: chains ${CHAINS_NOW} · fields ${FIELDS_NOW} · w ${W_NOW} · y ${Y_NOW} · lv ${LV_NOW}`);
console.log("");

// ── 1. THE STAMP SHAPES, COUNTED ────────────────────────────────────────────
// Reported as a histogram rather than one number, because "w without y/c" has
// three neighbours that are NOT this bug and would inflate it if merged in:
// an entry with nothing stamped at all (emptyEntry, from cold-cik-backfill),
// and an entry with c but no w (sec-refresh-sets stamps lv and c only).
const has = (v) => v !== undefined && v !== null;
const shape = (e) =>
  `w:${has(e.w) ? e.w : "-"} y:${has(e.y) ? e.y : "-"} c:${has(e.c) ? "set" : "-"} lv:${has(e.lv) ? e.lv : "-"}`;
const populated = entries.filter(([, e]) => e.contentHash !== null);
const hist = new Map();
for (const [, e] of populated) hist.set(shape(e), (hist.get(shape(e)) ?? 0) + 1);
console.log(`STAMP SHAPES ACROSS THE ${populated.length} POPULATED SYMBOLS:`);
for (const [k, n] of [...hist].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log("");

// THE SHAPE ITSELF: a window stamped, and at least one of year/chains missing.
const suspect = populated.filter(([, e]) => has(e.w) && (!has(e.y) || !has(e.c)));
console.log(`ENTRIES WITH w BUT MISSING y AND/OR c: ${suspect.length} SYMBOLS`);
console.log(`  w, no y, no c (the #465->#467 window): ${populated.filter(([, e]) => has(e.w) && !has(e.y) && !has(e.c)).length}`);
console.log(`  w and c, no y                        : ${populated.filter(([, e]) => has(e.w) && has(e.c) && !has(e.y)).length}`);
console.log(`  w and y, no c                        : ${populated.filter(([, e]) => has(e.w) && has(e.y) && !has(e.c)).length}`);
console.log("");

// ── 2. HOW MANY OF THOSE DESCRIBE A SET THAT IS ALREADY CURRENT ─────────────
// The whole point. A re-read is only wasted if the set it would rewrite already
// holds what the re-read would produce, and that is decided by the SET's own
// four stamps — never by the manifest's, which is the thing under suspicion.
const names = suspect.map(([s]) => s);
const sets = new Map();
for (let i = 0; i < names.length; i += 100) {
  const chunk = names.slice(i, i + 100);
  const got = await redis.mget(...chunk.map((s) => `${SEC_FACTS_PREFIX}:${s}`));
  chunk.forEach((s, j) => sets.set(s, got[j]));
}
const setCurrent = (set) =>
  !!set && set.h === FIELDS_NOW && (set.c ?? null) === CHAINS_NOW &&
  (set.w ?? 8) >= W_NOW && (set.y ?? 5) >= Y_NOW && (set.lv ?? 1) >= LV_NOW;

let repairable = 0, setBehind = 0, noSet = 0;
const why = new Map();
for (const [symbol, e] of suspect) {
  const set = sets.get(symbol);
  if (!set) { noSet++; continue; }
  if (setCurrent(set)) { repairable++; continue; }
  setBehind++;
  const r = [];
  if (set.h !== FIELDS_NOW) r.push("fields");
  if ((set.c ?? null) !== CHAINS_NOW) r.push("chains");
  if ((set.w ?? 8) < W_NOW) r.push("w");
  if ((set.y ?? 5) < Y_NOW) r.push("y");
  if ((set.lv ?? 1) < LV_NOW) r.push("lv");
  why.set(r.join("+"), (why.get(r.join("+")) ?? 0) + 1);
  void e;
}
console.log(`OF THOSE ${suspect.length}, BY THE STORED SET'S OWN h/c/w/y/lv:`);
console.log(`  ${String(repairable).padStart(4)}  SET IS ALREADY CURRENT — the re-read would rewrite identical stamps.`);
console.log(`        These are the repairable ones: stamping y/c/lv from the set removes them`);
console.log(`        from the rewindow queue without a single companyfacts fetch.`);
console.log(`  ${String(setBehind).padStart(4)}  set genuinely behind — a real re-read, NOT repairable`);
for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`          ${String(n).padStart(4)} behind on ${k}`);
console.log(`  ${String(noSet).padStart(4)}  no stored set at all — leave to populate/rewindow`);
console.log("");

// ── 3. WHAT THE REPAIR WOULD BE WORTH, IN QUEUE TERMS ───────────────────────
const eligible = entries.filter(([, e]) => e.cik && !e.needsReverify && e.contentHash !== null && sec.needsReread(e));
console.log(`REWINDOW BACKLOG NOW: ${eligible.length} SYMBOLS`);
console.log(`  of which repairable by stamping alone: ${repairable}`);
console.log(`  remaining after a repair:              ${eligible.length - repairable}`);
console.log("");
console.log("NAMES (repairable), for spot-checking:");
const repairNames = suspect.filter(([s]) => setCurrent(sets.get(s))).map(([s]) => s).sort();
console.log(`  ${repairNames.join(" ") || "(none)"}`);
