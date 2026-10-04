**CODE-B #134 — stretch (z-score) vs RSI study, read-only (COWORK #141)**

OWNER: The stretch score picks **different days from RSI, but not better ones**.
- Only about 30–40% of the days overlap, so the signals pick different days.
- On the low side, the move that followed RSI oversold was **as good as or better than** after z ≤ −2 (z ≤ −2 returned to the 20-day average a little more often, as expected for a shorter-term measure). z ≤ −2 alone was barely different from an ordinary day below its 20-day average.
- On the high side, neither signal was followed by a median pullback.
- **Recommendation: (a), overlap only.** Add a stretch column and a per-stock history line to the existing pages; no new Stretched page.
- All of this is past behaviour on stored bars, not a forecast.

**How it was run**
- `scripts/stretch-study.mjs`, run as relay task `write-stretch-study` from a throwaway branch, `claude/stretch-study` (not a PR).
- Read-only, enforced: GET/MGET/HGETALL only, **261 commands**. No Tiingo calls.
- The log has counts, %, dates, RSI and z values only; no prices.
- Input: the Tiingo universe, 2,582 symbols; 2,465 with ≥ 260 stored bars (up to ~5.5 years). 2.78M sessions scored.
- **Definitions:**
  - z20 = (close − SMA20) ÷ population stdev of the 20 closes; z50 is the same over 50 closes.
  - RSI is the stock page's own `rsiWilder`, lifted line for line.
  - Trend is close vs SMA200.
- **Events:** the first day of a run in the zone; a symbol re-arms only after leaving it. "Back to SMA20" means a later bar's range reaches that day's SMA20.

**Overlap (days in the zone)**
| | RSI days | z days | both | of RSI days also z | of z days also RSI |
|---|---|---|---|---|---|
| oversold (RSI ≤ 30 vs z ≤ −2) | 109,639 | 152,976 | 43,092 | 39.3% | 28.2% |
| overbought (RSI ≥ 70 vs z ≥ +2) | 168,136 | 179,798 | 64,212 | 38.2% | 35.7% |

**Low side: stretched below, all symbols**
| signal | events | back to SMA20 within 5 / 10 / 20 | median move 5 / 10 / 20 | 10-session p10 / p90 |
|---|---|---|---|---|
| base: every session below SMA20 | 1.31M | 55.4 / 75.2 / 93.5% | +0.2 / +0.4 / +0.7% | −9.1 / +10.5% |
| RSI ≤ 30 | 32,154 | 17.1 / 47.9 / 88.6% | +0.6 / **+1.1** / **+1.7%** | −8.7 / +11.6% |
| z ≤ −2 | 75,144 | 26.6 / 53.8 / 88.8% | +0.3 / +0.6 / +1.1% | −8.8 / +10.7% |
| both | 21,647 | 12.7 / 39.9 / 87.4% | +0.6 / **+1.1** / **+2.0%** | −8.9 / +11.4% |
| z ≤ −2 and above SMA200 (dip in an uptrend) | 25,290 | 28.9 / 55.9 / 89.6% | +0.3 / +0.5 / +0.8% | −8.1 / +9.9% |
| z50 ≤ −2 (variant) | 47,036 | 23.5 / 53.7 / 89.4% | +0.6 / +1.0 / +1.5% | −8.4 / +11.3% |

- **Large caps** (622 symbols): RSI ≤ 30 was followed by +1.4% at 10 sessions and +2.2% at 20, against a base of +0.6% / +0.9%. z ≤ −2 gave +0.8% / +1.3%; both gave +1.2% / +2.5%.
- **Up-trend vs down-trend:**
  - The dip in an uptrend wasn't better than z ≤ −2 overall (+0.5% at 10).
  - RSI oversold in an uptrend: +1.1% at 10, from 3,373 events.
  - Down-trend RSI oversold: +1.1% at 10, from 28,781 events.

**High side: stretched above, all symbols.** The median move after the signal was about the same as on any day above SMA20:
- base +0.2% at 10 sessions;
- RSI ≥ 70: +0.1%;
- z ≥ +2: +0.3%;
- both: +0.1%;
- the mirror (z ≥ +2 below SMA200): +0.4%.

Neither signal was followed by a typical pullback. Back-to-SMA20 within 10 sessions: RSI 47.3%, z 51.3%, both 39.6%.

**How to read the "back to SMA20" column:** it is lower for every signal than the base, and that's mechanical. A stretched price starts further from its average than a typical day below it does. The fair "better than chance" test is the forward move, compared with the base row.

**Symbols in the zone per day** (last 250 sessions; median / p90 / max)
| | oversold | overbought |
|---|---|---|
| RSI | 57 / 217 / 398 | 143 / 273 / 401 |
| z | 90 / 278 / 764 | 127 / 341 / 719 |
| both | 20 / 76 / 217 | 48 / 131 / 264 |
| trend version | 34 / 91 / 345 | 19 / 63 / 237 |

A z-only list would usually run to about 90 names and pass 700 on a sell-off day. "Both" or the trend version gives about 20–35 on a typical day.

**Recent disagreements** (dated; the next 10 sessions)
- **Slow grind** (RSI oversold, z above −1.5): ORCL, 7 Jul (RSI 29.2, z −1.22). Not back to SMA20 within 10 sessions; −10.3%.
- **Sudden drop** (z ≤ −2, RSI above 40):
  - DELL, 29 Jul (RSI 41.9, z −2.03): back to SMA20, +31.1%.
  - MRVL, 7 Jul (RSI 43.5, z −2.23): not back, −9.9%.
- **Strong trend** (RSI overbought, z below +1.5):
  - BAC, 2 Jul (RSI 70.1, z 1.45): not back, +4.3%.
  - MSFT, 27 Aug (RSI 70.5, z 1.43): back to SMA20, −1.9%.

**Limits, stated**
- **Survivorship:** the universe is today's listed names, so stocks that delisted are missing from the history. That likely flatters every forward move, the base included.
- **Cap split:** caps are today's (SEC shares × the last stored close), applied to the whole history. Only 736 symbols have a SEC cap row (622 large, 96 mid, 18 small), so **the small-cap rows are too thin to read**.
- **Clustering:** events cluster on sell-off days across many symbols, so a few dates weigh heavily.
- **Sampling:** the base row's forward moves are a 400k random sample per cell; the event rows use every event.

**Proposal**
- **(a) Overlap only (recommended).** Add a stretch (z20) column to the existing oversold/overbought pages, and a per-stock history line on the stock page, in descriptive wording only: "The last N times X was this far below its 20-day average, it was back to it within 10 sessions M times."
- **(b) A new Stretched page and a Stretch gauge card:** not supported by these numbers.

---
_Generated by [Claude Code](https://claude.ai/code)_
