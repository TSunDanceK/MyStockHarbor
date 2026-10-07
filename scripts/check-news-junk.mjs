// HEADLINES THAT ARE NOT NEWS (#553 COWORK #191 item 1).
//
// Runtime (lib/server/news/junkTitle.ts):
//   1. the two #807 AMZN headlines and the other shapes are caught, each with
//      its reason; the SEC adapter's own Form 4 item is exempt; a US share
//      class in brackets (BRK.B) is not a foreign listing
//   2. FALSE POSITIVES, MEASURED: of the 365 real Google News headlines in
//      scripts/fixtures/churn-sample.tsv, only the one quote page is flagged
// Source:
//   3. applied at ingest (fetchSymbolNewsWindow), to the stored set at refresh
//      and on read (symbol and sector news), and to /headlines.
// Every rule has a planted mutant.
//
//   node scripts/check-news-junk.mjs
import "./lib/register-capex-ts.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const LIB = "lib/server/news/junkTitle.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function load(src) {
  const f = path.join(ROOT, "lib", "server", "news", `.check-nj-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}
const SAMPLE = read("scripts/fixtures/churn-sample.tsv").split("\n").filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split("\t").find((x) => x.length > 25) ?? l);

function rules(J) {
  const fails = [];
  const want = (label, ok, d = "") => { if (!ok) fails.push(`${label}${d ? ` (${d})` : ""}`); };
  const cases = [
    ["Form 4 Amazon.com Inc For: 6 October", null, "filing-notice"],
    ["Amazon.com, Inc. (AMZN03.BK) stock historical prices and data", null, "quote-page"],
    ["SC 13G/A: Vanguard Group Inc reports stake", null, "filing-notice"],
    ["Schedule 13D - Elliott Investment Management", null, "filing-notice"],
    ["Toyota Motor Corp (7203.T) earnings call highlights", null, "foreign-listing"],
    ["Apple stock price today", null, "quote-page"],
    ["Form 4 — insider transaction", "sec", null],
    ["Berkshire Hathaway (BRK.B) beats on operating earnings", null, null],
    ["Have Insiders Sold Micron Technology Shares Recently?", null, null],
    ["Analysts quote record demand as Nvidia guides higher", null, null],
    ["Amazon.com Inc - Form 4 insider filing For: 6 October", null, "filing-notice"],
  ];
  for (const [t, p, want_] of cases) want(`"${t}" -> ${want_}`, J.junkReason(t, p) === want_, String(J.junkReason(t, p)));
  const flagged = SAMPLE.filter((t) => J.junkReason(t));
  want("real headlines: only the one quote page is flagged", flagged.length === 1 && /stock quote/i.test(flagged[0]), `${flagged.length}: ${flagged.slice(0, 3).join(" | ")}`);
  want("the filter form", J.isNotJunkNews({ title: "Nvidia beats", provider: "gnews" }) && !J.isNotJunkNews({ title: "Apple stock price today" }));
  return fails;
}

function sourceRules(src) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const c = (k, f) => stripComments(src[k], { file: f });
  want("ingest: fetchSymbolNewsWindow filters", /return fulfilled\.flatMap\(\(result\) => result\.value\)\.filter\(isNotJunkNews\);/.test(c("index", "index.ts")));
  want("symbol news: the stored set at refresh and on read", /dedupe: \(list\) => dedupeNews\(list\.filter\(fromActive\)\.filter\(isNotJunkNews\)\),/.test(c("stock", "stock.ts")) && /return items\.filter\(fromActive\)\.filter\(isNotJunkNews\);/.test(c("stock", "stock.ts")));
  want("sector news: at refresh, and on read after the FMP-rebuild test", /dedupe: \(items\) => dedupeNews\(items\.filter\(fromActive\)\.filter\(isNotJunkNews\)\),/.test(c("sector", "sector.ts")) && /news = news\.filter\(isNotJunkNews\);\s*const rankedNews = rankSectorNews\(news\);/.test(c("sector", "sector.ts")));
  want("/headlines", /if \(!isNotJunkNews\(item\)\) return false;/.test(c("headlines", "headlines.ts")));
  return fails;
}

try {
  const lib = read(LIB);
  console.log("\n1-2. The shapes, and false positives on real headlines");
  const r = rules(await load(lib));
  check(`filing notice, quote page, foreign listing; ${SAMPLE.length} real headlines`, r.length === 0, r.join("; "));
  console.log("\n3. Where it applies");
  const src = { index: read("lib/server/news/index.ts"), stock: read("lib/stock-news-data.ts"), sector: read("lib/sector-news-data.ts"), headlines: read("lib/server/news/headlineFeeds.ts") };
  const s = sourceRules(src);
  check("ingest, store, read, headlines", s.length === 0, s.join("; "));
  console.log("\n4. Planted mutants");
  const LM = [
    ["the SEC exemption dropped", 'if (provider !== "sec" && FILING_NOTICE', "if (FILING_NOTICE"],
    ["no foreign-listing rule", "if (FOREIGN_LISTING.test(text)) return \"foreign-listing\";", ""],
    ["a single-letter suffix counted foreign (BRK.B)", '"BK|L|IL|', '"B|BK|L|IL|'],
    ["\"quote\" alone counted a quote page", "/\\bstock quote\\b/i,", "/\\bquote\\b/i,"],
    ["the aggregator \"For:\" shape missed", "/\\bform\\s+(3|4|5|144)(\\/a)?\\b[^]*\\bfor:\\s/i,", ""],
  ];
  for (const [label, from, to] of LM) {
    if (!lib.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = rules(await load(lib.replace(from, to))); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SM = [
    ["not at ingest", "index", ".flatMap((result) => result.value).filter(isNotJunkNews);", ".flatMap((result) => result.value);"],
    ["not on read", "stock", "return items.filter(fromActive).filter(isNotJunkNews);", "return items.filter(fromActive);"],
    ["sector read filter before the rebuild test", "sector", "  news = news.filter(isNotJunkNews);\n  const rankedNews", "  const rankedNews"],
    ["/headlines unfiltered", "headlines", "  if (!isNotJunkNews(item)) return false;\n", ""],
  ];
  for (const [label, which, from, to] of SM) {
    if (!src[which].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = sourceRules({ ...src, [which]: src[which].replace(from, to) });
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
