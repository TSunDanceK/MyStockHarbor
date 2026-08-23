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

const js = ts.transpileModule(stubbed, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

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
check("90-day floor on how far back the feed walks", /NEWS_FEED_MAX_AGE_DAYS = 90/.test(code));
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
    m.logResponseWindow("test", "MU", rows, limit);
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
const newsSrc = codeOf(read("lib/stock-news-data.ts"), "lib/stock-news-data.ts");
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

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
