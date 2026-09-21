# One window sized for one question, read by two

Found 2026-09-21 in eye-check on #486, two rounds in. The first round of the
valuation card passed on every symbol that was looked at; the defect reached
**233 of 553 symbols — 42% of the store** — and none of the three symbols the
first eye-check covered was one of them.

The earnings page fetches daily bars in a window sized **±45 calendar days
around the newest eight report dates**. That bound is correct, deliberate and
documented: `computeEarningsReactionDetail` reaches 20 trading days either side
of each report and needs nothing else, so the window is exactly the price
history the price-reaction chart consumes.

A new valuation card then took **the last bar of that window** as the current
price for market cap and P/E. Both readers were internally consistent. Neither
was wrong about its own data. But the window answers *"which bars surround the
reports"*, and the card was asking *"what is this company worth now"* — and
those two coincide only for a filer that reported recently.

Measured against live Redis (`scripts/valuation-price-probe.mjs`, relay runs
35581113737 and 35581180053):

```
symbol   newest report  WINDOW last              SERIES last              error
TRI      2025-08-07     2025-09-19 (367d) 165.15  2026-09-18 (3d)   94.39  +75%
ASML     2026-01-28     2026-03-13 (192d) 1345.69 2026-09-18 (3d) 1679.92  −20%
RYAAY    2025-03-31     2025-05-15 (494d)  50.40  2026-09-18 (3d)   53.51   −6%
CNI      2026-01-30     2026-03-16 (189d) 106.22  2026-09-18 (3d)  118.95  −11%
AAPL     2026-07-30     2026-09-11  (10d) 332.27  2026-09-18 (3d)  336.13   −1%
```

The fix was not to widen the window — that would have broken the thing the
window is for. The two readers were given what each actually asks for: the
reaction chart keeps the bound, and the card reads the whole series. It costs
nothing, because `getDailyBars` was already a view over `getDailyHistory` and
that function dedupes by symbol while a read is in flight.

- **A bound is part of a question, not a property of the data.** Reusing a
  window is reusing its question. The window's own docblock said what it was
  sized for, in detail, and was still read as "the bars for this page".
- **The defect scaled with a variable neither reader mentions.** Staleness here
  is a function of *time since the last report*, which is nowhere in the
  valuation card and is the whole of the bound in the other. Nothing at either
  site suggested the two were coupled.
- **A spot check cannot sample a defect whose size varies.** AAPL was 1% wrong
  and read as correct; ASML was 20% wrong. The first eye-check passed because
  the three symbols on it happened to sit at the small end — and ABEV, which
  "confirmed no regression", turned out to have **no stored SEC report dates at
  all**, so it was never on the bounded path and could not have shown the defect
  under any circumstances. A passing control that was never wired to the thing
  under test is not a control.
- **When a figure is a claim about now, bound its inputs by age.** Every other
  number on that page is a filed fact frozen at its period end; market cap and
  P/E are assertions about today. `VALUATION_PRICE_MAX_AGE_DAYS` now refuses a
  close older than 10 days rather than valuing a company with it — currently
  zero symbols need it, which is the point: it catches the *next* way a stale
  price arrives (a bar cache that stops), not this one.
- **Measure the population before believing three examples.** The owner asked
  "worth checking any other infrequent/annual filer the same way". The sweep
  answered something better than the question: the at-risk set is not
  "infrequent filers" but "filers with stored report dates whose newest report
  is old enough for the window to fall short", and it was closer to half the
  store than a tail.

Related: `claude/traps/two-validators-for-one-value.md` (two sources for one
number) is the mirror image — there, two readers disagreed about a value; here,
two readers agreed about a value that answered only one of their questions.
