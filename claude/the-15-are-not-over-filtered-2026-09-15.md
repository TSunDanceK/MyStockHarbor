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
registered under the Exchange Act files one. (Its 2026 424B4 **does** exist — see the
retraction in §2 — which changes nothing about this verdict.)

**Advance JV Group is the interesting one.** Nine filings, ever; no 8-A of any spelling; no
periodic reports. It is a genuine first-time offering — and its 424B4 cover says the shares
are to be *"quoted on the OTCQB Venture Market"*, adding that no market maker has yet agreed
to assist. **OTCQB is not a national securities exchange, so Section 12(b) registration —
and therefore Form 8-A12B — does not apply.**

That separates two fields this pipeline has been treating as one: **"first-time offering"**
and **"exchange listing"**. Advance JV is a true positive for the first and a true negative
for the second. For a page about IPOs on Nasdaq and NYSE, the 8-A12B test is asking the
right question, and this row is correctly absent.

## 2. ~~NEW BUG — an `EFFECT` notice was recorded as a 424B4~~ — RETRACTED 2026-09-15

> **This section was WRONG and is struck rather than deleted, so nobody acts on it.**
> Refuted by the seed run against `form.idx`, which is the pipeline's actual input.
>
> **`form.idx` gives Wellchange a real `424B4` on 2026-08-28 under accession
> `0001213900-26-094944`** — an ordinary filer-agent accession, not a `9999999995-` notice.
> **Zero of the 24 lower candidates carry an EDGAR-generated accession.** There was no
> mis-mapping and there is no bug in this pipeline.
>
> **The error was mine, and its cause is §5 of this same document.** The verification read
> the HTML directory listing, which silently truncates and drops the *newest* filings. It
> saw the `EFFECT` notice and never saw the 424B4 that follows it, and I reported the
> absence as a finding. A warning I wrote in §5 is the thing that caught me one section
> earlier — which is the argument for §5 being enforced in code rather than remembered.
>
> **The guard was kept anyway**, on the correct grounds: `9999999995-` accessions are a real
> input class and excluding them is free. But it has excluded nothing, and a guard that has
> never fired must not be described as a fix that worked — that is the failure mode the
> trap doc exists for.
>
> Wellchange is excluded from the lower table regardless, by **both** tests: no `8-A12B` in
> window, and seven `6-K`s before its prospectus. The §1 verdict stands; only the mechanism
> claimed here was false.

The retained, correct version of the point: **an input that looks like data, parses cleanly,
and is not what it claims to be** is the week's recurring shape. `9999999995-` accessions
are one instance of it. Recorded in
`claude/traps/a-filter-that-matches-nothing-looks-correct.md` alongside its mirror —
**a filter that matches the wrong thing looks exactly as correct as one that matches the
right thing** — which is also what this retraction is an instance of.

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

Three of six suspected misses are confirmed non-IPOs-for-this-page. (An earlier version of
this section also credited the `EFFECT` bug; that claim is retracted in §2 — all 24
candidates are genuine 424B4s.)

The gap is composition, not loss: **stockanalysis.com's ~28/month counts OTC and OTCQB
offerings, uplistings and direct listings**, which this page excludes by design. Advance JV
is a worked example — it would appear in a broad IPO count and correctly not in this one.

**Do not tune toward 28.** The number to match is exchange IPOs, and that is not the number
that was being compared against.

**The remaining open question is seasonal, and it is cheap to settle.** The measured window
ends 2026-09-15, so it covers mid-August to mid-September — historically the quietest stretch
of the IPO year, with issuers avoiding August and the autumn window opening only after Labor
Day (2026-09-07). Re-running the same funnel over an earlier 30 days (say 2026-06-15 →
07-15) distinguishes *"8 is seasonal"* from *"8 is structurally short."* Worth doing before
the flag is flipped, not before the plumbing is refactored.

## 5. Two method warnings for the build

**EDGAR's HTML directory listing silently truncates.** `/Archives/edgar/data/2089447/`
returned 7 rows and volunteered a "no entries appear in the date range" note — the true
count is 9, and the two it dropped were the *newest*, including the 424B4. Fetching the
folder path directly proved they existed. **`/Archives/edgar/data/<cik>/index.json` returned
the complete 9 and should be preferred for enumeration.** A listing that drops the most
recent filings is the worst possible failure mode for a calendar — and §2 is the worked
example of it producing a false finding.

**WebFetch caches per URL for 15 minutes.** Re-fetching the same URL to double-check a
suspicious read returns the cached response, so it is not independent verification. To
genuinely re-read, change the URL — `index.json` rather than the HTML listing, or a
different document in the same filing.

---

*Verified against primary EDGAR filings, 2026-09-15, independently of the seed run.*
*§2 retracted the same day after the seed run refuted it against `form.idx`. §1, §3, §4 and
§5 stand.*
