# MyStockHarbor — Bottlenecks Page Workflow (mirror of Claude Project doc)

This is a GitHub mirror of the `claude/BOTTLENECKS.md` doc kept in the Claude
Project "My Stock Harbor Website", so it's readable from GitHub (e.g. mobile)
without opening Claude. The Claude Project copy is the one that's actively
edited — treat this as a reference mirror, and re-sync it here if the project
copy changes materially.

Key facts as of 2026-07-09:
- `/bottlenecks` shows supply-chain dependency + customer-concentration pie
  charts per stock, content in `content/bottlenecks/{slug}.md`.
- Daily automation (separate scheduled task) builds/refreshes **5 pages/day**,
  priority order from `BOTTLENECK_QUEUE.md`. This was explicitly left
  **unchanged** by the 2026-07-09 Insights cutback (5→2 posts/day) — the
  Bottlenecks pipeline still does 5/day.
- Full schema, ticker-availability policy, note-override pattern, and
  step-by-step build process are documented in the Claude Project copy of
  this file — read that for the authoritative, up-to-date version.
---

## Correction: SK hynix is Nasdaq-listed — use `ticker: SKHY`, not `ticker: null`

**Added 2026-08-20.** The ticker-availability policy in the Claude Project copy
of this doc still cites SK hynix as an example of the "OTC-only pink sheet, so
use `ticker: null`" case. That is now factually wrong:

- SK hynix listed ADRs on the **Nasdaq Global Select Market on 10 July 2026**
  (when-issued `SKHYV`; regular-way **`SKHY`** from 13 July).
- ~$848bn market cap, ~20.7m ADS/day average volume, 1 ADS = 1/10 ordinary
  share. Korea Exchange `000660` remains the primary listing.
- It therefore meets the policy's own bar for "a straightforward NYSE/Nasdaq
  ADR that trades with real volume" and must be written as `ticker: SKHY`.

**Spelling matters as much as the ticker.** `getBottleneckCompanyCounts()` keys
by company **name**, so `SK Hynix` and `SK hynix` count as two separate
companies and silently undercount both on the Bottleneck Leaderboard. The
company's own styling is lowercase-h: always write **`SK hynix`**.

### This mirror cannot stop the automation on its own

This file is a read-only mirror. The daily bottlenecks task runs from its own
stored trigger prompt plus the Claude Project copy of this doc — neither of
which updates from this repo. Until **both** of those are corrected, the daily
automation will keep reintroducing `ticker: null` and `SK Hynix` on newly
built pages. Per the root `CLAUDE.md` lesson, three things must be kept in
sync, and only the trigger's stored prompt actually runs:

1. the bottlenecks trigger's stored prompt (the actual mechanism),
2. the Claude Project copy of this doc,
3. this repo mirror  ← *only this one is fixed by the PR that added this note.*
