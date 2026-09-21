# The SEC state writes are not the 10MB breach — measured, and what is now guarded

**Date:** 2026-09-21
**Follows:** `claude/upstash-request-size-2026-09-11.md` (the original brief), #427 (instrumentation), #428 (chunking)
**Status:** candidate disproven with production numbers; the coverage gap it exposed is closed

---

## 1. The question

Upstash keeps sending "Your Max Request Size Limit is Reached" for
MSH-Market-Cache. The standing candidate was `lib/server/secManifest.ts`'s
`writeManifest()`: a single unchunked
`redis.set(SEC_MANIFEST_KEY, {...manifest, updatedAt})` covering every symbol's
full entry, with no byte guard — the exact shape the pickers payload had before
#428, and a shape `scripts/check-request-size.mjs` did not look at.

Two things were asked first: confirm the check really does not cover it, and
measure the manifest rather than trusting the file's own "a few hundred KB"
docblock.

## 2. The coverage gap — confirmed

`scripts/check-request-size.mjs` read exactly two files:

```
const builder = readCodeOnly("lib/server/pickersBuilder.ts");
const helper  = readCodeOnly("lib/server/chunkByBytes.ts");
```

`secManifest.ts` and `secTickerMap.ts` appeared nowhere in it, in any section.
This is the gap the brief's own §5 warned about — "fix the pattern, not just the
one site that is currently firing" — left open in the guard written for that
very sentence.

## 3. The manifest, measured

`sec-daily-index` in production, **2026-09-21 04:00:16 UTC**:

```json
{"ok":true,"universe":822,"withCik":818,"tickerMapCount":10438,
 "tickerMapSource":"redis","symbolsWithExchange":10219,"redisCommands":3,"ms":493}
```

`universe` here is `Object.keys(manifest.symbols).length` — the manifest's own
entry count, not the analysis universe. **822 entries.**

Per-entry size, from `emptyEntry()` lifted out of the module itself (this is
what `scripts/check-request-size.mjs` §5 now recomputes on every run, rather
than trusting a number typed here):

| entry shape | bytes incl. key | 822 entries, request body |
|---|---|---|
| `emptyEntry()` — seeded, nothing read yet | 368 | **0.31 MB** |
| typical — step-3 populated (`contentHash`, accession, the `w`/`y`/`c` trio) | 611 | 0.51 MB |
| every optional field present | 792 | 0.66 MB |

Against a **10 MB** ceiling that is **3.1% – 6.6%**. The header's "comfortably
inside" was right.

Escaping is applied at **×1.073**, not the ×1.15 the original brief assumed.
That is measured, from #428's own log line on the same morning:
`6,049,468 bytes serialized value → 6,491,458 bytes total request body`. The
brief said plainly that its 15% was inference; it turned out to be conservative
by roughly half.

## 4. The ticker map, measured

`lib/server/secTickerMap.ts` writes `TICKER_REDIS_KEY` the same unchunked way.
It is the larger collection by twelve times — **10,438 tickers** on that same
run — but each row is `{cik, exchange}` rather than a twenty-field
`SecManifestEntry`, so it lands around **0.6 MB**, about **6%** of the ceiling.
Weekly cadence on top of that. Also innocent.

## 5. The clock rules both of them out anyway

The alerts are at **07:21–07:22 UTC**. `vercel.json`:

```
/api/jobs/sec-daily-index   0  4 * * *      04:00 UTC
/api/jobs/sec-facts        20  4 * * *      04:20 UTC
```

Both SEC writes happen **three hours before** the window the emails describe.
Even if the size had been marginal, the timing would not fit. What does run in
07:06–07:22 (the 15 minutes an 07:21 email covers) is `warm-picker-universe`
(07:02, ~203 s, so its writes land ~07:05–07:06), `warm-earnings` (07:15),
`warm-stock-data` (07:17) and `warm-fundamentals` (07:22).

## 6. Where the breach is NOT, as of today

`warm-picker-universe`, production, **2026-09-21 07:02 UTC**:

```
[pickers] payload write (chunked): 700 records in 2 chunk(s) under a 5242880-byte
budget, 4 requests, 6049468 bytes serialized value, 6491458 bytes total request
body (+7.3% escaping), largest single body 5571257 bytes (53.1% of the 10MB
request limit), manifest muawiwn4-ypydoi
```

**53.1%.** #428's chunking is doing its job. Vercel's runtime-error table shows
no Upstash size error in the last 7 days and no error or warning at all in
06:50–07:40 on 2026-09-21.

**That last sentence is not evidence of absence** and must not be read as one.
§2 of the original brief is the reason: an over-limit operation returns an
error, every write path here is fail-open, and several of the relevant catches
are *completely silent* — `earningsSchedule.ts` and `pricePool.ts` both have
bare `catch {}` around a whole-collection write. A rejection there reaches
neither Vercel nor anyone's screen. The Upstash email remains the only detector,
and it names a database and a fifteen-minute window: no key, no route, no
command.

## 7. So what is it?

**Not established, and not guessed at here.** Every whole-collection write was
sized against real production counts and none of them reaches 10 MB:

| key | count | shape | projected body |
|---|---|---|---|
| `msh:pickers:v10:chunk:*` | 700 records | chunked by bytes | 5.57 MB (53%) |
| `msh:sec:tickers:v2` | 10,438 | one SET | ~0.6 MB |
| `msh:earnings-schedule:v1` | 13,354 | one SET | ~0.6 MB |
| `msh:sec:manifest:v1` | 822 | one SET | ~0.3–0.7 MB |
| `msh:picker-charts:v1` | 700 fields | HSET in 40s | ~0.44 MB |
| `msh:price-pool:v1` | 759 fields | one unchunked HSET | small rows |

Rather than pick a suspect by elimination for a second time,
`/api/debug/redis-write-sizes` now answers it directly: STRLEN/HLEN per
candidate key, ranked by projected request body, one keyed request, no value
ever pulled back. **When the next email arrives, hit that route first.**

Two things worth carrying into that investigation:

- **`enableAutoPipelining` defaults to TRUE** — verified in the installed
  `@upstash/redis@1.38.2`: `opts?.enableAutoPipelining ?? true`. Concurrent
  commands collapse into ONE request body. `getDailyHistoryBulk`'s forced pass
  runs `Promise.all` over `createLimiter(10)`, and each task ends in a
  `writeHistoryEntry` of ~120 KB — so up to ~1.2 MB can land in a single body
  that no chunk size in the codebase chose. Safe today; count-bounded, not
  byte-bounded, and invisible to every check.
- **Replies are not requests, but the repo has hit a reply ceiling before.**
  `historyCache.ts` records an Upstash "single pull exceeded 10MB" warning from
  a whole-universe MGET. `warm-earnings` does `redis.mget(...keys)` over the
  entire universe at 07:15 — inside the alert window. Worth ruling in or out
  before assuming the email is about a write at all.

## 8. What changed in code

1. **`lib/server/chunkByBytes.ts`** — `setRequestBytes()` moved here from
   `pickersBuilder.ts` and made the single home, with TTL optional so the
   no-TTL SEC command can be measured as it is actually sent. Plus
   `trySetRequestBytes`, `pctOfRequestLimit`, and the measured escaping factor
   with its provenance.
2. **`writeManifest()`** — logs the reconstructed request body, entry count and
   percentage of the limit on every write, and **refuses** rather than firing a
   request over the 5 MB budget. Refusing produces the identical data outcome to
   an Upstash rejection — no write, previous value stands, `false` returned to a
   caller that already handles it — and the only thing it changes is that the
   failure is loud.
3. **`refreshTickerMap()`** — the same measurement and refusal.
4. **`scripts/check-request-size.mjs` §5** — thirteen assertions covering both
   SEC writes: measured before sending, no-TTL command, refusal present and at
   `console.error`, not pipelined or concurrent, both using the shared helper,
   provenance on every constant, and the projection.
5. **`/api/debug/redis-write-sizes`** — §7 above.

## 9. The manifest was NOT sharded, and why

The brief's step 3 was conditional on the manifest being the culprit. It is not,
and `secManifest.ts`'s header is emphatic about why one key is the right shape
(one GET, one SET, against 700 billed commands for a per-symbol model). That
header's own escape hatch — "the answer is chunking by byte size
(`lib/server/chunkByBytes.ts` exists for exactly that), not a key per symbol" —
stays the plan for the day it is needed. Building it now would ship a
reassembly branch that cannot fire for years, and so would never be exercised
before the one day it had to work.

**But the ceiling is worth stating, because it is closer than it looks.**
`manifest.symbols` is a **high-water mark**: `seedManifest` only adds,
`reconcileDelistings` only flags, and nothing anywhere deletes a key. 822
already exceeds `PRESET_UNIVERSE` (100) + `MAX_DYNAMIC_UNIVERSE_SIZE` (700) by
22, so **the universe cap is not a bound on this write** and sizing the guard
against it would be sizing against a number the manifest has already passed. The
real bound is the ticker map — 10,438 and drifting up — where the
`emptyEntry()` floor alone projects to **3.93 MB of body before a single field
is populated**, and a populated manifest is a multiple of that floor. That is
what makes the refusal branch load-bearing rather than decorative, and
`check-request-size.mjs` §5 asserts exactly that relationship.

## 10. Still open

- **The actual culprit.** Unattributed. The instrument for it now exists.
- **Verification against Vercel logs post-fix**, as originally asked, is not
  meaningful for these two writes: they were never erroring. What the new log
  lines give instead is the number — `[sec-manifest] write: N symbols, … % of
  the 10MB request limit` at 04:00 and 04:20, `[sec-tickers] store: …` on the
  weekly refresh. First run after merge is the datapoint.
- **A note named `upstash-meter-settled-2026-09-12` is not mirrored here.**
  It was cited when this work was scoped (for "commands are unlimited on this
  plan") as if it were in the `claude/` directory; it is not, so the path is
  written without its prefix above rather than as a live citation that
  `check-doc-citations` would rightly flag. The claim itself is corroborated
  in-tree —
  `chunkByBytes.ts` ("COMMANDS ARE UNLIMITED"), the brief's §6.1, and
  `redisBandwidth.ts` — so nothing here depends on the missing file, but it is
  one more doc that lives only in the Claude Project and should be mirrored per
  CLAUDE.md's own rule.
