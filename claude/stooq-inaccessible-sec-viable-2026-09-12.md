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
