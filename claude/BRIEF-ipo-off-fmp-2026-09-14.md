# BRIEF — `/upcoming-ipos` off FMP, onto SEC EDGAR (2026-09-14)

Two re-sourced tables on the page's **existing layout**, behind an `IPO_PROVIDER` switch,
with the Upcoming/Recent split **derived** rather than fetched twice, and the FMP disclaimer
replaced.

**Everything here rests on measurement, not assumption.** The evidence is
`claude/ipo-source-probe-RESULTS-2026-09-14.md` (two relay runs),
`claude/nasdaq-licence-verdict-2026-09-14.md` (the terms, read from a browser) and
`claude/ipo-query-intent-measured-2026-09-14.md` (827 impressions classified). Where a number
below is not measured, it says so.

---

## 0. The decision

**Option 2(c) plus the recently-listed table** — the design
`ipo-query-intent-measured-2026-09-14.md` §6 recommends. Two tables, both sourced from SEC
filings, both public domain, **zero weekly curation**.

Why this and not the alternatives, in one line each:

- **FMP** — $20,000/yr, and the licence is the thing being escaped.
- **Nasdaq** — `nasdaq.com/legal` §2/§6/§7/§11 prohibit it from *every* egress including the
  residential one that works. §6 grants a *"personal, non-commercial"* licence: the exact
  category that produced the FMP quote. Its payload is also **EDGAR Online under contract**,
  so Nasdaq could not grant rights even if asked. **Closed permanently, alongside Stooq.**
- **EDGAR + curated dates (Option 1)** — not foreclosed, but **blocked** and worth less than
  it looks: every compiled calendar is somebody's licensed compilation, and the clean
  primary sources (issuer pricing release, prospectus) land at ~424B4 timing, i.e. the same
  **~2 days** EDGAR already gives free. It buys a tidier date on a deal already listing this
  week, for a permanent weekly manual job.
- **Recently-listed only (Option 2)** — covers ~30% of named intent against 2(c)+recent's
  **~62%**, at identical (zero) maintenance. Strictly worse.

**Coverage:** ~62% of the 494 named impressions (forward-undated 32.4% + neutral 19.4% +
backward 10.1%). The unserved remainder is the dated bucket (31.4%, an **upper bound** — an
IPO that listed this morning is "ipo today" and the lower table serves it) and
company/historical (5.5%).

---

## 1. What the page loses, keeps, and gains

### Loses

- **The Market Cap column.** No free source carries it — not SEC (not a filed field), not
  Nasdaq (absent from every bucket). **Hide it behind the flag with a comment naming the
  source and the date; do not delete it.** Same convention as the earnings hide list.
- **A dated forward calendar.** The expected listing date is an underwriter convention, not
  a filed fact. This is the honest loss and the copy must own it.

### Keeps

- The URL `/upcoming-ipos`, the `<title>`, the `<h1>`, the two-table layout, and all **five**
  internal anchors (`earnings-calendar:831`, `SiteHeader:1199`, `bottlenecks/[ticker]:92`,
  `about:83`) — **all still truthful**, which is the whole point of 2(c).
- `refuseToCacheDegradedRender()` and the `hasItemList` JSON-LD guard, untouched.
- `IpoList.tsx`'s **shape** — it still takes `ipos`, `emptyMessage`, `dateColumnLabel` and
  still does not know where the rows came from. **CORRECTED: it is not unchanged.** The
  original claim of *"no change at all"* was wrong; see §4.3.
- The `ConfirmedIpo` type, `parsePriceRange()`, `num()`, `str()`, `firstStr()`, `firstNum()`.

### Gains

- **NYSE, for the first time.** 13 impressions explicitly ask for it. Nasdaq's feed was
  Nasdaq-only; **SEC covers both exchanges.** The licence-clean source is the better one here.
- **Pre-priced companies.** `southern cross acquisition i corp.` and `east west ave
  acquisition corp.` are searched by name and land on a page that shows them nothing today,
  because it is priced-only. The watchlist answers them.
- **One FMP-class call per day instead of two** (§6).
- **$0**, and a source with no terms problem at all.

---

## 2. The two tables

| | **Upper — "Upcoming IPOs"** | **Lower — "Recent IPOs"** |
|---|---|---|
| Means | filed to list, terms set, **not yet priced** | priced and listed |
| Signal | `S-1/A` or `F-1/A` with terms, **no 424B yet** | `424B4`/`424B1`, usually with an `8-A12B` |
| Date column | **none** — replaced by "Terms set" (the amendment date) | the listing date |
| Volume (measured) | ~4.8 companies/week entering with terms | ~4.4 deals/week, ≈19 per 30 days |
| Lead time (measured) | median **7 days** before the final prospectus | 0–2 days |

**The drop filter changes meaning and must change with it.** Today a row is dropped unless it
carries price range, shares, or deal size — that enforces *"confirmed, priced."* The upper
table's promise is now *"filed, terms set"*, so the same filter applies for a different
reason: **a filing with no terms at all is a bare registration and still must not appear.**
Keep the filter; rewrite the comment above it. Do not loosen it — an empty upper table is a
true statement in a quiet week, and `warnIfImplausiblyEmpty` is the monitor for the case
where it is a parser failure instead.

---

## 3. PHASE 0 — measure three things, report back, and STOP

**Do not build the upper table before this.** The probe's S-1/A numbers are **not adequate**
to design against, and saying so is the difference between a brief and a guess.

### 0.1 The S-1/A extraction rate is not reliably measured

The probe assessed **four** amendments, **two of which were SPACs** where a price *range*
does not exist (units are fixed at $10.00). "Price range 1/4" therefore blends an extraction
failure with an inapplicable field. The one genuine operating-company IPO in the sample
(Apnimed) **did** yield its range, `$14.00–$16.00`.

**Measure:** 20 `S-1/A` + `F-1/A` filings from the 8-A12B cohort, **SPACs classified and
reported separately from operating companies**. Report per group: price range, share count,
proposed ticker, exchange. Extend `scripts/ipo-sec-cohort-probe.mjs`; dispatch
`relay.yml` task `ipo-sec-cohort`.

**Gate:** if operating-company range extraction is below ~70%, the upper table ships
**without a price-range column** rather than with a mostly-empty one. That is a real outcome,
not a failure — the 32.4% bucket asks *who*, not *how much*.

### 0.2 The price parser is the main engineering risk, and it currently fails

Measured on 8 final prospectuses: the regex returned a price **8/8** and was right **3/8**.
Three were `11.50` (the SPAC **warrant exercise price**, not the $10 unit price) and two were
`0.00001` and `0.004` — **par values**.

**A parser that is confidently wrong 5 times in 8 is worse than one that returns null**, and
this site has published wrong numbers off a lenient parser before — it is why
`stooq-inaccessible-sec-viable-2026-09-12.md` opens by crediting the *strict* CSV parser for
making the Stooq failure visible at all.

**Build against it, don't just widen the regex:**
- **Plausibility bounds.** Reject anything outside ~$1–$500/share. Par values and warrant
  strikes both fall out.
- **Prefer null over a guess.** A dash in the column is honest; `$0.00001` is not.
- **Anchor on the phrase, not the number.** *"initial public offering price is $X per
  share"* / *"public offering price of $X per share"*. A bare `$X per share` anywhere in a
  1.9 MB document is not evidence.
- **Cross-check SPACs.** A unit deal at $10.00 with a $11.50 warrant strike is the common
  shape; if both are present, $10.00 is the offer price.
- **A negative control.** Feed it a document with no offering price and assert it returns
  null. A parser that always answers has not been tested.

**Gate:** ≥90% correct on a 20-filing hand-checked sample, with nulls counted as correct only
where the field is genuinely absent.

### 0.3 The age cap's number (added by amendment 3, §4.8)

§4.8 requires an age cap and gives no number, because none is measurable from the probe's
n=8. **Measure the distribution**: for every cohort member with terms set and no `424B`, the
age of its most recent `S-1/A`/`F-1/A`, plus how many carry an `RW`/`AW`. Report the
histogram, not a recommendation — the cap is the owner's call once the shape is visible.

**No gate.** This one informs a constant; it does not block the build.

---

## 4. Findings the build must not get wrong

### 4.1 `form.idx` is 39.3 MB a quarter — never fetch it at request time

Measured: `full-index/2026/QTR3/form.idx` = **39,283,913 bytes**. Fine on a runner (423 ms),
catastrophic in a serverless render.

**Use what already shipped.** `lib/server/secDailyIndex.ts` (#454) reads
`daily-index/YYYY/QTRn/master.YYYYMMDD.idx` — **one request a day, ~3,600–4,100 rows**,
pipe-delimited `CIK|Company Name|Form Type|Date Filed|File Name`, with `dailyIndexUrl()`,
`toYyyymmdd()`, `addDays()`, `isWeekend()`, `latestProcessableDate()` and `accessionFrom()`
already written and checked by `scripts/check-sec-daily-index.mjs`.

**Cold start is a seed, not a backfill loop.** Seed the 90-day window **once from `form.idx`
on the relay**, commit or write the result, then accumulate daily. Same shape as the earnings
brief's §3.9 (*"the cold start is a bulk archive, not 10,426 requests"*).

### 4.2 SEC is reachable from Vercel — this is already measured, do not re-probe it

`secDailyIndex.ts` records the daily index as *"Measured 2026-09-13 from iad1: reachable,
layout stable."* **`iad1` is Vercel.** The egress question that killed Nasdaq does not apply
to SEC. No debug route, no relay run, no preview deploy is needed to establish this.

### 4.3 Ticker and exchange come from the CIK map, not from the cover

The probe extracted ticker from prospectus covers at **5/8**. Do not build on that.
`lib/server/secTickerMap.ts` already fetches `company_tickers_exchange.json` and stores it at
`msh:sec:tickers:v2` as `{ cik → { cik, exchange } }` — **it carries the exchange too.**

- **Lower table:** a listed company is in the map. Join on CIK for ticker **and** exchange.
  This closes the 5/8 gap almost entirely and is the single biggest quality win available.
- **Upper table:** a not-yet-listed company is **not** in the map. The proposed ticker must
  come from the cover, at whatever rate Phase 0 measures, or the column stays empty for that
  row. Do not let a missing ticker drop the row — `symbol` is currently **required** by
  `parseRow()`, and for the upper table it cannot be.

### 4.3a AMENDED — `cik` becomes row identity; `symbol` becomes nullable *after* that

**Decision (owner, 2026-09-14): do NOT make `symbol` nullable on its own.**

```ts
export type ConfirmedIpo = {
  cik: string;             // NEW, REQUIRED — row identity and the ticker-map join key
  symbol: string | null;   // was: string
  company: string;
  ...
};
```

**The principle, and it is the whole reason for the ordering: identity never depends on a
field the upper table cannot supply.** SEC always has a CIK — it is the filer's own
identifier, it is the first column of every index row, and it is what `secTickerMap` joins
on. A proposed ticker is a *claim in a prospectus*; a CIK is the key the source is organised
by. Making `symbol` nullable without first giving the row a real identity leaves every
downstream consumer keying off a value that is sometimes absent.

**Five sites depend on `symbol`, not the two the amendment lists.** All five must be fixed in
the same pass, or the nullable change ships a silent bug:

| # | Site | Today | Fix |
|---|---|---|---|
| 1 | `page.tsx:137` | JSON-LD `` name: `${ipo.company} (${ipo.symbol})` `` | **emits `"Acme Inc. (null)"` into structured data** on a page whose entire ranking case is the list. Guard it: name is the company, with ` (SYMBOL)` appended **only when present** |
| 2 | `IpoList.tsx:288` | table Symbol cell `{ipo.symbol}` | `{ipo.symbol ?? "—"}` |
| 3 | `IpoList.tsx:160` | narrow-view `{ipo.symbol}` | `{ipo.symbol ?? "—"}` |
| 4 | `IpoList.tsx:91` | **`rowKey()` = `` `${ipo.symbol}-${ipo.date}` ``** | **`cik`-based.** Found while verifying this amendment and **not in the amendment list.** This is the React key: with a null symbol, upper-table rows collide as `null-<date>`, so two companies amending on the same day get duplicate keys — React then bleeds expand/collapse state between rows and opens the wrong panel. It is the amendment's own principle applied to the place it bites hardest |
| 5 | `IpoList.tsx:157, 187` | `aria-label={...${ipo.symbol} deal terms}` and *"No deal terms published for {ipo.symbol} yet."* | fall back to `ipo.company` — a screen reader announcing *"Show null deal terms"* is worse than verbose |

**Site 1 is the one that matters beyond cosmetics.** `"(null)"` in `ItemList` structured data
is exactly the failure `hasItemList` already exists to prevent in its other form — the guard
was written because *"emitting an ItemList with zero items"* is worse than none, and emitting
one full of `(null)` is the same mistake wearing a different hat.

**FMP path:** `parseRow()` must populate `cik` too, or the type is a lie on one branch. FMP's
IPO rows are **not known to carry a CIK** — unverified, no key in the sandbox. If they do not,
the FMP branch synthesises identity from `symbol` (which FMP always has, since it is required
there today). **Phase 0 cannot answer this and should not pretend to**; it is a question for
whoever still has FMP access, and until then the FMP branch keeps `symbol`-derived identity.

### 4.4 A declared User-Agent is not optional, and its failure looks like a rate limit

SEC returns **403 with a body reading `Request Rate Threshold Exceeded`** when the UA is
missing — *while not being a rate limit at all*. Adding backoff to that is debugging the
wrong thing. Use the repo's `SEC_USER_AGENT` convention (contact address included) and keep
the existing `check-sec-adapter.mjs` assertion that one is sent.

### 4.5 A published range is not a published price

Apnimed's S-1/A said `$14.00–$16.00`; it priced at **$16.00**, above the range. The upper
table shows a *range that may not hold*, the lower table shows *what happened*. The
disclaimer must keep covering the first case (§7).

### 4.6 `8-A12B` is not a pure IPO signal

276 filings from **187 filers** in 60 days, but ETFs, notes and SPAC unit/warrant classes
file it too. It is a *"new exchange registration"* signal. Pair it with a 424B and, for the
lower table, with presence in the ticker map. **Do not label the denominator "IPOs."**

### 4.7 Two form-type spellings, not one

`S-1/A` **and** `F-1/A` (foreign private issuers: 56 F-1 and 81 F-1/A in the window — not a
rounding error), `424B4` **and** `424B1`. `isAmendment()` in `secDailyIndex.ts` already
handles the `/A` suffix. Dropping F-1 would silently lose every foreign IPO, which is the
same class of mistake as §3.4 of the earnings brief.

### 4.8 AMENDED — `RW` withdrawal, and an age cap, or the upper table never empties

**`isWithdrawnOrPostponed()` exists for a reason and the brief omitted its SEC equivalent.**
FMP flags these with an `actions` field; SEC's signal is the form type **`RW`** (registration
withdrawal — and **`AW`**, application withdrawal, for the same reason).

**Why this is not a nicety: a shelved deal has exactly the upper table's shape.** Terms filed,
no 424B. The two are indistinguishable without the withdrawal signal, so a deal that was
pulled in July would sit in "Upcoming IPOs" **forever**, and the page would state something
false about a company for as long as the page exists. That is a correctness bug, not a
polish item.

Two mechanisms, because they catch different failures:

1. **`RW`/`AW` in the window removes the company from the upper table.** Explicit withdrawal.
2. **An age cap on the terms-set date**, because *deals are abandoned far more often than they
   are formally withdrawn* — an issuer that loses its window usually just stops filing. No
   `RW` is ever filed, and mechanism 1 never fires.

**The cap needs a number and I do not have one.** Measured lead time is a median of 7 days
(range 4–14) from amendment to final prospectus, so a cap anywhere from 45 to 90 days is
defensible and I would be guessing between them. **Phase 0 measures the distribution** — ages
of cohort members with terms set, no 424B, and no `RW` — and the cap is set from the
histogram. Added to Phase 0 as §0.3, because the amendment asks for a parameter the brief
otherwise had no basis to pick.

### 4.9 AMENDED — sort order, per table

`fetchIpoRows()` today sorts `a.date.localeCompare(b.date)` — **ascending**. That is right for
a forward calendar, where the soonest listing is the most useful row.

**It is wrong for the upper table now, and the reason is that the column changed meaning.**
The upper table's date is the **amendment date** — when terms were set, i.e. a date in the
*past*. Ascending therefore puts **the stalest filings first**: the reader opens "Upcoming
IPOs" and sees the deal that filed terms two months ago at the top, and the one that filed
yesterday — the one most likely to price this week — at the bottom.

| Table | Sort | Because |
|---|---|---|
| **Upper** | **`date` descending** | most recently amended first = closest to pricing |
| **Lower** | **`date` descending** | most recently listed first — unchanged from `getRecentIpos()` today |

Both descending, but **not for the same reason**, and the comment should say so — otherwise
the next reader collapses them into one shared sort and re-introduces the bug the first time
the upper table's date means something else again.

---

## 5. The derived split

**One feed, one fetch, both tables derived** — satisfying P4 of the probe brief.

Today: `Promise.all([getUpcomingConfirmedIpos(), getRecentIpos()])` → two `readFeed` keys,
two `fetchIpoRows()` calls, two date ranges. Replace with a single `ipo:all` feed over a
90-day window, and derive:

```
upper = rows where the company has terms filed and NO final prospectus
lower = rows where a final prospectus exists AND its date is within the last 30 days
```

**The split is by pipeline stage, not by clock** — and that is stronger than the date-based
version P4 proposed. A company moves from the upper table to the lower one **when its 424B
appears**, which is the event that actually changed. No new data is needed for a row to land
in the right place, so a dataset refreshed on any cadence stays correct in between.

**Three things this touches beyond the two files:**

1. `scripts/check-ipo-cadence.mjs` asserts `freshArgs.length === 2` — *"both IPO feeds ask
   readFeed for that same freshness."* One feed makes this fail **by design**. Change it
   deliberately, in the same commit, with the comment rewritten. Do not discover it in CI.
2. `warnIfImplausiblyEmpty` currently guards `ipo:recent`. Move it to the single feed, and
   keep its reasoning: a 30-day window with no US listings is essentially never true.
3. `hasItemList` is gated on `upcomingFeed.ok`. With one feed there is one `ok`. Keep the
   guard — **an `ItemList` with zero items is worse than none**, and that is why it exists.

---

## 6. The `IPO_PROVIDER` switch

`fetchIpoRows()` in `lib/server/ipoCalendar.ts` is **the entire seam** — the only function
that names FMP. Everything above it is already source-agnostic.

```
IPO_PROVIDER = "fmp" (default, unchanged) | "sec"
```

Same shape as `NEWS_PROVIDER` in #453, **including that PR's correction: an env change needs
a production redeploy to be seen.** Write that in the comment, because it cost a debugging
round last time.

- Both providers return `ConfirmedIpo[]`; the parser, the drop filter and both readers are
  untouched.
- **Keep the throw-vs-empty distinction.** `fetchIpoRows()` throws on a missing key rather
  than returning `[]`, because `readFeed` treats a throw as *"could not answer"* and `[]` as
  *"genuinely none."* The SEC path must preserve that: a failed index read **throws**; a
  quiet week returns `[]`.
- Requests/day: FMP 2 → **SEC 1** (one daily index read), plus ~2 per new deal for cover
  fetches. Update `check-ipo-cadence.mjs`'s premise comment — two of its three "layers" stop
  existing once the source is no longer a timed `fetch` in the render path.

**Rendering shape:** follow the news precedent — the page reads Redis and makes no upstream
call. The daily index read and the cover fetches belong in the refresh path, not in a render.

---

## 7. Copy changes

**The footer line is false the moment the flag flips.** `page.tsx:299` reads *"Data source:
financialmodelingprep.com."* Replace with, and keep the existing hedge:

> Data source: SEC EDGAR filings (public domain) — compiled from S-1/A, F-1/A, 424B and
> 8-A12B filings. IPO terms can change before listing day — treat this as a starting point
> for further research, not investment advice.

**The upper table's intro must state the limit plainly**, per the house rule on hedged
language — describe what is known, do not forecast:

> These companies have filed to list and set terms. **The listing date is not announced
> until pricing**, which is typically a few days before trading begins.

**Do not** write "expected soon", "coming weeks", or any implied timing. The date is not
known; that is the finding, and the copy is where it becomes honest rather than hidden.

The `<h1>` stays **"Upcoming IPOs"** — it is accurate for companies that have filed to list,
and it is what 32.4% of named impressions ask for. The `dateColumnLabel` prop already exists
for exactly this: pass **"Terms set"** above and **"Listed"** below.

---

## 8. Build order

1. **Phase 0** (§3) — measure S-1/A extraction and build the price parser to its gate.
   **Report back and stop.**
2. Seed the 90-day cohort from `form.idx` on the relay; store it.
3. **The schema first, and in this order** (§4.3a): add required `cik`, fix all five
   `symbol` consumers *including* `rowKey()` and the JSON-LD, **then** make `symbol`
   nullable. Reversing the order ships a window where identity is undefined.
4. `fetchIpoRows()` SEC branch behind `IPO_PROVIDER`, reusing `secDailyIndex` and
   `secTickerMap`, with `RW`/`AW` exclusion and the age cap (§4.8) and the per-table sort
   (§4.9). Default stays `fmp`.
5. Collapse to one `ipo:all` feed; derive both tables; update `check-ipo-cadence.mjs` and
   move `warnIfImplausiblyEmpty` **in the same commit**.
6. Hide the Market Cap column behind the flag, with a comment naming source and date.
7. Copy: footer, upper-table intro, `dateColumnLabel` values.
8. Flip `IPO_PROVIDER=sec` **with a production redeploy**, and verify the live page.

Steps 3–7 are one PR. Step 8 is a separate, reversible action — which is the owner's standing
rule: **reversible by a switch, not a rewrite.**

---

## 9. Deliberately not being done

- **Curated dates (Option 1).** Blocked on a licence-clean source, and worth ~2 days rather
  than a week. Not foreclosed: if such a source is ever confirmed, dates drop into the upper
  table **without re-architecting anything** — the column and the layout are already there.
- **A URL change or a 301.** 2(c) keeps `/upcoming-ipos` truthful, so there is nothing to
  redirect and no link equity to move.
- **Rewriting the five internal anchors.** They stay accurate.
- **Re-probing Nasdaq.** Ever. It is a licence term, not a block; there is no retest.
- **Deleting `app/api/debug/ipo-calendar/route.ts` or `fmpFetch`.** They stay while
  `IPO_PROVIDER=fmp` remains a working fallback. Remove them only when the flag is retired,
  and check `fmpFetch`'s other callers first.

---

## 10. Noted, not acted on

- **`/upcoming-ipos` earns 0 clicks at position 67.** Nothing in this brief is justified by a
  predicted click number, and it should not be. The argument for 2(c) is that the page stops
  claiming something it cannot deliver — not that a position follows.
- **333 of 827 impressions (40%) are Google's anonymised tail.** Every share here is of the
  named 494 and should be quoted that way.
- **`claude/seo-recovery-plan-2026-08-15.md` lists Search Console verification as open. It is
  done** — `mystockharbor.com` is a verified domain property. That item can be closed, and
  the doc is still unmirrored (entry #1 on `check-doc-citations.mjs`'s backlog, cited by 8
  code files).
- **`pipeline-probe-verdicts-2026-09-01.md` §Q9** (*"Does the IPO calendar give usable lead
  time?"* — PENDING) is answered for the SEC path: median 2 days from 8-A12B, 7 from S-1/A,
  and the form carrying the lead does not carry the date.

---

*Written by Claude Code, 2026-09-14, from the probe runs `34883412035` and `34883903641` and
the owner's browser-side licence and Search Console readings. **No code written.***
