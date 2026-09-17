# HANDOFF — ticker logos (2026-09-17)

Self-hosted logo work. **Both PRs are merged and live.** Written for a fresh
session with no history.

Related docs: `claude/BRIEF-logo-harvest-2026-09-14.md`,
`claude/logo-coverage-probe-results-2026-09-14.md`,
`claude/BRIEF-logo-legibility-2026-09-15.md`,
`claude/serving-assets-from-public-2026-09-15.md`.

---

## State: done and shipped

| | |
|---|---|
| **#458** harvest | merged `b4680287`, live |
| **#462** legibility | merged `b8c0d757`, live |
| Files | **2,621** `.webp` in `public/logos/` |
| Size | **4.40 MB** — well under the ~10 MB ceiling, so `public/logos/` stands |
| Coverage | 99.7% (2,644 of 2,653 probed) |

**Note:** Claude Code's final message says "#462 is still open and unmerged."
**That is stale** — it was written around the merge and never re-checked. GitHub
confirms merged at 2026-09-15 07:53:46. Do not act on the stale line.

### What the site does now

`app/components/TickerLogo.tsx`, source order, first that loads wins:

1. `/logos/{SYM}.webp` — harvested, tried **unconditionally**
2. Clearbit `logo.clearbit.com/{domain}` — when a `domain` prop is passed
3. FMP's CDN — kept deliberately as a fallback; costs nothing and covers
   anything the harvest missed, including symbols listing after the last run
4. Monogram chip

Supporting decisions, all deliberate — **do not "fix" these without reading why**:

- **No runtime manifest.** `data/logo-manifest.json` is emitted for re-harvest
  diffing but never imported. As a client-component import it shipped 2,622
  symbols to every visitor (6.4 KB gzipped) to avoid a 404 `onError` already
  handles.
- **`middleware.ts` excludes `logos/`.** Its first act on a production request
  is a Redis call before the `/api/` early-return — 40 logos on a listing page
  meant 40 extra Upstash calls per view.
- **`next.config.ts` sets `max-age=86400, stale-while-revalidate=2592000`.**
  Next serves `public/` with `max-age=0`, which made self-hosting slower than
  the CDN it replaced.
- **Fallback index is scoped to the symbol** (`useState({sym, idx})`), because a
  plain `useState(0)` survived a symbol change and silently served FMP instead
  of the harvested file.

---

## Outstanding

**1. Production visual check — never completed.** The preview check for #458
passed; **#462's did not happen.** Claude Code cannot reach `*.vercel.app` or
production from its sandbox, and Chrome was unreachable at handoff time. It is
merged and live, so this is now a check against production, not a merge gate.

On `https://www.mystockharbor.com`:

- **AAPL** — should fill the chip, not read as a dot in a white box
- **IBM**, **NKE**, **V** — should be visible at all, on a dark panel
- **MU**, **NVDA**, **FANG** — should be unchanged
- **JMKE** — still the monogram
- **LHX** — known remainder, still smaller than it should be

If something looks wrong, both PRs are revertible independently.

**2. Phase 1 — the `website` capture. The only item with a deadline.**
Not started. `app/api/debug/static-profile/README.md` documents a capture route,
already built and never run, returning eight uncaptured fields including
`website`, from production where the FMP key already lives. No new credential.

    /api/debug/static-profile?key=$EARNINGS_BACKFILL_KEY&offset=0&limit=250

Owner walks `offset` in a browser until `done` is `true` (~3 pages), pastes each
page's `rows` into `data/.wire/static-profile-extra-<page>.json`, then
`scripts/static-profile-expand.mjs` and a PR. Delete the capture route in the
same PR, as its README instructs.

**Why it has a clock:** when the FMP subscription lapses, `website` is gone and
is hard to reconstruct. A ticker→domain map is what makes `apple-touch-icon.png`,
Clearbit and Wikidata usable afterwards with no vendor attached.

**Coverage caveat:** the route runs against the ~700-symbol pickers cache, not
the 2,653-symbol logo universe, so it covers roughly a quarter. Bank it anyway;
report the coverage rather than calling it complete.

**3. Quarterly re-harvest.** The harvest is a snapshot. New listings fall through
to FMP while it works and to the monogram after. Re-run via the push-triggered
harvest workflow; ~157s.

---

## Known remainders — reported, deliberately not fixed

- **`LHX` and `TUYA`** — the only 2 still under 75% fill. A **nested border**:
  transparent margin around an opaque white box, so one `trim()` removes the
  outer and stops at the inner. A second pass would fix 2 files and churn 172
  acceptable ones.
- **`IHS` (7.27) and `CDNS` (7.98)** — just under the reporting cut of 8, and at
  7.09/7.98 *before* the change, so unrelated to it. No gap in the distribution
  below ~20, so any threshold there is judgement, not measurement.
- **`NEXA`** — the one symbol dropped: a 32px source whose mark is 18px once the
  margin is trimmed, so it falls under the 24px floor. Correct behaviour.
- **~166 white-on-transparent marks** are now backed; 0 invisible remain at the
  <5 variation cut, 2 at the wider <8 cut.

---

## Traps worth carrying forward

Every one of these failed **silently** and produced a plausible wrong answer
rather than an error. This was the dominant failure mode of the whole project.

**Ordering, in the harvest:**

- The transparent-corner test must be made on the **original**, not post-trim.
  Trim removes the transparent margin, so a white mark filling its own bounding
  box reads as already-backed and never gets backed.
- The 24px floor must be re-checked **after** trimming.
- The blank-image guard must run **before** any backing is painted. Backing ran
  first once and undid it: `KNX` and `NGVT` got their variation from the panel
  behind them, passed the guard that had rejected them, and came back as
  committed files. The count moved 2,621 → 2,623 without tripping the drift
  guard.
- The visibility decision must be made on the **rendered 72px output**, not the
  full-resolution source. Downscaling averages pixels and pulls variation down;
  four marks cleared at full res and shipped as faint smudges.

**Measurement:**

- An **alpha-only** bounding box reports AAPL as 100% full. Its margin is opaque
  white, not transparent. Measure against the **corner colour**.
- **Mean luminance** conflates a dark mark on a white background with a white
  mark on transparency — both score low. It produced a 960-file false count, and
  flagged `CAT` (64.15 variation, plainly visible) in the brief's own sample.
- **Composite-on-white is right for legibility and wrong for blankness.** The
  same technique that correctly decides "is this visible on the chip" would have
  **deleted 166 real logos** when used to decide "is this blank" — white marks on
  transparency are not blank. Blankness keeps a background-independent test.

**Reproducibility:** the harvest is **not bit-reproducible**. A run expected to be
byte-identical changed one file (`P.webp`) because FMP served a different source
between runs. "Identical output" is not available as proof that a code change was
a no-op — prove it against the property you care about instead.

**Mechanism:** Phase 0 ran as a relay task. Phase 2 could not — `sharp` needs
`node_modules` and `check-relay-isolation.mjs` asserts the read-only relay runs
no `npm ci`, and `relay.yml` declares no `permissions:` so it cannot push. The
harvest therefore has its own **push-triggered** workflow, which runs from a
feature branch and costs no merge to `main`. Note `workflow_dispatch` only
registers for workflow files on the **default branch**, which is why a scratch
workflow is not an option.

---

## If Tiingo (or anything else) turns up with images

None of this is wasted. `TickerLogo` is source-agnostic and `LOGO_BASE` is a
single constant. Adding or reordering a source is a few lines in one file. Keep
the harvest as the local layer and slot a new provider in wherever it earns its
place.
