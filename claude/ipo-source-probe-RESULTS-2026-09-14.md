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

### 3a. RESOLVED, same day — PROHIBITED

The owner read `nasdaq.com/legal` from their own browser and reports **§2, §6, §7 and §11
prohibit this use**. Recorded in `claude/nasdaq-licence-verdict-2026-09-14.md` (Project-side;
not mirrored into the repo as of this writing).

**Corroborated independently**, since the §-numbering could not be checked from here: a
search against [nasdaq.com/legal](https://www.nasdaq.com/legal) returns terms prohibiting
*"using, copying, or extracting any Content without express written permission, including
scraping, data mining, and automated or manual processes to capture or compile content"*,
and separately prohibiting *"accessing or using any process, whether automated or manual, to
capture data or content from the Service."* Unauthorised use is stated to be a breach that
*"may result in immediate termination of access … and may lead to legal action."* That is a
prohibition on the exact activity, and the *"automated or manual"* wording forecloses the
obvious workaround — **a human copying the calendar by hand is named in the same clause as
the script.** Read 2026-09-14.

This is the answer the brief predicted it might be, and the reason it insisted the licence
question was *"not an afterthought"*: **reachability without permission was never a route.**
The residential path works and may not be used. Nothing further should be spent on it.

### 3b. Nasdaq is dead permanently — alongside Stooq

Filed here in the same terms `claude/stooq-inaccessible-sec-viable-2026-09-12.md` uses for
Stooq, so the two read as one class of closed file rather than two separate disappointments.

| Source | Reachable? | Why it is closed | Status |
|---|---|---|---|
| **Stooq** | **No** — JS challenge on 6/6 endpoints, `401` on the archive zip (runs `34697400978`, `34697879018`, `34698045649`) | Refuses automated access outright | **CLOSED — technical** |
| **Nasdaq** | **Yes, residentially.** No from Vercel (prior) and no from a runner (30 s hang, 4/4, run `34883412035`) | **`nasdaq.com/legal` §2/§6/§7/§11 prohibit it, manually as well as automatically** | **CLOSED — legal, and therefore closed on every path including the one that works** |

**The distinction matters for how permanent each is.** Stooq's block is a policy someone
could change; a retest costs a second and is worth running if a bars question ever reopens.
**Nasdaq's is not a block at all** — it is a licence term, it applies to the working path,
and it does not expire. There is no retest. Do not re-probe it, do not "check whether it
still hangs," and do not treat a future success from any IP as news. Add it to the same
mental list as Finnhub's personal-use tier (§3): **ruled out in writing, not parked.**

The practical corollary, worth saying because three separate probe runs were spent
discovering it: **`api.nasdaq.com` should stop appearing in briefs as a candidate.** The
repo's standing instruction at `earnings-page-free-sources-2026-09-13.md:304` (*"Do NOT probe
Nasdaq"*) was right on the technical grounds it gave, and is now right on stronger grounds.

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

**UPDATED 2026-09-14, later the same day.** The two cells this probe left open were filled
by the owner from their own machine and browser, recorded in
`claude/nasdaq-licence-verdict-2026-09-14.md`. **That doc is not in the repo** — it exists
Project-side and was not mirrored, the same gap §6 describes below and `CLAUDE.md` records
twice. Its verdict is taken as given here; its §-numbering (`nasdaq.com/legal` §2/§6/§7/§11)
is quoted from the owner's report, **not from clause text read by this probe** — the domain
hangs from every egress available to it (§2c). The prohibition itself is corroborated
independently (§3a).

| | Nasdaq (residential) | Nasdaq (Vercel) | SEC EDGAR | FMP (reference) |
|---|---|---|---|---|
| **Reachable** | **YES** — owner-measured, residential UK | **NO** (prior measurement, `rssoutbound`, 25 s timeout preview + production). `api.nasdaq.com` not measured from Vercel; a **runner** hung 30 s on 4/4 requests to it | **YES** — 200, 39.3 MB in 423 ms | yes |
| **Rows usable, next 30d** | **MOOT — prohibited** | **MOOT — prohibited** | **≈0 forward.** No listing date beyond ~2 days out. ≈19/30 days *backward* (Recent) | **NOT MEASURED** — no `FMP_API_KEY`, and **not in dump** (Step 0 artifact `34690240239` holds no IPO file) |
| **Carries expected listing date** | **MOOT — prohibited** | **MOOT — prohibited** | **PARTIAL, and late** — 2/8 explicit date, 3/8 relative to prospectus date, 3/8 none; only at 424B, median 2 days before listing | **YES** — `date`, required, and the page's sort key |
| **Carries price range** | **MOOT — prohibited** | **MOOT — prohibited** | **1/4** on S-1/A covers | yes (`priceRangeLow`/`High`, or a `"8.00-10.00"` string) |
| **Carries shares offered** | **MOOT — prohibited** | **MOOT — prohibited** | 424B **4/8**, S-1/A **2/4** | yes |
| **Carries market cap** | **MOOT — prohibited** | **MOOT — prohibited** | **NO** — not a filed field | **NOT MEASURED** — parser accepts `marketCap`; no key and no dump row to confirm FMP populates it |
| **Cost** | $0 **and unusable** | $0 **and unusable** | $0 | $20,000/yr |
| **Terms: permitted / silent / prohibited** | **PROHIBITED** — `nasdaq.com/legal` §2/§6/§7/§11 (owner-read 2026-09-14) | **PROHIBITED** — same terms, same domain | public domain | commercial licence required |
| **Requests per day to run the page** | **MOOT — prohibited** | **MOOT — prohibited** | 1 index read + ~2 per new deal | **2** — *not the 1 the brief pre-filled*; see §0.3 |

**Reachability stopped being the question.** The residential path works — and it is the one
path whose terms explicitly forbid using it. A source that answers and may not be used is
not a fallback; it is a closed file.

---

## 8. The two surviving options, costed

**UPDATED after the licence verdict.** With Nasdaq closed on every path (§3b), the question
in §9 below — *"where does the fetch have to run"* — is answered: **nowhere new.** EDGAR is
the only licence-clean source left, and it does not carry a forward listing date. So the real
choice is no longer about egress. It is about whether the page keeps promising a forward
calendar it can no longer source automatically.

### The volumes both options run on (measured, §4)

- **~4.4 deals/week** price and list (38 final prospectuses in 60 days ≈ 19 per 30 days).
- **~4.8 companies/week** enter the pipeline with terms set (41 cohort members filed an
  S-1/F-1 in the window).
- EDGAR gives, per deal: **exchange 8/8 · ticker 5/8 · shares 4/8 · offer price correct 3/8
  · explicit listing date 2/8** (3/8 more derivable from the prospectus date).

### Option 1 — EDGAR + curated dates

| | |
|---|---|
| **Automated** | discovery (who is listing, and when they priced), exchange, and — after listing — ticker |
| **Manual, every week** | the expected date for ~4.4 deals; the offer price for the ~5/8 the parser gets wrong; share count for ~4/8 |
| **Build** | EDGAR adapter (**reuses the daily-index change detector already shipped in `e333dda`**), a committed curation/override file, a merge layer, the `IPO_PROVIDER` switch, and the `check-ipo-cadence.mjs` premise fix (§5.3) |
| **Recurring human cost** | ~15–30 min/week **if** a licence-clean date source exists — see the blocker below |
| **Cadence** | weekday evenings. Tue–Thu is the live pricing window; a Monday-only pass is useless (§9) |
| **Keeps** | the forward calendar, the page's title, H1, slug, 5 internal links and the query it ranks for |

**The unresolved blocker, and it is not small: where does the curated date come from?**
Nasdaq's §7 covers *"automated or manual"* capture (§3a), so **a human reading the date off
`nasdaq.com` by hand is named in the same clause as the script.** Option 1 is not viable
until a licence-clean date source is identified. Candidates, none checked:

- the issuer's **own IPO press release** (the company's own announcement of its own listing);
- **NYSE's** calendar — different operator, different terms, **unread**;
- the **424B4 itself** — licence-clean but T-0/T-1, which is too late to be "upcoming".

A listing date is a *fact*, and facts are not copyrightable in the US — but a site's terms of
use are a **contract** question, separate from copyright, which is exactly why Nasdaq's
clause bites on a source that is otherwise just a date. Sourcing the same fact from the
issuer's own release or from EDGAR sidesteps Nasdaq's contract entirely. **That reasoning is
mine, not legal advice, and the FMP episode is the argument for getting it confirmed in
writing before building on it.**

### Option 2 — retire the forward half, run recently-listed only

| | |
|---|---|
| **Automated** | everything. No curation, no override file, no merge layer |
| **Manual, every week** | **none** |
| **Build** | the same EDGAR adapter as Option 1, backward window only; delete the upcoming section; promote the existing `Recent IPOs` H2; decide the URL (below) |
| **Recurring human cost** | **zero** |
| **Reliability** | **materially better than Option 1**, and not only because there is less to do — see below |
| **Costs** | the forward calendar, and the search query the page earns its impressions on |

**Two reliability advantages that are specific to looking backwards**, both falling out of
the measurements rather than assumed:

1. **The price is final, not forecast.** A 424B4 is filed *after* pricing, so the number is
   the number. Option 1's forward half has to publish a *range* that the deal then prices
   outside — Apnimed's range was $14–16 and it priced at **$16.00**, above it (§4c).
2. **The 5/8 ticker gap mostly closes.** Once a company has listed it appears in SEC's
   `company_tickers.json` — the 798 KB CIK map this repo **already fetches and has working**
   (`scripts/fetch-company-tickers.mjs`). A CIK join fills the ticker for listed companies.
   A not-yet-listed company is not in that file, so **Option 1 cannot use this trick** and is
   stuck at 5/8.

### The SEO cost of Option 2 — what is actually exposed

**The exposure, measured from code:**

| Surface | Current state | Under Option 2 |
|---|---|---|
| URL | `/upcoming-ipos` — forward intent **in the slug** | mismatched, or 301'd away |
| `<title>` | "Upcoming IPOs This Month \| Confirmed IPO Calendar \| MyStockHarbor" — forward intent **twice** | must change |
| `<h1>` | "Upcoming IPOs" | must change |
| `<h2>` | "Recent IPOs" — **already exists, with real content** | gets promoted to the page |
| sitemap | priority `0.75`, `changeFrequency: "daily"` | daily still honest (~4.4 changes/week) |
| Internal links | **5**, anchored "Upcoming IPOs" / "Upcoming IPOs →" — `earnings-calendar:831`, `SiteHeader:1199` (site nav), `bottlenecks/[ticker]:92`, `about:83` | all 5 anchors need rewriting |
| JSON-LD | generic `ItemList`, gated on `upcomingFeed.ok` | survives; the `ok` gate moves to the single feed |
| Traffic | **632 impressions / 90d**, described as the site's highest-impression page | the part driven by forward intent is at risk |

**What I cannot tell you, and it is the number that decides this.** The 632 figure comes
from the instructions brief. The underlying audit — `claude/seo-recovery-plan-2026-08-15.md`
— is **Project-only and not mirrored** (it is entry #1 on `check-doc-citations.mjs`'s
backlog, cited by 8 code files). I have no query-level breakdown and no way to reach Search
Console. **So the honest statement of the SEO cost is: the full 632/90d is the exposure, and
the share of it attributable to forward-intent queries is unmeasured.** I will not put a
percentage on it. If most of those impressions are for *"upcoming IPO"*-shaped queries,
Option 2 is expensive; if they are for *"IPO calendar"* or *"new IPOs"* generally, it is
cheap. **That is a five-minute check in Search Console** (Performance → filter by page
`/upcoming-ipos` → Queries) and it should happen before either option is chosen.

**Three ways to handle the URL, if Option 2 is taken:**

- **(a) Keep `/upcoming-ipos`, repurpose the content.** Keeps every inbound link and all
  equity; costs nothing mechanically. But a page slugged and linked "upcoming" that serves
  only past listings is an intent mismatch, and it stops answering the head query. Worst
  case is leaving the word "upcoming" anywhere in the copy while the data is backward.
- **(b) New `/recently-listed-ipos`, 301 from `/upcoming-ipos`.** `next.config.js` already
  carries a documented 301 block with a duplicate-consolidation precedent, so this is cheap
  to build. Cleanest intent signal, equity transfers — but it *explicitly* abandons the
  forward query rather than losing it by neglect.
- **(c) Keep the URL and answer the query honestly.** The S-1/A watchlist is licence-clean,
  forward-looking, and **~4.8 companies/week** — it simply has no date. A section reading
  *"these companies have filed to list and set terms; underwriters do not publish the date
  until pricing"* is a truthful answer to "upcoming IPOs", keeps the slug, title, H1 and all
  5 internal links honest, and needs **no curation and no second source**. It is weaker than
  a dated calendar and stronger than nothing.

**(c) is the option the measurements actually favour** and it was not in the brief's original
two. It is Option 2's zero-maintenance cost with most of Option 1's SEO position, bought by
giving up the one field that was never obtainable for free anyway.

### Side by side

| | Option 1 — EDGAR + curated dates | Option 2 — recently-listed only |
|---|---|---|
| Forward calendar | yes, with dates | no (or dated-free, under 2c) |
| Weekly human time | ~15–30 min, **if a legal date source exists** | **zero** |
| Blocked on anything? | **yes** — no licence-clean date source identified | no |
| Data correctness risk | range published, then priced outside it; parser 3/8 on price | low — prices are final |
| Ticker coverage | stuck at 5/8 | high, via the existing CIK map |
| SEO | preserved | **exposed: up to 632 impressions/90d, share unmeasured** |
| Build size | adapter + curation + merge + switch | adapter + delete + URL decision |

**They are not exclusive, and the sequencing is free.** Option 2 is Option 1 minus the
curation layer, over the same adapter. Shipping 2 first — ideally as 2(c) — gets the page
licence-clean and zero-maintenance immediately, and leaves the curated forward half as an
additive change *if* a legal date source is ever confirmed. Nothing about 2 forecloses 1.

---

## 9. Original verdict — can this page stay automated on free data, and where does the fetch have to run?

*Written before the licence verdict; the reachability reasoning is superseded by §3a/§3b and
kept because its EDGAR findings and its cadence conclusion still stand.*

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
datacentre networks do not. ~~If it does, the architecture the brief anticipated is the one
that works: the fetch runs on the owner's PC, the result is committed as a JSON file, and the
page reads the file.~~ **STRUCK — it does answer, and that design is prohibited: the
committed-JSON architecture is exactly the "manual capture" `nasdaq.com/legal` §7 names
(§3a). Do not build it.** Nasdaq is out entirely; the surviving options are costed in §8.
On cadence, a Monday-only refresh is the one schedule that cannot work:
deals launch early in the week, price Tuesday through Thursday evening and list the following
morning, so a weekly Monday pass would miss the entire pricing window every single week and
publish a calendar that is stale by Tuesday lunchtime. **Twice weekly is the floor — Tuesday
and Thursday evening, US market close — and daily on weekday evenings is what the IPO week
actually demands.**

### ~~What I need from the owner~~ — items 1 and 2 are DONE

1. ~~Run `api.nasdaq.com/api/ipo/calendar?date=2026-09` from your PC.~~ **Done — it answers
   residentially.** And it does not matter, because of item 2.
2. ~~Read `nasdaq.com/terms-of-service`.~~ **Done — PROHIBITED, `nasdaq.com/legal`
   §2/§6/§7/§11 (§3a).** The lesson the $20K FMP quote paid for held: reachability without
   permission was never a route, and this time the check happened *before* anything was built
   on it rather than after.
3. Superseded by §8. The live question is now **Option 1 vs Option 2 (or 2c)**, and the one
   measurement that would settle it is the Search Console query breakdown for
   `/upcoming-ipos`.

### What is still open

1. **Search Console → Performance → filter by page `/upcoming-ipos` → Queries.** What share
   of the 632 impressions/90d is forward-intent? Five minutes, and it is the number the
   Option 1 / Option 2 decision turns on. Nothing here can reach it.
2. **If Option 1 is wanted: name a licence-clean source for the expected date**, because
   Nasdaq's §7 covers manual copying too (§8). Issuer press releases and NYSE's own calendar
   are the candidates; neither has been read.
3. **Then tell me which to brief:** Option 1, Option 2, or Option 2(c) — the dated-free
   forward watchlist, which the measurements favour and which was not in the original two.

**No build is proposed until you have read this.**

---

*Probe run by Claude Code, 2026-09-14. Relay runs `34883412035` and `34883903641`.*
