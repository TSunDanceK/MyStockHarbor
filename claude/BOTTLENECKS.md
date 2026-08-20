# MyStockHarbor — Bottlenecks Page Workflow (mirror of Claude Project doc)

This is a GitHub mirror of the `claude/BOTTLENECKS.md` doc kept in the Claude
Project "My Stock Harbor Website", so it's readable from GitHub (e.g. mobile)
without opening Claude. The Claude Project copy is the one that's actively
edited — treat this as a reference mirror, and re-sync it here if the project
copy changes materially.

Key facts as of 2026-07-09:
- `/bottlenecks` shows supply-chain dependency + customer-concentration pie
  charts per stock, content in `content/bottlenecks/{slug}.md`.
- Daily automation (separate scheduled task) built/refreshed **5 pages/day**,
  priority order from `BOTTLENECK_QUEUE.md`, and was explicitly left
  **unchanged** by the 2026-07-09 Insights cutback (5→2 posts/day).
  **Retired 2026-08-17**, when the second Claude account was shut down.
  Bottleneck publishing is paused pending indexing — nothing is generating
  pages at present. Treat the 5/day figure as history, not current behaviour.
- Full schema, ticker-availability policy, note-override pattern, and
  step-by-step build process are documented in the Claude Project copy of
  this file — read that for the authoritative, up-to-date version.
---

## Correction: SK hynix is Nasdaq-listed — use `ticker: SKHY`, not `ticker: null`

**Added 2026-08-20; corrected the same day — see the note at the end, which is
the more useful half.**

- SK hynix listed ADRs on the **Nasdaq Global Select Market on 10 July 2026**
  (when-issued `SKHYV`; regular-way **`SKHY`** from 13 July).
- ~$848bn market cap, ~20.7m ADS/day average volume, 1 ADS = 1/10 ordinary
  share. Korea Exchange `000660` remains the primary listing.
- It therefore meets the ticker-availability policy's bar for "a straightforward
  NYSE/Nasdaq ADR that trades with real volume" and must be written as
  `ticker: SKHY`, never `ticker: null`.

**Spelling matters as much as the ticker.** `getBottleneckCompanyCounts()` keys
by company **name**, so `SK Hynix` and `SK hynix` count as two separate
companies and silently undercount both on the Bottleneck Leaderboard. The
company's own styling is lowercase-h: always write **`SK hynix`**.

The content backfill landed in **PR #246** (merged `136523bf`, 2026-08-20):
`content/bottlenecks/skhy.md` plus `ticker: SKHY` across the 13 existing pages
that reference the company.

---

## How this section was wrong when first written, and why that is worth keeping

As originally merged, this section claimed the Claude Project copy of this doc
"still cites SK hynix as an example of the OTC-only pink sheet case", and that
the daily automation "will keep reintroducing `ticker: null` and `SK Hynix` on
newly built pages" until it was fixed.

**Both claims were false.** The Project copy had already been corrected on
2026-08-15: SK hynix is absent from its OTC-only list, `SKHY` appears in its
real-ticker examples, and it carries an explicit "SK hynix — corrected
2026-08-15" section naming PR #246 as the vehicle for the backfill. And the
daily bottlenecks automation was retired on 2026-08-17 — there was no running
job to reintroduce anything.

### Where the bad claim came from

PR #246's own description, written 2026-08-15, ended with "Still outstanding:
the `BOTTLENECKS.md` project doc still lists SK Hynix under the OTC-only
examples." That line was stale on the day it was written — the Project copy was
corrected the same day.

Every other claim in that assessment was checked against current `main` rather
than taken from a PR body. The single source that could not be opened from a
repo session was the one where a PR body was trusted instead, and the resulting
inference was written down as fact rather than as an assumption.

That is the same shape as the shallow-clone `merge-tree` trap recorded in
`claude/stacked-branches-squash-merge-2026-08-20.md`: **a check that cannot run
does not announce itself — it returns a confident-looking answer.** An
unreachable source is where inference is least safe and most tempting, which is
exactly where it gets stated most firmly.

### The drift ran the unexpected way

The expected failure for a mirror is that it goes stale behind the
authoritative copy. Here the **Project copy was ahead of the repo**: it
described #246's backfill as already done, which only became true when #246
merged on 2026-08-20. The repo was the stale copy.

That inverts the instinct. "Check the mirror against the source" assumes the
source is current and the mirror lags; when the source runs ahead and describes
intended state as completed, reading either one alone gives a wrong answer in a
different direction. Neither copy is automatically the trustworthy one — the
running code and the actual file contents are.

### The stub itself is the real hazard

This mirror does not contain the ticker-availability policy at all; it defers
to the Claude Project copy. **Any session without project access — which is
most of them — cannot read the policy it is instructed to follow**, and is
left inferring the contents of a document it cannot open. That is what happened
above.

Copying the authoritative policy content into this file would remove that class
of failure entirely. Owner decision, not yet done.
