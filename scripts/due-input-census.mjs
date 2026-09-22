// CAN THE DUE STRIP ACTUALLY RENDER A ROW? Measured before the producer is built.
//
// ── WHY THIS RUNS BEFORE THE BUILD, NOT AFTER ─────────────────────────────
// lib/server/dueToReport.ts defines DueInput and nothing constructs one. The
// obvious next step is to write the producer -- but three of DueInput's five
// fields cannot be read from the store as it stands, and whether that matters
// is a question about PRODUCTION DATA, not about the type:
//
//   periodEnd       stored, as StoredReportDates.nextPeriodEnd
//   medianLagDays   ONLY EXISTS WHEN next.kind === "date". The estimator
//                   refuses a date for an irregular filer and returns
//                   {kind:"month"} or {kind:"none"} instead, and neither
//                   carries a lag. So this is a COVERAGE question with an
//                   unknown answer, not a lookup.
//   filerCategory   NOT STORED ANYWHERE. deadlineDays() needs it.
//   annual          NOT STORED EITHER, and nothing in the brief noticed --
//                   deadlineDays(category, annual) takes both, and the
//                   annual cells are 60/75/90 against 40/45 for quarters.
//
// Building a producer against fields that turn out to be absent for most of the
// cut produces a strip that resolves to "unavailable" forever and a check suite
// that passes on synthetic inputs while proving nothing about the page. That is
// the exact failure this build has been correcting elsewhere, so the denominator
// is measured first.
//
// ── THE FILER-CATEGORY QUESTION IS SETTLED BY ARITHMETIC, NOT BY ARGUMENT ─
// Two options were on the table: fetch submissions live in the producer, or
// store the category on the record. Rather than reason about which is cleaner,
// this probe fetches the TRUE category for each symbol in the cut and runs
// selectDue() twice -- once with it, once with null (the DEADLINE_FALLBACK path
// a producer that cannot read it would take) -- and reports how many symbols
// the two disagree about.
//
// A live fetch HERE is fine and a live fetch IN THE PRODUCER is the thing under
// debate: this is a one-off measurement on a runner, that would be per-render.
//
// Read-only. Issues GETs against Redis and SEC; writes nothing.
//   relay task: write-due-input-census   (credentialled for the READ; no writes)
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly, grabConst } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; due-input census)";
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);

// ── THE SHIPPED FUNCTIONS, LIFTED. NOT REIMPLEMENTED. ─────────────────────
// A probe with its own copy of selectDue measures the copy. The whole question
// is what the SHIPPED selector does with the SHIPPED store, so both are lifted
// out of the .ts sources and the answer is about the code that will run.
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");

// ── THE DEADLINE TABLE IS GRABBED, NOT THE WHOLE MODULE ───────────────────
// The first version concatenated secReportDates.ts entire, because dueToReport
// imports deadlineDays from it. Both files declare `const DAY = 86_400_000` at
// top level, so the unit failed to compile with "Identifier 'DAY' has already
// been declared" -- a collision that exists ONLY in a harness that concatenates
// them, and one scripts/lib/render-snapshot.mjs already hit and documented for
// the same two-modules-one-common-name reason.
//
// So only the three declarations deadlineDays actually closes over come across.
// Grabbing keeps the surface at what is used and cannot pick up a second DAY.
const rdFile = "lib/server/secReportDates.ts";
const rdSrc = readCodeOnly(rdFile);
const deadlinePieces = [
  grabConst(rdFile, "FILING_DEADLINE_DAYS"),
  grabConst(rdFile, "DEADLINE_FALLBACK"),
  grabFunction(rdSrc, "deadlineDays"),
];
if (deadlinePieces.some((x) => !x)) {
  console.error("FATAL: could not grab the deadline table out of secReportDates.ts — it was renamed or restructured.");
  process.exit(2);
}
const due = await lift(
  deadlinePieces.join("\n").replace(/^export /gm, "") +
    "\n" + strip("lib/server/dueToReport.ts").replace(/export (const|function|type)/g, "$1") +
    "\nexport { selectDue, deadlineDays, DUE_LEAD_DAYS, OVERDUE_GRACE_DAYS };",
  "", "dueToReport"
);
const state = await lift(
  strip("lib/server/dueStripState.ts").replace(/export (const|function|type)/g, "$1") +
    "\nexport { resolveDueStrip, MIN_COVERAGE_TO_CLAIM_EMPTY, dueRowLabel };",
  "", "dueStripState"
);

const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const PICKERS_SYMBOLS_KEY = keyOf("lib/server/pickersBuilder.ts", "PICKERS_SYMBOLS_KEY");
const DATES_PREFIX = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");

// THE COMMITTED LIST, read from the file the strip will read. If this probe
// hand-typed a top 50 it would be measuring a different cut from the one that
// ships, which is the whole reason the list is committed.
const CUT_FILE = "data/due-strip.json";
if (!fs.existsSync(CUT_FILE)) {
  console.error(`FATAL: ${CUT_FILE} is not committed on this ref. The cut is the input; there is nothing to census without it.`);
  process.exit(2);
}
const cutDoc = JSON.parse(fs.readFileSync(CUT_FILE, "utf8"));
const CUT = cutDoc.symbols;
console.log(`cut: ${CUT.length} symbols from ${CUT_FILE} (generatedAt ${cutDoc.generatedAt}) · today ${TODAY}\n`);

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest — cannot compute the universe denominator."); process.exit(2); }
const universe = Object.keys(manifest.symbols);

// ── 1. THE CUT, SYMBOL BY SYMBOL ──────────────────────────────────────────
const rows = [];
for (const symbol of CUT) {
  const rec = await redis.get(`${DATES_PREFIX}:${symbol.toUpperCase()}`);
  rows.push({
    symbol,
    hasRecord: Boolean(rec && typeof rec === "object"),
    events: Array.isArray(rec?.events) ? rec.events.length : 0,
    nextPeriodEnd: rec?.nextPeriodEnd ?? null,
    nextKind: rec?.next?.kind ?? null,
    nextReason: rec?.next?.kind === "none" ? rec.next.reason : null,
    medianLagDays: rec?.next?.kind === "date" ? rec.next.medianLagDays : null,
    cik: rec?.cik ?? manifest.symbols[symbol]?.cik ?? null,
    at: rec?.at ?? null,
  });
}

const n = (p) => rows.filter(p).length;
console.log("1. WHAT THE STORE HOLDS FOR THE CUT (denominator beside every counter)");
console.log(`   record present                ${n((r) => r.hasRecord)}/${CUT.length}`);
console.log(`   nextPeriodEnd non-null        ${n((r) => r.nextPeriodEnd)}/${CUT.length}`);
console.log(`   next.kind === "date"          ${n((r) => r.nextKind === "date")}/${CUT.length}   <- the only kind carrying medianLagDays`);
console.log(`     ... kind "month"            ${n((r) => r.nextKind === "month")}`);
console.log(`     ... kind "none"             ${n((r) => r.nextKind === "none")}`);
console.log(`     ... no record at all        ${n((r) => !r.hasRecord)}`);
console.log(`   BOTH periodEnd AND a lag      ${n((r) => r.nextPeriodEnd && r.medianLagDays != null)}/${CUT.length}   <- a DueInput is constructible for these and no others`);

const noneReasons = {};
for (const r of rows) if (r.nextReason) noneReasons[r.nextReason] = (noneReasons[r.nextReason] ?? 0) + 1;
if (Object.keys(noneReasons).length) {
  console.log("   why 'none':");
  for (const [why, c] of Object.entries(noneReasons)) console.log(`     ${String(c).padStart(3)}  ${why}`);
}

// ── 2. THE TRUE FILER CATEGORY, FETCHED ONCE, FOR THE COST COMPARISON ─────
console.log("\n2. FILER CATEGORY — fetched live HERE only, to price the two options");
let lastAt = 0;
const MIN_GAP_MS = 110;
async function submissions(cik) {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const catOf = new Map();
let fetched = 0, fetchFailed = 0;
for (const r of rows) {
  if (!r.cik) continue;
  try {
    const subs = await submissions(String(r.cik).padStart(10, "0"));
    catOf.set(r.symbol, typeof subs?.category === "string" ? subs.category : null);
    fetched++;
  } catch (err) {
    fetchFailed++;
    console.warn(`   ${r.symbol}: submissions fetch failed — ${String(err?.message ?? err)}`);
  }
}
const tally = {};
for (const [, c] of catOf) tally[c ?? "(null/absent)"] = (tally[c ?? "(null/absent)"] ?? 0) + 1;
console.log(`   fetched ${fetched}/${CUT.length} (${fetchFailed} failed). Categories present:`);
for (const [c, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`     ${String(count).padStart(3)}  ${c}  ->  quarter ${due.deadlineDays(c === "(null/absent)" ? null : c, false)}d · annual ${due.deadlineDays(c === "(null/absent)" ? null : c, true)}d`);
}

// ── 3. DOES IT CHANGE THE ANSWER? selectDue TWICE, ONE FIELD APART ────────
//
// The overdue cap is the ONLY place filerCategory is read, so the two runs can
// differ in exactly one way: a symbol the fallback keeps and the true category
// drops, or vice versa. Anything else would be a bug in this comparison.
//
// `annual` is NOT known either, so both runs pass the same value for it and
// the comparison isolates the category. Its own cost is reported separately.
const buildInputs = (withCategory, annual) =>
  rows
    .filter((r) => r.nextPeriodEnd && r.medianLagDays != null)
    .map((r) => ({
      symbol: r.symbol,
      periodEnd: r.nextPeriodEnd,
      medianLagDays: r.medianLagDays,
      filerCategory: withCategory ? (catOf.get(r.symbol) ?? null) : null,
      annual,
    }));

console.log("\n3. DOES THE MISSING CATEGORY CHANGE THE STRIP? selectDue, twice, one field apart");
for (const annual of [false, true]) {
  const withCat = due.selectDue(buildInputs(true, annual), TODAY);
  const without = due.selectDue(buildInputs(false, annual), TODAY);
  const a = new Set(withCat.map((e) => e.symbol));
  const b = new Set(without.map((e) => e.symbol));
  const onlyTrue = [...a].filter((s) => !b.has(s));
  const onlyFallback = [...b].filter((s) => !a.has(s));
  console.log(`   annual=${annual}: true category ${withCat.length} entries · fallback ${without.length} entries · disagree on ${onlyTrue.length + onlyFallback.length}`);
  if (onlyTrue.length) console.log(`     kept ONLY with the true category: ${onlyTrue.join(" ")}`);
  if (onlyFallback.length) console.log(`     kept ONLY by the fallback (would be WRONGLY shown): ${onlyFallback.join(" ")}`);
}

// ── 4. AND WHAT DOES `annual` COST, measured the same way ─────────────────
console.log("\n4. AND THE SAME QUESTION FOR `annual`, which the brief did not raise");
{
  const q = due.selectDue(buildInputs(true, false), TODAY);
  const y = due.selectDue(buildInputs(true, true), TODAY);
  const qs = new Set(q.map((e) => e.symbol)), ys = new Set(y.map((e) => e.symbol));
  const diff = [...new Set([...qs, ...ys])].filter((s) => qs.has(s) !== ys.has(s));
  console.log(`   annual=false ${q.length} entries · annual=true ${y.length} entries · disagree on ${diff.length}${diff.length ? `: ${diff.join(" ")}` : ""}`);
  console.log("   Guessing wrong here moves the overdue cap by 15-45 days, so it is not a detail.");
}

// ── 5. THE STRIP ITSELF, AS THE PAGE WOULD RESOLVE IT TODAY ───────────────
console.log("\n5. WHAT THE PAGE WOULD RENDER TODAY");
let withRecord = 0;
for (const sym of universe) {
  const rec = await redis.get(`${DATES_PREFIX}:${sym.toUpperCase()}`);
  if (rec && typeof rec === "object" && Array.isArray(rec.events) && rec.events.length) withRecord++;
}
const entries = due.selectDue(buildInputs(true, false), TODAY);
const resolved = state.resolveDueStrip({
  universeSize: universe.length,
  withResultsDate: withRecord,
  manifestRead: true,
  entries,
});
console.log(`   universe ${universe.length} · with a results record ${withRecord} · coverage ${(withRecord / universe.length * 100).toFixed(1)}% (floor ${state.MIN_COVERAGE_TO_CLAIM_EMPTY * 100}%)`);
console.log(`   resolveDueStrip -> ${resolved.kind}${resolved.reason ? ` (${resolved.reason})` : ""}${resolved.kind === "listed" ? ` with ${resolved.entries.length} entries` : ""}`);
if (resolved.kind === "listed") {
  for (const e of resolved.entries.slice(0, 12)) {
    console.log(`     ${e.symbol.padEnd(6)} period ${e.periodEnd} · due from ${e.dueFrom} · ${e.daysOutstanding}d outstanding`);
  }
}
// ── 6. THE SHIPPED PRODUCER, END TO END, AGAINST THE LIVE STORE ──────────
//
// Sections 1-5 measured the INPUTS. This runs lib/server/dueInputs.ts itself --
// dueInputFrom, buildDueInputs, coverageOf -- over the same live records, so
// "the listed branch works against real production data" is a claim about the
// shipped module rather than about this probe's reading of it.
//
// THE DENOMINATOR IS THE ANALYSIS UNIVERSE, not the manifest. Section 5 above
// deliberately used the manifest and reported 822; the shipped coverageOf reads
// the pickers symbol key -- the 700-symbol population data/due-strip.json was
// actually cut from -- and both are printed so the difference is visible rather
// than corrected silently.
let shipped;
console.log("\n6. THE SHIPPED PRODUCER (lib/server/dueInputs.ts), AGAINST THE LIVE STORE");
{
  const cutJson = fs.readFileSync(CUT_FILE, "utf8");
  const prodSrc = readCodeOnly("lib/server/dueInputs.ts")
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/export const DUE_STRIP_CUT: readonly string\[\] = cut\.symbols;/,
      `export const DUE_STRIP_CUT = ${JSON.stringify(cutDoc.symbols)};`)
    .replace(/export const DUE_STRIP_CUT_GENERATED_AT: string = cut\.generatedAt;/,
      `export const DUE_STRIP_CUT_GENERATED_AT = ${JSON.stringify(cutDoc.generatedAt)};`)
    .replace(/export async function getDueStripState[\s\S]*?\n\}\n?$/m, "");
  void cutJson;
  const prod = await lift(
    prodSrc.replace(/export (const|function|type)/g, "$1") +
      "\nexport { dueInputFrom, buildDueInputs, coverageOfCut, cutDrift, DUE_STRIP_CUT, ANNUAL_WHEN_UNKNOWN };",
    "", "dueInputs"
  );

  const records = new Map();
  for (const symbol of prod.DUE_STRIP_CUT) {
    records.set(symbol, await redis.get(`${DATES_PREFIX}:${symbol.toUpperCase()}`));
  }
  const built = prod.buildDueInputs(prod.DUE_STRIP_CUT, records);
  const accounted = built.inputs.length +
    Object.values(built.skipped).reduce((n, xs) => n + xs.length, 0);
  console.log(`   inputs ${built.inputs.length}/${prod.DUE_STRIP_CUT.length} · accounted ${accounted}/${prod.DUE_STRIP_CUT.length}${accounted === prod.DUE_STRIP_CUT.length ? "" : "   <-- A SYMBOL IS UNACCOUNTED FOR"}`);
  for (const [why, syms] of Object.entries(built.skipped)) {
    if (syms.length) console.log(`   skipped ${String(syms.length).padStart(2)}  ${why.padEnd(14)} ${syms.join(" ")}`);
  }

  // HOW MANY CARRY THE NEW FIELDS YET. Absent means not-yet-backfilled, and
  // until the sec-facts rotation comes round that is most of them -- so the
  // figure is printed rather than assumed, and it is the migration's progress
  // bar.
  const withCat = built.inputs.filter((i) => i.filerCategory !== null).length;
  const withAnnual = [...records.values()].filter((r) => typeof r?.annual === "boolean").length;
  console.log(`   backfill: filerCategory on ${withCat}/${built.inputs.length} inputs · annual on ${withAnnual}/${records.size} records`);
  console.log(`   (absent = not-yet-backfilled; the cron fills these on its own rotation)`);

  const symbols = await redis.get(PICKERS_SYMBOLS_KEY);
  const analysis = Array.isArray(symbols) ? symbols : [];
  const drift = prod.cutDrift(analysis);
  console.log(`   analysis universe ${analysis.length} symbols · cut drift ${drift.length}${drift.length ? `: ${drift.join(" ")}` : " (every cut symbol still covered)"}`);

  const cov = prod.coverageOfCut(prod.DUE_STRIP_CUT, records);
  console.log(`   coverageOfCut -> ${cov.withResultsDate}/${cov.universeSize} = ${(cov.withResultsDate / cov.universeSize * 100).toFixed(1)}% (floor ${state.MIN_COVERAGE_TO_CLAIM_EMPTY * 100}%)`);
  console.log(`   (section 5's MANIFEST figure was ${withRecord}/${universe.length} = ${(withRecord / universe.length * 100).toFixed(1)}% — a different population, printed`);
  console.log(`    beside it because the manifest is what a render path may NOT read: check-sec-daily-index`);
  console.log(`    names the only two routes allowed, and neither is a render.)`);

  shipped = state.resolveDueStrip({
    universeSize: cov.universeSize,
    withResultsDate: cov.withResultsDate,
    manifestRead: true,
    entries: due.selectDue(built.inputs, TODAY),
  });
  console.log(`   resolveDueStrip -> ${shipped.kind}${shipped.reason ? ` (${shipped.reason})` : ""}${shipped.kind === "listed" ? ` with ${shipped.entries.length} entries` : ""}`);
  for (const e of shipped.kind === "listed" ? shipped.entries : []) {
    console.log(`     ${e.symbol.padEnd(6)} period ${e.periodEnd} · due from ${e.dueFrom} · ${e.daysOutstanding}d outstanding`);
  }
  console.log("   ONLY the branch printed above is verified against real data. none-outstanding");
  console.log("   and unavailable are not reachable from production today; see the check's §6.");
}

// ── 7. THE SHIPPED COMPONENT, RENDERED, AGAINST THAT SAME LIVE STATE ─────
//
// Section 6 proved the producer returns a real DueStripState. This renders the
// SHIPPED EarningsDueStrip with it and prints the visible text, so "the MU row
// appears on the page" is a sentence read out of real markup rather than
// inferred from a state object.
//
// THIS IS THE ONLY RENDER VERIFICATION A SESSION CAN DO. The sandbox is refused
// *.vercel.app and www.mystockharbor.com with 403 CONNECT (CLAUDE.md, retested
// 2026-08-20), so nobody here can open the preview. What CAN be checked is the
// markup the server produces -- which is also what a crawler and a screen
// reader consume -- and that is what this prints.
console.log("\n7. THE SHIPPED COMPONENT (EarningsDueStrip.tsx), RENDERED WITH THAT STATE");
{
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const tsMod = (await import("typescript")).default;

  const SHIMS = `
const Link = ({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>;
const TickerLogo = ({ symbol }) => <span data-logo={symbol} />;
`;
  const noImports = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  const unit = [
    SHIMS,
    noImports("lib/server/dueStripState.ts"),
    noImports("app/earnings-calendar/EarningsDueStrip.tsx")
      .replace(/export default function/, "export function"),
  ].join("\n");
  const out = tsMod.transpileModule(unit, {
    fileName: "strip.tsx",
    compilerOptions: {
      target: tsMod.ScriptTarget.ES2022, module: tsMod.ModuleKind.ESNext,
      jsx: tsMod.JsxEmit.ReactJSX, jsxImportSource: "react",
    },
  }).outputText;
  const tmp = `scripts/.census-strip-${process.pid}.mjs`;
  fs.writeFileSync(tmp, out);
  let comp;
  try { comp = await import(`${process.cwd()}/${tmp}?t=${Date.now()}`); }
  finally { fs.rmSync(tmp, { force: true }); }

  const markup = renderToStaticMarkup(
    React.createElement(comp.EarningsDueStrip, { state: shipped })
  );
  const text = markup
    .replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&mdash;/g, "\u2014")
    .replace(/\s+/g, " ").trim();

  console.log(`   branch rendered: ${shipped.kind}`);
  console.log(`   VISIBLE TEXT: ${text}`);
  for (const e of shipped.kind === "listed" ? shipped.entries : []) {
    const label = state.dueRowLabel(e);
    console.log(`   row ${e.symbol}: ${text.includes(label) ? "RENDERS its dueRowLabel verbatim" : "*** LABEL MISSING ***"}`);
    console.log(`     href present: ${markup.includes(`/stock/${e.symbol}/earnings`) ? "yes" : "*** NO ***"}`);
    console.log(`     expectedOn (${e.expectedOn}) leaked into the page: ${markup.includes(e.expectedOn) ? "*** YES — IT MUST NOT ***" : "no, correct"}`);
  }
}

console.log("\nNo writes were performed.");
