# Image policy + the datasheet payload problem (2026-09-13)

Two halves: the policy for the incoming news-art library, and a **live performance
problem** found while writing it. The second half is the urgent one.

---

# Part 1 — The live problem: 35 MB of raw PNG in `public/`

Measured from the repo, 2026-09-13:

| File | Size |
|---|---|
| `images/datasheets/ifx-june-2026.png` | **16,801,354 B (16.8 MB)** |
| `images/datasheets/mod-august-2026.png` | 2,767,253 B |
| `images/datasheets/lunr-august-2026.png` | 2,645,645 B |
| `images/datasheets/krmn-august-2026.png` | 2,628,519 B |
| `images/datasheets/RKLB_Datasheet_July2026.png` | 1,891,891 B |
| `images/datasheets/onds-june-2026.png` | 1,826,546 B |
| `images/datasheets/asts-june-2026.png` | 1,777,481 B |
| `images/datasheets/ktos-july-2026.png` | 1,724,434 B |
| `images/datasheets/avav-june-2026.png` | 1,701,919 B |
| `images/datasheets/alab-august-2026.png.png` | 1,633,594 B |
| **datasheets subtotal** | **~35.4 MB** |
| `og-image.png` | 1,893,105 B |
| `og-image-v2.png` | 832,007 B |
| `apple-touch-icon.png` | 168,303 B |
| `logo.png` | 134,921 B |
| **public/ total** | **~38.4 MB** |

`DatasheetViewer.tsx` renders them with a plain `<img src={src}>` — no `next/image`,
so **no Image Optimization is applied and none is billed**. The raw PNG goes down the
wire at full size, exactly as committed.

## Why this matters here specifically

1. **One page ships 16.8 MB.** A visitor to `/insights/videos/tVFZmSVtXlk` (IFX)
   downloads a single image nearly seventeen megabytes. On mobile that is close to
   unusable and it is certainly not free for the visitor.
2. **Fast Data Transfer is metered on Vercel.** This is the same category of cost as
   the FMP bandwidth emergency — a large per-view payload, repeated.
3. **Core Web Vitals, during an active SEO recovery.** The `<img>` carries no `width`
   or `height`, so every datasheet causes layout shift as it loads. LCP on those pages
   is whatever the PNG takes to arrive — which undermines exactly what the ongoing
   SEO recovery work is trying to move. (That doc lives in the Claude Project and is
   not mirrored here, so it is deliberately not cited by path.)
4. **Git keeps all of it forever.** 38 MB is in history permanently, and grows with
   each new datasheet.

## Three smaller findings in the same sweep

- **`mod-august-2026.png` (2.77 MB) is orphaned.** `content/videos/1sI-5NmBCds.md`
  (ticker MOD) has `datasheetImage:` blank. The file is committed, served by nothing,
  and referenced by nothing. Delete it — this is the one case where removing a
  committed image is unambiguously right.
- **`alab-august-2026.png.png`** has a doubled extension. It works, because the
  frontmatter repeats the mistake, but it is a trip hazard for anyone scripting over
  this folder later.
- **`apple-touch-icon.png` at 168 KB** is roughly ten times what a 180×180 icon needs.
  Low impact, trivially fixed, worth doing while the tooling is out.

## The fix

Convert the datasheets to WebP and reference the `.webp` path from the video
frontmatter. These are 16:9 renders of an HTML template — flat dark panels, fine text,
a photographic background — so quality needs to stay high enough that the table text
stays crisp. Expect **q88–92**, and check the smallest figures on screen before
accepting the output.

**Do not assume the ratio.** The news-art photographs compressed to 9% of source; text
heavy panels behave differently. Measure and report, do not project.

Also, whether or not the conversion happens:

- Add explicit `width` and `height` (or an `aspect-ratio` box) to the `<img>` in
  `DatasheetViewer.tsx`. Every datasheet is 16:9, so this is a one-line fix that
  removes the layout shift on every one of these pages.
- Add `loading="lazy"` to the overlay copy (the inline one is near the fold).

---

# Part 2 — Policy for the news-art library

Measured on the real set, 2026-09-13: **89 source JPGs, 48.8 MB → 4.4 MB of WebP
across 178 files (9%).** Lead images ~30 KB, thumbnails ~3.7 KB.

## Rules

1. **Two pre-generated sizes, no runtime optimisation.**
   `<bucket>-<nn>.webp` at 1200×675 (lead card, and the source for the 1200×630 OG
   crop) and `<bucket>-<nn>-sm.webp` at 320×180 (compact rows). Centre-cropped to the
   exact aspect so every card is identical.

2. **Serve with plain `<img srcset>`, never `next/image`.** Vercel bills Image
   Optimization per transformation on cache miss, plus cache reads and writes. These
   are fixed, known dimensions generated ahead of time, so routing them through the
   optimiser pays a meter for work already done. Files in `public/` are plain static
   CDN assets and cost nothing beyond transfer.

3. **Always set `width` and `height`.** Same reason as the datasheets.

4. **Add, never replace.** Git keeps every version of a binary forever, and a replaced
   image doubles its footprint permanently. To improve a bucket, add
   `sector-banks-07.webp` and raise the manifest count. If something must go, do one
   deliberate delete-and-renumber pass rather than iterating in place.

5. **Never commit the source JPGs.** The 48.8 MB of masters belongs in OneDrive or a
   Downloads archive. Only the WebP output enters the repo.

6. **`manifest.json` is the source of truth for bucket counts** — the lookup map reads
   from it rather than anyone counting files by hand.

## Headroom

GitHub's limits: 100 MB hard per file, **1 MB recommended per object**, 10 GB
recommended repo on-disk. The largest news-art WebP is ~35 KB; the full library is
4.4 MB. Even at 250 images across both sizes it lands near 12 MB.

The library is not the storage risk. **The uncompressed PNGs already committed are** —
they are 8× the size of the entire planned image library, for ten pictures.

## Current bucket counts

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

Five sector buckets still to generate: staples, realestate, materials, aerospace,
insurance. The art cascade falls back to the generated data card for any bucket with
no images, so this ships incomplete without waiting.
