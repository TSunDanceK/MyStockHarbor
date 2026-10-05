// THE EMPTY-BUILD GUARD (#553 COWORK #155, Option A of CODE-B #143):
// lib/pickerEmptyGuard.ts and its use in app/components/PickerResultPage.tsx.
//
// Runtime, on the pure function:
//   - a lapsed field (0% coverage) with 0 matches trips, naming the field;
//   - a real zero (high coverage, nothing matches) does not;
//   - a page with matches never trips, whatever the coverage;
//   - a technical-flag page (flag predicates only, or none) never trips;
//   - the threshold is 15%, and coverage just above it passes.
// Wiring:
//   - getPickerData runs the guard after the filings layer, on the page's own
//     predicates and its own value reader;
//   - outside `next build` a trip THROWS (Next keeps the last good render);
//   - at build it logs and sets emptyGuardNoindex, and the page renders
//     `noindex, follow`.
// Every rule has a planted mutant.
//
//   node scripts/check-picker-empty-guard.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const LIB = "lib/pickerEmptyGuard.ts";
const PAGE = "app/components/PickerResultPage.tsx";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
const tmp = [];
async function loadLib(src) {
  const f = path.join(ROOT, "lib", `.check-peg-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

function runtimeRules(G) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const N = 685;
  const entries = (carriedShare, field = "divYield") =>
    Array.from({ length: N }, (_, i) => ({ [field]: i < Math.round(N * carriedShare) ? 1 : undefined }));
  const valueOf = (e, f) => e[f];
  const yieldScreen = [{ kind: "number", field: "divYield", min: 4 }];
  const lapsed = G.implausibleEmpty(yieldScreen, entries(0), 0, valueOf);
  want("a lapsed field (0%) with no match trips, naming the field", lapsed.tripped === true && lapsed.field === "divYield" && lapsed.carried === 0 && lapsed.total === N);
  want("a real zero (41% coverage, nothing over 4%) does not trip", G.implausibleEmpty(yieldScreen, entries(0.41), 0, valueOf).tripped === false);
  want("a page with matches never trips, even at 0% coverage", G.implausibleEmpty(yieldScreen, entries(0), 3, valueOf).tripped === false);
  want("a technical-flag page never trips", G.implausibleEmpty([{ kind: "flag", field: "oversold" }], entries(0), 0, valueOf).tripped === false && G.implausibleEmpty([], entries(0), 0, valueOf).tripped === false);
  want("the threshold is 15%", G.PICKER_EMPTY_GUARD_MIN_COVERAGE === 0.15);
  want("coverage just under 15% trips, just over passes",
    G.implausibleEmpty(yieldScreen, entries(0.14), 0, valueOf).tripped === true && G.implausibleEmpty(yieldScreen, entries(0.16), 0, valueOf).tripped === false);
  const two = [{ kind: "number", field: "freeCashFlow", min: 1e10 }, { kind: "number", field: "peRatio", max: 20 }];
  const mixed = Array.from({ length: N }, (_, i) => ({ freeCashFlow: i < 500 ? 1 : undefined, peRatio: undefined }));
  const m = G.implausibleEmpty(two, mixed, 0, valueOf);
  want("any one lapsed field of several trips (P/E lapsed, FCF fine)", m.tripped === true && m.field === "peRatio");
  const line = G.emptyGuardLine("/low-pe-stocks", lapsed, false);
  want("the log line names the page, the field and the counts", /\/low-pe-stocks: implausible empty \(field divYield on 0 of 685\), kept the last good render/.test(line));
  return fails;
}

function wiringRules(pageRaw) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const page = stripComments(pageRaw, { file: PAGE });
  const run = page.indexOf("const guard = implausibleEmpty(presetPredicates, entries, seoEntries.length, valueForPredicateField);");
  want("the guard runs on the page's predicates, entries, matches and value reader", run >= 0);
  want("...after the filings layer and after the matched set is built", run > page.indexOf("const figures = applySecPickerRow(row") && run > page.indexOf("const seoEntries ="));
  want("outside next build, a trip throws (Next keeps the last good render)",
    /if \(!atBuild\) throw new PickerEmptyGuardError\(emptyGuardLine\(config\.href, guard, false\)\);/.test(page) &&
      /const atBuild = process\.env\.NEXT_PHASE === "phase-production-build";/.test(page));
  want("at build, it logs and marks the page noindex", /console\.warn\(emptyGuardLine\(config\.href, guard, true\)\);\s*emptyGuardNoindex = true;/.test(page));
  want("the page renders noindex, follow when marked", /\{emptyGuardNoindex \? <meta name="robots" content="noindex, follow" \/> : null\}/.test(page) && /emptyGuardNoindex \} = await getPickerData\(config\);/.test(page));
  return fails;
}

try {
  const libSrc = read(LIB);
  const pageSrc = read(PAGE);
  console.log("\n1. The guard, at runtime");
  const rt = runtimeRules(await loadLib(libSrc));
  check("lapsed trips; real zero, matches and flag pages pass; 15% threshold", rt.length === 0, rt.join("; "));
  console.log("\n2. The wiring");
  const wr = wiringRules(pageSrc);
  check("runs after the filings layer; throws at runtime; noindex at build", wr.length === 0, wr.join("; "));

  console.log("\n3. Planted mutants");
  const LIB_MUTANTS = [
    ["the guard trips on any empty page (a real zero too)", "    if (carried < entries.length * PICKER_EMPTY_GUARD_MIN_COVERAGE) {", "    if (true) {"],
    ["the guard ignores the match count", "  if (matched > 0 || !predicates.length || !entries.length) return { tripped: false };", "  if (!predicates.length || !entries.length) return { tripped: false };"],
    ["flag predicates guarded too", '    if (p.kind === "flag") continue;\n', ""],
    ["the threshold raised to 50%", "export const PICKER_EMPTY_GUARD_MIN_COVERAGE = 0.15;", "export const PICKER_EMPTY_GUARD_MIN_COVERAGE = 0.5;"],
    ["only the first predicate checked", "      return { tripped: true, field: p.field, carried, total: entries.length };\n    }\n  }", "      return { tripped: true, field: p.field, carried, total: entries.length };\n    }\n    break;\n  }"],
  ];
  for (const [label, from, to] of LIB_MUTANTS) {
    if (!libSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = runtimeRules(await loadLib(libSrc.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const PAGE_MUTANTS = [
    ["the guard never run", "    const guard = implausibleEmpty(presetPredicates, entries, seoEntries.length, valueForPredicateField);", "    const guard = { tripped: false as const };"],
    ["a runtime trip publishes the empty page", "      if (!atBuild) throw new PickerEmptyGuardError(emptyGuardLine(config.href, guard, false));\n", ""],
    ["a build-time trip left indexable", "      emptyGuardNoindex = true;\n", ""],
    ["the noindex meta not rendered", '{emptyGuardNoindex ? <meta name="robots" content="noindex, follow" /> : null}', "{null}"],
  ];
  for (const [label, from, to] of PAGE_MUTANTS) {
    if (!pageSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = wiringRules(pageSrc.replace(from, to));
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
