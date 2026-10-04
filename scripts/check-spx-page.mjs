// THE SPX PAGE, REDESIGNED (#563 COWORK #90): app/markets/spx/page.tsx and the
// helpers it shares with the stock page.
//
// Rules:
//   - lib/ta/macroSupport.ts is the stock page's computeMacroSupport, exactly:
//     both run on the same bars and must agree (the copy can't drift)
//   - lib/ta/macdSeries.ts macdTone is the stock page's buildMacd tone, exactly
//   - the gauge is "Trend score" in trend words, not "Market mood" / Fear-Greed
//   - the AI market backdrop is gone (no call), the old page kept, retired
//   - every LIVE card says it is SPY and carries the Tiingo credit
//   - the sections in the brief's order; the platform buttons out of the hero
//   - the FAQ is closed native <details>, and its JSON-LD is built from it
//   - the metadata title and description are unchanged
// Mutants: each rule broken once, caught.
//
//   node scripts/check-spx-page.mjs
import fs from "node:fs";
import ts from "typescript";
import { grabFunction } from "./lib/earnings-plan.mjs";
import { stripComments } from "./lib/source-code.mjs";

const PAGE = "app/markets/spx/page.tsx", MACRO = "lib/ta/macroSupport.ts", MACD = "lib/ta/macdSeries.ts", WORDS = "lib/spxPage.ts";
const CLIENT = "app/stock/[symbol]/StockSymbolPageClient.tsx", RETIRED = "app/markets/spx/_retired/spx-page-2026-10-04.tsx.txt";
const read = (f) => fs.readFileSync(f, "utf8");
const TITLE = "S&P 500 (SPX) Analysis (2026) | Market Outlook | MyStockHarbor";
const DESC = "Learn how to analyse the S&P 500 (SPX), understand market pullbacks, and use charts, moving averages, RSI, and MACD to make calmer investing decisions.";

let n = 0;
async function mod(src) {
  const tmp = `scripts/.check-spx-page-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
// The stock page's own functions, lifted.
const client = read(CLIENT);
const P = await mod(["lastNum", "avg", "aggregateWeekly", "computeMacroSupport", "ema", "buildMacd"].map((f) => grabFunction(client, f)).join("\n") + "\nexport { computeMacroSupport, buildMacd };\n");

/** Weekdays over three years: a wave on a drift, with a few repeated lows so support zones form. */
function series(seed) {
  const out = [];
  for (let t = Date.parse("2023-10-02T00:00:00Z"), i = 0; t <= Date.parse("2026-10-02T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const b = 100 * seed + 18 * Math.sin(i / (21 + seed)) + 7 * Math.sin(i / (5 + seed / 3)) + i * 0.04 * (seed % 2 ? 1 : -0.5);
    out.push({ date: d.toISOString().slice(0, 10), open: b, high: b + 1.6, low: b - 1.4 - (i % 13 === 0 ? 2 : 0), close: b + 0.3, volume: 1e6 + (i % 9) * 1e5 });
    i++;
  }
  return out;
}
const FIXTURES = [1, 2, 3, 5, 8].map(series);

const RULES = {
  "lib/ta/macroSupport.ts returns exactly what the stock page's computeMacroSupport returns": ({ macro }) =>
    FIXTURES.every((b) => [b, b.slice(0, 400), b.slice(0, 200)].every((x) => {
      const last = x[x.length - 1].close;
      return JSON.stringify(macro.computeMacroSupport(x, last)) === JSON.stringify(P.computeMacroSupport(x, last));
    })) && FIXTURES.some((b) => P.computeMacroSupport(b, b[b.length - 1].close) !== null),
  "macdTone is the stock page's buildMacd tone on the same closes": ({ macd }) => {
    const cases = FIXTURES.flatMap((b) => [b, b.slice(0, 300), b.slice(0, 36), b.slice(0, 20)].map((x) => x.map((p) => p.close)));
    const tones = new Set(cases.map((c) => macd.macdTone(c)));
    return cases.every((c) => macd.macdTone(c) === (P.buildMacd(c)?.tone ?? null)) && tones.has("green") && tones.has("red") && tones.has(null);
  },
  "the gauge is 'Trend score', in trend words, not 'Market mood' or Fear / Greed": ({ page, words }) =>
    /<Tile label="Trend score"/.test(page) && !/Market mood|marketMood/.test(page) &&
    /not sentiment/.test(page) && /\$\{trendWords\(trend\.score\)\}/.test(page) && !/trend\.label/.test(page) &&
    [0, 20, 40, 50, 60, 80, 100].every((s) => !/fear|greed/i.test(words.trendWords(s))) &&
    words.trendWords(80) === "Strong uptrend" && words.trendWords(50) === "Mixed" && words.trendWords(20) === "Strong downtrend",
  "the AI market backdrop is not called; the old page is kept, retired and dated": ({ page }) =>
    !/getSpxMarketAnalysis|marketAnalysis/.test(page) && !/from "@\/lib\/ai-market"/.test(page) &&
    fs.existsSync("lib/ai-market.ts") && fs.existsSync(RETIRED) && /^\/\/ RETIRED 2026-10-04 \(#563 COWORK #90\)/.test(read(RETIRED)),
  "every live card says it is SPY and carries the Tiingo credit": ({ page }) =>
    /const liveLabel = onSpy \? "Shown on SPY, the ETF that tracks the S&P 500" : "Shown on the S&P 500 index";/.test(page) &&
    (page.match(/\{liveLabel\}/g) ?? []).length === 5 &&
    /<PerformanceStrip strip=\{strip\} credit=\{credit\} \/>/.test(page) && /<StockPriceChart [^>]*credit=\{credit \?\? null\} \/>/.test(page) &&
    /<ConfluenceCard [^>]*credit=\{credit\} \/>/.test(page) && /<KeyLevelsCard [^>]*credit=\{credit\} \/>/.test(page) &&
    /<LevelsSignals[\s\S]*?credit=\{credit\}\s*\/>/.test(page) &&
    /const credit = onSpy \? <a href=\{TIINGO_URL\}[^>]*>\{TIINGO_CREDIT\}<\/a> : undefined;/.test(page),
  "the sections in the brief's order, the platform buttons after the weekly chart": ({ page }) => {
    const at = (s) => page.indexOf(s);
    const order = ["<h1", "<Tile label=\"S&P 500 close\"", "<PerformanceStrip", "<StockPriceChart", "<ConfluenceCard", "<KeyLevelsCard", "<LevelsSignals",
      ">This week in 3 points<", ">What to watch<", "<SPXChartClient", "<AffiliateLink href=\"/api/go/tradingview\"", ">FAQ<"].map(at);
    return order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])) && (page.match(/<AffiliateLink /g) ?? []).length === 2;
  },
  "the FAQ: closed native <details>, its JSON-LD built from the same questions": ({ page, words }) =>
    /<details key=\{f\.q\} className="spxFaqItem"/.test(page) && !/<details[^>]*\bopen\b/.test(page) &&
    /const faqLd = faqJsonLd\(\);/.test(page) && /<script type="application\/ld\+json" dangerouslySetInnerHTML=\{\{ __html: JSON\.stringify\(faqLd\) \}\} \/>/.test(page) &&
    JSON.stringify(words.faqJsonLd().mainEntity.map((q) => [q.name, q.acceptedAnswer.text])) === JSON.stringify(words.FAQ.map((f) => [f.q, f.a])) &&
    words.FAQ.length === 4 && words.FAQ.every((f) => !/\b(should|recommend|must)\b/i.test(f.a)) &&
    /doesn't tell anyone what to do/.test(words.FAQ.find((f) => /buying opportunity/.test(f.q))?.a ?? ""),
  "the metadata title and description are unchanged": ({ raw }) =>
    (raw.match(new RegExp(`title: "${TITLE.replace(/[|()]/g, "\\$&")}"`, "g")) ?? []).length === 3 &&
    raw.split(DESC).length === 4,
};

const src = { page: read(PAGE), macro: read(MACRO), macd: read(MACD), words: read(WORDS) };
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const run = (rule, m) => { try { return !!rule(m); } catch { return false; } };
const measure = async (s) => ({ raw: s.page, page: stripComments(s.page, { file: PAGE }), macro: await mod(s.macro), macd: await mod(s.macd), words: await mod(s.words) });

console.log("=== Rules ===");
const base = await measure(src);
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));

const MUTANTS = [
  ["lib/ta/macroSupport.ts returns exactly what the stock page's computeMacroSupport returns", "macro", (s) => s.replace("const leftRight = 2;", "const leftRight = 3;")],
  ["lib/ta/macroSupport.ts returns exactly what the stock page's computeMacroSupport returns", "macro", (s) => s.replace("if (distancePct > 35) continue;", "if (distancePct > 3) continue;")],
  ["macdTone is the stock page's buildMacd tone on the same closes", "macd", (s) => s.replace("const quiet = Math.max(closes[closes.length - 1] * 0.001, 0.03);", "const quiet = 0;")],
  ["macdTone is the stock page's buildMacd tone on the same closes", "macd", (s) => s.replace('return Math.abs(p.hist) <= quiet ? "yellow" : p.hist > 0 ? "green" : "red";', 'return Math.abs(p.hist) <= quiet ? "yellow" : p.hist > 0 ? "red" : "green";')],
  ["the gauge is 'Trend score', in trend words, not 'Market mood' or Fear / Greed", "page", (s) => s.replace('<Tile label="Trend score"', '<Tile label="Market mood"')],
  ["the gauge is 'Trend score', in trend words, not 'Market mood' or Fear / Greed", "page", (s) => s.replace("${trendWords(trend.score)}", "${trend.label}")],
  ["the gauge is 'Trend score', in trend words, not 'Market mood' or Fear / Greed", "words", (s) => s.replace('"Strong uptrend"', '"Extreme Greed"')],
  ["the AI market backdrop is not called; the old page is kept, retired and dated", "page", (s) => s.replace('import { buildMarketMoodScore } from "@/lib/market-mood";', 'import { getSpxMarketAnalysis } from "@/lib/ai-market";\nimport { buildMarketMoodScore } from "@/lib/market-mood";')],
  ["every live card says it is SPY and carries the Tiingo credit", "page", (s) => s.replace("<KeyLevelsCard bars={bars} lastPrice={lastClose} nowMs={nowMs} credit={credit} />", "<KeyLevelsCard bars={bars} lastPrice={lastClose} nowMs={nowMs} />")],
  ["every live card says it is SPY and carries the Tiingo credit", "page", (s) => s.replace('"Shown on SPY, the ETF that tracks the S&P 500"', '"Shown on the S&P 500"')],
  ["every live card says it is SPY and carries the Tiingo credit", "page", (s) => s.replace("<p style={{ ...small, marginTop: 4 }}>{liveLabel}</p>\n              <PerformanceStrip", "<PerformanceStrip")],
  ["the sections in the brief's order, the platform buttons after the weekly chart", "page", (s) => s.replace("</h1>", '</h1>\n            <AffiliateLink href="/api/go/etoro" eventLabel="x" style={secondaryBtn()}>eToro</AffiliateLink>')],
  ["the FAQ: closed native <details>, its JSON-LD built from the same questions", "page", (s) => s.replace('<details key={f.q} className="spxFaqItem"', '<details open key={f.q} className="spxFaqItem"')],
  ["the FAQ: closed native <details>, its JSON-LD built from the same questions", "words", (s) => s.replace('mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q,', 'mainEntity: FAQ.slice(1).map((f) => ({ "@type": "Question", name: f.q,')],
  ["the FAQ: closed native <details>, its JSON-LD built from the same questions", "words", (s) => s.replace("This page describes the market; it doesn't tell anyone what to do.", "Investors should consider adding on dips.")],
  ["the metadata title and description are unchanged", "page", (s) => s.replace("Learn how to analyse the S&P 500 (SPX), understand market pullbacks", "Live S&P 500 (SPX) levels, zones and signals")],
];
console.log("\n=== Mutants: each must FAIL its rule ===");
for (const [label, where, mutate] of MUTANTS) {
  const mut = mutate(src[where]);
  if (mut === src[where]) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  let m;
  try { m = await measure({ ...src, [where]: mut }); } catch { m = null; }
  check(`mutant bites: ${label}`, !m || !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
