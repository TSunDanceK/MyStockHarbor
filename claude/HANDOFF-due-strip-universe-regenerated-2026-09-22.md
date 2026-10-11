# Due strip regenerated against fresh production data — fix verified

**2026-09-22.** PR #505's fixes (reader `.value`/`.values` bug + BRK.B/BRK-B
spelling) are merged to `main` and now verified end-to-end against a **fresh**
Step 0 dump, not just synthetic fixtures. This is the "not yet done" item PR
#505 explicitly left open — it is now done.

**Note added on mirroring, 2026-09-22, same day:** this doc was written after
this run and only saved to the claude.ai Project — not mirrored into this
repo at the time, which is the mirroring gap `HANDOFF-earnings-calendar-v1-2026-09-21.md`
already names as a standing rule. It is being mirrored in now, after the
fact, superseded in substance by PR #506 and `claude/due-input-census-2026-09-22.md`.
Kept for its run-ID provenance: this was the first canary-passing dispatch
(one relay cycle before PR #506's), not the one that got committed.

## What was run

1. Dispatched `.github/workflows/step0-ground-truth.yml` (branch `main`, default
   `out_dir=step0-dump`) via the browser (GitHub's workflow-dispatch UI has no
   MCP equivalent for this repo). Result: **run 35705143191**, completed
   successfully.
2. Dispatched `.github/workflows/relay.yml` with `task=due-strip-universe`,
   `run_id=35705143191`, `artifact_name=step0-dump` (branch `main`). Result:
   **run 35705859765**, completed successfully in 20s.

(GitHub's "Run workflow" dropdown for `relay.yml` errored ~70% of the time with
its own "Uh oh! There was an error while loading" — a UI-side flake in loading
the ref/branch list, unrelated to this repo's code. Reload-and-retry got past it
both times. Not worth fixing from here; just expect to retry a few times. A
later session confirmed the GitHub API tools work fine for dispatch and avoid
this UI flake entirely — prefer that route.)

## Result: the fix holds against real production data

```
[due-universe] price-pool.json: 841 entries · 835 new caps · 0 already known · 6 carrying no usable cap
[due-universe] screener-fundamentals.json: 2598 entries · 1773 new caps · 825 already known · 0 carrying no usable cap
[due-universe] fundamentals.json: 758 entries · 0 new caps · 758 already known · 0 carrying no usable cap
[due-universe] stockdata.json: 759 entries · 0 new caps · 0 already known · 759 carrying no usable cap
[due-universe] caps assembled: 2608 symbols from 4 candidate sources
[due-universe] analysis universe: 700 symbols · 700 with a cap (100.0%)
[due-universe] canaries: NVDA=#1(screener-fundamentals.json) AAPL=#2(price-pool.json) MSFT=#5(price-pool.json) GOOGL=#3(price-pool.json) AMZN=#6(price-pool.json) META=#7(price-pool.json)
[due-universe] ranks 45-55: 45.NVS 46.MUFG 47.RTX 48.AZN 49.SHEL 50.ANET 51.CRWD 52.GEV 53.TXN 54.TMO 55.SAP
[due-universe] boundary: rank 50 / rank 51 cap ratio = 1.019
```

**100.0% of the 700-symbol analysis universe now has a cap** (up from 99.4%
with NVDA's slot silently wrong), and **NVDA ranks #1**. All 6 canaries (NVDA
AAPL MSFT GOOGL AMZN META) landed in the top 50. Boundary ratio 1.019 — rank 50
vs rank 51 are close, so expect membership to be sensitive to small cap
movements near the cutoff, as designed.

## The top 50 (this run, generatedAt 2026-09-22)

```
NVDA AAPL GOOGL GOOG MSFT AMZN META AVGO TSLA MU LLY BRK.B JPM AMD WMT V ASML
XOM INTC MA ABBV CSCO ORCL PLTR BAC CVX COST DELL LRCX CAT KO MRK AMAT HSBC PG
UNH GE NFLX PANW HD PM RY GS BABA NVS MUFG RTX AZN SHEL ANET
```

Identical membership to the one PR #506 committed from the later run
(35713495815 / 35713686573) — same 50 symbols, same order, same boundary
ratio. Two independent runs of the fixed generator against two different
fresh dumps agree exactly.

## What's still open (as of this run; see PR #506 and the census doc for later state)

- The exact JSON artifact wasn't committed anywhere from this run — that
  gap is what PR #506 closed, from a separate, later dispatch.
- The `/earnings-calendar` due strip's `DueInput` producer + wiring — see
  `claude/due-input-census-2026-09-22.md` on `claude/due-input-producer` for
  the measurement of what that producer can and can't do against real data.
- Cause 2, the price-pool partial-write pattern (6 of 841 rows, including
  NVDA's own `price-pool.json` row — still null there, just no longer the only
  source consulted) — still open, candidate mechanism only, per the brief.
