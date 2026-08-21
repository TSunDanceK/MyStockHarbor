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

**And the check you cannot run at all:** `*.vercel.app` preview hosts and
`www.mystockharbor.com` both return `403 CONNECT tunnel failed` from the
sandbox proxy. A Claude session **cannot fetch its own preview or the live
site**, so "confirm the deployed page renders rows" is owner-side. Worth
stating plainly on a page whose whole bug was that it compiled fine and
rendered a falsehood: a green build is not a rendered page.

**Also corrected 2026-08-20:** the root `CLAUDE.md` allowlist lesson was *half*
wrong, which is worse than wholly wrong — the npm registry is now reachable
(`npm ping` and `npm ci` both succeed through the agent proxy, which is what
makes local `tsc`/`eslint` possible), while the preview and production hosts
are not. It was split into its three separate facts rather than deleted, since
deleting it would have created the opposite wrong belief. Re-test reachability
rather than trusting any such list; it is exactly the kind of stale note this
file exists to catch.

---

## 5. Two validators for one value

Duplicating a validation function is not a duplication problem, it is a
**correctness** problem, and it fails in the quietest way available: the two
copies agree on every input anyone thinks to try, and disagree only on the
inputs nobody tests.

### The instance

`/dashboard` resolves its symbol on both sides of the wire. The server uses
`cleanSymbolParam()` in `app/dashboard/page.tsx`; the client got
`cleanClientSymbol()` in `app/components/DashboardClient.tsx` (#296), so the
URL could win over the remembered symbol before hydration instead of after.

Those two functions **must** agree on every input. Where they disagree, the
server renders one symbol and the client immediately renders another — which
is precisely the deep-link flash #296 exists to remove, reappearing for a
narrow set of inputs and therefore much harder to notice than the original.

The first draft of the client copy diverged on exactly that axis:

| input | server (`cleanSymbolParam`) | first-draft client | result |
|---|---|---|---|
| `NVDA` | `NVDA` | `NVDA` | agree |
| `nvda` | `NVDA` | `NVDA` | agree |
| `NVDA!` | `NVDA` (**strips**) | `""` (**rejects**) | **flash returns** |

The server *strips* disallowed characters; the draft client *rejected* the
whole string. Every ordinary ticker agreed. Only punctuation exposed it. It
was caught before pushing by diffing the two implementations across 15
deliberately awkward inputs rather than by reading them.

### Why a comment is not a fix

Both functions carry a comment saying an edit to one must be made to the
other. That is a **warning, not a guarantee** — it works only for as long as
whoever edits one happens to read it, which is exactly the assumption that
fails during a hurried change six months later.

The real fix is the same shape as `feedCache`: **export one function and
import it on both sides**, so divergence becomes impossible rather than
discouraged. Make the wrong thing unrepresentable instead of documented.

### The general rule

**Any value validated on both the server and the client must be validated by
one shared function.** If a value crosses the wire and both sides normalise
it, that normalisation is a single piece of logic with two call sites, never
two pieces of logic that are meant to match.

Symptoms, when it goes wrong: content that flashes and corrects itself, a
hydration mismatch on some inputs but not others, or a value that "works
everywhere except one weird ticker". None of them point at the validator,
which is what makes this expensive to debug.

---

## 6. Measuring the visible artefact instead of the one carrying the answer

The instrument works, the number is real, and it is a number about something
adjacent to the question. Three instances, same shape:

| Read | What it actually reported | The answer was in |
|---|---|---|
| `1253` bars from `/api/history` | `dailyCount` in a debug **log line** | the response, capped at the requested 900 |
| a green `next build` route table | that the build **completed** | the per-route `○`/`ƒ` column, and then the emitted HTML |
| the ticker shown in the **DOM** | what the client had swapped to | the flight payload's `defaultSymbol` — what the SERVER sent |

The third nearly shipped a broken #300. The migration test asserted on the
rendered ticker, and the client hydrates to the remembered symbol *whether or
not the server got it right* — so a completely failed migration renders `CAG`
and passes. The seed had to be read out of the flight payload
(`defaultSymbol\":\"…\"`) precisely because that is the value the client has not
touched yet.

**Before trusting a measurement, name which layer produced the number.** A log
line is not a payload. A build completing is not a route being static. The DOM
is not the server's output. When a client can overwrite the thing being
measured, measure upstream of the client.

---

## 7. Test the SECOND visit, not the first

Two changes in one day would have shipped looking like fixes while doing
nothing for the case they were built for. Both passed every first-visit test.

- **#294** — the "Resume" chip appeared exactly once and never again. Visit 1
  overwrote the remembered symbol with what merely rendered, so visit 2 had
  nothing to resume.
- **#300** — the cookie was never written for anyone who already had a
  remembered symbol, so every existing user got a server-rendered `SPY` and a
  client-rendered `CAG`, **forever**, and the PR looked like it removed a
  discard it had left entirely in place.

Neither is visible in one load. Both are obvious in two.

**The rule:** any change touching persisted state — localStorage, a cookie, a
cache, a remembered preference — is not tested until a SECOND read has
happened, and where the state is per-origin or per-session, in a genuinely
fresh context.

A corollary that cost real time on #300: **a preview deployment is a different
hostname, so `localStorage` there is empty.** Testing a migration path on a
preview makes you a brand-new visitor by construction — the one case the
migration does not cover. That test cannot fail, which is not the same as
passing.

---

## 8. Playwright in this sandbox — two things that cost an hour

Both are environment facts, not bugs, and neither is guessable.

**`networkidle` never fires on `/dashboard`.** The client polls continuously,
so the network is never idle and `page.goto(..., { waitUntil: "networkidle" })`
times out at whatever limit it is given. Use `domcontentloaded` plus an
explicit `waitForTimeout` settle instead. Anything that mounts `DashboardClient`
has this property.

**The preinstalled Chromium is build 1194; a fresh `npm i playwright` expects
1234.** It fails with "Executable doesn't exist … chromium_headless_shell-1234"
and helpfully suggests `npx playwright install`, which the environment notes
say not to run. Pass the existing binary instead:

```js
chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
```

Install `playwright` into a scratch directory rather than the repo, so
`package.json` and the lockfile stay untouched.
---

## 9. A visible failure is not a harmless one — and how to refuse to cache it

`feedCache` (trap 1) made a failed upstream read distinguishable from a
genuinely empty one. That fixed the *diagnosis* and not the *blast radius*.

**Under ISR, a failed read is baked into the prerendered artefact** and served
to every visitor and every crawler for the whole revalidate window, with no
reload path out. "We couldn't load the IPO calendar" stops being a blip a
refresh fixes and becomes *the page*, for everyone, until the window expires.
`/upcoming-ipos` and `/recently-added-to-index` were held back from ISR for
exactly this reason: their `f` status is what makes the failure self-heal.

### The technique

`await connection()` on the degraded path, via
`lib/server/degradedRender.ts`. It does better than "don't persist the
failure": the visitor keeps being served the **last known-good HTML**, so a
failed *revalidation* is invisible to them rather than merely non-permanent.
With no good copy it degrades to exactly today's dynamic behaviour.

Measured against `next start` (Next 16.1.6), upstream toggled mid-run:

```
without   req1 STALE/good   req2 HIT/DEGRADED   req3 HIT/DEGRADED
with      req1 STALE/good   req2 HIT/good       req3 HIT/good
```

### The limit — this is the half that will bite someone

**Safe only on paramless static routes.** On a route with
`generateStaticParams` it returns a **500**, measured on the same probe:

```
/pbail           (paramless)             -> 200, last known-good HTML
/bailparam/[id]  (generateStaticParams)  -> 500
```

A 500 there is worse than the problem. `/stock/[symbol]` receives enumerated
junk from something crawling ~1,519 distinct paths, and sustained 5xx makes
Google throttle crawl rate **site-wide** — undoing the ISR work this enables.
Per the #281 corollary: on a dynamic segment the tool is **200 + noindex**,
never a 5xx.

So: `/upcoming-ipos` yes. `/stock/[symbol]` never.

### The cost, which is silent

If the read fails **during a build**, the route cannot be prerendered and ships
`f` for that entire deployment — not until upstream recovers, but until the
next deploy. **The build stays green.** Measured: probe built with upstream
failing, exit code 0, `f /pbail` in the route table.

That trade is acceptable (a dynamic route behaves as these pages do today; a
route with a failure baked in does not) but it is only acceptable *because
something says it happened*. The `console.warn` naming the route is the entire
early-warning system. Without it this becomes "the page quietly stopped being
cached six weeks ago" — which is trap 7's shape, and this project has paid for
it three times already.

---

## 10. An unchecked `cd` writes into whatever directory you were already in

A scratch directory built earlier in the session was gone — containers recycle
between sessions, taking `node_modules` and everything under `/home/user/*`
scratch with them. The rebuild script started with `cd /home/user/isr-bail`,
which failed. Every heredoc after it then wrote **relative paths into the repo**:

```
app/data.ts        app/pbail/page.tsx        app/pcontrol/page.tsx
```

`git add -A` committed all three into a PR about something else entirely.

The failure is general and has nothing to do with probes: **an unchecked `cd`
does not stop a script, it silently re-points every subsequent relative path at
whatever directory the shell happens to be in** — which, in this setup, is
always the repo. `set -e` does not save you here if the `cd` is not the last
command in its own statement; the run that caused this printed
`cd: No such file or directory` and carried on to `BUILD_EXIT=127`.

Two fixes, either sufficient:

```bash
cd /home/user/probe || exit 1          # refuse to continue in the wrong place
cat > /home/user/probe/app/data.ts     # or never use a relative path at all
```

**The habit that caught it is the part worth keeping:** reading the file list
in the `git push` / `git show --stat` output instead of assuming the commit
contains what was intended. The commit message, the diff summary and the PR
title all described one change; only the file list showed three extra files.

A related tail, once the strays were removed: `tsc` then failed on
`.next/types/validator.ts` still importing the deleted routes. Stale generated
types outlive the files they describe — `rm -rf .next` and rebuild before
believing a type error about a file that no longer exists.

---

## 11. A handler for "upstream is down" swallowing "you may not do that here"

`readFeed` wrapped its upstream fetch in a `try/catch` meaning *the API
failed*. Next throws `DynamicServerError` — `digest === "DYNAMIC_SERVER_USAGE"`
— to mean something completely different: **this render cannot be static.**
Same `catch`, opposite meaning.

Three FMP fetches still carried `cache: "no-store"`. On every build each one
threw during prerender, and this is what shipped:

```
[feed:ipo:upcoming] upstream read failed, serving stale copy 227m old:
    Error: Dynamic server usage: … used revalidate: 0 fetch …
    digest: 'DYNAMIC_SERVER_USAGE'
```

FMP was **fine**. Nothing was down. But by the time the error reached the
handler, Next had **already marked the render dynamic — irreversibly**, because
the mark lives on the render context, not the exception. Catching it cannot
undo it; it only hides why.

The damage compounds:

- the route ships `ƒ` with a green build and no explanation
- the log blames the upstream API for a fault that is entirely ours
- **the fresh read had never once succeeded during a build** — every build had
  silently served a stale copy, or none, and nothing said so
- under ISR it is worse than dynamic: revalidation also renders statically, so
  the feed would never refresh, serving stale until `STALE_TTL_SECONDS` (24h)
  and then degrading

**The rule: a framework control-flow signal must never be caught by a handler
written for a different failure.** `readFeed` now rethrows on
`digest === "DYNAMIC_SERVER_USAGE"` so the next call site that does this fails
the build loudly instead of shipping green and wrong. The same shape as
blocker 4 in `claude/picker-pages-isr-2026-08-20.md` — a `no-store` fetch
bailing a route while a `try/catch` keeps it quiet — at a different call site.
Blocker 4 named Redis; this one was FMP, and ruling out the first does not rule
out the second.

---

## 12. Writing these entries: describe the mechanism, do not pre-authorise a conclusion

This file exists to stop repeated mistakes, so it is worth noticing that an
entry can *cause* one.

While migrating the two feed pages, an observation went into a PR body: after
adding the degraded-render bail, a `ƒ` in a **credential-less** build no longer
proves a route is blocked — it can be the bail firing correctly. That is true.
It is also the sentence that nearly closed this investigation, because when the
preview came back `ƒ`, there was a ready-made reason to stop looking. The build
had working credentials, the bail had fired on only one of the two pages, and
the real cause was three `no-store` fetches (trap 11).

The difference is not accuracy. The note was accurate. The difference is that
it **supplied a conclusion in advance** — "if you see `ƒ`, it may be fine" —
rather than a mechanism to reason with.

So, when adding to this file:

- **Describe the mechanism**, and the observation that would distinguish it
  from its neighbours. "A `no-store` fetch throws `DYNAMIC_SERVER_USAGE`, which
  marks the render dynamic before any `catch` sees it" is a tool.
- **Do not write a rule that terminates an inquiry**, however true. "`ƒ` might
  be fine now" is not a tool; it is permission to stop.
- Where an entry could be read as an excuse, **say what must still be checked**.
  Trap 11's version: `ƒ` means read the prerender log and find out *which*
  cause — never assume the benign one.

An anomaly explained away is more expensive than an anomaly left open, because
nobody returns to it.
