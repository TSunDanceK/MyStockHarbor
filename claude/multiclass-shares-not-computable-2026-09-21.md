# The brief's multi-class market-cap formula is not computable. Measured

Relay run [35620148960], `scripts/multiclass-shares-probe.mjs`. Read-only,
uncredentialled; `data.sec.gov` is 403 CONNECT from the agent sandbox.

## The question

`BUILD-BRIEF-earnings-calendar-v1-2026-09-15` §5 prescribes:

> **Multi-class:** `dei:EntityCommonStockSharesOutstanding` is filed per share
> class with different contexts. Group tickers by CIK and compute the sum of each
> class's shares times **that class's own close**, assigning the group total to
> every ticker in it. Otherwise GOOGL reads as half of Google.

`lib/server/secFields.ts` already recorded the opposite, from measurement: that
companyfacts publishes the default-context series only, so a multi-class filer's
rows "arrive with the same end, the same accn and nothing to tell them apart."

Both could not be acted on. BRK.A and BRK.B differ by roughly 1,500× in price, so
pairing the wrong count with the wrong close is not a rounding error.

## Result — the formula's inputs do not exist

| Filer | Tickers | Newest cover row | Value | Verdict |
|---|---|---|---|---|
| Alphabet | GOOGL / GOOG | — | — | **no cover tag at all** |
| Under Armour | UAA / UA | — | — | **no cover tag at all** |
| Berkshire | BRK-A / BRK-B | **2011-04-29** | 941,481 | one row, **15 years stale** |
| Fox | FOXA / FOX | **2010-01-29** | 798,520,953 | one row, **16 years stale** |
| Apple *(control)* | AAPL | 2026-07-17 | 14,594,180,000 | one row, current ✓ |

**Three findings, and each alone is enough to stop the build:**

1. **Two of four multi-class filers publish no `dei:EntityCommonStockSharesOutstanding`
   whatsoever.** There is nothing to group. Alphabet — the brief's own worked
   example — is one of them.
2. **The two that do have it are fifteen and sixteen years stale.** The probe sorts
   by `end` then `accn` descending, so those really are the newest rows present.
3. **Berkshire's 941,481 is the Class A count alone.** BRK.A has roughly 1.4M
   shares; BRK.B has roughly 1.3 **billion**. So even where a row exists it is one
   class, not a total.

Apple, a single-class control, is current and correct — so the staleness is a
property of these filers, not an artefact of the probe.

**Conclusion: this is not difficult, it is impossible from this source.** No class
labels, no tag for two of the four, and a decade-and-a-half-stale figure for the
other two.

## What follows

**The honest behaviour for a multi-class filer's market cap is to refuse** — which
`secValuation` already does via `multi-class-share-count-is-ambiguous`, but **only
when the extractor recorded multiple candidates.** Berkshire and Fox present as a
**single** row, so that guard does not fire for them.

### A live defect found on the way, and it is separate from stage 4

`valuationInputs` accepts any cover row with `val > 0` and any `asOf`:

```ts
} else if (typeof cover?.val === "number" && cover.val > 0 && cover.asOf) {
  shares = { val: cover.val, asOf: cover.asOf };
```

**There is no bound on how old that `asOf` may be.** A 2011 share count is
multiplied by today's close and rendered. For BRK-B that is a Class-A count
against a Class-B price — wrong by roughly 2,400×, and landing in no plausible
range at all, which is the one mercy here.

`priceIsCurrent` bounds the **price** and has no counterpart for the **share
count**. The cover date is disclosed in the card's sub-line ("as stated on the
cover page of the filing dated 2011-04-29"), so it is visible — but the figure is
still computed and printed.

BRK-B, BRK-A, FOXA and FOX are not in `PRESET_UNIVERSE`, so they arrive through
the **cold path**, which serves any of the ~10,400 registrants in the committed
ticker map. GOOGL **is** in the universe, and Alphabet's missing tag means it
correctly refuses with `no-cover-share-count`.

### Consequence for brief mutant #5

`multi-class grouping removed (per-ticker cap instead of per-CIK)` describes work
that **cannot be built from this source**, which is the same status as #1 and #3
— permanently inapplicable rather than uncovered. **That reclassification is an
owner decision and has not been taken here**; the ledger still carries #5 as
`uncovered`, which is the conservative reading.
