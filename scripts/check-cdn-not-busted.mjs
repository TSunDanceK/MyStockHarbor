// A route that declares CDN caching must not be fetched with a cache-buster.
//
// WHAT WAS HAPPENING. /api/pickers answers
// `public, s-maxage=3600, stale-while-revalidate=3600`, and PickersClient
// fetched it as `/api/pickers?t=${Date.now()}` with `cache: "no-store"`. The
// `?t=` makes every URL unique, so the CDN NEVER hit and every /pickers view
// was a fresh Lambda serialising the whole ~8 MB payload. DashboardTicker.tsx
// fetches the same route with no buster and does hit the CDN -- the correct
// behaviour already existed one file over, which is what makes this a slip
// rather than a design.
//
// THE ROUTE LIST IS DERIVED. Any route whose source contains `s-maxage=` has
// declared that a shared cache may store it; the check finds them by walking
// app/api rather than by anyone remembering to add the next one.
//
// THE ONE LEGITIMATE BUSTER is a forced rebuild. /api/pickers?force=1 is
// answered `no-store` by pickersBuilder itself, and the unique URL is what
// makes the request REACH the origin rather than being served by a CDN entry
// keyed on `/api/pickers?force=1` -- a forced rebuild that never reaches the
// builder rebuilds nothing. Exempted by name below, not by weakening the rule.
//
// AND A HEADER MUST NOT OUTLIVE ITS DATA. Where a route gained a Cache-Control
// in this change, the window is asserted EQUAL to the `next: { revalidate: N }`
// on the FMP call in the same file. A CDN window longer than the data's own
// lifetime serves bytes nothing will refresh; a shorter one spends a Lambda to
// re-serve what the Data Cache would have handed back unchanged.
//
//   node scripts/check-cdn-not-busted.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const walk = (dir, out = [], match = () => true) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out, match);
    } else if (match(entry.name)) out.push(path.relative(ROOT, full));
  }
  return out;
};

console.log("\n1. Which routes have declared themselves cacheable");

// The static prefix a client would fetch: app/api/foo/[symbol]/route.ts
// -> /api/foo/, because the client writes `/api/foo/${symbol}`.
// FOLLOWS A RE-EXPORT, one hop. /api/pickers/route.ts is three lines and its
// Cache-Control lives in lib/server/pickersBuilder.ts -- so a scan of route.ts
// alone missed the very route this PR is about, and the rule would have rested
// on a hand-written assertion instead of on the derivation. Which is the whole
// argument for deriving.
const declaresCaching = (rel) => {
  const src = readCodeOnly(rel);
  if (/s-maxage=/.test(src)) return true;
  for (const m of src.matchAll(
    /export \{[^}]*\} from "(?:@\/|(?:\.\.\/)+)(lib\/server\/[A-Za-z0-9_-]+)"/g
  )) {
    try {
      if (/s-maxage=/.test(readCodeOnly(`${m[1]}.ts`))) return true;
    } catch {
      // not a file we can read; nothing to conclude from that
    }
  }
  return false;
};

const cacheable = walk(path.join(ROOT, "app/api"), [], (n) => n === "route.ts")
  .filter(declaresCaching)
  .map((rel) => {
    const segments = rel.replace(/^app/, "").replace(/\/route\.ts$/, "").split("/");
    const dynamicAt = segments.findIndex((s) => s.startsWith("["));
    const prefix = (dynamicAt === -1 ? segments : segments.slice(0, dynamicAt)).join("/");
    return { rel, prefix: dynamicAt === -1 ? prefix : `${prefix}/` };
  });

check(
  "the scan found cacheable routes",
  cacheable.length >= 2,
  cacheable.map((c) => c.prefix).join(", ") ||
    "a scan that finds nothing passes trivially, which is the failure mode of a " +
      "derived list"
);

console.log("\n2. No client fetch throws that caching away");

/** The forced rebuild MUST reach the origin; pickersBuilder answers it no-store. */
const ALLOWED_BUSTERS = [/\/api\/pickers\?force=1/];

const clientFiles = walk(path.join(ROOT, "app"), [], (n) => /\.tsx$/.test(n)).filter((rel) =>
  /^\s*["']use client["']/m.test(fs.readFileSync(path.join(ROOT, rel), "utf8"))
);
const offenders = [];
for (const rel of clientFiles) {
  const src = readCodeOnly(rel);
  // Every fetch(...) call and the argument text that follows it, bounded to the
  // call itself rather than to a character count -- a comment growing between
  // the URL and the options must not change the answer.
  for (const m of src.matchAll(/fetch\(([\s\S]{0,400}?)\)\s*[;.\n]/g)) {
    const call = m[1];
    const target = cacheable.find((c) => call.includes(c.prefix));
    if (!target) continue;
    if (ALLOWED_BUSTERS.some((re) => re.test(call))) continue;
    const busts = /\?t=\$\{Date\.now\(\)\}|&t=\$\{Date\.now\(\)\}/.test(call);
    const noStore = /cache:\s*["']no-store["']/.test(call);
    if (busts || noStore) {
      offenders.push(`${rel} -> ${target.prefix}${busts ? " (?t=)" : ""}${noStore ? " (no-store)" : ""}`);
    }
  }
}
check(
  "no client component busts a cacheable route",
  offenders.length === 0,
  offenders.length
    ? offenders.join("; ")
    : `checked ${clientFiles.length} client components against ${cacheable.length} ` +
      `cacheable routes — the ?t= made every URL unique, so the CDN never hit ` +
      `and every /pickers view was a Lambda serialising ~8 MB`
);

// THE COUNTEREXAMPLE, PINNED. DashboardTicker has always fetched /api/pickers
// correctly; if somebody "fixes" it by adding a buster the rule above still
// passes for it only because this asserts the plain form directly.
const ticker = readCodeOnly("app/components/DashboardTicker.tsx");
const pickersClient = readCodeOnly("app/pickers/PickersClient.tsx");
check(
  "both /api/pickers callers now fetch it plainly",
  /fetch\("\/api\/pickers"\)/.test(ticker) && /fetch\("\/api\/pickers"\)/.test(pickersClient),
  "DashboardTicker was already right; PickersClient had the buster in two places"
);
check(
  "and the forced rebuild still bypasses the CDN",
  /\/api\/pickers\?force=1&t=\$\{Date\.now\(\)\}/.test(pickersClient),
  "a forced rebuild answered from a CDN entry rebuilds nothing — pickersBuilder " +
    "sends no-store for force=1, and the unique URL is what gets the request there"
);

console.log("\n3. A cache window may not outlive the data behind it");

for (const rel of [
  "app/api/stock-valuation/[symbol]/route.ts",
  "app/api/stock-analyst-rating/[symbol]/route.ts",
]) {
  const src = readCodeOnly(rel);
  const header = Number(
    Function(
      `"use strict"; return (${
        (src.match(/_CACHE_SECONDS = ([0-9 *]+);/) ?? [])[1] ?? "0"
      });`
    )()
  );
  const revalidate = Number(
    Function(
      `"use strict"; return (${
        (src.match(/revalidate: ([0-9 *]+) \}/) ?? [])[1] ?? "0"
      });`
    )()
  );
  const name = rel.split("/")[2];
  check(
    `${name}: the CDN window equals the FMP revalidate`,
    header > 0 && header === revalidate,
    `s-maxage ${header / 3600}h against revalidate ${revalidate / 3600}h — a longer ` +
      `window serves bytes nothing will refresh; a shorter one spends a Lambda to ` +
      `re-serve what the Data Cache hands back unchanged`
  );
  check(
    `${name}: only the answer is cached, not the failures`,
    !/status: 400[\s\S]{0,120}Cache-Control/.test(src) &&
      !/status: 503[\s\S]{0,120}Cache-Control/.test(src) &&
      !/status: 403[\s\S]{0,120}Cache-Control/.test(src),
    "a bad symbol is 400, a missing key is 503 and a refused bot is 403 — storing " +
      "any of those would pin the wrong answer onto every stock page for hours"
  );
}

// THE ROUTE THAT DID NOT QUALIFY, asserted so it is not quietly cached later.
const earnings = readCodeOnly("app/api/stock-earnings/[symbol]/route.ts");
check(
  "stock-earnings is still NOT cached, because it cannot express failure",
  !/s-maxage/.test(earnings),
  "getLatestEarningsData catches its own errors and returns an all-nulls object " +
    "with a 200, so 'FMP is down' and 'this ticker has no earnings' are the same " +
    "response. /api/stock-valuation's own comment set the precondition: the " +
    "distinction has to exist BEFORE a cache header, not after. Fix the status " +
    "codes first"
);

console.log(
  failures === 0
    ? "\nCacheable routes are fetched cacheably, and no window outlives its data.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
