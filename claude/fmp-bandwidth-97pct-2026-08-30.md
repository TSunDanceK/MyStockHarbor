# FMP at 19.56 / 20 GB — `historical-price-eod/full` is 73.7% of it (2026-08-30)

Companion to the Redis command-budget analysis of the same date. Same root
cause, second meter. The FMP number is the more urgent of the two: the Upstash bill resets on
1 September; this does not unwind until late September.

**FMP's stated penalty at 100% is account SUSPENSION, held until the rolling
window drains.** Not a throttle.

## Dashboard readings (2026-08-30, 30-day window)

Bandwidth **19.56 GB / 20 GB — 97.8%**. Calls/min 0/300.

| Base path | Calls | Success | Over limit | Size (MB) | KB/successful call |
|---|---|---|---|---|---|
| `historical-price-eod/full` | 263.61k | **30%** | **70%** | **14,410** | **184** |
| `news/stock` | 39.77k | 94% | 6% | 1,330 | 36 |
| `income-statement` | 140.9k | 94% | 5% | 1,030 | 7.8 |
| `ratios-ttm` | 342.83k | 99% | 1% | 873.86 | 2.6 |
| `stock-list` | 320 | 97% | 3% | 735.94 | **2,370** |
| `quote` | **2.15M** | 99% | 1% | 680.84 | 0.32 |
| `cash-flow-statement` | 99.76k | 98% | 2% | 529.13 | 5.4 |
| `earnings` | 30.82k | 88% | 12% | 372.51 | 13.7 |
| `dividends` | 88.94k | 99% | 1% | 107.51 | 1.2 |
| `biggest-losers` | 11.5k | 99% | 1% | 71.82 | 6.3 |

These ten sum to 19.67 GB against a reported 19.56 — the top ten *is* the bill.
The remaining 129 pages of endpoints are rounding error. Stop looking at the tail.

**History alone is 14.41 GB — 73.7% of consumption, 72% of the cap.** On 22 Aug
it was 9.33 of 14.86. It has been the dominant consumer throughout.

Everything except history is **5.15 GB/month, ~176 MB/day**. Fix history and the
account sits at ~26% and every other question here becomes optional.

## This is not an outage artifact

The 7-day view (Aug 24–30) shows history at 6.7 GB with 16% success, spiking
Aug 27–29 — the Upstash suspension and recovery storm
(the Upstash suspension of 27-28 Aug). The obvious reading is "the
outage did this". Subtracting the windows says otherwise:

| | calls | successful | success | bytes | KB/call |
|---|---|---|---|---|---|
| 30-day | 263.61k | 79,083 | 30% | 14.41 GB | 184 |
| last 7d | 219.14k | 35,062 | 16% | 6.70 GB | 191 |
| **prior 23d** | **44.47k** | **44,021** | **99%** | **7.71 GB** | **184** |

In the 23 quiet days *before* the outage, history already ran **1,914 successful
calls/day = 2.5 full-universe passes/day, 343 MB/day ≈ 10.1 GB/30d**, at 99%
success. Nothing looked wrong.

**Steady state with zero incidents: 10.1 + 5.15 ≈ 15.2 GB/month = 76% of cap.**
There was never headroom. The outage consumed the 24% of slack that hid it.

Payload size is measured identically in both windows — 184 KB and 191 KB — and
everything downstream rests on that number.

## Ordering hazard: the 429s are a brake

The Redis command-budget doc of the same date ranks **Task 1** (the
`reserveFmpCallSlot()` INCR-on-retry fix) first. That ranking predates the
success-rate column.

70% of history calls are refused with 429, and a 429 costs a call slot but no
bandwidth. Had all 263,610 succeeded at 184 KB: **46.3 GB against a 20 GB cap.**
The rate limiter absorbed ~32 GB.

The nuance the 23-day baseline adds: in normal running success is already 99%, so
the brake does nothing day to day. It engages only under cold-cache load —
exactly when Task 1 makes things worse. Task 1 shipped alone does not raise the
everyday bill; it removes the ceiling on the *next* incident, turning a 4 GB storm
into a 30 GB one. **Ship it after the payload fix, not before.**

## `quote` is byte-cheap and slot-expensive

2.15M calls in 30 days — 71.7k/day, ~50/min averaged — for 680 MB. As bandwidth
it is 3.5% of the bill and not worth touching. As *call slots* it is the largest
consumer on the account by an order of magnitude, against a shared 300/min ceiling.

`warm-price-pool` runs `*/3` with `maxDuration` 300s, so runs overlap (Task 7),
each firing ~139 sequential quote calls. Overlapping bursts against 300/min is a
plausible mechanism for the 70% history over-limit rate: quote crowds out history,
history's retry loop then INCRs the counter it is waiting on, and the minute never
recovers. Consistent with the pattern — the endpoints with meaningful over-limit
rates are the ones competing with quote bursts (history 70%, earnings 12%,
income-statement 5%), while cheap high-frequency `ratios-ttm` sits at 1%.

## Verification

- **History's Size (MB) is the number.** Under ~3 GB/30d means the fixes landed.
- **Success rate rising while bytes stay flat = healthy.** Success rising *and*
  bytes rising means redundant builds are still there.
- The bandwidth bar will not visibly improve until **late September**, when the
  Aug 27–29 storm ages out. Do not read a flat bar as a failed fix — read the
  per-endpoint daily size instead.

## Plan upgrade

Same answer as the Upstash doc: fix the fan-out first, then buy the cheaper plan.
Tiers are Starter $22 / 300rpm / 20 GB, Premium $59 / 750rpm / 50 GB, Ultimate
$149 / 3000rpm / 150 GB. Premium's 750/min *releases the 429 brake*, so at 90%
success the same code would consume 46.8 GB of Premium's 50 GB — buying headroom
and handing most of it straight back. And the rolling window follows you down: to
return to Starter, trailing-30-day usage must be under 20 GB on the day you switch.

## Open questions

- What FMP actually does at 100% beyond "suspension" — undocumented on the
  pricing page.
- `/stable/stock-list` at 2.3 MB/call (320 calls, 736 MB) — already flagged in the FMP probe
  verdicts of 22 Aug; the filtered screener supplies better
  data for 439 KB.
- `news/stock` at 1.33 GB is the #2 consumer and wants a bandwidth-aware TTL.
- Daily call volume roughly doubles around Aug 7 (~65k → ~130k/day) and holds.
  Universe growth (416 → 663 → 755) is the obvious candidate.
