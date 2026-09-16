// WHICH MANIFEST ENTRIES CARRY NO CIK — and therefore sit in NO cron queue.
//
// ── WHY THE COUNT MATTERS ─────────────────────────────────────────────────
// `populationQueues` filters on `e.cik`. An entry without one is in NO queue:
// not populate, not reverify, not rewindow. It can have a stored fact set and a
// live page and still never be re-read by anything, which is the condition the
// refresh-on-view was reaching for and the condition secColdCik actually fixes.
//
// THERE ARE TWO POPULATIONS AND THEY NEED DIFFERENT THINGS, so they are counted
// apart rather than summed:
//
//   RESOLVABLE   the SEC ticker map carries the symbol, so the nightly
//                `reconcileCiks` (app/api/jobs/sec-daily-index) fills it on its
//                next run. Nothing new is needed for these.
//   UNRESOLVABLE the map does not carry it under either spelling. reconcileCiks
//                cannot help, and before secColdCik NOTHING could — the CIK was
//                known only to the render that fetched the set and was thrown
//                away. This is the residue the cold-path recording exists for.
//
// A SYMBOL WITH A STORED SET AND NO CIK is the worst case and is called out
// separately: it is serving a page from a set that nothing will ever refresh.
//
// CREDENTIALLED, AND READ-ONLY IN EFFECT. No writes. It runs in the relay's
// credentialled job because that is where the Upstash secret lives — the
// `write-` prefix in this repo means "has credentials", which
// check-relay-isolation asserts, not "mutates". Every Redis call is a GET, an
// MGET or an HGETALL.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";
// THE SHIPPED HELPER ITSELF — it is already an .mjs, so reconcileCiks and this
// census call the same function rather than two that agree today.
import { lookupBySpelling } from "../lib/symbolSpellings.mjs";

const redis = Redis.fromEnv();

// KEYS READ FROM THE SOURCE, NOT RETYPED. The annual-filer census's own header
// records what a hand-written prefix cost: 759 of 759 SYMBOLS reported
// unpopulated, because a GET on a key that does not exist and a symbol that was
// never populated are the same null.
const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (name) => (manifestSrc.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = pick("SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = pick("SEC_FACTS_PREFIX");
const SEC_COLD_CIK_KEY = (
  fs.readFileSync("lib/server/secColdCik.ts", "utf8").match(/SEC_COLD_CIK_KEY = "([^"]+)"/) ?? []
)[1];
for (const [n, v] of [["SEC_MANIFEST_KEY", SEC_MANIFEST_KEY], ["SEC_FACTS_PREFIX", SEC_FACTS_PREFIX],
  ["SEC_COLD_CIK_KEY", SEC_COLD_CIK_KEY]]) {
  if (!v) { console.error(`FATAL: could not read ${n}`); process.exit(2); }
}

// THE SHIPPED LOOKUP, NOT A .get(). The manifest is keyed by the UNIVERSE's
// spelling (dotted, BRK.B) and the ticker map by SEC's (dashed, BRK-B).
// reconcileCiks goes through lookupBySpelling for exactly this reason, and a
// census using a plain .get would report BRK.B as unresolvable — inventing a
// gap that reconcileCiks does not have.
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const entries = Object.entries(manifest.symbols);
console.log(`manifest holds ${entries.length} SYMBOLS; ticker map holds ${tickerMap.size}\n`);

const noCik = entries.filter(([, e]) => !e?.cik).map(([s]) => s).sort();
const resolvable = [];
const unresolvable = [];
for (const s of noCik) {
  (lookupBySpelling(tickerMap, s)?.value ? resolvable : unresolvable).push(s);
}

console.log("=".repeat(74));
console.log(`ENTRIES WITH NO CIK: ${noCik.length} SYMBOLS of ${entries.length}`);
console.log(`  ${resolvable.length} RESOLVABLE from the ticker map — reconcileCiks fills these nightly`);
console.log(`  ${unresolvable.length} UNRESOLVABLE — only a cold write can supply the CIK`);
console.log("");
if (noCik.length) {
  console.log(`  resolvable:   ${resolvable.join(", ") || "(none)"}`);
  console.log(`  unresolvable: ${unresolvable.join(", ") || "(none)"}`);
  console.log("");
}

// WHICH OF THEM ARE SERVING A PAGE. A stored set behind a CIK-less entry is the
// case that is actually wrong today, rather than merely untracked.
let stranded = [];
for (let i = 0; i < noCik.length; i += 50) {
  const chunk = noCik.slice(i, i + 50);
  const sets = await redis.mget(...chunk.map((s) => `${SEC_FACTS_PREFIX}:${s}`));
  chunk.forEach((sym, j) => { if (sets[j] && typeof sets[j] === "object") stranded.push(sym); });
}
console.log(`OF THOSE, SERVING A STORED SET NOTHING WILL REFRESH: ${stranded.length} SYMBOLS` +
  (stranded.length ? ` — ${stranded.join(", ")}` : ""));

// THE COLD-PATH HASH AS IT STANDS, so the drain's input is visible rather than
// inferred from the drain's output a day later.
const recorded = (await redis.hgetall(SEC_COLD_CIK_KEY)) ?? {};
const keys = Object.keys(recorded).sort();
console.log(`\nRECORDED BY COLD WRITES, AWAITING THE NEXT DRAIN: ${keys.length} SYMBOLS` +
  (keys.length ? ` — ${keys.map((k) => `${k}=${recorded[k]}`).join(", ")}` : ""));

// ONDS BY NAME, because it is the case the mechanism was written from.
for (const sym of (process.env.SYMBOLS || "ONDS").split(/[,\s]+/).filter(Boolean)) {
  const e = manifest.symbols[sym.toUpperCase()];
  const set = await redis.get(`${SEC_FACTS_PREFIX}:${sym.toUpperCase()}`);
  console.log(
    `\n${sym.toUpperCase()}: entry=${e ? "present" : "ABSENT"} cik=${e?.cik ?? "null"} ` +
      `contentHash=${e?.contentHash ? "set" : "null"} storedSet=${set ? "present" : "absent"} ` +
      `recorded=${recorded[sym.toUpperCase()] ?? "no"}`
  );
  console.log(
    `  queue-selectable (populationQueues filters on e.cik): ${e?.cik ? "YES" : "NO"}`
  );
}
