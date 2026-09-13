// Turn the relay's compact wire form into the committed snapshot.
//
// ── WHY THERE ARE TWO FORMS ────────────────────────────────────────────────
// The wire form is indexed against a sector/industry dictionary because the
// payload travels through a GitHub Actions job log and is copied into this repo
// by hand: 2,619 rows of full strings is ~128KB, where indexed it is ~29KB.
// The committed form is expanded, because a data file nobody can read in a
// diff is a data file nobody will review.
//
// The expansion is deterministic and this script is the only thing that does
// it, so the two forms cannot drift: scripts/check-static-profile.mjs re-runs
// it and asserts the committed file is exactly what the wire form expands to.
//
//   node scripts/static-profile-expand.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WIRE = path.join(ROOT, "data/.wire");

const dict = JSON.parse(fs.readFileSync(path.join(WIRE, "static-profile-dict.json"), "utf8"));

// Chunks are numbered and may be INCOMPLETE: each arrives in its own relay
// dispatch, and a partial set is an honest state to be in rather than a reason
// to write nothing. The header records exactly which chunks are present.
const chunkFiles = fs
  .readdirSync(WIRE)
  .filter((f) => /^static-profile-rows-\d+\.txt$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

const rows = {};
let lineCount = 0;
for (const file of chunkFiles) {
  for (const line of fs.readFileSync(path.join(WIRE, file), "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lineCount += 1;
    const [symbol, s, i] = trimmed.split(" ");
    const sector = s === "" || s === undefined ? null : dict.sectors[Number(s)] ?? null;
    const industry = i === "" || i === undefined ? null : dict.industries[Number(i)] ?? null;
    if (!symbol || (!sector && !industry)) {
      console.error(`FATAL: unresolvable row in ${file}: ${JSON.stringify(trimmed)}`);
      process.exit(1);
    }
    rows[symbol] = { sector, industry };
  }
}

const chunkNumbers = chunkFiles.map((f) => Number(f.match(/\d+/)[0]));
const EXPECTED_CHUNKS = 4;
const missing = Array.from({ length: EXPECTED_CHUNKS }, (_, n) => n + 1).filter((n) => !chunkNumbers.includes(n));

const out = {
  _comment: [
    "Static company facts, snapshotted from FMP while the licence was live.",
    "",
    "WHAT THIS IS FOR. sector and industry are not decoration: bucketFor() turns",
    "them into a news card's illustration and sectorUniverse turns them into a",
    "sector page's membership. After step 7 of the news-adapter migration there is",
    "no free source carrying FMP's taxonomy, so a symbol whose 30-day Redis cache",
    "has expired would have no sector at all. This file is the floor under that.",
    "",
    "LOOKUP ORDER is cache, then this file, then null - see lib/server/staticProfile.ts.",
    "A symbol in neither yields null and logs; it never guesses.",
    "",
    "WHAT IS DELIBERATELY ABSENT, and why each:",
    "  marketCap, beta, 52-week range, dividend - READINGS, not facts. Freezing a",
    "    reading puts a stale number on a live page, which is worse than an absent",
    "    row because a reader cannot tell it is stale. These keep coming from the",
    "    price pipeline. check-static-profile.mjs asserts none of them appear here.",
    "  description - not a staleness question. Every field here is a fact; FMP's",
    "    description is their authored prose. The candidate replacement is the 10-K",
    "    Item 1 business section, which is the company's own filing, reachable",
    "    through the SEC adapter that already maps a symbol to a CIK.",
    "  exchange, country, ipoDate, isin, cusip, website, ceo, employees - WANTED but",
    "    NOT CAPTURED. They exist only behind /stable/profile, one call per symbol,",
    "    and no environment available to this pipeline holds an FMP key: the agent",
    "    sandbox is refused financialmodelingprep.com outright (403 CONNECT) and the",
    "    relay carries only Upstash secrets. Adding FMP_API_KEY to the repository's",
    "    Actions secrets is the one step that unblocks them; scripts/",
    "    static-profile-build.mjs is where they would be added.",
    "",
    "SOURCE. No FMP call was made to build this. The Step 0 dump (run 34690240239,",
    "artifact step0-dump) already carried the taxonomy in three Redis datasets -",
    "screener-fundamentals (2,609 symbols), fundamentals (760) and profile (651) -",
    "every one of them 100% populated for both fields. Precedence is widest-first,",
    "and later sources only fill gaps rather than overwriting.",
    "",
    "REGENERATE with the relay task \"static-profile\", then expand the payloads with",
    "scripts/static-profile-expand.mjs. Do not hand-edit this file.",
  ].join("\n"),
  asOf: "2026-09-13",
  source: "FMP via Step 0 dump run 34690240239 (no live FMP call)",
  fields: ["sector", "industry"],
  absentFields: {
    readings: ["marketCap", "beta", "range52w", "lastAnnualDividend"],
    prose: ["description"],
    blocked: ["exchange", "country", "ipoDate", "isin", "cusip", "website", "ceo", "employees"],
  },
  coverage: {
    symbols: Object.keys(rows).length,
    chunksPresent: chunkNumbers,
    chunksExpected: EXPECTED_CHUNKS,
    complete: missing.length === 0,
    ...(missing.length ? { missingChunks: missing } : {}),
  },
  rows: Object.fromEntries(Object.keys(rows).sort().map((k) => [k, rows[k]])),
};

const target = path.join(ROOT, "data/static-profile.json");
fs.writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);

console.log(`wrote data/static-profile.json`);
console.log(`  rows:     ${Object.keys(rows).length} (from ${lineCount} wire lines)`);
console.log(`  chunks:   ${chunkNumbers.join(",") || "none"} of ${EXPECTED_CHUNKS}` +
  (missing.length ? `  ** INCOMPLETE, missing ${missing.join(",")} **` : "  complete"));
console.log(`  bytes:    ${fs.statSync(target).size}`);
