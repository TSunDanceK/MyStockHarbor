# What the due strip still needs, and why none of it is a "run" (2026-09-21)

Written after attempting the two data jobs and finding all three remaining items
are a different shape from their scoping. Recorded so the next session does not
re-derive it.

## (a) The static top-50 list — the run happened and the script REFUSED

Relay [35626598282], task `due-strip-universe`, against the relay's default
step-0 dump (run `34690240239`). The dump downloaded fine; **the task failed on
the script's own canary**:

```
  not in the universe  -> the analysis universe is the wrong input for a cap ranking
  no cap in any source -> nothing in the dump priced it; the cut is of what answered
  ranked below the cut -> the caps themselves are wrong or stale
Fix the input. Do not widen CUT to paper over it.
```

**This is the NVDA canary its own header documents** — the one added after a
first run reported "840 entries, 0 unparseable, 99.4% universe coverage" and
produced a top-50 with NVDA nowhere in it. It refuses to emit a membership list
when a known mega-cap falls outside the cut.

So this is not a plumbing failure to retry. It is the standing rule working:
*keep canaries that refuse to emit rather than shipping a hole silently*. The
frozen dump is months old and its caps can no longer produce a trustworthy cut.

**What it actually needs first: a FRESH step-0 dump.** That is
`.github/workflows/step0-ground-truth.yml`, a different workflow with Upstash's
read-only token — not the relay. Committing a list from the stale dump would be
committing the exact hole the canary exists to stop.

## (b) There is no "stage 1 backfill" to run

`lastResultsDate` is not a stored field. #484 deleted `secResultsDate.ts` and
consolidated onto `secReportDatesStore`; `latestResults()` **derives** it from
the newest matched event, and `secManifest.ts` carries an explicit note that the
store is "THE SINGLE HOME".

That store is written by **`app/api/jobs/sec-facts/route.ts`** — a production
Vercel cron, `SEC_REPORT_DATES_PER_RUN = 100` symbols a run. It is not a job a
sandbox session can invoke; it runs on its own schedule and has been doing so.

**And the relay cannot check whether it is populated.** `relay.yml`'s read-only
job references *no secrets at all* — deliberately, so read-only work "cannot
reach Redis even by accident" — and the credentialled job is reserved for
`write-` tasks. Answering "is the store populated" needs the step-0 read-only
path, which is the same prerequisite as (a).

`dueStripState.ts`'s header still says "until the stage 1 backfill has run over
the universe". **That sentence is stale** — it predates #484 and describes a
mechanism that no longer exists.

## (c) Wiring the strip is a BUILD, not a wiring

`selectDue()` is a pure selector over `DueInput[]`. **Nothing in `lib/` or
`app/` constructs a `DueInput`.** The producer does not exist.

It would have to, per symbol in the universe: read the report-dates store, find
the fiscal period end with no observed results filing, and supply
`medianLagDays` (computed in `secReportDates.ts:587`, not currently surfaced
per-symbol), `filerCategory` and `annual`. Then intersect with the static
top-50 and feed `resolveDueStrip`.

That is a module on the scale of `dueStripState`, `calendarDayState` or
`securityKind` — each of which was its own PR.

## The order these unblock in

1. Fresh step-0 dump (`step0-ground-truth.yml`, read-only Upstash token).
2. Re-run `due-strip-universe` against it; the canary should pass. Commit the
   list to `data/` with its generation date.
3. From the same dump, confirm the report-dates store is populated.
4. **Build** the `DueInput` producer.
5. Then wire the strip, and only then is the build complete.

**Step 1 is the gate on all of it**, and it is a credentialled production read —
an owner decision, not a sandbox one.
