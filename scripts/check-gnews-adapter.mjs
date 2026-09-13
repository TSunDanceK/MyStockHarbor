// The Google News adapter, against REAL captured feeds.
//
// WHAT IS ACTUALLY AT RISK HERE. The query is the entire relevance mechanism
// (Google News has no notion of a ticker), and the publisher-suffix strip is the
// entire cross-source dedup — exact-link dedup cannot fire between a
// news.google.com redirect and a wire URL, so if the suffix survives into the
// store the same story renders twice. Neither failure breaks a build.
//
// THE FIXTURES ARE REAL. scripts/fixtures/gnews-{mu,cyrx}.xml are verbatim feed
// captures taken through the relay, because the sandbox is refused
// news.google.com with 403 CONNECT. The details an invented fixture gets wrong
// are exactly the ones being tested: the " - Publisher" suffix against headlines
// that contain their own hyphens, the <source> element, the guid format, and the
// 3,453-day span that makes the date filter necessary.
//
//   node scripts/check-gnews-adapter.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly, eventTypeSource } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Written to a real file rather than a data: URL because the inlined modules are
// large, and imported by absolute file URL because fs writes relative to the cwd
// while a bare "./" import resolves relative to THIS file.
const loadTs = async (source, tag) => {
  const file = path.join(ROOT, `.check-${tag}.mjs`);
  fs.writeFileSync(file, ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  try {
    return await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  } finally {
    fs.unlinkSync(file);
  }
};

// ------------------------------------------------------------- the adapter
// Its three imports are inlined from source, not stubbed: the normaliser decides
// the query and the text helpers decide the title, so a stub would test the stub.
let adapterSrc = read("lib/server/news/gnewsProvider.ts")
  .replace(/^import \{ deriveEventType \} from "\.\/eventType";$/m, () => eventTypeSource())
  .replace(/^import \{ normaliseCompanyName, assessCompanyName \} from ".\/companyName";$/m,
    () => read("lib/server/news/companyName.ts")
      .replace(/^import \{ cleanName \} from "@\/lib\/server\/companyNames";$/m,
        () => read("lib/server/companyNames.ts").replace(/^export /gm, ""))
      .replace(/^export /gm, ""))
  .replace(/^import \{ stripHtmlTags, containsHtmlMarkup, decodeHtml \} from ".\/text";$/m,
    () => read("lib/server/news/text.ts").replace(/^export /gm, ""))
  .replace(/^import type \{ NewsItem, NewsProvider \} from ".\/types";$/m, "");

if (/^import /m.test(adapterSrc)) {
  console.error("FAIL: an import survived inlining:");
  console.error(adapterSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
for (const marker of ["function normaliseCompanyName", "function stripHtmlTags", "function cleanName"]) {
  if (!adapterSrc.includes(marker)) {
    console.error(`FAIL: expected "${marker}" after inlining — a substitution silently stopped matching.`);
    process.exit(1);
  }
}
// NewsProvider is a type and the annotation goes with it.
adapterSrc = adapterSrc.replace("export const gnewsProvider: NewsProvider =", "export const gnewsProvider =");
const gnews = await loadTs(adapterSrc, "gnews");

// ------------------------------------------------- the real dedup, extracted
const newsSrc = read("lib/stock-news-data.ts");
const grab = (name) => {
  const i = newsSrc.indexOf(`function ${name}`);
  const start = newsSrc.lastIndexOf("\n", i) + 1;
  let depth = 0, end = newsSrc.indexOf("{", i);
  for (let k = end; k < newsSrc.length; k++) {
    if (newsSrc[k] === "{") depth++;
    else if (newsSrc[k] === "}") { depth--; if (!depth) { end = k; break; } }
  }
  return newsSrc.slice(start, end + 1).replace(/^export /, "");
};
const dedupe = await loadTs([
  "type NewsItem = { title: string; link: string; pubDate: string | null; source: string | null; description: string | null };",
  grab("normaliseTitleForDedupe"), grab("titleTokens"), grab("titleOverlap"),
  "const STORY_OVERLAP_THRESHOLD = 0.6;", grab("dedupeNews"),
  "export { dedupeNews };",
].join("\n"), "dedupe");

// The fixtures were captured on this date; every age assertion is relative to it
// rather than to "now", so the checks do not rot as the fixture ages.
const CAPTURED = Date.parse("2026-09-13T14:45:56Z");

console.log("\n=== 1. The query, which is the whole relevance mechanism ===\n");
check(
  'the query is the quoted company name plus "stock"',
  gnews.buildQuery("Micron Technology") === '"Micron Technology" stock'
);
check(
  "the bare ticker is never the query",
  !/[?&]q=MU(&|$)/.test(gnews.feedUrlFor("Micron Technology")) &&
    gnews.feedUrlFor("Micron Technology").includes(encodeURIComponent('"Micron Technology" stock')),
  "q=MU measured 85% — Missouri Tigers football, a Ugandan BBC story, a college soccer box score"
);
check(
  "the US locale the measurement was taken in",
  gnews.feedUrlFor("X").includes("hl=en-US&gl=US&ceid=US:en")
);

console.log("\n=== 2. The real MU feed, parsed ===\n");
const mu = gnews.parseGoogleNewsFeed(read("scripts/fixtures/gnews-mu.xml"), "MU", CAPTURED);
check("every item in the fixture parses", mu.length === 5, `${mu.length} of 5`);
// SELECTED BY PUBLISHER, NOT BY INDEX. The parser sorts newest-first, so
// fixture order is not output order — a first version of these indexed mu[0]
// and failed against a correct adapter.
const barrons = mu.find((i) => i.source === "Barron's");
check(
  "the publisher suffix is gone from the title",
  barrons?.title === "Micron Stock Slips as Intel-Backed Start-up Takes Aim at Memory-Chip Market",
  JSON.stringify(barrons?.title)
);
check(
  "...and hyphens INSIDE the headline survive",
  Boolean(barrons?.title.includes("Intel-Backed") && barrons?.title.includes("Memory-Chip")),
  "a cut at the first spaced hyphen would amputate the headline"
);
check(
  "<source> is authoritative for the publisher, not the title suffix",
  barrons !== undefined && mu.some((i) => i.source === "The Motley Fool"),
  "Barron's — an apostrophe survives entity decoding"
);
check(
  "the publisher comes from <source>, not from parsing the title",
  (() => {
    // THE DISCRIMINATING CASE, and it has to be constructed: in a real feed the
    // <source> element and the title suffix agree, so every captured item passes
    // either way. A mutation that parsed the publisher out of the title survived
    // the assertions above for exactly that reason. Here the title carries NO
    // suffix, so title-parsing yields null and only reading <source> works.
    const xml = `<rss><channel><item>` +
      `<title>Micron opens its Idaho fab</title>` +
      `<link>https://news.google.com/rss/articles/CBMiZZZ?oc=5</link>` +
      `<guid isPermaLink="false">CBMiZZZ</guid>` +
      `<pubDate>Fri, 11 Sep 2026 09:00:00 GMT</pubDate>` +
      `<source url="https://www.reuters.com">Reuters</source></item></channel></rss>`;
    const [item] = gnews.parseGoogleNewsFeed(xml, "MU", CAPTURED);
    return item?.source === "Reuters" && item?.title === "Micron opens its Idaho fab";
  })(),
  "the title suffix is not authoritative and is not always present"
);
check(
  "no title retains a ' - Publisher' tail",
  mu.every((i) => !/\s-\s[A-Z][^-]{1,30}$/.test(i.title)),
  mu.map((i) => i.title.slice(-22)).join(" | ")
);
check(
  "a multi-word publisher is stripped whole",
  mu.some((i) => i.title.endsWith("(Hint: It's Not Micron)")),
  "The Motley Fool"
);
check(
  "the guid is captured and is not the link",
  Boolean(mu[0].guid) && mu[0].guid !== mu[0].link && !mu[0].guid.startsWith("http"),
  mu[0].guid?.slice(0, 24)
);
check(
  "the link is left as the Google redirect",
  mu.every((i) => i.link.startsWith("https://news.google.com/rss/articles/")),
  "resolving it costs a request per item, is fragile, and buys nothing"
);
check(
  "description is null — the feed's own is a block of links, not a summary",
  mu.every((i) => i.description === null)
);
check(
  "the provider and the queried symbol are stamped",
  mu.every((i) => i.provider === "gnews" && i.tickers?.[0] === "MU")
);
check(
  "fmpSymbolMatched is NOT set",
  mu.every((i) => i.fmpSymbolMatched === undefined),
  "marking every item symbol-confirmed would switch off the text filter that catches the residual 2-3%"
);

console.log("\n=== 3. Dates — the CYRX case, on real items ===\n");
const cyrx = gnews.parseGoogleNewsFeed(read("scripts/fixtures/gnews-cyrx.xml"), "CYRX", CAPTURED);
check(
  "items older than the 120-day store window are dropped",
  cyrx.length === 9 && !cyrx.some((i) => Date.parse(i.pubDate) < CAPTURED - 120 * 86_400_000),
  `${cyrx.length} of 11 kept — the two 2026-05-04 items are 132 days old`
);
check(
  "...and an item just inside the window is kept",
  cyrx.some((i) => i.pubDate.includes("26 May 2026")),
  "2026-05-26 is 110 days old and must survive — a filter that drops it is too aggressive"
);
check(
  "newest first",
  cyrx.every((item, i) => i === 0 || Date.parse(cyrx[i - 1].pubDate) >= Date.parse(item.pubDate)),
  cyrx.slice(0, 2).map((i) => i.pubDate).join(" | ")
);
check(
  "the sort happens AFTER the filter",
  (() => {
    // Sorting first and filtering second reads identically and is not: only a
    // filter applied to the unsorted list can be shown to have run on all of it.
    const src = readCodeOnly("lib/server/news/gnewsProvider.ts");
    const filterAt = src.indexOf("ms < oldestAllowedMs");
    const sortAt = src.indexOf("items.sort(");
    return filterAt > 0 && sortAt > filterAt;
  })()
);

console.log("\n=== 4. Cross-source dedup — what the strip is actually for ===\n");
// THE ONLY THING TESTING THE PATH THAT MATTERS. Exact-link dedup cannot fire
// across sources: a news.google.com redirect and a globenewswire.com URL are
// never equal, so the ONLY thing that collapses the pair is title similarity.
const asGoogle = (title) => ({
  title, link: "https://news.google.com/rss/articles/CBMiabc?oc=5",
  pubDate: "2026-09-10T12:00:00Z", source: "Reuters", description: null,
});
const asWire = (title) => ({
  title, link: "https://www.globenewswire.com/news-release/2026/09/10/micron.html",
  pubDate: "2026-09-10T11:58:00Z", source: "GlobeNewswire", description: "The wire's own summary text.",
});
const GOOGLE_RAW = "Micron Beats Estimates - Reuters";
const WIRE = "Micron Technology Tops Quarterly Revenue Estimates as Memory Demand Accelerates";

check(
  "the two links are genuinely different, so link dedup cannot be what collapses them",
  asGoogle(GOOGLE_RAW).link !== asWire(WIRE).link
);
check(
  "stripped at the adapter, the same story collapses to one",
  dedupe.dedupeNews([asGoogle(gnews.stripPublisherSuffix(GOOGLE_RAW)), asWire(WIRE)]).length === 1
);
check(
  "...and WITH the suffix left on, it does not — the strip is load-bearing",
  dedupe.dedupeNews([asGoogle(GOOGLE_RAW), asWire(WIRE)]).length === 2,
  '"reuters" is not a dedup stopword, so it survives as a token and dilutes the overlap coefficient'
);
check(
  "the strip happens in the adapter, before the item is stored",
  (() => {
    // RUN, NOT GREPPED. A first version anchored on the source text of the call
    // site, which scripts/check-assertion-anchors.mjs correctly rejects: a bare
    // identifier matches a declaration as readily as a call. The behavioural
    // form is also the stronger claim — what the parser RETURNS is exactly what
    // newsStore is handed, so a stripped title here IS the proof that nothing
    // downstream has to do it.
    const raw = read("scripts/fixtures/gnews-mu.xml");
    return gnews
      .parseGoogleNewsFeed(raw, "MU", CAPTURED)
      .every((item) => !item.title.includes(" - Barron's") && !item.title.includes(" - Yahoo Finance")) &&
      raw.includes(" - Barron's</title>");
  })(),
  "stripping at display time would leave the stored and deduped copy diluted"
);
// The regime this matters in, stated rather than implied.
check(
  "a headline ending in a genuine clause is not amputated",
  gnews.stripPublisherSuffix("Micron rallies - and that is before the tariff question is even settled") ===
    "Micron rallies - and that is before the tariff question is even settled",
  "the 40-character bound is what separates a publisher from a sentence"
);
check(
  "a title that is entirely suffix-shaped is kept rather than emptied",
  gnews.stripPublisherSuffix("CYRX - Finviz") === "CYRX",
  "an empty token set is kept by dedupeNews rather than compared, so emptying a title defeats dedup"
);

console.log("\n=== 5. The constraints this step must not break ===\n");
const src = readCodeOnly("lib/server/news/gnewsProvider.ts");
check("the fetch keeps revalidate: 3600", /next: \{ revalidate: 3600 \}/.test(src));
check(
  "no AI call per item",
  !/openai|anthropic|getAiNews|fetchAi/i.test(src),
  "the page already renders the algorithmic line from lib/stock-news-templates.ts for an item with no description"
);
check(
  "Nasdaq is not reintroduced",
  !/nasdaq\.com|rssoutbound/i.test(src),
  "it answered from a residential network and refuses Vercel entirely — 25s timeout, both environments"
);
const vercel = JSON.parse(read("vercel.json"));
check(
  "still no news cron",
  (vercel.crons ?? []).filter((c) => /news/i.test(c.path)).length === 0,
  "population stays lazy; warming 755 symbols of news would dwarf every other consumer"
);
check(
  "the registry lists gnews as a free provider",
  // MEMBERSHIP, NOT THE EXACT LIST. The first version pinned
  // `= [gnewsProvider]` and broke the moment step 4 appended the wires — an
  // assertion that fails on a correct change is noise, and the claim here is
  // only that gnews is registered.
  /FREE_PROVIDERS: NewsProvider\[\] = \[[^\]]*\bgnewsProvider\b[^\]]*\]/.test(
    readCodeOnly("lib/server/news/index.ts")
  )
);
check(
  "...and the default is STILL fmp",
  /process\.env\.NEWS_PROVIDER === "free" \? "free" : "fmp"/.test(readCodeOnly("lib/server/news/index.ts")),
  "step 3 ships behind the flag; the flip is step 7"
);
check(
  "the 45-day display window applies only when the free stack is active",
  (() => {
    const page = readCodeOnly("lib/stock-news-data.ts");
    return /FREE_FEED_MAX_AGE_DAYS = 45/.test(page) &&
      /newsProviderMode\(\) === "free" \? FREE_FEED_MAX_AGE_DAYS : NEWS_FEED_MAX_AGE_DAYS/.test(page);
  })(),
  "shortening it unconditionally would change today's FMP page, and nothing may move until step 7"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
