// THE OVERSOLD / OVERBOUGHT RULE (#553 COWORK #168, owner-approved).
//
// Oversold = RSI(14) <= 30 AND at least one more of the other five checks,
// with more oversold readings than overbought. Overbought mirrors it with
// RSI(14) >= 70. The rule is extracted from lib/server/pickersBuilder.ts as it
// ships (compositeGate and the two pick functions that the Oversold /
// Overbought candidates gate on), and run on composite fixtures:
//   - RSI 29 and 5% under MA50                        -> oversold
//   - 6% under both MAs, RSI 42 (two checks, no RSI)  -> NOT oversold (was in)
//   - RSI alone                                       -> NOT oversold
//   - the overbought mirror of all three;
//   - more readings on the other side still loses.
// Plus: the builder files RSI under "RSI(14)" at 30 / 70, the candidates gate
// through the pick functions, and the overbought write-up states the rule.
// Every rule has a planted mutant.
//
//   node scripts/check-oversold-rule.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const BUILDER = "lib/server/pickersBuilder.ts";
const OB_PAGE = "app/overbought-stocks-today/page.tsx";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fnNamed = (src, name) => {
  const sf = ts.createSourceFile("b.ts", src, ts.ScriptTarget.ES2020, true);
  let out = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) out = node.getText(sf);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

async function loadRule(src) {
  const parts = ["compositeGate", "pickIsGreenOverallSignal", "pickIsRedOverallSignal"].map((n) => fnNamed(src, n));
  if (parts.some((p) => !p)) return null;
  const js = ts.transpileModule(
    `${parts.join("\n")}\nexport const gate = compositeGate;\nexport const green = pickIsGreenOverallSignal;\nexport const red = pickIsRedOverallSignal;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
  ).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

// Composite fixtures: counts plus the names of the checks that fired, as
// buildCompositeFromHistory returns them.
const comp = (os, ob) => ({ oversold: os.length, overbought: ob.length, oversoldIndicators: os, overboughtIndicators: ob });
const FIX = {
  rsi29Under50: comp(["RSI(14)", "MA50"], []),
  sixUnderBothRsi42: comp(["MA50", "MA200"], []),
  rsiAlone: comp(["RSI(14)"], []),
  rsiPlusOneOutnumbered: comp(["RSI(14)", "MA50"], ["EMA20", "MACD(12,26,9)", "Bollinger(20,2)"]),
  rsi71Over50: comp([], ["RSI(14)", "MA50"]),
  sixOverBothRsi58: comp([], ["MA50", "MA200"]),
  obRsiAlone: comp([], ["RSI(14)"]),
};

function ruleFails(R) {
  const fails = [];
  if (!R) return ["the rule functions could not be extracted"];
  const want = (label, got, exp) => { if (got !== exp) fails.push(`${label}: got ${got}, want ${exp}`); };
  want("RSI 29 + 5% under MA50 is oversold", R.green(FIX.rsi29Under50), true);
  want("6% under both MAs, RSI 42, is not oversold", R.green(FIX.sixUnderBothRsi42), false);
  want("RSI <= 30 alone is not oversold", R.green(FIX.rsiAlone), false);
  want("RSI + one, outnumbered by overbought readings, is not oversold", R.green(FIX.rsiPlusOneOutnumbered), false);
  want("RSI 71 + 5% over MA50 is overbought", R.red(FIX.rsi71Over50), true);
  want("6% over both MAs, RSI 58, is not overbought", R.red(FIX.sixOverBothRsi58), false);
  want("RSI >= 70 alone is not overbought", R.red(FIX.obRsiAlone), false);
  want("an oversold stock is never overbought", R.red(FIX.rsi29Under50), false);
  // The old rule stays reachable for the before/after census only.
  want("census: old rule still counts 6% under both MAs", R.gate(FIX.sixUnderBothRsi42, "oversold", "any-two"), true);
  return fails;
}

function sourceFails(src, page) {
  const fails = [];
  const code = stripComments(src, { file: BUILDER });
  if (!/last\.rsi >= 70\)\s*\{\s*overbought\+\+;\s*overboughtRatios\.push\(\{ label: "RSI\(14\)"/.test(code)) fails.push('RSI >= 70 must file as "RSI(14)" on the overbought side');
  if (!/last\.rsi <= 30\)\s*\{\s*oversold\+\+;\s*oversoldRatios\.push\(\{ label: "RSI\(14\)"/.test(code)) fails.push('RSI <= 30 must file as "RSI(14)" on the oversold side');
  if (!/if \(!pickIsGreenOverallSignal\(comp\)\) return null;/.test(code)) fails.push("the Oversold candidate must gate on pickIsGreenOverallSignal");
  if (!/if \(!pickIsRedOverallSignal\(comp\)\) return null;/.test(code)) fails.push("the Overbought candidate must gate on pickIsRedOverallSignal");
  if (!/RSI\(14\) is at 70 or above and at least one of the other five checks also fires on the overbought side/.test(page)) fails.push("the overbought write-up must state RSI >= 70 plus one more");
  if (/at least two of those checks fire on the overbought side and they outnumber/.test(page)) fails.push("the overbought write-up still states the old any-two rule");
  return fails;
}

const SRC = read(BUILDER);
const PAGE = read(OB_PAGE);

console.log("\n=== 1. The rule, on composite fixtures ===\n");
const real = ruleFails(await loadRule(SRC));
check("every fixture lands where the rule says", real.length === 0, real.join("; "));

console.log("\n=== 2. The builder and the copy ===\n");
const realSrc = sourceFails(SRC, PAGE);
check("RSI filed at 30 / 70, candidates gated, write-up matches", realSrc.length === 0, realSrc.join("; "));

console.log("\n=== 3. Planted mutants (each must be caught) ===\n");
const swap = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutant anchor missing: ${a}`); return s.replace(a, b); };
const RULE_MUTANTS = [
  ["RSI condition dropped", (s) => swap(s, 'return fired.includes("RSI(14)");', "return true;")],
  ["second check dropped (RSI alone qualifies)", (s) => swap(s, "if (!(mine >= 2 && mine > theirs)) return false;", "if (!(mine >= 1 && mine > theirs)) return false;")],
  ["other side no longer has to be outnumbered", (s) => swap(s, "if (!(mine >= 2 && mine > theirs)) return false;", "if (!(mine >= 2)) return false;")],
  ["oversold reads the overbought list", (s) => swap(s, '(side === "oversold" ? c.oversoldIndicators : c.overboughtIndicators)', "c.overboughtIndicators")],
  ["pages back on the old rule", (s) => swap(s, 'return compositeGate(c, "oversold");', 'return compositeGate(c, "oversold", "any-two");')],
];
for (const [label, mutate] of RULE_MUTANTS) {
  const f = ruleFails(await loadRule(mutate(SRC)));
  check(`mutant caught: ${label}`, f.length > 0);
}
const SRC_MUTANTS = [
  ["RSI threshold flipped (oversold at >= 30)", (s, p) => [swap(s, "} else if (last.rsi <= 30) {", "} else if (last.rsi >= 30) {"), p]],
  ["overbought RSI threshold moved to 60", (s, p) => [swap(s, "if (last.rsi >= 70) {", "if (last.rsi >= 60) {"), p]],
  ["Oversold candidate ungated", (s, p) => [swap(s, "if (!pickIsGreenOverallSignal(comp)) return null;", ""), p]],
  ["write-up back to the old rule", (s, p) => [s, swap(p, "RSI(14) is at 70 or above and at least one of the other five checks also fires on the overbought side", "at least two of those checks fire on the overbought side and they outnumber")]],
];
for (const [label, mutate] of SRC_MUTANTS) {
  const [s, p] = mutate(SRC, PAGE);
  check(`mutant caught: ${label}`, sourceFails(s, p).length > 0);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
