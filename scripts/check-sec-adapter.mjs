// The SEC filings adapter and the committed CIK map.
//
// WHAT IS AT RISK. Four things, none of which break a build:
//   1. SELECTION. MU's real submissions feed is 25 filings of which 22 are Form
//      4 or 144. A newest-first cap of 20 silently drops the 10-Q and the
//      earnings 8-K — the only two a reader wants. This is the check that
//      would have caught it, and did.
//   2. fmpSymbolMatched. A CIK filing genuinely IS about the symbol, which makes
//      stamping it the tempting move. It would discard the whole Google News
//      feed for that symbol at the rankNews hard preference.
//   3. NO UNIVERSE SWEEP. 700 symbols of submissions on a schedule is the warm
//      cron the stored-dataset design exists to avoid.
//   4. The CIK map is hand-refreshed and trimmed to the universe, so its
//      integrity and its refresh trigger are both code, not convention.
//
// FIXTURE: sec-submissions-mu.json is a REAL data.sec.gov capture (CIK
// 0000723125, relay run 34766311251), trimmed to the fields the adapter reads.
// Its own _provenance header says so and carries the verified byte count.
//
//   node scripts/check-sec-adapter.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly, eventTypeSource } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const loadTs = async (source, tag) => {
  const file = path.join(ROOT, `.check-${tag}.mjs`);
  fs.writeFileSync(file, ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  try { return await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
  finally { fs.unlinkSync(file); }
};

// --------------------------------------------------------------- the adapter
let src = read("lib/server/news/secProvider.ts")
  .replace(/^import \{ eventTypeFromForm \} from "\.\/eventType";$/m, () => eventTypeSource())
  .replace(/^import cikMap from "@\/data\/cik-map\.json";$/m,
    () => `const cikMap = ${read("data/cik-map.json")};`)
  .replace(/^import \{ stripHtmlTags \} from ".\/text";$/m,
    () => read("lib/server/news/text.ts").replace(/^export /gm, ""))
  // The shared User-Agent, inlined rather than stubbed: sec.gov's fair-access
  // policy asks for identification, and a stub would let an empty one through
  // here. It has no imports of its own. scripts/check-news-user-agent.mjs owns
  // the assertions about the value itself.
  .replace(/^import \{ secUserAgent \} from ".\/userAgent";$/m,
    () => read("lib/server/news/userAgent.ts").replace(/^export /gm, ""))
  .replace(/^import type \{ NewsItem, NewsProvider \} from ".\/types";$/m, "")
  .replace("const CIK_BY_SYMBOL = cikMap as Record<string, string>;", "const CIK_BY_SYMBOL = cikMap;")
  .replace("export const secProvider: NewsProvider =", "export const secProvider =")
  .replace(/export function parseSubmissions\(\n  body: SubmissionsShape,\n  symbol: string,\n  nowMs = Date.now\(\)\n\): NewsItem\[\] \{/,
           "export function parseSubmissions(body, symbol, nowMs = Date.now()) {")
  .replace(/^type SubmissionsShape = \{[\s\S]*?^\};$/m, "")
  .replace(/  const out: NewsItem\[\] = \[\];/, "  const out = [];")
  .replace(/  const routine: boolean\[\] = \[\];/, "  const routine = [];")
  .replace(/  const selected: NewsItem\[\] = \[\];/, "  const selected = [];")
  .replace(/^async function fetchForSymbol\(\n  symbol: string,\n  _companyName: string,\n  _sinceIso: string \| null\n\): Promise<NewsItem\[\]> \{/m,
           "async function fetchForSymbol(symbol, _companyName, _sinceIso) {")
  .replace("async function fetchMarket(): Promise<NewsItem[]> {", "async function fetchMarket() {");
if (/^import /m.test(src)) {
  console.error("FAIL: an import survived inlining:\n" + src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
// Positive markers: a substitution that stops matching must be loud, not silent.
for (const [marker, why] of [
  ["function stripHtmlTags", "news/text was not inlined"],
  ["const cikMap = {", "data/cik-map.json was not inlined"],
  ["export function parseSubmissions(body, symbol", "the parseSubmissions signature was not de-typed"],
]) {
  if (!src.includes(marker)) { console.error(`FAIL: ${why} — a substitution stopped matching.`); process.exit(1); }
}
const sec = await loadTs(src, "sec");

const FIXTURE = JSON.parse(read("scripts/fixtures/sec-submissions-mu.json"));
// The newest filing in the capture is 2026-08-28; anchor "now" just past it so
// the 120-day window is exercised against real dates rather than a moving today.
const NOW = Date.parse("2026-08-29T00:00:00Z");
const items = sec.parseSubmissions(FIXTURE, "MU", NOW);

console.log("\n=== 1. Plain English from form + item codes ===\n");
check(
  "an 8-K with two item codes names both events",
  sec.filingTitle("8-K", "5.02,9.01") ===
    "Form 8-K — Item 5.02, officer appointment or departure; Item 9.01, financial statements and exhibits",
  JSON.stringify(sec.filingTitle("8-K", "5.02,9.01"))
);
check(
  "an earnings 8-K says results of operations, not '8-K'",
  sec.filingTitle("8-K", "2.02,9.01").includes("results of operations"),
  "this is the single most newsworthy filing shape and the bare form says nothing"
);
check(
  "a form with no item codes falls back to the form's own meaning",
  sec.filingTitle("10-Q", "") === "Form 10-Q — quarterly report" &&
    sec.filingTitle("4", "") === "Form 4 — insider transaction",
  "the items column is empty on every Form 4 and 144 in the real capture"
);
check(
  "an unknown item code degrades to the bare code rather than vanishing",
  sec.filingTitle("8-K", "9.99") === "Form 8-K — Item 9.99",
  "a code a reader can look up beats silence"
);
check(
  "an unknown form degrades to the bare form",
  sec.filingTitle("N-CSRS", "") === "Form N-CSRS"
);
check(
  "a blank form yields nothing at all, so the row is skipped",
  sec.filingTitle("", "") === "" && sec.filingTitle("   ", "9.01") === ""
);
check(
  "whitespace around item codes is tolerated",
  sec.filingTitle("8-K", " 2.02 , 9.01 ") === sec.filingTitle("8-K", "2.02,9.01"),
  "the real feed writes them unpadded, but one padded feed should not produce 'Item  2.02 '"
);

console.log("\n=== 2. Selection: 22 of MU's 25 real filings are insider paperwork ===\n");
const raw = FIXTURE.filings.recent;
const routineCount = raw.form.filter((f) => ["3", "4", "5", "144"].includes(f)).length;
check(
  "the fixture really is dominated by routine forms",
  routineCount === 22 && raw.form.length === 25,
  `${routineCount} of ${raw.form.length} are Form 3/4/5/144 — this is what makes newest-first the wrong rule`
);
check(
  "the 10-Q survives, though it sits at source position 21",
  items.some((i) => i.title.startsWith("Form 10-Q")),
  "a newest-first cap of 20 dropped it"
);
check(
  "the earnings 8-K survives, though it sits at source position 22",
  items.some((i) => i.title.includes("results of operations")),
  "same cap, same drop — the most valuable filing in the capture"
);
check(
  "routine paperwork is capped, not excluded",
  (() => {
    const n = items.filter((i) => /Form (3|4|5|144) —/.test(i.title)).length;
    return n > 0 && n <= 3;
  })(),
  `${items.filter((i) => /Form (3|4|5|144) —/.test(i.title)).length} insider rows kept of 22 available`
);
check(
  "the routine rows kept are the NEWEST ones",
  (() => {
    const kept = items.filter((i) => /Form (3|4|5|144) —/.test(i.title)).map((i) => i.pubDate.slice(0, 10));
    return kept.includes("2026-08-28") && !kept.includes("2026-06-11");
  })(),
  "capping must not also scramble which ones win"
);
check(
  "output is newest-first overall, material and routine interleaved by date",
  items.every((i, n) => n === 0 || Date.parse(items[n - 1].pubDate) >= Date.parse(i.pubDate)),
  "selection reorders internally; the result must still read chronologically"
);

console.log("\n=== 3. The 120-day window ===\n");
check(
  "filings past the window are dropped, those inside it kept",
  (() => {
    // 120 days before 2026-10-15 is 2026-06-17: the two 2026-06-11 rows fall out
    // and everything newer stays. A partial window discriminates where a total
    // one does not.
    const partial = sec.parseSubmissions(FIXTURE, "MU", Date.parse("2026-10-15T00:00:00Z"));
    return partial.length > 0 && partial.every((i) => i.pubDate >= "2026-06-17");
  })(),
  "the capture spans 2026-06-11 to 2026-08-28"
);
check(
  "...and past the whole span, nothing survives",
  sec.parseSubmissions(FIXTURE, "MU", Date.parse("2027-01-01T00:00:00Z")).length === 0,
  "at 2027-01-01 even the newest filing is 126 days old"
);
const edge = sec.parseSubmissions(FIXTURE, "MU", Date.parse("2026-08-28T00:00:00Z") + 120 * 86400000 - 1);
check(
  "...and one inside it by an hour is kept",
  edge.some((i) => i.pubDate.startsWith("2026-08-28")),
  "the boundary is the window, not an off-by-one"
);
check(
  "the window constant matches the other adapters",
  sec.SEC_STORE_MAX_AGE_DAYS === 120,
  "the store keeps 120 days; the page filters to 45"
);

console.log("\n=== 4. Item shape ===\n");
check("every item has a title", items.every((i) => i.title.length > 0));
check("provider is stamped", items.every((i) => i.provider === "sec"));
check("the source label is EDGAR", items.every((i) => i.source === "SEC EDGAR"));
check(
  "description is null on every row, by nature",
  items.every((i) => i.description === null),
  "a filing has no summary; the page renders the algorithmic line from lib/stock-news-templates.ts instead"
);
check(
  "guid is the accession number",
  items.every((i) => /^\d{10}-\d{2}-\d{6}$/.test(i.guid ?? "")),
  "stable across refetches, which is what the store dedups on"
);
check(
  "pubDate is a real ISO instant",
  items.every((i) => Number.isFinite(Date.parse(i.pubDate))),
  "the feed gives a bare date (2026-06-25) with no time; several rows have an EMPTY reportDate, which is why filingDate is what is read"
);
check(
  "the link points at the filing on sec.gov with the accession dashes stripped",
  (() => {
    const q = items.find((i) => i.title.startsWith("Form 10-Q"));
    return q?.link === "https://www.sec.gov/Archives/edgar/data/723125/000072312526000015/mu-20260528.htm";
  })(),
  items.find((i) => i.title.startsWith("Form 10-Q"))?.link
);
check(
  "the CIK in the link is UNPADDED, though the API's own CIK is padded",
  items.every((i) => /\/data\/723125\//.test(i.link)) && FIXTURE.cik === "0000723125",
  "the submissions endpoint needs CIK0000723125.json; the archive path needs /data/723125/ — same number, two spellings"
);
check(
  "a row with no accession number is skipped rather than linked to a broken path",
  sec.parseSubmissions(
    { cik: "0000723125", filings: { recent: { form: ["8-K"], filingDate: ["2026-08-26"], items: ["2.02"], accessionNumber: [""], primaryDocument: ["x.htm"] } } },
    "MU", NOW
  ).length === 0
);
check(
  "a submissions body with no filings at all yields [] rather than throwing",
  sec.parseSubmissions({}, "MU", NOW).length === 0 &&
    sec.parseSubmissions({ cik: "1", filings: { recent: {} } }, "MU", NOW).length === 0
);

console.log("\n=== 5. The fmpSymbolMatched decision — the same call as the wires ===\n");
// THE CALL: SEC items do NOT stamp it, and here the temptation is strongest,
// because a CIK filing genuinely IS about this symbol — better evidence than
// FMP's own match. It changes nothing, because the field is not a confidence
// score: rankNews treats symbol-confirmed as a HARD PREFERENCE, so if ANY item
// carries it the feed uses ONLY those items. One Form 4 would therefore discard
// every Google News story for that symbol — the strongest evidence in the stack
// producing the emptiest page.
check(
  "no SEC item sets fmpSymbolMatched or fmpSymbols",
  items.every((i) => i.fmpSymbolMatched === undefined && i.fmpSymbols === undefined),
  "see the comment above this check"
);
check(
  "...and neither appears anywhere in the adapter's code",
  !/fmpSymbolMatched\s*[:=]|fmpSymbols\s*[:=]/.test(readCodeOnly("lib/server/news/secProvider.ts")),
  "the runtime check above only sees the shapes this fixture produces"
);
check(
  "the attribution is carried in `tickers` instead",
  items.every((i) => JSON.stringify(i.tickers) === '["MU"]'),
  "structured, honest, and read by nothing that discards other items"
);
check(
  "the symbol is upper-cased on the way in",
  sec.parseSubmissions(FIXTURE, "mu", NOW).every((i) => i.tickers[0] === "MU")
);
check(
  "the field is INERT in rankNews — the premise of the decision above, restated",
  (() => {
    // THIS ASSERTION FIRED WHEN THE HARD PREFERENCE WAS REMOVED, which is
    // exactly what it was for: it read "the hard preference this avoids is
    // really in rankNews", and that premise stopped being true on 2026-09-14.
    // Deleting it would have left the decision above resting on a reason that
    // no longer exists. Restated to the premise that holds now.
    //
    // WHAT CHANGED. The exclusive branch turned out to be the outage: after the
    // provider flip only PRE-FLIP records could carry fmpSymbolMatched, so it
    // selected exactly those and discarded the whole free-stack feed. It is
    // gone, and the field orders nothing either — promoting on it today would
    // promote staleness. claude/traps/a-preference-that-filters.md.
    //
    // WHAT THE DECISION ABOVE RESTS ON NOW. Not "stamping would discard the
    // feed" — it would not, the branch is gone. It rests on the field being a
    // FOSSIL: nothing live writes it, and stamping it here is the event that
    // makes promotion safe to reconsider rather than something to do quietly.
    // scripts/check-news-relevance-scope.mjs owns that tripwire and fails from
    // both directions.
    const code = readCodeOnly("lib/stock-news-data.ts");
    const i = code.indexOf("function rankNews(");
    const body = code.slice(i, code.indexOf("\n}", i));
    return i >= 0 && body.length > 200 && !/articleMatchesRequestedSymbol|fmpSymbolMatched/.test(body);
  })(),
  "if rankNews starts reading the field again, the decision above is worth revisiting — " +
    "and so is scripts/check-news-relevance-scope.mjs, which asserts the inertness"
);

console.log("\n=== 6. Lazy only — no universe sweep, no cron ===\n");
const secSrc = readCodeOnly("lib/server/news/secProvider.ts");
check(
  "the adapter never reads the symbol universe",
  !/scan-universe|SCAN_UNIVERSE|getAllSymbols|universe/i.test(secSrc.replace(/^.*no CIK in data.*$/gm, "")),
  "a sweep is one line away here: the CIK map itself is a list of every symbol"
);
check(
  "fetchMarket requests nothing",
  /async function fetchMarket\(\)[^}]*\{\s*return \[\];\s*\}/.test(secSrc),
  "there is no cross-company filings feed worth polling; § 4 gives /headlines to the wires"
);
check(
  "exactly one fetch, and its URL is per-symbol by CIK",
  (secSrc.match(/await fetch\(/g) ?? []).length === 1 &&
    /data\.sec\.gov\/submissions\/CIK\$\{cik\}\.json/.test(secSrc)
);
check("revalidate 3600 is kept", /next: \{ revalidate: 3600 \}/.test(secSrc));
// WIRING ONLY. This used to pin the literal `process.env.SEC_USER_AGENT || "..."`
// shape inline, which broke the moment the default was moved into a shared
// module -- and would have kept passing had the module returned "". The VALUE
// assertions (non-empty under an unset, empty or whitespace variable; the env
// var still winning where it is set) are behavioural and live in
// scripts/check-news-user-agent.mjs, which can call the real function.
check(
  "a declared User-Agent is sent, via the shared helper",
  /"user-agent": secUserAgent\(\)/.test(secSrc),
  "fair access asks for identification; an anonymous request that works is still one that should not be made"
);
check(
  "...and the adapter no longer carries its own copy of the default",
  !/const userAgent = |function userAgent\(/.test(secSrc),
  "two UA literals is two strings that drift, and only one of them gets kept truthful"
);
const vercel = JSON.parse(read("vercel.json"));
check("still no news cron", (vercel.crons ?? []).filter((c) => /news/i.test(c.path)).length === 0);

console.log("\n=== 7. The committed CIK map ===\n");
const map = JSON.parse(read("data/cik-map.json"));
const entries = Object.entries(map);
check("the map is non-trivially populated", entries.length > 600, `${entries.length} entries, trimmed to the universe`);
check(
  "every CIK is a 10-digit zero-padded string",
  entries.every(([, v]) => typeof v === "string" && /^\d{10}$/.test(v)),
  "data.sec.gov/submissions/CIK{...}.json 404s on an unpadded CIK"
);
check(
  "every key is an upper-case symbol",
  entries.every(([k]) => /^[A-Z][A-Z.\-]{0,6}$/.test(k)),
  "lookups upper-case the symbol, so a lower-case key would be dead weight"
);
check("MU maps to Micron's real CIK", map.MU === "0000723125");
check(
  "a few more spot-check against their real CIKs",
  map.AAPL === "0000320193" && map.MSFT === "0000789019" && map.NVDA === "0001045810",
  "Apple, Microsoft, NVIDIA"
);
check(
  "share classes of one filer deliberately SHARE a CIK",
  map.GOOG === map.GOOGL && map.NWS === map.NWSA && map.GOOG === "0001652044",
  "a CIK identifies the filer, not the security — GOOG and GOOGL are one company and should show one filings feed"
);
check(
  "...and sharing is the exception, not the shape of the map",
  (() => {
    const byCik = new Map();
    for (const [, cik] of entries) byCik.set(cik, (byCik.get(cik) ?? 0) + 1);
    const shared = [...byCik.values()].filter((n) => n > 1).length;
    return shared > 0 && shared < entries.length * 0.05;
  })(),
  "14 shared CIKs of 695 symbols — share classes, ADR pairs, and preferreds/baby bonds filed by the parent (SOJC/SOJD/SOJE under Southern Co)"
);
check(
  "a symbol outside the map returns [] and logs the refresh trigger",
  await (async () => {
    const warn = console.warn;
    const lines = [];
    console.warn = (m) => lines.push(String(m));
    try {
      const out = await sec.secProvider.fetchForSymbol("ZZZZ", "Nothing Inc", null);
      return out.length === 0 && lines.some((l) => l.includes("[sec]") && l.includes("cik-map.json"));
    } finally { console.warn = warn; }
  })(),
  "the map is trimmed to the universe, so a NEW symbol entering it is exactly when the map needs regenerating — this log line is that trigger"
);
check(
  "a missing symbol makes NO network request",
  await (async () => {
    const real = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => { called = true; throw new Error("should not fetch"); };
    try {
      await sec.secProvider.fetchForSymbol("ZZZZ", "Nothing Inc", null);
      return !called;
    } finally { globalThis.fetch = real; }
  })(),
  "a cold miss must cost nothing, or a symbol off the map polls EDGAR on every request"
);

console.log("\n=== 8. sicDescription is NOT wired into sector selection ===\n");
check(
  "the adapter never READS sicDescription, though the response type declares it",
  !/\.sicDescription/.test(secSrc) && /sicDescription\?: string;/.test(secSrc),
  "measured 3% exact / 77% needing a mapping table / 20% unusable against lib/sectors.ts — see the PR body"
);
check(
  "...and nothing imports lib/sectors into it",
  !/from "@\/lib\/sectors"/.test(read("lib/server/news/secProvider.ts"))
);

console.log("\n=== 9. eventType (§7), implemented in step 6 ===\n");
check(
  "the 10-Q is an earnings item",
  items.find((i) => i.title.startsWith("Form 10-Q"))?.eventType === "earnings",
  "the periodic report IS the earnings disclosure"
);
check(
  "the Item 2.02 8-K is earnings from its ITEM CODE, not its form",
  items.find((i) => i.title.includes("results of operations"))?.eventType === "earnings",
  "every 8-K is 'a current report'; the item code is what says it is the numbers"
);
check(
  "insider paperwork is 'filing' — the truthful floor, not a guess",
  items.filter((i) => /Form (3|4|5|144) —/.test(i.title)).every((i) => i.eventType === "filing")
);
check(
  "EVERY SEC item carries an eventType; this leg never abstains",
  items.length > 0 && items.every((i) => i.eventType != null),
  "a filing is a filing whatever the form says, so there is no null case here"
);
check(
  "the derivation is the SHARED cascade, not a table restated in this adapter",
  /eventTypeFromForm\(/.test(secSrc) && !/ITEM_EVENT_TYPES|FORM_EVENT_TYPES/.test(secSrc),
  "§7's priority order split across three adapters is one nobody can read"
);

console.log("\n=== 10. Registered, and still off by default ===\n");
const index = readCodeOnly("lib/server/news/index.ts");
check(
  "secProvider is in FREE_PROVIDERS",
  /FREE_PROVIDERS[^=]*=\s*\[[^\]]*secProvider/.test(index)
);
check(
  "the default is free, and fmp is the explicit rollback",
  /process\.env\.NEWS_PROVIDER === "fmp" \? "fmp" : "free"/.test(index),
  "step 7 flipped it; an unrecognised value now falls back to free"
);

console.log("\n=== 11. THE DOT/DASH SPLIT, RE-LANDED ON THIS LOOKUP ===\n");

// BRK.B was one of eleven misses in relay run 47 and the only one that was
// OURS: BRK-B is in the map, BRK.B is not, and both spellings of one company
// live in this repo's own data. Same bug #448 fixed for taxonomy
// (claude/symbol-spelling-split-2026-09-12.md), different lookup.
check(
  "the dashed spelling is the one SEC and the map agree on",
  typeof map["BRK-B"] === "string" && map["BRK-B"].length === 10,
  "if this ever flips, the normalisation below is pointing the wrong way"
);
check(
  "...and the dotted spelling is NOT a key — normalisation, not a second entry",
  !("BRK.B" in map),
  "duplicating the row would double every dual-class name and still miss the next one"
);
check(
  "a dotted symbol resolves to the dashed CIK",
  sec.cikFor("BRK.B") === map["BRK-B"],
  "this is the whole fix; without it BRK.B has a permanently empty SEC leg"
);
check(
  "...and so does a lowercase, padded one — the same entry point normalises both",
  sec.cikFor("  brk.b ") === map["BRK-B"]
);
check(
  "an exact match still wins over any rewriting",
  (() => {
    // AGAINST THE REAL MAP THIS IS UNTESTABLE, and asserting it there was
    // decorative: no key both contains a dot and exists in its own right, so
    // the branch separating "exact first" from "rewrite first" is never taken
    // and a mutation swapping them survived. A crafted map is the only thing
    // that discriminates -- which is why cikFor takes one.
    const crafted = { "A.B": "0000000001", "A-B": "0000000002" };
    return sec.cikFor("A.B", crafted) === "0000000001" &&
      sec.cikFor("A-B", crafted) === "0000000002" &&
      // and the live map still behaves
      sec.cikFor("AOS") === map["AOS"] && sec.cikFor("MU") === map["MU"];
  })(),
  "a symbol that legitimately holds its own spelling must never be rewritten past itself"
);
check(
  "fetchForSymbol goes THROUGH the helper, not around it to the raw map",
  (() => {
    // The helper can be perfect and unused. Structural, because the adapter's
    // own fetch cannot be run here without the network.
    const code = readCodeOnly("lib/server/news/secProvider.ts");
    const at = code.slice(code.indexOf("async function fetchForSymbol"));
    const body = at.slice(0, 400);
    return /const cik = cikFor\(upper\)/.test(body) && !/CIK_BY_SYMBOL\[/.test(body);
  })(),
  "a normalisation the one caller bypasses is a normalisation that does nothing"
);
check(
  "a symbol in neither spelling still returns undefined, not a wrong CIK",
  sec.cikFor("ZZZZ.Z") === undefined && sec.cikFor("NOTATICKER") === undefined,
  "a fallback that invents a hit is worse than the miss it replaces"
);
check(
  "the rewrite is ONE-WAY: a dashed miss does not fall back to a dotted key",
  (() => {
    // The dashed spelling is canonical everywhere this repo stores data. A
    // two-way normalisation would make the dotted form look equally valid,
    // which is the habit that caused this in the first place.
    const code = readCodeOnly("lib/server/news/secProvider.ts");
    return /upper\.includes\("\."\)/.test(code) && !/replace\(\/-\/g, "\."\)/.test(code);
  })(),
  "one canonical spelling, one direction of tolerance"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
