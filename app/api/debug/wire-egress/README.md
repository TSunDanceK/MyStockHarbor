# /api/debug/wire-egress

One-off probe. Answers whether `globenewswire.com` is **blocked from Vercel** or
merely slow — the question that decides §A vs §B of
`claude/news-flip-done-2026-09-14.md`, and which nothing else in this repo can
answer.

## Why it has to run here

The agent sandbox is refused `globenewswire.com`. A GitHub runner reaches it
fine — `scripts/news-timing-probe.mjs` measured 12–330 ms — and that is exactly
what makes the question live: **the host is up**, so the failure is specific to
Vercel's egress. Only a Vercel function can tell the cases apart.

## Reading the result

Each target gets a `verdict`:

| verdict | reading | points to |
|---|---|---|
| `answers` / `intermittent` | transient | **§A** — a per-feed timeout is enough |
| `refused` | IP-level block (fast failure, `cause` names it) | **§B** — structural |
| `silent-drop` | aborted at 20 s with zero bytes | **§B** — structural |

**Read the control first.** `gnews-control` is Google News, known-good in
production logs. If the control did not answer either, this function had no
egress at all and the subject verdicts prove nothing. Without it, "GlobeNewswire
timed out" would be equally consistent with "the network was down", and the
probe would be evidence for a conclusion it cannot support.

## Why 20 s, not 5 s

Production's `ADAPTER_TIMEOUT_MS` is 5 s. At 5 s a hang and a slow answer look
identical, and telling them apart is the entire point. A host answering at 8 s is
transient; one still silent at 20 s is not.

## Usage

    /api/debug/wire-egress?key=$EARNINGS_BACKFILL_KEY

Three rounds × three hosts, sequential — parallel runs share DNS and socket
setup, and one host's stall can mask another's. Takes up to ~3 minutes in the
worst case (all hosts hanging); seconds when they answer.

The `[wire-egress]` lines also go to the runtime log, so the result is readable
from Vercel's log viewer without the response body.

## Delete it

A probe, not a feature. Same fate as the `news-sources` probe and the
`static-profile` capture route: once the verdict is recorded in
`claude/news-flip-done-2026-09-14.md`, this route goes.
