# Step 3 — extraction and retention (brief)

> **Provenance.** The authoritative document is the Claude Project copy of the
> same name. This repo mirror was **written from the owner's summary of that
> brief, not copied from the original**, which is Project-only and not visible
> from a coding session. Where the two differ, **the Project copy wins** and this
> file should be re-synced from it. Mirrored per `CLAUDE.md`'s "Where the
> automation docs live".

Source of the tag chains: `claude/hide-list-verdict-2026-09-13.md` §1 (already
in this repo). Cash-flow finding: the same document, §2.

## Owner decisions

| | |
|---|---|
| **Retention** | **8 quarters** and **5 fiscal years** per symbol. |
| **Why 8, not 4** | YoY on the newest quarter needs its year-ago comparator, and 8 gives *every* row in the recent-quarters table one. |
| **Cost** | ~9 KB per symbol against a ~20 KB budget. |
| **Annual series** | **APPEND-ONLY.** Historical periods are never deleted. |
| **Storage** | Redis, per-symbol keys, already registered in `symbolEviction.PER_SYMBOL_KEYS`. |

## The four traps

All measured on real responses. **All four render as plausible numbers rather
than errors** — which is the property that decides how they must be tested.

### 1. Cash flow is year-to-date cumulative

Every quarter except Q1 needs differencing, **not just Q4**. A Q3 figure read
straight is ~3× too large and looks entirely reasonable on the page.

```
Q1 = the 3-month value as filed
Q2 = 6-month  − 3-month
Q3 = 9-month  − 6-month
Q4 = 12-month − 9-month
```

`hide-list-verdict` §2 records the measurement: `NetCashProvidedByUsedInOperatingActivities`,
`PaymentsToAcquirePropertyPlantAndEquipment` and `ShareBasedCompensation` each come
back with only 2–3 quarterly periods in an 8-quarter window, for all five probe
symbols. A uniform result across five unrelated filers is not five coincidences.

It also names the assertion: **a quarterly operating cash flow that exceeds its
own annual figure is arithmetically impossible and trivially checkable.**

### 2. The tag chain resolves PER PERIOD, not per symbol

Resolve once per symbol and AAPL's revenue series goes **empty before 2018**
instead of falling through to the legacy `Revenues` tag.

Chain **order** decides the ASC 606 overlap. `Revenues` is legacy — AAPL's last
is 2018-09-29, MU's 2018-08-30, PLAB's 2018-10-31 — so it must sit *below*
`RevenueFromContractWithCustomerExcludingAssessedTax`, never above, or every
large filer renders 2018 revenue as current.

**Never sum two chain entries for one period.** First hit wins.

### 3. A period can carry two values — original and restatement

Keyed by accession. **Newest accession wins.**

This matters *more* under append-only retention, because nothing revisits an
archived year otherwise. A restatement landing after a year is archived must
still overwrite it.

### 4. Fiscal years are not calendar years

Measured across five probe symbols: **31 Mar, 26 Sep, 3 Sep, 31 Oct, 31 Dec.**

**Q4 is never filed** and must be derived as FY minus 9M.

## Before any extraction code: pin the stored field list

There is **no conditional check on `companyfacts`** — `Last-Modified` and `ETag`
both absent, measured 23 of 23 (`claude/sec-reread-no-cheap-check-2026-09-13.md`).
So a field added later **cannot be backfilled cheaply**: it means re-reading the
whole universe at ~150 KB wire each.

The asymmetry is therefore stark and one-sided:

- storing an unused field costs **bytes**;
- omitting a needed field costs **a full universe re-fetch**.

**Err wide.** Proposal: `claude/step3-stored-field-list-2026-09-14.md`.

## Validation

Diff **every** extracted number against the frozen FMP ground-truth dump.

**Not against hand-built fixtures.** §17 of `scripts/check-sec-daily-index.mjs`
is the worked example of why: a synthetic fixture produced
`{ periodic-report: 77, unconfirmed: 50 }` from a modulo-5 round robin and was
reported as a replay of a real window for days. A fixture reverse-engineered from
the expected answer cannot test the thing that produces the answer.
