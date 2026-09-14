# IPO calendar — source probe RESULTS, 2026-09-14

Answers `claude/ipo-calendar-probe-INSTRUCTIONS-2026-09-14.md`. **Nothing was built.**
No file under `lib/server/`, `app/` or `.github/workflows/` was touched. The probe added
two scripts and two lines to the relay's task router, which is the mechanism
`scripts/relay-run.mjs` exists to allow a branch to use without a workflow edit or a merge.

**Evidence on disk:** `ipo-probe/` — `nasdaq-egress-2026-09-14.json`,
`sec-cohort-2026-09-14.json`, `sec-run1-sampling-error-2026-09-14.json`.

**Runs:** relay `34883412035` (task `ipo-sources`) and `34883903641` (task `ipo-sec-cohort`),
both on branch `claude/confident-tesla-0ozvb4`, both green, both in the credential-free
`read-only` job (the `stateful` job skipped, as the split intends).

---

## 0. Two things the brief asked for that could not be run, and one number it got wrong

Stated up front rather than buried, because they change how the table below reads.

1. **P1a — "from the owner's PC (residential UK IP)" is not something any Claude session
   can do.** It is an owner-side step. The save path in the brief
   (`C:\Users\sonny\Desktop\WESBITE\...`) is a Windows path on the owner's machine. Nothing
   below fills that cell, and nothing below should be read as if it did.

2. **P1b — a Vercel debug route was NOT deployed, deliberately.**
   `claude/earnings-page-free-sources-2026-09-13.md:304` carries a standing instruction in
   this repo: *"Do NOT probe Nasdaq. It is a measured datacentre block, not a retry
   candidate."* The brief's own revision note says that where it contradicts an existing
   measurement in `claude/`, **the existing measurement wins and I say so rather than
   re-running it**. P1b asks to confirm the block; the repo asks not to. I followed the
   repo, and measured a *third* egress instead that costs nobody a deployment (§2c).

3. **The brief's FMP column pre-fills "Requests per day to run the page | 1". It is 2.**
   `app/upcoming-ipos/page.tsx:76-77` runs `Promise.all([getUpcomingConfirmedIpos(),
   getRecentIpos()])`, and those are two `readFeed` keys (`ipo:upcoming`, `ipo:recent`)
   each wrapping its own `fetchIpoRows()` call with its own date range. Two cache keys,
   two fetches, one per day each. This matters for §5: deriving the split from one dataset
   is not only a maintenance win, it halves the call count.

---

## 1. What the page actually needs — confirmed from code

The contract in the brief matches `lib/server/ipoCalendar.ts` exactly. Two details worth
adding, both from the same file:

- **`dealSize` is already computed, not sourced.** `parseRow()` falls back to
  `sharesOffered × ((low + high) / 2)` — the comment records that the *midpoint*, not the
  high end, was verified against real confirmed rows. So FMP does not supply it today and
  no replacement has to.
- **The drop filter is the page's editorial promise, in one line.** A row with no
  `priceRangeLow`/`High`, no `sharesOffered` and no `dealSize` returns `null`. A source
  carrying filings without terms renders the page empty — not wrong, *empty*.

`IpoList.tsx` is purely presentational: it takes `ipos`, `emptyMessage`, `dateColumnLabel`
and has no idea where the split came from. That matters in §5.

---

## 2. P1 — Nasdaq, and the egress question

### 2a. Residential (P1a) — NOT MEASURED HERE

Owner-side step, per §0.1.

The repo already holds a residential measurement, and the revision note says it wins:
`claude/news-adapter-spec-2026-09-13.md` — *"It answered fine from a residential network
and refuses Vercel from both environments."* **That measurement is about
`rssoutbound.nasdaq.com` (the news RSS host), not `api.nasdaq.com` (the IPO calendar
host).** Recorded as-is rather than generalised — see §2d.

### 2b. Vercel (P1b) — NOT RE-MEASURED, prior measurement stands

`claude/news-adapter-spec-2026-09-13.md` verdict table:

> | **Nasdaq rssoutbound** | **BLOCKED — do not use** | 25s timeout, both attempts, every feed, preview **and** production |

and, in the same file: *"Nasdaq is not a fallback, a retry candidate, or a 'try again
later'. … Do not reintroduce it."* Corroborated by
`BUILD-BRIEF-earnings-off-fmp-2026-09-13.md:330` (*"No Nasdaq. Measured datacentre block."*)
and `wire-egress-verdict-2026-09-14.md:131`.

Again: measured host is `rssoutbound.nasdaq.com`. `api.nasdaq.com` has **never** been
measured from Vercel by this repo.

### 2c. GitHub Actions runner (a third egress) — MEASURED, and it hangs

Run `34883412035`, honest declared User-Agent
(`MyStockHarbor/1.0 (+https://www.mystockharbor.com; sonnybrindle@mystockharbor.com; IPO
calendar source evaluation)`), three requests budgeted, **one spent** — the brief says
record a refusal and stop, so months `2026-10` and `2026-08` were skipped.

| URL | result |
|---|---|
| `api.nasdaq.com/api/ipo/calendar?date=2026-09` | **30,005 ms → abort. 0 bytes.** No status, no headers, no body |
| `www.nasdaq.com/robots.txt` | 30,001 ms → abort. 0 bytes |
| `www.nasdaq.com/terms-of-service` | 30,000 ms → abort. 0 bytes |
| `www.nasdaq.com/legal-disclaimer` | 30,001 ms → abort. 0 bytes |

**The shape is a hang, not a refusal.** No 403, no challenge page, no connection reset —
the host accepts the connection and never answers. That is precisely the failure
`news-flip-done-2026-09-14.md` §1 describes from Vercel (25 s, every feed, both
environments). The timing print sits in a `finally` exactly so a hang would print a line;
it did.

A GitHub Actions runner is a **datacentre IP**, so this is neither P1a nor P1b. It is a
third data point, and it is the first one taken against `api.nasdaq.com` itself.

### 2d. What that does and does not prove

Two traps in this repo pull in opposite directions here, and both apply:

- `claude/traps/a-defect-found-in-one-file-lives-in-its-siblings.md` — a block found on one
  Nasdaq host is a strong prior for its siblings.
- `claude/traps/wrong-about-one-thing-is-not-a-source-for-another.md` — *"Corroboration
  must come from a different file."*

So, stated precisely: **three independent datacentre networks (Vercel preview, Vercel
production, GitHub Actions) now fail to get an answer out of Nasdaq, with the same
never-settles signature, and the third of those is on the IPO host specifically.** What is
still *not* measured is `api.nasdaq.com` **from Vercel**, and `api.nasdaq.com` **from the
owner's residential line**. The first of those I declined to measure on the repo's own
standing instruction; the second nobody but the owner can.

### 2e. The §2 decision table, filled in as far as it honestly goes

| P1a residential | P1b Vercel | meaning |
|---|---|---|
| **unmeasured** (prior: sibling host worked) | **blocked** (prior: sibling host; runner hang corroborates on the IPO host) | the brief's middle row, and it is where the evidence points |

If the owner's PC answers `api.nasdaq.com` — a one-minute check, §8 — then the brief's own
conclusion follows and is worth quoting: *"'automated' and 'manual' are not opposites
here. The gathering can be fully automated on the owner's PC; only the merge is manual."*

---

## 3. P2 — the licence question

**NOT ANSWERABLE FROM ANY EGRESS THIS PROBE HAS, and that is itself the finding.**
`www.nasdaq.com/terms-of-service` and `/robots.txt` are on the domain that hangs (§2c), and
the Claude sandbox is refused `www.nasdaq.com` by proxy policy. I did **not** retry with a
browser-shaped User-Agent: the repo's posture is that the UA is *"honest and identifying on
every request"* (`scripts/bars-provider-probe.mjs:18`), and impersonating a browser to read
the terms that govern automated access would be a poor way to start a licence question.

What I could establish, by search rather than by reading the clauses:

- **Nasdaq does restrict redistribution.** Nasdaq's distributor terms permit API delivery
  to entitled client organisations but the recipient *"may use the information for internal
  purposes only and may not distribute the information to other internal Subscribers within
  their firm or to any Subscribers outside of their organization"*, and a datafeed *"may not
  be provided … until a firm receives written permission from NASDAQ."* Read 2026-09-14 via
  search results summarising [Nasdaq's system application](https://www.nasdaq.com/docs/systemapplication.pdf)
  and the [OMNET API licence agreement](https://www.nasdaq.com/docs/omnet_api_license_agreement.doc).
  **This is distributor/market-data language, and I could not confirm it governs the keyless
  `api.nasdaq.com` calendar endpoint.** Treat it as directional, not as the clause.
- **A licensed IPO-calendar product market exists**, e.g. Xignite's
  [IPO Calendar & Performance Data API](https://www.xignite.com/Product/us-stock-ipo-calendar).
  I found **no** evidence of Nasdaq selling its own IPO-calendar dataset; recorded as
  *not found*, not as *does not exist*.
- **Finnhub free tier is personal/non-commercial — DISQUALIFIED in writing**, as the brief
  demands. Confirmed independently of the repo's own note at
  `earnings-page-free-sources-2026-09-13.md:129`. Free key is *"for personal, non-commercial
  projects"*; monetised apps need a paid plan
  ([finnhub.io/pricing](https://finnhub.io/pricing), [docs](https://finnhub.io/docs/api/ipo-calendar)).
  This is the exact trap that produced the $20K FMP quote. It stays off the list.

**Verdict on the posture the brief asked for: SILENT is not established — UNREAD is.**
Nobody should build on `api.nasdaq.com` until a human opens
`https://www.nasdaq.com/terms-of-service` in a browser and reads it. That is §8, item 2.

---

## 4. P3 — SEC EDGAR, the licence-clean floor

**Reachable, fast, and free.** `https://www.sec.gov/Archives/edgar/full-index/2026/QTR3/form.idx`
→ HTTP 200, **39,283,913 bytes in 423 ms**, declared User-Agent with contact. No sign of the
`Request Rate Threshold Exceeded` body (which, per the brief's caveat, would have meant a
missing header and not a rate limit). 144,834 filings parsed inside 2026-07-16..2026-09-14.

### 4a. Form counts in the 60-day window — exact, from the index, not sampled

| Form | Count |
|---|---|
| S-1 | 167 |
| S-1/A | 177 |
| F-1 | 56 |
| F-1/A | 81 |
| **8-A12B** | **276** (from **187** distinct filers) |
| 424B4 | 73 |
| 424B1 | 4 |

### 4b. Run 1 got the hit rate wrong, and the correction is the point

Run 1 took the last five S-1/A filings and reported **price range 0/5**. That number is
void. The five were **iPower (IPW, twice), authID, iSpecimen and Youmi** — and the first
three were *already trading on Nasdaq*, filing S-1/A to register resale or follow-on shares.
An already-public issuer has no IPO price range on its cover, so 0/5 measured the sampling
frame. S-1/A is used far more by listed small caps than by IPO candidates; "last five S-1/A"
is not an IPO sample. Kept in `ipo-probe/sec-run1-sampling-error-2026-09-14.json` rather
than deleted, because the failure is instructive.

Run 2 defines the cohort from **8-A12B** — the form that means a class is being registered
on an exchange. Of 187 such filers, **41** also filed an S-1/F-1 in the window and **38**
also filed a 424B1/424B4. Eight were assessed in full.

**8-A12B is not a pure IPO set either** — ETFs, notes and SPAC unit/warrant classes file it
too, and the assessed eight are SPAC-heavy (AMR, ARC, B&R, BOA are SPACs; Apnimed, Attovia,
Advasa and Robinhood Ventures are not). The denominator is "new exchange registrations".

### 4c. Cover-page extraction — the honest hit rate

**Final prospectus (424B1/424B4), n = 8:**

| Field | Hit |
|---|---|
| exchange | 8/8 |
| ticker | 5/8 |
| share count | 4/8 |
| offer price — *extracted* | 8/8 |
| offer price — **actually correct** | **3/8** |

That last row is the brief's *"a cover-page parser that works on 3 of 5 is not a pipeline"*
test, and it fails it. The regex returned a number every time; three of those numbers were
right (Robinhood $25.00, Apnimed $16.00, Attovia $17.00), three were `11.50` — the SPAC
**warrant exercise price**, not the $10 unit price — and two were `0.00001` and `0.004`,
which are **par values**. A parser that is confidently wrong 5 times in 8 is worse than one
that returns null.

**Amendment (S-1/A, F-1/A), n = 4:** price range 1/4 · share count 2/4 · ticker 2/4 ·
exchange 4/4. The one price range found was Apnimed's **$14.00–$16.00** (priced at $16.00 —
above the range, which is itself the kind of thing the page's "terms can change" disclaimer
exists for).

### 4d. The decisive question: does anything state an expected listing date?

**Partly — and far too late to fill an "Upcoming" page.** Of the 8 final prospectuses:

| What the filing says | Count | Example |
|---|---|---|
| **An explicit calendar trading date** | **2/8** | Advasa: *"expect our Common Stock to begin trading on Nasdaq on or about August 17, 2026"* (filed 08-12); BOA: *"expected to begin trading on August 4, 2026"* (filed 08-04) |
| Trading pegged to the prospectus date, no calendar date | 3/8 | B&R: *"approved for listing … under the symbol BRTMU on or promptly after the date of this prospectus"* |
| Approval only, no timing at all | 3/8 | Attovia: *"has been approved for listing on the Nasdaq Global Market under the symbol ATTO"* |

The middle row is *derivable* — "the date of this prospectus" is the 424B4 filing date,
which EDGAR gives you — so in practice 5/8 yield a listing date to ±1 day. **But the lead
time is the problem, and it is measured:**

- **8-A12B → final prospectus: 1, 1, 1, 1, 2, 2, 7, 24 days — median 2.**
- **S-1/A → final prospectus: 4, 7, 7, 14 days — median 7.**

And the S-1/A, the filing with ~7 days of lead, is precisely the one that **does not carry a
date** (1/4, and that one was relative, not a calendar date) and mostly does not carry a
price range (1/4).

So the structural gap the brief predicted is confirmed, and it is the same one
`fmp-exit-options-pickers-2026-09-12.md` §3 records for scheduled earnings dates: **the
expected listing date is an underwriter convention, not a filed fact.** EDGAR tells you a
company is about to list roughly one to two days before it lists, and tells you reliably
only once pricing is done.

**Consequence for the page as it is written:** SEC alone can populate "Recent IPOs"
comfortably — 38 cohort members with a final prospectus in 60 days, ≈19 per 30 days, with
exchange 8/8 and ticker 5/8. SEC alone **cannot** populate "Upcoming IPOs" in any sense the
current copy promises, because there are essentially **zero** rows with a forward listing
date more than ~2 days out.

---

## 5. P4 — the derived-status question

**Feasible, and cheaper than the brief assumed. Report only; nothing implemented.**

Every row already carries `date`, and `IpoList.tsx` is presentational — it takes an array
and two labels and does not know where the split came from. So one feed over −30..+30 days,
split at render with two `.filter()` calls on `date`, is behaviour-preserving.

What it would touch:

1. `lib/server/ipoCalendar.ts` — one `readFeed` key (say `ipo:all`) instead of two;
   `getUpcomingConfirmedIpos()`/`getRecentIpos()` become filters over one cached array,
   keeping their sort directions (ascending / descending).
2. `app/upcoming-ipos/page.tsx` — the `Promise.all` of two reads becomes one read.
   `upcomingFeed.ok` currently gates `hasItemList`; with one feed there is one `ok`.
3. **`scripts/check-ipo-cadence.mjs` — this is the one that bites.** It asserts
   `freshArgs.length === 2`, i.e. that *both* feeds ask `readFeed` for the same freshness.
   Collapsing to one feed makes that check fail by design. It is a four-line change to the
   check, but it must be made deliberately, not discovered in CI.
4. `warnIfImplausiblyEmpty` on `ipo:recent` would need to move to the single feed.

**Why it is worth more than it looks:** a dataset refreshed on *any* cadence still shows
correct membership every day in between — a row whose date passed moves itself from Upcoming
to Recent with no new data. It also halves the FMP/successor call count from 2/day to 1/day
(§0.3). It removes most of the maintenance burden of the manual option **before** the manual
option is chosen, exactly as the brief argues.

---

## 6. Noted in passing, changed nothing

- `app/upcoming-ipos/page.tsx:299` — *"Data source: financialmodelingprep.com."* Becomes
  false the moment FMP goes. One line.
- `scripts/check-ipo-cadence.mjs` — premise is *"three independent layers decide how often
  /upcoming-ipos actually calls FMP."* If the source stops being a timed `fetch` (a committed
  JSON file, say), two of those three layers — Next's Data Cache and the fetch-level
  `revalidate` — stop existing, and two of its four assertions lose their subject. See §5.3.
- `app/api/debug/ipo-calendar/route.ts` — FMP-shaped, `guardDebugRequest`-gated, unlinked.
  Dies with `fmpFetch`. **Not deployed or invoked by this probe**, per §7 of the brief.
- `lib/server/fmpUsage.ts` (`fmpFetch`) — `ipoCalendar.ts` is one of its callers; check the
  others before removing anything.
- **Where the `IPO_PROVIDER` switch would sit:** `fetchIpoRows()` in `lib/server/ipoCalendar.ts`
  is the entire seam — it is the only function that names FMP, and everything above it
  (`readFeed`, the parser, the drop filter, both exported readers) is source-agnostic
  already. Same shape as `NEWS_PROVIDER` in #453, **including that PR's correction that an
  env change needs a production redeploy to be seen.** Not added.
- `refuseToCacheDegradedRender()` and the `hasItemList` guard (`page.tsx:87, 98`) are good
  and survive any source change untouched — confirmed by reading, not assumed.
- **The brief's own citations have drifted.** `probe-run1-void-stooq-closed-2026-09-13.md`,
  `fmp-exit-options-pickers-2026-09-12.md`, `stooq-sec-probe-INSTRUCTIONS-2026-09-12.md` and
  `news-source-probe-INSTRUCTIONS-2026-09-13.md` are **all cited by the brief and none exist
  in `claude/`**. The nearest live equivalents are `stooq-inaccessible-sec-viable-2026-09-12.md`,
  `probe-final-2026-09-13.md` and `probe-results-pipeline-2026-09-13.md`. Two of the four
  (`fmp-exit-options-pickers`, `stooq-sec-probe-INSTRUCTIONS`) are **already tracked** in
  `KNOWN_MISSING` in `scripts/check-doc-citations.mjs` as deliberate Project-only docs, so
  this is the mirror gap `CLAUDE.md` records, already half-accounted-for — not a new one.
- **On making the mirror a step rather than a habit** — the brief asks for a low-risk idea.
  **The obvious one is already built:** `scripts/check-doc-citations.mjs` fails on any
  `claude/…md` path, in code *or* in another doc, that does not exist, and carries a
  30-entry allowlist with a stated convention (*"Remove entries as they land; do not add
  without saying why in the commit"*). It passes on this branch.
  **The narrow gap it does have:** its pattern is `/claude\/[A-Za-z0-9_\-./]+\.md/g` —
  **prefixed paths only**. The instructions brief cites its four siblings as *bare
  filenames* (`stooq-sec-probe-INSTRUCTIONS-2026-09-12.md`, no `claude/`), and that style is
  invisible to the check. The two that are allowlisted are allowlisted because *other* files
  cite them with the prefix; the other two are dangling and unseen. Widening `PAT` to also
  catch a bare `*-YYYY-MM-DD.md` inside `claude/*.md` would close it, at the cost of some
  false positives on filenames mentioned in prose. **An idea, not a change** — I did not
  touch the check.
- `claude/pipeline-probe-verdicts-2026-09-01.md` §Q9 — *"Does the IPO calendar give usable
  lead time? **PENDING.**"* §4d above answers the SEC half of it: median 2 days from
  8-A12B, and the forms carrying real lead time do not carry the date.

---

## 7. The table

Every cell measured or explicitly marked unmeasured. **No cell inferred.**

| | Nasdaq (residential) | Nasdaq (Vercel) | SEC EDGAR | FMP (reference) |
|---|---|---|---|---|
| **Reachable** | **NOT MEASURED** — owner-side step. Prior repo measurement says yes for the *sibling* host `rssoutbound` | **NO** (prior measurement, `rssoutbound`, 25 s timeout preview + production). `api.nasdaq.com` not measured from Vercel; a **runner** hung 30 s on 4/4 requests to it | **YES** — 200, 39.3 MB in 423 ms | yes |
| **Rows usable, next 30d** | **NOT MEASURED** — no payload from any egress available to this probe | **NOT MEASURED** — same | **≈0 forward.** No listing date beyond ~2 days out. ≈19/30 days *backward* (Recent) | **NOT MEASURED** — no `FMP_API_KEY`, and **not in dump** (Step 0 artifact `34690240239` holds no IPO file) |
| **Carries expected listing date** | **NOT MEASURED** | **NOT MEASURED** | **PARTIAL, and late** — 2/8 explicit date, 3/8 relative to prospectus date, 3/8 none; only at 424B, median 2 days before listing | **YES** — `date`, required, and the page's sort key |
| **Carries price range** | **NOT MEASURED** | **NOT MEASURED** | **1/4** on S-1/A covers | yes (`priceRangeLow`/`High`, or a `"8.00-10.00"` string) |
| **Carries shares offered** | **NOT MEASURED** | **NOT MEASURED** | 424B **4/8**, S-1/A **2/4** | yes |
| **Carries market cap** | **NOT MEASURED** | **NOT MEASURED** | **NO** — not a filed field | **NOT MEASURED** — parser accepts `marketCap`; no key and no dump row to confirm FMP populates it |
| **Cost** | $0 | $0 | $0 | $20,000/yr |
| **Terms: permitted / silent / prohibited** | **UNREAD** — `/terms-of-service` hung from the runner, proxy-blocked from the sandbox; distributor terms restrict redistribution but are not confirmed to govern this endpoint | **UNREAD** — same | public domain | commercial licence required |
| **Requests per day to run the page** | **NOT MEASURED** | **NOT MEASURED** | 1 index read + ~2 per new deal | **2** — *not the 1 the brief pre-filled*; see §0.3 |

---

## 8. Can this page stay automated on free data, and where does the fetch have to run?

Not on SEC alone, and not from Vercel on Nasdaq. Those are the two things this probe
actually settled, and together they say the page's two halves have different answers.
**"Recent IPOs" can be fully automated on EDGAR today** — it is licence-clean, public domain,
free, fast, and a final prospectus lands within a day or two of every listing with the
exchange and usually the ticker on its cover. **"Upcoming IPOs" cannot**, because the
expected listing date is an underwriter convention rather than a filed fact: the filing that
carries real lead time (S-1/A, median 7 days) does not carry the date, and the filing that
carries the date (424B4) arrives a median of 2 days before trading. Any page built on EDGAR
alone would have to stop promising a forward calendar and start being a "just listed" page —
which is a different, smaller product than the one ranking today. The one remaining route to
a genuine forward calendar on free data is Nasdaq's own, and the only question left on it is
whether the owner's residential line gets an answer out of `api.nasdaq.com` when three
datacentre networks do not. If it does, the architecture the brief anticipated is the one
that works: the **fetch runs on the owner's PC**, the result is committed as a JSON file, and
the page reads the file — gathering fully automated, only the merge manual. If it does not,
Nasdaq is out entirely and the honest choice is EDGAR-plus-curation with the page's copy
rewritten to match. On cadence, a Monday-only refresh is the one schedule that cannot work:
deals launch early in the week, price Tuesday through Thursday evening and list the following
morning, so a weekly Monday pass would miss the entire pricing window every single week and
publish a calendar that is stale by Tuesday lunchtime. **Twice weekly is the floor — Tuesday
and Thursday evening, US market close — and daily on weekday evenings is what the IPO week
actually demands.**

### What I need from the owner (in priority order)

1. **Run this from your PC, in a browser tab:** `https://api.nasdaq.com/api/ipo/calendar?date=2026-09`
   — does JSON come back, or does it hang? That single answer decides the architecture, and
   it is the one cell nobody else can fill. If JSON comes back, save it to
   `…\WESBITE\Website Reverse FMP\ipo-probe\nasdaq-2026-09.json` and the content questions in
   §2 become answerable in one pass.
2. **Read `https://www.nasdaq.com/terms-of-service`** in that same browser, specifically for
   scraping / automated access / redistribution / commercial use. Reachability without
   permission is not a route — that is the lesson the $20K FMP quote already paid for.
3. Tell me whether to write the build brief for (a) the committed-JSON design, (b)
   EDGAR-plus-curation with rewritten copy, or (c) both, costed side by side.

**No build is proposed until you have read this.**

---

*Probe run by Claude Code, 2026-09-14. Relay runs `34883412035` and `34883903641`.*
