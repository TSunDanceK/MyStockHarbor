# Stooq refuses automated access; SEC works. The plan's risk ordering is inverted

Measured 2026-09-12, runs [34697400978], [34697879018] and [34698045649], from a
GitHub Actions runner with an honest identifying User-Agent. No challenge-solving,
no User-Agent spoofing, no headless browser.

## Phase 0's verdict: INCONCLUSIVE, and not for the reason it was built to find

Phase 0 asked whether Stooq adjusts for dividends the way FMP does. It could not
answer, because **Stooq never returned any prices to compare.** All five symbols,
all spellings tried — `ko.us`, `xom.us`, `t.us`, `googl.us`, `brk.b.us`,
`brk-b.us`, `brkb.us` — came back as a JavaScript browser-verification page:

```
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow"></head><body><noscript>
This site requires JavaScript to verify your browser. Please enable JavaScript and reload.
</noscript>
```

**The strict CSV parser is the only reason this was visible.** It rejected the
first response because line one was not `Date,Open,High,Low,Close,Volume`. A
lenient parser would have read HTML as prices and produced ratio figures from
noise — and a methodology verdict would have been reported from them. That is
precisely the failure that put wrong numbers on this site once before, and the
strictness paid for itself on the first symbol of the first run.

**The adjustment question is not answered and is now moot** unless a bars source
is chosen. It was a question about Stooq specifically.

## The access matrix

| Provider | Endpoint | Result |
|---|---|---|
| Stooq | per-symbol CSV, `stooq.com` | JS challenge |
| Stooq | per-symbol CSV, `stooq.pl` | JS challenge |
| Stooq | **bulk archive index, `stooq.com/db/h/`** | **JS challenge** — what Phase 1 needs |
| Stooq | bulk archive index, `stooq.pl/db/h/` | JS challenge |
| Stooq | **archive zip, `static.stooq.com/db/h/d_us_txt.zip`** | **HTTP 401, empty body** |
| Stooq | site root | JS challenge |
| **SEC** | `www.sec.gov/files/company_tickers.json` | **200, 797,931 bytes, real CIK map** |
| **SEC** | `data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json` | **200, 3,789,099 bytes** |
| **SEC** | `data.sec.gov/submissions/CIK0000320193.json` | **200, 164,091 bytes** |

**Stooq 0 of 6. SEC 3 of 3.**

Two details decide the interpretation:

- **The site root is challenged too**, so this is site-wide rather than an
  endpoint or a rate limit. Trying a different Stooq path will not help.
- **The archive zip returns 401, not a challenge.** That is an explicit
  authentication requirement, which reads as bulk download being a
  subscriber service rather than an open one.

### State it precisely: this is not "Stooq is broken"

Stooq works perfectly in a browser. What was measured is narrower and it matters
for the options: **Stooq declines unattended clients from a datacenter IP.** A
GitHub runner is one. That leaves the finding compatible with a residential or
self-hosted runner behaving differently, and it means "Stooq is unusable" would be
an overstatement of the evidence.

### What was NOT done, deliberately

No attempt was made to satisfy, bypass, or fingerprint around the verification —
no browser User-Agent, no forged cookies, and no headless browser to execute the
challenge script, although Chromium is available in the agent environment. A site
serving `noindex,nofollow` plus a verification interstitial, and gating its bulk
archive behind 401, is stating a position on automated collection. Engineering
through that for a commercial site's daily data pipeline is a decision for the
owner and a question about Stooq's terms, not a technical obstacle to route
around.

## What this does to the plan

The build plan's own risk ordering was explicit:

> Bars break the site; fundamentals degrade it. If Stooq lands and SEC has not,
> the fundamentals columns serve the frozen cache — stale but real — while bars
> stay current. That is an acceptable Monday state. **The reverse is not.**

**We have the reverse.** Bars are blocked; fundamentals are clear.

| Phase | Status |
|---|---|
| 0 — adjustment methodology | **Unanswerable.** No data to compare |
| 1 — Stooq ingest | **Blocked.** Nothing to ingest |
| 2 — coverage and fidelity | **Blocked.** Depends on Phase 1 |
| 3 — A5 section diff | **Blocked.** Depends on Phase 1. Its prerequisite is done and holds |
| 4 — the DATA_PROVIDER switch | **Worth building anyway.** See below |
| 5 — SEC fundamentals | **GREEN. Can proceed today** |

**The commercial consequence is the headline.** The migration's purpose was to
replace FMP's $20,000/yr quote with two free sources. SEC can take the
fundamentals half. Bars — which are what actually break the site — have no
replacement identified, so **FMP cannot be dropped on the strength of this
result.** It can at best be reduced.

## What survives, and is worth doing regardless

- **Phase 4's provider switch and the single `FMP_API_KEY` resolver.** 38 reads
  across 37 files routed through one resolver is the prerequisite for any
  provider change, and the next candidate source will need it too. Nothing about
  it was Stooq-specific.
- **The eight-aggregator parity result.** Established independently of any
  provider: on sorted input all eight bucket identically, so a weekly MA200
  change is attributable to data. The unsorted-input requirement stands for any
  ingest.
- **The relay.** Task routing lives in `scripts/relay-run.mjs` so a new phase is a
  dispatch rather than a merge — which is what made three access probes in twenty
  minutes possible instead of three merge round trips.
- **The frozen dump.** Still the comparison baseline for whatever source is
  evaluated next.

## One design note the SEC result already forces

`companyfacts` for AAPL is **3,789,099 bytes parsed** against a
`content-length` of 271,819 — the wire transfer is gzipped, the object is not.
At 700 symbols that is ~190 MB fetched and ~2.6 GB parsed, but the number that
bites is the per-document one: **raw companyfacts must not be stored.** A single
document is a third of Upstash's 10 MB per-request ceiling, so any batch write of
raw facts fails, and the repo's fail-open handlers would swallow the error. The
ingest has to extract the fields it needs and store those.

## Related

- `claude/cached-bars-are-comparison-not-correctness-2026-09-12.md` — the frozen
  bars are ground truth for comparison, not correctness. Unchanged by this, and
  still the rule for whatever source is compared next.
- `claude/traps/inference-about-a-source-you-cannot-open.md` — the shape this run
  avoided: the answer came from measuring the endpoints rather than reasoning
  about what Stooq probably serves.

## Phase 5 ran, and its first version passed a wrong number

Runs [34701164242] (unguarded) and [34701520555] (guarded), 10 mega-caps.

**The unguarded run reported `10/10 extracted, 0 failures, WITHIN THRESHOLD —
dataset usable`. It also emitted `BRK.B: 941,481 shares as of 2011-04-29`.**
Berkshire class B has roughly 1.3 billion shares. That figure is Class A-shaped
and fifteen years stale, and a `marketCap` built on it is wrong by three orders of
magnitude.

The threshold counted **fetches**, so a 200 response became a data-quality claim.
That is the same fail-open shape as the 09-05, 09-07 and 09-10 breaches, produced
fresh, in an ingest written the same day the rule was restated.

### The guarded run

```
BRK.B   REJECTED — stale: share count as of 2011-04-29 is 5616 days old (limit 400)
unusable total   1  (10.0% of attempted)
```

And the magnitude cross-check against the frozen dump corroborates the rest far
more strongly than expected:

| Symbol | shares × last close ÷ frozen FMP marketCap |
|---|---|
| MSFT, KO | **1.000** |
| NVDA | 0.995 |
| XOM, JPM | 0.992 |
| PG | 0.978 |
| GOOGL | 1.011 |
| AAPL | 1.053 |
| JNJ | not run — no frozen pairing, and reported as such |

Ratios at 1.000 say FMP's `marketCap` is itself shares × close on the same share
count. Eight independent agreements is the strongest evidence so far that the
extraction is right where it claims to be right.

### Three things this does NOT establish

- **The multi-class guard is unproven.** It fired zero times. `GOOGL` is genuinely
  dual-class and was *not* flagged, which means either Alphabet reports one
  combined figure or only one class appeared at the newest date. The guard that
  actually caught `BRK.B` was **staleness**. Necessary, not demonstrated
  sufficient.
- **TTM EPS is not always available.** `XOM`'s diagnostic reads *4 rows in the
  unit, 4 with start+end, 2 in a 60–120 day frame* — it files diluted EPS mostly
  in annual frames. So 4-quarter TTM coverage is a property of the filer, not of
  the extractor, and 8 of 9 is the honest figure rather than a bug to chase.
- **Nothing here is in Redis.** The artifact is the deliverable; the write-token
  decision is untouched.

## Phase 5 across the full 700 — run [34703501688], exit code 1

The run **failed deliberately**: 20.6% unusable against a 15% threshold. That is the
gate doing its job, and the three numbers are the deliverable.

### Coverage, against the 700 denominator

| | Count | % |
|---|---|---|
| usable SHARES | 556 / 700 | **79.4%** |
| usable TTM EPS | 485 / 700 | **69.3%** ← the P/E column's coverage |
| neither | 144 / 700 | 20.6% |

**Why the 144 are missing** — 5 fetch failures (`BK`, `EA`, `EQR`, `WBS` have no CIK
in SEC's ticker map; `IBN` errored) and 139 guard rejections: **55 no
shares-outstanding concept**, **52 stale**, **32 magnitude**.

**Why 71 symbols have shares but no TTM EPS:** 49 have **no diluted EPS concept at
all**, 12 have zero quarterly frames, 5 have two, 5 have no `USD/shares` unit. XOM
generalises: this is filer behaviour, and 69.3% is the honest ceiling for a P/E
column built this way, not a bug to chase.

### The magnitude distribution

```
min 0.5000 · p05 0.9701 · p25 0.9957 · MEDIAN 1.0000 · p75 1.0023 · p95 1.0322 · max 1.2471

< 0.90       14  #
0.90-0.95     5
0.95-0.99    57  #####
0.99-1.01   407  #####################################
1.01-1.05    52  #####
1.05-1.10    11  #
> 1.10       10  #
```

**407 of 556 land inside 0.99–1.01.** The core is extremely tight — median exactly
1.0000 — so where the extraction works it agrees with FMP almost exactly.
**Outside 0.95–1.05: 40 of 556, 7.2%.**

### THE BUYBACK HYPOTHESIS IS NOT SUPPORTED

```
389 symbols with both a 4q buyback and a ratio
mean buyback intensity (4q spend / marketCap): 2.45%
PEARSON r(intensity, ratio-1) = 0.0034
heaviest-decile mean deviation -0.79%
lightest-decile mean deviation -0.57%
```

**r = 0.0034 is no relationship at all**, and the heaviest-repurchaser decile
deviates *negatively*. AAPL at 1.0526 carrying the largest buyback in the list
(`8.79e10`) is a coincidence, not a mechanism. **The hypothesis would have been
adopted on that one anecdote had it not been tested.**

### What the tail actually is, and it is better news

The deviations are **multiplicative by identifiable structural factors**, not a
random percentage:

| Cluster | Symbols | Mechanism |
|---|---|---|
| **~0.50 exactly** | `APH` 0.5000, `KEP` 0.5002, `IESC` 0.5031, `SNY` 0.5089, `SOMN` 0.5153, `FMS` 0.5209, `SKM` 0.5561 | a factor of **two** — an unadjusted 2:1 split, or a 2:1 ADR ratio |
| **Foreign annual filers** | `BAP` 1.19, `PBR-A` 1.16, `NOK` 1.16, `IHG` 1.11, `BTI` 1.07, `WIT` 1.06, `SAP` 1.05, `MUFG` 1.05, `RIO` 0.77, `BABA` 0.78, `BUD` 0.91, `ONON` 0.89 | 20-F filers, all with `shares as of 2025-12-31` — up to a year stale, plus ADR ratios |
| **Not common stock** | `TBB`, `SOJC`, `MER-PK`, `PBR-A` | preferred shares and baby bonds; a common-share count over a preferred's price is the wrong instrument |

That matters for the decision: a deviation caused by an **exact integer ratio** is
detectable per symbol — a ratio landing near 0.5 or 2.0 is a split or ADR factor,
not noise — whereas a buyback-driven drift would have needed a blanket tolerance
band. **So the error is boundable, but by classification rather than by a 5%
allowance.**

### The multi-class guard: it got lucky, and its premise is probably wrong

**It fired zero times in 700 symbols.** A 700-name universe certainly contains
several dual-class filers, so zero firings is itself the finding: companyfacts
appears to publish only **undimensioned** facts and to omit the per-class
dimensional breakdown the guard was written to detect. If so the guard *cannot*
fire on class ambiguity, and it establishes nothing about dual-class safety.

`GOOGL` supports that reading. It returned **12,230,000,000 shares**, which is
Alphabet's total across all classes rather than Class A alone (~5.8B) — so there
was no ambiguity to detect, and the ratio of 1.011 is right because FMP's
`marketCap` uses the same total. **Handled correctly by the filer's reporting
choice, not by the guard.**

Stated as inference, not measurement: it rests on the share count matching a total
rather than on reading a class axis — because there is no class axis in
companyfacts to read. **The guards actually doing the work are staleness (52
rejections) and magnitude (32).** Do not rely on the multi-class one.

### Not done, deliberately

No Redis write, no ingest cron, no bars adapter. The artifact remains the
deliverable and the write-token decision is untouched.
