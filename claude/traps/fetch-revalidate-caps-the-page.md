# A fetch-level `revalidate` silently overrides the page's

**Next takes the MINIMUM of a route's `revalidate` and any fetch `revalidate`
reached during its render.** A fetch-level value therefore overrides a larger
page constant, silently, with nothing in the source to say so.

`/upcoming-ipos` declared:

```ts
export const revalidate = 14400;   // four hours, deliberated and agreed
```

and shipped as:

```
○ /upcoming-ipos                                       30m      1y
```

because the FMP fetch inside it carries `next: { revalidate: 1800 }` — added in
a *different* PR, for an unrelated reason (making the fetch cacheable at all, so
it stopped throwing `DYNAMIC_SERVER_USAGE`; see
`framework-signal-swallowed-by-a-network-handler`).

Nothing failed. The build was green, the route was correctly static, and the
page worked. The only symptom was a number in the route table disagreeing with a
number in the source, and it would have been easy to skim past — the four-hour
figure had been argued for explicitly, so it read as settled.

**Two things follow.**

The route table's `Revalidate` column is the *effective* value, not the declared
one. When they disagree, the fetches win, and the fetch is often in another file
edited by another change.

And a page constant that no longer describes reality is worse than no constant:
it is documentation that lies, and it will be believed. The fix here was not to
raise the fetch to match the page — 48 revalidations a day against a feed the
upstream serves happily is not worth optimising — but to **set the page constant
to the value that is actually in force and say why**, so the two agree
deliberately rather than by accident.

> When a declared value and an observed value disagree, do not assume the
> declaration is authoritative. Find which one the framework actually uses, then
> make the source say that.
