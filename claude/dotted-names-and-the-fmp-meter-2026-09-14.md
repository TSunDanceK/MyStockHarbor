# Two findings: dotted company names, and who is still calling FMP news

2026-09-14.

---

# Task 1 — dotted names fail text relevance

## Step 1: the tokens, measured before anything was changed

`getCleanCompanyName` strips **all** punctuation:

| symbol | committed name | cleaned | words ≥ 4 chars (rule 3 needs **two**) |
|---|---|---|---|
| FAST | Fastenal Company - Common Stock | `fastenal` | `["fastenal"]` — 1 |
| SNA | Snap-On Incorporated Common Stock | `snap on incorporated` | `["snap","incorporated"]` — 2 |
| **AOS** | A.O. Smith Corporation Common Stock | **`a o smith`** | `["smith"]` — **1** |
| **SJM** | The J.M. Smucker Company Common Stock | **`the j m smucker`** | `["smucker"]` — **1** |

The hypothesis predicted initials being dropped as too short. **That is half of
it.** Both content rules die on the dotted pair, for two different reasons:

**Rule 2 — the whole cleaned name as a contiguous substring — can never fire.**
The *headline* normaliser keeps dots (its class is `[^\w\s:$.-]`), so the text
reads `a.o. smith` or `a. o. smith` and never `a o smith`. **The two sides are
normalised differently, so they cannot meet.** That asymmetry is the root cause
and it is not visible from either function alone.

**Rule 3 — two words of ≥ 4 characters — is switched off.** `a o smith` offers
exactly one.

So for AOS and SJM only an explicit **ticker** signal could pass. Measured
against real headline spellings before the fix:

```
AOS   rule2=false rule3=false PASS=false   A. O. Smith Reports Second Quarter 2026 Results
AOS   rule2=false rule3=false PASS=false   AO Smith (AOS) Q2 Earnings Beat Estimates
AOS   rule2=false rule3=false PASS=false   A.O. Smith Corp. stock rises after guidance raise
SJM   rule2=false rule3=false PASS=true    JM Smucker (SJM) Stock Moves On Coffee Pricing   <- ticker only
SJM   rule2=false rule3=false PASS=false   J.M. Smucker Co. cuts outlook
SNA   rule2=false rule3=true  PASS=true    Snap-on Incorporated Reports Q2 2026 Results
SNA   rule2=false rule3=false PASS=false   Snap on Tools parent beats estimates
FAST  rule2=true  rule3=false PASS=true    All You Need to Know About Fastenal (FAST) …
```

That is the four-point grouping, mechanically: FAST healthy on rule 2, SNA
partly healthy on rule 3, AOS and SJM carried only by tickers.

## Step 2: the fix is on the name side, not the threshold

`companyNameVariants` offers the name in the forms headlines actually use —
dotted, dot-stripped, spaced initials, hyphen-varied — and matches on any.

```
AOS   ["a.o. smith", "ao smith", "a o smith", "a. o. smith"]
SJM   ["j.m. smucker", "jm smucker", "j m smucker", "j. m. smucker"]
SNA   ["snap-on", "snap on", "snapon"]
FAST  ["fastenal"]                              <- unchanged, one variant
```

Every real spelling now matches, and the near misses still do not:

```
PASS  A. O. Smith Reports Second Quarter 2026 Results
PASS  AO Smith (AOS) Q2 Earnings Beat Estimates
PASS  A.O. Smith Corp. stock rises after guidance raise
PASS  J.M. Smucker Co. cuts outlook
PASS  Snap on Tools parent beats estimates
drop  Rheem raises water heater prices              (AOS — nearest miss)
drop  Grainger tops estimates on industrial demand  (FAST — nearest miss)
drop  Microsoft beats on cloud revenue              (all four)
```

**The minimum-length guard was not lowered.** It is kept at 4 and now applies to
whole variants rather than to fragments — lowering it would let `a` and `o`
match half the market, which is the same failure one level down. Asserted
directly, and both a deletion and a lowering to 2 are killed by the suite.

**One list entry added:** `incorporated` to the legal-form vocabulary. Evidence
rather than plausibility — `inc` was already there, `incorporated` is the same
form spelled out, and leaving it in kept SNA's variants as `snap-on
incorporated` so that *"Snap on Tools parent beats estimates"* did not match.

## Step 3: mutation coverage

**9 of 10 killed**: variant generation removed, each individual variant form
dropped, the length guard deleted *and* merely lowered to 2, the leading `The`
kept, punctuation stripped in the base, `incorporated` removed.

The tenth is **a no-op, verified rather than assumed**: removing the `base`
entry still yields `a.o. smith`, because the hyphen replacements are the
identity for a name with no hyphen. Checked by running the mutated code —
the variant set comes back identical.

## Not verified here

**The acceptance criterion needs a `cache=MISS` render on production**, which
this sandbox cannot reach (`www.mystockharbor.com` is refused, 403 CONNECT).
What is verified is the predicate, against real headline spellings. The funnel
numbers — AOS and SJM reaching FAST and SNA's retention band, `within45d > 0`,
a lead card inside a fortnight — are owner-side and still outstanding.

**The 45-day window was not touched.**

---

# Task 2 — who is still calling FMP `news/stock`

## The answer: nothing on a schedule. Nothing at all outside two places.

| caller | reaches `news/stock` | scheduled? |
|---|---|---|
| `lib/server/news/fmpProvider.ts` | yes — the adapter | **only when `newsProviderMode() === "fmp"`**, from the render path |
| `app/api/debug/fmp-endpoints/route.ts` | yes — directly, **4 call sites per invocation** (lines 252, 420, 436, 441) | **no** — guarded by `guardDebugRequest`, manual |

Swept and clear:

- **`vercel.json` crons** — six jobs, none of them news:
  `warm-picker-universe`, `warm-earnings`, `warm-screener-fundamentals`,
  `warm-fundamentals`, `warm-price-pool`, `warm-stock-data`. The every-10-minute
  one, `warm-stock-data`, reaches `warmStockData` in `lib/server/stockDataCache.ts`,
  which contains **no news reference at all**.
- **`.github/workflows/`** — six workflows, **none mentions news**.
- **`scripts/`** — no caller. The only matches are checkers asserting the
  adapter's registration.
- **`lib/general-market-news.ts`** — hits `news/general-latest`, a **different
  endpoint**.
- Nothing else imports `fetchSymbolNewsWindow` or `readOrRefreshSymbolNews`
  outside `lib/stock-news-data.ts`.

## The hole in the exculpatory evidence — this is the important part

The reasoning "no render in production or preview logged `within90d`, so no
render explains it" **cannot do the work it is being asked to do**:

    $ git log --oneline -S 'within${feedWindowDays}d' -- lib/stock-news-data.ts
    a17c1a6 News: flip NEWS_PROVIDER to "free" …

**That log line was introduced by the flip commit itself.** Any deployment old
enough to default to `fmp` is, by construction, too old to emit `within90d`.
The two conditions are mutually exclusive, so the absence of that line is
guaranteed in exactly the case being tested — it is not evidence of anything.

This is `claude/traps/a-shared-meter-counts-every-deployment.md` for the second
time: the FMP meter is global across every deployment, and a preview built from
a pre-flip branch spends on the retired endpoint into the same counter
production is judged by.

## What remains, and how to separate them

| candidate | how to tell |
|---|---|
| a preview built from a pre-flip branch | list deployments in the window and check each one's base commit against `a17c1a6` — **not** its logs |
| `/api/debug/fmp-endpoints` invoked manually | ~4 calls per hit, so +198 ≈ 50 invocations — implausible unless someone was iterating on it |
| meter lag / attribution delay | the counter froze for an hour earlier today while six sibling endpoints moved; re-read it against siblings again |

**Nothing changed.** No caller was removed because none was found.
