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

`/insights/[slug]` is the sharper case, because the export was removed *on
purpose* and the reasoning was written down:

> Without it, posts render on demand once and are then cached for `revalidate`
> — same end state for a crawler, no build-time stampede.

The first clause is false. Without it, posts do not get cached at all. The
author's actual concern — that prerendering hundreds of posts at build would
storm FMP on a cold cache — was **correct**, and an empty
`generateStaticParams` addresses it completely: nothing is prerendered at build,
and on-demand ISR works. The conclusion was wrong, not the worry.

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
