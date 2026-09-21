// Every whole-collection Redis write stays under Upstash's 10MB REQUEST limit,
// and the pickers chunks actually go as separate requests.
//
// SCOPE, AND WHY IT WIDENED. This file used to read pickersBuilder.ts and
// chunkByBytes.ts and nothing else, while its own §5 note said "fix the
// pattern, not just the one site that is currently firing". The two SEC writes
// -- secManifest.ts and secTickerMap.ts -- are each a single unchunked SET of a
// whole collection, which is precisely the shape §5 is about, and neither was
// covered. A guard whose scope is narrower than the defect it names is how the
// next site gets to fail the same way; §5 below is the fix for that.
//
// THE FAILURE THIS GUARDS. Upstash rejected the payload write three times --
// 2026-09-05, 09-07 and 09-10, all at 07:21-07:22 UTC. An over-limit operation
// RETURNS AN ERROR rather than truncating, so the write fails, the stale value
// stays under its TTL, and the fail-open handlers swallow it. There is no user
// damage and no Vercel error; it presents as a picker payload that quietly
// stops updating. See claude/upstash-request-size-2026-09-11.md.
//
// TWO PROPERTIES, AND THE FIRST ONE IS EASY TO GET WRONG IN A WAY THAT REVIEWS
// CLEAN.
//
//   1. THE CHUNKS MUST BE SEPARATE REQUESTS. An Upstash REST pipeline sends
//      every command in ONE POST body, so chunking into a pipeline moves the
//      same bytes in the same request and fixes nothing. Worse,
//      `enableAutoPipelining` defaults to TRUE in the installed client and
//      nothing here turns it off, so Promise.all over the chunk writes ALSO
//      collapses into one body -- measured, not assumed (see below). Both are
//      forbidden on this path.
//
//   2. THE BUDGET MUST FOLLOW THE UNIVERSE. The payload scales with
//      ANALYSIS_UNIVERSE_CAP. A byte budget that is right at 700 and silently
//      wrong at 1,500 is the shape this project has been bitten by four times:
//      EARNINGS_BATCH_SIZE, PRICE_TARGET_RUNS, TARGET_FAST, and a tier-1 size
//      that had no stated value at all.
//
//   node scripts/check-request-size.mjs
import ts from "typescript";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const builder = readCodeOnly("lib/server/pickersBuilder.ts");
const helper = readCodeOnly("lib/server/chunkByBytes.ts");

const grab = (src, file, name) => {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  let out = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      out = n.getText(sf).replace(/^export\s+/, "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
};

// ── 1. chunkByBytes does what its name says, RUN over fixtures ──────────────
console.log("\n1. The helper groups by bytes, not by count");

const chunkFn = grab(helper, "chunkByBytes.ts", "chunkByBytes");
const budget = Number(
  Function(
    `"use strict"; return (${
      (helper.match(/REQUEST_BYTE_BUDGET = ([0-9_ *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
const planLimit = Number(
  Function(
    `"use strict"; return (${
      (helper.match(/UPSTASH_MAX_REQUEST_BYTES = ([0-9_ *]+);/) ?? [])[1] ?? "0"
    });`
  )()
);
if (!chunkFn || !budget || !planLimit) {
  console.error(
    `FAIL: could not extract chunkByBytes (${!!chunkFn}), the budget (${budget}) or ` +
      `the plan limit (${planLimit}) — every assertion below would measure nothing.`
  );
  process.exit(1);
}
const lifted = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(
      `const REQUEST_BYTE_BUDGET = ${budget};\n${chunkFn}\nexport { chunkByBytes };`,
      { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
    ).outputText
  ).toString("base64")}`
);

// A serializer with a KNOWN size, so the assertion is about the grouping and
// not about JSON's opinion of the fixture.
const sized = (n) => ({ n });
const sizeOf = (item) => item.n;

const even = lifted.chunkByBytes([100, 100, 100, 100].map(sized), sizeOf, 250);
check(
  "a group is closed before it would exceed the budget",
  even.groups.map((g) => g.length).join(",") === "2,2" && even.oversized === 0,
  `${even.groups.map((g) => g.length).join(",")} at 100 bytes each under a 250 budget — ` +
    `two fit, the third opens a new group. A count-based chunker would have made one`
);
check(
  "every group is genuinely under budget",
  even.groups.every((g) => g.reduce((sum, i) => sum + sizeOf(i), 0) <= 250),
  "the property, checked over the output rather than inferred from the loop"
);

const withGiant = lifted.chunkByBytes([sized(10), sized(9999), sized(10)], sizeOf, 250);
check(
  "an item over budget on its own is yielded ALONE, not thrown",
  withGiant.groups.length === 3 &&
    withGiant.groups[1].length === 1 &&
    withGiant.oversized === 1,
  `${withGiant.groups.map((g) => g.length).join(",")} — fail-open is the house style: ` +
    `an oversized request fails ONE write and leaves the previous value, while a ` +
    `throw takes down the build. The count comes back so the caller can log it`
);
check(
  "the pending group is flushed before the oversized item, not dragged over with it",
  withGiant.groups[0].length === 1 && withGiant.groups[2].length === 1,
  "otherwise a 10-byte item would ride along in a 9999-byte request for no reason"
);
check(
  "an unmeasurable size counts as a FULL budget, never as free",
  lifted.chunkByBytes([sized(NaN), sized(NaN)], sizeOf, 250).groups.length === 2,
  "counting it as zero would let an unbounded number into one group, which is " +
    "the failure this file exists to prevent, reached through a bad input"
);
check(
  "empty input yields no groups rather than one empty one",
  lifted.chunkByBytes([], sizeOf, 250).groups.length === 0,
  "a caller looping the result must not issue a write of nothing"
);

// ── 2. The chunks go as SEPARATE requests ───────────────────────────────────
console.log("\n2. Separate requests — not a pipeline, and not Promise.all");

const writeFn = grab(builder, "pickersBuilder.ts", "writePickersChunked");
if (!writeFn) {
  console.error("FAIL: could not extract writePickersChunked — measuring nothing.");
  process.exit(1);
}
check(
  "the chunk writes do not go through redis.pipeline()",
  !/\.pipeline\(/.test(writeFn),
  "an Upstash REST pipeline sends every command in ONE POST body, so chunking " +
    "into one moves the same bytes in the same request — it would look correct, " +
    "review correct, and still breach. warmTargets.ts uses redis.pipeline() for " +
    "exactly this kind of paired write, so the idiomatic version here is broken"
);
check(
  "the chunk writes are not issued concurrently either",
  !/Promise\.all/.test(writeFn) && !/Promise\.allSettled/.test(writeFn),
  "enableAutoPipelining defaults to TRUE in @upstash/redis and nothing in this " +
    "project turns it off, so concurrent sets collapse into one request body — " +
    "measured against the installed client, three awaited sets give three bodies " +
    "and three concurrent ones give a single [[set..],[set..],[set..]]"
);
// THE LOOP BODY, FROM THE PARSER, NOT A PROXIMITY WINDOW.
//
// This was `/for \(...\) \{[\s\S]{0,400}?await redis\.set\(chunkKeys\[i\]/` and it
// went red on a comment. readCodeOnly blanks comments IN PLACE rather than
// deleting them, so prose added above the await pushes it out of the window
// while changing nothing the assertion is about -- the trap this repo has
// already catalogued, hit again. A window tuned to today's formatting is a
// tripwire on formatting.
const loopBodies = (() => {
  const sf = ts.createSourceFile("w.ts", writeFn, ts.ScriptTarget.Latest, true);
  const out = [];
  const visit = (n) => {
    if (ts.isForStatement(n) || ts.isForOfStatement(n)) out.push(n.statement.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
})();
check(
  "each chunk is awaited inside the loop",
  loopBodies.some((body) => /await redis\.set\(\s*chunkKeys\[i\]/.test(body)),
  `${loopBodies.length} loop(s) in the function — the sequential await IS the fix, ` +
    `and the comment on that line says so, in prose rather than an eslint-disable ` +
    `because this project does not enable no-await-in-loop and an unused directive ` +
    `gets cleaned away`
);

// THE MANIFEST LANDS LAST, or a reader can see a half-written set.
//
// WHITESPACE-TOLERANT ANCHORS, and that is not tidiness. The symbol-list index
// was `indexOf("await redis.set(\n    PICKERS_SYMBOLS_KEY")` -- an anchor on
// the LAYOUT of a call rather than on the call -- and it broke the moment the
// write was reformatted onto one line during the rebase onto #427. The
// assertion went red on a change that altered nothing it was about, which is
// the third anchor of this shape in this batch. check-assertion-anchors.mjs
// catches signature-shaped anchors; it cannot see a line break inside an
// argument list, so the defence here is to stop depending on one.
const at = (pattern) => {
  const i = writeFn.search(pattern);
  return i;
};
const lastChunkIdx = at(/await redis\.set\(\s*chunkKeys\[i\]/);
const manifestIdx = at(/await redis\.set\(\s*PICKERS_MANIFEST_KEY/);
const symbolsIdx = at(/await redis\.set\(\s*PICKERS_SYMBOLS_KEY/);
check(
  "the manifest is written after the chunks it names",
  lastChunkIdx !== -1 && manifestIdx !== -1 && lastChunkIdx < manifestIdx,
  `chunks at ${lastChunkIdx}, manifest at ${manifestIdx} — chunks live under a ` +
    `build-scoped prefix no reader knows about until the manifest names them, so ` +
    `a concurrent reader sees a complete old payload or a complete new one`
);
check(
  "the symbol list is written before the manifest too",
  symbolsIdx !== -1 && symbolsIdx < manifestIdx,
  "so a reader seeing a fresh manifest never sees a staler symbol list than the " +
    "payload it names"
);
check(
  "chunk keys are build-scoped rather than :0, :1 in place",
  /const buildId = /.test(writeFn) && /\$\{PICKERS_CHUNK_PREFIX\}:\$\{buildId\}:\$\{i\}/.test(writeFn),
  "writing :0, :1 in place would let a reader observe a half-written set, and " +
    "two concurrent builds would interleave their chunks"
);
check(
  "the chunks outlive the manifest that points at them",
  (() => {
    const chunkTtl = Number(
      Function(`"use strict"; return (${(builder.match(/PICKERS_CHUNK_TTL_SECONDS = ([0-9 *_]+);/) ?? [])[1] ?? "0"});`)()
    );
    const manifestTtl = Number(
      Function(`"use strict"; return (${(builder.match(/PICKERS_REDIS_TTL_SECONDS = ([0-9 *_]+);/) ?? [])[1] ?? "0"});`)()
    );
    return chunkTtl > 0 && manifestTtl > 0 && chunkTtl > manifestTtl;
  })(),
  "a chunk expiring under a live manifest is a short read, and readPickersV10 " +
    "returns null for that rather than serving a payload missing symbols"
);

// ── 3. The budget follows the universe cap ──────────────────────────────────
console.log("\n3. The byte budget is coupled to ANALYSIS_UNIVERSE_CAP");

const cap = Number(
  (readCodeOnly("lib/server/dynamicUniverseCache.ts").match(/ANALYSIS_UNIVERSE_CAP = (\d+)/) ?? [])[1]
);
// THE MEASURED PER-RECORD COST, NOT THE DERIVED ONE, and the difference is the
// point. redisBandwidth's BYTES_PER_SYMBOL_PICKER_PAYLOAD says 2,000; a STRLEN
// of the live key on 2026-09-11 says 7,248,807 over 700 records, which is
// ~10,356. They disagree by five times. Sizing the thing that must not breach
// against the SMALLER of two numbers would have made this whole section pass
// by projecting 1.3MB for a payload that is really 6.9MB -- an assertion that
// is green precisely because its input is wrong.
const strlen = Number(
  (helper.match(/PICKERS_PAYLOAD_STRLEN_MEASURED = ([0-9_]+);/) ?? [])[1]?.replace(/_/g, "")
);
const measuredAtUniverse = Number(
  (helper.match(/PICKERS_PAYLOAD_MEASURED_AT_UNIVERSE = ([0-9_]+);/) ?? [])[1]?.replace(/_/g, "")
);
const bytesPerRecord = strlen && measuredAtUniverse ? strlen / measuredAtUniverse : 0;
if (!cap || !bytesPerRecord) {
  console.error(
    `FAIL: could not read ANALYSIS_UNIVERSE_CAP (${cap}) or the measured payload ` +
      `size (STRLEN ${strlen} over ${measuredAtUniverse}) — the projection would be invented.`
  );
  process.exit(1);
}
check(
  "the measurement carries its own provenance",
  /PICKERS_PAYLOAD_MEASURED_AT = "\d{4}-\d{2}-\d{2}"/.test(helper) &&
    /PICKERS_PAYLOAD_MEASURED_SOURCE =/.test(helper),
  `STRLEN ${strlen} at a universe of ${measuredAtUniverse} — a bare number with no ` +
    `history is exactly as bad as a typed one, and this one contradicts an existing ` +
    `constant by 5x, so where it came from is not optional`
);
check(
  "the projection uses the LARGER of the two per-record figures",
  bytesPerRecord >
    Number(
      (readCodeOnly("lib/server/redisBandwidth.ts").match(
        /BYTES_PER_SYMBOL_PICKER_PAYLOAD = ([0-9_]+);/
      ) ?? [])[1]?.replace(/_/g, "") ?? 0
    ),
  `${Math.round(bytesPerRecord)}B measured vs 2,000B derived — sizing a breach ` +
    `guard against the smaller number is how it passes while the payload it ` +
    `guards is five times bigger`
);
check(
  "both inputs to the projection were read from source",
  cap > 0 && bytesPerRecord > 0,
  `cap ${cap}, ${bytesPerRecord} bytes/record — typed here, this section would ` +
    `check two numbers this file made up`
);

// RUN THE REAL CHUNKER over a projected universe, rather than doing the
// division here. The claim is "the configured chunking keeps every request
// under budget at the configured cap", and only the chunker can answer it.
const projected = Array.from({ length: cap }, () => sized(bytesPerRecord));
const projectedChunks = lifted.chunkByBytes(projected, sizeOf, budget);
const worstGroupBytes = Math.max(
  ...projectedChunks.groups.map((g) => g.reduce((sum, i) => sum + sizeOf(i), 0))
);
check(
  "at the configured cap, no request exceeds the budget",
  worstGroupBytes <= budget && projectedChunks.oversized === 0,
  `${cap} records x ${Math.round(bytesPerRecord)}B = ${(cap * bytesPerRecord / 1024 / 1024).toFixed(2)}MB ` +
    `in ${projectedChunks.groups.length} chunk(s), worst ${(worstGroupBytes / 1024 / 1024).toFixed(2)}MB ` +
    `against a ${(budget / 1024 / 1024).toFixed(0)}MB budget`
);
check(
  "the budget leaves real headroom under the plan limit",
  budget * 2 <= planLimit,
  `${(budget / 1024 / 1024).toFixed(0)}MB budget against a ${(planLimit / 1024 / 1024).toFixed(0)}MB ` +
    `limit — 2x, because the JSON escaping inflation is real and not precisely ` +
    `known, command overhead sits on top, and commands are unlimited on this plan ` +
    `so an extra round trip costs nothing`
);
// THE COUPLING ITSELF: raising the cap must not silently breach.
const atNextStep = lifted.chunkByBytes(
  Array.from({ length: 3000 }, () => sized(bytesPerRecord)),
  sizeOf,
  budget
);
check(
  "the chunk count follows the universe automatically, with no constant to edit",
  atNextStep.groups.length > projectedChunks.groups.length &&
    atNextStep.groups.every((g) => g.reduce((sum, i) => sum + sizeOf(i), 0) <= budget),
  `${projectedChunks.groups.length} chunk(s) at ${cap}, ` +
    `${atNextStep.groups.length} at 3,000 — nothing to remember to change, which is ` +
    `the whole difference from a count-based chunk size`
);

// ── 4. #427's measurement survived the write it measured ───────────────────
console.log("\n4. The byte log still reports what the 10MB limit is about");

// WHY THIS SECTION EXISTS. #427 shipped `[pickers] payload write: N bytes
// serialized` against the single v9 write, which this PR replaces. The log is
// the only instrument pointed at the breach, so carrying it forward is part of
// the fix rather than a courtesy -- and carrying it forward WRONG is worse than
// dropping it, because the obvious translation (sum the chunks) reports a
// number the limit does not apply to.
//
// A total of 7.2MB under a 10MB limit reads as comfortable while a single
// 5.2MB chunk is what would actually be rejected. So both are logged, and the
// figure compared to the ceiling is the LARGEST.
check(
  "the chunked write logs the total across every request",
  /totalBodyBytes \+= measured\.bodyBytes;/.test(writeFn) &&
    /\$\{totalBodyBytes\} bytes total request/.test(writeFn),
  "this is what replaces #427's single-write figure, and it stays comparable " +
    "with the Redis bandwidth meter"
);
check(
  "and the LARGEST single body, which is the one the limit applies to",
  /largestBodyBytes = Math\.max\(largestBodyBytes, measured\.bodyBytes\);/.test(writeFn) &&
    /largest single body \$\{largestBodyBytes\}/.test(writeFn),
  "a sum under the ceiling cannot express a single chunk over it — reporting " +
    "only the total would be the proxy-for-the-real-quantity defect this whole " +
    "PR is about, reintroduced in the instrument"
);
check(
  "the percentage-of-limit is computed from the largest, not from the total",
  /pctOfLimit\(largestBodyBytes\)/.test(writeFn) && !/pctOfLimit\(totalBodyBytes\)/.test(writeFn),
  "the one number a reader will act on"
);
check(
  "the manifest and the symbol list are measured too, not just the chunks",
  (writeFn.match(/account\(tryMeasureSet\(/g) ?? []).length === 3,
  "the manifest carries `head` — every payload field except signalRecords — so " +
    "it is the one request whose size does NOT fall with the chunk budget. If " +
    "the head grows, that is the body that breaches and chunking harder cannot help"
);
check(
  "an unmeasurable request is counted and reported, not silently skipped",
  /unmeasured\+\+;/.test(writeFn) && /unmeasured \? /.test(writeFn),
  "a measurement that quietly measured three of four requests would understate " +
    "the total in the reassuring direction"
);
// THE SERIALIZER MATCHES THE CLIENT'S. defaultSerializer passes strings
// through; a blind JSON.stringify would double-quote an already-serialized
// value and report escaping the real request never applies.
//
// READ FROM chunkByBytes.ts, NOT FROM THE BUILDER. The reconstruction lived
// privately in pickersBuilder.ts until the SEC writes needed the same one, and
// a copied reconstruction is
// claude/traps/a-reconstruction-cannot-corroborate-its-source.md -- two copies
// drift and the drifted one is the one being read when the email arrives.
const measureFn = grab(helper, "chunkByBytes.ts", "setRequestBytes");
check(
  "the reconstruction passes strings through, as defaultSerializer does",
  measureFn !== null && /typeof value === "string" \? value : JSON\.stringify\(value\)/.test(measureFn),
  "#427 measured one object and could stringify unconditionally; this measures " +
    "four values and must not invent inflation the client would not produce"
);
check(
  "there is ONE reconstruction, and the builder imports it rather than keeping its own",
  grab(builder, "pickersBuilder.ts", "setRequestBytes") === null &&
    /setRequestBytes,/.test(builder),
  "a second copy in the builder would pass this section while the SEC writes " +
    "measured themselves with a different one"
);
check(
  "the no-TTL command is measurable, because the SEC writes have no TTL",
  measureFn !== null &&
    /ttlSeconds === undefined/.test(measureFn) &&
    /\["set", key, serialized\]/.test(measureFn),
  'secManifest.ts says NO TTL, EVER -- appending `"ex", undefined` would report ' +
    "bytes Upstash never receives, which is a reconstruction of something else"
);
check(
  "the reduced-payload fallback is still measured on its own single write",
  /logPayloadWriteSize\(entry, "reduced"\)/.test(builder),
  "it is the write that lands on a day the full one breaches, and it is still " +
    "a single v9 value, so #427's original question applies to it unchanged"
);

// ── 5. THE SEC WRITES, WHICH THIS FILE USED NOT TO LOOK AT ─────────────────
console.log("\n5. The SEC state writes are measured and guarded, not just the pickers one");

// WHY THIS SECTION EXISTS. secManifest.ts and secTickerMap.ts each do a single
// unchunked `redis.set` of a whole collection -- the pickersBuilder shape
// before #428 -- and neither appeared anywhere in this file. The header of
// secManifest.ts asserted the size was "comfortably inside" the ceiling; that
// assertion was never instrumented and nothing would have noticed if it stopped
// being true. §5 of claude/upstash-request-size-2026-09-11.md said to fix the
// pattern rather than the one firing site, and this is the missing half of it.
const secManifest = readCodeOnly("lib/server/secManifest.ts");
const secTickers = readCodeOnly("lib/server/secTickerMap.ts");

const writeManifestFn = grab(secManifest, "secManifest.ts", "writeManifest");
if (!writeManifestFn) {
  console.error("FAIL: could not extract writeManifest — this section would measure nothing.");
  process.exit(1);
}

check(
  "writeManifest measures the request body before it sends one",
  /trySetRequestBytes\(\s*SEC_MANIFEST_KEY/.test(writeManifestFn),
  "an over-limit SET returns an error rather than truncating, and the catch " +
    "below it swallows that — so without this the only detector is an Upstash " +
    "email naming a 15-minute window and no key"
);
check(
  "it measures the NO-TTL command, which is the one it actually sends",
  /trySetRequestBytes\(\s*SEC_MANIFEST_KEY,\s*value\s*\)/.test(writeManifestFn) &&
    !/trySetRequestBytes\(\s*SEC_MANIFEST_KEY,[^)]*,[^)]*\)/.test(writeManifestFn),
  'the file says NO TTL, EVER; passing a ttl here would measure `["set", k, v, ' +
    '"ex", n]` against a request that never carries it'
);
check(
  "it refuses an over-budget write rather than firing it",
  /bodyBytes > REQUEST_BYTE_BUDGET/.test(writeManifestFn) &&
    /return false;/.test(writeManifestFn),
  "the data outcome is identical either way — no write, previous value stands — " +
    "so the only thing refusing changes is that it is LOUD. Returning false is " +
    "what every caller already treats as 'not persisted'"
);
check(
  "the refusal is an error, not a warn or a log",
  /console\.error\(/.test(writeManifestFn),
  "a warn among 40 lines of job output is a line nobody greps for"
);
check(
  "the manifest write is not pipelined or issued concurrently",
  !/\.pipeline\(/.test(writeManifestFn) && !/Promise\.all/.test(writeManifestFn),
  "same reason as §2 — enableAutoPipelining defaults to TRUE, so a concurrent " +
    "write collapses into one body with whatever else is in flight"
);
check(
  "the ticker-map store is measured and guarded the same way",
  /trySetRequestBytes\(\s*TICKER_REDIS_KEY/.test(secTickers) &&
    /bodyBytes > REQUEST_BYTE_BUDGET/.test(secTickers) &&
    /console\.error\(/.test(secTickers),
  "lower risk on cadence (weekly, not daily) but the larger collection by 12x — " +
    "risk-ranking a write out of the guard is how the ranking stops being checked"
);
check(
  "both measurements come from the shared helper, not a local copy",
  /from "\.\/chunkByBytes"/.test(secManifest) && /from "\.\/chunkByBytes"/.test(secTickers),
  "a third and fourth copy of setRequestBytes would each be right on the day " +
    "they were written and drift separately after"
);

// ── THE PROJECTION, AND THE BOUND IT USES ──────────────────────────────────
//
// Sized against the TICKER MAP, not against ANALYSIS_UNIVERSE_CAP, and that is
// the load-bearing choice. `manifest.symbols` is a high-water mark: nothing
// deletes an entry, so the universe cap is not a bound on it at all. It is
// already past PRESET_UNIVERSE + MAX_DYNAMIC_UNIVERSE_SIZE.
const num = (src, name) =>
  Number((src.match(new RegExp(`${name} = ([0-9_]+)`)) ?? [])[1]?.replace(/_/g, "") ?? 0);

const measuredSymbols = num(secManifest, "SEC_MANIFEST_SYMBOLS_MEASURED");
const entryCeiling = num(secManifest, "SEC_MANIFEST_ENTRY_CEILING");
const tickerCount = num(secTickers, "TICKER_MAP_COUNT_MEASURED");
const presetCount = (
  readCodeOnly("lib/server/presetUniverse.ts").match(/"[A-Z.\-]+"/g) ?? []
).length;
const dynamicCap = num(readCodeOnly("lib/server/dynamicUniverseCache.ts"), "MAX_DYNAMIC_UNIVERSE_SIZE");

if (!measuredSymbols || !entryCeiling || !tickerCount || !dynamicCap) {
  console.error(
    `FAIL: could not read the measured manifest size (${measuredSymbols}), its ceiling ` +
      `(${entryCeiling}), the ticker count (${tickerCount}) or the dynamic cap ` +
      `(${dynamicCap}) — the projection below would be invented.`
  );
  process.exit(1);
}

check(
  "the measurements carry their own provenance",
  /SEC_MANIFEST_MEASURED_AT = "\d{4}-\d{2}-\d{2}"/.test(secManifest) &&
    /SEC_MANIFEST_MEASURED_SOURCE =/.test(secManifest) &&
    /TICKER_MAP_MEASURED_AT = "\d{4}-\d{2}-\d{2}"/.test(secTickers),
  "a bare 822 with no history is exactly as bad as a typed one — this file has " +
    "already been bitten by a residual nobody could date"
);
check(
  "the entry ceiling is the ticker map, not the universe cap",
  entryCeiling >= tickerCount && entryCeiling > presetCount + dynamicCap,
  `ceiling ${entryCeiling} against a universe cap of ${presetCount}+${dynamicCap}=` +
    `${presetCount + dynamicCap} — and the manifest ALREADY holds ${measuredSymbols}, ` +
    `which is past that cap. Sizing this write against the universe would size it ` +
    `against a number it has already exceeded`
);
check(
  "the measured entry count has outgrown the universe cap, which is why the ceiling differs",
  measuredSymbols > presetCount + dynamicCap,
  `${measuredSymbols} entries against a ${presetCount + dynamicCap} universe — ` +
    `nothing prunes manifest.symbols, so this gap only widens. If this ever goes ` +
    `red because the numbers converged, something started deleting entries and ` +
    `the ceiling argument above needs rewriting, not the constant`
);

// THE REAL CHUNKER AND THE REAL ENTRY SHAPE, rather than arithmetic here.
// emptyEntry() is lifted from the module so the per-entry floor is the module's
// own field set -- the same construction check-redis-bandwidth.mjs uses to keep
// a projection from drifting away from the code it projects.
const emptyEntryFn = grab(secManifest, "secManifest.ts", "emptyEntry");
if (!emptyEntryFn) {
  console.error("FAIL: could not extract emptyEntry — the per-entry floor would be a guess.");
  process.exit(1);
}
const entryMod = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(
      // transpileModule ERASES the annotations; a regex that tried to would eat
      // `lastAccession: null` along with `cik: string | null`, which it did on
      // the first attempt — the property values ARE colon-separated too.
      `const SEC_SCORE_VERSION = 1;\n${emptyEntryFn}\nexport { emptyEntry };`,
      { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
    ).outputText
  ).toString("base64")}`
);
const floorEntryBytes = Buffer.byteLength(
  JSON.stringify({ AAAA: entryMod.emptyEntry("0000320193", "Nasdaq") }),
  "utf8"
);

const escaping = Number((helper.match(/MEASURED_ESCAPING_INFLATION = ([0-9.]+)/) ?? [])[1] ?? 0);
check(
  "the escaping factor used for projections is measured, with provenance",
  escaping > 1 &&
    /MEASURED_ESCAPING_AT = "\d{4}-\d{2}-\d{2}"/.test(helper) &&
    /MEASURED_ESCAPING_SOURCE =/.test(helper),
  `x${escaping} — §4 of the brief reasoned about "a 15% inflation" and said ` +
    `plainly it was inference. #428's log reports the real figure every build`
);

const floorAtToday = Math.round(floorEntryBytes * measuredSymbols * escaping);
const floorAtCeiling = Math.round(floorEntryBytes * entryCeiling * escaping);

check(
  "at the measured entry count the manifest write is well inside the budget",
  floorAtToday < budget / 2,
  `${measuredSymbols} entries x ${floorEntryBytes}B floor = ` +
    `${(floorAtToday / 1024 / 1024).toFixed(2)}MB of body against a ` +
    `${(budget / 1024 / 1024).toFixed(0)}MB budget — the header's "comfortably inside" ` +
    `holds, and it is now a number rather than a sentence`
);
check(
  "a populated entry is bigger than the floor, so the floor is not read as the answer",
  floorEntryBytes > 0 && floorEntryBytes < 1000,
  `${floorEntryBytes}B is emptyEntry() — every nulled field above fills in as the ` +
    `pipeline runs (contentHash, accession, the w/y/c staleness trio), so a real ` +
    `manifest is a multiple of this. The floor is what can be derived from source ` +
    `WITHOUT guessing; the live figure comes from writeManifest's own log line`
);
check(
  "the guard is what covers the ceiling, because the projection there is not comfortable",
  floorAtCeiling > 0 && /bodyBytes > REQUEST_BYTE_BUDGET/.test(writeManifestFn),
  `${entryCeiling} entries x ${floorEntryBytes}B floor = ` +
    `${(floorAtCeiling / 1024 / 1024).toFixed(2)}MB of body BEFORE any field is ` +
    `populated, against a ${(budget / 1024 / 1024).toFixed(0)}MB budget and a ` +
    `${(planLimit / 1024 / 1024).toFixed(0)}MB limit. This is the assertion that ` +
    `says the refusal branch is load-bearing rather than defensive decoration`
);

console.log(
  failures === 0
    ? "\nAll request-size assertions hold.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
