# /api/debug/static-profile

One-off capture route. **Delete once the fields are committed** — same as the
`news-sources` probe that used to sit beside it (deleted at step 7, once its
verdicts were spent — this route goes the same way once the capture is in).

## Why it exists

`data/static-profile.json` snapshots the static company facts so the site keeps
a sector, an industry and a profile panel after FMP is decommissioned. Sector
and industry cost nothing: the Step 0 dump already carried them, 100% populated
for 2,619 symbols.

Eight fields had no cached copy anywhere — `exchange`, `country`, `ipoDate`,
`isin`, `cusip`, `website`, `ceo`, `employees`. They live only behind
`/stable/profile`, one call per symbol, which needs `FMP_API_KEY`.

**That key is deliberately not reachable from the capture pipeline.** The agent
sandbox is refused `financialmodelingprep.com` outright (403 CONNECT), and
`relay.yml` carries no FMP credential on purpose: this repository is public and
forkable, and the credential split there is a security property. Widening it for
eight cosmetic fields on a provider being decommissioned is the wrong trade.

Production already holds the key. So the capture happens where the key already
is, and **no new credential is created anywhere.**

## Usage

    /api/debug/static-profile?key=$EARNINGS_BACKFILL_KEY
    /api/debug/static-profile?key=...&offset=250&limit=250

Paged because ~700 symbols × 8 fields does not fit one comfortable paste, and
because the function has a 300s ceiling against a metered upstream. Walk
`offset` until `done` is `true`. Each page is a complete JSON object.

Paste each page's `rows` object into `data/.wire/static-profile-extra-<page>.json`
and run `scripts/static-profile-expand.mjs`.

## What it does not return

- `sector`, `industry` — already snapshotted, free
- `marketCap`, `beta`, 52-week range, dividend — **readings, not facts.** A
  frozen reading puts a stale number on a live page, which is worse than an
  absent row because a reader cannot tell it is stale. These keep coming from
  the price pipeline.
- `description` — not a staleness question. Every other field is a fact; the
  description is FMP's authored prose. The 10-K Item 1 business section is the
  candidate replacement, reachable through the step-5 SEC adapter.

## Cost

One metered FMP call per symbol, paced through `reserveFmpCallSlot()` like
everything else, so it stays under `FMP_SAFE_CALLS_PER_MINUTE` (200, against a
300 plan ceiling) and does not starve the crons sharing the budget. A full
~700-symbol capture is three pages and a few minutes.
