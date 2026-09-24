// Ticker renames followed by CIK (Relay B, #553 COWORK #22).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A RENAME IS LOST. BK -> BNY is the same company (CIK 0001390777) under
//      a new ticker; evicting BK without adding BNY drops a mega-cap from the
//      universe, which is what happened before #586's one-off swap.
//   2. THE WRONG COMPANY INHERITS. Matching by name or ticker shape instead of
//      CIK would hand BK's score to BKNG. The match is by CIK only.
//   3. A GUESS DRESSED AS A RENAME: a CIK with two plain tickers, or a
//      successor already in the universe, must be flagged, never merged.
//   4. A RUNAWAY: a bad day renaming dozens of names. Capped per run.
//   5. THE WIRING: the successor added AFTER the old one is evicted (a failed
//      add then loses both), the score not carried, the snapshot written
//      before planning (today's absence read against today's empty CIK), or
//      the changes never reaching the helper's issue.
//
// Runs the real module, then every assertion again on mutants; each must be
// caught.
//
//   node scripts/check-sec-renames.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LISTING = "lib/server/secListing.ts";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-secren-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}
const H = await import(pathToFileURL(path.join(ROOT, "scripts/lib/classification-needed.mjs")).href);

// SEC's live map as the sweep sees it (ticker -> CIK), with the cases in it.
const BNY = "0001390777";
const LIVE = new Map(Object.entries({
  BNY: { cik: BNY, exchange: "NYSE" },
  "BNY-PK": { cik: BNY, exchange: "NYSE" }, // its preferred: not the successor
  VMRK: { cik: "0000906107", exchange: "NYSE" },
  BKNG: { cik: "0001075531", exchange: "Nasdaq" }, // shares "BK"'s letters, not its CIK
  AAPL: { cik: "0000320193", exchange: "Nasdaq" },
  TWOA: { cik: "0000000042", exchange: "NYSE" },
  TWOB: { cik: "0000000042", exchange: "NYSE" },
}));
const CIK = { BK: BNY, EQR: "0000906107", EA: "0000712515", OLDA: "0000320193", DUAL: "0000000042" };
const cikOf = (s) => CIK[s] ?? null;
const UNIVERSE = ["AAPL", "MSFT", "BK", "EQR", "EA", "NOCIK", "OLDA", "DUAL"];
const UNLISTED = ["BK", "EQR", "EA", "NOCIK", "OLDA", "DUAL"];

async function suite(L, code) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const plan = L.planListingChanges(UNLISTED, { cikOf, byCik: L.tickersByCik(LIVE), universe: UNIVERSE });
  const by = Object.fromEntries(plan.map((c) => [c.kind === "rename" ? c.from : c.symbol, c]));

  ok("BK -> BNY: same CIK, new ticker, a rename", by.BK?.kind === "rename" && by.BK.to === "BNY" && by.BK.cik === BNY, JSON.stringify(by.BK));
  ok("...to BNY, not its preferred BNY-PK and not BKNG", by.BK?.to === "BNY");
  ok("EQR -> VMRK", by.EQR?.kind === "rename" && by.EQR.to === "VMRK");
  ok("a CIK SEC no longer lists is a delisting (EA)", by.EA?.kind === "evict" && by.EA.why === "cik-gone");
  ok("no CIK on file: evicted and flagged, never guessed", by.NOCIK?.kind === "evict" && by.NOCIK.why === "no-cik");
  ok("a successor already in the universe is flagged, not merged (OLDA -> AAPL)", by.OLDA?.kind === "evict" && by.OLDA.why === "successor-in-universe");
  ok("two plain tickers on one CIK: no single successor, flagged", by.DUAL?.kind === "evict" && by.DUAL.why === "ambiguous-successor");

  const capped = L.planListingChanges(["BK", "EQR"], { cikOf, byCik: L.tickersByCik(LIVE), universe: UNIVERSE, max: 1 });
  ok("over the per-run cap, a rename waits (not evicted, not renamed)", capped[0].kind === "rename" && capped[1].kind === "deferred", JSON.stringify(capped));
  ok("the cap is 10 by default", L.SEC_RENAMES_MAX === 10);

  ok("a rename's line says the score moved", /BK -> BNY \(renamed; same CIK 0001390777; score carried\)/.test(L.describeChange(by.BK)));
  ok("a flagged case says check by hand", /check by hand/.test(L.describeChange(by.NOCIK)) && /check by hand/.test(L.describeChange(by.DUAL)));

  const now = Date.parse("2026-09-25T08:00:00Z");
  const merged = L.mergeListingChanges([{ at: "2026-09-20", line: "old" }, { at: "2026-09-01", line: "gone" }], ["new"], now);
  ok("the change log prepends today's lines and drops those older than 14 days",
    merged.length === 2 && merged[0].line === "new" && merged[0].at === "2026-09-25" && merged[1].line === "old", JSON.stringify(merged));

  // The helper shows them as information.
  const lines = H.listingLines(merged, "2026-09-25");
  const body = H.issueBody({ missing: [], changed: [] }, "2026-09-25", 700, lines);
  ok("the helper's issue carries the changes as information lines", body !== null && /### Ticker changes \(information; no action needed\) \(2\)/.test(body) && /- 2026-09-25: new/.test(body), String(body).slice(0, 200));
  ok("with no changes and nothing to classify, the issue still closes", H.issueBody({ missing: [], changed: [] }, "2026-09-25", 700, []) === null);
  ok("the helper reads the key the sweep writes", code.helper.includes(`"${L.LISTING_CHANGES_KEY}"`));

  // Wiring in the sweep.
  const r = code.route;
  const add = r.indexOf("await addToDynamicUniverse([c.to], \"market\", Math.max(1, scores.get(c.from) ?? 0));");
  const evict = r.indexOf("const evicted = await evictSymbol(symbol);", add);
  ok("the successor is added, carrying the old score, BEFORE the old ticker is evicted", add > 0 && evict > add);
  ok("the old CIK comes from committed registrants, the committed ticker file, then the last-seen snapshot",
    /registrantFor\(s\)\?\.cik \?\? lookupBySpelling\(committed\.map, s\)\?\.value\?\.cik \?\? lastSeen\.get\(s\) \?\? null/.test(r));
  ok("the snapshot is written after planning, only from a map the pass trusted",
    r.indexOf("planListingChanges(todo,") > 0 && r.indexOf("await writeLastSeenCiks(pairs)") > r.indexOf("planListingChanges(todo,") && /if \(verdict\.skipped === null\) \{[\s\S]{0,300}await writeLastSeenCiks\(pairs\)/.test(r));
  ok("every change is logged for the helper", /await recordListingChanges\(lines\)/.test(r));
  ok("the run record names renames and flags", /secRenamed: sweep\.secRenamed\.join/.test(r) && /secFlagged: sweep\.secFlagged\.join/.test(r));
  return fails;
}

const src = read(LISTING);
const code = { route: readCodeOnly("app/api/jobs/warm-screener-fundamentals/route.ts"), helper: read("scripts/classification-needed.mjs") };

const base = await suite(await loadSibling(LISTING, src), code);
if (base.length) {
  console.error("FAIL check-sec-renames:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["successor found by ticker shape, not CIK", () => [mut("name", src, "const listed = (ctx.byCik.get(cik) ?? []).filter((t) => !own.has(t));",
    "const listed = [...ctx.byCik.values()].flat().filter((t) => !own.has(t) && t[0] === symbol[0]);"), code]],
  ["plain tickers not preferred (BNY-PK competes)", () => [mut("plain", src, "const candidates = plain.length ? plain : listed;", "const candidates = listed;"), code]],
  ["first candidate taken on a tie", () => [mut("tie", src, "if (candidates.length !== 1) {", "if (candidates.length === 0) {"), code]],
  ["successor already in the universe merged", () => [mut("collide", src, "if (symbolSpellings(to).some((v) => inUniverse.has(v))) {", "if (false) {"), code]],
  ["no per-run cap", () => [mut("cap", src, "if (renames >= max) {", "if (false) {"), code]],
  ["old log lines never expire", () => [mut("expire", src, "&& c.at >= cutoff)", ")"), code]],
  ["score not carried", () => [src, { ...code, route: mut("score", code.route, "Math.max(1, scores.get(c.from) ?? 0)", "1") }]],
  ["successor added after the eviction", () => {
    const addLine = "await addToDynamicUniverse([c.to], \"market\", Math.max(1, scores.get(c.from) ?? 0));";
    const moved = mut("order", code.route, addLine, "").replace("secEvicted.push(symbol);", () => `secEvicted.push(symbol);\n        if (c.kind === "rename") ${addLine}`);
    return [src, { ...code, route: moved }];
  }],
  ["changes never logged", () => [src, { ...code, route: mut("log", code.route, "await recordListingChanges(lines);", "") }]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, c] = make();
  const fails = await suite(await loadSibling(LISTING, s), c);
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-sec-renames: BK -> BNY by CIK, delisting, collision, ambiguity and cap all hold; ${MUTANTS.length} mutants caught`);
