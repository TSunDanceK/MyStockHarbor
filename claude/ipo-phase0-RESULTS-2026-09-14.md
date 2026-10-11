# IPO build — PHASE 0 RESULTS, 2026-09-14

Phase 0 of `claude/BRIEF-ipo-off-fmp-2026-09-14.md`. **Measured and stopped at the gates. No
build, no app file touched.**

Relay runs `34890331223` (first) and `34890701159` (corrected — see §3). Raw evidence:
`ipo-probe/phase0-2026-09-14.json`.

## Gate summary

| Gate | Result |
|---|---|
| **0.1** operating-company price range ≥70% | **FAIL — 5/12 (42%)** |
| **0.2** parser negative controls | **PASS — 4/4**, and the source probe's warrant-strike failure is gone (0/8, was 3/8) |
| **0.3** age histogram | **REPORTED.** No gate. The constant is yours |

**Per the brief, 0.1's FAIL means the upper table ships without a price-range column.** That
was written in as a real outcome rather than a blocker, and it is the one that happened. But
the *reason* it failed is more useful than the number, and it changes the brief — see §2.

---

## 1. What 0.2 proves: the parser is fixable, and it is fixed

The source probe's parser returned a price **8/8** and was right **3/8** — three SPAC warrant
strikes at `$11.50`, two par values at `$0.00001` and `$0.004`. Rebuilt to the brief's five
rules:

| Control | Expected | Got |
|---|---|---|
| par value only (`$0.00001` + an `11.50` nearby) | null | **null** |
| warrant strike only (`$11.50`) | null | **null** |
| genuine final price (`"initial public offering price is $16.00 per share"`) | 16.00 | **16.00** |
| no offering terms at all | null | **null** |

And on live filings: **SPAC unit price 8/8 (100%)**, **warrant strike misread as offer price:
0** — the exact failure that produced three of the original eight wrong answers.

Phrase-anchoring is what did it. Every range the parser *did* find came back with its
evidence attached, which is why §2 below can be adjudicated at all:

> `"public offering price between $16.00 and $18.` — DEEP FISSION, `$16–$18`
> `"initial public offering price will be between` — ITG, `$19–$22`
> `"public offering price of between $10.00 and $` — Eloxx, `$10–$12`

**The ≥90% correctness gate is NOT self-certified.** This run cannot mark its own homework;
the five ranges above read correctly from their basis strings, but a human should check them
against the filings before that gate is called passed.

---

## 2. Why 0.1 failed — and it is not the regex

Twelve "operating companies", five ranges found. The seven misses, itemised, because the
composition is the finding:

| Company | Range | What it actually is |
|---|---|---|
| DEEP FISSION | **$16–$18** | genuine IPO ✓ |
| Eloxx Pharmaceuticals | **$10–$12** | genuine ✓ |
| Sinda Ltd. | **$11.25–$13.25** | genuine ✓ |
| ITG, Inc./DE/ | **$19–$22** | genuine ✓ |
| IMC Rare Earths | **$4–$6** | genuine ✓ |
| **T. Rowe Price Active Crypto ETF** | — | **an ETF.** Not an IPO |
| **Morgan Stanley Solana Trust** | — | **a crypto trust.** Not an IPO |
| **Research Alliance Corp IV** | — | **a SPAC**, misclassified as an operating company |
| Attovia Therapeutics | — | amendment was **already priced** ($17.00) — no range left to carry |
| Advasa Holdings | — | **already priced** — same |
| Optimi Health (F-1/A) | — | plausibly genuine miss |
| Londian Wason (F-1/A) | — | plausibly genuine miss |

**Three of the seven misses are not IPOs at all.** An ETF and a crypto trust file `S-1` and
`8-A12B` exactly like an issuer does — which is §4.6's warning (*"8-A12B is also filed by
ETFs, notes and SPAC classes"*) showing up as data rather than as a caveat.

**I am not going to re-cut the denominator to clear the gate.** Excluding the ETF, the trust
and the misclassified SPAC gives 5/9 (56%) — still a fail. Also excluding the two
already-priced amendments gives 5/7 (71%), which *clears* it — and at n=7 that is a number I
would not defend. **The gate stands as FAILED at 42%**, and the honest conclusion is the one
the brief pre-committed to: **ship the upper table without a price-range column.**

The 32.4% bucket asks *who*, not *how much*. Nothing about the failure threatens the design.

### NEW FINDING — the brief needs an entity-type exclusion it does not have

`T. Rowe Price Active Crypto ETF` and `Morgan Stanley Solana Trust` would render **inside
"Upcoming IPOs"**, and a reader would notice. Two things follow:

1. **The already-listed filter does not catch them.** A *new* ETF is not in the ticker map
   either — it is genuinely not yet listed. It is not an IPO for a different reason.
2. **So it needs its own rule**, on top of everything in §4.3a and §4.8. Candidate signals,
   none yet measured: SIC code (`6221`/`6726` cover commodity pools and investment offices),
   the `N-1A`/`N-2` registration path, and name patterns (`ETF`, `Trust`, `Fund`).

Recorded as **§4.10** in the brief. It is a real gap, not a polish item.

---

## 3. 0.3 — and two defects in my own first run

**Run 1 of this probe reported 217 as the upper table's population. That was wrong, twice,
and both errors were mine.**

- **It repeated the source probe's own sampling bug.** *"Has an amendment, has no 424B"* also
  describes an **already-listed company registering resale shares** — the exact contamination
  that voided the first source-probe run's `0/5`. Making the same mistake two days after
  documenting it is the more embarrassing half.
- **It counted withdrawals that pre-date the amendment.** Kepler amended `2026-08-24` against
  an `RW` of `2026-05-19`; Akari amended `2026-06-26` against an `RW` of `2026-05-21`. Those
  withdraw an *earlier* registration. **A withdrawal only withdraws what came before it.**

Corrected in run `34890701159`, and the funnel is printed rather than the endpoint so each
step can be argued with:

```
amendment in window, no 424B                        228
− already listed (resale/follow-on, NOT an IPO)     172      ← 75% of the raw count
− withdrawn AFTER the amendment (RW/AW)               3
= the upper table's real population                  53
```

**The already-listed filter is load-bearing, not hygiene: it removes three-quarters of the
candidates.** Without it the page would be mostly already-trading microcaps filing resales,
which is precisely what the current FMP page exists *not* to be.

### The histogram (n = 53, ages of the most recent amendment)

| Age | Count | Cumulative |
|---|---|---|
| ≤7d | 1 | 2% |
| ≤14d | 5 | 11% |
| ≤21d | 3 | 17% |
| ≤30d | 5 | 26% |
| ≤45d | 7 | 40% |
| **≤60d** | **10** | **58%** |
| ≤90d | 11 | 79% |
| ≤120d | 11 | 100% |

**Two things to read with it, before picking a number:**

- **The distribution is right-censored at the window edge.** The probe looked back 120 days,
  so `>120d` reads 0 because nothing older was *visible*, not because nothing older exists.
  The real tail is longer. **Do not read "100% by 120 days" as a fact about the world.**
- **53 is an upper bound**, because the ETF/trust contamination in §2 is not filtered out of
  it either.

**Withdrawals do almost none of the work.** `RW`/`AW` caught **3 of 56** — about 5%. The other
95% of stale rows would sit in "Upcoming IPOs" indefinitely with no signal at all, which is
exactly why §4.8 asks for both mechanisms. **The age cap is the primary mechanism; `RW`/`AW`
is the edge case.** That is the reverse of how the amendment framed it, and it is worth
saying plainly.

**No cap is recommended here.** For calibration: 60 days keeps 58% of the current population,
90 days keeps 79%. A tighter cap shows fewer, fresher names; a looser one shows more, staler
ones. Against measured lead time (S-1/A → final prospectus, median 7 days, range 4–14), a
deal quiet for 60+ days is very unlikely to be live — but "unlikely" is a judgement about
your own tolerance for a stale row, not a measurement, so it is yours to make.

---

## 4. What I did not do

- **No build.** No file under `app/` or `lib/` touched, in this phase or any earlier one.
- **No cap constant chosen.** §3 gives the shape and declines the number.
- **No re-cut of 0.1's denominator to clear its gate.** §2.
- **No claim that 0.2's ≥90% gate passed.** The negative controls passed; the correctness
  gate needs a human against the filings.

## 5. What I need before Phase 1

1. **The age cap number** (§3), or a decision to defer it and ship with the `RW`/`AW`
   mechanism only — which §3 shows would leave ~95% of stale rows in place, so I would advise
   against it.
2. **Confirm the price-range column is dropped** from the upper table (0.1 FAIL), or ask for
   a re-measure on a cleaner cohort once §4.10's entity filter exists.
3. **A decision on §4.10** — build the entity-type exclusion now, or accept ETFs and trusts
   in the upper table until it exists. I would not accept them.
4. **Hand-check the five ranges in §1** against the filings, to close 0.2's correctness gate.

Still outstanding from the brief and unchanged: whether FMP's IPO rows carry a CIK (§4.3a),
which needs FMP access nobody in this session has.

---

*Phase 0 run by Claude Code, 2026-09-14. Relay runs `34890331223` and `34890701159`.*
