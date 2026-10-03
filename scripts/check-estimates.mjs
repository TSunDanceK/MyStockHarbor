// THE ESTIMATE LAYER (#552 COWORK #94/#98/#112): only back-tested methods,
// only where marked, never on a filed figure, opt-in per surface.
//
//   1. secEstimates: EV is estimated ONLY when short-term debt alone is
//      untagged (M2); cash or long-term debt missing is still refused. The NCI
//      read is USD-only, instants only, newest filing wins.
//   2. valuationMultiples: without { withEstimates } every figure is exactly
//      today's (no `est`, the same refusals), so a surface that doesn't render
//      the mark can't show an estimate. With it: ≈ EV/EBITDA and a derived
//      P/B, a non-positive derived equity refused like a filed one.
//   3. The FY P/E fallback: only on a plain "not on file", labelled FY, and
//      the loss/near-zero rules applied to the year.
//   4. Rendering: EstimatedValue shows "≈" + colour + note for an estimate,
//      "derived" + note for a derived figure, plain text otherwise; every
//      surface that opts in renders EstimatedValue AND EstimateKey; the old
//      "never an estimate" copy is gone; the words map Loss / Not meaningful.
//   5. Mutants: each rule broken once, and caught.
//
//   node scripts/check-estimates.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { readCodeOnly, stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
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
/** Import a mutated copy of a module beside the original (so its imports resolve), then delete it. */
let seq = 0;
async function mutated(rel, from, to) {
  const abs = path.join(ROOT, rel);
  const tmp = abs.replace(/\.ts$/, `.__mut${process.pid}_${seq++}.ts`);
  fs.writeFileSync(tmp, once(fs.readFileSync(abs, "utf8"), from, to));
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}

const EST = "lib/server/secEstimates.ts";
const VAL = "lib/server/secValuation.ts";
const EXT = "lib/server/secExtract.ts";
const E = await import(pathToFileURL(path.join(ROOT, EST)).href);
const V = await import(pathToFileURL(path.join(ROOT, VAL)).href);
const X = await import(pathToFileURL(path.join(ROOT, EXT)).href);

// ── 1. secEstimates ─────────────────────────────────────────────────────────
console.log("1. secEstimates");
const BS = { asOf: "2026-06-30", shortTermDebt: 10, longTermDebt: 100, cash: 30 };
const evCases = (F) => ({
  full: F.enterpriseValueOf(1000, BS, "3826"),
  noStd: F.enterpriseValueOf(1000, { ...BS, shortTermDebt: null }, "3826"),
  noCash: F.enterpriseValueOf(1000, { ...BS, cash: null }, "3826"),
  noLtd: F.enterpriseValueOf(1000, { ...BS, longTermDebt: null }, "3826"),
  stdAndCash: F.enterpriseValueOf(1000, { ...BS, shortTermDebt: null, cash: null }, "3826"),
  bank: F.enterpriseValueOf(1000, { ...BS, shortTermDebt: null }, "6022"),
  broker: F.enterpriseValueOf(1000, { ...BS, shortTermDebt: null }, "6211"),
  unknownSic: F.enterpriseValueOf(1000, { ...BS, shortTermDebt: null }, null),
});
const ev = evCases(E);
check("every line filed → the filed EV, no estimate", ev.full.val === 1080 && !ev.full.est);
check("short-term debt alone untagged → ≈ EV counting it as zero, marked M2",
  ev.noStd.val === 1070 && ev.noStd.est?.key === "ev-short-term-debt-untagged" && ev.noStd.est.kind === "estimate" && /30 Jun 2026/.test(ev.noStd.est.note));
check("a bank or other SIC 6000–6299 filer never gets the estimate (deposits and short-term funding are not zero)",
  ev.bank.val === null && ev.broker.val === null && E.sicAllowsEstimate("6300") && !E.sicAllowsEstimate("6000") && !E.sicAllowsEstimate("6299"));
check("an unknown SIC gets no estimate (fail-closed)", ev.unknownSic.val === null);
check("filed EV is unaffected by the bank gate", E.enterpriseValueOf(1000, BS, "6022").val === 1080);
check("cash, long-term debt, or short-term debt + cash missing → still refused (those patterns failed)",
  ev.noCash.val === null && ev.noLtd.val === null && ev.stdAndCash.val === null && ev.stdAndCash.missing.join() === "short-term debt,cash");
const FACTS = { facts: { "us-gaap": { MinorityInterest: { units: { USD: [
  { end: "2026-06-30", val: 50, filed: "2026-08-01" },
  { end: "2026-06-30", val: 55, filed: "2026-11-01" },
  { start: "2026-01-01", end: "2026-06-30", val: 999, filed: "2026-12-01" },
  { end: "2025-12-31", val: 40, filed: "2026-02-01" },
  { end: "2024-12-31", val: 30, filed: "2025-02-01" },
] } } } } };
const nci = X.minorityInterestAt(FACTS, ["2026-06-30", "2025-12-31"], "USD");
check("NCI: stored dates only, newest filing wins, durations ignored", JSON.stringify(nci) === JSON.stringify([["2026-06-30", 55], ["2025-12-31", 40]]), JSON.stringify(nci));
check("NCI: none for a non-USD reporter (its instants are converted later; this would not be)", X.minorityInterestAt(FACTS, ["2026-06-30"], "EUR").length === 0);
check("derived equity = total − NCI on the same date, marked derived; none without that date",
  E.derivedParentEquity(500, nci, "2026-06-30")?.equity === 445 && E.derivedParentEquity(500, nci, "2026-06-30")?.est.kind === "derived" && E.derivedParentEquity(500, nci, "2026-03-31") === null);
{
  const M = await mutated(EST, "if (cap === null || !bs || bs.longTermDebt === null || bs.cash === null)", "if (cap === null || !bs || bs.longTermDebt === null)");
  let caught = false; try { caught = evCases(M).noCash.val !== null; } catch { caught = true; }
  check("MUTATION: cash-missing allowed into the estimate → caught", caught);
  const Mb = await mutated(EST, "    if (!sicAllowsEstimate(sic)) return { val: null, missing };\n", "");
  check("MUTATION: the bank gate removed → caught (a bank gets ≈ EV)", evCases(Mb).bank.val !== null);
  const Mc = await mutated(EXT, `if (currency !== "USD" || !dates.length) return [];`, "if (!dates.length) return [];");
  check("MUTATION: the USD gate on NCI removed → caught", Mc.minorityInterestAt(FACTS, ["2026-06-30"], "EUR").length > 0);
}

// ── 2. valuationMultiples ───────────────────────────────────────────────────
console.log("\n2. valuationMultiples: opt-in, and today's figures otherwise");
const inputs = { shares: { val: 100, asOf: "2026-08-01" }, eps: { val: 2, basis: "four-quarters", periodEnd: "2026-06-30" }, refusals: [], sic: "3826" };
const m = (bs) => ({
  revenue: { vals: { revenue: 500 }, basis: "four-quarters", periodEnd: "2026-06-30" },
  ebitda: { vals: { operatingIncome: 80, depreciationAndAmortization: 20 }, basis: "four-quarters", periodEnd: "2026-06-30" },
  balanceSheet: { asOf: "2026-06-30", equity: null, equityOnlyInclNci: true, shortTermDebt: null, longTermDebt: 100, cash: 30, ...bs },
});
const derivedEq = { val: 400, est: E.derivedParentEquity(455, [["2026-06-30", 55]], "2026-06-30").est };
const plain = (F, opts) => F.valuationMultiples(inputs, m({ derivedEquity: derivedEq }), 10, opts);
const off = plain(V), on = plain(V, { withEstimates: true });
check("without withEstimates: EV/EBITDA refused as before (short-term debt not on file), no est anywhere",
  !off.evEbitda.ok && off.evEbitda.why === "enterprise-value-input-missing" && /short-term debt/.test(off.evEbitda.detail) && ![off.pe, off.ps, off.pb, off.evEbitda].some((f) => f?.ok && f.est));
check("without withEstimates: P/B keeps today's refusal (equity only incl. NCI)", !off.pb.ok && off.pb.why === "equity-tagged-only-incl-nci");
check("with withEstimates: ≈ EV/EBITDA = (1000 + 100 − 30) ÷ 100, marked estimate",
  on.evEbitda.ok && Math.abs(on.evEbitda.val - 10.7) < 1e-9 && on.evEbitda.est?.kind === "estimate");
const bankOn = V.valuationMultiples({ ...inputs, sic: "6022" }, m({}), 10, { withEstimates: true });
check("with withEstimates, a bank (SIC 6022): EV/EBITDA refused, not ≈", !bankOn.evEbitda.ok && bankOn.evEbitda.why === "enterprise-value-input-missing");
check("valuationInputs carries the filer's SIC to the gate, and the stock page passes it",
  /\.\.\.\(filer\.sic \? \{ sic: filer\.sic \} : \{\}\)/.test(readCodeOnly(VAL)) && /sic: registrantFor\(clean\)\?\.sic \?\? null/.test(readCodeOnly("lib/server/secEarningsSnapshot.ts")));
check("with withEstimates: P/B = 1000 ÷ (455 − 55), marked derived", on.pb.ok && on.pb.val === 2.5 && on.pb.est?.kind === "derived");
check("filed figures never carry an est (P/E, P/S)", on.pe.ok && !on.pe.est && on.ps.ok && !on.ps.est);
const neg = V.valuationMultiples(inputs, m({ derivedEquity: { val: -5, est: derivedEq.est } }), 10, { withEstimates: true });
check("a non-positive derived equity is refused like a filed one (\"Neg.\")", !neg.pb.ok && neg.pb.why === "equity-is-zero-or-negative" && V.REFUSAL_CELL_WORD[neg.pb.why] === "Neg.");
// THE 1% FLOOR (#691) ON THE DERIVED EQUITY TOO (#552 COWORK #113): cap 1000,
// derived equity 5 = 0.5% of cap → "Not meaningful", never a 200× derived P/B.
const tiny = V.valuationMultiples(inputs, m({ derivedEquity: { val: 5, est: derivedEq.est } }), 10, { withEstimates: true });
check("a derived equity under 1% of market cap is refused by #691's floor (\"Not meaningful\")",
  !tiny.pb.ok && tiny.pb.why === "equity-too-small-for-pb" && V.REFUSAL_CELL_WORD[tiny.pb.why] === "Not meaningful");
{
  const Mf = await mutated(VAL, "        : equity < cap.val * PB_MIN_EQUITY_SHARE\n", "        : !derivedEq && equity < cap.val * PB_MIN_EQUITY_SHARE\n");
  check("MUTATION: the floor skipped for a derived equity → caught",
    Mf.valuationMultiples(inputs, m({ derivedEquity: { val: 5, est: derivedEq.est } }), 10, { withEstimates: true }).pb.ok === true);
}
const filedAll = V.valuationMultiples(inputs, m({ equity: 200, equityOnlyInclNci: false, shortTermDebt: 10 }), 10, { withEstimates: true });
check("all filed, opted in: no est at all", [filedAll.pb, filedAll.evEbitda].every((f) => f.ok && !f.est));
{
  const Mv = await mutated(VAL, "evAny.val !== null && evAny.est && !opts.withEstimates", "false");
  const x = Mv.valuationMultiples(inputs, m({ derivedEquity: derivedEq }), 10);
  check("MUTATION: the EV opt-in gate removed → caught (an unmarked surface would get the estimate)", x.evEbitda.ok === true);
  const Mp = await mutated(VAL, "const derivedEq = opts.withEstimates ? m.balanceSheet?.derivedEquity ?? null : null;", "const derivedEq = m.balanceSheet?.derivedEquity ?? null;");
  check("MUTATION: the P/B opt-in gate removed → caught", Mp.valuationMultiples(inputs, m({ derivedEquity: derivedEq }), 10).pb.ok === true);
}

// ── 3. the FY P/E fallback ──────────────────────────────────────────────────
console.log("\n3. the FY P/E fallback");
const fy = { val: 4.08, basis: "fiscal-year", periodEnd: "2025-12-31", fiscalYear: 2025 };
const noTtm = { shares: inputs.shares, eps: null, refusals: ["no-twelve-month-eps"], fyEps: fy };
const fyPe = V.fyPeRatio(noTtm, 40.8);
check("P/E on the latest full year where twelve months are not on file", fyPe?.ok && Math.abs(fyPe.val - 10) < 1e-9);
check("a loss year → refused as a loss (\"Loss (FY)\" on the page)", V.fyPeRatio({ ...noTtm, fyEps: { ...fy, val: -1 } }, 40)?.why === "eps-is-zero-or-negative");
check("no FY figure → null (the dash stays)", V.fyPeRatio({ ...noTtm, fyEps: undefined }, 40) === null);
const VSRC = readCodeOnly(VAL);
const fyGate = /const fyYear = !ads && refusals\.length === 1 && refusals\[0\] === "no-twelve-month-eps" \? newestFiscalYear\(set\.years\) : null;\s*const fyEps = fyYear && !epsIsStale\(fyYear\.periodEnd, today\) \? fyYear : null;/;
check("valuationInputs sets fyEps only on a plain \"not on file\", never ADS, never a stale year", fyGate.test(VSRC));
check("MUTATION: the stale-year guard dropped → caught", !fyGate.test(once(VSRC, "fyYear && !epsIsStale(fyYear.periodEnd, today) ? fyYear : null", "fyYear")));
const PAGE = "app/stock/[symbol]/page.tsx";
const PSRC = readCodeOnly(PAGE);
const fyWired = (s) => /multiples\.pe\.why === "no-twelve-month-eps" \? fyPeRatio\(inputs, quote\.price\)/.test(s) && /peBasis: peBasisLabel\(peEps\)/.test(s) && /`\$\{fyWord\} \(FY\)`/.test(s);
check("the stock page uses it only on \"not on file\", labels the basis FY, and says \"Loss (FY)\"", fyWired(PSRC));
check("MUTATION: the page labels the FY P/E with the trailing basis → caught", !fyWired(once(PSRC, "peBasis: peBasisLabel(peEps)", "peBasis: peBasisLabel(inputs?.eps)")));

// ── 4. rendering ────────────────────────────────────────────────────────────
console.log("\n4. rendering");
const COMP = "app/components/EstimatedValue.tsx";
const CSRC = stripComments(fs.readFileSync(COMP, "utf8"), { file: COMP });
const markRules = (s) => [
  /if \(!est\) return <span style=\{style\}>\{text\}<\/span>;/.test(s),
  /style=\{\{ color: ESTIMATE_COLOUR, \.\.\.style \}\}>\s*\{ESTIMATE_SIGN\}\s*\{text\}/.test(s),
  /title=\{note\}/.test(s) && /role="tooltip"/.test(s) && /tabIndex=\{0\}/.test(s) && /e\.key === "Enter" \|\| e\.key === " "/.test(s),
  />derived<\/span>/.test(s),
];
check("EstimatedValue: plain text with no est; \"≈\" + colour for an estimate; the note on hover, tap and keyboard; \"derived\" for a derived figure",
  markRules(CSRC).every(Boolean), markRules(CSRC).join());
check("MUTATION: the \"≈\" dropped (colour alone) → caught", !markRules(once(CSRC, "{ESTIMATE_SIGN}\n      {text}", "{text}")).every(Boolean));
check("MUTATION: a filed figure rendered in the estimate colour → caught",
  !markRules(once(CSRC, "if (!est) return <span style={style}>{text}</span>;", "if (!est) return <span style={{ color: ESTIMATE_COLOUR }}>{text}</span>;")).every(Boolean));

// THE NOTE STAYS ON SCREEN (#552 COWORK #113): at 360 px a right-hand cell's
// note used to run off the edge and push the page sideways.
const notePlacementSrc = CSRC.match(/export function notePlacement[\s\S]*?\n\}/)?.[0] ?? "";
const placeFrom = (src) => {
  const js = ts.transpileModule(src.replace("export function", "function"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function("NOTE_MAX_WIDTH", "NOTE_GUTTER", `${js}\nreturn notePlacement;`)(280, 16);
};
const placeOk = (fn) => [[300, 360], [20, 360], [200, 1280], [0, 320]].every(([left, vw]) => {
  const p = fn({ left, bottom: 100 }, vw);
  return p.left >= 16 && p.left + p.width <= vw - 16 && p.width > 0;
});
check("the note's box stays inside the viewport with a 16 px gutter (360 px, 320 px and desktop; right-hand cells)", notePlacementSrc !== "" && placeOk(placeFrom(notePlacementSrc)));
check("MUTATION: the note anchored at the trigger's left again → caught",
  !placeOk(placeFrom(once(notePlacementSrc, "Math.max(NOTE_GUTTER, Math.min(trigger.left, viewportWidth - NOTE_GUTTER - width))", "trigger.left"))));
check("the note is position:fixed (escapes the hero row's clipping) and closes on scroll", /position: "fixed", left: place\.left, top: place\.top/.test(CSRC) && /addEventListener\("scroll", close/.test(CSRC));

// Every surface that opts in renders the mark AND the key. Map: the file that
// passes { withEstimates: true } → the file that renders its figures.
const RENDERS = { [PAGE]: "app/stock/[symbol]/StockSymbolPageClient.tsx" };
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel, out); }
    else if (/\.(tsx?|mjs)$/.test(e.name) && !e.name.includes(".__mut")) out.push(rel);
  }
  return out;
}
const files = [...walk("app"), ...walk("lib")];
const code = Object.fromEntries(files.map((f) => [f, stripComments(fs.readFileSync(path.join(ROOT, f), "utf8"), { file: f })]));
const surfaceRules = (c) => {
  const fails = [];
  const optIn = Object.keys(c).filter((f) => /withEstimates: true/.test(c[f]));
  if (!optIn.length) fails.push("no surface opts in");
  for (const f of optIn) {
    const r = RENDERS[f];
    if (!r) { fails.push(`${f} opts in but no renderer is mapped here`); continue; }
    if (!/<EstimatedValue\b[^>]*\best=/.test(c[r] ?? "")) fails.push(`${r} does not render EstimatedValue with est`);
    if (!/<EstimateKey\b/.test(c[r] ?? "")) fails.push(`${r} does not render EstimateKey`);
  }
  const old = Object.keys(c).filter((f) => /never an estimate/.test(c[f]));
  if (old.length) fails.push(`"never an estimate" still in ${old.join(", ")}`);
  const made = Object.keys(c).filter((f) => /kind: "estimate"|kind: "derived"/.test(c[f]) && ![EST, "app/components/estimateMark.ts", COMP].includes(f));
  if (made.length) fails.push(`an estimate is built outside secEstimates: ${made.join(", ")}`);
  return fails;
};
const real = surfaceRules(code);
for (const f of real) check(f, false);
check("every opted-in surface renders EstimatedValue and EstimateKey; no \"never an estimate\"; estimates built only in secEstimates", real.length === 0);
const CLIENT = RENDERS[PAGE];
check("MUTATION: the stock page drops EstimateKey → caught",
  surfaceRules({ ...code, [CLIENT]: code[CLIENT].replace(/<EstimateKey\b/g, "<div") }).length > 0);
check("MUTATION: \"never an estimate\" copy restored → caught",
  surfaceRules({ ...code, [PAGE]: code[PAGE] + "\nconst x = \"A figure the filings cannot support shows —, never an estimate.\";" }).length > 0);
check("MUTATION: a surface builds its own estimate → caught",
  surfaceRules({ ...code, "lib/server/pickersSecFundamentals.ts": code["lib/server/pickersSecFundamentals.ts"] + "\nconst e = { kind: \"estimate\", note: \"x\" };" }).length > 0);

const words = V.REFUSAL_CELL_WORD;
check("the words: Loss (EPS not positive), Not meaningful (EBITDA not positive, EPS near zero), Neg. (equity)",
  words["eps-is-zero-or-negative"] === "Loss" && words["ebitda-is-zero-or-negative"] === "Not meaningful" && words["eps-near-zero"] === "Not meaningful" && words["equity-is-zero-or-negative"] === "Neg.");
check("a gap in the data stays a dash (no word for \"not on file\")", !words["no-twelve-month-eps"] && !words["enterprise-value-input-missing"]);
const CL = code[CLIENT];
const panelRules = (s) => /<ReasonedValue text=\{valuation\?\.words\?\.\[item\.key\] \?\? "—"\} reason=\{item\.reason\} \/>/.test(s)
  && /\{item\.value != null && item\.reason \? \(/.test(s) && /<summary[^>]*>How these are calculated<\/summary>/.test(s);
check("the panel: refusal reasons on hover/tap of the dash or word, not printed; the detail inside <details>", panelRules(CL));
check("MUTATION: refusal reasons printed under the tile again → caught", !panelRules(once(CL, "{item.value != null && item.reason ? (", "{item.reason ? (")));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
