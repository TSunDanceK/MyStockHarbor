# A route-level `revalidate` on a dynamic segment is inert without `generateStaticParams`

A config value that reads as active, is syntactically correct, is what the
author intended, and does nothing at all. Nothing warns.

`export const revalidate = N` on a `[param]` segment has **no effect** unless
the route also exports `generateStaticParams`. Without it the segment stays
fully dynamic — every request a full render — no matter how many dynamic APIs
and `no-store` fetches have already been removed. Removing the blockers is
necessary and not sufficient (Rule 4 in
`claude/picker-pages-isr-2026-08-20.md`, measured on `/stock/[symbol]` in #280).

## How it hid

`/insights/[slug]` and `/insights/videos/[videoId]` both declared a considered
`revalidate` — 86400 and 1800 — when they were converted off `force-dynamic`.
**Neither has ever had any effect.** Both routes have been rendering every crawl
in full for as long as the setting has existed.

*(Confirmed from build output 2026-08-31: #381's preview route table showed both
as `ƒ`. Until then this was inferred from source, which is precisely what the
rule at the foot of this file says not to settle for.)*

`/insights/[slug]` is the sharper case, because the export was removed *on
purpose* and the reasoning was written down:

> Without it, posts render on demand once and are then cached for `revalidate`
> — same end state for a crawler, no build-time stampede.

The first clause is false. Without it, posts do not get cached at all. The
author's actual concern — that prerendering hundreds of posts at build would
storm FMP on a cold cache — was **correct**, and an empty
`generateStaticParams` addresses *that* concern completely: nothing is
prerendered at build, and on-demand ISR works. The conclusion was wrong, not the
worry.

### Correction, 2026-08-31 — "addresses it completely" was itself wrong

**Read this before acting on the paragraph above.** It says an empty
`generateStaticParams` is the fix for `/insights/[slug]`. That change was made,
in #310, and it caused a **3.5-hour production outage**: every request to a real
slug returned 500. It was reverted in #323, and the export is deliberately absent
today — which is why that route is still `ƒ`, and why finding it `ƒ` is not
evidence that the fix "never took".

What the paragraph missed is that making a route static is only half a question.
An empty `generateStaticParams` correctly answers *"will this storm FMP at
build?"* — no. It says nothing about *"does this route survive being static?"*
`getOrCreateInsightSnapshot` reached Redis through a bare `Redis.fromEnv()`, and
`@upstash/redis` defaults every REST call to `cache: "no-store"`. A no-store
fetch on a prerendered route throws `DYNAMIC_SERVER_USAGE` at request time — a
500, not a fallback to dynamic.

So the trap has a second half, and it bites in the opposite direction from the
first: **the route table showing `●` proves a route BECAME static; it proves
nothing about whether the route SURVIVES being static.** `scripts/check-static-safety.mjs`
exists for exactly that question and should be run before adding the export, not
after the symbol changes.

The preconditions are recorded at the top of `app/insights/[slug]/page.tsx`.
Status as of 2026-08-31:

- **Precondition 1 — no bare Redis clients on the transitive read path: NOW MET.**
  `lib/insightSnapshots.ts` passes `PAGE_READ_CACHE`, and `check-static-safety.mjs`
  reports no bare clients for this route.
- **Precondition 2 — a real slug returning 200 from a preview: still outstanding**,
  and blocked by something the original preconditions did not name:
  `lib/server/quoteData.ts:154` issues a literal `cache: "no-store"` fetch during
  render on a Redis cache miss. Its own comment calls it "THE REMAINING BLOCKER".
  No Redis client option fixes that; it needs wrapping in `unstable_cache`.

The same single blocker sits on `/insights/videos/[videoId]` (via
`getVideoStockData`), so one fix to `quoteData.ts` unblocks both routes.

## Why nothing catches it

- `tsc` is happy: the export is valid and correctly typed.
- `eslint` is happy: nothing is unused or unreachable.
- the build is green.
- the page renders correctly, and fast, for a human.

The only symptom is an `ƒ` where you expected `○` or `●` in the route table —
the artefact this project has repeatedly found to be the least-read and
most-informative one. And on a route that was *already* `ƒ` before the change,
there is no transition to notice: it looks exactly the same after the fix as
before it.

## The rule

**A config value is not in force because it is present.** For any route-level
`revalidate` on a dynamic segment, check the route table for `○`/`●`, not the
source. Same family as `claude/traps/fetch-revalidate-caps-the-page.md`: there a
fetch silently *overrode* the page constant, here the segment silently *ignores*
it. In both cases the source says one thing, the framework does another, and
only the build output arbitrates.
