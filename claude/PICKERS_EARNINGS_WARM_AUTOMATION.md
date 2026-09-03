# Pickers & Earnings warm-up automation (mirror)

This is a GitHub mirror of the `claude/PICKERS_EARNINGS_WARM_AUTOMATION.md` doc
kept in the Claude Project "My Stock Harbor Website".

## Where the schedule lives: `vercel.json`, not GitHub

**Corrected 2026-09-03.** This file used to say the automation *"runs as a
GitHub Actions scheduled workflow… daily at `cron: "3 5 * * *"` UTC"*. It no
longer does. `.github/workflows/pickers-warm.yml` is now
**`workflow_dispatch` only** — a hand-pulled "warm everything now" lever — and
every scheduled warm is a `vercel.json` cron entry.

### Why the GitHub schedule was removed

GitHub's scheduled workflows are best-effort: queued, delayed under load, and
sometimes dropped. 05:03 UTC sits in one of the busiest cron windows there is.
Measured across **all 29 scheduled runs on record**, against a due time of
05:03 UTC (06:03 BST):

| Period | Drift | Fired at |
|---|---|---|
| Aug 05–06 | +162 to +163 min | ~08:45 BST |
| Aug 07–14 | +46 to +80 min | 06:49–07:22 BST |
| Aug 15–26 | **+29 to +46 min** | 06:32–06:46 BST — the best stretch on record |
| Aug 27 | +678 min | 17:21 BST |
| Aug 28 | +737 min | 18:19 BST |
| Aug 29 – Sep 02 | +265 to +391 min | 10:27–12:34 BST |
| Sep 03 | **did not fire** | still absent at 10:12 BST |

**It never once fired within half an hour of its schedule.** The best day in the
entire record is +29 minutes. For the last week a job whose purpose is "warm the
site early in the morning" was firing at lunchtime, when it fired at all.

Vercel Cron landed on time every day over the same period (07:02 and 07:15,
confirmed in the runtime logs) and attaches the `Authorization` header itself,
so there is no secret to keep in step either.

### What still runs, and when

Everything scheduled is in `vercel.json` (six entries; the plan's limit is 100
per project). `lib/server/jobRuns.ts` is the registry, and
`scripts/check-cache-health-page.mjs` asserts the two agree in both directions.

`scripts/check-cron-auth.mjs` additionally asserts that the workflow stays
manual-only and that **every job a workflow calls is also scheduled by Vercel** —
so a future change cannot remove a trigger and its replacement in two different
PRs and leave a window with neither.

### The manual lever is deliberately kept

Run `33701587009` (2026-09-03 00:56, `workflow_dispatch`) returned 200 on all
three calls: `warm-picker-universe` in **172s** — a real forced build — and each
earnings pass in ~4s. The secret is already wired for it, and the
authentication rules below still apply to it.

It now **prints each response body** (capped) rather than discarding it, so the
person pulling the lever can see `fetchedCount`, `deferredCount`, `outOfTime`
and `refreshMode` instead of a bare status code.

### Only one earnings pass a day now

The workflow's two extra `warm-earnings` passes are gone with the schedule and
were **not** replaced by cron entries. #406 let one run span minute buckets, so
a single run's reach is `(200 − 90) × 4 min = 440` calls against three passes'
120 — the batch constant, not the pass count, is the lever, and it is sized
from the `/api/debug/earnings-concentration` measurement added in #407. See
`claude/earnings-season-measurement-2026-09-02.md`.

## The endpoints are NOT public (corrected 2026-09-02)

This file also used to say: *"Both endpoints are public, unauthenticated, and
self-rate-limiting."* That was wrong, and wrong in the direction that kept a
broken job looking healthy.

* `/api/jobs/warm-earnings` gates on `Bearer ${process.env.CRON_SECRET}` and
  returns **401** without it.
* `/api/jobs/warm-picker-universe` returns **200** without it — but the secret
  is what authorises the *history force* (`isCronAuthorized` in
  `pickersBuilder.ts`). Unauthenticated it runs as an ordinary miss-only warm,
  which against a 50h history TTL refreshes nothing. It records
  `refreshMode: "miss-only"` and logs *"Check CRON_SECRET is set"* when that
  happens.

Vercel's own cron sends the header automatically. The GitHub workflow now sends
`Authorization: Bearer ${{ secrets.CRON_SECRET }}` from a single `call` helper
and **fails the step on a non-200** — `curl -sS -o /dev/null -w "%{http_code}"`
exits 0 on a 401, which is how three failing calls read as a green tick for
weeks. It stays dead until `CRON_SECRET` is present in the repository's Actions
secrets.

## The `/pickers` "Fetch Earnings" button is a different problem

`app/pickers/PickersClient.tsx` calls the same route **from the browser**, so it
has been failing on 401 for every visitor who clicks it. It must **not** get the
same fix: `CRON_SECRET` in client code ships the secret to every visitor. It is
architecturally dead, not misconfigured — deleting it is the standing
recommendation.
