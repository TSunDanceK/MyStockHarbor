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

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/newsMerge.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// newsMerge.ts has exactly one import and it needs no Redis and no Next -- which
// is most of the reason the logic lives there rather than inline in
// newsStore.ts, where Redis is unavoidable.
//
// THE ONE IMPORT IS INLINED, NOT STUBBED, and the difference matters here. This
// module is loaded from a data: URL, which cannot resolve a relative specifier
// at all, so something had to happen. A stub would have let capNews's churn cap
// be tested against a fake classifier that agrees with the test by
// construction; inlining the real lib/server/news/filingChurn.ts means the
// assertions below run the grammar that actually ships.
const churnSrc = fs
  .readFileSync(path.join(ROOT, "lib/server/news/filingChurn.ts"), "utf8");
// The `export` keywords are KEPT, so the inlined grammar is re-exported by the
// merged module and the assertions below can call the shipped isFilingChurn
// directly rather than inferring it from capNews's output.
if (/^import /m.test(churnSrc)) {
  console.error("FAIL: filingChurn.ts gained an import this harness does not inline.");
  process.exit(1);
}
const mergeSrc = fs
  .readFileSync(SRC, "utf8")
  .replace(/^import \{ isFilingChurn, MAX_CHURN_STORED \} from "\.\/news\/filingChurn";$/m, churnSrc);
for (const [marker, why] of [
  ["export function isFilingChurn", "filingChurn was not inlined -- the import pattern stopped matching"],
  ["export const MAX_CHURN_STORED", "MAX_CHURN_STORED was not inlined"],
]) {
  if (!mergeSrc.includes(marker)) {
    console.error(`FAIL: ${why}.`);
    process.exit(1);
  }
}
if (/^import /m.test(mergeSrc)) {
  console.error("FAIL: an import survived inlining into newsMerge.ts:");
  console.error(mergeSrc.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
const js = ts.transpileModule(mergeSrc, {
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
  MAX_CHURN_STORED,
  isFilingChurn,
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

console.log("\ncapNews — the institutional-holding churn cap");

// VERBATIM FROM scripts/fixtures/churn-sample.tsv and from the reported page.
// Invented headlines would test the grammar against my own idea of it.
const CHURN = [
  "Performance Wealth Partners LLC Boosts Stock Position in JPMorgan Chase & Co. $JPM",
  "JPMorgan Chase & Co. $JPM Shares Sold by BlackRock Inc.",
  "Squarepoint Ops LLC Purchases 321,497 Shares of CryoPort, Inc. $CYRX",
  "Chokshi & Queen Wealth Advisors Inc Takes Position in Micron Technology, Inc. $MU",
  "NBH Bank Invests $668,000 in Micron Technology, Inc. $MU",
  "Micron Technology, Inc. $MU Position Decreased by Riverview Capital Advisers LLC",
  "Trust Co. of Vermont Buys New Position in JPMorgan Chase & Co. $JPM",
  "Nvest Financial LLC Reduces Stake in Micron Technology, Inc. $MU",
];
const REAL = [
  "Will Micron Technology Stock Soar to $1,500 After Sept. 30?",
  "Have Insiders Sold Micron Technology Shares Recently?",
  "Berkshire Hathaway's housing bet deepens as it boosts Lennar stake to $1.2B",
  "Berkshire Hathaway Earnings: Cash Balances Retreat on Increased Investments and Share Buybacks in Q2",
  "Micron Technology beats Q4 estimates as HBM revenue triples",
];

check(
  "every churn headline is recognised",
  CHURN.every((t) => isFilingChurn(t)),
  CHURN.filter((t) => !isFilingChurn(t)).join(" | ") || "all 8"
);
check(
  "no real headline is",
  REAL.every((t) => !isFilingChurn(t)),
  REAL.filter((t) => isFilingChurn(t)).join(" | ") || "all 5 clear"
);
// THE KNOWN FALSE POSITIVE, PINNED RATHER THAN HIDDEN. It is real news and it
// matches, because structurally it IS a holding notice. Asserting it here means
// a later "fix" that silently changes this behaviour has to say so.
check(
  "the irreducible false positive is still exactly that, and still only capped",
  isFilingChurn("Warren Buffett's Berkshire Hathaway Inc. discloses new stake in Alphabet"),
  "it survives as one of the kept MAX_CHURN_STORED — which is why this caps rather than excludes"
);

const churnItems = (n) =>
  Array.from({ length: n }, (_, i) =>
    art(`c${i}`, new Date(Date.UTC(2026, 0, 20, 12, 0, 0) - i * 60_000).toISOString(), CHURN[i % CHURN.length])
  );

check(
  `a store of nothing but churn keeps ${MAX_CHURN_STORED}, not zero and not all of it`,
  capNews(churnItems(20), null).length === MAX_CHURN_STORED,
  `got ${capNews(churnItems(20), null).length} — a thin name whose only coverage is holding notices must not go empty`
);
// THE REGRESSION THAT WAS REPORTED, in one assertion. 30 churn + 5 articles is
// the reported page's ratio; before this cap every article was outnumbered.
const mixed = [
  ...churnItems(30),
  ...REAL.map((t, i) => art(`r${i}`, new Date(Date.UTC(2026, 0, 19, 12, 0, 0) - i * 60_000).toISOString(), t)),
];
const cappedMixed = capNews(mixed, null);
check(
  "30 churn + 5 articles keeps all 5 articles",
  cappedMixed.filter((i) => i.link.startsWith("r")).length === 5,
  `${cappedMixed.filter((i) => i.link.startsWith("r")).length} of 5`
);
check(
  `...and at most ${MAX_CHURN_STORED} churn items`,
  cappedMixed.filter((i) => i.link.startsWith("c")).length <= MAX_CHURN_STORED,
  `${cappedMixed.filter((i) => i.link.startsWith("c")).length} churn`
);
check(
  "...even though nothing was over NEWS_STORE_CAP",
  mixed.length <= NEWS_STORE_CAP,
  "the early return this replaced would have let all 30 through untouched"
);
check(
  "churn is NEWER here, so a newest-first slice alone would have kept only churn",
  Math.max(...mixed.filter((i) => i.link.startsWith("c")).map((i) => Date.parse(i.pubDate))) >
    Math.max(...mixed.filter((i) => i.link.startsWith("r")).map((i) => Date.parse(i.pubDate))),
  "otherwise the assertion above would pass for the wrong reason"
);
check(
  "the result is still newest-first",
  cappedMixed.every((item, i) => i === 0 || Date.parse(cappedMixed[i - 1].pubDate) >= Date.parse(item.pubDate))
);
// The pin outranks the churn cap, as it outranks everything else here.
const churnyPin = art("pin", "2026-01-01T00:00:00.000Z", REAL[4]);
check(
  "the pin still survives a store full of churn",
  capNews([...churnItems(30), churnyPin], churnyPin).some((i) => i.link === "pin")
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
