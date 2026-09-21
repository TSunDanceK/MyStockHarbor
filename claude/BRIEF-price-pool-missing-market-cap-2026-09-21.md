# NVDA has no market cap in any cached source. Measured on fresh data

**Finding only. No fix proposed, and none should be attempted from this doc
alone** — the cause is unknown and sits in Pickers' cap sourcing, a different
subsystem from the one that found it.

Opened 2026-09-21 out of the /earnings-calendar v1 build, which this blocks. It
is recorded separately because it is not an earnings-calendar problem and should
be prioritised against whatever else Pickers has going on, not against that
build's remaining work.

## The finding

**NVDA is in the 700-symbol analysis universe and carries no market
capitalisation in any of the four cached sources the site holds.**

```
[due-universe] caps assembled: 835 symbols from 4 candidate sources
[due-universe] analysis universe: 700 symbols · 696 with a cap (99.4%)
[due-universe] canaries: NVDA=MISSING AAPL=#1(price-pool.json) MSFT=#4(price-pool.json)
                         GOOGL=#2(price-pool.json) AMZN=#5(price-pool.json) META=#6(price-pool.json)

FATAL: 1 of 6 canary symbols are not in the top 50. Attribution:
  NVDA: in analysis universe=true · has a cap=false (source: none) · never ranked
```

The four sources, in the order `scripts/due-strip-universe.mjs` consults them
(widest first, later sources fill gaps only):

| source | key |
|---|---|
| `price-pool.json` | `msh:price-pool:v1` |
| `screener-fundamentals.json` | `msh:pickers:screener-fundamentals:v1:` |
| `fundamentals.json` | `msh:pickers:fundamentals:v1:` |
| `stockdata.json` | `msh:stockdata:v1:` |

`source: none` means **all four were checked and none priced it**. Every other
canary resolved from `price-pool.json` and ranked in the top six.

**Four of 700 universe symbols carry no cap.** NVDA is one; the other three are
not named by this output and have not been identified.

## It is not staleness — that was tested

| | |
|---|---|
| Step-0 dump | run [35627342399], `step0-ground-truth.yml`, read-only Upstash token |
| Dump size | **26 MB** (25,978,291 bytes) — the previous artifact was ~7 MB |
| Consumer run | relay [35627557686], task `due-strip-universe` |
| Gap between them | minutes |

An earlier attempt against the relay's default frozen dump (run `34690240239`,
months old) failed **identically** — relay [35626598282]. Same symbol, same
`source: none`, same 99.4% coverage figure.

**So the condition reproduces on data read minutes before the run, and has
persisted across a months-long gap.** It is a live state of the production
caches, not a stale artefact.

## It was already documented once, in the same file

`scripts/due-strip-universe.mjs`'s own header records the first occurrence:

> The first run read market caps from `price-pool.json` alone and reported 840
> entries, 0 unparseable and 99.4% universe coverage. Every counter green, and
> the resulting "top 50 by market cap" had NVDA nowhere in it: NVDA is in the
> analysis universe and is one of the six pool entries carrying no usable cap.
> Coverage of 99.4% and "the largest company in the list is missing" are the
> same run.

Reading the other three sources was the response to that. **It did not fix the
NVDA case** — it widened the base from 840 to 835 priced symbols across four
sources and NVDA is still unpriced by all of them.

## Blast radius beyond the strip

- **The screener's default sort is market cap** — `EarningsDayList.tsx` opens on
  `sortKey: "marketCap"`. A symbol with a null cap sorts under nulls-last, so
  NVDA would sit at the bottom of a cap-sorted view rather than the top.
- **`/earnings-calendar`'s due strip cannot ship.** Its top-50 membership list is
  cut by market cap, and the generator refuses to emit a list missing a canary —
  correctly. This is what blocks that build's last item.
- Anything else ranking or filtering on the pool's `marketCap` inherits it. Not
  surveyed.

## What is NOT known

- **Why.** No hypothesis is offered here deliberately. The pool is written by
  the price-pool warm path; whether NVDA is absent from the pool entirely,
  present with a null `marketCap`, or present with a value that `capOf()`
  rejects, has **not** been distinguished.
- **Which other three** universe symbols are unpriced.
- **How long** it has been true beyond "both runs above".
- Whether it affects the live site's rendered figures, or only these cached
  aggregates.

`capOf()` in the generator accepts `marketCap`, `mktCap` or
`marketCapitalization`, any finite positive number — so a shape mismatch is
possible but unconfirmed.

## Reproducing it

```
step0-ground-truth.yml                          -> fresh dump, read-only token
relay.yml  task=due-strip-universe  run_id=<id> -> prints the canary line
```

The canary line prints on every run, pass or fail, so the state is visible
without waiting for a failure.
