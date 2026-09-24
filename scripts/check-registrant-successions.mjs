// REGISTRANTS FOLLOW RENAMES; SUCCESSIONS ARE FLAGGED, NOT LINKED (#552 COWORK #36).
//
//   1. planRenames (lib/server/secRegistrantRenames.ts): a row whose ticker
//      left the ticker file moves to the ONE new ticker its CIK is listed
//      under; share-class siblings (GOOG/GOOGL) are untouched; two candidates
//      are reported, never guessed. MUTATION: the one-candidate rule removed.
//   2. The refresh applies it: the old ticker stays as an alias row
//      (`aliasOf`) and aliases are never re-fetched as rows of their own.
//   3. successionFlags (lib/server/secSuccessionFlags.ts), XOM-shaped: an
//      8-K12B by an untracked "ExxonMobil Holdings Corp" and a 25-NSE for
//      tracked "EXXON MOBIL CORP" a day apart → one flag. Outside the window,
//      the same CIK, a different name, or a pair already cited → no flag.
//      MUTATION: the window removed.
//   4. NOT LINKED: the detector never touches the cited successor list, and
//      the list is read from the committed file alone. MUTATION: an
//      auto-link written into secSuccession → caught.
//   5. The daily-index job feeds it the rows it already has, at no Redis
//      cost on a quiet day.
//
//   node scripts/check-registrant-successions.mjs
import "./lib/register-ts-here.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

console.log("1. renames follow the CIK");
const RSRC = readCodeOnly("lib/server/secRegistrantRenames.ts");
const loadR = (src) => lift([grabFunction(src, "pad"), grabFunction(src, "planRenames"), "export { planRenames };"].join("\n"));
const R = await loadR(RSRC);
const ROWS = { BK: { cik: "0000001390" }, GOOGL: { cik: "0001652044" }, GOOG: { cik: "0001652044" }, OLDX: { cik: "0000000003" }, AAPL: { cik: "0000320193" } };
const TICKERS = new Map([["BNY", "1390"], ["GOOGL", "1652044"], ["GOOG", "1652044"], ["NEWY", "3"], ["NEWZ", "3"], ["AAPL", "320193"]]);
const plan = R.planRenames(ROWS, TICKERS);
check("BK (gone from the ticker file) moves to BNY, its CIK's one new ticker", plan.renames.length === 1 && plan.renames[0].from === "BK" && plan.renames[0].to === "BNY", JSON.stringify(plan.renames));
check("share-class siblings still listed (GOOG/GOOGL) and unchanged tickers are untouched", !plan.renames.some((r) => ["GOOG", "GOOGL", "AAPL"].includes(r.from)));
check("a CIK under two new tickers is reported, not guessed", plan.ambiguous.length === 1 && plan.ambiguous[0].candidates.join() === "NEWY,NEWZ");
check("an alias row is never renamed again", R.planRenames({ ...ROWS, BK: { cik: "0000001390", aliasOf: "BNY" }, BNY: { cik: "0000001390" } }, TICKERS).renames.length === 0);
{
  const M = await loadR(once(RSRC, "if (candidates.length === 1) renames.push", "if (candidates.length >= 1) renames.push"));
  check("MUTATION: the one-candidate rule removed → OLDX guessed onto a ticker (caught)", M.planRenames(ROWS, TICKERS).renames.some((r) => r.from === "OLDX"));
}

console.log("\n2. the refresh applies it");
const REF = readCodeOnly("scripts/sec-registrants.mjs");
check("renames are planned by the shipped rule", /renameMod\.planRenames\(previous\.rows \?\? \{\}, new Map\(\[\.\.\.tickerMap\]\.map\(\(\[t, e\]\) => \[t, e\.cik\]\)\)\)/.test(REF));
check("the old ticker is kept as an alias row of the new one", /rows\[r\.from\] = \{ \.\.\.rows\[r\.to\], aliasOf: r\.to \}/.test(REF));
check("aliases and renamed-from tickers are not fetched as rows of their own", /\.filter\(\(sym\) => !renamedFrom\.has\(sym\) && !aliasSyms\.has\(sym\)\)/.test(REF));
check("carried aliases are refreshed from their target", /rows\[a\] = \{ \.\.\.rows\[prev\.aliasOf\], aliasOf: prev\.aliasOf \}/.test(REF));

console.log("\n3. successions, XOM-shaped");
const S = await import("../lib/server/secSuccessionFlags.ts");
const idx = [
  { cik: "2115436", company: "ExxonMobil Holdings Corp", form: "8-K12B", filed: "2026-07-01" },
  { cik: "34088", company: "EXXON MOBIL CORP", form: "25-NSE", filed: "2026-07-02" },
  { cik: "320193", company: "Apple Inc.", form: "8-K", filed: "2026-07-02" },
];
const tracked = new Map([["0000034088", "XOM"], ["34088", "XOM"], ["0000320193", "AAPL"], ["320193", "AAPL"]]);
const ev = S.successionEventsOf(idx, tracked);
check("the index rows become one 8-K12B (untracked) and one 25-NSE (tracked XOM)", ev.length === 2 && ev.some((e) => e.kind === "25-NSE" && e.symbol === "XOM"), JSON.stringify(ev));
check("names normalise alike: 'ExxonMobil Holdings Corp' = 'EXXON MOBIL CORP'", S.normalizeFilerName("ExxonMobil Holdings Corp") === S.normalizeFilerName("EXXON MOBIL CORP"));
const flags = S.successionFlags(ev);
check("one flag: XOM, successor 0002115436 ← predecessor 0000034088, with both dates",
  flags.length === 1 && flags[0].symbol === "XOM" && flags[0].successorCik === "0002115436" && flags[0].predecessorCik === "0000034088"
  && flags[0].eightK12b === "2026-07-01" && flags[0].nse25 === "2026-07-02", JSON.stringify(flags));
check("already on the cited list → not flagged again", S.successionFlags(ev, new Set(["0000034088"])).length === 0);
check("outside the window (8-K12B 40 days earlier) → no flag", S.successionFlags(ev.map((e) => e.kind === "8-K12B" ? { ...e, date: "2026-05-23" } : e)).length === 0);
check("a different name → no flag", S.successionFlags(ev.map((e) => e.kind === "8-K12B" ? { ...e, name: "Chevron Holdings Corp" } : e)).length === 0);
{
  const FS = readCodeOnly("lib/server/secSuccessionFlags.ts");
  const M = await lift([grabFunction(FS, "normalizeFilerName"), grabFunction(FS, "successionFlags"),
    `const SUFFIX = ${FS.match(/const SUFFIX = (\/.*\/g);/)[1]};`, "const days = (a, b) => Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;",
    "const pad = (c) => String(c).replace(/\\D/g, \"\").padStart(10, \"0\");", "const SUCCESSION_WINDOW_DAYS = 100000;", "export { successionFlags };"].join("\n"));
  check("MUTATION: the window removed → the 40-days-earlier pair is flagged (caught)", M.successionFlags(ev.map((e) => e.kind === "8-K12B" ? { ...e, date: "2026-05-23" } : e)).length === 1);
}

console.log("\n4. flagged, never linked");
const FLAGS_SRC = readCodeOnly("lib/server/secSuccessionFlags.ts");
const SUCC_SRC = readCodeOnly("lib/server/secSuccession.ts");
const notLinked = (flagsSrc, succSrc) => !/successor-ciks|writeFile|mergeSuccession|withPredecessorFacts/.test(flagsSrc)
  && /const BY_CIK = new Map<number, Succession>\(\s*\(successorsFile\.successors as Succession\[\]\)\.map\(\(s\) => \[Number\(s\.cik\), s\]\)\s*\);/.test(succSrc)
  && !/secSuccessionFlags|succession-flags/.test(succSrc);
check("the detector never touches the cited list; the list is the committed file alone", notLinked(FLAGS_SRC, SUCC_SRC));
check("MUTATION: an auto-link added to secSuccession (flags merged into BY_CIK) → caught",
  !notLinked(FLAGS_SRC, SUCC_SRC.replace("const BY_CIK = new Map<number, Succession>(", "const BY_CIK = new Map<number, Succession>([...readFlags(\"msh:sec:succession-flags:v1\"), ")));

console.log("\n5. the daily-index job");
const JOB = readCodeOnly("app/api/jobs/sec-daily-index/route.ts");
check("events are taken from the parsed rows already in hand", /successionEvents\.push\(\.\.\.successionEventsOf\(res\.parsed\.rows, bySymbolCik\)\)/.test(JOB));
check("recorded once per run, excluding the cited list", /await recordSuccessionEvents\(successionEvents, latest, CITED_PREDECESSOR_CIKS\)/.test(JOB));
check("no Redis on a quiet day: the store returns before any command when there are no events",
  /if \(!redis \|\| !fresh\.length\) return \[\];/.test(FLAGS_SRC));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
