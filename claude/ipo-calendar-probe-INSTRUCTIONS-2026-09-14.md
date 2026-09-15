# IPO calendar — source probe INSTRUCTIONS, 2026-09-14

**This is a PROBE. Do not build anything. Do not edit `lib/server/ipoCalendar.ts`,
`app/upcoming-ipos/page.tsx`, or any other file in the app.** The only output is a
findings doc plus raw sample payloads on disk. The build brief gets written after the
owner reads the findings — same sequence as `stooq-sec-probe-INSTRUCTIONS-2026-09-12.md`
and `news-source-probe-INSTRUCTIONS-2026-09-13.md`, which is the only reason those
adjudications were trustworthy.

> **REVISION NOTE, same day.** The first draft of this brief proposed probing Nasdaq's
> calendar endpoint as a runtime source for the page. That was written without checking
> the repo's own prior measurements, and it was wrong — `BUILD-BRIEF-earnings-off-fmp-2026-09-13.md`
> already records **"No Nasdaq. Measured datacentre block."** Section 2 below is rewritten
> around that finding rather than rediscovering it. If any part of this brief contradicts
> an existing measurement in `claude/`, the existing measurement wins — say so in the
> results doc rather than re-running it.

---

## 0. Why this probe exists

`/upcoming-ipos` is the site's **highest-impression page** (632 impressions / 90d in the
2026-08-15 Search Console audit, more than any other single URL). It is the last FMP
dependency with no replacement plan.

The owner's read is that it is small enough to maintain by hand on a weekly schedule. That
may well be right — but before accepting a recurring manual job, this probe answers one
question: **is there a free source that carries the forward-looking expected IPO date, and
from which egress can it actually be reached?**

**Scheduling is not the obstacle.** The Vercel team is on **Pro** — 100 cron jobs per
project, down to once-per-minute — and the page already runs on ISR plus
`readFeed`/Upstash. If a reachable source exists, swapping the body of `fetchIpoRows()` is
the entire change.

---

## 1. What the page actually needs

From `lib/server/ipoCalendar.ts`, the contract any replacement must satisfy:

```ts
export type ConfirmedIpo = {
  symbol: string;          // required — row dropped without it
  company: string;         // required — row dropped without it
  date: string;            // required — ISO yyyy-mm-dd. THIS IS THE HARD ONE.
  exchange: string | null;
  priceRangeLow: number | null;
  priceRangeHigh: number | null;
  sharesOffered: number | null;
  dealSize: number | null;   // computed as shares x range MIDPOINT if absent
  marketCap: number | null;
};
```

Two feeds off one source, date range flipped: `getUpcomingConfirmedIpos()` (today → +30d,
ascending) and `getRecentIpos()` (−30d → today, descending).

And one filter that defines the page's editorial promise: a row is dropped unless **at
least one of** `priceRangeLow` / `priceRangeHigh` / `sharesOffered` / `dealSize` is
present. The page's copy is *"Confirmed, priced IPOs… not every rumored or filed IPO, only
the ones that are actually locked in."* A source carrying filings without terms cannot
fill this page — it would render empty.

**`date` is the crux.** Every other field appears somewhere in an SEC filing. The
*expected listing date* does not — it is an underwriter convention, not a filed fact. This
is structurally the same gap `fmp-exit-options-pickers-2026-09-12.md` §3 already records
for **scheduled earnings dates**. Do not assume it resolves differently here; measure it.

---

## 2. P1 — Nasdaq, and the egress question that decides the architecture

Nasdaq publishes its own IPO calendar behind a keyless JSON endpoint:

```
https://api.nasdaq.com/api/ipo/calendar?date=YYYY-MM
```

Reported to return `priced` / `upcoming` / `filed` / `withdrawn` buckets with fields in the
neighbourhood of `proposedTickerSymbol`, `companyName`, `proposedExchange`,
`proposedSharePrice`, `sharesOffered`, `dollarValueOfSharesOffered`, `expectedPriceDate`,
`pricedDate`. **None of that is verified** — report the real field names, not these
guesses. The `firstStr`/`firstNum` candidate-key guessing layer in `ipoCalendar.ts` exists
because nobody checked FMP's live schema first. Do not repeat that.

**But the reachability question comes first, and it is already half-answered.** This repo
has measured Nasdaq as refusing its datacentre IPs, alongside Stooq and GlobeNewswire — see
`BUILD-BRIEF-earnings-off-fmp-2026-09-13.md` §6, `probe-run1-void-stooq-closed-2026-09-13.md`,
and `news-flip-done-2026-09-14.md` §1. The house rule that came out of that work is
explicit: **source viability gets measured from inside a function, not from a runner.**

So measure **two egress paths separately** and report them as separate rows. Do not collapse
them.

### P1a — from the owner's PC (residential UK IP)

Fetch three months: `2026-09`, `2026-10`, `2026-08`. Declare a real `User-Agent`
identifying the site and an email, same courtesy posture as the SEC work. **Three requests
total. Do not loop, do not bulk-scrape, do not retry tightly.** A 403 or a challenge page is
a finding — record it and stop.

Save each response **verbatim** to
`C:\Users\sonny\Desktop\WESBITE\Website Reverse FMP\ipo-probe\nasdaq-YYYY-MM.json`
(the folder is spelled **WESBITE**). Raw payloads are the evidence; don't paraphrase them
into the findings doc and discard the originals.

Then report, with counts:

- Real field names, per bucket.
- Of the `upcoming` rows falling in the next 30 days, how many carry **both** a usable date
  and at least one pricing field? That number is the page's real coverage.
- Is the date precise to the day, or a placeholder (`"TBA"`, `"9/2026"`, empty)? Count.
- Is there a market-cap figure, or does that column lose its source?
- Do `priced` rows for the last 30 days reproduce the "Recent IPOs" list?

### P1b — from inside a Vercel function

The existing measurement says this will fail. **Confirm it rather than assume it**, because
the whole architecture hangs on the answer and a stale block is worth knowing about. Use a
short-lived preview-only debug route, hit it once per month-window, and **delete the route
in the same run** — do not leave it in the tree, and do not merge it.

Watch for the failure shape `news-flip-done-2026-09-14.md` §1 identifies: a host that
**never settles** rather than erroring. Put the timing print in a `finally` so a hang prints
a line too, the way `ee70acd` did for the wire feeds. A missing line is a measurement, but
only if you've arranged for the line to exist.

### Why the split matters more than it looks

| P1a residential | P1b Vercel | What it means |
|---|---|---|
| works | works | Runtime source. Swap `fetchIpoRows()`, page stays automated, done. |
| works | blocked | **The data file in the repo stops being a fallback and becomes the only design that can work.** Fetch happens on the owner's machine; the page reads a committed JSON file. |
| blocked | blocked | Nasdaq is out entirely. SEC floor plus manual curation is the answer. |

That middle row is the likely one, and it is worth stating plainly: it would mean
"automated" and "manual" are not opposites here. The gathering can be fully automated on the
owner's PC; only the merge is manual. That is a materially better answer than a weekly
hand-typed table, and it falls out of an egress constraint rather than a preference.

---

## 3. P2 — the licence question, which gates use regardless of reachability

Not an afterthought. **The site is in this position because a data source's commercial terms
were not checked up front.** A reachable endpoint the site is not entitled to use is not a
solution, and "it answered from his laptop" is not permission.

Read and quote, with URLs and the date read:

1. Nasdaq's terms of use as they apply to `api.nasdaq.com` — is programmatic access
   permitted, is redistribution or display on a third-party site addressed, is there an
   explicit prohibition?
2. Does Nasdaq sell a licensed IPO calendar product, and at what price — i.e. is the free
   endpoint the unlicensed back door to something they sell?

Quote the clauses. Do not summarise them as "seems fine". If the terms are silent rather
than permissive, say **silent** — the same posture `fmp-exit-options-pickers-2026-09-12.md`
§4 characterises as *"fine as a bridge, poor as a destination."*

**A warning worth stating explicitly given the history here:** several stock APIs (Finnhub
among them) offer an IPO calendar on a free tier restricted to **personal, non-commercial
use**. That is precisely the trap that produced the $20K FMP quote — the site ran on a
personal plan until FMP identified it needed a commercial licence. **Any candidate whose
free tier is personal-use-only is disqualified at the outset**, however good the data.
Rule them out in writing rather than leaving them on the list.

---

## 4. P3 — the licence-clean floor: SEC EDGAR

Measure this regardless of what Nasdaq does. It is the only source with no terms problem at
all (US Government work, public domain) and it defines the fallback.

| Form | What it means | Lead time on listing day |
|---|---|---|
| `S-1` / `F-1` | filed to go public | months — no terms yet |
| `S-1/A` (launch amendment) | **price range + shares set** | ~1–2 weeks |
| `8-A12B` | registers the class on the exchange | ~0–2 days |
| `424B4` / `424B1` | final prospectus, **actual** offer price | day of / day after pricing |

Using EDGAR full-text search and the submissions API (no key, declare a User-Agent, respect
10 req/s), over the **last 60 days**:

1. How many `S-1/A` filings carry a price range and share count on the prospectus cover, and
   how reliably can those be extracted from the HTML? Try five by hand and report the hit
   rate honestly — a cover-page parser that works on 3 of 5 is not a pipeline.
2. Can the proposed ticker and exchange be read from the cover, or is the `8-A12B` needed?
3. **The decisive one: does anything in these filings state an expected listing date?**
   Check the cover and the "Underwriting" section. If the answer is no — the expectation —
   say so flatly. That single finding is what decides manual versus automated.

**Note the standing SEC caveat:** `probe-run1-void-stooq-closed-2026-09-13.md` records that
a missing `SEC_USER_AGENT` returns a 403 whose body reads *"Request Rate Threshold
Exceeded"* while not being a rate limit at all. If you see that page, check the header before
adding any backoff.

---

## 5. P4 — the derived-status question (no source needed)

Independent of everything above, confirm one thing by reading the code.

The Upcoming / Recent split is currently driven by **two fetches with flipped date ranges**.
Because every row carries a `date`, that split could instead be **derived at render from one
dataset** — a row whose date has passed moves itself from Upcoming to Recent with no new
data at all.

Report whether that refactor is feasible against `IpoList.tsx` and the `readFeed` shape, and
what it would touch. It matters: it means a dataset refreshed on **any** cadence — daily,
weekly, by hand — still shows correct membership every day in between. It removes most of
the maintenance burden of the manual option before the manual option is even chosen.
**Report only — do not implement it in this run.**

---

## 6. Things to note in passing, not act on

Known to need attention at build time. List anything else you spot; change nothing.

- `app/upcoming-ipos/page.tsx` — the footer line *"Data source:
  financialmodelingprep.com"* becomes false the moment FMP goes.
- `scripts/check-ipo-cadence.mjs` — enforces that three revalidate values agree. If the
  source stops being a timed fetch, check whether its premise still holds.
- `app/api/debug/ipo-calendar/route.ts` — FMP-shaped debug route.
- `lib/server/fmpUsage.ts` (`fmpFetch`) — the only caller here goes away.
- The owner's standing rule: **everything must be reversible by a switch, not a rewrite.**
  Expect the build behind an `IPO_PROVIDER` env var, the way the news flip used
  `NEWS_PROVIDER` (PR #453) — including that PR's correction that an env change needs a
  **production redeploy** to be seen. Note where the switch would sit; don't add it yet.
- `refuseToCacheDegradedRender()` and the `hasItemList` JSON-LD guard are good work and
  should survive any source change untouched.
- This brief reached the repo by hand because the Project→repo doc mirror is manual. If you
  spot a low-risk way to make that a step rather than a habit, note it; `CLAUDE.md` already
  records this class of gap twice.

---

## 7. Deliverable

One doc: `claude/ipo-source-probe-RESULTS-2026-09-14.md`, plus raw JSON under `ipo-probe\`.
The doc ends with this table filled in — every cell measured, no cell inferred:

| | Nasdaq (residential) | Nasdaq (Vercel) | SEC EDGAR | FMP (reference) |
|---|---|---|---|---|
| Reachable | | | | yes |
| Rows usable, next 30d | | | | |
| Carries expected listing date | | | | |
| Carries price range | | | | |
| Carries shares offered | | | | |
| Carries market cap | | | | |
| Cost | | | $0 | $20,000/yr |
| Terms: permitted / silent / prohibited | | | public domain | commercial licence required |
| Requests per day to run the page | | | | 1 |

**The FMP column needs no live FMP call.** It is reference context and every cell is
answerable from `lib/server/ipoCalendar.ts` plus the Step 0 dump. This sandbox has no
`FMP_API_KEY` — that is expected and is **not** a blocker for this probe. Do not deploy
`app/api/debug/ipo-calendar/route.ts` to work around it. If the Step 0 dump holds no IPO
rows, write "not in dump" and move on; that is a complete answer, not a gap.

Then one paragraph, in your own words, answering the owner's actual question: **can this page
stay automated on free data, and if so where does the fetch have to run?** If the answer is
a manual or PR-based update, say what cadence the IPO week actually demands — deals
typically launch early in the week, price Tuesday through Thursday evening, and list the
following morning, which is the thing a Monday-only refresh would miss.
