# News as a stored dataset — spec

**Status: GATE PASSED 2026-08-22, BUILT 2026-08-31.** `from=` filters — the
probe result is recorded in the table at the foot of this file. The store, the
merge/pin/cap rules and the staleness registration are implemented; the sector
half is wired but its dedup threshold is still uncalibrated for sector traffic
(see "Sector news").

Owner's design, 2026-08-22. Transcribed here as the design of record; the
wording is the owner's, the notes marked *(implementation note)* are not.

---

## The gate — verify before building anything

The whole design rests on FMP honouring `from=` on `/stable/news/stock`. That
parameter is in the endpoint's signature but **nobody has confirmed it filters
rather than being silently ignored.**

Probe it in `/api/debug/fmp-endpoints` the same way the earnings-source probes
were added: `from=<yesterday>` versus no `from`, and report the oldest
`publishedDate` in each response. **A 200 whose oldest item predates `from`
answers no as firmly as a 402 does.**

If `from` is ignored: stop and report. Incremental fetching is then impossible
and this collapses to tuning `limit`, which is a different and much smaller job.

*(implementation note)* Claude's sandbox cannot reach `financialmodelingprep.com`
— `403 CONNECT tunnel failed`, retested 2026-08-22 — so this probe is
owner-side. Do not start building until the probe has been run and its result
recorded in the table at the foot of this file.

**Answered 2026-08-22 — see the Probe result table below. The account of the
false start is kept because the lesson outlives the question.**

**Status at the time: still unanswered, and the reason is worth recording.** The
owner ran `/api/debug/fmp-endpoints` against production (`55c8bc86`) and the
response carried no `newsFromGate` block — because the gate probe was on an
unmerged branch and production was running code that predates it. Every *other*
probe in that run returned real results (see "Measured" below), which is exactly
what makes this the easy mistake: the response looked complete. **A probe that is
not deployed returns no evidence, and no evidence is not a negative result.**

### If the gate fails — the fallback, and it is not nothing

**Owner-accepted 2026-08-22, superseding the original "collapses to tuning
`limit`" framing.**

A failed gate does *not* collapse this to tuning `limit`. Even with `from`
ignored, storing news in Redis still buys:

- persistent earnings articles (the earnings pin, which only persistence makes
  possible at all),
- no FMP call on render,
- news on the cache health page like every other dataset.

Only the **incremental saving** is lost: each refresh re-fetches the same window
instead of just the new tail, so refresh bandwidth stays where it is today.

Recorded here explicitly so the fallback does not vanish if the probe comes back
FAIL. A FAIL narrows the win to correctness; it does not remove it.

---

## The change

News moves into Redis:

- `msh:news:v1:<SYM>`
- `msh:sector-news:v1:<SLUG>`

Page renders read Redis and **make no FMP call**. News appears on the cache
health page like every other dataset. That is what `RENDERING_POLICY.md` asks
for and how price pool, fundamentals and stock data already work.

*(implementation note)* `RENDERING_POLICY.md` is referenced by
`lib/insightSnapshots.ts:204` and `app/components/NewsScoreGauge.tsx` but does
not exist anywhere in the repo. Same doc-drift class as the CLAUDE.md/trigger
divergence recorded in `CLAUDE.md`'s own "Lessons learned". Flagged, not fixed.

---

## Population is lazy — never a warm cron

**The most important constraint.** Warming 755 symbols hourly would dwarf every
other consumer on a 20 GB budget.

- First visit populates.
- Later visits read Redis.
- Unvisited symbols cost nothing.

**Do not add news to `vercel.json`.**

---

## Refresh

- **Cold start:** fetch `limit=15`, no `from`.
- **Thereafter:** `from = newestStored − 6h`, `limit=15`, merge by link, apply
  the similarity dedup from #343, keep newest ~40, evict.

The 6-hour overlap **isn't padding**. Fetching strictly from `lastSeen` loses any
article FMP back-dates, and that loss is **silent and permanent** because the
window has already moved past it.

**Store deeper than you display.** 5 + 10 = 15 after dedup, so a store of exactly
15 comes up short the moment dedup drops three.

---

## Earnings pin

Once an article qualifies it stays until **replaced by a newer qualifying
article, or 7 days, whichever comes first.**

Replacement is the primary rule; the timer is the backstop.

This is the part **only persistence makes possible** — today an article vanishes
the moment it leaves FMP's latest-N window regardless of relevance.

---

## Measured, 2026-08-22 — what the probes came back with

Run against production. These are results, not assumptions.

### There is no dedicated earnings source on this plan

| Probe | Result |
|---|---|
| `news/press-releases?symbols=…` | **402** |
| `news/press-releases-latest` | **402** |
| `press-releases/{symbol}` (v3) | **403** — legacy, pre-Aug-2025 subscribers only |
| `earning-call-transcript-latest` | **402** |

**Item 2b is closed.** The keyword filter over the general feed cannot be
replaced — only kept or removed.

**Consequence, owner-approved:** the earnings *news card* on
`/stock/[symbol]/news` is removed entirely. The structured Earnings Snapshot
directly above it already carries actual EPS, revenue, surprise and margins, and
the card would be empty far more often now the word-boundary matcher has stopped
counting "headquartered" as earnings coverage. An empty card beside a full
snapshot is worse than no card.

The lib-side `fetchEarningsNews` / `scoreEarnings` path **stays** — it still
feeds the Earnings Tone reading and the lead summary. Only the card is gone.

### `symbols=` accepts a list — confirmed

`news/stock?symbols=<10 tickers>&limit=100` returned **100 articles across 10
unique symbols in a single call.** One call covers ten constituents instead of
ten calls.

This changes the sector half of this design — see below.

### Sector performance endpoints are available

`sector-performance-snapshot` returns all 11 sectors in one call;
`historical-sector-performance` works too.

**The trap, and it is a live one.** FMP's `averageChange` is **equal-weighted and
split per exchange**. `lib/server/sectorPanels.ts` computes a **cap-weighted**
read over the top 25 names of our universe. Same name, same units, *different
metric* — so swapping one for the other changes every number on the page while
nothing errors, and the shift reads as a data bug rather than the definition
change it is. Recorded at the call site in `sectorPanels.ts` as well as here.

Not an argument against adopting it: one call for 11 sectors is a real saving.
An argument for making the switch a deliberate decision with the label updated,
never a quiet substitution.

### Index changes — unprobed until now

`lib/server/indexChanges.ts` calls all three `historical-*-constituent`
endpoints, and the **plain** `sp500-constituent` variants all answer 402. The
historical variants were never probed. `fetchIndexChanges` swallows a non-ok
response, so if they are restricted too the feature renders "no recent index
changes" — indistinguishable from a genuinely quiet week, forever. All three are
now in the probe set.

---

## Sector news

Same mechanism, per-sector key, more articles, **no earnings pin.**

This retires the `isMajorWireSource` gate in `sector-news-data.ts` **as a side
effect rather than as a separate job.**

Dedup matters far more there — ~40 constituents means market-wide stories arrive
many times over — so **check the threshold behaves on that traffic rather than
assuming it carries over.**

**One call per ten constituents, not one per constituent.** `symbols=` is
list-aware (measured above), so a 40-constituent sector refreshes in ~4 calls,
not 40. This is what makes the sector half affordable at all, and it is a
measured fact rather than an assumption about the parameter's documentation.

*(implementation note)* The existing `lib/sector-news-data.ts` already chunks at
`SECTOR_NEWS_CHUNK_SIZE = 20`, so it is already exploiting this. The finding
confirms the current cost model rather than unlocking a new one — worth stating
plainly, because "confirmed what we already do" and "found a new saving" are
different results and only the first one is true here.

*(implementation note)* The #343 threshold is `STORY_OVERLAP_THRESHOLD = 0.6`,
an overlap coefficient against the smaller token set. It was calibrated on
single-ticker traffic. Sector traffic is the case it was never tested against —
~40 constituents means a market-wide story arrives many times over, which is
both the case dedup matters most for and the case the threshold has never seen.

---

## Instrumentation

Instrument it as a dataset:

- Staleness sets.
- Record **how many items each refresh actually added.** Zero on a quiet hour is
  **healthy, not a failure** — the same absence-versus-zero distinction the jobs
  table and the Signals column both needed.
- **Report cold-start fetches separately from incremental ones.** If cold starts
  dominate, the store is being missed or evicted and the whole saving is
  illusory while looking fine.

---

## Don't claim a bandwidth figure

The 34% number is an **upper bound** — `fmpFetch` records Data Cache hits too.

Build this for the **correctness win**: persistent earnings articles, no FMP
call on render, news on the health page. Treat the bandwidth reduction as a side
effect, and let `?dashboardGb=` answer it once three days of counters exist.

---

## Probe result

*(To be filled in by whoever runs the gate probe. Until this section names a
result, the design is not cleared to build.)*

**Run 2026-08-22. VERDICT: PASS — `from=` filters. Design cleared to build.**

| Probe | HTTP | rows | oldest `publishedDate` | verdict |
|---|---|---|---|---|
| `news/stock?limit=50` (no `from`) | 200 | 50 | 2026-08-19 11:45:00 | baseline |
| `news/stock?limit=50&from=2026-08-21` | 200 | 20 | 2026-08-21 03:05:00 | **PASS** |

The `from` row's oldest article is on or after `from`, and the baseline reaches
two days further back, so the parameter is being honoured rather than ignored.

**Measured payloads:** 35,249 bytes for the 50-row baseline (705 bytes/article);
14,363 bytes for the 20-row filtered response (718 bytes/article).

**The per-article cost is UNCHANGED.** `from=` compresses nothing — the two
figures are the same number per article within noise. The saving comes entirely
from not re-fetching articles already held, which is only a saving once they are
persisted. **Tuning `limit` alone does not unlock it**, which is why the store
had to come first.

**Also probed:** `HEAD` returns 200 with no `Content-Length`, and the response is
a bare array with no envelope. There is no way to learn how many articles exist
without retrieving them, so the count must come from our own store rather than
from FMP — which is what the cold-versus-incremental counters in `newsStore.ts`
are for.

**Reading it:** if the `from` row's oldest `publishedDate` is on or after
`from`, the parameter filters and the design is cleared. If it matches the
baseline's oldest date — or is anywhere before `from` — the parameter is being
ignored and the design stops here.
