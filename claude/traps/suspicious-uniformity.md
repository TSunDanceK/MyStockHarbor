# Suspicious uniformity IS the error signal

The sharpest instance of `absence-needs-the-producer-to-have-run` so far, and
the one that would have shipped.

A per-file `lastmod` for the sitemap, derived from `git log -1 --format=%cI --
<path>`, returned a **well-formed, plausible, recent ISO timestamp for 100% of
inputs**. Nothing threw. Nothing was empty. Every spot-check looked right.

It was wrong for about **85%** of them. Vercel clones shallow, so every file
older than the clone horizon reports the horizon commit's date (see
`claude/stacked-branches-squash-merge-2026-08-20.md`).

**The only tell was that three unrelated files shared a timestamp to the
second.** `/how-to-read-stock-charts`, `/margin-trading-explained` and
`lib/curatedSymbols.ts` are not edited together and had not been edited
recently. Nothing about any single value looked wrong; the values were only
wrong *in relation to each other*.

> **When a derived value comes back suspiciously uniform across inputs that
> should differ, the uniformity IS the error signal.** Do not check whether
> each value is plausible — check whether the SPREAD is plausible.

This generalises past git. The same shape had already shipped in the very
sitemap being fixed: `lastModified: now` gave 557 URLs one identical timestamp,
and that was visible for months as a perfectly reasonable-looking date on every
entry. Counting distinct values is what exposed both:

```
before   720 of 720 URLs carried a lastmod; 557 shared ONE date
after    163 of 720 carry one, across 20 and 31 distinct dates
```

The cheap check is a histogram. For any derived field, count distinct values per
family before believing it: `n` inputs collapsing to one output is either a
genuine constant or a bug, and it is worth knowing which.
