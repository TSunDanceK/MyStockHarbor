# Whole-market bars migration — SECOND-HAND SUMMARY, NOT THE SPEC

**This is not `claude/dashboard-off-fmp-scoping-2026-09-12.md` §1.** That
document has never been readable from a session and was not pasted; a
placeholder was. This file records only what the accompanying summary asserted,
so the points are not lost again — it is not a substitute for the spec and
must not be built against as if it were complete.

## What the summary said

- Keep computing **signals** on the ~700-symbol analysis universe.
- Store **bars for the whole market** (~8,000 symbols).
- Write with **chunked MSET**, byte-chunked at 5 MB: ~176 writes instead of
  ~8,000 individual SETs, about **45x fewer billed Redis commands**.
- **MSET takes no TTL.** Per-key expiry therefore moves to an `expiresAt` field
  carried *inside the value* and honoured on read, plus a periodic sweep for
  deletion.
- That is a **real behaviour change** from today's per-key Redis TTL and must be
  flagged in the PR description rather than changed silently.
- It also answers the objection that killed **#379** (a shared hash TTL let
  delisted symbols persist), because a per-key `expiresAt` expires each symbol
  on its own schedule.

## Why it gates stages 4 and 5

Market cap has no adequate source today. The due-strip canary measured 840 pool
entries at 99.4% coverage with **no usable cap for NVDA**, the largest company
in the market — so a "top 50 by market cap" was emitted without it. Both the cap
column (stage 4) and the live top-50 (stage 5) need a price source wider than
the analysis universe.

## What is NOT known, and must come from the real document

Chunk-boundary behaviour on a partial write, what the sweep's cadence and
denominator are, how `expiresAt` interacts with the existing eviction
registry (`symbolEviction.PER_SYMBOL_KEYS`), and whether the 5 MB bound is a
measurement or a guess. None of these are answerable from the summary.
