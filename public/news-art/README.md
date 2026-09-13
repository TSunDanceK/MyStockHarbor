# news-art

Generated illustration library for news cards. See §6 of
`claude/news-adapter-spec-2026-09-13.md` and `claude/image-policy-2026-09-13.md`.

## Status: the code is wired, the images are not here yet

`manifest.json` is **empty**, and that is deliberate rather than a mistake. The
cascade treats a bucket absent from the manifest as "no art", so every card
currently renders the generated data card. Nothing 404s.

**Do not add counts to `manifest.json` before the matching `.webp` files are in
this folder.** The manifest is the only thing the lookup reads — a count without
a file is a broken image on a live page, which is worse than no art at all.
`scripts/check-news-art.mjs` fails if the two disagree, so run it after dropping
files in.

## Adding art

Two pre-generated sizes per image, centre-cropped to the exact aspect:

    <bucket>-<nn>.webp       1200x675   lead cards
    <bucket>-<nn>-sm.webp     320x180   compact rows (unused today, see §6)

`<nn>` is zero-padded from `00`. Then raise that bucket's count in
`manifest.json` to the number of images present.

Rules from the image policy, in short: never commit the source JPGs; add, never
replace (git keeps every version of a binary forever); plain `<img srcset>`,
never `next/image`; always set `width` and `height`.

## Target counts

From `claude/image-policy-2026-09-13.md`, measured on the real set 2026-09-13 —
89 images across 20 buckets. Paste into `manifest.json` as the files land:

```json
{
  "event-analyst": 4, "event-deals": 4, "event-earnings": 5,
  "event-filings": 4, "event-macro": 4,
  "sector-auto": 4, "sector-banks": 6, "sector-biotech": 6,
  "sector-crypto": 4, "sector-ecommerce": 4, "sector-energy": 4,
  "sector-gaming": 4, "sector-industrials": 4, "sector-media": 4,
  "sector-medtech": 4, "sector-retail": 4, "sector-semiconductors": 6,
  "sector-software": 6, "sector-telecom": 4, "sector-travel": 4
}
```

The `event-*` buckets are selected only once `eventType` exists — that is step 6.
Step 0 uses the `sector-*` buckets only.

Five sector buckets are empty by design and are absent from the list above:
staples, realestate, materials, aerospace, insurance. They fall back to the
generated data card until they are generated.
