# Cache health page — spec (22 Aug 2026)

> **Commit this file to `claude/` in the repo.** It was written in the Claude
> Project, which Claude Code cannot read — the same gap that made
> `seo-recovery-progress-2026-08-17.md` uncitable. Anything Code has to build
> against belongs in the repo, not the Project.


Owner request, 22 Aug. Build alongside the FMP byte meter and the staleness
queue — all three read the same bookkeeping, so building them separately means
building the plumbing three times.

## Why this exists

Every failure on 22 Aug was a coverage hole that nothing reported:

| what was wrong | how it was found |
|---|---|
| sector lockout — symbols permanently skipped | a screenshot |
| quote stage truncating at 357 of 755, same tail daily | reading a log by hand |
| Signals computed then discarded for ~700 rows a page | a screenshot |
| FMP at 73.6% of a 20 GB cap nothing measures | the FMP dashboard, by chance |

None produced an error, a failed build or a red anything. The site cannot
currently answer **"is my data complete?"** — that is the whole gap.

## What it shows

**Top line — the limit that actually binds:** FMP bandwidth, GB used against the
20 GB / 30-day cap, broken down by endpoint. Calls/min beside it as a secondary
(that bar reads 0/300; it is not the problem).

**Then one row per cache namespace** (~40 today):

- coverage — keys present vs universe, as a fraction and a percentage
- staleness — oldest entry, and how many are past their own TTL
- policy — the TTL this dataset is supposed to hold to
- last warm run — when, and its outcome

**Status per row must be derived from that dataset's own TTL, not a fixed
threshold.** A 30-day-old profile is healthy; a 30-day-old price is a fault. A
single global "stale = 24h" rule would report the whole page wrong.

## Security — as specified by the owner

- **READ-ONLY. No control on this page may trigger a refresh.** Any "re-warm
  now" button is a separate route with a separate key. Shared key = one leak
  turns a stats page into unbounded FMP spend against a cap already at 73.6%.
- Gate on `lib/server/backfillAuth.ts` — the existing house pattern — with its
  **own new key**. Not `EARNINGS_BACKFILL_KEY` reused, never `CRON_SECRET`
  (`fmp-endpoints/route.ts:56` records why those stay separate).
- `export const dynamic = "force-dynamic"`. Not optional:
  `scripts/check-static-safety.mjs` flags `backfillAuth.ts:16` as a bare
  `Redis.fromEnv()` without `PAGE_READ_CACHE`, and a no-store Redis client on a
  prerendered route is the production-500 documented in
  `claude/traps/a-visible-failure-is-not-a-harmless-one.md`. An owner-only page
  should never be prerendered anyway, so this costs nothing.
- `noindex, nofollow`; absent from `app/sitemap.ts`; linked from nowhere;
  rate-limited.
- BotID protects API routes, not server-rendered page HTML
  (`instrumentation-client.ts`) — so if this is a page, the key is the control.

## The page must be cheap to load

Naively this reads ~40 namespaces × ~755 symbols. **Do not scan.** Read
aggregates the warm jobs already maintain:

- `ZCARD` / `ZCOUNT` on the per-dataset staleness sorted sets (see below) for
  coverage and stale counts
- the rolling byte counters for bandwidth
- a small `last-run` summary key per job, written by the job itself

If the page ever needs a full scan to answer a question, that answer belongs in
a counter instead. A health page that is expensive to open is a health page
nobody opens.

## Shared plumbing — build once, three consumers

One Redis sorted set per dataset, scored by last-refresh timestamp:

- the **warm job** pops the stalest N — replaces blind rotation, so every call
  is spent on something that actually needed refreshing
  (`pricePool.ts` already does exactly this; fundamentals is the one that does not)
- the **health page** reads counts off the same set — no new bookkeeping
- the **byte meter** buckets response sizes by endpoint over a rolling 30 days,
  beside the existing per-minute call counter in `historyCache.ts`

Three rules for the queue, learned the hard way today:

1. **Defer failures.** A delisted ticker that always fails stays permanently
   stalest and re-enters the front every run — "do the stalest first" silently
   becomes "retry the broken ones forever". Same treatment #337 gave profiles:
   mark, return in a week.
2. **One queue per dataset, not one master queue.** Prices refresh every 15
   minutes, profiles every 30 days. In a shared queue the price rows starve
   everything else permanently.
3. **Budget stays fixed and external.** This changes *what* is fetched, not
   *how much*. A job that sets its own spending is the wrong thing to build at
   73.6% of a hard cap.

## What good looks like

The page answers, in one screen and without a log dive:

- are we about to hit the bandwidth cap, and which endpoint is spending it
- which datasets are incomplete, and by how much
- which warm job last failed, or silently did nothing

Every one of the four failures in the table above would have been visible on it
before it reached the site.
