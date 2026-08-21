# Session handover — 2026-08-21

Context a fresh session would not get from the traps corpus, the ISR doc, the
pre-check script or the commit messages. Unacted findings, half-formed
suspicions, and the inputs tomorrow's work needs.

Everything below is either **measured** (stated with its evidence) or
**suspected** (stated as such and not acted on). Nothing here is a conclusion
dressed as a fact.

**Line numbers are as of `3d4a696` and will rot** — PR #330 alone shifts
`pickersBuilder.ts` by ~30 lines. Every reference names the symbol or the source
line beside the number; if a line does not match, grep the symbol. A doc that
points confidently at the wrong line is the same failure this session spent the
day removing from the code.

---

## 1. Unacted findings, with locations

### `recencyScore = 100` is inert — MEASURED
`lib/server/pickersBuilder.ts:1963` (oversold) and `:2080` (overbought, written
as the literal `100 * 0.05`).

It adds **exactly 5.00 to every candidate** and can never separate two stocks.
The oversold composite therefore has five discriminating terms, not six, and an
effective range of ~95 rather than 100. It reads as a considered weight and is
dead weight. Nobody reading the file would notice; it looks like a scoring term.

Not removed: it changes every score by a constant, so it is behaviour-neutral to
ordering but not to any absolute threshold anyone has calibrated against. Wants
its own change.

### Penalties that are really membership criteria — MEASURED, report owed
The owner asked for a report on this and it was not written.

`advScore < 35 → +25` appears at `:1967`, `:2071`, `:2209`, `:2288`, and as
`+30` at `:2133`. It is a **liquidity floor wearing a penalty's clothes**: a
stock below the threshold is not "worse", it is not a candidate. Expressed as a
deduction it can be outweighed by a strong score elsewhere, which is not what a
floor means.

Same shape, less clear-cut: `dailyDrop1 < 0.6 && dailyDrop5 < 3 → +12` — that is
"has not actually dropped", which is closer to a membership question than a
scoring one for a page about oversold stocks.

The report should classify every penalty as *filter* or *score*, and say which
ones change list membership if converted.

### `scoreTargetBand` encodes a preference no single key can express — MEASURED
`lib/server/pickersBuilder.ts:2106`:
`scoreTargetBand(drawdownPct, 20, 35, 20, 65)`, plus `>50% → +20` and
`>60% → +15` penalties.

"Stocks Down 20% From All-Time Highs" rewards drawdown in a **20–35% band** and
deliberately buries a −60% stock. Ordering by raw `drawdownPct` would invert
that intent. This is the reason that family cannot take a single ordering key
without losing editorial information — see the B-family decision.

### `?t=Date.now()` cache-busters (PR-C, never started)
`/api/stock-valuation` and `/api/stock-analyst-rating` both return
**`200 + emptyPayload()` on failure**. A naive `s-maxage` would therefore cache a
failure as a success and serve it for the whole window. The cache-busters are
confirmed live on the client. Any caching work here must first make failure
distinguishable from empty — the `feedCache` `{items, ok, source}` shape is the
in-repo precedent.

### Never investigated
- `/api/internal/track-view` fires **twice** on one page load. Observed, never
  diagnosed.
- `MSH_TIMING` instrumentation shipped behind an env flag that was **never
  switched on**. The timing data it would produce has never existed.
- `/upcoming-ipos`: `numberOfItems` absent from its `ItemList`, and the meta
  description still claims price range / shares / deal size for rows that are
  upcoming and have none.

---

## 2. Suspicions, explicitly not acted on

### The overbought list is nearly twice the oversold list
259 vs 135 in production tonight. Could be market state (a broadly rising tape
produces more overbought names), or the two gates could be asymmetric in a way
nobody intended — `pickIsGreenOverallSignal` and `pickIsRedOverallSignal` look
symmetric (`>= 2 && >`), but the six underlying checks are not necessarily
symmetric in how easily each side fires. **Not investigated.** Cheap test: log
the per-check fire rate by direction over a few builds.

### The composite is mostly a step function
`comp.oversold * 12` and `comp.flagged * 3` are integer terms inside
`oversoldStrength`, weighted 0.3 — so 3.60 and 0.90 composite points per check.
The RSI contribution is continuous but weighted 0.45 *within* that clamp. The
practical effect is a coarse integer skeleton with continuous decoration, which
is why adjacent gaps cluster far below 0.90. Suspected consequence: most of the
ordering below the top ten is decorative rather than structural. Consistent with
the jitter results but not proven by them.

### Null-collapses-to-false is probably not confined to where it was found
`buildTrendScoreFromHistory` computes `priceAboveMA200` as
`typeof lastClose === "number" && typeof lastMA200 === "number" && lastClose > lastMA200`
— which yields **false** when a value is missing, not unknown. It is safe there
because the function early-returns at `< 220` closes, so nothing is missing by
the time it runs. That safety is incidental, not designed. The same
`typeof x === "number" && comparison` shape almost certainly appears elsewhere
without a guard in front of it. **Not swept for.** A grep for
`typeof \w+ === "number" &&.*[<>]` across `lib/` and `app/` would size it.

---

## 3. Inputs tomorrow's C-family work needs

### `take: 20` vs `maxItems: 36`
Both sections are built with `take: 20` (the two `buildSection` calls). The
screener pages set `maxItems: 36`. `PickerResultPage`'s `ranked.sort` orders
section members by section rank, then everything else by `entry.score`, then by
symbol. So:

- the **composite** decides the top-20 block and nothing else;
- the **secondary sort** decides ranks 21–36;
- the two boundaries behave differently under jitter (overbought crossed cut-36
  at 1.55/trial and cut-20 at 0.00).

### `kind` across the 32 picker pages — MAPPED
Do not re-derive this; the naive grep is misleading because `kind` also appears
inside filter predicates.

- **29 of 32** set `kind: "preset"` at the top level of their
  `PickerResultConfig`. A preset page ships the whole flagged universe with its
  filter pre-ticked and filters in place, then re-applies section ordering,
  badges and deep-links on top for whichever symbols are in the section.
- **3 set no `kind` at all**: `/stock-screener` (no `presetFilters` either — the
  unfiltered screener), `/top-stocks-with-buy-signals` and
  `/top-stocks-with-sell-signals` (both `presetFilters` only, no
  `sectionIncludes`, so they have **no section ordering to drop** and the
  A/B/C question does not apply to them in the same way).
- `kind: "number"` (7) and `kind: "category"` (2) are **filter predicates**
  inside `presetFilters` arrays — e.g.
  `{ kind: "number", field: "peRatio", max: 20 }` in
  `/cash-rich-value-stocks`. They are not config kinds and a
  `grep -c 'kind:'` conflates them.

All 32 carry `maxItems: 36`; only the section-backed ones are additionally
capped at 20 upstream by `take: 20`.

### Three `ItemList` position emitters on the picker surface
`app/components/PickerResultPage.tsx:1030` (the `ItemList` `itemListElement` map),
`app/bullish-divergence-stocks/page.tsx:216`,
`app/bearish-divergence-stocks/page.tsx:216`.

Changing only the first leaves the two divergence pages claiming positions. The
other eight emitters in the repo (insights, headlines, IPOs, bottlenecks,
earnings calendar, sector, utilities, pickers hub) are different content, mostly
chronological, and are a separate decision.

### The jitter instrument's `each` mode samples, it does not sweep
`mode=each` perturbs `base[t % base.length]` once per trial, so `trials=20`
against a 135-stock list examines **20 of 135**, always the first 20 by score.
Fine for "are the top names fragile", wrong for "which names are fragile".
Raise `trials` to the list size for a full sweep.

---

## 4. Sandbox reachability — retested tonight, 2026-08-21

`CLAUDE.md` says to re-test rather than trust the recorded list. Retested:

- **Blocked:** `financialmodelingprep.com`, `api.financialmodelingprep.com`,
  `www.mystockharbor.com` — all `403 CONNECT tunnel failed` from the agent proxy.
- **Absent:** `FMP_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
  are unset. No `.env` file.
- Consequence: **every production measurement this session came from the owner
  running a debug route and pasting the result.** A fresh session cannot fetch
  its own preview, the live site, or FMP, and cannot run the picker diagnostics
  itself. Design instruments to be *owner-runnable and paste-friendly*, which is
  why `/api/debug/picker-structure` returns names rather than only statistics.

---

## 5. Open decisions that are the owner's, not investigations

Do not start these unprompted; they were explicitly reserved.

- Whether `ItemList` should emit `position` at all (decision taken: option 1 for
  C-families, option 2 for A-families once ordering is by a shown column).
- Whether a score column changes what the ordering claims.
- The `unstable_cache` freshness call on `fetchQuoteFromFmp` — it gates
  `generateStaticParams` returning to the two insight routes. Precedent to weigh:
  `/stock/[symbol]` already accepts up to 900s via ISR while refreshing
  client-side (#286). Staleness is acceptable when something visibly corrects
  it; not when it is presented as live.
- The held three-copy `buildTrendScore` consolidation — scoped as **null
  propagation at call sites**, not "one shared function", because
  `buildTrendScoreFromHistory` already returns null correctly and its caller
  laundered it into a 50.
- Vocabulary standardisation across trend labels ("Bullish trend" / "Mixed /
  range" / "Counter-trend bounce" on the news surfaces vs "Uptrend" /
  "Downtrend" elsewhere) is a **content** decision and must not be folded into a
  refactor.

---

## 6. Trap entries owed

Written up in conversation, never committed to `claude/traps/`. Each has a
verified instance from this session:

1. **Run the corpus against the fix, not just against the bug.** Six instances
   today: `Promise.allSettled` (#305), `buildHeroLede`'s ternary (#316),
   `known: true` (#317), `ran = 1` (#321), the static-safety scanner matching
   `unstable_cache` inside its own comment (#324), and `mode=each`'s pooled
   median being 0 by construction (#327).
2. **A `!==` comparison silently accepts a new null.** Widening a type to
   include null is safe for `===` chains and unsafe for `!==` ones.
   `buildBeyondHeadline` asserted price "keeps holding above important
   structure" for a stock whose structure was never established (#319).
3. **A truthiness guard on an optional input silently changes the default
   outcome**, and the direction is invisible at the call site. `trendScore &&`
   read as a null check while granting a 10-point benefit (#325).
4. **Present is not reachable, the same way absent is not clean.** #317 searched
   for a function name and missed inlined copies; #318 read a definition and
   assumed it ran. Both reachability errors, opposite directions.
5. **Ask "is it cached" at every layer of the read path.** Confirming a
   computation re-runs says nothing about whether its inputs changed — the
   6-hour history TTL would have invalidated a whole market session's
   reproducibility test.
6. **A check that under-fires reads as stability.** `Number(null)` is `0` and `0`
   is finite, so absent params clamped to the minimum and a bare `?jitter=1` ran
   one trial at a tenth of the designed magnitude (#328).
7. **Read a value's magnitude at the site that uses it, not at a site that
   shares its name.** Two different `structureScore` variables, weighted 0.05
   and 0.2; the wrong one was quoted twice in a report.
8. **Inferring structure instead of asking the parser.** Hand-rolled brace
   counting mis-detected a declaration span and corrupted a file; the TypeScript
   AST did it correctly (#320).
