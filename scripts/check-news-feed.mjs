// Pins the news score's time window, the feed's shape, and the dedup rule.
//
// THE BUG THIS EXISTS FOR. scoreNews took `.slice(0, 5)` of rankNews output and
// applied position weights of 1.35 / 1.18 / 1.02 / 0.9. rankNews sorts by
// scoreNewsItem with date only as a TIEBREAK -- so the five headlines being
// scored were the most DRAMATIC ever returned for the ticker, not the most
// recent, and a six-month-old headline could take the 1.35x first-position
// weight. Confidence counted how many of them tripped a keyword, so five emotive
// articles from last spring read "High" while a page with genuinely fresh news
// read "Low". The page says the tone reads "right now". It did not.
//
// Nothing about that is visible: every number renders, every label is a real
// label, the build is green. Only the date of the evidence was wrong.
//
// THE REAL MODULE IS RUN, not a copy of it. lib/stock-news-data.ts has five
// imports; four are stubbed and keywordHits is inlined from its real source, so
// what executes below is the shipping file rather than a paraphrase of it
// (claude/traps/two-validators-for-one-value.md).
//
//   node scripts/check-news-feed.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Comments stripped with the real tokeniser, and guarded -- see scripts/lib/source-code.mjs.
const codeOf = (src, file) => stripComments(src, { file, dropLines: true });

// ---------------------------------------------------------------- load module
const raw = read("lib/stock-news-data.ts");
const keywordSrc = read("lib/keywordMatch.ts").replace(/^export /gm, "");
// Text hygiene moved to lib/server/news/text.ts when the FMP path went behind
// the NewsProvider interface. INLINED RATHER THAN STUBBED, like keywordHits
// above it: parseRss below routes its titles and descriptions through these, so
// a stub would have the harness measure its own placeholder.
const textSrc = read("lib/server/news/text.ts").replace(/^export /gm, "");

// EVERY replacement goes through a FUNCTION, never a replacement string.
// keywordMatch.ts contains `"\\$&"` inside its regex-escape helper, and as a
// replacement string `$&` means "the text that was matched" -- so inlining it
// spliced the import line into the middle of the escape function and produced a
// module that still mentioned the import it had just removed. The guard below
// caught it; a replacer function stops it happening.
const sub = (src, pattern, replacement) => src.replace(pattern, () => replacement);

let stubbed = raw;
stubbed = sub(stubbed, /^import \{ keywordHits \} from "@\/lib\/keywordMatch";$/m, keywordSrc);
stubbed = sub(stubbed, /^import \{ unstable_cache \} from "next\/cache";$/m, "const unstable_cache = (fn) => fn;");
stubbed = sub(
  stubbed,
  /^import \{ fmpFetch \} from "@\/lib\/server\/fmpUsage";$/m,
  'const fmpFetch = () => { throw new Error("no network in this harness"); };'
);
stubbed = sub(stubbed, /^import \{ beginTiming \} from ".\/server\/timing";$/m, "const beginTiming = () => () => {};");
// newsStore is the Redis half of the stored news dataset. Stubbed as a
// straight pass-through -- one cold window, deduped -- because what the
// assertions below measure is how a fetched window is parsed and ranked, not
// where it was cached.
//
// SUBSTITUTED BEFORE THE ai-news-briefs LINE BELOW, and that ordering is
// load-bearing: that pattern spans newlines from the earliest remaining
// `import {`, so an unstubbed import above it gets swallowed along with
// everything in between -- which is how adding this import first removed the
// unstable_cache stub and produced a ReferenceError rather than the
// "an import survived stubbing" message the guard below is meant to give.
stubbed = sub(
  stubbed,
  /^import \{ readOrRefreshSymbolNews \} from "@\/lib\/server\/newsStore";$/m,
  'const readOrRefreshSymbolNews = async (symbol, deps) => ({ items: deps.dedupe(await deps.fetchWindow(null)), mode: "cold", added: 0 });'
);
// The provider seam (step 1 of claude/news-adapter-spec-2026-09-13.md). The
// window fetch now comes from whichever adapter NEWS_PROVIDER selects, so it is
// stubbed exactly as fmpFetch was -- nothing below reaches the network, and a
// throw says so rather than looking like an empty upstream.
//
// ALL THREE OF THESE ARE SUBSTITUTED BEFORE THE ai-news-briefs LINE, and that
// ordering is load-bearing for the same reason the newsStore stub records: the
// ai-news-briefs pattern spans newlines from the earliest remaining `import {`,
// and the text import below is multi-line, so leaving it unstubbed here would
// have that pattern swallow everything in between.
// MATCHED ON THE MODULE, NOT ON THE NAMES. The first version of this pinned the
// exact import list, and step 3 added newsProviderMode beside
// fetchSymbolNewsWindow -- at which point the pattern stopped matching, the
// ai-news-briefs pattern below swallowed the line instead, and the module loaded
// with newsProviderMode undefined. Nothing failed, because no assertion reaches
// the feed builder. A stub keyed to a list of names is a stub that silently
// stops being applied the day the list changes.
stubbed = sub(
  stubbed,
  /^import \{[^}]*\} from "@\/lib\/server\/news";$/m,
  'const fetchSymbolNewsWindow = () => { throw new Error("no network in this harness"); };\n' +
    // Step 7 replaced the newsProviderMode import here with feedMaxAgeDays.
    // The stub returns the FMP window because every fixture below was written
    // against it; the gating itself is checked in section 8 and in
    // scripts/check-provider-flip.mjs, not here.
    'const feedMaxAgeDays = () => 90;'
);
// INLINED, NOT STUBBED, for the same reason as news/text below: scoreNews now
// asks isFilingChurn whether an item carries any tone at all, and a stub
// returning false would make every churn assertion below pass by construction.
//
// AND IT RUNS BEFORE THE news/text SUBSTITUTION, which is not cosmetic
// ordering. That pattern is multi-line (`[\s\S]*?`), so with this import left
// in place it matched from THIS line's "import {" all the way to text.ts's
// closing brace and swallowed the churn import whole. The marker guard below
// caught it on the first run -- which is the failure that guard was added for,
// firing on exactly the shape its comment predicts.
stubbed = sub(
  stubbed,
  /^import \{ isFilingChurn \} from "@\/lib\/server\/news\/filingChurn";$/m,
  read("lib/server/news/filingChurn.ts").replace(/^export /gm, "")
);
stubbed = sub(stubbed, /^import \{[\s\S]*?\} from "@\/lib\/server\/news\/text";$/m, textSrc);
// Type-only, so it is erased at transpile anyway -- but the guard below reads
// the TypeScript source, where it is still a line beginning "import ".
stubbed = sub(stubbed, /^import type \{ NewsItem \} from "@\/lib\/server\/news\/types";$/m, "");
stubbed = sub(
  stubbed,
  /^import \{[\s\S]*?\} from "@\/lib\/ai-news-briefs";$/m,
  "const getAiNewsBriefs = async () => [];\nconst getAiNewsInsight = async () => null;"
);

if (/^import /m.test(stubbed)) {
  console.error("FAIL: an import survived stubbing — the module would not load, so nothing below measures anything.");
  const leftover = stubbed.split("\n").filter((l) => l.startsWith("import "));
  console.error(leftover.join("\n"));
  process.exit(1);
}

// AND THE OTHER DIRECTION, which the import guard above cannot see: a stub that
// was never applied because a pattern stopped matching, and whose line was then
// eaten by the multi-line ai-news-briefs pattern. No import survives, so the
// guard above is happy, and the module loads with a binding missing. Each marker
// below is text only the corresponding stub or inline introduces.
for (const [marker, what] of [
  ["function keywordHits", "keywordMatch inlined"],
  ["function stripHtmlTags", "news/text inlined"],
  ["const fetchSymbolNewsWindow", "provider seam stubbed"],
  ["const feedMaxAgeDays", "feed window stubbed"],
  ["function isFilingChurn", "the churn grammar inlined"],
  ["const readOrRefreshSymbolNews", "newsStore stubbed"],
  ["const getAiNewsBriefs", "ai-news-briefs stubbed"],
]) {
  if (!stubbed.includes(marker)) {
    console.error(`FAIL: ${what} — expected "${marker}" in the stubbed source and it is not there.`);
    console.error("A pattern stopped matching and the line was swallowed by another substitution.");
    process.exit(1);
  }
}

const js = ts.transpileModule(stubbed, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

// logResponseWindow moved to lib/server/news/responseWindow.ts with the adapter
// split (step 1 of claude/news-adapter-spec-2026-09-13.md): the adapters are
// what hold a raw upstream response, so that is where the reading belongs.
//
// LOADED AS THE REAL MODULE, not stubbed, and it needs no stubbing to be: that
// file imports nothing, which is the same property newsMerge.ts is kept to.
const windowJs = ts.transpileModule(read("lib/server/news/responseWindow.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const rw = await import(`data:text/javascript;base64,${Buffer.from(windowJs).toString("base64")}`);

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-22T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

let seq = 0;
const item = (title, ageDays, extra = {}) => ({
  title,
  link: `https://example.com/${++seq}`,
  pubDate: ageDays === null ? null : daysAgo(ageDays),
  source: "Reuters",
  description: null,
  ...extra,
});

console.log("\n=== 1. The score has a time window ===\n");
// Five loud headlines from six months ago. The old code scored these and called
// it "right now"; the only correct answer is that there is no recent coverage.
const stale = [
  item("Micron beats estimates as revenue surges to a record", 180),
  item("Micron upgraded to buy on strong demand", 175),
  item("Micron raises guidance after blowout quarter", 170),
  item("Micron wins major contract expansion", 165),
  item("Micron profit jumps on memory demand", 160),
];
const staleScore = m.scoreNews(stale, NOW);
check(
  "five loud headlines from six months ago do NOT produce a score",
  staleScore.available === false,
  staleScore.reason
);
check("...and the reason names the window and the count", /last 14 days/.test(staleScore.reason) && /Only 0 of 5/.test(staleScore.reason));

const fresh = [
  item("Micron beats estimates as revenue surges to a record", 1),
  item("Micron upgraded to buy on strong demand", 2),
  item("Micron raises guidance after blowout quarter", 4),
];
const freshScore = m.scoreNews(fresh, NOW);
check("three headlines from this week DO produce a score", freshScore.available === true);

// ── Institutional-holding churn must not be read as a market opinion ────────
// The reported page scored "59/100, slightly bullish" over a pool that was
// mostly 13F notices. capNews bounds how many reach the score; this is the
// other half — the survivors carry no tone and must not be counted as if they
// did. Note the ASYMMETRY with the page, which keeps a couple of them on
// display: worth a glance, not worth a sentiment reading.
const CHURN_TITLES = [
  "Chokshi & Queen Wealth Advisors Inc Takes Position in Micron Technology, Inc. $MU",
  "OceanIQ Capital LLC Buys New Stake in Micron Technology, Inc. $MU",
  "NBH Bank Invests $668,000 in Micron Technology, Inc. $MU",
  "Nvest Financial LLC Reduces Stake in Micron Technology, Inc. $MU",
  "Micron Technology, Inc. $MU Position Decreased by Riverview Capital Advisers LLC",
];
const churnOnly = CHURN_TITLES.map((t, i) => item(t, i + 1));
check(
  "a pool of nothing but holding notices produces NO score",
  m.scoreNews(churnOnly, NOW).available === false,
  m.scoreNews(churnOnly, NOW).reason?.slice(0, 90)
);
// AND THE SCORE IS UNMOVED BY THEM, which the check above cannot show on its
// own: an empty pool falls back to `ranked`, so "no score" could come from the
// fallback rather than from the exclusion.
const withChurn = m.scoreNews([...fresh, ...churnOnly], NOW);
check(
  "...and adding five of them to three real headlines changes nothing",
  withChurn.available === freshScore.available && withChurn.score === freshScore.score,
  `${freshScore.score} -> ${withChurn.score}`
);
check(
  "...while five ordinary headlines in their place DO move it",
  m.scoreNews([...fresh, ...CHURN_TITLES.map((_, i) => item(`Micron cuts guidance on weak demand ${i}`, i + 1))], NOW).score !== freshScore.score,
  "otherwise the assertion above would pass for a pool the score simply ignores"
);
check("...and it reads bullish", freshScore.score > 58, `score ${freshScore.score}`);

// The boundary, both sides. A window nothing is ever outside is not a window.
// Distinct SUBJECTS, not near-restatements. An earlier version of this fixture
// reused three variations on "Micron beats estimates", and dedupeNews correctly
// collapsed them to one -- so the check failed for a reason that had nothing to
// do with the window. Worth recording: the harness caught its own bad fixture,
// which is what running the real functions buys.
check(
  "an item 13 days old is inside the window",
  m.scoreNews(
    [
      item("Micron beats estimates on record revenue", 13),
      item("Micron names a new chief financial officer", 2),
      item("Micron opens its Boise packaging facility", 4),
    ],
    NOW
  ).available === true
);
check(
  "an item 15 days old is outside it",
  m.scoreNews([item("Micron beats estimates on record revenue", 15), item("Micron upgraded on demand", 16), item("Micron raises guidance", 17)], NOW)
    .available === false
);
check(
  "two in-window items are still too few to score",
  m.scoreNews([fresh[0], fresh[1]], NOW).available === false
);
// A date is required, not assumed. An undated item cannot be shown to be recent.
check(
  "undated items do not count as recent",
  m.scoreNews([item("Micron beats on revenue", null), item("Micron upgraded", null), item("Micron raises guidance", null)], NOW)
    .available === false
);

console.log("\n=== 2. Weight is recency, not rank position ===\n");
// THE HEART OF IT. Same two headlines, opposite ages. If weighting still keyed
// off list position the two scores would be identical, because rankNews sorts
// both lists into the same order regardless of date.
const bullOld = item("Micron beats estimates as revenue surges to a record", 13);
const bearNew = item("Micron misses estimates as revenue declines, guidance cut", 0);
const bullNew = item("Micron beats estimates as revenue surges to a record", 0);
const bearOld = item("Micron misses estimates as revenue declines, guidance cut", 13);
const filler = [item("Micron announces plant expansion", 3), item("Micron names new CFO", 5)];

const freshBearish = m.scoreNews([bullOld, bearNew, ...filler], NOW);
const freshBullish = m.scoreNews([bullNew, bearOld, ...filler], NOW);
check(
  "the fresher headline moves the score, whichever way it points",
  freshBullish.score > freshBearish.score,
  `bullish-recent ${freshBullish.score} vs bearish-recent ${freshBearish.score}`
);
check(
  "...and the old position weights are gone from the source",
  !/positionWeight/.test(codeOf(raw, "lib/stock-news-data.ts")) && !/1\.35 : i === 1/.test(codeOf(raw, "lib/stock-news-data.ts"))
);

console.log("\n=== 3. Confidence reports coverage, not drama ===\n");
const loudFew = m.scoreNews(
  [
    item("Micron beats estimates as revenue surges to a record", 1),
    item("Micron upgraded to buy, price target raised", 2),
    item("Micron plunges on downgrade and weak guidance warning", 3),
  ],
  NOW
);
check("three recent headlines read Low confidence, however loud", loudFew.confidence === "Low", loudFew.confidence);
// Nine genuinely different subjects. Nine restatements of one headline would
// dedupe to one, which is correct behaviour and the wrong fixture for a question
// about coverage VOLUME.
const NINE_SUBJECTS = [
  "Micron opens its Boise packaging facility",
  "Micron names a new chief financial officer",
  "Micron joins an industry consortium on memory standards",
  "Micron files a patent covering stacked die bonding",
  "Micron signs a long-term supply agreement with a carmaker",
  "Micron schedules its annual shareholder meeting",
  "Micron publishes its sustainability report",
  "Micron expands apprenticeships in Idaho",
  "Micron appoints two independent directors",
];
const quietMany = m.scoreNews(NINE_SUBJECTS.map((title, i) => item(title, i)), NOW);
check("nine recent headlines read High, however quiet", quietMany.confidence === "High", quietMany.confidence);
check(
  "confidence no longer keys off signalCount",
  !/signalCount >= 4 \? "High"/.test(codeOf(raw, "lib/stock-news-data.ts"))
);

console.log("\n=== 4. Similarity dedup, not one-per-date ===\n");
// The real goal was never one per day. Date failed both ways.
const sameStoryTwoDays = m.dedupeNews([
  item("Micron tops Q3 revenue estimates as memory demand accelerates", 0),
  item("Micron Technology tops Q3 revenue estimates on accelerating memory demand", 1),
]);
check("the same story reported two days running collapses to one", sameStoryTwoDays.length === 1, `${sameStoryTwoDays.length} kept`);

const twoStoriesOneDay = m.dedupeNews([
  item("Micron tops Q3 revenue estimates as memory demand accelerates", 0),
  item("Micron names Sanjay Mehrotra successor in leadership transition", 0),
]);
check("two different stories on the same day both survive", twoStoriesOneDay.length === 2, `${twoStoriesOneDay.length} kept`);

check("the first occurrence wins, so caller order decides which", m.dedupeNews([
  { ...item("Micron tops Q3 revenue estimates on memory demand", 0), source: "Reuters" },
  { ...item("Micron Technology tops Q3 revenue estimates, memory demand", 1), source: "Blog" },
])[0].source === "Reuters");

check("oneArticlePerDate is gone from the tree", !/function oneArticlePerDate/.test(read("lib/stock-news-data.ts")));
check(
  "the curated theme-word signature is gone with it",
  !/function storySignature/.test(read("lib/stock-news-data.ts")),
  "a hardcoded list of ~25 themes deciding what counts as the same story"
);

console.log("\n=== 5. The source gate is gone ===\n");
const code = codeOf(read("lib/stock-news-data.ts"), "lib/stock-news-data.ts");
check("no mainFeedNews gate", !/mainFeedNews/.test(code));
check("no two-tier highValue/fallback pool", !/const fallbackNews =/.test(code) && !/const highValueNews =/.test(code));
check("no gate/backfill split", !/primaryDetailedNews|backfillCandidates/.test(code));
check(
  "isMajorWireSource no longer gates the stock feed",
  !/isMajorWireSource\(item\)\s*\|\|/.test(code)
);
// KEPT DELIBERATELY, and asserted so a later cleanup does not take them out
// with the gate: both fail visibly rather than silently.
check("the video/podcast filter survives", /isVideoOrLowQualitySource/.test(code));
check("the low-value SEO filter survives", /isLowValueNewsItem\(item\)/.test(code));

console.log("\n=== 6. The feed fills its slots, with a floor ===\n");
// Step 7 moved both window constants into lib/server/news/index.ts, beside the
// flag that chooses between them. The floor is still asserted, and so is the
// fact that this file no longer carries a second copy of the number.
check(
  "90-day floor on how far back the feed walks, on the fmp rollback",
  /NEWS_FEED_MAX_AGE_DAYS = 90/.test(codeOf(read("lib/server/news/index.ts"), "lib/server/news/index.ts")) &&
    /feedMaxAgeDays\(\)/.test(code) &&
    !/MAX_AGE_DAYS = \d/.test(code)
);
check("5 large cards and 10 compact", /options\.maxDetailedItems \?\? 5, 5/.test(code) && /MAX_COMPACT_NEWS_ITEMS = 10/.test(code));
check(
  "the news page asks for 5",
  /maxDetailedItems: 5/.test(codeOf(read("app/stock/[symbol]/news/page.tsx"), "app/stock/[symbol]/news/page.tsx"))
);
// The empty-card check that stood here asserted `if (!earningsNews.length)
// return null`. The card is gone entirely now (owner's call, 2026-08-22) --
// there is no dedicated earnings source on this plan (all four candidates
// measured 402/403), the structured snapshot above it already carries actual
// EPS/revenue/surprise/margins, and the word-boundary matcher means the keyword
// filter behind it would come up empty far more often. So the assertion is now
// about ABSENCE rather than about an empty state.
const newsPageSrc = read("app/stock/[symbol]/news/page.tsx");
check(
  "the earnings news card is gone, not merely emptied",
  !/EarningsNewsSection/.test(newsPageSrc) && !/function getEarningsNewsItems/.test(newsPageSrc)
);
check(
  "...and the structured earnings snapshot it sat beside is still rendered",
  /<SharedLatestEarningsCard /.test(newsPageSrc),
  "removing the headlines card must not take the actual EPS/revenue figures with it"
);

console.log("\n=== 7. The article-per-day reading that decides limit= ===\n");
// Free instrumentation on payloads already fetched. What it has to get right:
// the per-day spread, and whether the response is genuinely newest-first --
// because the argument "truncation happens at the old end, so recent days are
// complete" is only true if it is.
const capture = (rows, limit = 50) => {
  const lines = [];
  const real = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    rw.logResponseWindow("test", "MU", rows, limit);
  } finally {
    console.log = real;
  }
  return lines.join(" ");
};
const at = (iso) => ({ publishedDate: iso });

// Six articles over three days, newest first.
const ordered = [
  at("2026-08-22T15:00:00Z"),
  at("2026-08-22T09:00:00Z"),
  at("2026-08-21T18:00:00Z"),
  at("2026-08-21T08:00:00Z"),
  at("2026-08-21T07:00:00Z"),
  at("2026-08-19T11:00:00Z"),
];
const orderedOut = capture(ordered);
check("distinct days counts DAYS, not rows", /distinctDays=3\b/.test(orderedOut), orderedOut);
check("maxPerDay is the busiest single day", /maxPerDay=3\b/.test(orderedOut));
check("per-day breakdown is reported", /perDay=\[2026-08-22:2,2026-08-21:3,2026-08-19:1\]/.test(orderedOut));
check("oldest and newest are both named", /oldest=2026-08-19/.test(orderedOut) && /newest=2026-08-22/.test(orderedOut));
check("a properly newest-first response reads monotonic", /monotonic=true inversions=0/.test(orderedOut));

// THE CASE THE ENDPOINT-COMPARISON TEST WOULD MISS. First row is the newest and
// last row is the oldest, so checking the extremes says "sorted" -- but the
// middle is shuffled. Every adjacent pair is compared precisely so this fails.
// Endpoints deliberately in order -- row 0 is the newest of the whole set and
// the last row is the oldest -- with TWO inversions buried between them, so the
// reported count proves the pairwise walk rather than a boolean that could come
// from any single comparison.
const shuffledInside = [
  at("2026-08-22T15:00:00Z"),
  at("2026-08-19T11:00:00Z"),
  at("2026-08-21T18:00:00Z"),
  at("2026-08-19T20:00:00Z"),
  at("2026-08-20T08:00:00Z"),
  at("2026-08-18T07:00:00Z"),
];
const shuffledOut = capture(shuffledInside);
check(
  "a response sorted only at its ENDS is not called monotonic",
  /monotonic=false/.test(shuffledOut),
  "first row newest and last row oldest — the endpoints agree, the middle does not"
);
check("...and the inversion count is reported, not just the boolean", /inversions=2\b/.test(shuffledOut));

console.log("\n=== 7b. Saturation — a floor must not read as a total ===\n");
// The distinction the whole limit question turns on. rows === limit means FMP
// gave everything it was asked for, so there is very likely more it did not send
// and any count derived from it is a FLOOR.
check(
  "a full response is flagged saturated",
  /rows=50\/50 saturated=true/.test(capture(Array.from({ length: 50 }, () => at("2026-08-22T10:00:00Z")), 50))
);
check(
  "a short response is not",
  /rows=6\/50 saturated=false/.test(capture(ordered, 50))
);
check(
  "saturation is judged against the limit ACTUALLY sent, not a hardcoded 50",
  /rows=6\/6 saturated=true/.test(capture(ordered, 6)),
  "sector news sends 100 — one hardcoded number would misreport it"
);

console.log("\n=== 7c. No dates is reported, not silently zero ===\n");
check(
  "undated rows say so rather than reporting an empty distribution",
  /dated=0/.test(capture([{ title: "no date here" }, { title: "nor here" }])),
  "0 distinct days and 'we could not tell' are different readings"
);
check(
  "rows with unparseable dates are excluded rather than counted",
  /dated=0/.test(capture([{ publishedDate: "not a date" }]))
);

console.log("\n=== 7d. Measured before our filters, and on one limit constant ===\n");
// THE ADAPTER, not lib/stock-news-data.ts. The FMP window fetch moved behind the
// NewsProvider interface in step 1 of claude/news-adapter-spec-2026-09-13.md;
// these two assertions are about that fetch, so they follow it. Reading the old
// file would have left both of them passing against text that no longer contains
// the call site -- a negative result from a file that is no longer the subject.
const newsSrc = codeOf(read("lib/server/news/fmpProvider.ts"), "lib/server/news/fmpProvider.ts");
check(
  "the reading is taken on the RAW response, before mapping or filtering",
  /if \(!Array\.isArray\(data\)\) continue;[\s\S]{0,200}logResponseWindow\("stock"[\s\S]{0,120}const items = data/.test(newsSrc),
  "filtering first would measure our own rules and blame FMP"
);
check(
  "one FMP_NEWS_LIMIT constant feeds both URLs and the reading",
  (newsSrc.match(/limit=\$\{FMP_NEWS_LIMIT\}/g) ?? []).length === 2 &&
    /logResponseWindow\("stock", symbol\.toUpperCase\(\), data, FMP_NEWS_LIMIT\)/.test(newsSrc),
  "a second copy of 50 would make saturated= lie the moment one moved"
);
check(
  "sector news takes the same reading through the same function",
  /logResponseWindow\(\s*"sector"/.test(codeOf(read("lib/sector-news-data.ts"), "lib/sector-news-data.ts"))
);

console.log("\n=== 8. The provider seam (news-adapter spec step 1) ===\n");
// Step 1 of claude/news-adapter-spec-2026-09-13.md is a pure refactor, so what
// is worth asserting is not what it added but what it must not have moved. Each
// of these is a one-line mistake to make and none of them would fail anything.
const registry = codeOf(read("lib/server/news/index.ts"), "lib/server/news/index.ts");
const adapter = codeOf(read("lib/server/news/fmpProvider.ts"), "lib/server/news/fmpProvider.ts");

check(
  "NEWS_PROVIDER defaults to free, with fmp as the explicit rollback",
  /process\.env\.NEWS_PROVIDER === "fmp" \? "fmp" : "free"/.test(registry),
  'step 7 flipped it; the fmp spelling is the flick-back and has to keep working exactly'
);
check(
  "\"free\" never resolves to an empty provider list",
  /FREE_PROVIDERS\.length/.test(registry) && /return \[fmpNewsProvider\]/.test(registry),
  "an empty list would empty the news feed on every page with no error anywhere"
);
check(
  "the FMP adapter is still in the tree, implementing the interface",
  /export const fmpNewsProvider: NewsProvider = \{/.test(adapter) &&
    /id: "fmp"/.test(adapter) &&
    /fetchForSymbol/.test(adapter) &&
    /fetchMarket/.test(adapter),
  "the owner's requirement is that going back to FMP is a switch, not an unpick"
);
check(
  "the registry does not swallow an upstream failure into an empty window",
  !/catch/.test(registry),
  "newsStore treats a throw as 'serve what is stored'; [] would instead look like a successful empty fetch and rewrite the record"
);
check(
  "the store is still fed by the provider seam rather than a provider directly",
  /fetchWindow: \(from\) => fetchSymbolNewsWindow\(/.test(
    codeOf(read("lib/stock-news-data.ts"), "lib/stock-news-data.ts")
  ),
  "naming an adapter at the call site is how the flag stops deciding anything"
);


console.log("\n=== 9. ONE STORE READ PER RENDER ===\n");
// THE REGRESSION THIS PINS, which ran in production for the whole migration:
// fetchNews and fetchEarningsNews each called fetchStoredSymbolNews, and the
// builder ran them in a Promise.all. Two concurrent readOrRefresh passes on one
// Redis key -- two adapter fan-outs, and two writes racing where the later one
// could drop the earlier one's merged articles. It was visible as a doubled
// [gnews] line in the logs and nothing failed.
const newsDataCode = codeOf(read("lib/stock-news-data.ts"), "lib/stock-news-data.ts");
// THE DECLARATION IS NOT A CALL SITE. The first version counted
// `async function fetchStoredSymbolNews(` as one and reported 2 for correct
// code -- an assertion that fails on the fixed state is as useless as one that
// passes on the broken state.
const storeCalls = [...newsDataCode.matchAll(/\bfetchStoredSymbolNews\s*\(/g)].filter(
  (m) => !/function\s+$/.test(newsDataCode.slice(Math.max(0, m.index - 20), m.index))
).length;
check(
  "fetchStoredSymbolNews is CALLED from exactly one place",
  storeCalls === 1,
  `${storeCalls} call site(s) — a second one is the doubled fan-out and the write race coming back`
);
// AND THE CONSUMERS CANNOT FETCH AT ALL. A call-site count alone would pass if
// someone reintroduced the read under a different name; a selector declared
// without `async` cannot await a store read whatever it is called.
for (const fn of ["selectDisplayNews", "selectEarningsNews"]) {
  check(
    `${fn} is a pure selector, not an async fetch`,
    new RegExp(`(?<!async )function ${fn}\\(`).test(newsDataCode) &&
      !new RegExp(`async function ${fn}\\(`).test(newsDataCode),
    "it takes the already-fetched store; a function that cannot await cannot double-fetch"
  );
}
check(
  "the builder reads the store once and hands it to both consumers",
  /const storedNews = await fetchStoredSymbolNews\(/.test(newsDataCode) &&
    /selectDisplayNews\(storedNews\)/.test(newsDataCode) &&
    /selectEarningsNews\(storedNews[,)]/.test(newsDataCode)
);
// The empty-store fallback is still reachable, and still only then: it is a
// network call and must not run when the store answered.
check(
  "the Google News fallback runs only when the store yielded nothing",
  /displayNews\.length \? displayNews : await fetchNewsFallback\(/.test(newsDataCode),
  "an unconditional fallback would add a request to every render"
);

console.log("\n=== 10. THE STORE WRITES DO NOT BLOCK THE READER ===\n");
const storeCode = codeOf(read("lib/server/newsStore.ts"), "lib/server/newsStore.ts");
check(
  "after() comes from next/server, not a detached promise",
  /import \{ after \} from "next\/server";/.test(storeCode),
  "a floating promise in a serverless function can be killed the moment the response is sent"
);
// AWAITED INSIDE after() IS CORRECT — the deferred callback has to await its own
// writes or they are dropped. The property is that none of them is awaited
// OUTSIDE one, so the after() blocks are removed before looking. The first
// version tested `!/await writeStored\(/` over the whole file and failed on the
// correct code, which would have pushed the fix toward dropping the await.
const outsideAfter = (() => {
  let out = "";
  let i = 0;
  while (i < storeCode.length) {
    // `after(` ALONE WOULD ALSO MATCH A DECLARATION of that identifier, which
    // scripts/check-assertion-anchors.mjs flagged on the first version of this.
    // Anchored on the two call shapes actually used instead.
    const nextCall = /after\((?:async )?\(\) =>/g;
    nextCall.lastIndex = i;
    const hit = nextCall.exec(storeCode);
    const at = hit ? hit.index : -1;
    if (at < 0) { out += storeCode.slice(i); break; }
    out += storeCode.slice(i, at);
    // Walk to the matching close paren so nested parens do not end it early.
    let depth = 0;
    let j = at + "after".length;
    for (; j < storeCode.length; j += 1) {
      if (storeCode[j] === "(") depth += 1;
      else if (storeCode[j] === ")") { depth -= 1; if (depth === 0) { j += 1; break; } }
    }
    i = j;
  }
  return out;
})();
check(
  "the after() blocks were actually found and removed",
  outsideAfter.length < storeCode.length && /writeStored/.test(storeCode),
  "if the stripper matched nothing the checks below would pass over the whole file"
);
for (const [write, why] of [
  ["writeStored", "the store itself"],
  ["recordRefreshStats", "the refresh counters"],
  ["markViewed", "the staleness mark"],
]) {
  check(
    `${write} is not awaited outside after() (${why})`,
    !new RegExp(`await ${write}\\(`).test(outsideAfter),
    "the reader already holds the items; it consumes none of these"
  );
}
check(
  "...and all three are inside an after() callback",
  /after\(async \(\) => \{[\s\S]*?writeStored\([\s\S]*?recordRefreshStats\([\s\S]*?\}\)/.test(storeCode) &&
    /after\(\(\) => markViewed\(/.test(storeCode),
  "not awaited AND not deferred would mean simply dropped"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
