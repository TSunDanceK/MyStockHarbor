// /headlines and /sector/[slug]/news off FMP (#553 COWORK #1, 2026-09-23).
//
// WHAT IS AT RISK. Both pages called FMP directly, OUTSIDE NEWS_PROVIDER, for
// ten days after the site "left FMP" for news -- and nothing noticed, because a
// page that renders FMP articles looks exactly like one that renders free ones.
// So this check RUNS the code that now decides what those pages show, on the
// verbatim relay captures, and then proves each assertion can fail by running
// it again on a mutated copy of the source. An assertion that passes on the
// mutant is not guarding anything.
//
//   1. The headline feeds (MarketWatch, CNBC): entities decoded, editorial
//      excerpt and image NOT kept, CNBC sponsored items dropped fail-closed,
//      stale items dropped, newest first.
//   2. The market-headlines seam: on the free stack FMP is never called; under
//      the NEWS_PROVIDER=fmp rollback it is the only source; a hanging or
//      failing leg contributes nothing instead of taking the page down; the
//      footer credits the sources the feed actually used.
//   3. The sector window: FMP-era items (no provider stamp) are not shown on
//      the free stack; constituents' stored items are attributed; wire items
//      must name a constituent.
//   4. The wiring: no FMP URL or FMP copy left on either page's free path.
//
//   node scripts/check-headlines-off-fmp.mjs
import "./lib/register-ts-here.mjs";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const NOW = Date.parse("2026-09-23T20:05:00Z"); // the capture time
// The seam unref()s its timers (right for a serverless function), so with a
// deliberately hanging leg pending nothing would keep THIS process alive and
// Node would exit mid-suite. Held open here, released at the end.
const keepAlive = setInterval(() => {}, 1000);

// Load a .ts module from a (possibly mutated) source string, next to the real
// file so its relative imports resolve. Deleted straight after.
let seq = 0;
async function loadSibling(relFile, source) {
  const dir = path.dirname(path.join(ROOT, relFile));
  const file = path.join(dir, `.check-hof-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}
// Load a transpiled module whose imports have been replaced by stubs.
async function loadStubbed(source) {
  const file = path.join(ROOT, `.check-hof-${process.pid}-${seq++}.mjs`);
  fs.writeFileSync(
    file,
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText
  );
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

function mutate(src, from, to, label) {
  if (!src.includes(from)) {
    console.error(`FAIL: mutation "${label}" no longer matches its source -- update this check.`);
    process.exit(1);
  }
  return src.replace(from, to);
}

// ─────────────────────────────────────────────── 1. the headline feeds
const FEEDS_FILE = "lib/server/news/headlineFeeds.ts";
const feedsSrc = read(FEEDS_FILE);
const fixture = (id) => read(`scripts/fixtures/headline-${id}.xml`);

// Two constructed CNBC items, marked as such: a sponsored one and one with no
// flag at all. The capture held 30 items and none was sponsored, so the filter
// cannot be exercised on verbatim data alone.
const CONSTRUCTED_CNBC =
  '<item><link>https://www.cnbc.com/constructed/sponsored.html</link><metadata:sponsored>true</metadata:sponsored>' +
  "<title>CONSTRUCTED sponsored item</title><pubDate>Wed, 23 Sep 2026 18:00:00 GMT</pubDate></item>\n" +
  '<item><link>https://www.cnbc.com/constructed/unflagged.html</link>' +
  "<title>CONSTRUCTED item with no sponsored flag</title><pubDate>Wed, 23 Sep 2026 18:00:00 GMT</pubDate></item>";

async function suiteFeeds(mod) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const [mwFeed, cnbcFeed] = ["marketwatch", "cnbc"].map((id) => mod.HEADLINE_FEEDS.find((f) => f.id === id));

  const mw = mod.parseHeadlineFeed(fixture("marketwatch"), mwFeed, NOW);
  ok("MarketWatch: all 5 captured items parse", mw.length === 5, `got ${mw.length}`);
  ok("MarketWatch: no raw entity reaches a title (&#x2014; / &#x2019;)",
    mw.every((i) => !/&#|&apos;|&amp;/.test(i.title)),
    mw.map((i) => i.title).find((t) => /&#|&apos;/.test(t)) ?? "");
  ok("MarketWatch: the em dash and curly apostrophe survive as characters",
    mw.some((i) => i.title.includes("McDonald’s") && i.title.includes("—")));

  const cnbc = mod.parseHeadlineFeed(fixture("cnbc") + "\n" + CONSTRUCTED_CNBC, cnbcFeed, NOW);
  const titles = cnbc.map((i) => i.title);
  ok("CNBC: a sponsored item is dropped", !titles.some((t) => /CONSTRUCTED sponsored/.test(t)));
  ok("CNBC: an item with NO sponsored flag is dropped (fail-closed, spec §4)",
    !titles.some((t) => /no sponsored flag/.test(t)));
  ok("CNBC: &apos; is decoded", titles.some((t) => t.startsWith("Here's what happens")) && titles.every((t) => !t.includes("&apos;")));
  ok("CNBC: the 12 Sep item (11 days old) is dropped by the age window",
    !titles.some((t) => /outpacing wage growth/.test(t)));
  ok("CNBC: the 17 Sep item (6 days old) is kept", titles.some((t) => /Bank of England defies/.test(t)));
  const times = cnbc.map((i) => Date.parse(i.pubDate));
  ok("CNBC: newest first, although the feed itself is not ordered",
    times.every((t, k) => k === 0 || times[k - 1] >= t));

  const all = [...mw, ...cnbc];
  ok("editorial feeds keep NO excerpt (spec §2: only the wires may)", all.every((i) => i.description === null));
  ok("editorial feeds keep NO image", all.every((i) => i.image === null && i.imageVerdict === "deny"));
  ok("every item says which feed it came from",
    mw.every((i) => i.provider === "marketwatch" && i.source === "MarketWatch") &&
      cnbc.every((i) => i.provider === "cnbc" && i.source === "CNBC"));

  // keepForHeadlines: GlobeNewswire needs a US ticker; PR Newswire is kept whole.
  const gnwForeign = { title: "t", link: "l1", pubDate: null, source: "GlobeNewswire", description: null, provider: "wire", tickers: [] };
  const gnwUs = { ...gnwForeign, link: "l2", tickers: ["TOL"] };
  const prn = { ...gnwForeign, link: "l3", source: "PR Newswire" };
  ok("a GlobeNewswire item with no US ticker is not a market headline", !mod.keepForHeadlines(gnwForeign));
  ok("a GlobeNewswire item tagged with a US listing is", mod.keepForHeadlines(gnwUs));
  ok("PR Newswire items are kept whole", mod.keepForHeadlines(prn));

  // composeHeadlines: newest first, dedupe applied, capped, excerpt only from description.
  let dedupeCalls = 0;
  const byTitle = (items) => { dedupeCalls++; const seen = new Set(); return items.filter((i) => !seen.has(i.title) && seen.add(i.title)); };
  const many = Array.from({ length: 70 }, (_, k) => ({
    title: `h${k}`, link: `https://x/${k}`, pubDate: new Date(NOW - k * 60_000).toUTCString(),
    source: "CNBC", description: null, provider: "cnbc",
  }));
  const dup = { ...many[3], link: "https://y/dup" };
  const composed = mod.composeHeadlines([...many].reverse().concat(dup, gnwForeign), byTitle);
  ok("compose: the page's dedup is applied", dedupeCalls === 1 && composed.filter((h) => h.title === "h3").length === 1);
  ok("compose: capped at 50", composed.length === 50, `got ${composed.length}`);
  ok("compose: newest first", composed[0]?.title === "h0" && composed[49]?.title === "h49");
  ok("compose: the GlobeNewswire rule is applied", !composed.some((h) => h.url === "l1"));
  const wireItem = { ...prn, link: "https://w/1", pubDate: new Date(NOW).toUTCString(), description: "A wire release excerpt." };
  const [w] = mod.composeHeadlines([wireItem], byTitle);
  ok("compose: a wire description becomes the excerpt", w.excerpt === "A wire release excerpt.");

  // ── COWORK #11 fixes on #558 ─────────────────────────────────────────────
  const at = (min) => new Date(NOW - min * 60_000).toUTCString();
  const wireBase = { link: "", source: "PR Newswire", description: null, provider: "wire" };
  const [dec] = mod.composeHeadlines([{ ...wireBase, title: "FEMSA M&#233;xico&#160;results", link: "d1", pubDate: at(1), description: "Ventas&#160;en M&#233;xico" }], (x) => x);
  ok("DECIMAL entities decoded on every source (M&#233;xico, &#160;)", dec?.title === "FEMSA México results" && dec?.excerpt === "Ventas en México", `${dec?.title} | ${dec?.excerpt}`);
  const es = { ...wireBase, title: "FEMSA anuncia resultados", link: "es1", pubDate: at(2), language: "es", issuer: "FEMSA" };
  const en = { ...wireBase, title: "FEMSA announces results", link: "en1", pubDate: at(3), language: "en", issuer: "FEMSA" };
  ok("a non-English wire item is not a headline (dc:language)", !mod.keepForHeadlines(es) && mod.keepForHeadlines(en));
  ok("an item with no language tag passes (MarketWatch/CNBC send none)", mod.keepForHeadlines({ ...en, language: null }));
  const twins = mod.composeHeadlines([
    { ...en, link: "a", title: "FEMSA third quarter release", pubDate: at(1) },
    { ...en, link: "b", title: "FEMSA quarterly earnings materials posted", pubDate: at(9) },
    { ...en, link: "c", title: "FEMSA investor day announced", pubDate: at(40) },
    { ...en, link: "d", title: "Another release entirely", pubDate: at(2), issuer: "Acme Corp" },
    { ...en, link: "e", title: "No issuer named one", pubDate: at(1), issuer: null },
    { ...en, link: "f", title: "No issuer named two", pubDate: at(2), issuer: null },
  ], (x) => x).map((h) => h.url);
  ok("same-issuer releases within 15 minutes collapse to one; later ones and other issuers stay",
    twins.includes("a") && !twins.includes("b") && twins.includes("c") && twins.includes("d"), twins.join(","));
  ok("items with no issuer are never collapsed together", twins.includes("e") && twins.includes("f"));
  return fails;
}

// ─────────────────────────────────────────────── 2. the market-headlines seam
const SEAM_FILE = "lib/server/news/marketHeadlines.ts";
const seamSrc = read(SEAM_FILE);

function stubSeam(src) {
  const replaced = src
    .replace(/^import \{ activeNewsProviders, ADAPTER_TIMEOUT_MS, newsProviderMode \} from "\.\/index";$/m,
      "const activeNewsProviders = () => globalThis.__hof.active;\n" +
        "const ADAPTER_TIMEOUT_MS = 60;\n" +
        "const newsProviderMode = () => globalThis.__hof.mode;")
    .replace(/^import \{ fmpNewsProvider \} from "\.\/fmpProvider";$/m,
      "const fmpNewsProvider = { id: 'fmp', fetchMarket: async () => { globalThis.__hof.fmpCalls++; return [{ title: 'from fmp', link: 'f', provider: 'fmp' }]; } };")
    .replace(/^import \{ fetchHeadlineFeeds, HEADLINE_FEEDS \} from "\.\/headlineFeeds";$/m,
      "const fetchHeadlineFeeds = async () => [{ title: 'from cnbc', link: 'c', provider: 'cnbc' }];\n" +
        "const HEADLINE_FEEDS = [{ label: 'MarketWatch' }, { label: 'CNBC' }];")
    .replace(/^import type \{ NewsItem \} from "\.\/types";$/m, "");
  if (/^import /m.test(replaced)) {
    console.error("FAIL: an import in marketHeadlines.ts survived stubbing:\n" +
      replaced.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
    process.exit(1);
  }
  return replaced;
}

async function suiteSeam(mod) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const wire = { id: "wire", fetchMarket: async () => [{ title: "from wire", link: "w", provider: "wire" }] };
  const hanging = { id: "gnews", fetchMarket: () => new Promise(() => {}) };
  const failing = { id: "sec", fetchMarket: async () => { throw new Error("sec is down"); } };

  globalThis.__hof = { mode: "free", active: [wire, hanging, failing], fmpCalls: 0 };
  const free = await mod.fetchMarketHeadlines();
  ok("free stack: FMP is never called", globalThis.__hof.fmpCalls === 0, `${globalThis.__hof.fmpCalls} call(s)`);
  ok("free stack: the headline feeds and the providers' market legs are both read",
    free.some((i) => i.provider === "cnbc") && free.some((i) => i.provider === "wire"));
  ok("free stack: a hanging leg and a failing leg contribute nothing and take nothing down",
    free.length === 2, `got ${free.length}`);
  const freeLabels = mod.marketHeadlineSourceLabels().join(" ");
  ok("free stack: the footer credits the feeds actually read, and not FMP",
    /MarketWatch/.test(freeLabels) && /CNBC/.test(freeLabels) && /GlobeNewswire/.test(freeLabels) &&
      /PR Newswire/.test(freeLabels) && !/Financial Modeling Prep|financialmodelingprep/i.test(freeLabels), freeLabels);

  globalThis.__hof = { mode: "fmp", active: [wire], fmpCalls: 0 };
  const fmp = await mod.fetchMarketHeadlines();
  ok("NEWS_PROVIDER=fmp rollback: FMP is the only source", globalThis.__hof.fmpCalls === 1 && fmp.length === 1 && fmp[0].provider === "fmp");
  ok("NEWS_PROVIDER=fmp rollback: the footer says so", mod.marketHeadlineSourceLabels().join() === "Financial Modeling Prep");
  return fails;
}

// ─────────────────────────────────────────────── 3. the sector window
const SECTOR_FILE = "lib/server/news/sectorWindow.ts";
const sectorSrc = read(SECTOR_FILE);

async function suiteSector(mod) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const active = new Set(["gnews", "wire", "sec"]);
  const gnews = { title: "Apple ships", link: "g1", pubDate: null, source: "Reuters", description: null, provider: "gnews", tickers: ["AAPL"] };
  const secNoTicker = { title: "Form 8-K", link: "s1", pubDate: null, source: "SEC", description: null, provider: "sec" };
  const legacyFmp = { title: "Old FMP story", link: "f1", pubDate: null, source: "Benzinga", description: null, fmpSymbols: ["AAPL"] };
  const stampedFmp = { ...legacyFmp, link: "f2", provider: "fmp" };
  const offSector = { ...gnews, link: "g2", tickers: ["XOM"] };
  const wireIn = { title: "Release", link: "w1", pubDate: null, source: "GlobeNewswire", description: null, provider: "wire", tickers: ["MSFT"] };
  const wireOut = { ...wireIn, link: "w2", tickers: ["TOL"] };

  const stored = new Map([
    ["AAPL", [gnews, secNoTicker, legacyFmp, stampedFmp]],
    ["XOM", [offSector]],
  ]);
  const pools = mod.composeFreeSectorPools(["AAPL", "MSFT"], stored, [wireIn, wireOut], active);
  const flat = pools.flat();
  const links = flat.map((i) => i.link);
  ok("an FMP-era item with no provider stamp is not shown on the free stack", !links.includes("f1"));
  ok("an item stamped provider=fmp is not shown on the free stack", !links.includes("f2"));
  ok("a constituent's free items are kept", links.includes("g1") && links.includes("s1"));
  ok("a stored item is attributed to its constituent even when its adapter named none",
    (flat.find((i) => i.link === "s1")?.tickers ?? []).includes("AAPL"));
  ok("a symbol outside the sector contributes nothing", !links.includes("g2"));
  ok("a wire item naming a constituent is kept", links.includes("w1"));
  ok("a wire item naming no constituent is not", !links.includes("w2"));

  ok("isFromActiveProvider: the fmp rollback shows everything, as before",
    mod.isFromActiveProvider(legacyFmp, active, "fmp") && mod.isFromActiveProvider(gnews, active, "fmp"));
  ok("isFromActiveProvider: free drops unstamped and fmp items, keeps active ones",
    !mod.isFromActiveProvider(legacyFmp, active, "free") && !mod.isFromActiveProvider(stampedFmp, active, "free") &&
      mod.isFromActiveProvider(gnews, active, "free"));
  const spanish = { ...wireIn, link: "w3", language: "es" };
  const flat2 = mod.composeFreeSectorPools(["MSFT"], new Map(), [spanish, wireIn], active).flat().map((i) => i.link);
  ok("a non-English wire release is not added to a sector feed", !flat2.includes("w3") && flat2.includes("w1"));
  ok("attributedSymbols reads BOTH fields", mod.attributedSymbols({ ...legacyFmp, tickers: ["MSFT"] }).join() === "AAPL,MSFT");
  return fails;
}

// ─────────────────────────────────────────────── run, then run the mutants
let failures = 0;
function report(title, fails) {
  console.log(`\n=== ${title} ===`);
  if (!fails.length) console.log("  PASS  every assertion");
  for (const f of fails) console.log(`  FAIL  ${f}`);
  failures += fails.length;
}
function reportMutant(label, fails) {
  const caught = fails.length > 0;
  console.log(`  ${caught ? "PASS" : "FAIL"}  mutant caught: ${label}${caught ? ` (${fails[0]})` : " — NOTHING FAILED, so that assertion guards nothing"}`);
  if (!caught) failures++;
}

report("1. headline feeds (verbatim relay captures)", await suiteFeeds(await loadSibling(FEEDS_FILE, feedsSrc)));
report("2. market-headlines seam", await suiteSeam(await loadStubbed(stubSeam(seamSrc))));
report("3. sector window", await suiteSector(await loadSibling(SECTOR_FILE, sectorSrc)));

console.log("\n=== mutants (each must make something above fail) ===");
const FEED_MUTANTS = [
  ["sponsored filter removed",
    `if (feed.id === "cnbc" && clean(tag1(block, "metadata:sponsored")).toLowerCase() !== "false") continue;`, ""],
  ["sponsored filter fails OPEN (unflagged kept)",
    `clean(tag1(block, "metadata:sponsored")).toLowerCase() !== "false"`, `clean(tag1(block, "metadata:sponsored")).toLowerCase() === "true"`],
  ["entity decoding removed", `(v == null ? "" : decodeFeedEntities(stripHtmlTags(v)).trim())`, `(v == null ? "" : stripHtmlTags(v).trim())`],
  ["editorial excerpt kept", `      description: null,\n      image: null,`, `      description: clean(tag1(block, "description")) || null,\n      image: null,`],
  ["age window removed", `ms < oldestAllowedMs || `, ""],
  ["GlobeNewswire US-ticker rule removed",
    `return !(item.provider === "wire" && item.source === "GlobeNewswire" && !item.tickers?.length);`, "return true;"],
  ["dedupe not applied", `newestFirst(dedupe(newestFirst(items.filter(keepForHeadlines))))`, `newestFirst(newestFirst(items.filter(keepForHeadlines)))`],
];
for (const [label, from, to] of FEED_MUTANTS) {
  reportMutant(label, await suiteFeeds(await loadSibling(FEEDS_FILE, mutate(feedsSrc, from, to, label))));
}
const SEAM_MUTANTS = [
  ["rollback branch removed (fmp mode reads the free stack)", `if (newsProviderMode() === "fmp") {`, `if (false) {`],
  ["FMP added as a free leg", `    fetchHeadlineFeeds(),\n`, `    fetchHeadlineFeeds(),\n    fmpNewsProvider.fetchMarket(),\n`],
  ["legs not bounded (a hanging leg hangs the page)",
    `].map((leg) => settleWithin(leg, ADAPTER_TIMEOUT_MS, [] as NewsItem[]));`, `].map((leg) => leg.catch(() => [] as NewsItem[]));`],
  ["footer credits FMP on the free stack", `return [...HEADLINE_FEEDS.map((feed) => feed.label), "GlobeNewswire", "PR Newswire"];`,
    `return ["Financial Modeling Prep"];`],
];
for (const [label, from, to] of SEAM_MUTANTS) {
  const src = mutate(seamSrc, from, to, label);
  // A hanging leg would hang the suite itself on the unbounded mutant: race it.
  const fails = await Promise.race([
    loadStubbed(stubSeam(src)).then(suiteSeam),
    new Promise((r) => setTimeout(() => r(["the seam never settled with a hanging leg"]), 1500)),
  ]);
  reportMutant(label, fails);
}
FEED_MUTANTS.push(
  ["non-English kept", "  if (!isEnglish(item)) return false;\n", ""],
  ["decimal entities left raw", "      title: tidy(item.title),", "      title: item.title,"],
  ["same-issuer collapse removed", "return collapseSameIssuer(newestFirst(", "return ((x) => x)(newestFirst("],
  ["issuer-less items collapsed together", "const dup = issuer && kept.some(", "const dup = kept.some("],
);
for (const [label, from, to] of FEED_MUTANTS.slice(-4)) {
  reportMutant(label, await suiteFeeds(await loadSibling(FEEDS_FILE, mutate(feedsSrc, from, to, label))));
}
const SECTOR_MUTANTS = [
  ["unstamped (FMP-era) items pass the provider filter",
    `return typeof item.provider === "string" && activeIds.has(item.provider);`, `return !item.provider || activeIds.has(item.provider);`],
  ["attribution reads fmpSymbols only", `return [...(item.fmpSymbols ?? []), ...(item.tickers ?? [])];`, `return [...(item.fmpSymbols ?? [])];`],
  ["wire items not filtered to constituents", `(item.tickers ?? []).some((t) => constituentSet.has(t))`, `true`],
  ["non-English wire kept on sector pages", `!(item.language && !/^en(-|$)/i.test(item.language.trim())) &&`, ``],
];
for (const [label, from, to] of SECTOR_MUTANTS) {
  reportMutant(label, await suiteSector(await loadSibling(SECTOR_FILE, mutate(sectorSrc, from, to, label))));
}

// ─────────────────────────────────────────────── 4. the wiring, in code only
console.log("\n=== 4. wiring (comments stripped) ===");
const code = (p) => readCodeOnly(p);
// ── the sector hero copy with no headlines (COWORK #11) ────────────────
const tpl = await loadSibling("lib/sector-news-templates.ts", read("lib/sector-news-templates.ts"));
const techSector = { slug: "technology", name: "Technology" };
const leadEmpty = tpl.buildSectorLead({ sector: techSector, newsScore: { tone: "yellow" }, articleCount: 0, constituentCount: 40, dayMove: null, rank: null });
const readEmpty = tpl.buildSectorRead({ sector: techSector, newsScore: { tone: "yellow" }, earningsLabel: "", breadth: null, performance: { day: 0, week: 0, month: 2, ytd: 0 }, topMentions: [], earningsCount: 0, articleCount: 0 }).join(" ");
const leadFull = tpl.buildSectorLead({ sector: techSector, newsScore: { tone: "yellow" }, articleCount: 12, constituentCount: 40, dayMove: null, rank: null });
console.log("\n=== sector hero copy ===");
for (const [label, pass] of [
  ["no headlines: the lead claims no tone ('reading mixed' is gone)", !/reading (mixed|constructive|pressured)/.test(leadEmpty) && /No recent headlines/.test(leadEmpty)],
  ["no headlines: the read claims no lean and no price-vs-headlines comparison", !/leaning|headlines read/.test(readEmpty) && /no recent technology headlines/i.test(readEmpty)],
  ["with headlines: the tone sentence is unchanged", /headlines are currently reading mixed/.test(leadFull)],
]) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}

const wiring = [
  ["lib/general-market-news.ts builds no FMP URL and makes no metered FMP call",
    !/financialmodelingprep|fmpFetch/.test(code("lib/general-market-news.ts"))],
  ["lib/general-market-news.ts reads through the provider seam",
    /composeHeadlines\(await fetchMarketHeadlines\(\), dedupeNews\)/.test(code("lib/general-market-news.ts"))],
  ["/headlines: no FMP name in the page's code or copy",
    !/financialmodelingprep|Financial Modeling Prep|\bFMP\b/.test(code("app/headlines/page.tsx"))],
  ["/headlines: the footer is the provider-derived phrase", /headlineSourcesText\(\)/.test(code("app/headlines/page.tsx"))],
  ["sector news: the FMP window is reached only under the rollback",
    /onFmp \? fetchFmpSectorNewsWindow\(constituents, from\) : fetchFreeSectorNewsWindow\(constituents\)/.test(code("lib/sector-news-data.ts"))],
  ["sector news: FMP-era items are PURGED from the sector record at its next refresh (the store's dedupe step)",
    /dedupe: \(items\) => dedupeNews\(items\.filter\(fromActive\)\)/.test(code("lib/sector-news-data.ts"))],
  ["sector news: and filtered on read while a pre-change record is still cached",
    /(?:const|let) news = stored\.filter\(fromActive\)/.test(code("lib/sector-news-data.ts")) &&
      /const fromActive = \(item: NewsItem\) => isFromActiveProvider\(item, activeIds, mode\)/.test(code("lib/sector-news-data.ts"))],
  ["sector news: a record the filter had to thin is REBUILT now, not after the hour (the empty-preview cause)",
    /if \(!onFmp && news\.length < stored\.length\) \{\s*const fresh = await fetchFreeSectorNewsWindow\(constituents\)/.test(code("lib/sector-news-data.ts"))],
  ["sector news: the page passes the article count to the read", /articleCount: data\.rankedNews\.length,/.test(code("app/sector/[slug]/news/page.tsx"))],
  ["sector news: no reader-visible 'FMP did not return' copy", !/FMP did not return/.test(code("lib/sector-news-data.ts"))],
  ["sector news: the constituents' stores are read in ONE command (MGET), not one GET each",
    /redis\.mget</.test(code("lib/server/newsStore.ts")) && /readStoredSymbolNews<NewsItem>\(symbols\)/.test(code("lib/sector-news-data.ts"))],
  ["both page caches were re-keyed, so no pre-change FMP payload is served after deploy",
    /msh-general-market-headlines-v2/.test(code("lib/general-market-news.ts")) && /msh-sector-news-base-data-v2/.test(code("lib/sector-news-data.ts"))],
  ["the quote no longer stamps FMP as its source", !/source: "financialmodelingprep\.com"/.test(code("lib/server/quoteData.ts"))],
  ["the dashboard footer has no FMP fallback", !/financialmodelingprep/.test(code("app/components/DashboardClient.tsx"))],
  ["the benchmark tiles are not labelled (FMP)", !/\(FMP\)/.test(code("lib/server/benchmarksBuilder.ts"))],
];
for (const [label, pass] of wiring) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failures++;
}

clearInterval(keepAlive);
console.log(failures ? `\nFAILED (${failures})` : "\nall passed");
process.exit(failures ? 1 : 0);
