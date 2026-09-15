# SEC → Upstash fundamentals pipeline — design + probe additions (2026-09-13)

Answers three requirements from the owner, 2026-09-13:

1. read SEC, store in Upstash, don't hammer it — the data only moves quarterly
2. a failsafe on corrections: a re-read that confirms nothing has moved
3. derive the next report due date, so cache lifetime follows the filing calendar

Two of the three depend on facts nobody has measured yet. Those are §5, and they are cheap
additions to the probe that is already built and deployed.

---

## 1. The shape: event-driven, not polled

The instinct "refresh quarterly" is right about the *data* and wrong about the *schedule* —
700 symbols do not report on the same day, so a quarterly sweep is either 700 wasted reads
on 88 days out of 90, or a symbol sitting wrong for weeks after it reports.

**SEC publishes a change feed, and it is one request.**

```
https://www.sec.gov/Archives/edgar/daily-index/YYYY/QTRn/master.YYYYMMDD.idx
   → CIK | Company Name | Form Type | Date Filed | Filename
   → every filing by every filer, that day
```

One fetch a day, intersect the CIK column with your universe, and you know exactly which
symbols moved. **Measured 2026-09-13: reachable from `iad1`, layout stable across every day
sampled, and it correctly surfaced a PLAB 10-Q and two ARM filings from the target set.**

**One trap found in the same run: a day with no index answers `403`, not `404`.** Labor Day
2026 returned a 243-byte 403. So a naive detector alarms on roughly ten days a year, and the
day it is genuinely blocked looks identical to Christmas. Separate them two ways — a small
403 body on a known US market holiday is expected, and a real block fails *every* day rather
than one, so the other days succeeding is itself the evidence.

Everything else follows from that:

| Clock | Source | Frequency | What it decides |
|---|---|---|---|
| **Change** | daily index | 1 req/day | *which* symbols need re-reading — this is correctness |
| **Truth** | `companyfacts` per symbol | only on an event | the numbers themselves |
| **Expectation** | next report date (§4) | display + scheduling | what the page says, and when to start watching |

Request budget against SEC's 10/sec ceiling:

```
Quiet week      1 + 0–5 requests/day
Earnings season 1 + 40–60 requests/day   (700 symbols × 4 reports ÷ ~45 busy days)
Full backfill   700 requests ≈ 70 seconds at the limit, or one nightly bulk ZIP
```

Nowhere near the limit on any day of the year. The ceiling is not a constraint at this
scale; the reason to be event-driven is correctness and headroom, not rate-limit avoidance.

**And the change detector's cost is flat.** One daily-index fetch covers every filer in the
United States. Intersecting its CIK column against 700 symbols or 10,000 costs exactly the
same one request — the work scales on the *fetch* side, never the *detect* side. That
matters more than it first looks, because the earnings pages are not limited to the
analysis universe (§7).

**Be honest about the Redis side.** Replacing `fundamentalsCache`'s 755 hourly per-symbol
`SET`s (~550k writes/month) with ~10–250 writes/day is a real reduction in command count —
but the total bill is $3.83/month, so the money saved is pennies. The argument is latency,
headroom and not re-writing 700 unchanged blobs an hour. **Do not repeat this as a cost
saving.** `lib/server/redisBandwidth.ts` is already a documented case of a comment
overstating which meter binds and mis-steering decisions for weeks.

---

## 2. Storage shape

**One key per symbol holding the whole extracted fact set.** Not per-field keys — the
precedent is already in the tree at `historyCache.ts:150`: *"700 GETs is 700 billed
commands, where 18 chunked MGETs are 18."* A page render should be one `GET`.

```
msh:sec:facts:v1:<SYM>     the extracted fact set, one blob
msh:sec:manifest:v1        symbol → { cik, lastAccession, lastFiled, contentHash,
                                      nextExpected, nextExpectedSource, verifiedAt,
                                      needsReverify }
```

The manifest is a **registry of what is tracked, not a copy of the analysis universe** — it
grows as symbols are visited (§7). The daily job reads it once, diffs against the index,
and writes back once. That is 2 commands a day plus one `SET` per symbol that actually
filed, whatever the registry's size.

At a few thousand entries the manifest is still one modest key; if it outgrows that, chunk
it the way `historyCache.ts` already chunks, rather than splitting it into per-symbol keys
and reintroducing the fan-out this design exists to remove.

It is also the natural feed for the cache-health page, and the thing to inspect when a
number on the site looks wrong.

**Store provenance with every fact set**: the accession number and `filed` date the values
came from. Without it a change can be detected but not attributed, and "the number moved"
is a much less useful alert than "the number moved because 10-Q/A 0001234-26-000123
restated Q2".

---

## 3. The corrections failsafe — three layers

Restatements are the real risk, and they are quiet. `companyfacts` republishes a period
from every filing that restated it, so a historical quarter can change months after the
fact and nothing about the fetch looks different.

### Layer 1 — amended filings, from the same one request

`/A` forms in the daily index are the restatement signal: `10-K/A`, `10-Q/A`, `20-F/A`.
Free, same fetch, same day. **Confirmed 2026-09-13: `/A` appears verbatim on the Form Type
string, 1,225 amended filings across four days.**

**One thing not to over-promise:** an 8-K **Item 4.02** ("non-reliance on previously issued
financial statements") is the purest restatement signal there is, but the daily index
carries form type only — **no item numbers**. You cannot see 4.02 from the index. Filtering
on all 8-Ks instead would be noise, since large caps file them constantly. In practice a
4.02 is followed by an amended 10-K or 10-Q, which Layer 1 catches on its own; treat 4.02
detection as a nice-to-have off the per-symbol `submissions` fetch that an event triggers
anyway. **And it does not exist at all for foreign private issuers — ARM has filed zero
8-Ks ever.**

### Layer 2 — content hash, so a silent move is still visible

**This is the mechanism, not a nicety** — see Layer 3: SEC offers no validators, so there is
no cheaper question to ask.

Store a hash of the extracted fact set. Any re-read compares it. A hash change with no
corresponding filing event is exactly the case Layer 1 cannot see, and the only way to
notice it is to have written down what you had.

When it fires, **do not silently overwrite**. A restatement changes charts that have
already been published — the growth lines, the margin series, the yearly pattern. Record
what changed, which periods, and from which accession. The site is allowed to update; it is
not allowed to update without a trace.

### Layer 3 — the rolling re-read the owner asked for

**MEASURED 2026-09-13 — the cheap branch is gone.** `companyfacts` offers neither
`Last-Modified` nor `ETag`, so there is nothing to send back and conditional requests are
not available at all. See `claude/probe-results-pipeline-2026-09-13.md`.

So every verification costs a full payload. Wire sizes, gzipped, are what bandwidth follows:

```
ARM 50.8 KB · AAPL 271.8 KB · PLAB 224.7 KB   (parsed: 0.7–4.1 MB, ~14× compression)
700 symbols × ~250 KB        ≈ 175 MB per full sweep
rolling 1/30th per night     ≈ 6 MB/day, ~23 symbols/night
```

Affordable either way, but a **rotation, not a nightly sweep** — there is nothing to gain
from checking daily. Every symbol verified monthly.

The *parsed* size is the one that governs function memory on a cold render; 4 MB for MU is
the figure to design the queue-and-drain around.

This is also why **Layer 2 is load-bearing rather than optional**: with no validators there
is no cheap "has this changed?" to ask, so the stored hash is the only way a silent
restatement is ever noticed. Layer 1 still keeps the site correct day to day.

---

## 4. Next report date — and why it must not be a TTL

Three sources, ranked, and the page should say which one it used:

1. **The company's own announcement.** *"X to report Q3 results on 4 Nov"* arrives on the
   GlobeNewswire and PR Newswire feeds **already probed and PASSed on 2026-09-13**. The
   news adapter is fetching these anyway — emitting an earnings-date event from the same
   fetch costs nothing. Exact, free, no new vendor.
2. **Alpha Vantage `EARNINGS_CALENDAR`.** One request covers the whole market. Free tier,
   subject to the licence question still open.
3. **Derived from cadence.** Same fiscal quarter last year's filing date plus the median
   drift. Within a few days for most large caps.

When it comes from (3), **label it hedged** — *"expected early November"*, not a false
precise date. Consistent with the house style on market copy.

Note from the probe: fiscal year ends across five symbols were 31 Mar, 26 Sep, 3 Sep,
31 Oct and 31 Dec. **Nothing may assume calendar quarters.**

### The date schedules work. It does not expire data.

**A TTL means eviction means a cold key means a page render that has to go and fetch.**
That is the failure mode the project has already hit — `claude/pool-ttl-died-behind-the-
market-gate-2026-09-02.md` is the same lesson from a different direction.

So the next-report date sets a **`needsReverify` flag in the manifest**, not an expiry on
the data:

```
nextExpected + 21 days passes, and no filing seen
   → manifest.needsReverify = true
   → the daily job puts that symbol at the front of the queue
   → the fact blob stays resident and keeps rendering the whole time
```

Stale-but-present beats expired-and-absent every time on a page that has to render for a
crawler. Nothing in Redis should ever expire out from under a render.

---

## 5. What had to be measured before any of this was built

**All four were added as `sections=refresh` and run on 2026-09-13.** Results in
`claude/probe-results-pipeline-2026-09-13.md`; summarised here because they changed the
design above.

| | Question | Answer |
|---|---|---|
| 6a | Conditional requests on `companyfacts` | **No validators at all.** Rotation, not nightly. |
| 6b | Daily index reachable from `iad1` | **Yes**, layout stable. Holidays return 403, not 404. |
| 6c | Does `/A` survive verbatim | **Yes**, 1,225 amendments over 4 days |
| 6d | Bulk archives for the cold start | **Inconclusive** — crashed in our own ZIP parser |

6d is the only one still open, and it failed in our code rather than at SEC: two candidate
URLs returned a `RangeError` while parsing the central directory, which means bytes came
back and those paths are the correct ones. One bug fix and a re-run.

---

## 7. The universe is unbounded — and mostly that is free

**Correction from the owner, 2026-09-13: `/stock/<SYM>/earnings` is not limited to the
analysis universe.** Any ticker can be requested, and one that has never been seen must
fetch on request rather than render empty.

Good news first: **§1 already survives this.** The daily index is one request whether you
track 700 filers or all ~10,000, so the correctness mechanism needs no change at all. Only
three things do.

### 7a. Three tiers, selected by attention

Grounded in `claude/tiering-freshness-follows-display-2026-09-01.md`, whose principle
carries over directly: **attention, not market cap.** `track/ticker-interest` is already
recording which symbols people actually view.

| Tier | Membership | Behaviour |
|---|---|---|
| **A** | the analysis universe | resident, event-driven, never evicted |
| **B** | every symbol visited at least once | resident, event-driven, **not evicted** — see §7f |
| **C** | never seen | nothing stored; fetch on first request |

Worth naming why this does *not* repeat the failure recorded in that doc, where tiering by
display collapsed because the picker's "Show more" control made the result set equal to the
universe. Here the tail is real: there are roughly ten thousand US filers and only a
fraction will ever be visited, so Tier B stays meaningfully smaller than Tier C. The
distinction survives contact with the page rather than only with its data model.

### 7b. Symbol → CIK for any ticker, and the abuse guard is the same file

Every SEC call is keyed by CIK, so an unbounded universe needs the full mapping, not 700
rows.

**CORRECTED 2026-09-13.** An earlier version of this section said to commit
`sec.gov/files/company_tickers.json` as a static file *because it 403s from Vercel*. It does
not: with a declared User-Agent it returns **200, 798 KB, 10,426 tickers**, all symbols
resolved. The news probe's 403 was the undeclared-agent fair-access block, the same one that
made every SEC call fail earlier that day.

Commit it anyway — but for the reason below, not that one. A justification that is wrong
gets quietly discarded the first time someone tests it.

**It is also the gate.** An unknown ticker must 404 *before* any network call — no SEC
request, no Redis write, nothing. A lazy-populate endpoint keyed off a URL path is
otherwise an open invitation to trigger unlimited fetches by walking made-up symbols.

### 7c. Lazy population — reuse the news rule verbatim

From `claude/news-adapter-spec-2026-09-13.md`, unchanged: **lazy population on first visit.
Never a warm cron. Do not add it to `vercel.json`.** A symbol enters Tier B by being asked
for, not by being anticipated.

Two guards on the cold path, and the first one is not hypothetical:

- **The crawler case is the likely load event, not an edge case.** These pages are built to
  be crawlable and SEO is an active project workstream — so Google discovering thousands of
  cold earnings URLs is something to expect, not to hope against. The cold path queues and
  drains rather than fetching inline; §7f is the full treatment.
- **A cold render must never fan out.** One symbol, one `companyfacts` call, extract, store
  the small blob, discard the raw. If the extraction ever needs more than one upstream
  request per symbol, that is a design change and wants deciding explicitly.

### 7d. The one number that decides the cold-render experience

`companyfacts` for a mega-cap is a large JSON document, and fetching it synchronously
inside a page render is a latency problem the analysis universe never exposes you to,
because those symbols are always warm.

**MEASURED 2026-09-13: 720 KB parsed for ARM, 3.8 MB for AAPL, 4.1 MB for MU** — against
50–270 KB on the wire. Large enough that an inline fetch inside a render is not something to
do casually; the queue-and-drain design in §7f handles it.

Do not switch to `companyconcept` per tag to shrink it: that trades one request for
twenty-one, against a 10/sec ceiling, to save bytes that are not the constraint.

### 7e. On the display-licence point — agreed, with one loose end

The reasoning holds: no live quote means no exchange display licence question, which is
consistent with the finding in `claude/fmp-exit-options-pickers-2026-09-12.md` that
end-of-day and older data carries no exchange licensing burden. Filings are public domain
on top of that, so this page is the cleanest licensing position on the whole site.

**But the page is not price-free today.** The live ARM page's own title reads:

```
ARM Earnings, EPS & Revenue — Price $264.79 | MyStockHarbor
```

So a price is rendered, in the `<title>` and presumably the meta description. Worth
settling which source feeds it before assuming the licence question is closed here:

- if it comes from the 15-minute FMP price pool, it leaves when FMP does and the title
  needs a replacement source
- if it is the last close, it is fine on every count — but per that same tiering doc's
  rule, **the page must say so** rather than presenting a close as a current price

Small loose end, cheap to check, and exactly the kind of thing that is easier to settle now
than after the switchover.

## 7f. The abuse and cost model — raised by the owner, 2026-09-13

The concern is right, and working it through changes two of the recommendations above. The
useful move is to separate two costs that look identical from the outside.

### Cost 1 — cold population. Bounded, one-off, and small.

**The allowlist makes the exposure finite, and that is the whole argument.** There are
**10,426** US tickers in `company_tickers.json` (measured, not estimated). An unknown symbol
404s before any network call, so *no amount of traffic can trigger more than ten thousand
distinct cold fetches, ever.* Walking made-up symbols costs an attacker effort and costs you
a string comparison.

Worst case, priced:

```
10,426 symbols × 1 companyfacts fetch                  = 10,426 SEC requests, once
10,426 × (1 SET blob + 1 manifest update)              = ~21,000 Upstash commands
21,000 / 100,000 × $0.20                               = $0.04
10,426 × ~20 KB extracted blob                         = ~200 MB storage
                                            (against 185 MB used of a 100 GB limit)
```

Four pence and 200 MB, once, for the entire investable universe. That is the ceiling.

### Correction to §7a: do not evict

**An LRU cap is what turns that one-off into a treadmill.** A scraper cycling through more
symbols than the cap re-triggers the fetch every pass, forever — which is precisely the
unbounded bill the owner is worried about, and it would be self-inflicted by the eviction
policy rather than by the traffic.

Storage on this plan is effectively free; re-fetching is what costs. So **keep everything,
evict nothing.** After the first pass the cold-fetch curve goes to zero and stays there.
Revisit only if stored fundamentals approach a meaningful fraction of 100 GB, which at
20 KB a symbol they never will.

Related discipline: **never store raw `companyfacts`.** Extract, store the small blob,
discard the document. Ten thousand raw payloads is tens of gigabytes; ten thousand
extracted ones is a rounding error.

### Cost 2 — traffic. Unbounded, but not new, and not this page's fault.

A million scraped page views is a million Vercel invocations and roughly two million
Upstash reads — about $4 of Redis plus Vercel compute and transfer. **That is generic
traffic abuse, identical on every page already live.** The earnings page does not create
that exposure and cannot fix it; the WAF is what addresses it, and one is already running.

The genuinely new risk is narrower and worse than money: **an unthrottled fan-out to SEC
could get the declared User-Agent rate-limited or blocked.** Losing SEC access is losing the
data source. That is the thing to design against.

### The structural fix: decouple arrival rate from fetch rate

**A cold render must never fetch synchronously.** It writes a pending marker, enqueues, and
renders the honest not-yet-available state. A drain job populates at *your* chosen rate.

Once that holds, request volume cannot translate into upstream request volume at all — a
scraper hitting a million cold URLs produces a queue, not a million SEC calls, and the queue
drains at whatever rate you set regardless of how fast it filled. This is the single control
that makes the SEC risk go away rather than be managed.

**Cache the miss, or one symbol becomes unbounded writes.** The first miss writes the
pending marker; the thousandth hit on that same cold symbol is then a read, not another
enqueue.

### On rate limits — a warning from your own record

Two documented incidents say be careful here. `claude/firewall-asn-audit-2026-08-31.md`
records the standing lesson: **a deny rule has no feedback loop** — the people it blocks
cannot tell you, because they cannot reach the site. It also records that a rate limit on
`/insights/videos` 403'd a real user on 2026-07-21, that the risk was written down at the
time, and that *"writing down that something is dangerous does not stop it."*

So the order of preference for these pages:

1. **Make the cold path cheap** — allowlist gate, no eviction, queue-and-drain. A design
   that survives abuse beats a rule that tries to detect it.
2. **Challenge, not Deny**, for anything ambiguous touching this route — per that audit's
   own conclusion.
3. **A per-IP cold-*enqueue* cap rather than a request cap.** Capping enqueues protects the
   upstream without 403ing anybody; capping requests is the thing that has already misfired
   twice.

### Googlebot is the special case, and it is traffic you want

Crawling is the point of these pages, so it must not be rate-limited into failure — but a
cold crawl must not get a shell indexed either. SEO recovery is an active workstream and a
thin page in the index is worse than no page.

For a symbol that has not populated yet: render the prepared state with **`noindex` until
the data lands**, then let the next crawl pick up the real page. The crawl becomes the
populate trigger, drained at your rate, and nothing empty enters the index.

### Instrument it from day one

Cold misses, enqueue depth, drain rate, and distinct symbols seen per day. Report **zero
separately from absent** — a quiet day and a broken counter look the same otherwise, which
is a distinction the jobs table and the Signals column have both needed before.

## 7g. The runtime shape — three jobs, one queue

Restated by the owner as "a slow background request populating and keeping the universe up
to date". That is right, but it is **two jobs with different shapes**, and separating them
is what keeps the design small.

| Job | Shape | Frequency | Producer of work |
|---|---|---|---|
| **Backfill** | slow drain of a queue | one-off, then idle | seeded with the analysis universe |
| **Daily index** | *one* request, intersect, enqueue | 1×/day, forever | whichever symbols filed |
| **Verify sweep** | full re-reads (§3, Layer 3) | 1/30th nightly | the corrections failsafe |

The keeping-up-to-date job is not a slow sweep — it is one request a day. The slow sweep is
only the initial backfill, and later the verify backstop.

**And all three feed the same queue.** Three producers, one drain:

```
producers                              queue                drain
─────────                              ─────                ─────
backfill seed (the universe)     →
daily-index hit (symbol filed)   →   msh:sec:queue:v1   →   N symbols/min, rate you set
lazy request (cold symbol)       →                          → fetch, extract, store, mark
needsReverify flag (§4)          →
```

Which means **the lazy fetch-on-request path is nearly free to build.** Once the backfill
drain exists, a cold request is just a fourth producer pushing onto the same queue. No
second mechanism, no separate rate control, no parallel code path to keep in step.

It also means one dial governs every upstream call the site makes to SEC: the drain rate.
That is the number to set conservatively and raise once it has been watched.

## 7h. SEEDING ONLY HAPPENS INSIDE THE DAILY-INDEX JOB — added 2026-09-15

**A merge that changes what the universe seeds does not take effect until the
next run of that job.** `seedManifest` is called from
`/api/jobs/sec-daily-index`, once a day at 04:00, and nowhere else.

Observed: #455 uncapped the seed to `PRESET_UNIVERSE ∪ readDynamicUniverse()`
and merged at ~04:20 on 2026-09-15 — twenty minutes after that morning's cron
had run at 04:00:16. The manifest therefore sat at the OLD 696 symbols all day,
and nothing anywhere said so: the job had succeeded, the code was correct, and
the only symptom was a universe count that did not match the code. It needed a
manual dispatch to reseed (696 → 759, `seededThisRun: true`,
`datesConsidered: 0`, watermark untouched, 3 commands).

**The consequence to remember:** a change to the seed and a change to what reads
the manifest can land in the same merge and take effect a day apart. Anything
verified against the manifest in the window between is verified against the
previous day's universe.

A manual `GET /api/jobs/sec-daily-index?key=…` reseeds without walking any dates
— it is idempotent, adds only, and leaves the watermark alone.

### And a stale ticker the reseed surfaced

`symbolsWithoutCik` after the reseed was `BRK.B, BK, EA, EQR, WBS`.

- **BRK.B** was the spelling defect, fixed 2026-09-15 (the universe writes a
  dot, SEC's exchange file a dash, and `seedManifest` bridged neither).
- **BK is a RENAME, not a delisting.** Bank of New York Mellon trades as **BNY**
  now; SEC's file lists CIK 1390777 under `BNY` and `BNY-PK`, and carries no
  `BK` at all. This is the `reconcileDelistings` "retickered" case — the CIK is
  live under another ticker — and it is the same shape as the MMC→MRSH and
  FI→FISV hand-edits already recorded in `presetUniverse.ts`.
- **EA, EQR and WBS** are absent from SEC's `company_tickers_exchange.json`
  under any spelling. Unexplained; not investigated. They came from the dynamic
  pool rather than the preset list, so nothing guarantees them a page.

---

## 8. Build order, once the probe answers

1. **Manifest first, empty.** One key, the shape in §2. Everything else reads and writes it.
2. **Daily index job.** One fetch, intersect, write the manifest. No `companyfacts` calls at
   all in step 2 — prove the change detector works before wiring it to anything. Include
   6-K and 20-F in the periodic set, or foreign private issuers never update.
3. **Per-symbol fetch on event**, writing the fact blob and the content hash. The tag
   resolver and the YTD cash-flow differencing both live here — see
   `claude/hide-list-verdict-2026-09-13.md`, which is not optional reading for this step.
4. **Backfill**, at whatever cadence 6d makes sensible, filling from the bottom of the
   universe up so the most-visited symbols land first.
5. **Layer 3 sweep**, 1/30th nightly.
6. **Next-report date** off the wire feeds, with the cadence fallback and hedged labelling.
7. **The committed ticker→CIK file and the 404 gate**, before the lazy path opens — the gate
   is what keeps an unbounded endpoint from being an unbounded cost.
8. **Lazy population on first visit** — pending marker, enqueue, drain at a rate you set.
   Never a synchronous upstream fetch inside a render. §7c and §7f.

All of it behind the same env-switched provider interface as the news adapter
(`FUNDAMENTALS_PROVIDER = "sec" | "fmp"`), FMP adapter left compiling in the tree. The
flick-back requirement is unchanged.

**Step 2 is the whole idea, and it is one request a day.** If it works, everything above it
is plumbing.
