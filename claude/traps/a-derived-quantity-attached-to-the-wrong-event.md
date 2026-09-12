# A derived quantity attached to the wrong event

Found 2026-09-12, immediately after the residual defect in
`claude/traps/a-residual-cannot-validate-its-own-total.md` — same number, a
second and independent error in it.

The instrumentation cost was stated as **12,600 write commands per pickers
build**: ~2,100 single-symbol history reads × 6 billed writes each. From that,
a build rate of ~2/day was inferred, and from *that*, a conclusion that a
24-hour payload TTL would save about one build a day.

**The pickers build does not make those reads.** `pickersBuilder.ts` imports
`getDailyHistoryBulk` only (`:3386`, `:4429`), and the bulk path calls
`recordRedisRead("history-bulk", normalized.length, caller)` **once per call,
before the chunk loop** (`historyCache.ts:1604`, `:1775`). The pickers build
therefore costs **~12** instrumentation writes, not 12,600 — overstated 1,050×.

The per-symbol reads belong to the three plays builders, which call the singular
`getDailyHistory(symbol, …)` and `getCachedDailyHistory(symbol, caller)`. And
those are **not driven by pickers builds at all**: they are ISR-driven at
`revalidate = 1800` on `/plays`, `/plays/bull-flags` and
`/plays/descending-triangles`, with **no cron in `vercel.json`**. The event is a
plays-page regeneration — different cadence, traffic-triggered, and capped at 48
windows/day/page rather than by any build rate.

So the arithmetic was sound and the unit was wrong. "Per build" was never a unit
this quantity had, which also silently invalidated the payload-TTL conclusion
derived downstream of it.

- **A rate needs the event named and checked, not assumed from context.** The
  discussion was about pickers builds, so "per build" was never questioned. The
  fix was one grep for which history function each builder imports.
- **Two call shapes for the same data are two different costs.** Bulk and
  singular move identical bytes at wildly different command counts, and the
  meter's own header says the loop shape "is not a property of the bytes" — true
  of bandwidth, false of commands.
- **When a premise is withdrawn, withdraw what was derived from it.** The
  payload-TTL conclusion may still be right; it now rests only on
  `claude/history-read-path-2026-09-04.md`, which is independent evidence.
