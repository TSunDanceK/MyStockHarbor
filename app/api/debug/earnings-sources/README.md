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
    /api/debug/earnings-sources?key=...&sections=refresh
    /api/debug/earnings-sources?key=...&sections=refresh&idxDays=5&condSymbols=1
    /api/debug/earnings-sources?key=...&sections=av&avBurn=1

    # override the symbol set
    /api/debug/earnings-sources?key=...&symbols=ARM,AAPL,MU,PLAB,ASTS

    # supply the SEC User-Agent in the URL (see "Requires" below)
    /api/debug/earnings-sources?key=...&ua=MyStockHarbor%20you@example.com

Default symbols are `ARM,AAPL,MU,PLAB,ASTS` — one mega cap, one mid, two small,
one recent IPO.

## Sections are separately invocable, and that is not cosmetic

| `sections=` | Cost | Default? |
|---|---|---|
| `sec-facts`, `sec-submissions`, `stooq` | free, seconds, idempotent | **yes** (`free`) |
| `datasets` | range-reads a multi-hundred-MB ZIP; can exhaust `maxDuration` | opt in |
| `refresh` | ~40 MB of conditional-request controls + 30 daily-index files | opt in |
| `av` | **spends most of one day's 25-request Alpha Vantage allowance, by design** | opt in |
| `all` | everything | opt in |

Alpha Vantage's free tier is 25 requests/day and section 4 is *designed* to
overrun it, because the brief asks for the exact body of the 26th request. If
that ran by default, every re-run of the free SEC sections would burn a day of
Alpha Vantage — the sections that can be iterated on would become the ones that
cannot. Likewise a `datasets` run that exhausts `maxDuration` would take
sections 1, 2 and 5 down with it for no reason.

## Requires

- **A declared SEC User-Agent**, from either source. SEC's fair-access policy
  requires one carrying a contact address and blocks generic ones; every SEC
  section fails for the wrong reason without it. Roughly
  `MyStockHarbor contact@example.com`.

  - `?ua=<value>` — takes precedence, URL-encoded.
  - `SEC_USER_AGENT` — used when `?ua=` is absent or blank.

  **Why the query parameter exists.** `SEC_USER_AGENT` does not propagate to
  Preview on this project and three redeploys did not fix it, so every SEC
  section returned `403 Request Rate Threshold Exceeded`. **Read that as SEC's
  block for an undeclared agent, not as an actual rate limit** — backing off and
  retrying will not clear it; only a declared agent will. The probe is
  key-guarded and throwaway, so carrying the agent in the URL is an acceptable
  trade here. It would not be in production code.

  No contact address is hardcoded anywhere — **this repo is public**, and an
  address committed here would stay in the history forever.

  The agent is **threaded as a parameter through every SEC call**, never held in
  a module-level variable. A serverless instance is reused across concurrent
  invocations, so a shared mutable agent would let one caller's address be sent
  on another caller's request. The value is also sanitised (CR/LF and control
  characters stripped, capped at 256) — a header value carrying a newline makes
  `fetch` throw, and that throw would surface as "SEC unreachable" rather than
  "your parameter is malformed".
- **`ALPHAVANTAGE_API_KEY`**, only for `sections=av`. Absent, that section
  reports `ok: false` with the reason and spends nothing.

Vercel captures env vars at build time, so adding either one needs a rebuild,
not just a save. The response reports `secUserAgent.source` (`"query"` / `"env"` / `"none"`),
`.set`, `.hasContact`, `.length`, `.sanitized` and a `note`, all describing
**whichever source was actually used** — so `set: true` with `source: "query"`
means the header really was sent. `alphaVantageKey.set` does the same for that
key. **Neither value is ever echoed** — one carries an email address, the other
is a credential, and this output gets pasted around.

`source: "none"` means requests went out with a placeholder carrying no contact
address, and a `403` after that is the undeclared-agent block, not SEC being
down.

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

**`parseCentralDirectory` is truncation-safe**, which it was not at first. It
bounded its extra-field walk by a length read out of the record and never by the
buffer, so the deliberately truncated 64 KB sample 6d feeds it walked off the end
(`RangeError: offset out of range, <= 65534, received 65542`). Both bulk archives
crashed there — which was also the proof that both URLs were right and real bytes
had come back. It now stops cleanly at a partial record and reports `complete`,
so "missing" reads as "not read" rather than "not in the archive".

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
guessed: an archive that predates or postdates the target's filing contains no
rows for it at all, and that emptiness would read as "the axes are not
recoverable" when it only means the wrong month was opened. Override with
`&month=YYYY_MM`.

**The filename is discovered, not constructed.** `2026_05_notes.zip` was built
from a convention and `HEAD` returned `404` — and a `404` on a constructed URL
says only *the pattern is wrong*, nothing about the month, the archive, or SEC.
Stage `0_discovery` fetches SEC's own index pages, extracts every `.zip` href and
reports the real filenames verbatim; the wanted month is matched against those.
When nothing matches, the output carries the months that **do** exist, which is
the answer a second guess would not give.

### The classification step, and why it was rewritten

The 2026-09-13 run returned `resolved 0 of 18` and called it
`NO-GO -- no dimensioned revenue rows on these axes exist`. **Zero of eighteen
resolving is a join-failure signature, not an absence signature**: an irrelevant
axis resolves and is then filtered out as the wrong axis, it does not fail to
resolve. Apple discloses revenue by five product lines and five geographies in
every 10-K, so a result claiming otherwise was far more likely to be the lookup.

Four things changed:

- **No tag pre-filter before the dimension lookup.** The old code collected
  dimension hashes *after* a revenue-tag filter, so the filter decided the answer
  before the evidence was gathered. Every row for the target is now kept — 969
  rows is nothing — and `dimensionedRowsByTag` shows which tags the dimensioned
  rows are actually filed under. `REVENUE_TAGS` survives only as an annotation
  (`isRevenueTag`), never as a gate.
- **The join key is discovered, not assumed.** `num.tsv` and `dim.tsv` need not
  spell the hash column the same way, so the key column is looked up by candidate
  name and `joinKeyColumnUsed` reports which one matched — making the join key
  part of the output rather than an assumption buried inside it.
- **Three fates per hash, not one count.** `not-in-dim.tsv` /
  `resolved-product-axis` / `resolved-geography-axis` / `resolved-other-axis`.
  "Resolved 0 of 18" could not tell a missing key from a wrong axis, and that
  distinction is the entire question. `sampleDimhValuesVerbatim` and
  `sampleDimRowsVerbatim` print both sides of the join verbatim, so a padding,
  case or prefix mismatch is visible at a glance. `segt` is read and reported as
  a distinct-value histogram.
- **Verdict vocabulary.** **`NO-GO` only when dimensions RESOLVED and none carry
  a product or geography axis.** Everything else is `INCONCLUSIVE` with the
  reason named — join key not found, join returned nothing, num.tsv truncated.
  Same rule as section 1's hide list: a lookup that returns nothing is not
  evidence that nothing exists.

**Axis names in `dim.tsv` have the `Axis` suffix stripped** —
`ProductOrServiceAxis` is stored as `ProductOrService`, `StatementGeographicalAxis`
as `Geographical`, `StatementBusinessSegmentsAxis` as `BusinessSegments`. A
classifier matching the full element name sends every hash to "other axis", and
**`axisHistogram` coming back `{}` beside 63 resolved hashes is the tell**.

Nothing strips a literal `"Axis"`. The left-hand side of each `key=value;` pair
*is* the axis, whatever it is called; it is reported verbatim in `axisHistogram`
and anything unmatched is listed in `unrecognisedAxes`. The output is therefore
self-describing for axes nobody anticipated, and it survives SEC changing the
convention back.

**Three breakdowns, not two, and they are not interchangeable.** Apple discloses
geography twice, over different populations:

| Bucket | Axis | Content |
|---|---|---|
| `product` | `ProductOrService=` | iPhone, Mac, iPad, Wearables, Services |
| `operatingSegments` | `BusinessSegments=` | Americas, Europe, Greater China, Japan, Rest of Asia Pacific — the reportable segments, the analogue of the live page's "By region" card |
| `geographical` | `Geographical=` | US, CN, other — the narrower country disclosure |

They are reported separately and **never merged — the percentages do not sum
across them**. `ConsolidationItems=OperatingSegments` rides on the same hash as
the segment rows and is what makes them the segment figures rather than a
rollup, so it is kept and surfaced per row.

**`dim.tsv` has a TSV parsing hazard.** Free-text members
(`InvestmentIdentifier=Senior Secured, Maturity Date September 2029, Prime -
0.05%, … 7.75% Exit Fee;"`) break the column split — one such row turned up
inside `segt`, a column that otherwise only holds `0`. A shifted row **silently
mislabels a dimension rather than failing**, which is the worst shape this bug
could take. So a row is used only if it yields exactly the header's column
count; mismatches are counted in `E_dim.malformedRows` (split by direction, with
verbatim samples), and a wanted hash lost that way gets its own fate,
`malformed-row-in-dim.tsv`, distinct from `not-in-dim.tsv`.

**The anchor outranks the verdict.** `NO-GO` alongside `sanityCheck.passes:
false` is self-contradicting, and worse than no answer because it reads as
settled. When the known-answer check fails the verdict is `INCONCLUSIVE`
carrying the anchor's reason — the extraction is the suspect, not the filing.

One field was also renamed. `undimensionedRevenueRows` counted rows with no
*resolved* segments string, silently merging "carries no dimension" with
"dimension did not resolve" — the two cases this section exists to separate. They
are now `rowsWithNoDimension` and `rowsDimensionedButUnresolved`.

**The pass condition is a known answer, not a non-empty result.** `sanityCheck`
states Apple's actual disclosure (~5 product lines, ~5 geographic segments) and
fails when the extraction cannot see roughly that in a dataset demonstrably
containing the filing — because at that point the extraction is wrong, not the
dataset.

**The default target is `AAPL`, not ARM.** The 2026-09-13 run returned ARM's
forms as `["20-F","6-K"]` with zero 8-Ks — a foreign private issuer, whose
segment disclosures sit differently from the 10-K filers these datasets are
built around. A target with no 10-K now raises
`foreignPrivateIssuerWarning`, so an empty result reads as *wrong filer type*
rather than *the axes are not recoverable*. Override with `&datasetSymbol=`.

Column positions are read from each file's header row, never hardcoded — SEC has
added columns between releases, and a fixed index silently reads the neighbouring
column, which is a wrong number rather than an error.

### `sections=refresh` — the pipeline-shape questions (6a–6d)

Four measurements that decide the SEC → Upstash pipeline's shape. Read-only: no
Redis, no writes, no FMP.

> **The spec was not read.** This section was briefed as answering
> `claude/sec-pipeline-spec-2026-09-13.md`, which is **not in this repo** — not
> on this branch and not on `main`. Nothing here is derived from it; it
> implements the 6a–6d brief text only. See
> `claude/traps/inference-about-a-source-you-cannot-open.md`.

**6a — conditional requests.** SEC's API docs don't mention caching headers, so
both answers are live. **The controls are the point.** A server that echoes
`304` at any validator would produce the result that looks like the best
possible news — "a nightly full-universe verify is nearly free" — while a
corrections failsafe built on it would never fire. So every conditional request
is paired with a negative control that **must** return `200`:

| Request | Meaning |
|---|---|
| `If-None-Match: <real ETag>` | `304` ⇒ supported |
| `If-None-Match: "definitely-not-the-etag"` | **must be `200`**, or the row above is noise |
| `If-Modified-Since: <real Last-Modified>` | `304` ⇒ supported |
| `If-Modified-Since: 1990` | **must be `200`**, or the row above is noise |

Read `steps[]` and check the two `CONTROL` rows before believing
`imsSupported` / `inmSupported`. `verdict` says `UNUSABLE` if a control also
returned `304`. Body bytes are counted from the **decoded** payload, not from
`content-length` — a `304` legitimately carries no `content-length`, so the
header cannot tell "no body" from "header absent". Defaults to 2 symbols
(`&condSymbols=`): each one costs a baseline plus two controls that must return
a full ~4 MB body, and the only per-symbol variation possible is an
inconsistent CDN edge, which two symbols already catches.

**6b — the daily index.** `www.sec.gov` is a **different host** from
`data.sec.gov`; the news probe measured Nasdaq answering everywhere except
`iad1`, so reachability is the question. Three outcomes, kept separate:

- `parsed` — the file was read.
- `absentNoIndex` — **EDGAR published no index that day** (a market holiday or
  weekend). Not a failure.
- `failed` — only this means `www.sec.gov` refused.

**SEC answers `403`, not `404`, for a daily index that does not exist.** Measured
2026-09-13: 20260907 (US Labor Day) returned `403` with a 243-byte body. The
first version keyed the absent bucket off `404`, so it never fired and every
public holiday read as an outage.

A `403` **cannot be classified from its own response** — the same status means
"nothing published that day" and "you are blocked". So it is left provisional
per-day and settled across the whole window:

| Window | Verdict |
|---|---|
| some days parsed, one 403 | `noPublication` → `absentNoIndex` |
| every day 403, none parsed | `blocked` → `failed` |

The discriminator is the **spread**, not anything in the individual response;
body size (a real index is megabytes, a refusal a few hundred bytes)
corroborates but does not decide, and a large-bodied `403` stays `failed`.
`refusalClassification.rule` states which applied — read it before trusting
either bucket.

The quarter in the URL is **derived, not hardcoded**. The brief's example says
`QTR3`, which is right only for Jul–Sep; a 30-day window run in early October
reaches back across the boundary and every pre-October day would `404` for a
reason that has nothing to do with reachability.

**6c — amendment visibility.** Form types are counted **verbatim** — no
normalising, uppercasing or suffix stripping, since the whole question is
whether `/A` survives as part of the string. `master.idx` is a 5-column
pipe-delimited file with **no amendment flag column**, so the layout itself is
the evidence that `/A` can only live inside the Form Type. If
`suffixIsVerbatim` is false, per the brief that means **the pattern is wrong,
not the market** — read `topFormTypes` before building a detector.

**6d — bulk vs per-symbol.** `HEAD` plus a range-read of the ZIP index only.
`zipFormat` reports whether a **classic** 22-byte EOCD or a **ZIP64** record was
found — an archive of ~800k filers cannot be a classic ZIP (entry count caps at
65535, offsets at 4 GB), and reading one as the other gives a silently wrong
`entryCount`.
The archives are gigabyte-scale and are **never downloaded**: `entryCount` — the
number that decides one-download-vs-700-requests — lives in the 22-byte
end-of-central-directory record at the very end of the file. The central
directory itself is sampled at 64 KB rather than fetched whole (at ~one entry
per filer it runs to tens of MB, and the question doesn't need it). **URLs are
probed, not assumed**: SEC has moved these paths, and a `404` on a guessed URL
would read as "no bulk archive exists", so each candidate reports its own
status.

The three sub-probes run **sequentially, not concurrently**. Together they would
put ~10 requests in flight at once against SEC's 10/sec fair-access ceiling, and
a self-inflicted `429` would surface as "www.sec.gov is blocked from iad1" — the
exact false conclusion 6b exists to rule out.

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
