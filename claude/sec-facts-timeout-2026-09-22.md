# sec-facts timing out at 300s — diagnosed, then budgeted

## Symptom
Production `/api/jobs/sec-facts` (04:20 UTC) returned **504 "Task timed out after 300
seconds"** on 2026-09-22. Its last recorded run is **2026-09-20T04:20Z**
(`msh:job-run:v1:sec-facts`). The newest `verifiedAt` in the manifest is 2026-09-20T04:20:14Z,
so **no run has saved anything since Sep 20**: the manifest is written once, at the end.

## Cause (relay 35778314028, `write-sec-facts-timeout-diagnosis`)

| | last good run (Sep 20) | next run, as the manifest stands |
|---|---|---|
| reverify | 1 | 33 |
| populate | 7 | 0 |
| rewindow backlog | **0** | **785** (limit 442 = floor 25 + slack 417) |
| fact-set fetches | 8 | **up to 525** (50 cold + 475) |
| report dates | 100 | never reached |

All 785 populated entries are stale on **both** stamps. The manifest has `lv: 3` and
`c: 970595cd`, and the shipped values are `lv: 4` and `c: c618f4a2`:

- **`SEC_LABEL_VERSION` 3 → 4**, in #479 (`301cec36`, merged 2026-09-20 07:39 UTC). This
  landed three hours after the last good run, and the Sep 21 04:20 run was the first
  after it.
- **`secChainsHash` changed** in #500 (cover-share chain, Sep 21) and #504 (secFields,
  Sep 22).

With populate empty, rewindow borrows the unused slack (by design, see
`populationQueues`) and asks for about 525 companyfacts in one run. On a runner these
average 172 ms and 3.0 MB each (p50 183 ms, max 659 ms). On the lambda, parsing,
extraction, FX conversion, the prior-set read and the write come on top. That goes
past 300 s. **The timeout loses the manifest write, so the next day builds the
identical queue and times out again.** It is a self-sustaining loop, not a slow day.

Nothing merged Sep 19–22 added per-symbol reads or SEC fetches to the report-dates
block. The due-input producer (#507) and the category/annual fields touch only the
record write. The FX lookups from #479 add one fetch per currency per run, cached.
The ECB 404s in the log (PEN, CLP, COP) are fast failures, not hangs.

## Other SEC jobs: healthy
- **sec-daily-index:** last run 2026-09-22T04:00:16Z, ok, 183 ms, 33 re-reads queued.
- **ipo-refresh:** last run 2026-09-22T04:40:30Z, ok, 7.1 s, caught up.
- **sec-report-dates-rewrite:** new; its first run is 2026-09-23 05:10.

## Fix
`lib/server/jobBudget.ts`, wired into the route:

- **Budget:** a 240 s wall-clock budget from the start of the request. The fact-set
  phase stops taking symbols at 180 s. Report dates keep a **reserved 60 s**, so the
  fact-set loop can no longer starve them.
- **Stopping:** a stopped loop breaks to the manifest write and the job-run record,
  which are always reached. A slow SEC day now shrinks a run instead of killing it.
- **Cursor:** the manifest stamps themselves. Every symbol finished this run carries
  `lv`/`c`/`w`/`y` at the shipped values, so tomorrow's queues start after them.
- **Fetch timeouts:** every fetch is bounded to 20 s (SEC companyfacts and submissions,
  FRED, ECB). A hung socket can no longer outlive the budget check between symbols.
  The worst case, with every fetch hanging to its timeout, still ends by 260 s.
- **Summary per run:** `elapsedMs`, and time per phase (manifest read, cold-CIK,
  facts, report dates, manifest write). Also `factsDone*` per queue, `factsDeferred`
  and `reportDatesDeferred`.

Check: `scripts/check-sec-facts-budget.mjs` covers a fake clock, the worst-case
arithmetic, the route wiring, and three mutations.
