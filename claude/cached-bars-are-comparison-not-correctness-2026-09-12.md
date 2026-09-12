# The cached bars are ground truth for COMPARISON, not for CORRECTNESS

Caveat for the Stooq/SEC probe, 2026-09-12.

> ## ⚠ THE CASE THAT MOTIVATED THIS WAS WITHDRAWN THE SAME DAY. THE RULE IS KEPT.
>
> **Corrected 2026-09-12, hours after this file was written.** The EA six-week-gap
> finding below is **wrong**, and it was the entire evidential basis for the caveat.
>
> The Step 0 dump's frozen series for EA reads **`2021-09-01..2026-08-10`, 1,239
> bars, status `qualified`**. Trading was suspended 2026-08-05, so the last bar is
> **five days AFTER** the corporate action — the ordinary, expected pattern.
> **There was no six-week gap and no silent upstream failure.**
>
> The `2026-06-23` figure came from `msh:history:newest-bar:v1`, a **derived stamp
> written alongside the entry**, not from the series. I reasoned about the series
> using an artefact derived from it, and the artefact disagreed with its own source.
> That is the third instance of one shape in a single session — a reconstructed
> post-mortem used as evidence about the code it was reconstructed from, a stale
> `origin/main` ref used as evidence about the remote, and now this. See
> `claude/traps/a-reconstruction-cannot-corroborate-its-source.md`, whose rule
> covers derived DATA as much as derived DOCUMENTS.
>
> **What this does to the rest of the file.** The A4 two-bucket rule below is
> **KEPT, and DOWNGRADED**: it is no longer an established fact about FMP, it is a
> **prudent methodological stance**. An upstream's cache is not automatically
> correct, and a diff that assumes it is cannot tell you which side is wrong — that
> reasoning stands on its own. But it now has **no measurement behind it**, and it
> must not be read as though it does.
>
> Stated plainly rather than edited away, because a trap doc resting on a wrong
> measurement is worse than no doc, and "the case was withdrawn, the rule is kept on
> general grounds" is a stronger record than a silent correction.
>
> **One loose end.** The `2026-06-23` figure was reported by the picker-universe run
> on 2026-09-12 and matches nothing in the frozen data. Why that run produced it is
> unexplained.

## What EA showed, and it is not about EA — WITHDRAWN, see the correction above

*The following was the original reasoning. It is left in place because the shape of
the error is the useful part; the conclusion is retracted.*

> `historyStaleNewestSymbols` flagged `EA@2026-06-23`. EA was taken private: the
> $55B PIF / Silver Lake / Affinity consortium deal closed **2026-08-04**, and
> Nasdaq suspended trading before the open on **2026-08-05** (Form 25 filed).
>
> So the delisting is real, and EA should be evicted. But the dates do not line up.
> Bars stopped 2026-06-23; trading stopped 2026-08-05. EA was an actively traded
> S&P 500 mega-cap for the ~six weeks in between.
>
> ~~FMP silently stopped serving bars for a live mega-cap for six weeks, and
> nothing noticed.~~

**What was actually true:** the delisting is real and EA is still an eviction
candidate. The bars behaved normally, ending 2026-08-10, five days after trading
stopped. Only the six-week gap was an artefact of reading the stamp instead of the
series.

## The consequence for A4

**This section is the part that survives, on general grounds rather than on EA.**

A4 was framed as "diff Stooq against the bars already cached in Redis". That
framing quietly assumes the cached bars are correct and Stooq is the thing under
test. **Both directions are live** — not because a specific FMP failure has been
demonstrated, but because a diff that presumes one side correct cannot report which
side is wrong. That is a property of the method, and it does not need a worked
example to be true.

So report disagreements in **two buckets**, because only one of them says anything
about Stooq:

| Bucket | Shape | What it is about |
|---|---|---|
| **METHODOLOGY** | Split/dividend adjustment: systematic, affects every bar in a series, shows up as a constant ratio before an effective date | **Stooq.** This is the real question A4 exists to answer, because a systematic adjustment difference moves every moving average slightly and small amounts flip proximity and crossover signals. |
| **PRESENCE** | A symbol, or a date range within a symbol, that one source has and the other lacks | **Possibly FMP.** A recent-tail gap in the cached data is a CANDIDATE UPSTREAM DEFECT, not a Stooq defect. |

Scoring a presence gap against Stooq would mark Stooq down for having data FMP was
missing. **There is no longer a worked example** — EA was it, and it was withdrawn.
Treat the buckets as a reporting discipline, not as a prediction that FMP gaps will
be found.

## The stale-symbol triage the alarm has never had

`historyStaleNewestSymbols` fires correctly every morning. The response has always
been a manual per-symbol investigation — workable at 700 symbols, impossible at
3,000. And "no new bars" turns out to carry **at least three distinct causes**:

| Symbol | Cause | Signature, from the frozen series |
|---|---|---|
| `FI` | **renamed** 2025-11-11 | series ends **exactly 2025-11-11**, the rename day. A clean stop, NOT a four-week over-serving tail |
| `MMC` | **renamed** 2026-01-14 | **no bars at all** in the dump |
| `EA` | **delisted** 2026-08-05 | series ends 2026-08-10, five days after. Normal |
| `WBS` | unknown | series ends 2026-08-20 |
| `EQR` | one missed session | series ends 2026-09-04. Benign lag |
| `FISV` | rename **target** | healthy series to 2026-09-11, but a **blank industry** — the one place the rename left a real hole |

**Corrected 2026-09-12 from the frozen dump.** An earlier version of this table
said FMP "over-served the retired ticker ~4 weeks, then went quiet" for both MMC
and FI. `FI`'s series stops on the rename day itself, so there was no over-serving
tail for it. `MMC` has no bars in the dump at all, so nothing can be said about its
tail from this data. The original claim came from the same stamp-versus-series
confusion as the EA error.

### THE FOUR-WEEK TAIL IS NOT IN THE REPO'S DOCS ONLY — IT IS IN #431's COMMIT

This is the part worth not losing, because it is the clearest measure of what the
error cost. `b302968b` ("September loose ends", #431) states, in its own commit
message:

> MMC -> MRSH on 2026-01-14 (NYSE, rebrand to Marsh) and FI -> FISV on 2025-11-11
> (NYSE -> Nasdaq, reinstating the original ticker). **FMP kept serving each retired
> symbol for about four weeks after the change.**

Against the frozen dump, that sentence does not hold for either symbol:

| Symbol | #431's claim | Frozen series | Verdict |
|---|---|---|---|
| `FI` | ~4 weeks of bars after 2025-11-11 | last bar **exactly 2025-11-11** | **Contradicted.** Clean stop on the rename day, no tail |
| `MMC` | ~4 weeks of bars after 2026-01-14 | **no bars at all** | **Unsupported.** No data either way |

**One stamp-versus-series confusion produced three wrong rows, not two.** EA was the
one that got retracted loudly because it carried a dramatic conclusion; `FI` and
`MMC` are the quiet two, sitting in a merged commit message where nothing would ever
re-check them. The cost of reading a derived stamp instead of the series it was
derived from was not one bad finding — it was a bad finding, plus two claims about
upstream behaviour that had been accepted and recorded.

This does **not** disturb #431's actual change. The renames are real and verified
independently (dated exchange actions), the hand-edits to `presetUniverse.ts` were
correct, and the `#404` argument still stands — an eviction path treating "no new
bars" as "delisted" would still have wrongly removed two live S&P 500 mega-caps.
What falls is only the characterisation of *how* FMP behaved around the rename, and
with it the idea that a predictable "~4 week grace tail" is something the triage can
lean on. It is not a pattern; it was never measured.

**What replaces it:** nothing, deliberately. The frozen series gives three different
shapes for three renames/delistings (clean stop on the day, no bars at all, five days
past the event). Three symbols, three behaviours, no rule. That is itself the finding
— the bulk-file triage in this doc exists precisely because per-symbol upstream
behaviour is not predictable enough to encode.

Note what that does to the automation question. `#404`'s hand-edit rule exists
because eviction-on-no-bars would have wrongly removed MMC and FI. EA shows the
same rule would have been **right about EA for the wrong reason** — it was going
anyway, but not for the reason the bars suggested. Neither case supports
automating eviction on bar silence.

**The bulk file settles all of them in one pass, and that is the triage to build:**

```
symbol has no recent bars in the cache
  ├── Stooq HAS recent bars  ->  the upstream dropped it. Not a delisting.
  │                              Refill from the bulk file; keep the symbol.
  └── Stooq is ALSO silent   ->  the stock really stopped trading.
                                 Eviction candidate; confirm the corporate action.
```

One whole-market file answers it for every flagged symbol at once, with no
per-symbol web research and no per-symbol call. That is a capability the current
pipeline cannot have, because FMP is both the data source and the thing under
suspicion — there is no second opinion to consult. Stooq provides one.

**Build the triage, not the case files.** Per-symbol investigation does not scale
and it does not accumulate: each answer is about one ticker on one day. The
decision rule is reusable and runs for free once the file is parsed.

## What this does not excuse

The triage classifies; it does not decide. A symbol Stooq also lacks still needs
its corporate action confirmed before eviction — Stooq silence and delisting are
correlated, not identical, and Stooq's own coverage of the awkward shapes
(share classes, ADRs, LPs, thin caps) is exactly what A3 is for and is still
unmeasured. Do not wire eviction straight to the right-hand branch.

## The profile dataset was itself decaying, and Step 0 caught it

Worth recording because it is the clearest case of why the freeze was urgent
rather than tidy.

The dump found **651 of the 912 swept symbols carrying a non-empty industry and
sector** — against a `/cache-health` panel reporting Profile coverage as 50/885
with "94% have never been refreshed". The panel was counting refreshes; the values
were largely still there.

But `PROFILE_TTL_SECONDS` is **30 days**, and only ~50 had been refreshed. So
roughly **601 of those 651 were living out an old fetch on a rolling expiry** —
each one due to vanish 30 days after whenever it was last written, with nothing
scheduled to rewrite it and no free source able to reproduce FMP's taxonomy
afterwards.

**Step 0 earned its keep on this dataset alone.** A week later that number would
have been materially smaller, and the difference would have been unrecoverable —
not "harder to get", but gone, because SIC codes do not reproduce an industry
taxonomy and no other free source has FMP's labels.

It is also the sharpest illustration of the caveat this document is about: the
panel was *correct* about the thing it measured and *misleading* about the thing
anyone would act on. A refresh count and a value count are different questions,
and only one of them tells you what you still have.

### And the figure above was itself the wrong denominator — corrected

**Industry lives in TWO caches, and the healthier one is not the profile.**

| Cache | TTL | Refresh | Coverage of the 700 analysis universe |
|---|---|---|---|
| `msh:pickers:profile:v1:` | 30d | 50 of 885 ever | 78% — **decaying** |
| `msh:pickers:screener-fundamentals:v1:` | 30h | daily job | 99% — **healthy** |

`fundamentalsCache.ts` reads `industry: p?.industry ?? sc?.industry ?? null`, and it
**skips the profile fetch when the screener already has one**. So a screener-covered
symbol never gets a profile key, and that absence is expected rather than lost —
which is why the "missing profile" list was AAPL, AMZN, AVGO, COST and CSCO, the
preset mega-caps.

Measured from the frozen dump against the 700:

- **industry from either source: 699 — 99.9%**
- **sector from either source: 699 — 99.9%**
- **symbols missing industry OR sector: 1** — `BRK.B`. A symbol-shape issue rather
  than a data gap, but see below: the mechanism is the OPPOSITE of the obvious one.

So the taxonomy was never mostly in the decaying cache, the fallback is cosmetic,
and a backfill sized off the profile key alone would have fetched 154 symbols that
already had an industry.

### BRK.B: the dot-to-dash mapping is MISSING on this path, not applied

An earlier draft of this section said the gap was "likely a symbol-shape issue …
`buildFmpSymbol` maps dots to dashes", implying the mapping caused it. **That is
backwards.** `buildFmpSymbol` (`lib/server/historyCache.ts:378`) is the only
dot-to-dash mapping in the codebase, it is called from exactly one place
(`historyCache.ts:1320`), and that place is the **bars** path. Which is why `BRK.B`
has a healthy series and a blank taxonomy, not the reverse.

What the code actually says, all of it read rather than inferred:

| Layer | Symbol reaching FMP | Redis key |
|---|---|---|
| Bars (`historyCache.ts`) | `BRK-B` — `buildFmpSymbol` maps the dot | dotted, mapping is request-only |
| Fundamentals (`fundamentalsCache.ts`) | `BRK.B` — **no mapping exists on this path** | `msh:pickers:profile:v1:BRK.B` |

`cleanSymbol` **preserves** dots and hyphens by design, in both copies
(`lib/symbol.ts`, `fundamentalsCache.ts:183`) — "keeps the dot and hyphen that real
tickers use (BRK.B, PBR-A)". Every list in the repo stores the dotted spelling
(`curatedSymbols.ts`, `presetUniverse.ts`, `symbolSearch.ts`, `earningsCalendar.ts`,
`app/api/market/route.ts`). So `fundamentalsCache.ts:568` requests
`/stable/profile?symbol=BRK.B`, and `:692` keys the result on `BRK.B`.

**What is measured, and what is not.** Measured: the two paths disagree; only the
bars path maps; `BRK.B` is the only dotted ticker in the 700 and the only symbol
missing taxonomy from either source. **Not measured:** that FMP rejects the dotted
spelling. There is no FMP call available from the sandbox and no key to make one
with, so the upstream half of this is inference — strong inference, since
`buildFmpSymbol` exists at all only because FMP wants the dash, but inference.
Do not write it up as a demonstrated cause.

**The decisive measurement that IS available, and has not been taken:** whether the
frozen screener cache holds a `msh:pickers:screener-fundamentals:v1:BRK-B` key. The
screener is fed by FMP's own screener endpoint, so it reports FMP's spelling. If the
dashed key is in the dump, then the data was there all along under a name nothing
looks up, the cause is settled without any FMP call, and the fix is a mapping rather
than a backfill. That is a dump question, answerable from the existing artefact.

**Two consequences for the build.** The migration asset is the **union of both
caches**, and the dump froze both (2,609 screener entries). And when the Industry
fallback is designed it must read **the same either-source chain
`fundamentalsCache` does**, not just the profile key, or it will rediscover this in
production. Keep the `/cheap-tech-stocks` lesson attached: `sector` and `industry`
are separate fields, testing only `industry` left sectors null forever and truncated
a page, so the gap set is "missing industry OR sector".

## Related

- `claude/traps/a-reconstruction-cannot-corroborate-its-source.md` — the same
  shape one level up: a source cannot be the evidence for its own reliability.
- `claude/plays-builders-missing-single-flight-2026-09-12.md` — the other thing
  found by asking what the bound actually was rather than accepting the framing.
