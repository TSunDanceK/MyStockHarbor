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

## The v2 library — a SECOND manifest, a different shape

`manifest-v2.json` is not a count map and is not read by `art.ts`. It maps a
WHOLE FILENAME STEM to the tags that one image carries:

    "chips-any-01": { "primary": ["chips"], "related": ["ai-compute"],
                      "motif": ["any"], "tone": "flat", "palette": "..." }

Two manifests, two consumers, no shared type. `lib/server/news/art.ts` reads
`manifest.json` as `Record<string, number>` for `sector-*`/`event-*`;
`lib/server/news/artTags.ts` reads `manifest-v2.json` for everything else.
Putting the v2 shape at the v1 path would break the three symbol-led surfaces
at build time or, worse, silently, so `scripts/check-news-art.mjs` asserts
`manifest.json` still holds numbers.

**There is no index arithmetic in v2.** The key IS the stem, `-01` included, so
the 0-vs-1 trap above cannot recur. Names are `<subject>-any-NN` and
`any-<motif>-NN`, and nothing collides with `sector-*` / `event-*`.

### Adding v2 art

1. Put both sizes in this folder.
2. Add each name to `manifest-v2.json` with its tags.

In that order, for the same reason as v1: a name with no file behind it is a
broken image on a live page. The check is stricter here than for v1 in one
direction — a `.webp` that no manifest entry names is a FAILURE, not a note,
because v2 has no counts to gate it and such a file is simply unreachable
forever.

`manifest-v2.json` is empty today, which is a working state: every tagged
lookup returns null and `/headlines` falls through to the event art it already
had. claude/news-art-v2-headlines-2026-09-21.md has the whole design.

The `event-*` buckets are not selected yet — `eventType` comes from the adapters,
which is step 6. Step 0 selects `sector-*` only.
