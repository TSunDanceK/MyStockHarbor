# Logo coverage probe — results (2026-09-14)

Relay run **34888872483**, commit `2282a8cf` on `claude/awesome-fermat-m7vy1w`.
Success, 22s, stateful job correctly skipped (credential split held).
Probe script: `scripts/logo-coverage-probe.mjs`, task `logo-coverage`.

## Headline

| | |
|---|---|
| probed | 2,653 (the union figure of the brief's constraint 6, confirmed) |
| hits | **2,644 — 99.7%** |
| misses | 9 — 0.3%, all 404, zero placeholders |
| 429s / errors | none, at 8 concurrent |
| wall-clock | 22.0s |

Status histogram `{200: 2644, 404: 9}` — no 206s, so the CDN ignored `Range`
and returned full bodies. **The byte figures below are exact, not inferred.**

## Splits

**By exchange** — NYSE 1514/1517 (99.8%) · Nasdaq 1077/1081 (99.6%) ·
NYSE Arca 23/23 · Cboe BZX 3/3 · not-in-symdir 27/29 (93.1%).

**By instrument** — operating companies 2585/2592 (99.7%) · ETFs/funds 32/32 (100%).

**By source slice** — company-names 2585/2592 (99.7%) · **curated-only 33/33
(100%)** · static-profile-only 26/28 (92.9%).

The curated-only slice is the 33 symbols in neither committed file — the major
ETFs the site links (SPY, QQQ, DIA, IWM, VTI, VOO, ARKK, XL*, GLD, TLT, SMH).
Full coverage, which is why correcting the universe from ~700 to 2,653 mattered.

`BRK.B` and `BRK-B` both hit — the dot/dash spelling is not a risk here.

## The 9 misses — no gap-filler needed

APMD (Apnimed), BXBL (BOXABL), CSQR (Csquare), IOND (Ionic Digital),
JMKE (Jersey Mike's), SLBT (SL Science), STDN (Standard Nuclear),
plus FITB-PA and FITB-PM (Fifth Third preferred series).

These are **recent listings plus two preferred series**, not a structural tail of
logo-less instruments. The set drifts and FMP will likely backfill it. A
gap-filler would be work against a shrinking target; the existing monogram is the
honest rendering, and the fallback chain still reaches FMP's CDN for anything
absent from the local manifest.

## Bytes

- **Raw PNG total: 33.11 MB** across 2,644 hits
  (min 335 B · median 7,977 B · max 113,042 B)
- Area-scaled to 128px + 64px, PNG-equivalent: **15.94 MB**
- With a WebP factor: **8.8 MB** (aggressive) → **11.2 MB** (typical) →
  **13.6 MB** (conservative)

Sources are already small: **median width 240px**, with **950 in the 65–128px
band** that barely shrink at a 128px target.

The script's own printed projection (~11.77 MB) used median width for every
image and is superseded by the per-image recomputation above.

## Two findings only the dimension data surfaced

1. **35 sources are narrower than the 64px target** — widths of 16, 30, 32 and
   48px (AFYA, ARR, FANG, FUN among them). Upscaling a 16px source to 64px looks
   worse than the monogram it would replace.
2. **4 hits carry no PNG IHDR** — AEFC, APXT, JOYY, NIQ: 2.6–3.3 KB of something
   served under a `.png` name.

Both are handled in the brief's Phase 2 spec.

## Decisions taken from this data

- **Harvest is worth running.** 99.7% is not a marginal case.
- **No gap-filler**, per the miss analysis above.
- **Drop the @2x/128px variant.** `TickerLogo` renders at 18 (dashboard feed),
  24 (default) and 34 (stock/news/earnings H1s). The largest display size is
  34px, so a single 72px asset is already beyond 2× everywhere it is used. This
  roughly halves the payload and removes the storage-threshold question.
- **`public/logos/` is the home** — with the @2x variant dropped the projection
  lands around 5–7 MB, clear of the ~10 MB line, so no separate repo and no
  GitHub Pages.
- **Re-harvest periodically** (quarterly is ample). New listings fall through to
  FMP's CDN while it works, and to the monogram after it stops.
