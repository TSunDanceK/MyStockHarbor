// The constraints around the stored news dataset that are not expressible in
// newsMerge's unit tests, because they are about wiring rather than logic.
//
// THE ONE THAT MATTERS MOST IS THE ABSENCE OF A CRON. Population is lazy by
// design: first view of a symbol populates it, later views read Redis, and a
// symbol nobody views costs nothing. Adding news to vercel.json would warm 755
// symbols an hour and dwarf every other consumer on the FMP account -- turning
// the fix into a bigger version of the problem it was built to solve. That is a
// one-line mistake to make and it would not fail anything, so it is asserted.
//
//   node scripts/check-news-store.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const store = readCodeOnly("lib/server/newsStore.ts");
const merge = readCodeOnly("lib/server/newsMerge.ts");
const newsData = readCodeOnly("lib/stock-news-data.ts");
const staleness = readCodeOnly("lib/server/stalenessQueue.ts");
const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
const spec = fs.readFileSync(
  path.join(process.cwd(), "claude/news-as-stored-dataset-spec-2026-08-22.md"),
  "utf8"
);

console.log("\n=== 1. Population stays lazy ===\n");

const newsCron = (vercel.crons ?? []).filter((c) => /news/i.test(c.path));
check(
  "no news cron in vercel.json",
  newsCron.length === 0,
  `warming 755 symbols hourly would dwarf every other consumer on the account — found ${newsCron.length}`
);

check(
  "the store is reached from the render path, not a job route",
  /readOrRefreshSymbolNews/.test(newsData),
  "lazy population only works if the thing that populates is the thing that reads"
);

console.log("\n=== 2. The pure half stays pure ===\n");

check(
  "newsMerge imports nothing",
  !/^import /m.test(merge),
  "it is split out so the tests can run the real module; an import is what would stop them"
);

check(
  "newsMerge does not reimplement the #343 dedup",
  !/OVERLAP_THRESHOLD|titleOverlap/.test(merge),
  "a second copy of that rule could disagree with the first, which is worse than the testability it would buy"
);

check(
  "the dedup is injected into the store rather than imported by it",
  /dedupe:\s*dedupeNews/.test(newsData),
  "the store importing lib/stock-news-data would be a cycle, and copying the rule would be two implementations"
);

console.log("\n=== 3. The spec's numbers are the code's numbers ===\n");

check("the overlap is 6 hours", /NEWS_OVERLAP_HOURS = 6;/.test(merge));
check("the store cap is 40", /NEWS_STORE_CAP = 40;/.test(merge));
check("the earnings pin backstop is 7 days", /EARNINGS_PIN_MAX_AGE_MS = 7 \*/.test(merge));

const keyTtl = store.match(/NEWS_KEY_TTL_SECONDS = (\d+) \*/)?.[1];
check(
  "the key TTL outlives the earnings pin",
  Number(keyTtl) > 7,
  `a key that expires inside the pin's 7 days would make the backstop the primary rule — ${keyTtl} days`
);

check(
  "sector news gets no earnings pin",
  /Omit<RefreshDeps<T>, "isEarnings">/.test(store),
  "pinning one constituent's earnings inside a sector feed would present it as sector-wide coverage"
);

console.log("\n=== 4. Instrumentation answers the question it exists for ===\n");

check(
  "cold and incremental refreshes are counted separately",
  /coldFetches/.test(store) && /incrementalFetches/.test(store),
  "a zero-add refresh is healthy, so only the ratio distinguishes a working store from one being evicted"
);

check(
  "items added per refresh is recorded",
  /itemsAdded/.test(store),
  "zero on a quiet hour is healthy, not a failure — the number is only readable next to the cold/incremental split"
);

check(
  "NEITHER feed marks the dataset refreshed on a cached read",
  (store.match(/result\.mode !== "cached"/g) ?? []).length === 2,
  "marking on a cache hit holds the staleness set green whether or not anything was refetched, and the two feeds guard it separately"
);

console.log("\n=== 5. Registered as a dataset, honestly ===\n");

check(
  "news and sectorNews are on the DATASETS registry",
  /^  news: \{/m.test(staleness) && /^  sectorNews: \{/m.test(staleness),
  "the spec asks for news on the health page like every other dataset"
);

check(
  "they declare lazy population rather than naming a job",
  (staleness.match(/population: "on-demand",/g) ?? []).length === 2,
  "inventing a job name to satisfy the shape is how the page ends up naming a cron nobody runs"
);

check(
  "they are observed-only, not registered",
  /sectorNews: \{[^}]*coverage: "observed-only"/s.test(staleness),
  "the denominator is symbols someone happened to view, which is self-selecting by construction"
);

console.log("\n=== 6. The gate is recorded ===\n");

check(
  "the spec names a probe verdict",
  /VERDICT: PASS/.test(spec),
  "the spec's own rule is that the design is not cleared to build until this table names a result"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
