// #362's calibration, as a re-runnable spec rather than a table in a PR body.
//
// The expected counts are the ones measured when #362 landed. They are
// assertions now: `node scripts/calibrate.mjs scripts/calibrations/force-ttl.mjs`
// re-proves every one, and any drift is an exit code rather than something
// someone has to notice.
//
// WHY IT WAS RE-RUN. #362's harnesses stripped comments with ts.createScanner,
// which #363 then found loses the thread at a template literal with a `${...}`
// substitution. The production change was never in question -- but a calibration
// run against a flawed reader is a measurement of the reader. So all fourteen
// were re-measured under the parser-based stripper.
export const TITLE = "#362 — forced warm, 50h success TTL, 15min failure floor";

const BUILDER = "lib/server/pickersBuilder.ts";
const HISTORY = "lib/server/historyCache.ts";
const WARM = "app/api/jobs/warm-picker-universe/route.ts";
const PAGE = "app/cache-health/page.tsx";
const QUEUE = "lib/server/stalenessQueue.ts";

const FORCE = "scripts/check-forced-build-safety.mjs";
const TTL = "scripts/check-history-ttl.mjs";
const HEALTH = "scripts/check-cache-health-page.mjs";

export const MUTATIONS = [
  {
    id: "M1",
    description: "degraded guard re-gated on !forceRefresh (both sites)",
    file: BUILDER,
    find: "if (isDegradedBuild(data) && cached?.data) {",
    replace: "if (isDegradedBuild(data) && cached?.data && !forceRefresh) {",
    all: true,
    count: 2,
    harnesses: [FORCE],
    // 7 when #362 measured it; 9 since #363 added the run-record assertions in
    // section 1b, which a refused-vs-published build also breaks. The mutation
    // and the code are unchanged -- the harness got stricter.
    expect: 9,
  },
  {
    id: "M2",
    description: "conditional cache read reintroduced (both sites)",
    file: BUILDER,
    find: "const cached = await readPickersCache();",
    replace: "const cached = forceRefresh ? null : await readPickersCache();",
    all: true,
    count: 2,
    harnesses: [FORCE],
    // 7 when #362 measured it; 9 now, and for the same benign reason as M1 --
    // #363's section 1b assertions. All seven originals still fire; verified
    // line by line, not inferred from the total.
    //
    // On main as merged this read 4, because the harness CRASHED at section 3:
    // the "FORCED + threw + good cache" wrap that #362's commit message
    // described was never actually committed (git log -S threwWithCache is
    // empty). Restored, and scripts/calibrate.mjs now treats a missing verdict
    // line as a CRASH rather than counting how far a dead harness got.
    expect: 9,
  },
  {
    id: "M3",
    description: "!forceRefresh dropped from the lock fallbacks",
    file: BUILDER,
    find: "if (!lockToken && !forceRefresh && cached?.data)",
    replace: "if (!lockToken && cached?.data)",
    all: true,
    count: 2,
    harnesses: [FORCE],
    expect: 1,
  },
  {
    id: "M4",
    description: "warm route re-exports the public GET",
    file: WARM,
    find: "GET_WARM as buildPickerUniverse",
    replace: "GET as buildPickerUniverse",
    harnesses: [TTL],
    expect: 1,
  },
  {
    id: "M5",
    description: "failure TTL derived from the success TTL",
    file: HISTORY,
    find: "const HISTORY_FAILURE_TTL_SECONDS = 15 * 60;",
    // 50 * 3600 / 200 is exactly 900, so the VALUE check still passes and only
    // the "not derived" assertion catches it. That is the point of having both.
    replace: "const HISTORY_FAILURE_TTL_SECONDS = REDIS_HISTORY_TTL_SECONDS / 200;",
    harnesses: [TTL],
    expect: 1,
  },
  {
    id: "M6",
    description: "failure branch moved after the weekend branch",
    file: HISTORY,
    // TWO EDITS, because MOVING a branch is a delete plus an insert. Expressing
    // it as a single delete would test "the failure floor was removed", which is
    // a different and much louder change than "the failure floor was placed
    // where the weekend branch can pre-empt it" -- the mistake this guards.
    edits: [
      {
        find: `  if (outcome === "failure") return HISTORY_FAILURE_TTL_SECONDS;

  const { weekday, hour, minute } = getEasternParts(now);`,
        replace: "  const { weekday, hour, minute } = getEasternParts(now);",
      },
      {
        find: "  return REDIS_HISTORY_TTL_SECONDS;\n}",
        replace: `  if (outcome === "failure") return HISTORY_FAILURE_TTL_SECONDS;
  return REDIS_HISTORY_TTL_SECONDS;
}`,
      },
    ],
    harnesses: [TTL],
    expect: 3,
  },
  {
    id: "M7",
    description: "getDailyHistoryBulk left miss-only under force",
    file: HISTORY,
    find: "if (ok && !force) {",
    replace: "if (ok) {",
    harnesses: [TTL],
    expect: 1,
  },
  {
    id: "M8",
    description: "forced-refetch failure drops the symbol",
    file: HISTORY,
    find: "if (!force || !fallback) throw error;",
    replace: "throw error;",
    harnesses: [TTL],
    expect: 1,
  },
  {
    id: "M9",
    description: "history TTL back to 6h",
    file: HISTORY,
    find: "const REDIS_HISTORY_TTL_SECONDS = 50 * 60 * 60;",
    replace: "const REDIS_HISTORY_TTL_SECONDS = 6 * 60 * 60;",
    harnesses: [TTL],
    expect: 3,
  },
  {
    id: "M10",
    description: 'registerSymbols("dailyHistory") removed',
    file: BUILDER,
    find: `  if (forceHistoryRefresh) {
    await registerSymbols("dailyHistory", universe);
  }`,
    replace: "  if (forceHistoryRefresh) { /* removed */ }",
    harnesses: [HEALTH],
    expect: 1,
  },
  {
    id: "M11",
    description: "page renders the ratio for uncovered datasets",
    file: PAGE,
    find: `                      {!d.instrumented
                        ? "—"
                        : !d.coverageEstablished
                          ? \`\${d.tracked} seen\`
                          : \`\${fresh} / \${d.tracked}\`}`,
    replace: '                      {d.instrumented ? `${fresh} / ${d.tracked}` : "—"}',
    harnesses: [HEALTH],
    expect: 1,
  },
  {
    id: "M12",
    description: "coverage branch moved below the ok logic",
    file: PAGE,
    // The mutation that exposed the original positional assertion as worthless:
    // the whole block moves to sit immediately above the ok return, so the text
    // ORDER of `status: "uncovered"` and `status: "ok"` is unchanged while the
    // control flow is completely different. It failed 0 against the positional
    // check and fails 1 against the executed statusFor that replaced it.
    edits: [
      {
        find: `  if (!d.coverageEstablished) {
    return {
      status: "uncovered",
      why: \`\${d.tracked} observed, no declared population — nothing calls registerSymbols for this dataset, so a ratio here could only ever be 100%\`,
    };
  }
`,
        replace: "",
      },
      {
        find: '  return { status: "ok", why: "within policy" };',
        replace: `  if (!d.coverageEstablished) {
    return {
      status: "uncovered",
      why: \`\${d.tracked} observed, no declared population — nothing calls registerSymbols for this dataset, so a ratio here could only ever be 100%\`,
    };
  }
  return { status: "ok", why: "within policy" };`,
      },
    ],
    harnesses: [HEALTH],
    expect: 1,
  },
  {
    id: "M13",
    description: 'screenerFundamentals mislabelled "registered"',
    file: QUEUE,
    find: '    coverage: "observed-only",',
    replace: '    coverage: "registered",',
    harnesses: [HEALTH],
    expect: 1,
  },
  {
    id: "M14",
    description: "coverageEstablished ignored in statusFor",
    file: PAGE,
    find: "  if (!d.coverageEstablished) {",
    replace: "  if (false) {",
    harnesses: [HEALTH],
    expect: 4,
  },
];
