// Step 7 of claude/news-adapter-spec-2026-09-13.md — the provider flip.
//
// WHAT IS AT RISK. Every one of these is silent:
//   1. THE ROLLBACK STOPS WORKING. NEWS_PROVIDER=fmp is the owner's flick-back:
//      re-adding one environment variable restores the old feed with no revert
//      commit and no code change (it does need a production redeploy for the
//      env read to see it — ~2 min, same commit). A typo in that one
//      comparison, or an adapter quietly deleted, and the rollback is a revert
//      instead — discovered at the moment it is needed.
//   2. THE FLIP NEVER HAPPENS. §8 names this outcome: something fails to
//      register and the site keeps calling FMP, which is the single thing this
//      migration exists to stop. Nothing throws. The page still renders.
//   3. THE SNAPSHOT IS NOT ACTUALLY READ. data/static-profile.json became
//      load-bearing here. If no call site reads it, every symbol whose cache
//      has expired silently loses its sector — no art bucket, and gone from its
//      sector page — and the committed file is 2,619 rows of dead weight.
//      GREPPING FOR THE IMPORT IS NOT ENOUGH: step 6b learned that an import
//      can be present and never called. These assertions RUN the lookup.
//   4. THE MISS LOG BECOMES A WALL. The refresh trigger is a log line, so it
//      only works if it is rare. The sector index resolves the whole universe;
//      one warn per symbol there buries the trigger in its own output.
//
//   node scripts/check-provider-flip.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ─────────────────────────────────────────────────── the registry, loaded
//
// The four adapter imports are replaced by stand-ins carrying nothing but their
// id, because the question here is WHICH providers the flag selects and never
// what they return. Each stand-in is named after the import it replaces, so a
// substitution that stops matching leaves an import behind and the guard below
// refuses to run rather than measuring a half-stubbed module.
const ADAPTERS = [
  ["fmpNewsProvider", "fmp"],
  ["gnewsProvider", "gnews"],
  ["wireProvider", "wire"],
  ["secProvider", "sec"],
];

let src = read("lib/server/news/index.ts");
for (const [binding, id] of ADAPTERS) {
  const re = new RegExp(`^import \\{ ${binding} \\} from "\\./[A-Za-z]+";$`, "m");
  if (!re.test(src)) {
    console.error(`FAIL: the import of ${binding} is not where this harness expects it.`);
    console.error("Either the adapter was removed (spec §9 forbids it) or the import shape changed.");
    process.exit(1);
  }
  // EACH STAND-IN CAN BE MADE TO FAIL, so the partial-failure contract below is
  // exercised rather than described. globalThis because the module is loaded
  // from its own file and cannot close over a local here.
  src = src.replace(
    re,
    `const ${binding} = { id: "${id}", fetchMarket: async () => [],\n` +
      `  fetchForSymbol: async () => {\n` +
      `    if (globalThis.__hanging?.has("${id}")) await new Promise((r) => setTimeout(r, 20000));\n` +
      `    if (globalThis.__failing?.has("${id}")) throw new Error("${id} is down");\n` +
      `    return [{ title: "from ${id}", link: "l-${id}", pubDate: null }];\n` +
      `  } };`
  );
}
src = src.replace(/^import type \{[\s\S]*?\} from "\.\/types";$/m, "");
// The timing helpers, inlined rather than stubbed. They are no-ops unless
// MSH_TIMING=1, so inlining the real ones proves the instrumentation cannot
// change what the fan-out returns -- which a stub would simply assume.
src = src.replace(
  /^import \{ beginTiming \} from "\.\.\/timing";$/m,
  fs.readFileSync(path.join(ROOT, "lib/server/timing.ts"), "utf8").replace(/^export /gm, "")
);

if (/^import /m.test(src)) {
  console.error("FAIL: an import survived stubbing — the module would not load:");
  console.error(src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}

const file = path.join(ROOT, ".check-providerflip.mjs");
fs.writeFileSync(file, ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let news;
try { news = await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
finally { fs.unlinkSync(file); }

/** Run `fn` with NEWS_PROVIDER set to `value`, or unset when value is null. */
const withEnv = (value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, "NEWS_PROVIDER");
  const prev = process.env.NEWS_PROVIDER;
  if (value === null) delete process.env.NEWS_PROVIDER;
  else process.env.NEWS_PROVIDER = value;
  try { return fn(); }
  finally {
    if (had) process.env.NEWS_PROVIDER = prev;
    else delete process.env.NEWS_PROVIDER;
  }
};
const idsUnder = (value) => withEnv(value, () => news.activeNewsProviders().map((p) => p.id).join("+"));

console.log("\n=== 1. THE DEFAULT IS FREE ===\n");
check(
  "NEWS_PROVIDER unset selects free",
  withEnv(null, () => news.newsProviderMode()) === "free",
  "this is the flip; the whole step is this one answer"
);
check(
  "...and the free adapters are what actually get returned",
  idsUnder(null) === "gnews+wire+sec",
  `unset -> ${idsUnder(null)}`
);
check(
  'NEWS_PROVIDER="free" says free too',
  withEnv("free", () => news.newsProviderMode()) === "free"
);

console.log("\n=== 2. THE ROLLBACK, WHICH IS THE POINT OF KEEPING FMP ===\n");
check(
  'NEWS_PROVIDER="fmp" selects the FMP adapter and nothing else',
  idsUnder("fmp") === "fmp",
  "one environment variable plus a redeploy, no revert commit — the owner's hard requirement"
);
check(
  "the FMP adapter is still in the tree and implements the interface",
  (() => {
    const adapter = readCodeOnly("lib/server/news/fmpProvider.ts");
    return /fetchForSymbol/.test(adapter) && /fetchMarket/.test(adapter) &&
      /export const fmpNewsProvider/.test(adapter);
  })(),
  "spec §9: do not delete or gut the FMP adapter"
);

console.log("\n=== 3. A TYPO MUST NOT LAND ON FMP ===\n");
// The comparison is deliberately asymmetric: it tests for "fmp", so everything
// else reads as free. Written the other way round -- testing for "free" with fmp
// as the fallback -- a misspelled variable would quietly serve FMP forever, and
// that is exactly the §8 failure this step is supposed to close.
for (const bad of ["FMP", "fmp ", "Free", "", "1", "true", "fmpp"]) {
  check(
    `NEWS_PROVIDER=${JSON.stringify(bad)} falls back to free, not fmp`,
    withEnv(bad, () => news.newsProviderMode()) === "free"
  );
}

console.log("\n=== 4. THE FEED WINDOW IS GATED, NOT GLOBAL ===\n");
check(
  "free gets 45 days",
  withEnv(null, () => news.feedMaxAgeDays()) === 45,
  "Google News backfills thin names: CYRX returned 56 items over 3,453 days"
);
check(
  "the fmp rollback gets 90 days back with it",
  withEnv("fmp", () => news.feedMaxAgeDays()) === 90,
  "a rollback that restored the feed but not its window would be a third state nobody asked for"
);
check(
  "the two windows are not the same number",
  news.FREE_FEED_MAX_AGE_DAYS !== news.NEWS_FEED_MAX_AGE_DAYS
);

console.log("\n=== 4b. PARTIAL ADAPTER FAILURE ===\n");
// THE CONTRACT HAS TWO HALVES AND ONLY ONE IS OBVIOUS.
//
// Promise.all lost two good windows to one bad one. allSettled fixes that, but
// a NAIVE allSettled breaks the other half: newsStore.ts has no try/catch around
// this call ON PURPOSE, so it reads a throw as "upstream failed, keep what is
// stored". Returning [] when every adapter failed would instead look like a
// successful empty fetch -- merge nothing, rewrite the key, count a refresh --
// and a populated store would decay toward empty on repeated failure.
//
// "No news exists" and "nobody answered" are different facts. Both halves run.
const failing = (ids, fn) => {
  globalThis.__failing = new Set(ids);
  try { return fn(); } finally { delete globalThis.__failing; }
};
const windowIds = async (down) =>
  (await failing(down, () => news.fetchSymbolNewsWindow("MU", "Micron", null))).map((i) => i.title);

check(
  "all three up: all three windows arrive",
  (await windowIds([])).join(",") === "from gnews,from wire,from sec"
);
check(
  "one adapter down: the other two still arrive",
  (await windowIds(["sec"])).join(",") === "from gnews,from wire",
  "a Form 4 feed being down is not a reason to lose the Google News feed"
);
check(
  "two adapters down: the survivor still arrives",
  (await windowIds(["sec", "wire"])).join(",") === "from gnews"
);
check(
  "ALL adapters down: it THROWS, it does not return []",
  await (async () => {
    try { await windowIds(["gnews", "wire", "sec"]); return false; }
    catch { return true; }
  })(),
  "[] would be written down as 'this symbol has no news' and evict a populated store"
);
check(
  "...and the throw names which adapters failed",
  await (async () => {
    try { await windowIds(["gnews", "wire", "sec"]); return false; }
    catch (err) { return /gnews/.test(err.message) && /sec/.test(err.message); }
  })(),
  "newsStore swallows this to serve stored items, so without the message an all-down upstream is invisible"
);
check(
  "the fan-out is allSettled, not all",
  /Promise\.allSettled\(/.test(readCodeOnly("lib/server/news/index.ts")) &&
    !/Promise\.all\(\s*$/m.test(readCodeOnly("lib/server/news/index.ts"))
);

console.log("\n=== 4c. A HANGING ADAPTER CANNOT HOLD THE RENDER ===\n");
// MEASURED, NOT HYPOTHETICAL. A cold /stock/AMD/news render on the preview took
// 71,133ms, of which the wire adapter was 70,630ms. The page waited seventy
// seconds for one source. This is the assertion that stops that returning.
const hanging = (ids, fn) => {
  globalThis.__hanging = new Set(ids);
  try { return fn(); } finally { delete globalThis.__hanging; }
};
check(
  "the timeout budget is a real number, and not so tight it cuts off a healthy source",
  news.ADAPTER_TIMEOUT_MS >= 2_000 && news.ADAPTER_TIMEOUT_MS <= 15_000,
  `${news.ADAPTER_TIMEOUT_MS}ms — the slowest healthy leg measured is Google News at 573ms in-render`
);
{
  const started = Date.now();
  const items = await hanging(["wire"], () => news.fetchSymbolNewsWindow("MU", "Micron", null));
  const elapsed = Date.now() - started;
  check(
    "a hanging adapter is abandoned, and the other two still arrive",
    items.map((i) => i.title).join(",") === "from gnews,from sec",
    `got [${items.map((i) => i.title).join(", ")}]`
  );
  check(
    "...and the wait is bounded by the budget, not by the hang",
    elapsed < news.ADAPTER_TIMEOUT_MS + 1_500,
    `${elapsed}ms against a ${news.ADAPTER_TIMEOUT_MS}ms budget`
  );
}
{
  // ALL THREE HANGING IS STILL A THROW, not an empty window -- the same
  // contract as an all-failure, for the same reason: an empty result would be
  // written down as "this symbol has no news".
  let threw = false;
  try { await hanging(["gnews", "wire", "sec"], () => news.fetchSymbolNewsWindow("MU", "Micron", null)); }
  catch { threw = true; }
  check("every adapter hanging throws rather than returning []", threw);
}

// HYGIENE, AND LABELLED AS SUCH. Dropping clearTimeout() is NOT behaviourally
// observable here -- the timer is unref'd so it holds nothing open, and a
// reject after the promise has settled is a no-op -- so no runtime assertion can
// catch it, and a mutation test found exactly that. It still leaves three
// pending timers per render for up to the full budget, so the intent is pinned
// here rather than left to be re-litigated.
check(
  "the timeout timer is cleared on both settle paths",
  (readCodeOnly("lib/server/news/index.ts").match(/clearTimeout\(timer\)/g) ?? []).length === 2,
  "one for resolve, one for reject; not observable at runtime, hence asserted on the source"
);

console.log("\n=== 5. AN EMPTY PROVIDER LIST STILL CANNOT EMPTY THE FEED ===\n");
check(
  "the guard is still there",
  /FREE_PROVIDERS\.length/.test(readCodeOnly("lib/server/news/index.ts")),
  "free is the default now, so an empty list would blank the news on EVERY page"
);

console.log("\n=== 6. THE SIC LEG IS READ BY RUNNING CODE, NOT JUST IMPORTED ===\n");
// 2026-09-23 (#552, COWORK #4): the FMP snapshot leg this section used to
// exercise is removed; a cache miss now resolves through SEC SIC.

// The lookup, loaded the same way check-static-profile.mjs loads it.
const spSrc = read("lib/server/staticProfile.ts")
  // The CIK map, which staticProfile gained when the coverage figures moved
  // there. Real data rather than a stub, for the same reason as the snapshot:
  // a stubbed map makes a coverage number that describes the stub.
  .replace(/^import cikMap from "@\/data\/cik-map.json";$/m,
    () => `const cikMap = ${read("data/cik-map.json")};`)
  // The SIC leg's two files (brief 2026-09-22 §2.4), real data again.
  .replace(/^import registrantsFile from "@\/data\/sec\/registrants.json";$/m,
    () => `const registrantsFile = ${read("data/sec/registrants.json")};`)
  .replace(/^import sicSectorFile from "@\/data\/sec\/sic-sector.json";$/m,
    () => `const sicSectorFile = ${read("data/sec/sic-sector.json")};`)
  // The spellings helper, handed over rather than stubbed — the same choice
  // check-static-profile.mjs makes, and for the same reason: there is exactly
  // one implementation of the dot/dash bridge and a stub would test a copy.
  .replace(/^import \{ lookupSpellingIn \} from "@\/lib\/symbolSpellings\.mjs";$/m,
    "const { lookupSpellingIn } = globalThis.__symbolSpellings;");
globalThis.__symbolSpellings = await import("../lib/symbolSpellings.mjs");
if (/^import /m.test(spSrc)) {
  // NAME THE SURVIVOR. This used to say "the snapshot JSON was not inlined",
  // which was a guess: the actual cause was a DIFFERENT import being added to
  // the module, and the message sent the reader to the one thing that was fine.
  console.error(
    "FAIL: an import survived inlining into staticProfile.ts:\n" +
      spSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n")
  );
  process.exit(1);
}
const spFile = path.join(ROOT, ".check-providerflip-sp.mjs");
fs.writeFileSync(spFile, ts.transpileModule(spSrc, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let sp;
try { sp = await import(`${pathToFileURL(spFile).href}?t=${Date.now()}`); }
finally { fs.unlinkSync(spFile); }

// bucketFor, which is what turns a resolved sector into a picture. Loaded so the
// end-to-end claim -- "empty cache still yields a bucket" -- is executed rather
// than asserted about.
const artSrc = read("lib/server/news/art.ts")
  .replace(/^import manifest from "@\/public\/news-art\/manifest.json";$/m,
    () => `const manifest = ${read("public/news-art/manifest.json")};`)
  .replace(/^import type \{ EventType \} from "\.\/eventType";$/m, "");
// LOADED, NOT OPTIONAL. An earlier draft swallowed a load failure into
// `art = null` and let the assertion below pass on `true` — which is the
// assertion-that-cannot-fail trap, and it fired immediately: art.ts loaded on
// none of the first three attempts and the check reported PASS every time.
if (/^import /m.test(artSrc)) {
  console.error("FAIL: an import survived inlining into art.ts:");
  console.error(artSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
const artFile = path.join(ROOT, ".check-providerflip-art.mjs");
fs.writeFileSync(artFile, ts.transpileModule(artSrc, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let art;
try { art = await import(`${pathToFileURL(artFile).href}?t=${Date.now()}`); }
finally { fs.unlinkSync(artFile); }

// The label -> slug mapping, from the same module the pages use. Reimplementing
// it here would let this harness agree with itself while disagreeing with the site.
const sectorsSrc = read("lib/sectors.ts");
if (/^import /m.test(sectorsSrc)) {
  console.error("FAIL: lib/sectors.ts gained an import this harness does not inline.");
  process.exit(1);
}
const sectorsFile = path.join(ROOT, ".check-providerflip-sectors.mjs");
fs.writeFileSync(sectorsFile, ts.transpileModule(sectorsSrc, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
let sectorSlugFromLabel;
try { ({ sectorSlugFromLabel } = await import(`${pathToFileURL(sectorsFile).href}?t=${Date.now()}`)); }
finally { fs.unlinkSync(sectorsFile); }

const quiet = (fn) => {
  const warn = console.warn;
  const lines = [];
  console.warn = (...a) => lines.push(a.join(" "));
  try { return { value: fn(), lines }; } finally { console.warn = warn; }
};

// A symbol with a SIC row, so the interesting case is a cache miss.
const snapshotSymbol = "AAPL";

check(
  `an empty cache row still resolves ${snapshotSymbol}, through SEC SIC`,
  quiet(() => sp.resolveProfile(snapshotSymbol, null)).value.source === "sic",
  "before step 7 the cache always refilled itself from FMP; there is no such call left"
);
// END TO END, because this is the actual claim of the step: a symbol whose FMP
// cache has gone, resolved from the committed file, still reaches a picture.
// Asserted against a bucket bucketFor really returns rather than against a
// hardcoded slug, since the bucket names are art.ts's business, not this file's.
const resolvedSnap = quiet(() => sp.resolveProfile(snapshotSymbol, null)).value;
check(
  `...and ${snapshotSymbol}'s SIC sector reaches a real art bucket`,
  Boolean(art.bucketFor(sectorSlugFromLabel(resolvedSnap.sector), resolvedSnap.industry)),
  `sector=${resolvedSnap.sector} industry=${resolvedSnap.industry} -> ` +
    `${art.bucketFor(sectorSlugFromLabel(resolvedSnap.sector), resolvedSnap.industry)}`
);
check(
  "...but a cached sector still WINS over SIC",
  sp.resolveProfile(snapshotSymbol, { sector: "Utilities" }).sector === "Utilities",
  "the snapshot is a floor, not an override — a reclassification must land without a redeploy"
);
check(
  "...and a symbol in NEITHER leg reaches none, rather than a default one",
  art.bucketFor(sectorSlugFromLabel(quiet(() => sp.resolveProfile("ZZZZNOTREAL", null)).value.sector), null) === null,
  "a default bucket would put a confidently wrong picture on every unknown symbol"
);

// THE CALL SITES. Read as code with comments stripped, and each one asserted to
// both import the lookup AND pass its result onward -- step 6b's lesson was that
// a source-text grep is satisfied by an import nothing calls, so each check
// below names the variable the result has to flow into.
for (const [file, fn, sink] of [
  ["app/stock/[symbol]/news/page.tsx", "resolveProfile", "bucketFor"],
  ["lib/server/internalNews.ts", "resolveProfile", "bucketFor"],
  ["lib/server/sectorUniverse.ts", "resolveProfileBulk", "sectorSlugFromLabel"],
]) {
  const code = readCodeOnly(file);
  const assigned = new RegExp(`const (\\w+) = ${fn}\\(`).exec(code);
  const flows = assigned
    ? new RegExp(`${sink}\\([\\s\\S]{0,200}?\\b${assigned[1]}\\b`).test(code) ||
      new RegExp(`\\b${assigned[1]}\\b[\\s\\S]{0,200}?${sink}\\(`).test(code)
    : false;
  check(
    `${file} calls ${fn} and feeds ${sink}`,
    Boolean(assigned) && flows,
    assigned ? "" : `no "const x = ${fn}(" in this file — an import alone renders nothing`
  );
  check(
    `...and ${file} no longer reads the cached sector straight through`,
    !/sectorSlugFromLabel\((?:fund|fundamentals|scr|screener)[?.]/.test(code),
    "the cached read bypassing the snapshot is the regression this step exists to prevent"
  );
}

console.log("\n=== 7. THE MISS LOG IS A TRIGGER, NOT A WALL ===\n");
const MISSES = ["ZZZZNOTREAL1", "ZZZZNOTREAL2", "ZZZZNOTREAL3", "ZZZZNOTREAL4"];
const single = quiet(() => sp.resolveProfile("ZZZZNOTREAL1", null));
check(
  "one miss on the per-symbol path logs once, and names the symbol",
  single.lines.length === 1 && single.lines[0].includes("ZZZZNOTREAL1") &&
    single.lines[0].includes("[static-profile]"),
  `${single.lines.length} line(s)`
);
check(
  "...and it makes no network request",
  !/\bfetch\(/.test(readCodeOnly("lib/server/staticProfile.ts")),
  "a miss on every render is a request storm; the whole design is that it is not"
);
const bulk = quiet(() =>
  sp.resolveProfileBulk(MISSES.map((symbol) => ({ symbol, cached: null })), "test")
);
check(
  `${MISSES.length} misses on the bulk path log ONCE, not ${MISSES.length} times`,
  bulk.lines.length === 1,
  `${bulk.lines.length} line(s) — the sector index resolves the whole universe; a per-symbol warn buries the trigger`
);
check(
  "...and that one line carries the COUNT, which is the signal",
  // MATCHED AS "N of M symbols", not as a bare digit. The first version tested
  // `includes("4")` and a mutation that removed the count entirely still passed,
  // because the trailing "First 4:" supplied a 4.
  new RegExp(`\\b${MISSES.length} of ${MISSES.length} symbols\\b`).test(bulk.lines[0] ?? ""),
  bulk.lines[0] ?? "(nothing logged)"
);
check(
  "a bulk call with no misses is silent",
  quiet(() => sp.resolveProfileBulk([{ symbol: snapshotSymbol, cached: null }], "test")).lines.length === 0,
  "a trigger that fires on every rebuild is not a trigger"
);
check(
  "the bulk path still resolves, it does not merely count",
  bulk.value.size === MISSES.length &&
    [...bulk.value.values()].every((r) => r.source === "none" && r.sector === null),
  "counting misses while returning nothing would be a silent blank"
);

console.log("\n=== 8. THE FLIP IS VISIBLE WITHOUT READING A LOG ===\n");
// §8 asks for this by name: the step-7 failure is that something fails to
// register and the site silently keeps calling FMP. A log line nobody reads is
// not enough, so the active provider goes on the cache-health page.
const health = readCodeOnly("app/cache-health/page.tsx");
check(
  "/cache-health reads the active mode",
  /newsProviderMode\(\)/.test(health) && /activeNewsProviders\(\)/.test(health),
  "spec §8: make it visible, because this failure mode renders perfectly"
);
check(
  "...and renders it, rather than computing it and dropping it",
  // AS A TEXT CHILD. `/\{newsMode\b/` was satisfied by `{newsMode === "fmp" ?
  // ... }` in the border colour, so deleting the only place the mode is actually
  // printed left the check passing. It has to be between two tags.
  />\{newsMode\}</.test(health) && /\{newsAdapters\.join\(/.test(health)
);
check(
  "...and it does not cost a request",
  !/await\s+newsProviderMode|await\s+activeNewsProviders/.test(health),
  "both are synchronous reads — an env lookup and a module-level array"
);

console.log("\n=== 9. THE SPENT PROBE IS GONE ===\n");
check(
  "app/api/debug/news-sources is deleted",
  !fs.existsSync(path.join(ROOT, "app/api/debug/news-sources")),
  "the spec's own header says to delete it once this ships"
);
check(
  "...and nothing still points at it as if it were live",
  // NO TRAILING BACKTICK IN THE PATTERN. The first version required one
  // immediately after the path, and the real citation reads
  // `app/api/debug/news-sources/route.ts` — so restoring the citation verbatim
  // walked straight through the check.
  !/news-sources/.test(read("claude/news-api-market-survey-2026-09-13.md")),
  "a dead route cited as the source of a measurement is a measurement nobody can re-run"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
