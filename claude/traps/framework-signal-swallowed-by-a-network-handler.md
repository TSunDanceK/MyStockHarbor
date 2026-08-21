# A handler for "upstream is down" swallowing "you may not do that here"

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
