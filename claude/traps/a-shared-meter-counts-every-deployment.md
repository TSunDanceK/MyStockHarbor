# A shared meter counts every deployment, not just the one you are watching

A usage counter that is global across an account measures the sum of everything
touching that account — production, every preview, every branch. Reading it as
if it described production alone turns any other deployment's behaviour into a
finding about the code you are looking at.

## What happened

Step 7 retired FMP's `news/stock` endpoint. After the flip its counter should
have been frozen. Instead it moved **+66**, which reads as exactly one thing: a
caller survived the flip and production is still spending on the endpoint the
migration existed to retire. The obvious next move is to grep for callers.

That grep would have found nothing, because there were none.

The +66 came from a different branch. `build/sec-fundamentals-2026-09-13` last
merged `main` at `a88ed3e`, based on `fd2d36d` — **#453's base commit, not the
merge**. So that branch never contained `a17c1a6`, and every preview deployed
from it ran pre-flip code where `newsProviderMode()` still defaulted to `fmp`.
Preview carries no `NEWS_PROVIDER` to override it back. Three such deployments
(07:35, 08:22, 09:08 UTC) sit inside the window. Once the work moved to a branch
based on post-flip `main`, the counter stopped.

The flip was complete the whole time. The meter was reporting a stale branch.

## What confirmed it, and what did not

**The counter freezing was the proof**, and only because it was read against
siblings: `news/stock` stayed at exactly 24,186 for an hour while six other FMP
endpoints moved in the same window — `analyst-estimates` 123,275 → 123,359,
`ratios-ttm` 175,306 → 175,386, `income-statement` 86,953 → 86,959, `quote`
914,400 → 914,403. Warm jobs still spending; news not. A single endpoint sitting
still is ambiguous (nothing ran at all?); one sitting still **while its
neighbours move** is not.

A count rising on its own establishes nothing without the deployment question
answered first.

## The rule

A counter shared across deployments answers "did anything on this account call
this endpoint", never "does this branch call this endpoint". Before reading a
rise as a finding about the code in front of you:

> **Were any deployments rendering this path in the window built from a commit
> before the change?**

- Rising, no pre-change branch in flight → **signal**.
- Rising while a pre-change branch is actively deploying → **noise**.
- Frozen while sibling endpoints move → **the flip is complete**.

`news/stock` remains a good monitor for this migration. It just has a
precondition, and the precondition is about git, not about code.

## Where else this bites

Any account-wide meter: FMP bandwidth and per-endpoint counts
(`lib/server/fmpUsage.ts`), Upstash request and bandwidth counters
(`lib/server/redisBandwidth.ts`), and anything on `/cache-health` fed by them.
Previews write into the same Redis and the same FMP account as production. A
branch that is merely OLD is enough — it does not need to be wrong.

## See also

- `claude/news-adapter-spec-2026-09-13.md` §7 — the flip, and why rollback is an
  env var rather than a revert (which is the same mechanism that lets a preview
  disagree with production about which provider is active).
