# COWORK #38 Selected Indicator Summary (throwaway, not for merge)

Rendered locally (`next dev`, real NVDA / SPCX daily bars from a read-only
stand-in for Redis), 2x scale, 1440px. /api/quote is stubbed locally (it has no
data here and the loader drops the history when it fails).
- NVDA-TrendHelperFast-D, NVDA-EMA20-D, NVDA-Bollinger202-D: one indicator, daily.
- NVDA-EMA20-W: weekly units.
- SPCX-MA200-D, SPCX-TrendHelperSmooth-D: a new listing with 72 days of history.
- NVDA-EMA20+Bollinger202-D: two indicators (names lead the per-indicator lines).
