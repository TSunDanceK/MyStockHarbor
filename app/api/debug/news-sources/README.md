# /api/debug/news-sources

Read-only probe supporting the FMP news exit. Delete once the adapter ships and
the verdicts are recorded.

## Why

FMP quoted $20K for a commercial licence, so the news path has to move to free
sources. The candidates all answered when probed from outside Vercel — but the
IP the request comes from is the part that matters. SEC and Nasdaq both treat
datacentre ranges differently from residential ones, so an answer obtained
somewhere else is not evidence about this site. This route settles it from
inside a real function before any adapter is written.

## Usage

    /api/debug/news-sources?key=$EARNINGS_BACKFILL_KEY
    /api/debug/news-sources?key=...&symbols=MU,PLAB,ASTS

Default symbols are deliberately weighted to the thin end of the universe —
tail coverage is the risk, not the megacaps.

## Requires

`SEC_USER_AGENT`, in **both** Production and Preview. SEC's fair-access policy
requires a declared User-Agent carrying a contact address and blocks generic
ones; the two `sec.gov` probes will fail for the wrong reason without it.
Format is roughly `MyStockHarbor contact@example.com`. Vercel captures env vars
at build time, so adding the variable requires a rebuild, not just a save.

The response reports `secUserAgent.set` and `secUserAgent.hasContact` so an
unset or malformed value is visible in the output rather than looking like a
network failure. The value itself is never echoed — it contains an email
address and the output gets pasted around.

## What it does not do

No Redis reads or writes. No FMP calls. No cache population. No new npm package
— the XML is parsed with regexes because the lockfile cannot be regenerated
from the agent sandbox, and a probe only needs field names and counts, not a
correct tree.

Guarded through `guardDebugRequest` like every other debug route, so
`scripts/check-debug-routes-guarded.mjs` stays satisfied.

## Reading the output

Per source: `verdict` (PASS/FAIL), HTTP status, content-type, bytes, latency,
item count, `oldest`/`newest` pubDate with `spanDays`, every distinct field name
across the first ten items, and a sample first item.

Three things worth looking for specifically:

- **`nasdaq:tickers`** on the per-symbol and category feeds — this is the
  per-symbol targeting that was assumed to need FMP.
- **`media:credit`** on the MarketWatch feed — observed reading
  "Sean Rayford/Getty Images", which is the image-permission deny signal the
  art cascade keys off, available before fetching any image bytes.
- **`sicDescription`** on the SEC submissions response — a free sector label,
  worth comparing against the current taxonomy.

A FAIL on `news.google.com` settles whether the existing Google News RSS
fallback in `lib/stock-news-data.ts` is a live source or dead code.
