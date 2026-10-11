# The 700 is a third Nasdaq by count and two-thirds Nasdaq by dollar volume

Measured 2026-09-12, runs [34708869059] and [34709045769], from the frozen Step 0
dump (`dumpedAt 2026-09-12T11:08:18.572Z`) plus two free reference files. No
vendor, no key, no new data source.

## Why the split is a pricing input

The plan administrators bill the two halves of the tape differently at source.
**UTP (tape C, Nasdaq-listed) charges nothing** for delayed or end-of-day data on
controlled products. **CTA (tapes A and B — NYSE, NYSE American, Arca) posts
indirect-access fees** for delayed data, and whether a pure EOD product escapes
them is **not stated** in the policy. So the Nasdaq half's exchange pass-through is
zero and the NYSE half's is not-known-to-be.

## 1 & 2. The split, and the two numbers point opposite ways

| Venue | Count | % count | Mean daily $ volume | % $ vol | Tape |
|---|---|---|---|---|---|
| **Nasdaq** | 230 | **32.9%** | 3.275e+11 | **62.5%** | C (UTP) |
| **NYSE** | 463 | **66.1%** | 1.945e+11 | **37.1%** | A (CTA) |
| UNRESOLVED | 4 | 0.6% | 1.908e+9 | 0.4% | — |
| NYSE (SEC only) | 3 | 0.4% | 2.804e+6 | 0.0% | — |

**The headline is the disagreement between the two columns.** Nasdaq is **a third
of the names and nearly two-thirds of the liquidity**. A symbol count alone would
have pointed at the opposite conclusion — which is exactly why the weighting was
asked for.

Against the stated thresholds: **62.5% ≥ 60%, so a Nasdaq-only fallback is
viable** and the zero-pass-through half covers most of the site's traded value.

Dollar volume is the **mean over the last 60 sessions**, not one day — a single
session can be an earnings print or an index rebalance, and weighting a licensing
decision on it would be a denominator error of its own.

**No NYSE American or Arca names are in the 700 at all.** The CTA exposure is
entirely tape A (NYSE), not tape B. That matters: Network A last sale is the
$750/mo line, not the $400/mo one.

### The two reference files agreed, and the unresolved four corroborate the alarm

`nasdaqtraded.txt` and SEC's `company_tickers_exchange.json` **agree on
Nasdaq-vs-not for every symbol both cover.** A disagreement would have been
reported rather than averaged away.

The four unresolved symbols are **`BK`, `EA`, `EQR`, `WBS`** — absent from *both*
reference files, and the same four that had no CIK in SEC's ticker map during
Phase 5. Three independent files do not have them, and `historyStaleNewestSymbols`
independently flagged `EA`, `EQR` and `WBS` this morning. **That is four sources
agreeing these universe entries are stale or renamed** — the venue lookup
corroborates the stale-symbol alarm without being designed to.

## 3. Sections under a Nasdaq-only universe — 12 of 16 resolved EXACTLY

**The dump stores `signalRecords`, not sections** — sections are built at render
time by `buildSection({source, take})`. The first run reported it could not answer
this, correctly.

That turned out to be **better**. Each record carries the per-symbol booleans the
sections select from, so the qualifying **pool** is countable directly — nothing
recomputed, nothing reimplemented. And counting the pool rather than the displayed
list makes the answer **exact rather than a lower bound**: a section shows
`min(take, qualifying)`, so the Nasdaq-only figure is `min(take,
qualifyingNasdaq)`, which accounts for Nasdaq names promoting into a cap freed by
removing NYSE names.

| Section | Qualify | Nasdaq | Shown now → Nasdaq-only |
|---|---|---|---|
| Oversold Stocks Today | 237 | 72 | 20 → **20** |
| Overbought Stocks Today | 141 | 55 | 20 → **20** |
| Positive Last Earnings | 462 | 153 | 20 → **20** |
| Strong Earnings Growth | 613 | 193 | 20 → **20** |
| Daily MA200 Proximity | 79 | 19 | 20 → **19** |
| **Weekly MA200 Proximity** | 27 | 5 | 20 → **5** |
| **Bullish Trend Flip (Daily)** | 39 | 16 | 39 → **16** |
| Bearish Trend Flip (Daily) | 106 | 52 | 40 → **40** |
| Bullish Trend Flip (Weekly) | 69 | 22 | 40 → **22** |
| **Bearish Trend Flip (Weekly)** | 61 | 18 | 40 → **18** |
| Bullish & Bearish Divergence | 394 | 140 | 20 → **20** |
| Macro Support and Resistance | 373 | 112 | 20 → **20** |

**No section falls to 3 or fewer.** Nine of twelve hold their full display count
or lose one name. Three lose more than half:

- **Weekly MA200 Proximity: 20 → 5.** The worst hit, and it is the owner's
  strongest signal. Only 27 of 700 qualify at all, and just 5 are Nasdaq.
- Bullish Trend Flip (Daily): 39 → 16
- Bearish Trend Flip (Weekly): 40 → 18

**Four sections are named as unresolvable rather than guessed** — Best Trend
Score, Down 20% From All-Time Highs, All-Time High Breakout, 3-Month High
Breakout. Their sources are derived rankings (a composite score, a drawdown
threshold, two high-water comparisons) with no corresponding boolean on the
record. Mapping them would mean inferring the builder's filter.

## 4. The benchmark row: 1 of 4 tiles survives

| Tile | Venue | Tape | Nasdaq-only |
|---|---|---|---|
| **SPY** | NYSE Arca | B (CTA) | **LOST** |
| **QQQ** | Nasdaq | C (UTP) | **SURVIVES** |
| **DIA** | NYSE Arca | B (CTA) | **LOST** |
| **IWM** | NYSE Arca | B (CTA) | **LOST** |

**Exactly as predicted.** All three lost tiles are NYSE Arca, all four are
ETFs. The benchmark row goes from four tiles to one, leaving only the Nasdaq 100 —
a benchmark row that cannot show the S&P 500.

Note the asymmetry this creates: the tape-B exposure of the *universe* is zero,
but the tape-B exposure of the *benchmark row* is three quarters of it. The two
halves of the licensing problem do not map onto the two halves of the page.

## The decision this feeds

**62.5% by dollar volume clears the stated bar for viability.** But two caveats
belong next to it:

1. **Weekly MA200 Proximity drops to 5 names.** Whether that page is worth
   publishing at 5 is a product judgement, and it is the signal the owner rates
   highest.
2. **The benchmark row loses the S&P 500, the Dow and the Russell.** Those are
   Arca-listed ETFs, so they sit in the CTA half regardless of what the stock
   universe does.

Neither is a reason not to do it. Both are things to decide before, not after.

## Related

- `claude/stooq-inaccessible-sec-viable-2026-09-12.md` — why a bars provider is
  being chosen at all, and the Phase 5 coverage figures.
