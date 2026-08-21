# `Promise.all` reports the FIRST rejection, not the only one

`Promise.all` rejects with whichever promise rejected first and discards the
rest. A diagnosis built on its error therefore names **one failure out of an
unknown number**, and reads exactly like a complete answer.

`indexChanges` fetched three constituent endpoints under one `Promise.all`. The
build log said:

```
Error: FMP Dow Jones constituent history failed: 402
```

That produced a confident and wrong conclusion: *the Dow endpoint is
plan-restricted, the other two are fine, so degrade per-index and the page
recovers.* Unit tests were written to that premise, passed, and were faithful to
it.

Switching to `Promise.allSettled` — for the robustness fix, not to investigate —
showed what the channel had been hiding:

```
[index:additions] S&P 500    constituent history unavailable … failed: 402
[index:additions] Nasdaq 100 constituent history unavailable … failed: 402
[index:additions] Dow Jones  constituent history unavailable … failed: 402
```

**All three.** The page could never have been fixed by per-index degradation,
because there was no surviving index. The change's real value was disproving its
own premise.

This is the same shape as `return-type-cannot-express-failure` (`[]` meaning
both "empty" and "failed"): a
**lossy channel presented as an answer**. One rejection out of three is not "the
failure", it is *a sample of size one from a set whose size you do not know*.

**The rule:** when several independent calls sit under one `Promise.all` and one
fails, you have learned that **at least one** failed. Before building anything
on which one, re-run with `allSettled` and enumerate. The cost is one change;
the alternative is a fix designed against a fault that was never the whole
fault.

Related, and the reason this stung: the 402 on FMP's constituent-endpoint family
was **already known and already worked around** in `app/api/market/route.ts`,
where the same restriction had silently pinned the discovery universe to its
static fallback. That comment even records the same lesson — "it went unnoticed
for as long as it did precisely because the failure was invisible". A second
module was later written against the same endpoint family without the
connection being made. Grep for the endpoint, not just the symptom.
