# GlobeNewswire is not blocked. The hang is ours.

2026-09-14. Supersedes the "contributes nothing, and cannot" half of
`claude/news-flip-done-2026-09-14.md` §4, which is now banner-corrected in place.

---

## 1. The question, and why only Vercel could answer it

Stock-page renders showed a 5,002ms leg attributable to GlobeNewswire — 5,002
being the `ADAPTER_TIMEOUT_MS` abort, not a measured duration. The per-feed
`endPoll()` sits in a `finally`, so the *absence* of its log line could only mean
one thing: the fetch never settled.

Two explanations fit that equally well, and they lead to opposite decisions:

| If it is… | Then the wire leg on stock pages is… |
|---|---|
| Vercel's egress being refused or silently dropped by the host | dead until something outside our control changes |
| something about *our* request | recoverable, and per-symbol wire attribution comes back |

Neither the agent sandbox nor a GitHub runner can distinguish them — the sandbox
is refused `globenewswire.com` outright, and a runner reaches it in 12–330ms,
which is exactly what makes the Vercel-specific question live. The probe had to
run where the problem is.

## 2. Round one: it answers

`/api/debug/wire-egress`, three rounds, 20s timeout, from a Vercel function:

| host | verdict | ms per round | statuses |
|---|---|---|---|
| globenewswire | `answers` | 157 / 38 / 28 | 200, 200, 200 |
| gnews-control | `answers` | — | 200 ×3 |

**GlobeNewswire is not blocked from Vercel.** Not refused, not silently dropped,
not slow. 28ms on a warm socket. The 5,002ms hang is ours.

`§B` of the brief (stop polling it per-symbol because the host is unreachable)
does not apply. `§A` is not the fix either. Per-symbol wire attribution is
**recoverable**.

## 3. What round one could not say

The probe's fetch differed from the render's fetch in **two** ways at once:

|  | probe (round one) | the render (`wireProvider.ts:214`) |
|---|---|---|
| cache mode | `cache: "no-store"` | `next: { revalidate: 3600 }` |
| User-Agent | explicit MSH string | none (Node's default) |

Two variables changed, one result. That is unattributable, and treating it as
attributable is exactly the error §4 of the other doc already had to be
corrected for. Hence a 2×2.

## 4. The 2×2, and the decision rule fixed in advance

|  | no User-Agent | explicit User-Agent |
|---|---|---|
| `no-store` | **A** | **B** — round one's configuration, answered |
| `revalidate: 3600` | **C** — THE RENDER, decisive | **D** — cross-check |

C is the render's fetch byte for byte, executed somewhere it can be timed.

| outcome | conclusion |
|---|---|
| C answers | the fetch config is not the cause; look above the fetch |
| C hangs + A answers | the Data Cache path (`next: { revalidate }`) |
| C hangs + A hangs (B answered) | the missing User-Agent |
| control silent | no egress in that invocation; the run is void |

D corroborates and never decides; a disagreement is reported rather than
averaged away.

### Two things the route does that are not incidental

**Cell order is load-bearing.** C and D both use `revalidate`, so both read and
write Next's Data Cache. On the same URL they share a key and D could be served
C's cached body — a cache hit reported as a network measurement. So C runs
**first**, on the bare URL, cold; A and B (which neither read nor write the Data
Cache) run next and cannot contaminate anything; D runs last on a
query-param-suffixed URL for its own key. That param is a **known deviation from
the render's URL**, recorded rather than hidden — acceptable on the
corroborating cell, and not acceptable on C, which is why C got the bare URL.

**Round 1 is the measurement; round 2 is not a second sample.** For the
`revalidate` cells round 2 is *expected* to be a hit (Data Cache or in-invocation
memoisation) and to come back near-zero. A fast round 2 on C is not evidence of
health. The verdict function reads round 1 only — otherwise "C was cached the
second time" becomes evidence that C is fine.

Kept from round one because both earned their place: the control host, and the
AbortController with `cause` capture (a bare `Promise.race` reports "slow" for
every failure mode and would make all three cases look identical).

## 5. Leading hypothesis — a hypothesis, not a plan

The missing User-Agent. Node's default UA on a wire RSS endpoint is a plausible
thing for a CDN to tarpit rather than refuse, and a tarpit is precisely what a
never-settling fetch looks like. The probe tests the `SEC_USER_AGENT` string
already in the tree rather than a probe-only invention, so that if the UA is the
cause, what shipped is what was measured.

**Not implemented.** The 2×2 runs first and its result gets reported before any
fix is written.

If it is the UA: one header on the wire fetches, reusing the `SEC_USER_AGENT`
convention rather than inventing a second mechanism. The per-feed timeout stays
afterwards as a **backstop — insurance, not the fix, and not a performance
change**.

`§C` (the cache-health panel line) is on hold until this lands. `§D` (cik-map
miss rate) is separate and unstarted.

## 6. How to run it

    /api/debug/wire-egress?key=...

on **Preview** (where `MSH_TIMING=1` is already set). Worst case 200s against a
300s `maxDuration`. Read `decision.cause` and `corroboration`; if
`decision.cause` is `void`, the control did not answer and the run says nothing.

Delete the route once the verdict is recorded here. It is a probe, not a feature.

---

## Appendix — C1, corrected today, independent of the above

"Rollback is an env var, not a revert" was being stated as **"no deploy"** in
four places. That is wrong: `newsProviderMode()` reads `process.env`, and an env
var changed in the Vercel dashboard does not reach the running deployment until a
**production redeploy** (~2 min, same commit).

The honest claim is: **one env var plus one redeploy; no revert commit, no code
change.**

Corrected in `app/cache-health/page.tsx` (the one that was wrong on a live page),
`lib/server/news/index.ts`, `claude/news-adapter-spec-2026-09-13.md` §7, and
`scripts/check-provider-flip.mjs`. It is wrong in the worst possible place —
the sentence someone reads while deciding whether the rollback is fast enough to
reach for.
