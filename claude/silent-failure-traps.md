# Silent-failure traps

Instruments and interfaces that answer a question you did not ask, in a format
that looks like they answered the one you did. Each was hit live; none is
hypothetical. The git-shaped ones live in
`claude/stacked-branches-squash-merge-2026-08-20.md` — this file is the index
and the non-git ones.

The shared shape: **a check that cannot run rarely reports that it could not
run.** It returns something that reads like an answer.

---

## 1. A return type that cannot express failure

**Found in production 2026-08-20.** `/upcoming-ipos` rendered "No confirmed
IPOs are currently scheduled in the next 30 days" *and* "No confirmed IPOs
listed in the last 30 days" on first load. An immediate reload showed 2 upcoming
and 12+ recent. The page had asserted, to the user and to Google, that the US
IPO market was empty — because a fetch failed on a cold lambda.

### The mechanism

`lib/server/ipoCalendar.ts` exported `Promise<ConfirmedIpo[]>`. Four distinct
outcomes collapsed into that one type:

| Outcome | Returned |
|---|---|
| Cache hit | `cached.items` |
| No `FMP_API_KEY` | `[]` |
| Fetch threw / non-ok status | `[]` |
| Genuinely empty market | `[]` |

**The signature made the distinction unrecoverable.** By the time the page
received the value, "FMP returned 429", "no API key" and "no IPOs this month"
were the same object. No care at the call site could fix that — the information
was destroyed one frame earlier.

The `catch` was bare — `catch {`, no binding, no `console.error`, no timing
hook. So the failure was not merely invisible to the page: **it was invisible in
the Vercel logs.** Nothing anywhere recorded that the read failed. It was found
by eye, which is the only way it could have been found.

The code comment stated the intent — *"fall back to empty only on a cold
start"* — and correctly described the bug as the accepted trade. The
stale-serve fallback protected a warm instance and did nothing on a cold one,
which is the case that renders.

### Why both panels failed together

`page.tsx` ran `Promise.all([getUpcomingConfirmedIpos(), getRecentIpos()])` —
two concurrent FMP calls from one cold instance, separate cache keys, no
in-flight dedup. A burst rate-limit takes both.

### Why "cold" was not rare

The cache was `const caches: Record<string, {at, items}> = {}` — module-level
state, scoped to one lambda instance, dying with it. Across `lib/server/`:

```
historyCache.ts      redis_refs=51    ← Redis-backed AND cron-warmed
pickersBuilder.ts    redis_refs=39
...
ipoCalendar.ts       redis_refs=0     ← in-memory only
indexChanges.ts      redis_refs=0     ← same
```

So the answer to "is it cron-warmed or populated by a read miss" was *neither
of the available options*: populated only by a read miss, into memory that does
not survive the instance. A cron pointed at it would have warmed exactly one
instance. Every scale-out, deploy and idle-recycle produced a cold start whose
first visitor paid, with `no-store` and no retry.

### The fix, in dependency order

Order matters — any one alone still leaves the page lying:

1. **Return type first.** `Feed<T> = { items, ok, source }` in
   `lib/server/feedCache.ts`. `ok: false` means only "the read failed and there
   was no cached copy", so `items` is `[]` and means nothing. Everything else
   is reachable only once the type can say *I don't know*.
2. **Then logging.** Unconditional `console.error` / `console.warn`. **Not**
   `lib/server/timing.ts` — those helpers are gated on `MSH_TIMING === "1"`,
   which is not set in production, so routing the fix through them would leave
   the failure exactly as invisible as it was. *The instrument built to make
   things visible is itself off by default.*
3. **Then Redis.** Two-layer memory → Redis → upstream, with a 24h stale TTL
   well beyond the 30m freshness window. This is what makes stale-on-error
   actually reachable instead of theoretical: the warm copy now survives
   instance recycling.

`fetchItems` **throws** on any failure and returns `[]` only for a real empty.
Throwing is how it says "could not answer"; `[]` says "upstream says none". The
old code used one value for both.

### Two corollaries worth keeping

**Structured data is the sharpest harm.** The page emitted JSON-LD
`itemListElement: ipos.map(...)`. On a failed read Google received a
`CollectionPage` whose `ItemList` had **zero items**, on a `priority: 0.75`,
`changeFrequency: "daily"` sitemap entry whose whole ranking case is that list.
A machine-readable assertion of emptiness is stronger than the prose. **Emit no
`ItemList` at all rather than an empty one** — asserting nothing beats asserting
zero. Drop the `mainEntity` reference with it so it never dangles.

**A window that is never legitimately empty is a free monitor.** "IPOs that
listed in the *last* 30 days" is essentially never truthfully zero. So a
successful-but-empty result there is near-proof of an upstream problem that did
not throw — a parser drifting off FMP's field names, a silently changed schema.
`warnIfImplausiblyEmpty()` logs it even when `ok` is true. Look for these: an
assertion that is almost never legitimately true costs one log line and catches
failures no error path will.

### Do not put these pages on ISR yet

`/upcoming-ipos` and `/recently-added-to-index` are `ƒ`. Under `force-dynamic`
the empty render is per-request and self-heals on reload — which is why this was
survivable. **Under ISR the same cold-instance failure gets baked into the
prerendered artefact and served to every visitor and crawler for the full
revalidate window**, with no reload path out. At `revalidate: 300` that is five
minutes of a page asserting its own subject does not exist.

`claude/picker-pages-isr-2026-08-20.md` already names this, from `/plays` in
#279: *"a cold cache at deploy bakes a shell for one revalidate window — which
is now logged (`cacheOnly miss`) rather than silent, because an invisible
degradation is how three of these rounds went wrong."* `/plays` earned its
migration by making the degradation loud **first**. That ordering is the rule:
distinguish → log → then consider ISR.

---

## 2. Inference about a source you cannot open

Full writeup in `claude/BOTTLENECKS.md`. In short: assessing PR #246 required
reasoning about the Claude Project copy of `BOTTLENECKS.md`, which a repo
session cannot open. Every other claim was verified against current `main`; for
the one unreachable document, a PR body was trusted instead — and it was stale
on the day it was written. The inference was merged as fact and was wrong twice
over.

- **The unreachable source is where inference is least safe and most tempting.**
  Nothing pushes back there, so the guess gets written down more firmly than the
  things actually checked. Say "not verified — could not read X", never a
  conclusion about X.
- **A mirror can run *ahead* of its source, not just behind.** The Project copy
  described a backfill as done before it was, so the repo was the stale copy.

---

## 3. Git instruments — see the stacked-branches doc

- `git diff main...branch` reports what the branch did relative to its **merge
  base**, not what merging would still add. After an equivalent squash-merge it
  reported 447 insertions for a branch byte-identical to `main`.
- On a **shallow clone**, `git merge-tree --write-tree` exits 0 and reports no
  conflicts when there is no merge base, while `git diff A...B` fails loudly.
  Two PRs read as conflict-free; one conflicted in four files once unshallowed.

---

## 4. `next build` cannot be validated locally in this repo

Without `UPSTASH_REDIS_REST_URL` / `_TOKEN`, `npx next build` **fails** — the
ISR'd screener pages exceed Next's 60s per-page static-generation budget against
a cold cache and the export aborts. Verified 2026-08-20 that unmodified `main`
(`76014d03`) fails identically to a working tree with changes: same pages, same
timeout, exit 1.

So a local build failure here is **not** evidence your change broke something,
and a local build is not available as a check. Use the Vercel preview, which has
credentials. This is the practical face of Rule 1 in
`claude/picker-pages-isr-2026-08-20.md`: *a build without Redis credentials
proves nothing.*

**Also corrected 2026-08-20:** the root `CLAUDE.md` lesson listing the npm
registry as blocked from Claude's sandbox is **out of date** — `npm ping` and
`npm ci` both succeed through the agent proxy. Re-test reachability rather than
trusting that list; it is exactly the kind of stale note this file exists to
catch.
