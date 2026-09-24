# COWORK #39 Breakdown chips (throwaway, not for merge)

Rendered locally (`next dev`, read-only stand-in for Redis with real SPCX / NVDA
daily bars), 2x scale. The Earnings value is stubbed in the local server only
("Partial · 1 of 5 measured" for SPCX, "Good" for NVDA), because it comes from
the SEC snapshot, which the stand-in does not hold. The red "Issues" badge is
Next's dev-mode overlay.

- before-{SPCX,NVDA}-{1440,1100}.png: main. The right column sticks out 133px (SPCX) / 31px (NVDA).
- after-{SPCX,NVDA}-{1440,1100,phone-390}.png: the fix. Every chip inside the card, every value whole.
