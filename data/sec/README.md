# `data/sec/`

## `company-tickers.json` — the SEED AND FALLBACK, not the source of truth

**A file committed once goes stale, and the dangerous staleness is not absence —
it is REASSIGNMENT.** A delisted ticker later given to a different company makes
a stale map route `companyfacts` at the wrong company under a symbol that still
looks perfectly valid. Absence is loud; reassignment is silent, per-symbol, and
indistinguishable from correct output.

So the live map is refreshed weekly into Redis (`msh:sec:tickers:v1`) by the
daily-index job, and this file is what answers when that fetch fails or has not
run yet. `resolveTickerMap()` always reports which copy answered — `redis`,
`committed-file`, or `none` — and the job surfaces it. A run on the committed
file says so in `tickerMapNote`.

Three defences sit around the refresh, because adopting a bad map is worse than
adopting none:

1. **The payload is validated before it is adopted** — ≥ 5,000 tickers and three
   sentinel symbols present. A truncated response would otherwise read
   downstream as thousands of symbols changing CIK at once.
2. **A CIK change under an existing symbol is an invalidation, not an update.**
   The stored fact set may belong to a different company, so it is discarded —
   `contentHash`, `lastAccession`, `lastFiled` and the amendment state cleared,
   the symbol re-enqueued — and logged with **both** CIKs. A genuine ticker move
   and a reassignment look identical and both need exactly this.
3. **A spike refuses to apply.** Reassignment happens one symbol at a time, so
   more than `max(5, 1% of the universe)` changes in a run means the map source
   changed shape rather than the market doing something unusual. Nothing is
   applied, the previous CIKs stand, and the run reports itself unhealthy.

### Absence is a probable delisting, not a reassignment

A symbol in the manifest but **absent** from a freshly validated map is not
cleared — the committed fallback is smaller than the live map by construction,
so clearing on absence would wipe the store every time the fallback answered.

Instead `notInTickerMapSince` is recorded on first absence and **cleared the
moment the symbol reappears**. After **three consecutive successful refreshes**
still absent, `delisted: true`.

**Counted in refreshes, not runs.** The job runs daily and refreshes weekly, so
counting runs would call a symbol delisted after three *days* against a map
fetched once. The reconciliation is gated on a refresh having actually
succeeded, and skipped entirely when the map came from the committed fallback.

**Nothing is ever deleted.** The flag changes how the page *presents* the
filings — as history rather than as current — not whether they exist. A delisted
company's numbers are not wrong, they are over, and showing them undated is the
actual failure. A delisted issuer can also still file (a final 10-K, a Form 25
or 15), so the daily index keeps matching it.

The **same spike guard** applies, on *newly* absent symbols: above
`max(5, 1% of the universe)` nothing is recorded, no counter moves, and the run
reports unhealthy. A valid-but-partial map — one clearing the 5,000-ticker floor
while still missing thousands of real rows — would otherwise start the clock on
all of them at once and delist them together three refreshes later. Guarding on
*newly* absent rather than on the standing absent set matters: genuinely
delisted symbols stay absent forever, and a guard counting them would jam
permanently after the first few.

`lastModified` and `lastChangedAt` are stored so **how often SEC actually
changes the file** becomes measurable. Weekly is a guess until those accumulate;
a run of `notModified` says weekly is more often than necessary.

## The committed file — PRESENT

SEC's ticker→CIK file, served at
`https://www.sec.gov/files/company_tickers.json`. Measured 2026-09-13 from
Vercel `iad1`: **200, 798 KB, 10,426 tickers**, every probe symbol resolved.

It is committed as a static asset rather than fetched at runtime because it
removes a network dependency from the manifest seed path, and because it is what
lets an unknown ticker **404 before any network call** — the gate that bounds
cold-fetch exposure at 10,426 requests ever instead of at whatever a scraper
asks for.

**Committed 2026-09-13** by the owner: 797,931 bytes, 10,426 distinct tickers,
all five probe symbols resolving. It arrived with a stray `#` at byte 0 — an
upload artifact — which made `JSON.parse` throw; that one byte was removed and
nothing else was touched. `scripts/check-sec-daily-index.mjs` now asserts on
every suite run that the committed file starts with `{`, parses through the
real loader's parser, passes the same validation the refresh applies, and
resolves the probe symbols.

`loadTickerMap()` validates the committed file too, not just the network path —
the `#` failed loudly, but a file that *parsed* while being truncated would have
been adopted silently, and the fallback is the copy that answers when the fetch
fails, which is exactly when nobody is looking. It is **not** tolerated by
stripping junk before the first `{`: a lenient parse reading a corrupted file as
data is the trap this pipeline exists to avoid.

### If it ever needs re-fetching

The agent sandbox is refused `www.sec.gov` with `403 CONNECT tunnel failed`
(re-tested 2026-09-13), so the session that built this could not download it.
**It was deliberately not invented.** Ten thousand fabricated ticker→CIK pairs
would every one of them look plausible and would route `companyfacts` requests
at the wrong company — a silent, total, per-symbol data corruption.

### To add it

    node scripts/fetch-company-tickers.mjs

from anywhere with network access, then commit `data/sec/company-tickers.json`.
The script declares a User-Agent (SEC's fair-access policy blocks generic ones),
validates the shape, and prints the count and a SHA-256 so the run log proves
what it fetched.

Or dispatch the relay — `.github/workflows/relay.yml`, task `company-tickers` —
which runs it on a GitHub runner and attaches the file as a build artifact.

### Until then

`loadTickerMap()` reports `present: false, count: 0`. The manifest seeds every
symbol with `cik: null`, the daily index matches nothing, and both the seed
result and the job summary say so explicitly. Nothing silently reads as "no
filings today".
