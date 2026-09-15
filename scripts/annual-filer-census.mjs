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
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();

// THE KEY IS READ FROM THE SOURCE, NOT RETYPED. The first run of this census
// used a hand-written "msh:sec:facts:" + symbol and reported 759 of 759 SYMBOLS
// unpopulated -- a wrong answer that looked like a finding, because a GET on a
// key that does not exist and a symbol that was never populated are the same
// null. The real prefix carries a version segment (`:v1`). Reading it from
// secManifest.ts means a future rename moves this with it.
const SEC_FACTS_PREFIX = (
  fs.readFileSync("lib/server/secManifest.ts", "utf8")
    .match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? []
)[1];
if (!SEC_FACTS_PREFIX) { console.error("FATAL: could not read SEC_FACTS_PREFIX"); process.exit(2); }
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
  const sets = await redis.mget(...chunk.map((s) => `${SEC_FACTS_PREFIX}:${s}`));
  chunk.forEach((sym, j) => {
    const set = sets[j];
    if (!set || typeof set !== "object") { bucket.unpopulated.push(sym); return; }
    windows[set.w ?? 8] = (windows[set.w ?? 8] ?? 0) + 1;
    if (!usable(set)) { bucket.unusable.push(sym); return; }
    if ((set.quarters ?? []).length === 0 && (set.years ?? []).length > 0) bucket["annual-only"].push(sym);
    else bucket.quarterly.push(sym);
  });
}

// ── PER-SYMBOL DETAIL, for watching a migration move ────────────────────────
//
// The census answers "how many"; a migration needs "which, and what changed".
// SYMBOLS=AAPL,AZN,MU,RYAAY prints the stored window and period counts for
// those symbols alone, so the same command run before and after a rewindow
// pass is a before/after on the same instrument.
const WATCH = (process.env.SYMBOLS ?? "").split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
if (WATCH.length) {
  console.log(`WATCHED SYMBOLS, as stored right now:`);
  const got = await redis.mget(...WATCH.map((x) => `${SEC_FACTS_PREFIX}:${x}`));
  WATCH.forEach((sym, i) => {
    const set = got[i];
    const e = manifest.symbols[sym];
    if (!set || typeof set !== "object") {
      console.log(`  ${sym.padEnd(6)} no stored set (manifest contentHash ${e?.contentHash ?? "absent"})`);
      return;
    }
    // ── WHICH PATH WROTE IT, AND WHEN ────────────────────────────────────
    //
    // The manifest's contentHash is written ONLY by /api/jobs/sec-facts.
    // secColdFetch calls writeFactSet directly for an on-demand page view and
    // never touches the manifest, so a stored set whose manifest entry has no
    // contentHash was written by the cold path. `at` is stamped by
    // encodeFactSet at write time, which dates it.
    //
    // This is the difference between "the cold path ignores the window" and
    // "this set predates the deploy", which look identical from w alone.
    const wroteIt = e?.contentHash ? "cron job" : "cold path (page view)";
    const when = set.at ? new Date(set.at).toISOString().replace("T", " ").slice(0, 19) + "Z" : "no timestamp";
    console.log(
      `  ${sym.padEnd(6)} w=${String(set.w ?? 8).padStart(2)} quarters=${String((set.quarters ?? []).length).padStart(2)} ` +
      `years=${String((set.years ?? []).length).padStart(2)} instants=${String((set.instants ?? []).length).padStart(2)} ` +
      `| written ${when} by ${wroteIt}` +
      `\n         manifest w=${e?.w ?? "absent"} contentHash=${e?.contentHash ?? "null"} cik=${e?.cik ?? "none"}` +
      `\n         quarters carrying a prior-year match: see the growth table — a young filer has none to find`
    );
  });
  console.log("");
}

console.log("BY SHAPE, counted in SYMBOLS:");
for (const [k, v] of Object.entries(bucket)) {
  console.log(`  ${k.padEnd(13)} ${String(v.length).padStart(4)} SYMBOLS`);
}
console.log(`\nANNUAL-FILER CARD renders for ${bucket["annual-only"].length} SYMBOLS:`);
console.log("  " + (bucket["annual-only"].join(" ") || "(none)"));
// NAMED, not just counted. "2 unusable" is a number nobody can act on; two
// tickers can be opened and looked at.
console.log(`\nBELOW THE DENSITY BAR, ${bucket.unusable.length} SYMBOLS:`);
console.log("  " + (bucket.unusable.join(" ") || "(none)"));
console.log(`\nQUARTERLY, ${bucket.quarterly.length} SYMBOLS:`);
console.log("  " + (bucket.quarterly.join(" ") || "(none)"));
console.log(`\nSTORED QUARTER WINDOW, counted in SYMBOLS: ${JSON.stringify(windows)}`);
console.log("  (anything below 12 is eligible for the rewindow queue)");

// ── THE CENSUS CHECKS ITSELF AGAINST THE MANIFEST ───────────────────────────
//
// The manifest already knows which SYMBOLS the population job has written:
// contentHash is null until it writes one. So "how many sets did I read" has an
// independent second source. The first run of this census read ZERO against a
// manifest claiming four, and nothing in the output said so, because "no set
// stored" is exactly what a wrong key looks like.
//
// THE TWO DIRECTIONS ARE NOT THE SAME FAULT, so they are not treated the same:
//
//   fewer read than the manifest claims  -> FATAL. The manifest recorded a
//        write the store cannot produce. Either the key is wrong (it was) or
//        sets are being lost, and the census is measuring itself.
//   more read than the manifest claims   -> reported, not fatal, and EXPECTED.
//        The cold path (secColdFetch, line ~407) calls writeFactSet directly
//        for an on-demand page view and never touches the manifest, so a
//        cold-fetched symbol has a stored set and a null contentHash. Those
//        SYMBOLS are selected by the POPULATE queue, not rewindow, and are
//        re-read at the current window that way.
const claimsPopulated = Object.values(manifest.symbols)
  .filter((e) => e.contentHash !== null && e.contentHash !== undefined).length;
const read = symbols.length - bucket.unpopulated.length;
console.log(`\nCROSS-CHECK: manifest records ${claimsPopulated} SYMBOLS written by the job; ${read} sets read back.`);
if (read < claimsPopulated) {
  console.error(
    `FATAL: ${claimsPopulated - read} SYMBOLS the manifest says were written could not be read back. ` +
      `A census that cannot read the sets the manifest records is measuring its own key, not the universe.`
  );
  process.exit(2);
}
if (read > claimsPopulated) {
  console.log(
    `  ${read - claimsPopulated} SYMBOLS have a stored set the manifest does not record — cold-path writes. ` +
      `They are populate's, not rewindow's.`
  );
}

// ── THE QUEUE BACKLOGS, FROM THE SHIPPED SELECTOR ───────────────────────────
//
// Not re-implemented here. populationQueues() is lifted out of the job route
// and run against the real manifest, so these are the SYMBOLS the next run will
// actually take -- including rewindow's, which is the number the migration's
// drain is computed from. A census that re-derives the predicate is a second
// opinion about the code rather than a measurement of it.
const ROUTE = readCodeOnly("app/api/jobs/sec-facts/route.ts");
const num = (n) => Number((ROUTE.match(new RegExp(`${n} = (\\d+)`)) ?? [])[1]);
const job = await lift(
  [
    `const SEC_QUARTER_WINDOW = ${sec.SEC_QUARTER_WINDOW};`,
    `const SEC_REVERIFY_PER_RUN = ${num("SEC_REVERIFY_PER_RUN")};`,
    `const SEC_POPULATE_PER_RUN = ${num("SEC_POPULATE_PER_RUN")};`,
    `const SEC_REWINDOW_PER_RUN = ${num("SEC_REWINDOW_PER_RUN")};`,
    (ROUTE.match(/export const needsRewindow = [^;]+;/) ?? [])[0].replace("export const", "const"),
    grabFunction(ROUTE, "populationQueues").replace("export function", "function"),
    "export { populationQueues };",
  ].join("\n")
);
const q = job.populationQueues(manifest);
const days = (backlog, perRun) => (backlog === 0 ? "drained" : `${Math.ceil(backlog / perRun)} days`);
console.log("\nNEXT RUN TAKES, and the backlog behind it, in SYMBOLS:");
for (const [name, taken, backlog, perRun] of [
  ["reverify", q.reverify.length, q.reverifyBacklog, num("SEC_REVERIFY_PER_RUN")],
  ["populate", q.populate.length, q.populateBacklog, num("SEC_POPULATE_PER_RUN")],
  ["rewindow", q.rewindow.length, q.rewindowBacklog, num("SEC_REWINDOW_PER_RUN")],
]) {
  console.log(`  ${name.padEnd(9)} ${String(taken).padStart(4)} of ${String(backlog).padStart(4)} SYMBOLS @ ${String(perRun).padStart(3)}/run -> ${days(backlog, perRun)}`);
}
console.log(`  rewindow queue on first run: ${q.rewindow.join(" ") || "(none)"}`);
