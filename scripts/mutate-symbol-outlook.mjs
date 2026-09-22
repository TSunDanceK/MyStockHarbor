// Prove check-symbol-outlook can FAIL.
//
// Every mutant here still answers the search. None throw, none render an empty
// panel, and each one is a sentence a reader would accept without blinking.
// What separates them from correct behaviour is whether the reader is told a
// measured band or a promised day, whether a filed fact still outranks an
// estimate about the same company, and whether an outage can still be told
// apart from a company we simply have not read yet.
//
//   node scripts/mutate-symbol-outlook.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MOD = path.join(process.cwd(), "lib/server/symbolOutlook.ts");
const COPY = path.join(process.cwd(), "lib/server/expectedCopy.ts");
const EXP = path.join(process.cwd(), "lib/server/expectedToReport.ts");
const SRCH = path.join(process.cwd(), "app/earnings-calendar/EarningsTickerSearch.tsx");
const ROUTE = path.join(process.cwd(), "app/api/earnings-outlook/[symbol]/route.ts");
const CHECK = "scripts/check-symbol-outlook.mjs";

const FILES = [MOD, COPY, EXP, SRCH, ROUTE];
const dirty = execFileSync("git", ["status", "--porcelain", ...FILES, CHECK], { encoding: "utf8" }).trim();
if (dirty) {
  console.error("FATAL: refusing to run with uncommitted changes to the files this mutates:");
  console.error(dirty);
  console.error("\nThis rewrites tracked files in place and restores them from memory,");
  console.error("which would DESTROY that work. Commit or stash first.");
  process.exit(2);
}
const ORIGINALS = new Map(FILES.map((f) => [f, fs.readFileSync(f, "utf8")]));

const HEDGE_JSX = `          {info.hedge ? (
            <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.55, color: "rgba(226,232,240,0.7)" }}>
              {info.hedge}
            </div>
          ) : null}
`;

const MUTANTS = [
  [MOD, "S1", "the filed-record answer skipped, so an outstanding filer is described as 'expected soon'",
    "    if (entry) {", "    if (false && entry) {"],
  [MOD, "S2", "the due sentence paraphrased instead of reusing the strip's own label",
    "        headline: dueRowLabel(entry),",
    '        headline: symbol + " has not filed its results yet.",'],
  [MOD, "S3", "the hedge dropped from the in-window estimate (a band stated as a fact)",
    "      hedge: OUTLOOK_HEDGE,\n      evidence: evidenceFor(row.medianLagDays, row.fromPeriods, row.periodEnd, rec),",
    "      hedge: null,\n      evidence: evidenceFor(row.medianLagDays, row.fromPeriods, row.periodEnd, rec),"],
  [MOD, "S4", "the band turned back into a DAY — the one thing two measurements forbid",
    "      headline: outlookBandLabel(symbol, row.band),",
    '      headline: `${symbol} next reports on ${new Date(Date.now() + row.daysAway * 86400000).toISOString().slice(0, 10)}.`,'],
  [MOD, "S5", "the health probe dropped, so an outage reads as 'we have no record for this company'",
    "  if (!Array.isArray(universe) || !universe.length) {",
    "  if (false) {"],
  [MOD, "S6", "the beyond-window answer collapsed into a refusal (a real answer thrown away)",
    '  if (got.skip === "beyond-window") {', "  if (false) {"],
  [MOD, "S7", "every refusal reported as the same reason",
    "    symbol, kind: \"no-estimate\", reason,",
    "    symbol, kind: \"no-estimate\", reason: \"no-record\" as OutlookReason,"],
  [COPY, "S8", "the hedge stops denying the company announced it",
    '  "Estimated from this company\'s own filing history — not a confirmed date, and not " +\n  "announced by the company.";',
    '  "Estimated from this company\'s own filing history.";'],
  [COPY, "S9", "the three bands collapsed into one vague word (the range stops being in the sentence)",
    '  const window =\n    band === "d0_7" ? "within the next 7 days"\n      : band === "d8_21" ? "in roughly 8 to 21 days"\n        : "in roughly 22 to 30 days";',
    '  const window = "soon";'],
  [COPY, "S10", "the beyond-window sentence given a number the measurement cannot support",
    "  return `${symbol} is not expected to report in the next 30 days.`;",
    "  return `${symbol} is not expected to report for about 45 days.`;"],
  [COPY, "S11", "two refusals given the same sentence, so a reader cannot tell whose gap it is",
    '    case "thin-history":\n      return "It has filed too few periods for us to estimate from.";',
    '    case "thin-history":\n      return "We have no SEC filing record for it yet.";'],
  [EXP, "S12", "the two out-of-window answers merged back into one name",
    '  if (!band) return { skip: "beyond-window" };',
    '  if (!band) return { skip: "estimate-in-past" };'],
  [SRCH, "S13", "the search pointed back at the FMP-backed route",
    "`/api/earnings-outlook/${encodeURIComponent(result.symbol)}`",
    "`/api/stock-earnings/${encodeURIComponent(result.symbol)}`"],
  [SRCH, "S14", "the hedge never rendered — the headline stands alone as a fact",
    HEDGE_JSX, ""],
  [SRCH, "S15", "a failed fetch renders nothing, which reads as 'nothing is coming'",
    "      setInfo(unreachable(result.symbol));\n    } finally {",
    "      setInfo(null);\n    } finally {"],
  [ROUTE, "S16", "an unreadable filing record returned as a 200 — the cacheability test its sibling fails",
    'return NextResponse.json(outlook, { status: outlook.kind === "unavailable" ? 503 : 200 });',
    "return NextResponse.json(outlook);"],
];

let caught = 0;
const survivors = [];
for (const [file, id, label, from, to] of MUTANTS) {
  const original = ORIGINALS.get(file);
  const hits = original.split(from).length - 1;
  if (hits !== 1) {
    console.log(`  SKIPPED   ${id}  ${label}`);
    console.log(`             anchor matched ${hits} times, needs exactly 1 — stale, NOT caught.`);
    survivors.push(`${id} (anchor matched ${hits}x)`);
    continue;
  }
  fs.writeFileSync(file, original.replace(from, to));
  let failed = false, detail = "";
  try {
    execFileSync("node", [CHECK], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    failed = true;
    const out = String(e.stdout ?? "") + String(e.stderr ?? "");
    detail = out.split("\n").filter((l) => l.includes("FAIL")).slice(0, 2).map((l) => l.trim()).join(" | ")
      // A MUTANT CAUGHT BY A COMPILE ERROR PROVES THE TRANSPILER WORKS and
      // nothing else. Named rather than counted silently.
      || (/SyntaxError|TransformError|ReferenceError/.test(out) ? "(compile/runtime error, NOT an assertion)" : "");
  }
  fs.writeFileSync(file, original);
  if (failed) {
    caught++;
    console.log(`  CAUGHT    ${id}  ${label}`);
    if (detail) console.log(`             ${detail}`);
  } else {
    survivors.push(`${id} ${label}`);
    console.log(`  SURVIVED  ${id}  ${label}`);
    console.log(`             the suite passed against this. It is not covered.`);
  }
}

for (const [file, original] of ORIGINALS) fs.writeFileSync(file, original);
const restored = execFileSync("git", ["status", "--porcelain", ...FILES], { encoding: "utf8" }).trim();
console.log(`\n  ${caught}/${MUTANTS.length} mutants caught`);
console.log(restored ? `  ** TREE NOT RESTORED: ${restored}` : "  working tree restored and verified clean");
if (survivors.length) {
  console.log("\n  UNCOVERED, by name:");
  for (const s of survivors) console.log(`    ${s}`);
}
console.log(`
  NOT COVERED BY THIS FILE, deliberately:
    The panel in a browser. The sandbox is refused *.vercel.app and the
    production domain with 403 CONNECT, so that is an owner-side step.
    The LIVE store behind it: relay task "symbol-outlook-render", which runs
    this producer against the production record for real symbols.
    The brief's mutants are a SEPARATE denominator — run
    scripts/check-brief-mutants.mjs. A green run here is not a green brief.
`);
process.exit(survivors.length || restored ? 1 : 0);
