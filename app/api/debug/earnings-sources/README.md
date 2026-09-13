# /api/debug/earnings-sources

Read-only probe for the earnings/fundamentals adapter. **Delete once the adapter
ships and the verdicts are recorded.**

## Why it runs from a preview deployment and not from a laptop

The IP the request comes from is the whole question. SEC and Stooq both treat
datacentre ranges differently from residential ones, and the sibling
`news-sources` probe proved the point from inside this very project: every
Nasdaq feed timed out from `iad1` while answering fine everywhere else. An
answer obtained anywhere other than a Vercel function is not evidence about this
site.

The agent sandbox cannot substitute for it either — `data.sec.gov`,
`www.sec.gov`, `www.alphavantage.co` and `stooq.com` all return
`403 CONNECT tunnel failed` from the proxy, re-confirmed 2026-09-13.

## Usage

    # free, fast, idempotent — the default
    /api/debug/earnings-sources?key=$EARNINGS_BACKFILL_KEY

    # one section at a time
    /api/debug/earnings-sources?key=...&sections=sec-facts
    /api/debug/earnings-sources?key=...&sections=datasets
    /api/debug/earnings-sources?key=...&sections=datasets&month=2026_05
    /api/debug/earnings-sources?key=...&sections=av&avBurn=1

    # override the symbol set
    /api/debug/earnings-sources?key=...&symbols=ARM,AAPL,MU,PLAB,ASTS

Default symbols are `ARM,AAPL,MU,PLAB,ASTS` — one mega cap, one mid, two small,
one recent IPO.

## Sections are separately invocable, and that is not cosmetic

| `sections=` | Cost | Default? |
|---|---|---|
| `sec-facts`, `sec-submissions`, `stooq` | free, seconds, idempotent | **yes** (`free`) |
| `datasets` | range-reads a multi-hundred-MB ZIP; can exhaust `maxDuration` | opt in |
| `av` | **spends most of one day's 25-request Alpha Vantage allowance, by design** | opt in |
| `all` | everything | opt in |

Alpha Vantage's free tier is 25 requests/day and section 4 is *designed* to
overrun it, because the brief asks for the exact body of the 26th request. If
that ran by default, every re-run of the free SEC sections would burn a day of
Alpha Vantage — the sections that can be iterated on would become the ones that
cannot. Likewise a `datasets` run that exhausts `maxDuration` would take
sections 1, 2 and 5 down with it for no reason.

## Requires

- **`SEC_USER_AGENT`**, in Preview. SEC's fair-access policy requires a declared
  User-Agent carrying a contact address and blocks generic ones; all three SEC
  sections fail for the wrong reason without it. Roughly
  `MyStockHarbor contact@example.com`.
- **`ALPHAVANTAGE_API_KEY`**, only for `sections=av`. Absent, that section
  reports `ok: false` with the reason and spends nothing.

Vercel captures env vars at build time, so adding either one needs a rebuild,
not just a save. The response reports `secUserAgent.set` / `.hasContact` and
`alphaVantageKey.set` so an unset value is visible as itself rather than looking
like a network failure. Neither value is ever echoed — one contains an email
address, the other is a credential, and this output gets pasted around.

## Reading the output

### A fetch failure is not an absent field

`companyFacts[].trueHideList` is the answer to the brief's question. It is
`missingOrEmpty` minus the tags whose alternate spelling *is* populated.

Three lists, deliberately kept apart:

- **`missingOrEmpty`** — the briefed tag is absent, or present with zero rows.
- **`missingButAlternateExists`** — absent under the briefed spelling but
  populated under a near-synonym (`CostOfRevenue` vs `CostOfGoodsAndServicesSold`,
  and so on). A spelling difference, *not* a missing number, and hiding these
  would hide columns the data supports.
- **`presentButNotQuarterly`** — the concept exists and has values, but no
  quarterly series. Different problem, different remedy: derive Q4 from FY minus
  9M. `claude/stooq-inaccessible-sec-viable-2026-09-12.md` found XOM files
  diluted EPS almost entirely in annual frames, so this is a property of the
  filer, not a bug.

A symbol whose fetch failed carries `ok: false` and `concepts: null`, and
contributes nothing to any list. That separation is enforced rather than
incidental — the brief says the missing list *is* the hide list, so a single 403
returning a concept report would hide all 21 columns.

Two further things the analysis does that a naive count would not:

- **Duration vs instant concepts are measured differently.** Balance-sheet lines
  carry only `end`, never `start`. Looking for an 80–100 day span on them finds
  zero for every filer, which would put all five on the hide list.
- **Periods are deduped before counting.** `companyfacts` republishes a period
  from every filing that restated it, so counting rows makes depth look better
  the more a filer restates.

### The `acceptanceDateTime` timezone is measured, not read off the suffix

The field looks like `2026-08-05T20:31:22.000Z`. The trailing `Z` asserts UTC;
asserting is not evidence, and the error is asymmetric — reading an Eastern
stamp as UTC moves every filing four or five hours *earlier* and turns
after-close filings into during-session ones, which is exactly the
classification the price-reaction card depends on.

So `acceptanceAnalysis` settles it two independent ways, neither trusting the
suffix:

1. **`hourHistogramFaceValue`** — the clock fields read verbatim out of the
   string, never through `Date.parse()` (which would apply the `Z` and hand back
   the shifted hour, i.e. the assumption under test).
2. **`filingDateRolloverByHour`** — the decisive one. EDGAR assigns the *next*
   business day as `filingDate` to anything accepted after 17:30 ET. So
   `filingDate != date(acceptanceDateTime)` is an observable event with a known
   cause at a known clock time. If the rollover starts at hour 17 read at face
   value, the string is Eastern and the `Z` is wrong. If it starts at 21–22, the
   string is genuinely UTC.

The verdict is **fitted, not scanned**: every candidate offset 0–23h is scored
on how well it explains the observed rollovers, so no single hour decides it.
Two earlier scan-based versions were wrong and both were caught by feeding the
analyser data whose answer was known — ET hour 17 is *mixed* around a 17:30
cutoff rather than rolled over, and the late-filing window *crosses midnight*
once an offset is applied, so an ascending hour scan hits `00` before `22`.

Before trusting `timezoneVerdict`, check the three numbers next to it:
`offsetFit.best.agreement` (want ~1.0), `offsetFit.rolloverObservations` (the
rollover is the *only* discriminator — if it never fired, every offset fits
equally and the section says so), and `offsetFit.tiedWith` (want empty). The
raw per-hour counts are reported alongside.

### The datasets ZIP is range-read, never downloaded

`num.tsv` inflates to gigabytes; buffering it in a function is an OOM crash, and
a crash reports nothing. Instead the last 64 KB is fetched, the ZIP central
directory is parsed out of it, and every entry's exact compressed range and
inflated size is known **without the archive having been downloaded**. Entries
are then range-fetched and streamed through `zlib.inflateRaw`, filtered line by
line, never accumulated.

Stages are reported independently on purpose:

| Stage | What it answers | Cost |
|---|---|---|
| `A_head` | does the month exist, how big | one HEAD |
| `B_centralDirectory` | what is in it, entry by entry, with inflated sizes | ~64 KB |
| `C_sub` | which accession numbers are the target's | small |
| `D_num` | the revenue rows and their dimension hashes | **the expensive one** |
| `E_dim` | `dimh` → the verbatim `segments` string | small |

A and B answer most of the feasibility question in about a second. **If
`stages.D_num.truncated` is set, an empty `productSplits`/`geographySplits` means
NOT MEASURED, not absent** — the verdict string says so itself rather than
leaving the reader to notice.

The month is **derived from the target's own filing dates** via section 2, not
guessed: a "recent" archive that predates or postdates ARM's filing contains no
ARM rows at all, and that emptiness would read as "the axes are not recoverable"
when it only means the wrong month was opened. Override with `&month=YYYY_MM`.

Column positions are read from each file's header row, never hardcoded — SEC has
added columns between releases, and a fixed index silently reads the neighbouring
column, which is a wrong number rather than an error.

### Alpha Vantage signals its limit with HTTP 200

The rate-limit response is a normal `200` carrying an `Information` or `Note`
key instead of data. Anything keying off `res.ok` treats an exhausted quota as a
successful empty response — `claude/traps/return-type-cannot-express-failure.md`
arriving from outside. Every response is classified by **body**, and
`limitBodyVerbatim` is kept uncut, since that string is the deliverable.

### Stooq: the header check *is* the measurement

`claude/stooq-inaccessible-sec-viable-2026-09-12.md` measured Stooq at **0 of 6
endpoints** from a GitHub Actions runner — a JavaScript browser-verification
interstitial on every per-symbol CSV path and on the site root, plus HTTP 401 on
the bulk archive. So the brief's framing of section 5 as "re-confirm only that
the bars exist" is not supported by the evidence; **the expected result is a
FAIL**, and what this actually tests is narrower: whether Vercel's egress IP is
treated differently from a GitHub runner's. Either answer is information.

The first CSV line must equal `Date,Open,High,Low,Close,Volume` **exactly**.
Anything else is a FAIL with the body recorded verbatim and **zero rows
parsed** — a lenient parse is how a challenge page becomes prices, and the
strict check is the only reason the interstitial was ever noticed.

Bars are reported **per quarter, not just as a total**
(`claude/traps/suspicious-uniformity.md`). The price-reaction card needs ±20
trading days around each report date, so a quarter carrying 15 bars where its
neighbours carry 63 is a hole that a passing total would hide completely;
`thinQuarters` names them.

## What it does not do

No Redis reads or writes. No FMP calls. No cache population. **No new npm
package** — the ZIP central directory and DEFLATE streams use `node:zlib` and
`node:stream`, both builtins, so the lockfile is untouched.

Guarded through `guardDebugRequest` like every other debug route, so
`scripts/check-debug-routes-guarded.mjs` stays satisfied.

## Nasdaq

Not probed. It is a measured datacentre block, not a retry candidate — see the
run-1 and run-2 verdicts in `../news-sources/route.ts`.
