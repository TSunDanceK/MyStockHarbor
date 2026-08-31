// Proves the stored news dataset cannot silently lose an article.
//
// WHY THIS EXISTS. /stable/news/stock is fetched on render, every render, with
// no `from` and nothing persisted -- the largest single line on the FMP byte
// meter since #375 fixed history. The fix has the same shape as #375's: bound
// the request with `from=`, keep an overlap because the source back-dates,
// merge and dedup, keep more than you display.
//
// THE FAILURES THAT FIX INTRODUCES, AND WHAT THIS GUARDS.
//
//   1. A too-tight window. Fetching strictly from the newest stored timestamp
//      loses anything the source back-dates, and that loss is silent AND
//      permanent -- the next window starts later still and never looks back.
//   2. An eviction that can drop the earnings pin. Persistence is the whole
//      point of the pin: today an earnings article vanishes the moment it
//      leaves FMP's latest-N window regardless of relevance. A cap that evicts
//      it reintroduces exactly the bug the pin exists to fix.
//
// Neither throws. Neither fails a build. The page just quietly shows less than
// it should, which is why they are asserted here rather than left to review.
//
//   node scripts/check-news-merge.mjs
//
// Runs the REAL lib/server/newsMerge.ts, not a copy of its logic.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "lib/server/newsMerge.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// newsMerge.ts imports nothing, so it needs no stubbing -- which is most of the
// reason the logic lives there rather than inline in newsStore.ts, where Redis
// is unavoidable.
const js = ts.transpileModule(fs.readFileSync(SRC, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;

const {
  incrementalFrom,
  mergeNewsItems,
  selectEarningsPin,
  capNews,
  countAdded,
  sortNewestFirst,
  NEWS_OVERLAP_HOURS,
  NEWS_STORE_CAP,
  EARNINGS_PIN_MAX_AGE_MS,
} = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const art = (link, iso, title = `story ${link}`) => ({ title, link, pubDate: iso });
const DAY = 24 * 60 * 60 * 1000;

console.log("\nthe spec's constants");
check("overlap is 6 hours", NEWS_OVERLAP_HOURS === 6, "the spec's figure, and the reason the back-dating loss cannot accumulate");
check("the store keeps 40", NEWS_STORE_CAP === 40, "deeper than the 5 + 10 the page composes AFTER dedup, which is the point");
check("the pin backstop is 7 days", EARNINGS_PIN_MAX_AGE_MS === 7 * DAY);

console.log("\nincrementalFrom");
check(
  "a cold start has no anchor and asks for no from",
  incrementalFrom(null) === null,
  "an absent store must fetch the default window, not a window starting at the epoch"
);
check("an unparseable stored date is treated as cold", incrementalFrom("not-a-date") === null);
check(
  "the window opens 6h before the newest stored article",
  incrementalFrom("2026-08-31T12:00:00Z") === "2026-08-31"
);
check(
  "an overlap crossing midnight widens to the previous day",
  incrementalFrom("2026-08-31T03:00:00Z") === "2026-08-30",
  "the endpoint takes a date, so truncating to today would silently drop the span the overlap exists to cover"
);
check(
  "crossing a month boundary",
  incrementalFrom("2026-09-01T02:00:00Z") === "2026-08-31"
);

console.log("\nmergeNewsItems");
const stored = [art("a", "2026-08-30T10:00:00Z"), art("b", "2026-08-29T10:00:00Z")];
const fetched = [art("c", "2026-08-31T10:00:00Z"), art("a", "2026-08-30T10:00:00Z", "corrected headline")];
const merged = mergeNewsItems(stored, fetched);

check("new articles are added", merged.length === 3, `got ${merged.length}`);
check("the result is newest first", merged.map((i) => i.link).join() === "c,a,b");
check(
  "the fetched copy wins on a shared link",
  merged.find((i) => i.link === "a").title === "corrected headline",
  "a corrected headline or backfilled summary should not lose to our older copy"
);
check("no duplicate links survive", new Set(merged.map((i) => i.link)).size === merged.length);
check(
  "a back-dated article the overlap catches is kept, not dropped for being old",
  mergeNewsItems(stored, [art("backdated", "2026-08-29T23:00:00Z")]).some((i) => i.link === "backdated"),
  "this is the whole reason the window reaches back rather than starting at the newest stored stamp"
);
check("merging an empty fetch keeps the store intact", mergeNewsItems(stored, []).length === 2);
check("a cold merge onto an empty store works", mergeNewsItems([], fetched).length === 2);
check("an item with no link is discarded, not stored under an empty key",
  mergeNewsItems([], [art("", "2026-08-31T10:00:00Z")]).length === 0);

console.log("\nselectEarningsPin");
const now = Date.parse("2026-08-31T12:00:00Z");
const qualifies = (item) => item.title.includes("earnings");
const pool = [
  art("old-e", "2026-08-25T10:00:00Z", "Q2 earnings beat"),
  art("new-e", "2026-08-30T10:00:00Z", "Q3 earnings miss"),
  art("plain", "2026-08-31T10:00:00Z", "analyst raises target"),
];

check("the newest qualifying article is the pin", selectEarningsPin(pool, qualifies, now).link === "new-e",
  "replacement is the primary rule, so re-selecting IS the replacement");
check("a non-qualifying newer article does not become the pin",
  selectEarningsPin(pool, qualifies, now).link !== "plain");
check("nothing qualifying means no pin", selectEarningsPin([pool[2]], qualifies, now) === null);
check(
  "a pin older than 7 days ages out",
  selectEarningsPin([art("stale-e", "2026-08-20T10:00:00Z", "earnings")], qualifies, now) === null,
  "past a week it has stopped being news, and holding it would present a stale article as current coverage"
);
check(
  "exactly at the 7-day boundary is still pinned",
  selectEarningsPin([art("edge", new Date(now - EARNINGS_PIN_MAX_AGE_MS).toISOString(), "earnings")], qualifies, now)
    !== null
);
check(
  "an undated article is never pinned",
  selectEarningsPin([art("undated", null, "earnings")], qualifies, now) === null,
  "it cannot be aged out, so it could never be released by the backstop"
);

console.log("\ncapNews");
const many = Array.from({ length: 60 }, (_, i) =>
  art(`n${i}`, new Date(now - i * 60 * 60 * 1000).toISOString())
);

check("caps to NEWS_STORE_CAP", capNews(many, null).length === NEWS_STORE_CAP, `got ${capNews(many, null).length}`);
check("keeps the NEWEST, not the first seen", capNews(many, null)[0].link === "n0");
check("under the cap nothing is dropped", capNews(many.slice(0, 5), null).length === 5);

const oldPin = art("pinned", new Date(now - 50 * 60 * 60 * 1000).toISOString(), "earnings");
const withPin = capNews([...many, oldPin], oldPin);
check(
  "a pin that falls outside the newest 40 still survives",
  withPin.some((i) => i.link === "pinned"),
  "an eviction that can drop the pin reintroduces the exact bug persistence was added to fix"
);
check("...and the cap is still respected", withPin.length === NEWS_STORE_CAP, `got ${withPin.length}`);
check("...and the result is still newest first",
  withPin.map((i) => Date.parse(i.pubDate)).every((v, i, a) => i === 0 || a[i - 1] >= v));
check(
  "a pin already inside the newest 40 is not double-counted",
  capNews(many, many[0]).filter((i) => i.link === "n0").length === 1
);

console.log("\ncountAdded");
check("counts only genuinely new links", countAdded(stored, merged) === 1, "one of the three merged was already held");
check("a quiet refresh adds zero, which is healthy not a failure", countAdded(stored, stored) === 0);
check("a cold start counts everything", countAdded([], merged) === 3);

console.log("\nsortNewestFirst");
check("undated articles sort last rather than being dropped",
  sortNewestFirst([art("u", null), art("d", "2026-08-31T10:00:00Z")]).map((i) => i.link).join() === "d,u");

console.log(failures === 0 ? "\nOK\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
