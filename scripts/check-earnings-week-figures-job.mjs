// /earnings-calendar "Results filed": THE ROWS FILL ON A SCHEDULE, NOT ON PAGE
// VIEWS (2026-11-04). The figures used to fill only from the page's after(), 30
// rows a run and only when someone viewed the page; most of a busy week was
// never tried while the stored sets already carried the quarter.
//
//   1. needsFill, RUN: a blank entry is retried after one hour, not six; a
//      filled entry is not; a filled entry with no EPS written before the
//      derived Q4 EPS (no `q4`) is read once more, and not after (`q4: 1`).
//      MUTATIONS: the six-hour retry restored; the q4 refill removed.
//   2. sharesSince, RUN: "—" (null) until a close AFTER the filing exists: the
//      latest close on the same bar as the close before the filing is not 0.0%.
//      MUTATION: the old `<` test restored → 0.0% on the filing day.
//   3. The fill builds the view the stock earnings page builds (derived Q4 EPS
//      and its withheld rule), and honours a deadline. MUTATIONS caught.
//   4. The hourly job: scheduled in vercel.json, in the JOBS registry with the
//      same cron, reads the strip through the page's own row rule, and runs the
//      fill with a deadline inside maxDuration. The page uses the same rule.
//
//   node scripts/check-earnings-week-figures-job.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const STORE = readCodeOnly("lib/server/earningsWeekStore.ts");
const retryOf = (src) => src.match(/^export const RETRY_AFTER_MS = [^;]+;$/m)?.[0].replace(/^export /, "") ?? "";
const loadNeeds = (src) => lift([retryOf(src), grabFunction(src, "needsFill"), "export { needsFill, RETRY_AFTER_MS };"].join("\n"));

console.log("1. needsFill");
const NOW = Date.parse("2026-11-04T09:00:00Z");
const H = 3_600_000;
const C = { d: "2026-11-02", c: 100 };
const FIG = (eps) => ({ periodEnd: "2026-09-30", revenue: 1, revenueYoY: null, epsDiluted: eps });
{
  const N = await loadNeeds(STORE);
  check("a blank entry tried 61 minutes ago is retried", N.needsFill({ f: null, at: NOW - 61 * 60_000 }, C, NOW).figures);
  check("...and one tried 30 minutes ago is not", !N.needsFill({ f: null, at: NOW - 30 * 60_000 }, C, NOW).figures);
  check("a filled entry is not re-read", !N.needsFill({ f: FIG(1.2), at: NOW - 48 * H, q4: 1 }, C, NOW).figures);
  check("a filled entry with no EPS, written before the derived Q4 EPS, is read once more",
    N.needsFill({ f: FIG(null), at: NOW - 2 * H }, C, NOW).figures);
  check("...and not after it is rewritten with q4: 1", !N.needsFill({ f: FIG(null), at: NOW - 2 * H, q4: 1 }, C, NOW).figures);
  check("no entry → filled", N.needsFill(undefined, C, NOW).figures);
  const M6 = await loadNeeds(once(STORE, "export const RETRY_AFTER_MS = 60 * 60 * 1000;", "export const RETRY_AFTER_MS = 6 * 60 * 60 * 1000;"));
  check("MUTATION: the six-hour retry restored → a blank tried 2h ago waits (caught)", !M6.needsFill({ f: null, at: NOW - 2 * H }, C, NOW).figures);
  const Mq = await loadNeeds(once(STORE, " || (f.f !== null && f.f.epsDiluted === null && !f.q4)", ""));
  check("MUTATION: the q4 refill removed → AAPL's EPS stays blank (caught)", !Mq.needsFill({ f: FIG(null), at: NOW - 2 * H }, C, NOW).figures);
}

console.log("\n2. sharesSince");
const WEEK = readCodeOnly("lib/server/earningsWeek.ts");
{
  const load = (src) => lift([grabFunction(src, "sharesSince"), "export { sharesSince };"].join("\n"));
  const W = await load(WEEK);
  check("latest close on the filing-day bar → null (\"—\"), not 0.0%",
    W.sharesSince({ date: "2026-11-03", close: 100 }, { date: "2026-11-03", close: 100 }) === null);
  check("a later close → the move", Math.abs(W.sharesSince({ date: "2026-11-03", close: 100 }, { date: "2026-11-04", close: 103 }) - 3) < 1e-9);
  check("latest before the filing → null", W.sharesSince({ date: "2026-11-03", close: 100 }, { date: "2026-11-02", close: 99 }) === null);
  const Mo = await load(once(WEEK, "latest.date <= before.date", "latest.date < before.date"));
  check("MUTATION: the old test restored → 0.0% on the filing day (caught)",
    Mo.sharesSince({ date: "2026-11-03", close: 100 }, { date: "2026-11-03", close: 100 }) === 0);
}

console.log("\n3. the fill");
{
  const row = grabFunction(STORE, "figuresForRow");
  const derived = (src) => /buildSecEarningsView\(set, \{ deriveQ4Eps: derivedQ4Eps, withheldQ4Eps: q4EpsWithheld \}\)/.test(src);
  check("the row view is built with the stock page's derived Q4 EPS and withheld rule", derived(row));
  check("MUTATION: the bare view (no derivation) → caught", !derived(row.replace("buildSecEarningsView(set, { deriveQ4Eps: derivedQ4Eps, withheldQ4Eps: q4EpsWithheld })", "buildSecEarningsView(set)")));
  const PAGE = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
  check("...the same two options the stock earnings page passes", /deriveQ4Eps: derivedQ4Eps, withheldQ4Eps: q4EpsWithheld/.test(PAGE));
  const fill = grabFunction(STORE, "fillWeekFigures");
  const stops = (src) => /const out = \(\) => opts\.deadlineMs !== undefined && Date\.now\(\) >= opts\.deadlineMs;/.test(src)
    && (src.match(/if \(done >= max \|\| out\(\)\)\s*break;/g) ?? []).length === 2;
  check("the fill stops starting symbols at the deadline, in both loops", stops(fill));
  const inner = fill.match(/\n(\s+)if \(done >= max \|\| out\(\)\)\s*break;/g)?.[1] ?? "";
  check("MUTATION: the inner deadline test removed → caught", inner !== "" && !stops(once(fill, inner, inner.replace(" || out()", ""))));
  check("a filled entry is written with q4: 1", /f\[symbol\] = \{ f: got, at: now, q4: 1 \};/.test(fill));
  check("a close-only refill reads no fact set", /figuresForRow\(source, date, need\.figures\)/.test(fill) && /wantFigures && event\?\.periodEnd \?/.test(row));
}

console.log("\n4. the hourly job");
{
  const ROUTE = readCodeOnly("app/api/jobs/earnings-week-figures/route.ts");
  const cron = (JSON.parse(fs.readFileSync("vercel.json", "utf8")).crons ?? []).find((c) => c.path === "/api/jobs/earnings-week-figures")?.schedule;
  check("scheduled hourly in vercel.json", cron === "25 * * * *", String(cron));
  const JOBS = readCodeOnly("lib/server/jobRuns.ts");
  check("in the JOBS registry with the same cron", /"earnings-week-figures": \{[^}]*cron: "25 \* \* \* \*"/.test(JOBS));
  check("reads the strip through the shared row rule", /stripDaySymbols\(days\)/.test(ROUTE) && /weekDays\(easternDate\(new Date\(\)\)\)/.test(ROUTE));
  const budget = Number(ROUTE.match(/const BUDGET_MS = ([\d_]+);/)?.[1].replace(/_/g, "")), maxD = Number(ROUTE.match(/export const maxDuration = (\d+);/)?.[1]);
  check("runs the fill with a deadline well inside maxDuration", /deadlineMs: started \+ BUDGET_MS/.test(ROUTE) && budget > 0 && budget <= maxD * 1000 * 0.8, `${budget} ms of ${maxD} s`);
  check("records its run", /recordJobRun\("earnings-week-figures"/.test(ROUTE));
  const PAGE = readCodeOnly("app/earnings-calendar/page.tsx");
  check("the page's rows come from the same rule", /stripLists\(raw, /.test(PAGE) && /stripSymbols\(raw\)/.test(PAGE) && !/primaryPerFiler\(/.test(PAGE));
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
