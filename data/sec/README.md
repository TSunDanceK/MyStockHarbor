# `data/sec/`

## `company-tickers.json` — NOT YET COMMITTED

SEC's ticker→CIK file, served at
`https://www.sec.gov/files/company_tickers.json`. Measured 2026-09-13 from
Vercel `iad1`: **200, 798 KB, 10,426 tickers**, every probe symbol resolved.

It is committed as a static asset rather than fetched at runtime because it
removes a network dependency from the manifest seed path, and because it is what
lets an unknown ticker **404 before any network call** — the gate that bounds
cold-fetch exposure at 10,426 requests ever instead of at whatever a scraper
asks for.

### Why it is missing

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
