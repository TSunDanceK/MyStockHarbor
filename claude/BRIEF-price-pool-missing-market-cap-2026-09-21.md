# NVDA has no market cap in any cached source. Measured on fresh data

> ## MEASURED 2026-09-21. THE HEADLINE WAS WRONG, AND THE REASON MATTERS
>
> **Three of the four sources DO carry NVDA's market cap. The consumer could not
> see them.** `fundamentals.json` prices 699 of the 700 universe symbols,
> NVDA among them. Nothing was missing from the data; the reader was reading
> the wrong key.
>
> The original text below is left unedited, because the shape of the mistake is
> the useful part: every counter in the run was green, the coverage figure was
> precise to one decimal place, and the conclusion drawn from it —
> *"NOTHING IN THE STEP 0 DUMP PRICES NVDA"* — was confidently false.
>
> The measurement pass is in **"What the measurement found"** at the foot of
> this doc. Still no fix. Read that section before acting on anything above it.
>
> **UPDATE 2026-09-22: causes 1 and 3 are now fixed, cause 2 is not.**
> `entriesOf()` in `scripts/due-strip-universe.mjs` now checks
> `.value ?? .values ?? doc` (cause 1), and a new `canonicalOf()` resolves
> every source's ticker spelling through `lib/symbolSpellings.mjs` before
> the cap lookup (cause 3, the BRK.B/BRK-B split). Both committed on
> `claude/pricepool-cap-gap` (f2ab28c, 5bf63b8), PR #505. Cause 2 (the
> price-pool partial-write pattern) is still open; see its section below
> for a candidate mechanism found by reading the writer, unverified.

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


---

# What the measurement found

Measured 2026-09-21 by `scripts/pricepool-cap-gap-probe.mjs`, relay task
`pricepool-cap-gap`, against the same fresh step-0 dump (run `35627342399`).
Four dispatches: [35631103914], [35631353569], [35631581348], [35631829246].

**Measurement only. No fix applied, and `scripts/due-strip-universe.mjs` was
deliberately untouched** *(as of the measurement pass — see the 2026-09-22
update at the top of this doc: causes 1 and 3 have since been fixed)*.

## The short answer

`fundamentals.json` should hold NVDA's cap **and does**. So do
`screener-fundamentals.json` and `price-pool.json`. The symbol reads as
unpriced because the consumer sees only one of the four sources — the one where
NVDA's row happens to be null.

Reading each file correctly:

| source | entries | universe symbols with a cap |
|---|---:|---|
| `price-pool.json` | 841 | 696 / 700 |
| `screener-fundamentals.json` | 2588 | 693 / 700 |
| `fundamentals.json` | 758 | **699 / 700** |
| `stockdata.json` | 759 | 0 / 700 — carries `enterpriseValue`, no cap field at all |

Universe symbols with no cap in **any** source: **1**, not 4. And that one is
not really uncapped either — see the spelling split below.

## Cause 1 — a reader bug in our code, and it is the load-bearing one

The dump does not wrap every dataset the same way:

```
price-pool.json   { dumpedAt, dataset, key, readAs, entries, value  }
the other three   { dumpedAt, dataset, key,         present, values }
```

`.value` singular against `.values` plural. `entriesOf()` unwraps `.value`,
misses `values`, falls through to `?? doc`, and enumerates the **wrapper's own
five keys** as if they were ticker symbols. That is why files of 176 KB, 650 KB
and 680 KB each reported exactly five entries — named `DUMPEDAT`, `DATASET`,
`KEY`, `PRESENT`, `VALUES` — and why `KEY` surfaced as an unparseable symbol.

**This is the same reader `due-strip-universe.mjs` uses, and its committed
conclusion rests on it.** That file's header states, as measured fact:

> Adding the other three sources contributed ZERO new caps. […] So the
> conclusion is about the dump, not about this script: NOTHING IN THE STEP 0
> DUMP PRICES NVDA. […] a top-50 by market cap cannot be generated from this
> input, and widening the chain further is not the fix. The fix is a cap source
> that covers the whole market, which is the whole-market bars migration, which
> is off the roadmap.

Every sentence of that was derived from enumerating five wrapper keys. The
sources were never read. **Three of them price NVDA.**

The dump states its own row count in a `present` field — 758 and 759 — sitting
in the same object the reader was mis-parsing. A reader that compared what it
extracted against the count the file supplied would have failed loudly on the
first run instead of reporting a confident zero.

## Cause 2 — a real, separate null-cap pattern inside `price-pool.json` — NOT FIXED

Independent of the reader. Of the pool's 841 rows, **6** carry no cap:

```
BRK.B  INTC  IREN  NOK  NVDA  SPCX
```

Null-field counts, capped rows against uncapped, whole source:

| field | capped | uncapped |
|---|---|---|
| `marketCap` | 0 / 835 | **6 / 6** |
| `volume` | 0 / 835 | **6 / 6** |
| `open` | 0 / 835 | **6 / 6** |
| `dayHigh` | 0 / 835 | **6 / 6** |
| `dayLow` | 0 / 835 | **6 / 6** |
| `price` | 0 / 835 | 1 / 6 |
| `pe` | 90 / 835 | 3 / 6 |

Five fields separate the two populations perfectly. This is not "the pool does
not populate these fields" — 835 rows populate all five without exception.

NVDA's row, beside a control:

```
NVDA  {price:226.28, changePct:1.80411, volume:null, marketCap:null, open:null,
       dayHigh:null, dayLow:null, pe:27.958, ts:1790008814859, peTs:1790003416211}

AAPL  {price:337.97, marketCap:4963885707320, changePct:0.5474, volume:13410074,
       open:335.20001, dayHigh:338.47, dayLow:333.05, pe:38.489,
       ts:1790007915488, peTs:1790003414609, failStreak:0, failAt:0}
```

NVDA, INTC and NOK also **lack the `failStreak` and `failAt` keys entirely**,
which all 835 capped rows carry. Two writers, two row shapes, one key space.
The price is live and correct — this is not a fetch failure.

**Candidate mechanism, added 2026-09-22, unverified against production
data.** Reading `lib/server/pricePool.ts` (not a fresh measurement — code
inspection only): `seedColdPricePoolRows()` writes a cold-start row from
discovery's own `stable/quote` call and stamps `ts: nowMs` even when that
quote's `marketCap`/`volume` were themselves null, and never sets
`failStreak`/`failAt` at all — matching NVDA/INTC/NOK's shape exactly. A
fresh `ts` on an incomplete row can hide the gap from `warmPricePool`'s
stalest-first backfill, since the row no longer looks stale. Separately,
the fail path around line 1152 (`warmPricePool`'s failure branch) carries
forward `prev?.marketCap ?? null` etc. and does set `failStreak`/`failAt` —
consistent with BRK.B's full-shape-but-all-null, 23-day-stale row (see
cause 3). Two different mechanisms, matching the two row shapes observed.
Not fixed here: this is a hypothesis from reading the writer, not a
measurement, and the writer's actual behavior in production hasn't been
probed.

## Cause 3 — BRK.B is a spelling split, not a missing cap — FIXED 2026-09-22

The one universe symbol with no cap under a corrected read:

```
BRK.B  price-pool           = NULL-CAP
       screener-fundamentals = held as BRK-B, cap 1,099,499,257,123
       fundamentals          = held as BRK-B, cap 1,093,244,381,698
       stockdata             = NULL-CAP
```

`price-pool` and `stockdata` spell it `BRK.B`; `screener-fundamentals` and
`fundamentals` spell it `BRK-B`. Both caps are real and current. The consumer
uppercases and does nothing else, so it matches neither.

`lib/symbolSpellings.mjs` exists for exactly this and was not used here.

Its pool row is also a **separate** fault from cause 2: it is full-shape
(carries `failStreak`/`failAt`) but every value is null, and its `ts` is
`1787983440576` — **2026-08-29, 23 days stale** — while the other uncapped rows
stamp the current minute. `failStreak: 0` on a row that has been null for three
weeks is its own claim worth checking.

**Fixed 2026-09-22** on `claude/pricepool-cap-gap` (commit `5bf63b8`): added
`canonicalOf()` to `due-strip-universe.mjs`, which widens every source's
symbol through `symbolSpellings()` and resolves it back to whichever
spelling the analysis universe uses. Verified against a synthetic dump with
price-pool/stockdata spelling `BRK.B` and fundamentals spelling `BRK-B` —
it now resolves via `fundamentals.json` and ranks correctly. The pool row's
own staleness (cause 2's writer question) is unaffected by this fix.

## Answering the three questions as asked

**Which source should hold NVDA's cap and doesn't?** None. All three that carry
caps hold it. The consumer reads one source and that source's NVDA row is null.

**Why?** Not a fetch failure and not a field that changed shape. A `.value` vs
`.values` unwrap bug hid three of four sources (cause 1), on top of a genuine
partial-write pattern affecting 6 of 841 pool rows (cause 2). BRK.B adds a third,
unrelated spelling mismatch (cause 3).

**Isolated to NVDA?** No, and not a one-off. Six pool rows across a 50-name
large-cap sample chosen by name and a full 700-symbol sweep. The reader bug is
not per-symbol at all — it hid three entire sources for every symbol.

## Still not known

- **Why those six rows are written partially, confirmed against production.**
  Reading the writer (2026-09-22) turned up a plausible two-mechanism
  explanation (see cause 2's update above), but it is unverified against
  actual production runs.
- Whether the live site's rendered figures take the same path as these cached
  aggregates, or a different one.
- Whether `stockdata.json` is *supposed* to carry a cap. It carries none for any
  symbol, which is consistent but unconfirmed as intended.
- What else consumes `entriesOf()`-shaped readers against `.values` dumps. Not
  surveyed.

## Scope note

Three distinct defects, in two subsystems, one of which invalidated a committed
roadmap conclusion (now corrected). **This was more than one PR's worth** and
the ordering was a decision, not an implementation detail: cause 1 changed what
the due strip could do (fixed first), cause 3 was a one-line class of bug with
a helper already written for it (fixed alongside it), and cause 2 lives in a
writer that's now been read but not yet fixed or measured against production.

## Reproducing it

```
relay.yml  task=pricepool-cap-gap  run_id=35627342399  artifact_name=step0-dump
```

No network, no credential. Prints each file's structure, both readers side by
side, the whole-source null-field table, capped controls, the full sweep and the
named large-cap sample.
