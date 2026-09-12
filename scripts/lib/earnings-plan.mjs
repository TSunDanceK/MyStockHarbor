// The derived earnings plan, lifted once and shared by the checks that need it.
//
// WHY THIS IS A LIB AND NOT COPIED INTO TWO CHECKS. EARNINGS_BATCH_SIZE is no
// longer a literal -- it is planEarningsDay's answer for the current universe
// caps -- so any check that wants the batch has to re-derive it. Two scripts
// re-deriving it separately is two chances to derive it differently, which is
// the exact failure the derivation was introduced to remove. One derivation,
// read by both.
//
// EVERY INPUT COMES FROM THE SOURCE, none from a literal here: the caps from
// dynamicUniverseCache, the share from earningsPlan, the ceiling and the run
// budget from the warm-earnings route, the cadence from the JOBS registry
// (which check-cache-health-page asserts against vercel.json), and the two TTLs
// from earningsStore.
import ts from "typescript";
import { readCodeOnly } from "./source-code.mjs";

const erase = (src) =>
  ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;

/**
 * Pull one function out of a TS module, types erased first.
 *
 * TYPES ERASED BECAUSE BRACES IN SIGNATURES BREAK EVERY TEXTUAL RULE: an inline
 * parameter type closes with `}): ... {` and an inline return type with
 * `): { ... }`, and both have already cost this repo a lifted signature
 * fragment that exported nothing. Longest prefix first, or `export async
 * function` loses its `async` and the body's `await` is a syntax error.
 */
export const grabFunction = (tsSrc, name) => {
  const src = erase(tsSrc);
  let start = -1;
  for (const prefix of [
    "export async function ",
    "async function ",
    "export function ",
    "function ",
  ]) {
    const at = src.indexOf(`${prefix}${name}(`);
    if (at !== -1) {
      start = at;
      break;
    }
  }
  if (start === -1) return null;
  const bodyStart = src.indexOf("{", src.indexOf(")", start));
  if (bodyStart === -1) return null;
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
};

export const lift = async (src, extra = "") => {
  const js = erase(`${extra}\n${src}`);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};

const numFrom = (src, name) =>
  Number(
    Function(
      `"use strict"; return (${(src.match(new RegExp(`${name} = ([0-9_.* ]+);`)) ?? [])[1] ?? "0"});`
    )()
  );

/**
 * Everything the batch arithmetic rests on, read from where it lives.
 *
 * Returns `{ inputs, planAt, plan }`. `planAt(universeSize)` runs the real
 * planEarningsDay against the real constants for any universe, which is what
 * lets a check ask "and what would 3,000 need?" without anyone writing the
 * answer down.
 */
export async function loadEarningsPlan() {
  const universe = readCodeOnly("lib/server/dynamicUniverseCache.ts");
  const planSrc = readCodeOnly("lib/server/earningsPlan.ts");
  const route = readCodeOnly("app/api/jobs/warm-earnings/route.ts");
  const store = readCodeOnly("lib/server/earningsStore.ts");
  const history = readCodeOnly("lib/server/historyCache.ts");
  const jobs = readCodeOnly("lib/server/jobRuns.ts");

  const inputs = {
    analysisCap: numFrom(universe, "ANALYSIS_UNIVERSE_CAP"),
    dynamicCap: numFrom(universe, "MAX_DYNAMIC_UNIVERSE_SIZE"),
    share: numFrom(planSrc, "EARNINGS_PEAK_DAY_SHARE"),
    headroom: numFrom(route, "EARNINGS_MIN_HEADROOM_CALLS"),
    runBudgetMs: numFrom(route, "EARNINGS_RUN_BUDGET_MS"),
    safePerMinute: numFrom(history, "FMP_SAFE_CALLS_PER_MINUTE"),
    ttlDay: numFrom(store, "EARNINGS_TTL_DAY"),
    nearTtl: numFrom(store, "EARNINGS_TTL_NEAR_REPORT_SECONDS"),
    cron: (jobs.match(/"warm-earnings":[^}]*cron:\s*"([^"]+)"/) ?? [])[1] ?? "",
  };
  inputs.basis = inputs.analysisCap + inputs.dynamicCap;
  inputs.ceiling = Math.floor(
    (inputs.safePerMinute - inputs.headroom) * (inputs.runBudgetMs / 60_000)
  );

  const missing = Object.entries(inputs).filter(([, v]) => !v);
  if (missing.length) {
    return { inputs, missing: missing.map(([k]) => k), planAt: null, plan: null };
  }

  // The cadence, through the same helper the route uses.
  const cronMod = await lift(grabFunction(jobs, "cronIntervalSeconds"));
  inputs.runPeriodSeconds = cronMod.cronIntervalSeconds(inputs.cron);

  const mod = await lift(
    `${grabFunction(planSrc, "fetchesPerReport")}\n${grabFunction(planSrc, "planEarningsDay")}`
  );
  const planAt = (universeSize, callsPerRun = inputs.ceiling) =>
    mod.planEarningsDay({
      universeSize,
      peakDayShare: inputs.share,
      callsPerRun,
      runPeriodSeconds: inputs.runPeriodSeconds,
      leadSeconds: inputs.ttlDay,
      nearReportTtlSeconds: inputs.nearTtl,
    });

  return { inputs, missing: [], planAt, plan: planAt(inputs.basis) };
}

/**
 * The warm-earnings route's MAIN recordJobRun call, sliced out of the source.
 *
 * SHARED BECAUSE BOTH CALLERS ANCHORED ON THE SAME LITERAL AND BOTH BROKE.
 * check-earnings-batch and check-earnings-minute-wall each carried
 * `recordJobRun("warm-earnings", true, {\n` as their anchor, which bakes the
 * SECOND ARGUMENT into a slice that is only trying to find the FIRST. The
 * moment that argument stopped being the literal `true` -- when the run learned
 * to go red on a rotting dataset -- both slices returned "" and both checks
 * failed on correct code, in two files, for one reason.
 *
 * Anchored on the call and its job name only. The `\n` is kept: it is what
 * distinguishes the multi-line record from the single-line lock-skip one near
 * the top of the route, which carries { skipped, reason } and none of the
 * fields either caller is looking for. lastIndexOf as well, as a second
 * defence, for the same reason the old comments give.
 *
 * Returns "" when nothing matched, and every caller already renders that as a
 * distinct "sliced the wrong call" message rather than as a content failure --
 * which is the reason this refactor was legible when it broke.
 */
export const sliceWarmEarningsRunRecord = (routeSrc) => {
  const anchor = 'recordJobRun("warm-earnings",';
  let start = -1;
  for (let at = routeSrc.lastIndexOf(anchor); at !== -1; at = routeSrc.lastIndexOf(anchor, at - 1)) {
    const open = routeSrc.indexOf("{", at);
    const nl = routeSrc.indexOf("\n", at);
    // The multi-line one: the brace opens and the line ends immediately after.
    if (open !== -1 && nl !== -1 && nl > open && routeSrc.slice(open + 1, nl).trim() === "") {
      start = at;
      break;
    }
    if (at === 0) break;
  }
  if (start === -1) return "";
  const end = routeSrc.indexOf("});", start);
  return end === -1 ? "" : routeSrc.slice(start, end);
};
