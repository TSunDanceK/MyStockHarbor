# news-art

Generated illustration library for news cards. Rules, conversion settings and
storage limits: `claude/image-policy-2026-09-13.md`. Selection and the cascade:
§6 of `claude/news-adapter-spec-2026-09-13.md`.

**No counts are recorded in this file, on purpose.** `manifest.json` is the only
source of truth for how many images a bucket holds, and a second copy of those
numbers anywhere is a copy that goes stale. What is here is the naming
convention, which does not change.

## Naming — ONE-INDEXED

    <bucket>-<nn>.webp       1200x675   lead cards
    <bucket>-<nn>-sm.webp     320x180   compact rows

`<nn>` starts at **01**, not 00. A bucket of four is `-01` through `-04`.

This is worth stating plainly because the spec's `pick()` formula is written
0-based (`hash % count`) and was implemented that way: when the full library
landed it asked for 52 files that do not exist and left 52 that do unreachable.
`lib/server/news/art.ts` now adds the 1 at filename construction only, keeping the
index 0-based through the collision walk. The committed files were not renamed.

## Adding art

1. Put both sizes in this folder, continuing the bucket's numbering.
2. Raise that bucket's count in `manifest.json`.

In that order. The manifest is what the lookup reads, so a count raised before
its files exist is a broken image on a live page — the one failure mode nothing
else would catch, since the page renders regardless and only a visitor sees it.

Run `node scripts/check-news-art.mjs` afterwards: it fails if any count lacks its
files, and notes any files present that no count reaches yet.

A bucket absent from `manifest.json` resolves to no art and the card falls back
to the generated data card, so the library can grow a bucket at a time.

The `event-*` buckets are not selected yet — `eventType` comes from the adapters,
which is step 6. Step 0 selects `sector-*` only.
