# Searching for a construct finds the comment describing its removal

A grep for a dangerous construct matches the comment that explains why the
construct is **no longer there**. The hit is real, the line number is real, and
the conclusion is backwards: it points at a fix you do not need while hiding the
one you do.

Twice in one day.

## The ISR audit

Auditing `/markets/spx` for what kept it dynamic:

```
grep -c 'cache: *"no-store"' lib/server/historyCache.ts   # => 1
```

That read as "a `no-store` fetch two files away is bailing the route" — a
plausible finding, and exactly the shape #304 had just been fixed. The file
actually contains:

```ts
// `cache: "no-store"` here used to opt every route that reached this call out
// of static rendering entirely -- the same class of bailout @upstash/redis
// caused via its own no-store default ...
const res = await fetch(url, { next: { revalidate: 300 }, ... });
```

Already fixed. The match was in the paragraph recording the fix.

**The cost of believing it would have been a wrong fix and a missed one.** The
real finding on that route is the opposite in kind: `revalidate: 300` on that
same fetch **caps** any page-level revalidate reaching it, so the page constant
has to be written as 300 or it is silently overridden
(`fetch-revalidate-caps-the-page`). One conclusion sends you to remove something
that is not there; the other changes the number you ship.

## The bundle analysis

Listing client components:

```
grep -rl '"use client"' app --include='*.tsx'
```

matched `ReturnsBarChart.tsx`, whose header reads:

```
// Presentational (no hooks, no "use client") -- the caller computes `bars` ...
```

A server component, counted as a client one, in a report about client bundle
size.

## Why this file is especially prone to it

This codebase comments *heavily*, and specifically comments on **what was
removed and why** — which is good practice and the reason several of these
traps were catchable at all. The direct consequence is that every dangerous
construct appears in prose more often than in code. The better the comments,
the worse the false-positive rate.

## The check

Grep for the construct **as code**, not as text. Anchor on the syntax that only
the live form has:

```bash
grep -nE '^[^/*]*cache: *"no-store"' file.ts    # skips // and * comment lines
```

Or confirm any hit by looking at the line, not the count. `grep -c` is the
version that cannot be checked — it returns a number with the context stripped
off, which is the one thing needed to tell code from prose.
