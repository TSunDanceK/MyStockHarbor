# BRIEF — fix logo legibility: trim baked-in margin, back the invisible marks (2026-09-15)

Paste-ready for a fresh Claude Code session. Self-contained: assume no chat history.

**Read first:** `claude/BRIEF-logo-harvest-2026-09-14.md` (the harvest this amends),
`claude/serving-assets-from-public-2026-09-15.md`, `app/components/TickerLogo.tsx`.

Follow-on to PR #458, which is **merged and live**. The harvest works; this is
about how some of the harvested marks *look* in the chip.

---

## The two problems, measured

Measured on production over 78 large caps, by drawing each `/logos/{SYM}.webp`
to a canvas and reading pixels. Method is in "Reproducing the measurement" below
— re-run it rather than trusting these numbers if anything looks off.

**1. A few logos render tiny (~2–3%).** Their source carries an *opaque* baked-in
background with the mark floating in the middle of it. `object-fit: contain`
correctly fits the whole image, margin included, so the mark ends up small.

- `AAPL` — opaque white background, mark fills **47%** of the frame. This is the
  one that prompted the brief; it reads as a dot in a white box.
- `BRK.B` — same shape, 67%.
- 7 of 78 had an opaque background at all; only those 2 were loose enough to notice.

**Do not fix this by scaling the image up.** 71 of the 78 already fill their
frame edge to edge — enlarging globally would crop or distort the majority to fix
a handful.

**2. Far more logos are invisible (13%).** White marks on transparency, rendered
onto `TickerLogo`'s white chip (`background: "#ffffff"`). Nothing shows.

`V` `UNH` `ABBV` `IBM` `CAT` `BA` `DIS` `NKE` `BLK` `UBER` — 10 of 78.

Consistent with the ~166 across the full universe that PR #458 flagged and
deliberately left alone. It skews worse among large caps, which is the traffic
that matters. **This is five times more common than the sizing problem and is
the real win here.**

Both are pre-existing: the same marks render into the same white box today, and
did before the harvest. Neither is a regression from #458.

---

## Fix 1 — trim the uniform border at harvest

Add `sharp`'s `.trim()` to the transcode, before the resize.

It crops a flat border using the top-left pixel as reference, so it removes baked
white margin exactly as it removes transparent margin, and it is a **no-op on the
71 that already fill their frame**. That is what makes it safe to apply
universally rather than to a hand-maintained list.

Guards, because trim can misfire:

- If trim returns an empty or near-empty image, **keep the untrimmed original**.
- If trim removes more than ~60% of both dimensions, treat it as suspicious and
  keep the original; log the symbol.
- **Re-check the 24px floor AFTER trimming, not before.** A 32px source whose
  mark occupies a small part of the frame can land under the floor once trimmed,
  and the existing rule was written against the untrimmed source width. Getting
  this backwards would silently keep upscaled mush.

## Fix 2 — bake contrast into the light marks

`TickerLogo` cannot choose a chip colour per symbol: it would need to know each
logo's colour, and that is exactly the per-symbol lookup #458 removed for costing
6.4 KB gzipped on every page. **So the contrast has to live in the image.**

At harvest, for each logo:

1. Compute the mean colour of the opaque pixels (alpha > 16).
2. Compute its contrast ratio against `#ffffff` — the chip's background.
3. If the contrast is below ~1.5:1 **and** the image has a transparent corner
   (i.e. it is not already carrying its own background), composite the mark onto
   a **dark, full-bleed backing** before encoding, with the mark inset ~12% so it
   does not touch the edge.

Use contrast ratio rather than a raw luminance threshold. My measurement used
mean luminance > 235, which is serviceable but blunt — it would misjudge a mark
that is mostly light with dark detail. Contrast against the actual chip colour is
the thing being decided, so measure that.

**Colour: do not invent one.** Take the dark from the existing palette in
`DashboardClient`'s `COLORS` (or wherever the card/chip tokens live). The site
already renders logos with baked dark backgrounds — `APLY`, `AAPD`, `AAPU` among
them — and they read well, so match those rather than introducing a new value.

**Known cosmetic artefact, flagging rather than fixing:** the chip applies
`padding: size * 0.12` over a white background, so a full-bleed dark image shows
a thin white ring. That ring exists today on every logo that already carries a
dark background and looks acceptable. The tidier alternative — bake a backing
into *every* logo and drop the chip's padding and white background entirely — is
more uniform but touches all 2,622 files and risks making currently-fine logos
worse. **Not doing that without the owner asking.** If the ring looks wrong once
this lands, that is the follow-up.

---

## Mechanism and scope

- Same push-triggered harvest workflow #458 built. Not the relay — it needs
  `sharp` and needs to push. Wall-clock was 64s.
- **Re-run the full harvest from the source PNGs**, do not re-process the
  committed WebPs: those are already downscaled to 72px and lossily encoded, so
  trimming them would compound the loss.
- The existing blank-image guard must run **after** trim and composite. Do not
  reuse the discarded first version of it that composited onto white and flagged
  166 files including IBM and DIS — that measurement error is documented in
  #458's body and would delete a hundred major brands.
- `KNX` and `NGVT` stay skipped. The 9 CDN misses stay missing.
- File count should stay ~2,622. **A materially different count means something
  went wrong — stop and report rather than committing.**
- PR against `main`, do not self-merge.

## Verification

1. `npx tsc --noEmit` and `npx eslint` — both pass.
2. Manifest and file listing agree in both directions.
3. Re-run the pixel measurement (below) on the new files and report: how many
   marks now fill <75% of frame, and how many still fall under 1.5:1 contrast
   against white. Both should be near zero.
4. Report the new total byte size. Compositing adds opaque pixels, so expect it
   to grow — if it clears ~10 MB, stop and report, since that reopens the
   storage decision settled in the harvest brief.
5. Owner-side visual check on the branch preview: **AAPL** (should now fill the
   chip), **IBM** and **NKE** (should now be visible at all), **MU**, **NVDA**,
   **FANG** (should be unchanged — these already filled their frames), and
   **JMKE** (still the monogram).

Note the cache header is `max-age=86400`, so replaced files take up to a day to
reach a repeat visitor. That is expected, not a bug.

---

## Reproducing the measurement

Run in the browser console on any page of the site, same origin:

```js
const load = s => new Promise(r => { const i = new Image();
  i.onload = () => r(i); i.onerror = () => r(null); i.src = '/logos/' + s + '.webp'; });

// for each symbol: draw to canvas, read pixels
// - corner pixel alpha > 200  => opaque baked-in background
// - bounding box of pixels differing from the corner colour => how much the mark fills
// - mean luminance of pixels with alpha > 16 => contrast against the white chip
```

The full probe is in the session that produced this brief; the three measurements
above are what matter and are quick to rewrite.

**The trap worth knowing:** an alpha-only bounding box reports AAPL as filling
100% of its frame, because its margin is opaque white rather than transparent.
Measuring against the *corner colour* is what reveals the 47%. A first pass that
measured alpha alone concluded there was no padding problem at all.
