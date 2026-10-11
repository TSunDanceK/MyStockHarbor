// The instrumentation that answers "why is this symbol stale" and "is it the
// same twenty failures every morning" — from the first live forced warm.
export const TITLE = "Stale-bar diagnostics and refreshMode";

const HISTORY = "lib/server/historyCache.ts";
const WARM = "app/api/jobs/warm-picker-universe/route.ts";
const BARS = "scripts/check-history-bars.mjs";

export const MUTATIONS = [
  {
    id: "D1",
    description: "stale symbols recorded without their date",
    file: HISTORY,
    find: "    symbols: [...historyStaleNewest].map(([sym, date]) => `${sym}@${date}`),",
    replace: "    symbols: [...historyStaleNewest.keys()],",
    harnesses: [BARS],
    // 3, not 2: the boundary assertions added after the first calibration run
    // also depend on the date being present in the record.
    expect: 3,
  },
  {
    id: "D2",
    description: "diagnostic sample capped back at the drop cap of 12",
    file: HISTORY,
    find: "const MAX_DIAGNOSTIC_SYMBOLS = 40;",
    replace: "const MAX_DIAGNOSTIC_SYMBOLS = 12;",
    harnesses: [BARS],
    expect: 1,
  },
  {
    id: "D3",
    description: "holiday slack removed (one trading day, not two)",
    file: HISTORY,
    find: "export const HISTORY_MAX_BAR_AGE_WEEKDAYS = 2;",
    replace: "export const HISTORY_MAX_BAR_AGE_WEEKDAYS = 1;",
    harnesses: [BARS, "scripts/check-history-ttl.mjs"],
    // 0 on the first run -- nothing asserted the threshold at all, because every
    // fixture sat far from its edge. The boundary cases were added because this
    // mutation failed nothing.
    expect: 2,
  },
  {
    id: "D4",
    description: "refreshMode reverted to the ambiguous boolean",
    file: WARM,
    find: "      refreshMode,\n",
    replace: "",
    harnesses: [BARS],
    expect: 1,
  },
  {
    id: "D5",
    description: "forced-failure symbols counted but not recorded",
    file: WARM,
    find: "      historyForcedRefetchFailureSymbols: barAge.forcedRefetchFailureSymbols.join(\",\") || null,\n",
    replace: "",
    harnesses: [BARS],
    expect: 1,
  },
  {
    id: "D6",
    description: "throw sites lose their reason (back to bare Error)",
    file: HISTORY,
    find: 'throw new FmpHistoryError("FMP call guard wait timeout", "capacity-timeout");',
    replace: 'throw new Error("FMP call guard wait timeout");',
    harnesses: [BARS],
    expect: 1,
  },
  {
    id: "D7",
    description: "network and parse folded into 'other'",
    file: HISTORY,
    edits: [
      { find: '  if (error instanceof SyntaxError) return "parse";\n', replace: "" },
      { find: '  if (error instanceof TypeError) return "network";\n', replace: "" },
    ],
    harnesses: [BARS],
    // 2, not 3: the "three reasons want opposite fixes" check passes explicit
    // FmpHistoryError instances, which still classify correctly. Only the two
    // instanceof cases regress.
    expect: 2,
  },
  {
    id: "D8",
    description: "reason histogram capped like the symbol sample",
    file: HISTORY,
    find: "            historyForcedFailureReasons.set(reason, (historyForcedFailureReasons.get(reason) ?? 0) + 1);",
    replace: "            if (historyForcedFailureReasons.size < MAX_DIAGNOSTIC_SYMBOLS) historyForcedFailureReasons.set(reason, (historyForcedFailureReasons.get(reason) ?? 0) + 1);",
    harnesses: [BARS],
    expect: 1,
  },
  {
    id: "D9",
    description: "reason histogram not recorded on the run",
    file: WARM,
    find: "      historyForcedRefetchFailureReasons: barAge.forcedRefetchFailureReasons.join(\",\") || null,\n",
    replace: "",
    harnesses: [BARS],
    expect: 1,
  },
];
