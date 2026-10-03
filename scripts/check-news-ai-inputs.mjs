// The news page's two AI calls get NON-PRICE inputs only (#563 COWORK #31 (b);
// Tiingo contract §5.3(x)): getAiNewsInsight ("Beyond the headline") and
// getAiNewsBriefs ("Why this matters").
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A PRICE-DERIVED FIELD IN THE PROMPT: trend (from MA50/MA200), RSI, the
//      distance from a moving average, the recent high/low, or a price. Once the
//      page's history moves to Tiingo, any of these would put licensed price
//      data into model output.
//   2. AN EXTRA FIELD RIDING THROUGH: TypeScript lets an object with more fields
//      than the input type through structurally, and the payload is
//      JSON.stringify'd into the prompt, so a caller passing its whole data
//      object would leak every price field it holds. The allow-list inside
//      lib/ai-news-briefs.ts is the guard; section 1 attacks it with a payload
//      stuffed with price fields and reads what would be sent.
//   3. THE PROMPT ASKS FOR CHART CONTEXT it no longer has, inviting the model to
//      make price claims up.
//   4. A CALLER PUTS THEM BACK (the two routes and lib/stock-news-data.ts).
//
// The deterministic fallback text (lib/stock-news-templates.ts) may still use
// the figures: it is not AI output, and the page shows those figures as plain
// numbers in its technical read.
//
//   node scripts/check-news-ai-inputs.mjs
import { register } from "node:module";
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const raw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const code = (p) => stripComments(raw(p), { file: p });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const AI = "lib/ai-news-briefs.ts";
const DATA = "lib/stock-news-data.ts";
const INSIGHT_ROUTE = "app/api/stock-news/insight/route.ts";
const WHY_ROUTE = "app/api/stock-news/why-it-matters/route.ts";

/** Field names that carry a price or something computed from one. */
const PRICE_KEY = /^(trend|rsi|lastRsi|priceVs50|priceVs200|recentHigh|recentLow|price|lastClose|ma50|ma200|lastMA50|lastMA200|high|low|close|open|volume|change|changePercent)$/i;
const INSIGHT_KEYS = ["companyName", "earningsTone", "items", "newsScoreLabel", "newsScoreValue", "symbol"];
const INSIGHT_ITEM_KEYS = ["description", "pubDate", "source", "summary", "title", "whyItMatters"];
const BRIEFS_KEYS = ["companyName", "items", "newsScoreLabel", "symbol"];
const BRIEFS_ITEM_KEYS = ["description", "pubDate", "source", "title"];

const PRICE_STUFFING = {
  trend: "Uptrend", rsi: 61.2, lastRsi: 61.2, priceVs50: 4.1, priceVs200: 12.3,
  recentHigh: 210.5, recentLow: 180.2, price: 205.1, lastClose: 204.9, ma50: 197, ma200: 182,
};
const article = { title: "Company signs supply deal", source: "Wire", pubDate: "2026-10-02", description: "A deal was announced." };

/** Every key in a JSON value, at any depth. */
const allKeys = (v) =>
  v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => (Array.isArray(v) ? allKeys(x) : [k, ...allKeys(x)])) : [];
const sameKeys = (o, keys) => o && typeof o === "object" && JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys);

/** Load the AI module (from `src` when given, as a temp copy) and capture what each call would send. */
let loads = 0;
async function measure(src) {
  let file = path.join(ROOT, AI);
  if (src !== undefined) {
    file = path.join(os.tmpdir(), `check-news-ai-inputs-${process.pid}-${loads++}.ts`);
    fs.writeFileSync(file, src);
  }
  const sent = [];
  const realFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "check-only";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ system: body.input[0].content[0].text, user: JSON.parse(body.input[1].content[0].text) });
    return new Response(JSON.stringify({ output_text: "{}" }), { status: 200 });
  };
  try {
    const M = await import(`${pathToFileURL(file).href}?n=${loads}`);
    await M.getAiNewsInsight({
      symbol: "TEST", companyName: "Test Co", newsScoreLabel: "Positive", newsScoreValue: 64, earningsTone: "Improving",
      ...PRICE_STUFFING,
      items: [{ ...article, summary: article.description, whyItMatters: null, ...PRICE_STUFFING }],
    });
    await M.getAiNewsBriefs({
      symbol: "TEST", companyName: "Test Co", newsScoreLabel: "Positive",
      ...PRICE_STUFFING,
      items: [{ ...article, ...PRICE_STUFFING }],
    });
  } finally {
    globalThis.fetch = realFetch;
    if (src !== undefined) fs.rmSync(file, { force: true });
  }
  const [insight, briefs] = sent;
  return { insight, briefs };
}

const rules = {
  "insight: exactly the non-price fields reach the model": ({ insight }) =>
    sameKeys(insight?.user, INSIGHT_KEYS) && insight.user.items.every((i) => sameKeys(i, INSIGHT_ITEM_KEYS)),
  "briefs: exactly the non-price fields reach the model": ({ briefs }) =>
    sameKeys(briefs?.user, BRIEFS_KEYS) && briefs.user.items.every((i) => sameKeys(i, BRIEFS_ITEM_KEYS)),
  "no price-derived key anywhere in either payload": ({ insight, briefs }) =>
    !!insight && !!briefs && ![...allKeys(insight.user), ...allKeys(briefs.user)].some((k) => PRICE_KEY.test(k)),
  "neither prompt asks for price or chart context": ({ insight, briefs }) =>
    [insight?.system, briefs?.system].every((s) => {
      const useOnly = /Use only the provided [^.]*\./.exec(s ?? "")?.[0] ?? "";
      return useOnly && !/trend|RSI|moving average|range|chart|price/i.test(useOnly) &&
        /You are given no price or chart data/.test(s) && !/combine that with the chart context|or the chart\./.test(s) &&
        // No vendor named in model-only text either (#563 COWORK #42/#45 nit).
        !/\bFMP\b/.test(s);
    }),
};

/** The object literal passed to a call or assigned to a name, as source text. */
const literalAfter = (src, marker) => {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return null;
};
const PRICE_FIELD_IN_SOURCE = /\b(trend|rsi|lastRsi|priceVs50|priceVs200|recentHigh|recentLow)\b/;

const staticRules = {
  "lib/stock-news-data.ts passes no price field to either AI call": (s) => {
    const a = literalAfter(s[DATA], "getAiNewsBriefs("), b = literalAfter(s[DATA], "getAiNewsInsight(");
    return !!a && !!b && !PRICE_FIELD_IN_SOURCE.test(a) && !PRICE_FIELD_IN_SOURCE.test(b);
  },
  "the insight route's AI payload carries no price field": (s) => {
    const t = literalAfter(s[INSIGHT_ROUTE], "type CachedPayload"), p = literalAfter(s[INSIGHT_ROUTE], "const payload: CachedPayload");
    return !!t && !!p && !PRICE_FIELD_IN_SOURCE.test(t) && !PRICE_FIELD_IN_SOURCE.test(p);
  },
  "the why-it-matters route's AI payload carries no price field": (s) => {
    const t = literalAfter(s[WHY_ROUTE], "type CachedPayload"), p = literalAfter(s[WHY_ROUTE], "const payload: CachedPayload");
    const call = literalAfter(s[WHY_ROUTE], "getAiNewsBriefs(");
    return !!t && !!p && !!call && ![t, p, call].some((x) => PRICE_FIELD_IN_SOURCE.test(x));
  },
  "the AI module's input types declare no price field": (s) => {
    const a = literalAfter(s[AI], "type BatchInput"), b = literalAfter(s[AI], "type InsightInput");
    return !!a && !!b && !PRICE_FIELD_IN_SOURCE.test(a) && !PRICE_FIELD_IN_SOURCE.test(b);
  },
  "the AI module imports nothing but next/cache": (s) =>
    [...s[AI].matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]).join(",") === "next/cache",
};

console.log("\n=== 1. What would reach the model, from a payload stuffed with price fields ===\n");
const base = await measure();
for (const [name, rule] of Object.entries(rules)) check(name, rule(base));

console.log("\n=== 2. The callers and the types ===\n");
const SRC = Object.fromEntries([AI, DATA, INSIGHT_ROUTE, WHY_ROUTE].map((f) => [f, code(f)]));
for (const [name, rule] of Object.entries(staticRules)) check(name, rule(SRC));

console.log("\n=== 3. Mutants: each must FAIL its rule ===\n");
const AI_SRC = raw(AI);
const mutants = [
  ["insight: exactly the non-price fields reach the model", (s) => s.replace("JSON.stringify(insightAiPayload(input))", "JSON.stringify(input)")],
  ["briefs: exactly the non-price fields reach the model", (s) => s.replace("JSON.stringify(briefsAiPayload(input))", "JSON.stringify(input)")],
  ["no price-derived key anywhere in either payload", (s) => s.replace("    earningsTone: input.earningsTone,\n", "    earningsTone: input.earningsTone,\n    ...({ rsi: (input as Record<string, unknown>).rsi } as object),\n")],
  ["neither prompt asks for price or chart context", (s) => s.replace("company name, news score, earnings tone, and the provided", "company name, trend, news score, earnings tone, RSI, and the provided")],
  ["neither prompt asks for price or chart context", (s) => s.replace("original headline and feed excerpt,", "original headline and FMP feed excerpt,")],
];
for (const [name, mutate] of mutants) {
  const m = mutate(AI_SRC);
  let bites = false;
  try { bites = !rules[name](await measure(m)); } catch { bites = true; }
  check(`mutant bites: ${name}`, m !== AI_SRC && bites, m === AI_SRC ? "the mutation did not apply" : "");
}
const staticMutants = [
  ["lib/stock-news-data.ts passes no price field to either AI call", DATA, (s) => s.replace("newsScoreLabel: newsScore.label,\n          newsScoreValue", "newsScoreLabel: newsScore.label,\n          rsi: 1,\n          newsScoreValue")],
  ["lib/stock-news-data.ts passes no price field to either AI call", DATA, (s) => s.replace("getAiNewsBriefs({", "getAiNewsBriefs({ trend,")],
  ["the insight route's AI payload carries no price field", INSIGHT_ROUTE, (s) => s.replace("earningsTone: earningsToneLabel,", "earningsTone: earningsToneLabel,\n    rsi,")],
  ["the why-it-matters route's AI payload carries no price field", WHY_ROUTE, (s) => s.replace("companyName: payload.companyName,", "companyName: payload.companyName,\n      trend: null,")],
  ["the AI module's input types declare no price field", AI, (s) => s.replace("type BatchInput = {", "type BatchInput = {\n  trend: string | null;")],
  ["the AI module imports nothing but next/cache", AI, (s) => `import { readTiingoHistory } from "@/lib/server/marketData/read";\n${s}`],
];
for (const [name, file, mutate] of staticMutants) {
  const m = mutate(SRC[file]);
  check(`mutant bites: ${name}`, m !== SRC[file] && !staticRules[name]({ ...SRC, [file]: m }), m === SRC[file] ? "the mutation did not apply" : "");
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
