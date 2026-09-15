# The earnings page on SEC data — what moved, what did not, 2026-09-15

> **THIS IS NOT A COMPLETE MIGRATION OFF FMP.** Everything price-derived is
> untouched and still on FMP: market cap, P/E, the price-reaction card, and the
> daily bars behind it. The bars have not moved. Read §4 before assuming the FMP
> licence can lapse.

## 1. What now renders from SEC filings

Every financial number on `/stock/{symbol}/earnings`:

| card | source |
|---|---|
| Latest snapshot — revenue, GAAP EPS, operating income, net income, YoY on each | SEC fact set |
| Growth & margins — revenue/EPS YoY and gross/operating/net margin per quarter | SEC fact set |
| Quality of earnings — operating cash flow, capex, free cash flow, accruals, SBC | SEC fact set |
| Balance sheet — cash, investments, debt, net cash, current ratio, A/L/E | SEC fact set |
| Full P&L — the 16-line waterfall for the latest quarter | SEC fact set |
| Recent quarters — eight quarters, actuals only | SEC fact set |
| Earnings score | recomputed from the SEC fact set (§3) |

One Redis `GET` per render. `lib/server/secFactStore.ts`.

## 2. What is HIDDEN, not removed

The owner's standing rule: a column that loses its source is hidden with a
comment at the point of hiding recording what went away and when, so a future
deploy cannot switch one back on and ship an empty column. Registry:
`RETIRED_SOURCES` in `lib/server/secEarningsView.ts`.

| id | what | why |
|---|---|---|
| `eps-estimate` | EPS estimate and surprise | No free source for analyst consensus |
| `revenue-estimate` | Revenue estimate and surprise | Same |
| `forward-consensus` | Forward full-year consensus | Not in filings; guidance is 8-K prose |
| `quarter-estimate-columns` | Estimate columns in the recent-quarters table | Same source as above; actuals stay |
| `revenue-by-segment` | Revenue by product and by region | Filed on an XBRL **segment axis**; companyfacts publishes the **default context only** — this is not a chain gap a better tag would close. `hide-list-verdict` §6 |

Each renders a short reason. **Never a blank and never a zero** — "EPS surprise:
0.00" reads as "came in exactly in line", which is a claim, and a false one.
`retiredSource()` **throws** on an unknown id rather than falling back, so a card
cannot ship with an invented reason.

## 3. The score was rebuilt, not left running

Two of its three signals were estimates, weighted 1.35× (EPS surprise) and 3.2×
(revenue surprise) — together the dominant term. Deleting only those terms would
have left a growth-only number **still described as measuring estimate
performance**, which keeps the authority of the old one. It now scores year-over-
year revenue and EPS growth, profitability, operating-margin direction over four
quarters, and cash conversion, and `scoreExplanation` says so.

## 4. What is STILL ON FMP — read before assuming the licence can lapse

Two calls remain on this page, both price-derived:

- **`/earnings`** — for the **announcement date** and its before-open /
  after-close timing. A filing date is not an announcement date, and the
  price-reaction card needs the session the market actually reacted in. SEC
  filings do not carry this.
- **`getDailyHistory`** — the daily bars.

And elsewhere on the site, unchanged by this pass: **market cap** and **P/E**
(`msh:pickers:fundamentals:v1`), the analyst columns, and everything in the
pickers and screener that reads them.

## 5. How the data gets there — the standing population path

`app/api/jobs/sec-facts/route.ts`, cron `20 4 * * *`, twenty minutes behind
`sec-daily-index` (which keeps its stated property of **zero companyfacts
calls** — the change detector proved in isolation).

Two queues with **separate** allowances, so a large never-populated backlog
cannot starve the queue driven by what actually filed:

1. **reverify** — `needsReverify`, oldest enqueue first. 60/run.
2. **populate** — `contentHash === null`. 40/run.

Keyed on `contentHash === null` and **standing, not a backfill with an end**:
only a filing event fills `contentHash`, so a one-off backfill leaves the same
hole open for every symbol admitted afterwards
(`claude/sec-cold-start-coverage-2026-09-14.md` §2).

A failed fetch **leaves `needsReverify` set**, which is what makes the next run
retry it. A content-hash move with no filing event behind it is logged as a
**silent restatement** rather than quietly overwritten (spec §3 Layer 2).

**A page shows the "not loaded yet" card until this job has reached its symbol.**
At 40/run a ~700-symbol universe drains in about a fortnight;
`?symbol=XXXX&key=…` populates one on demand.

## 6. Labels and attribution

- **EPS is labelled GAAP** everywhere it is named, with a note that companies
  headline an adjusted figure and the two can differ substantially. Measured:
  AAPL FQ4-2024 is $0.97 GAAP against FMP's $1.64.
- **Attribution reads "SEC EDGAR filings"**, from one constant, so there is not a
  second spelling to forget to update.
- **Period labels are the filer's own fiscal period** — "Q3 FY2026", never a
  calendar quarter. The five probe symbols' year-ends are 31 Mar, 26 Sep, 3 Sep,
  31 Oct and 31 Dec: two companies' "2026" can be nine months apart.
- **Derived figures carry a `derived` mark** with the sentence explaining the
  derivation. That is every cash-flow quarter except Q1 (filed year-to-date), Q4
  of anything (never filed standalone), and any computed EPS.
- **Price-derived figures keep their "as of close" framing**, and the next-report
  date says on the page that it comes from the earnings calendar rather than a
  filing.

## 7. The visible consequences, stated rather than discovered later

- **One quarter in four has no EPS and no share count.** Q4 is never filed as a
  three-month frame and a weighted average is not additive, so neither is
  derived. Measured at exactly 25% over the five probe symbols. The row shows a
  dash.
- **`epsTtm` is therefore null too** for any symbol whose newest four quarters
  include a Q4, because a trailing-twelve-month sum refuses a partial year.
- **The P&L waterfall does not always add up.** Measured to fail on 5 of 32 probe
  quarters (ARM, MU) by 1–7%: those filers expense things the stored lines have
  no slot for. Operating income is taken **as filed** and is right; the card says
  the breakdown is partial rather than presenting a subtraction that does not
  work.

## 8. Checks

`scripts/check-sec-earnings-page.mjs` — 32 assertions, source-level, because the
page renders from Redis and a check cannot reach it. It asserts the registry is
complete and used in both directions, that every hiding is commented with what
went and when (read from **raw** source: `readCodeOnly` strips comments, so
asserting on stripped text would pass whatever was written), that no retired
endpoint is still called, that `/earnings` still is, that no user-visible string
says FMP, and that no rendered value coalesces null to zero.

## 9. What the render check caught that no unit check would have

The preview cannot be fetched from this sandbox — Vercel SSO protection is on
for every non-custom-domain host — so the verification was built the other way:
`scripts/sec-extract-probe.mjs` now runs the whole path on a runner, against real
companyfacts, and prints each symbol **as the page would render it**. Extract →
`encodeFactSet` → `cell()` → `buildSecEarningsView`, which is exactly what a
reader sees, not an intermediate.

The first run of that printed AAPL's recent-quarters table like this:

```
Q3 FY2026   2026-06-27    109417.0M      2.02
Q2 FY2026   2026-03-28    111184.0M      2.01
Q1 FY2026   2025-12-27    143756.0M      2.84
FY FY2025   2025-09-27  102466.0M[differenced]     —
Q3 FY2026   2025-06-28     94036.0M      1.57      <- SAME LABEL as row 1
```

and ARM's June 2025 quarter as **"Q1 FY2027"**, nine months out.

**Cause:** companyfacts' `fy` and `fp` describe the FILING, not the period the
row covers — a 10-K carries `fy 2026` on every comparative it restates. The
extractor was reading them.

**This is the labelling hazard the rule exists for, arriving from inside one
company rather than between two.** Every unit assertion about the label passed,
because they all read the same wrong field.

Fixed in `fiscalLabel()`, computed from the filer's own fiscal year-end. Two
details carry the correctness:

- the quarter step is **rounded** against a real quarter (365.25/4), not floored
  against 91 — a quarter runs 90–92 days and `floor(90/91)` is 0, which labelled
  AAPL's June 2025 quarter Q4 on the first attempt;
- the year-end match carries a **ten-day tolerance**, because 52/53-week filers
  move their year-end annually (AAPL's ran 2025-09-27 against a 2026-09-26
  anchor). An exact match pushes every year-end quarter into the next fiscal year
  and labels Q4 as Q1.

Now verified across all five calendars — year-ends 26 Sep, 31 Mar, 28 Aug, 2 Aug,
31 Dec, three of them 52/53-week — with the check asserting the labels *and* that
no two quarters in one table share one.

## 10. Two smaller things the render surfaced, recorded not fixed

- **ARM shows "Total debt —" and "Net cash —".** ARM tags no debt concepts at
  all, and `totalDebt` stays null rather than becoming 0: absence of a tag is not
  proof of no debt, and this repo's standing rule is never to treat it as such.
  The cost is that a genuinely debt-free balance sheet reads as unknown. A
  filer-level "no debt tagged in any period" test could distinguish the two;
  it is not built.
- **PLAB's `longTermDebt` reads $4,000** on one date and $3.9M on another — the
  chain is picking something small and probably wrong for that filer. Flagged in
  the five-symbol diff (D5) and unresolved.

---

## 11. The populate allowance, measured — and a 25% coverage gap it exposed

`scripts/sec-populate-cost.mjs`, relay run
[34959833821](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/34959833821).
40 symbols sampled evenly through the dump universe (899 symbols, 875 with a
CIK), 0 failures.

```
wire    p50 3.0MB   p90 5.3MB   max 6.4MB   total 107MB for 40
time    p50 153ms   p90 327ms   max 549ms   mean 165ms
stored  p50 11.2KB  p90 13.2KB  max 14.3KB
```

**The brief's "~150 KB typical" was wrong by a factor of twenty.** The median
companyfacts document is 3 MB. It did not matter, because the binding constraint
turned out to be neither wire nor rate.

| ceiling | at a 20% margin on the 300s budget |
|---|---|
| wall time | **1450/run** |
| SEC's rate | 1920/run |
| Redis writes | one SET per *changed* symbol — see below |

Raised **40 → 300** and **60 → 150**. The 300 is the 1450 ceiling divided by
five, and the divisor is the honest part: **the measurement was taken on a
GitHub runner, not a Vercel lambda.** The first real cron run settles it, and the
summary log reports `attempted`, `written` and both backlogs, so it will say
plainly whether 300 fits. Drain goes from ~22 days to ~2.9.

Redis is not a recurring cost here: only the first pass writes every symbol;
after that a set is rewritten only when its `contentHash` moves, which is a
filing event.

### THE REAL FINDING — 10 of 40 sampled symbols extract to NOTHING

```
AEG   AZN   BEPH  KGC   MFC   MT   NWG   OTLY  RYAAY  VIV
                       0 quarters, 0 instants, 0.2–0.3 KB stored
```

Every one is a **foreign private issuer**: Aegon, AstraZeneca, Brookfield,
Kinross, Manulife, ArcelorMittal, NatWest, Oatly, Ryanair, Vivo. They file
**IFRS**, and all 46 fields in `secFields.ts` declare `taxonomy: "us-gaap"`.
companyfacts carries their data under `ifrs-full`, which nothing reads.

**25% of the sample, and the brief predicted the population without predicting
the consequence:** "49 of the 55 periodic filers in the measured window were 6-K
filers — foreign private issuers." Those are the same companies. ARM is an ADR
too and extracts fine, because it files in us-gaap — which is exactly why
auditing the page on ARM could not have caught this.

**After a full drain, roughly a quarter of stock pages would still read "not
loaded yet".** That is a bigger gap than the allowance this probe was written to
size, and it is not fixed here: mapping IFRS concepts onto these 46 fields is a
taxonomy decision with its own per-field judgements — `ifrs-full:Revenue` is not
`us-gaap:Revenues`, and the cash-flow statement differs in structure, not just
in naming. It needs the same treatment the us-gaap chains got, against real
filings.

Two smaller observations from the same run:

- **PSKY** returned 6 quarters against 8 instants — partial, cause not
  investigated.
- `data/sec/company-tickers.json` carries **10,426** rows and the dump universe
  resolved **875 of 899**; the 24 that did not are a separate question from the
  four the reseed surfaced.

---

## §13 The cold path 500'd, and the reason kills the per-IP cap

**Measured, not reasoned about.** One render probe against the preview
(relay 34963369512) settled a question §12 had left open as a caveat:

```
/stock/ALSN/earnings    HTTP 500  348ms   6590B    outcome: unrecognised
/stock/RYAAY/earnings   HTTP 500  254ms   6590B    outcome: unrecognised
/stock/AAPL/earnings     HTTP 200  418ms 218075B   cache=MISS   outcome: rendered
/stock/ZZQQXX/earnings   HTTP 404  474ms            outcome: 404
round 2: AAPL 200 112ms cache=HIT · ZZQQXX 404 103ms cache=HIT
```

So three of the four guards were already right — the **CIK gate 404s**, the
**warm render works** (418ms cold cache, 112ms on the ISR hit) — and the one
thing the change existed to deliver, the synchronous cold fetch, returned 500.

Vercel runtime logs named it exactly:

```
Error: Page changed from static to dynamic at runtime /stock/ALSN/earnings,
  reason: no-store fetch
  https://data.sec.gov/api/xbrl/companyfacts/CIK0001411207.json
⨯ Error: Failed to load static file for page: /500 ENOENT
```

**The claim that was wrong.** §12 reasoned that `headers()` and a `no-store`
fetch were safe because they sat behind the store check, so a warm render never
reached them — conditional dynamism. There is no such thing on this route. A
dynamic API inside an ISR render does not make *that render* dynamic; it makes
the route's static/dynamic contract inconsistent, which Next 16 treats as fatal,
and this deployment has no `/500` artefact to fall back to. Every visitor to
every off-universe symbol would have got a 500.

It was invisible in the code because **both DynamicServerErrors were caught**:
one by `claimColdFetch`'s fail-open `catch`, one by the outer catch that logged
`[sec-cold] ALSN: … — queued`. Both read as handled timeouts while Next failed
the route underneath. A swallowed DynamicServerError is not a handled error, and
it is now rethrown.

### What changed

| | before | after |
|---|---|---|
| companyfacts fetch | `cache: "no-store"` | `next: { revalidate: 3600 }` |
| guard 3 | per-IP, via `headers()` | site-wide rate bucket, 20 cold fetches/min |
| DynamicServerError | swallowed, rendered pending | rethrown |

The fetch's revalidate **matches the segment's** deliberately: Next takes the
minimum of a segment's revalidate and its fetches', so anything shorter would
have shortened every `/stock/*` page's window. The Data Cache is immaterial
either way — the measured body is 3.0MB p50 / 6.4MB max against Vercel's 2MB
entry limit, so it is offered and declined, and guard 2 means a second render
never reaches the fetch regardless. Redis is the real cache and it has no
expiry.

### The per-IP cap is lost, and that is the owner's call to make

The brief said *"PER-IP CAP ON COLD FETCHES, not on requests."* That is not what
shipped, and the reason is structural rather than a preference: the only way to
learn a client's address inside a render is `headers()`, `headers()` is
unconditionally a dynamic API, and the measurement above is what a dynamic API
does to this route. **Per-IP capping and ISR are mutually exclusive here.**

What the site-wide bucket keeps: fetches are counted, not requests, so a reader
of cached pages still spends nothing; and over budget degrades to
queued-and-pending rather than to the 403 that hit a real user on
`/insights/videos`.

What it loses: one actor can spend the whole site's minute, pushing a real
visitor's cold symbol onto the queue. Total external work is still bounded —
guards 1 and 2 cap it at ~10,400 fetches *ever*, because a fetched symbol is
written to Redis and never fetched again — but clients are no longer isolated
from each other.

**The alternative, priced, not taken unilaterally:** `middleware.ts` already
runs on every `/stock/*` request with Redis in hand (`dailyPageLimit`), and
headers are ordinary there. To stay a *cold-fetch* cap rather than the request
cap that is ruled out, it would have to tell cold from warm before counting —
one `EXISTS` on the fact-set key per earnings **request** (not per render), on a
Redis billed by command count.

### A property of the pending state worth stating

`revalidate = 3600` caches whatever the render produced, **including a pending
card**. A cold symbol that times out or loses the budget race renders pending,
and that HTML is served for up to an hour even after the cron populates it. The
5s timeout is ~15x the measured p90 (327ms) so this should be rare, but rare is
not never, and it is a real consequence of the synchronous design rather than a
bug in it.

### The re-measurement: it works, and here are the numbers

Relay 34965223921 against the same preview, four **genuinely off-universe**
symbols (CULP, IIIN, PLPC, FLXS — small-caps, no stored fact set, no cached
price history either) plus the three canaries:

```
===== round 1  (cold)
  /stock/CULP/earnings    HTTP 200  1983ms  215357B  cache=MISS   rendered
  /stock/IIIN/earnings    HTTP 200  1003ms  217332B  cache=MISS   rendered
  /stock/PLPC/earnings    HTTP 200  1020ms  217942B  cache=MISS   rendered
  /stock/FLXS/earnings    HTTP 200   817ms  223298B  cache=MISS   rendered
  /stock/RYAAY/earnings   HTTP 200   751ms  164552B  cache=MISS   no-xbrl
  /stock/AAPL/earnings    HTTP 200   485ms  218118B  cache=MISS   rendered
  /stock/ZZQQXX/earnings  HTTP 404   338ms           cache=MISS   404
===== round 2  (the same URLs, seconds later)
  CULP 103ms HIT · IIIN 139ms HIT · PLPC 180ms HIT · FLXS 106ms HIT
  RYAAY 100ms HIT · AAPL 125ms HIT · ZZQQXX 106ms HIT
```

**`cache=HIT` on round 2 is the load-bearing line, not the times.** A dynamic
route can never report HIT. The cold render's HTML was cached by ISR and served
from it, so the route kept its static contract *through* a render that fetched
3–5MB from SEC — which is the property the whole affordability argument rests on
and the thing the 500 proved was broken.

**Cold-render cost, isolated.** Each figure includes one Vercel SSO redirect, so
the comparison matters more than the absolute:

| | total | of which `getDailyHistory` | note |
|---|---|---|---|
| AAPL (warm, uncached HTML) | 485ms | 12ms (Redis hit) | the baseline |
| IIIN (cold) | 1003ms | 208ms (FMP, cold) | |
| PLPC (cold) | 1020ms | 208ms | |
| FLXS (cold) | 817ms | 409ms | |
| CULP (cold) | 1983ms | 411ms | first request — lambda cold start |

An off-universe symbol pays **two** cold legs, not one: its price history is not
in Redis either. Netting the extra history cost out of IIIN against AAPL leaves
**~320ms for the SEC leg** — fetch, parse, extract, encode, write — which sits
between the p50 (153ms) and p90 (327ms) measured on a runner in §10. The
per-symbol measurement transferred to a lambda.

**On the 5s timeout.** The worst observed cold render was 2.0s *including* a
lambda cold start, so the real headroom is ~2.5x, not the ~15x the p90 suggested.
That is still the right side of the line — the fallback on expiry is a queued
pending page, not an error — but 15x was the wrong number to have quoted.

**Next confirmed the Data Cache prediction verbatim**, once per cold symbol:

```
Failed to set Next.js data cache for
  https://data.sec.gov/api/xbrl/companyfacts/CIK0000723603.json,
  items over 2MB can not be cached (4345527 bytes)
```

3.5MB / 3.9MB / 4.3MB / 4.8MB across the four. This is the predicted behaviour
reported as a warning, not a failure — the response is used, it is simply not
stored twice — and it is bounded at one line per symbol for the life of the
site, because guard 2 means a second render never reaches the fetch.

**And no `Page changed from static to dynamic at runtime` anywhere in the
window.** The three outcomes all landed: `rendered` for a us-gaap filer,
`no-xbrl` for Ryanair (IFRS — permanent, and correctly not pending), `404` for
a string with no CIK.
