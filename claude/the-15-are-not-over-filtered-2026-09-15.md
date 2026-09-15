# The 15 are not over-filtered — the 8-A12B test is sound, 2026-09-15

Settles the open question in the step-2 funnel: whether the lower table's
`8-A12B`-in-window test was dropping genuine IPOs. **It is not.** Three of the six
"textbook IPO sequences with no 8-A12B" were checked directly against EDGAR, and none of
them is an exchange IPO.

Two hypotheses were on the table and **both were wrong**: that the capture missed a form
spelling (`8-A12B/A`, `8-A12G`), and that a ±10-day proximity rule would recover the
missing rows. There is no missing spelling, and there is nothing to recover.

---

## 1. What the three actually are

| Company | CIK | 8-A12B | Prior periodic reports | Verdict |
|---|---|---|---|---|
| Alliance Laundry Holdings | 1317685 | **yes — 2025-10-07**, 10 months *before* the 424B4 | 10-K + three 10-Qs | **follow-on** |
| Advance JV Group Ltd | 2089447 | **none, any spelling** | none, ever | first-time offering — **but OTCQB, not an exchange** |
| Wellchange Holdings | 1990251 | **yes — 2024-09-30**, ~23 months before | 20-F + many 6-Ks | **follow-on** |

**Alliance Laundry IPO'd in October 2025** (S-1 2025-09-12 → EFFECT 2025-10-01 → 8-A12B
2025-10-07, file no. 001-42897). The August 2026 S-1/424B4 pair is a follow-on. Its
two-day S-1→424B4 gap is itself the tell: no first-time IPO clears SEC review in two days.

**Wellchange IPO'd in 2024** (F-1 2024-02-08 → 8-A12B 2024-09-30, file no. 001-42294). The
6-K on 2026-08-21 is conclusive on its own — only a foreign private issuer already
registered under the Exchange Act files one.

**Advance JV Group is the interesting one.** Nine filings, ever; no 8-A of any spelling; no
periodic reports. It is a genuine first-time offering — and its 424B4 cover says the shares
are to be *"quoted on the OTCQB Venture Market"*, adding that no market maker has yet agreed
to assist. **OTCQB is not a national securities exchange, so Section 12(b) registration —
and therefore Form 8-A12B — does not apply.**

That separates two fields this pipeline has been treating as one: **"first-time offering"**
and **"exchange listing"**. Advance JV is a true positive for the first and a true negative
for the second. For a page about IPOs on Nasdaq and NYSE, the 8-A12B test is asking the
right question, and this row is correctly absent.

## 2. NEW BUG — an `EFFECT` notice was recorded as a 424B4

**Wellchange has no 424B4 on its record at all.** The item the seed recorded as a 424B4 on
2026-08-28 is an **`EFFECT` notice**, accession **`9999999995-26-002778`**.

Accessions beginning `9999999995-` are **EDGAR-generated notices, not company filings**.
`EFFECT` means the registration statement went effective; no final prospectus has been filed.
Something upstream mapped that notice onto a 424B4 form type.

**This inflates the lower table's candidate count.** The 24 includes at least one
non-filing, and the 15 "follow-ons" therefore include rows that were never 424B4s at all.
Every number in the lower funnel needs re-deriving after the fix.

It is the same shape as everything else this week: an input that looks like data, parses
cleanly, and is not what it claims to be. Worth a line in
`claude/traps/a-filter-that-matches-nothing-looks-correct.md`'s neighbourhood, or its own
trap — **a filter that matches the wrong thing looks exactly as correct as one that matches
the right thing.**

## 3. The free secondary discriminator that would have made this immediate

**A CIK with a `10-K`, `10-Q`, `20-F` or `40-F` dated before its 424B is a reporting
company, and a reporting company's offering is a follow-on, not an IPO.**

It catches Alliance Laundry and Wellchange independently of the 8-A12B, needs no extra
fetch — the forms are already in the index being parsed — and does not depend on any form
spelling or date-proximity judgement.

Recommended as a **cross-check, not a replacement**: where the two disagree, that is a row
worth looking at rather than a rule to arbitrate. Advance JV is exactly such a row — no
periodic reports (looks like an IPO) and no 8-A12B (not an exchange listing) — and the
disagreement is the informative part.

`6-K` is a useful third signal for foreign issuers specifically: filing one means already
registered under the Exchange Act.

## 4. Does this close the 9-vs-28 gap?

Substantially, though not entirely. Three of six suspected misses are confirmed
non-IPOs-for-this-page, and the `EFFECT` bug means the 24 candidates were never all 424B4s.

The residual gap is likely composition: **stockanalysis.com's ~28/month counts OTC and
OTCQB offerings, uplistings and direct listings**, which this page excludes by design.
Advance JV is a worked example — it would appear in a broad IPO count and correctly not in
this one.

**Do not tune toward 28.** The number to match is exchange IPOs, and that is not the number
that was being compared against.

## 5. Two method warnings for the build

**EDGAR's HTML directory listing silently truncates.** `/Archives/edgar/data/2089447/`
returned 7 rows and volunteered a "no entries appear in the date range" note — the true
count is 9, and the two it dropped were the *newest*, including the 424B4. Fetching the
folder path directly proved they existed. **`/Archives/edgar/data/<cik>/index.json` returned
the complete 9 and should be preferred for enumeration.** A listing that drops the most
recent filings is the worst possible failure mode for a calendar.

**WebFetch caches per URL for 15 minutes.** Re-fetching the same URL to double-check a
suspicious read returns the cached response, so it is not independent verification. To
genuinely re-read, change the URL — `index.json` rather than the HTML listing, or a
different document in the same filing.

---

*Verified against primary EDGAR filings, 2026-09-15, independently of the seed run.*
