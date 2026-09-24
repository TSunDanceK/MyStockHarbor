# COWORK #43: measures are temporary (throwaway, not for merge)

Rendered locally (`next dev`, real AAPL daily bars from a read-only Redis stand-in).
- desktop-placed.png: a placed Price & date measure, locked (no corner handles), with the "Click anywhere or press Esc to clear" hint.
- desktop-cleared.png: after the next press (a drag): the measure is gone and the chart did not pan.
- phone-placed-390.png: tap-tap measure at 390px with the "Tap anywhere to clear" hint (no Done pill).
- phone-cleared-390.png: after the next touch: gone, no pan.
- rendered-test-results.txt: 22/22.
Mutant (clearing press not swallowed): the two "did not pan" checks FAIL (desktop base 2026-05-06 -> 2026-04-07; phone likewise), 20/22.
