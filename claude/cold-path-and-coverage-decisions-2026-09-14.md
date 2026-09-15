# Cold path and coverage — owner decisions, 2026-09-14

> **Provenance.** The authoritative document is the Claude Project copy of the
> same name. This repo mirror was **written from the owner's summary of those
> decisions, not copied from the original**, which is Project-only and not
> visible from a coding session. It is a faithful record of what was decided and
> why, but it is not a verbatim reproduction: where the two differ, **the Project
> copy wins**, and this file should be re-synced from it.
>
> Mirrored per `CLAUDE.md`'s "Where the automation docs live" — docs live in the
> Project so they are editable from any device, and are mirrored under `claude/`
> so they are readable from GitHub without opening Claude.

**Status:** DECIDED, NOT SCHEDULED. All of this is **step 8**, and step 8 sits
behind step 3, the backfill/population path, the verify sweep and the ticker
gate. Recorded now because the decisions were taken now, not because the work is
next.

## The decisions

### 1. A fixed-size, view-ranked bundle — not a bare time cut-off

Off-universe symbols are retained as a **bounded bundle ranked by views**,
rather than "everything fetched in the last N days". A pure time cut-off has no
ceiling: a burst of distinct cold requests is unbounded and
attacker-influenceable, which is the same priority-inversion argument that gave
`SEC_COLD_FETCH_DRAIN_PER_RUN` its own separate allowance in step 2.

**Starting small, deliberately.** There is no traffic to size it against yet.
Picking a large number now would be a guess dressed as a capacity decision; the
bundle grows when there are real numbers to grow it against.

### 2. Cap **and** 14-day cut-off, not either alone

Both conditions, not one:

- the **cap** bounds worst-case storage and keeps an unbounded source bounded;
- the **14-day cut-off** stops the bundle filling with symbols nobody has looked
  at since, which a cap alone would allow (a full bundle of stale entries is
  still full).

This matches the dynamic universe's own shape, which prunes by age *and* by
rank — `ZREMRANGEBYSCORE` on `seen`, `ZREMRANGEBYRANK` on `score`.

### 3. Five conditions on the eviction rule, including the spike guard

The eviction rule carries five conditions. Among them is a **spike guard** —
which `lib/server/secManifest.ts` already argues for in its own comments, in
`mapChangeThreshold`: a change large enough to look like the *source* changed
shape is refused rather than applied, because the destructive interpretation of
a bad input is indistinguishable from a correct one at the moment of writing.
The cold bundle's eviction inherits that reasoning: a mass eviction is refused,
not executed.

## Left OPEN: first-visit behaviour

Three candidates, none chosen:

| | |
|---|---|
| **Queue on the cron** | Simplest, no request-path work. First visitor gets nothing. |
| **Queue on a short drain** | Middle ground; still not synchronous. |
| **Synchronous fetch** | First visitor gets data. Puts an external call on the request path. |

**The measured argument for the synchronous path:** SEC is fast enough from
Vercel — **~90 ms for JPM's 4.6 MB `submissions` payload from iad1**. That is a
measurement, not an estimate, and it makes the sync path viable where a slower
source would rule it out on its own.

It is still open because latency is not the only consideration: a request-path
fetch is a request-path dependency, with the failure modes that implies, and
per-IP capping of cold *enqueues* (not requests — a request cap 403'd a real
user on `/insights/videos`, see `firewall-asn-audit`) is already step 8's.

## Where this sits

Behind, in order: step 3 · the standing population path
(`claude/sec-cold-start-coverage-2026-09-14.md`) · the verify sweep · the ticker
gate. Then this.
