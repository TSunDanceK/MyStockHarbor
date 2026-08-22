# News as a stored dataset — spec

**Status: BLOCKED AT THE GATE.** Nothing below has been built. The design rests
on one unverified assumption and the verification cannot be run from Claude's
sandbox. See "The gate" immediately below.

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
owner-side. The probes are built and shipped; the answer is not. Do not start
building until the probe has been run and its result recorded in this file.

*(implementation note)* Worth stating so the fallback is not overstated: if
`from` is ignored, the *store* is still buildable — cold-start-shaped refreshes
(`limit=15`, no `from`) merged into Redis would still buy persistent earnings
articles, no FMP call on render, and news on the health page. What is lost is
the incremental *saving*, since each refresh re-fetches the same window. The
owner's judgement is that this collapses to tuning `limit`; that call stands,
and this note only records what the fallback would and would not still deliver.

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

## Sector news

Same mechanism, per-sector key, more articles, **no earnings pin.**

This retires the `isMajorWireSource` gate in `sector-news-data.ts` **as a side
effect rather than as a separate job.**

Dedup matters far more there — ~40 constituents means market-wide stories arrive
many times over — so **check the threshold behaves on that traffic rather than
assuming it carries over.**

*(implementation note)* The #343 threshold is `STORY_OVERLAP_THRESHOLD = 0.6`,
an overlap coefficient against the smaller token set. It was calibrated on
single-ticker traffic. Sector traffic is the case it was never tested against.

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

| Probe | HTTP | rows | oldest `publishedDate` | verdict |
|---|---|---|---|---|
| `news/stock?symbols=MU&limit=50` (no `from`) | | | | baseline |
| `news/stock?symbols=MU&limit=50&from=<yesterday>` | | | | |

**Reading it:** if the `from` row's oldest `publishedDate` is on or after
`from`, the parameter filters and the design is cleared. If it matches the
baseline's oldest date — or is anywhere before `from` — the parameter is being
ignored and the design stops here.
