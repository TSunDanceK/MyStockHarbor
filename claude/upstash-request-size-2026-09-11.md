# Brief: Upstash 10MB max-request-size breaches

**Date raised:** 2026-09-11
**Status:** diagnosed by elimination, not yet confirmed by instrumentation
**Owner:** Claude Code (files involved exceed what the GitHub connector can edit)

---

## 1. The symptom

Upstash has sent "Your Max Request Size Limit is Reached" for MSH-Market-Cache
three times:

| Date | Time (UK) | Time (UTC) |
|---|---|---|
| Sat 2026-09-05 | 08:21 | 07:21 |
| Mon 2026-09-07 | 08:21 | 07:21 |
| Thu 2026-09-10 | 08:22 | 07:22 |

The email says the 10MB limit was hit "at least 1 times in the last 15 minutes".
The database is on Pay As You Go; the plan is deliberately NOT being changed.

Two properties of that table matter:

- **Near-identical minutes.** A 15-minute detection bucket over a variable event
  time would scatter more than one minute. A fixed lag from a fixed-time job
  produces this. Treat the alert time as `job time + constant`, not as the
  event time.
- **Saturday is in the list.** Whatever fires it does not depend on the market
  being open.

## 2. What operations exceeding the limit actually do

They **return an error**. They do not truncate. So the affected write fails and
the previous value stays in place under its existing TTL. Nothing downstream
notices until that TTL lapses. This is why there is no user-visible damage and
no error in Vercel logs — the failure is caught and swallowed by the fail-open
handlers that are (correctly) everywhere in this codebase.

**Do not treat "the site is fine" as evidence the problem is minor.** The
failure mode when it finally bites is a picker payload that silently stops
updating.

## 3. Candidates eliminated, with evidence

Recorded so nobody re-litigates these.

| Candidate | Measurement | Verdict |
|---|---|---|
| `msh:earnings-quoted-symbol:v1:*` written in one pipeline | SCAN to cursor `0` returned ~430 keys, not thousands | innocent |
| `msh:earnings-day-items:v1:*` | `MEMORY USAGE` = 2,391 bytes | innocent |
| `historyCache.ts` MGET chunks of 40 | `STRLEN msh:history:v7:AAPL` = 120,439; `:A` = 118,167. 40 x 120KB = 4.8MB | innocent — the 110KB assumed in the file comment still holds |
| `fundamentalsCache.ts` `SCREENER_WRITE_CHUNK = 500` | `STRLEN msh:pickers:screener-fundamentals:v1:AAPL` = 177 bytes. 500 x 177 = 88KB | innocent |

**Remaining candidate:** `msh:pickers:v9:charts-off-payload`.
`STRLEN` = **7,248,807** (6.9MB stored).

## 4. Why 6.9MB stored can breach a 10MB request limit

The limit applies to the **request body**, not the stored value.

`redis.set(key, object)` in `@upstash/redis` JSON-stringifies the object, and
that resulting string is then embedded in the REST command array
`["SET", key, "<payload>"]` — which is itself JSON. Every `"` in the 6.9MB
payload is escaped to `\"` on the way out. For an object with many short string
fields, quote density is high.

A 15% inflation puts the wire size around 8.3MB. That is ~80% of the ceiling,
on a value that grows with `UNIVERSE_CAP` and with the record shape. It breaches
on the days it runs slightly fat and succeeds on the days it does not — which is
exactly the intermittent Sat/Mon/Thu pattern.

**This is inference, not measurement.** Task 1 below exists to replace it with a
number. Do not skip it because the rest of the brief sounds confident.

## 5. The actual defect, stated generally

Chunk sizes in this codebase are bounded by **command count**, not bytes:

- `fundamentalsCache.ts` — `SCREENER_WRITE_CHUNK = 500`
- `dynamicUniverseCache.ts` — chunks of 500
- `stalenessQueue.ts` — chunks of 500
- `symbolEviction.ts` — chunks of 500
- `pickersBuilder.ts` — the payload written as **one unbounded value**

A command count is a proxy for request size that holds only while per-record
size stays put. All four of the 500s are comfortably safe *today* (see the table
in §3). They are safe by luck, not by construction, and nothing in the code
notices when a record shape grows.

Fix the pattern, not just the one site that is currently firing.

## 6. Design decisions — already made, do not re-open

**6.1 Byte budget is 5MB of serialized value per request.**
Not 9MB, not "10MB minus a bit". The escaping inflation is real but not
precisely known, and command overhead sits on top. 5MB leaves ~2x headroom and
costs nothing — these are pipelined writes on a plan where commands are
unlimited and bandwidth is the constraint. Chunking into two 3.5MB requests
moves the same bytes as one 7MB request.

**6.2 The pickers payload gets chunked, not shrunk.**
Shrinking the payload (dropping fields, tightening the record shape) is a
data-shape change with site-wide consequences and is out of scope. Chunking is
mechanical and reversible.

**6.3 Chunked writes flip a pointer last.**
Writing chunks `:0`, `:1`, ... in place would let a concurrent reader observe a
half-written set. Write all chunks under a build-scoped key, then write the
manifest/pointer key as the final command. A reader that sees the old pointer
reads a complete old payload; a reader that sees the new pointer reads a
complete new one. Never a mix.

**6.4 Bump the payload key version to `v10`.**
`msh:pickers:v9:charts-off-payload` is a single string; the new shape is a
manifest plus chunks. Do not overload the same key with two shapes. Leave v9 to
expire on its own TTL.

**6.5 Give `warmTargets` its own symbol-list key, written at build time.**
The long comment block in `lib/server/warmTargets.ts` argues against this, on
the explicit grounds that it "means writing to this key from pickersBuilder.ts,
a 117KB file that cannot be edited through the GitHub connector."

**That constraint does not apply to Claude Code.** The comment's reasoning was
tooling-bound, not design-bound. With the connector limit gone, the argument
collapses and the clean shape is available: the builder writes the symbol list
to its own small key, and `getWarmTargetSymbols()` never touches the big payload
at all.

Update that comment block to say so. Do not silently delete it — it is a dated
record of a real constraint, and the note should read as "this was true of the
connector, and Claude Code is why it no longer binds."

Note also: `pickersBuilder.ts` is now **190,930 bytes**, not the 117KB the
comment cites. Correct that number while you are in there.

## 7. Tasks

**Task 1 — Instrument first. Do this before any other change.**
Log the serialized byte length of every large write, at minimum the pickers
payload write. One line, `console.log`, in the existing log style
(`[pickers] payload write: N bytes serialized`). Ship this on its own if you
like — it converts the next Upstash email from a puzzle into a datapoint, and it
is the only thing here that is urgent.

**Task 2 — Shared `chunkByBytes()` helper.**
New file, `lib/server/chunkByBytes.ts`. Takes items and a serializer, yields
groups whose combined serialized length stays under the budget from §6.1.
Single item over budget: yield it alone and log a warning rather than throwing —
fail-open is the house style and a stuck warm job is worse than an oversized
request.

**Task 3 — Convert the four count-based chunk sites** (§5) to use it. Behaviour
should be identical today; this is about the sites being correct by construction
when record shapes grow.

**Task 4 — Chunk the pickers payload write** in `pickersBuilder.ts` per §6.2–6.4.
Update `readPickersCache()` / `readPickersSymbolsIfCached()` to reassemble via
MGET, keeping `readPickersSymbolsIfCached()` cheap — it exists specifically to
avoid the expensive path and must not regress into it.

**Task 5 — `warmTargets` symbol-list key** per §6.5.

**Task 6 — Self-fetch fix in `pickersBuilder.ts`, lines 2256–2332.**
Long-standing backlog item, blocked on the same file-size constraint. Separate
commit. Bundled here only because it is the same file and the same trip — if it
complicates the review, drop it and leave it in the backlog.

## 8. Verification

- `npx tsc --noEmit` clean.
- Confirm the emitted picker pages contain real data, not an empty state. A
  green route table in the Vercel build is **not** sufficient evidence — this
  has bitten before.
- **Do not verify on a preview URL.** Preview and production share the same
  Upstash instance, and browsing picker pages on a preview writes to versioned
  production cache keys. A v10 payload written from a preview is a production
  write.
- After merge, watch for the `[pickers] payload write: N bytes` line and record
  the real number. If it is materially under 10MB, say so plainly — the
  diagnosis in §4 would then be wrong and the investigation reopens.

## 9. Unrelated, found while reading logs

`warm-screener-fundamentals` is erroring daily on two hardcoded symbols in
`lib/server/presetUniverse.ts` that cannot be auto-evicted:

- `MMC` — last daily bar 2026-02-09 (152 trading days ago)
- `FI` — last daily bar 2025-12-08 (197 trading days ago)

Both look renamed, acquired or delisted. Needs a hand edit to that array. Not
part of this brief; raised so it is not lost.
