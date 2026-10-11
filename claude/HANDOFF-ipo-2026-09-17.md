# HANDOFF — /upcoming-ipos off FMP, 2026-09-17

> **SUPERSEDED IN PART — see `claude/HANDOFF-ipo-2026-09-21.md`.**
> Everything below is still accurate as of its own date and its settled
> decisions all stand. What changed after it: the refresh route was built, the
> store was populated (753 records), steps 6 and 7 shipped, and TWO cover-parser
> defects were found that nobody was looking for — the share count was wrong 71%
> of the time it answered, and the SPAC deal-size anchor matched 1 of 94 covers.
> The flip is still the only thing outstanding.

Written to hand this to a fresh session cold. **Read this first; everything else is detail.**
Work lives on branch `claude/confident-tesla-0ozvb4`. Docs are on `main`.

---

## TL;DR

**Steps 1–5 of `claude/BRIEF-ipo-off-fmp-2026-09-14.md` are done, plus the ingest.
Nothing is live.** `IPO_PROVIDER` defaults to `fmp`, the page still serves FMP, and
`IPO_PROVIDER=sec` throws by design because nothing has written to Upstash yet.

**The seasonality question is answered and the design is cleared to ship.** June–July's
lower table is **25** against August–September's **8**, and the candidate count itself
doubles (48 vs 24) — so the difference is fewer companies pricing, not more rows being
filtered out. The threshold set before the run was 15–20. It came back 25.

**Three things remain:** the actual Upstash write, step 6 (hide Market Cap), step 7 (copy +
flag flip). Steps 6 and 7 are one PR.

---

## THE OPEN DECISION — answered

Claude Code built and proved the write path but did not write, because `relay.yml` records
that the repo's Upstash Actions secret is the **read-only token by deliberate choice**. It
offered two routes and asked which.

**Take route 2: run the ingest from the app as a cron-triggered refresh route.** Do not add
a write token to Actions secrets.

Reasons, in order:

1. **It does not reverse a deliberate security posture.** A read-only relay is a good
   property and the refused `SET` there is correct behaviour, not a credential to debug.
2. **The write token already exists in the Vercel environment.** Nothing new to provision.
3. **The team is on Vercel Pro** — 100 crons per project, down to once per minute. Cron was
   never the constraint on this project.
4. **The daily-index detector already lives app-side**, so this is its natural home rather
   than a second place that knows about SEC filings.

Claude Code independently recommended the same route. This is a confirmation, not a
redirection.

---

## THE SEASONALITY RESULT — the gate is cleared

| stage | Jun 15 – Jul 15 | Aug 16 – Sep 15 |
|---|---|---|
| lower candidates | **48** | 24 |
| − follow-on | 20 | 16 |
| **= RECENT** | **25** | **8** |
| **= UPCOMING** | 21 | 19 |

**The candidate count doubling is the decisive part.** It is upstream of every exclusion
rule. If the filters were over-eating, candidates would be flat and only the output would
fall. They are not flat.

Two corroborations worth keeping:

- **The upper table barely moves** (21 vs 19) — exactly what should happen when the pricing
  window closes but registrations carry on. Structural shortness would shorten both tables.
- **Two filters that read 0 in September fire in June–July**: withdrawals 2, entity filter 5
  (vs 2). That is live-data evidence those rules work outside their fixtures, which the
  September window could not provide.

**8 was August.** Do not re-open this.

---

## WHAT IS BUILT

| Step | State |
|---|---|
| 2 — seed from `form.idx`, two quarters | done |
| 3 — schema: `cik` required, `symbol` nullable | done |
| 4 — SEC branch + `IPO_PROVIDER` seam + exclusions | done |
| 5 — one `ipo:all` feed, both tables derived | done |
| ingest — merge, prune, two-command write | **built and fixture-proven, never executed** |
| 6 — hide Market Cap | **not started** |
| 7 — copy + flag flip | **not started** |

New modules: `lib/server/ipoExclusions.ts`, `ipoSecSource.ts`, `ipoSecStore.ts`,
`ipoRecordMerge.ts`. New checks: `check-ipo-exclusions.mjs`,
`check-ipo-split-fixtures.mjs`, `check-ipo-merge-fixtures.mjs`. Seed:
`scripts/ipo-seed.mjs`.

`tsc`, `eslint` and all repo checks pass. 24 split fixtures + 13 merge fixtures pass.

---

## DECISIONS ALREADY SETTLED — do not relitigate

Each of these cost a measurement. A fresh session will be tempted by several of them.

- **Nasdaq is permanently closed.** Not a datacentre block — a licence term.
  `nasdaq.com/legal` §2/§6/§7/§11 bar automated *and manual* capture and third-party
  redisplay, and grant only a *personal, non-commercial* licence: the exact category that
  produced FMP's $20K quote. Its payload is EDGAR Online under contract, so Nasdaq could not
  grant rights if asked. **There is no retest.**
- **No price-range column on the upper table.** Gate 0.1 failed at 42%. Reinforced by ITG,
  whose last S-1/A said $19–$22 and which priced at **$16.00** — a column that is 27% wrong
  with no way for the page to know.
- **The `8-A12B` test is sound.** Do not loosen it, do not add date proximity, do not widen
  the form spelling. All three of the suspected misses were checked on EDGAR and none is an
  exchange IPO.
- **Do not exclude SIC 6770 (Blank Checks).** SPAC IPOs are genuine IPOs and a large share
  of the market. The upper table is 6 SPAC / 13 operating — excluding 6770 would gut it.
- **Do not tune toward ~28 IPOs/month.** That figure counts OTC/OTCQB offerings, uplistings
  and direct listings this page excludes by design.
- **Membership travels on the row as a table tag.** Never re-derive the Upcoming/Recent split
  from the clock at render. FMP's date is a forward expected listing date; the SEC upper
  table's date is the amendment date and is always past. A clock rule files every upper row
  under Recent and renders a full Recent table above an empty Upcoming one — which reads as
  a quiet market, not a bug.
- **Age cap is 45 days** (`IPO_TERMS_MAX_AGE_DAYS`), keyed off the upper bound of observed
  lead time (14d), not the median (7d).
- **One key, two commands a day.** Whole-key read-modify-write on `msh:ipo:filings:v1`, with
  the prune inside the write. Per-filer keys would be ~700 commands/day against the $50 cap.

---

## THE TRAPS — this project's recurring failure shape

Written up in `claude/traps/a-filter-that-matches-nothing-looks-correct.md`. **A fresh
session should read that file before touching any filter.** Instances so far:

1. FMP's guessed field names — a parser betting on a schema nobody checked.
2. SIC `6726`/`6221` — would have shipped, matched **zero** rows, and looked correct.
3. `tickerMap.has(cik)` — type-checks perfectly, always false, because the map is keyed by
   **symbol**. Would have poured all 172 already-listed issuers into Upcoming IPOs.
4. Two filters reading 0 because they ran *after* a test that had already eaten their input.
5. The mirror case: **a filter that matches the wrong thing looks exactly as correct as one
   that matches the right thing.**

Two EDGAR method warnings that produced a live false finding this week:

- **The HTML directory listing silently truncates and drops the NEWEST filings.** Use
  `/Archives/edgar/data/<cik>/index.json` for enumeration. This caused a retracted "EFFECT
  notice mis-mapped as 424B4" finding — see §2 of
  `claude/the-15-are-not-over-filtered-2026-09-15.md`, struck in place.
- **WebFetch caches 15 minutes per URL**, so re-fetching the same URL is not independent
  verification. Change the URL to genuinely re-read.

---

## WHAT TO DO NEXT, IN ORDER

1. **Build the app-side cron refresh route** that calls the ingest and writes
   `msh:ipo:filings:v1`. One `GET` + one `SET`. Prune inside the write. Seed and daily must
   produce the same shape — they already share `ipoRecordMerge.ts`, keep it that way.
2. **Run it once** and confirm the store populates and `IPO_PROVIDER=sec` renders locally.
   This is the first end-to-end exercise of steps 3–5; everything so far is fixture-proven
   only.
3. **Steps 6 and 7 as one PR** — hide Market Cap behind the flag with a comment naming the
   source and date; replace the `financialmodelingprep.com` footer line; upper-table intro
   copy; `dateColumnLabel` "Terms set" / "Listed".
4. **Flip `IPO_PROVIDER=sec` in Vercel Production — which needs a production redeploy**, the
   correction PR #453 made the hard way. Then verify the live page.

Copy for the upper table, per the house hedged-language rule — describe what is known, do
not forecast:

> These companies have filed to list and set terms. The listing date is not announced until
> pricing, which is typically a few days before trading begins.

---

## EVIDENCE INDEX

On `main`:

- `claude/BRIEF-ipo-off-fmp-2026-09-14.md` — the build brief
- `claude/nasdaq-licence-verdict-2026-09-14.md` — the quoted licence clauses
- `claude/ipo-query-intent-measured-2026-09-14.md` — 827 impressions classified
- `claude/ipo-gate-0.2-verification-2026-09-14.md` — five price ranges verified 5/5
- `claude/the-15-are-not-over-filtered-2026-09-15.md` — 8-A12B test vindicated; §2 retracted
- `claude/ipo-calendar-probe-INSTRUCTIONS-2026-09-14.md` — the original probe

On the branch: `claude/ipo-source-probe-RESULTS-2026-09-14.md`,
`claude/ipo-phase0-RESULTS-2026-09-14.md`,
`claude/traps/a-filter-that-matches-nothing-looks-correct.md`.

---

## ONE STANDING RISK

The page is **not** live on SEC data, and FMP is still serving it. FMP's quote expires
**2026-10-14**. If the key lapses before the flip, `/upcoming-ipos` degrades to the
"couldn't load" state that `refuseToCacheDegradedRender()` protects — visible but not
cached, so not catastrophic. Still, the flip is the thing that removes the dependency, and
it is four steps away, none of them large.

---

*Handoff written 2026-09-17 after the Claude Code credit budget ran out mid-build. Nothing
is half-applied: every commit on the branch is complete, checked and pushed.*
