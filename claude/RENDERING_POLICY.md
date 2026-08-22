# Rendering Policy — server-rendered by default (added 2026-07-19)

**Standing rule from the user, effective 2026-07-19: default to server-rendered
pages wherever possible on MyStockHarbor.** Read this before starting any new
page or component work. This does not change the existing content-automation
pipelines (Insights, Bottlenecks, SPX refresh, YouTube video pages) — those
already only write markdown/JSX content into an existing server-rendered
template. This policy governs new *page or component* (code) work.

## The rule

- New pages should be React Server Components by default: fetch data on the
  server (`page.tsx`, no `"use client"`), render real HTML at request time (or
  at build time via ISR where the data allows it), and ship as little client JS
  as possible.
- Only mark a component `"use client"` when it does something a server
  component genuinely cannot: interactive state (`useState`), browser events
  (`onClick`, `onChange`, hover), browser-only APIs (`window`,
  `IntersectionObserver`, clipboard), reading the URL client-side for instant
  filtering without a round trip, or wrapping a third-party embed that requires
  the DOM (TradingView, chart libraries with interactive tooltips).
- When only part of a page needs interactivity, keep the page a server
  component and carve the interactive part out as a small client "island" —
  already the dominant pattern in this codebase, and it should stay the
  default rather than full client-rendered pages.
- If a page cannot be server-rendered because its core value *is* the
  interactivity (a calculator, a live filter UI, a chart with pan/zoom/hover),
  say so plainly when proposing it, name the specific requirement that forces
  it, and still push the initial data fetch, static shell and SEO meta to the
  server — hydrating only the interactive piece.

## Already true in the codebase (confirmed 2026-07-19)

- `DilutionHistory.tsx` and `PageShareBar.tsx` carry explicit comments saying
  they were kept server-side so their content lands in crawlable initial HTML
  rather than behind a client fetch. That is the pattern to follow.
- Bottlenecks is the template: `app/bottlenecks/[ticker]/page.tsx` and
  `app/bottlenecks/page.tsx` are server components; only the search box and the
  ranking widget are client islands.

## Known exceptions

~49 files use `"use client"`. Most are legitimate small islands. A smaller set
are full page-level `*Client.tsx` components: `PickersClient`,
`DashboardClient`/`MobileHomePage`, `InsightsPageClient`, `PlatformsClient`,
`PlaysClient`, `BullFlagsClient`, `DescendingTrianglesClient`,
`UtilitiesClient`, `StockSymbolPageClient`. Not individually re-audited.
Likely legitimate: `/pickers` (live filtering over a large dataset — the data
stays server-side in Redis, the client component is about interaction),
dashboard/mobile home (live ticker, symbol search), `/utilities` (client-side
computation by design), the chart-pattern plays pages.

These are exceptions to flag going forward, not a loophole to reach for.

## Going forward

- Default to a server component. If it needs interactivity, build the server
  shell first and add the smallest possible client island.
- If a full-page client component is unavoidable, say so explicitly and name
  the interactive requirement.
- Eventually re-audit the page-level `*Client.tsx` list to confirm each one's
  `page.tsx` does the actual data fetch and only hands off interaction.

---

## Verification against the tree — 2026-08-22

*Added when this file was committed to the repo. Everything above is the policy
as written on 2026-07-19 and is unedited; this section records what was still
true six weeks later, because a policy nobody re-checks is how the "~49" below
went stale unnoticed in the first place.*

**Checked and still correct:**

- Every named page-level `*Client.tsx` still exists: `PickersClient`,
  `DashboardClient`, `MobileHomePage`, `InsightsPageClient`, `PlatformsClient`,
  `PlaysClient`, `BullFlagsClient`, `DescendingTrianglesClient`,
  `UtilitiesClient`, `StockSymbolPageClient`.
- `DilutionHistory.tsx` and `PageShareBar.tsx` are still genuine server
  components, and still carry the comments the policy cites.
- `app/bottlenecks/page.tsx` and `app/bottlenecks/[ticker]/page.tsx` are still
  server components.

**Drifted:**

- **`~49 files use "use client"` is now 64.** Up 15 since the policy was
  written. The named page-level list has not grown, so the increase is in
  islands — which is the policy working rather than failing, but the number in
  the text was stale and would have been quoted as current.

**A near-miss worth recording, since this file is about not fooling yourself.**
The first pass at this verification used `grep '"use client"' -l` and returned
68 files, including `DilutionHistory.tsx` and `PageShareBar.tsx` — the two
exemplars. That read as a serious finding: the policy citing two files that no
longer follow it, with comments still claiming they do. It was wrong. Both hits
were the string `"use client"` **inside a comment** — in `PageShareBar.tsx`, a
line explaining that it *avoids* `"use client"` boundary issues. The real figure
comes from checking whether `"use client"` is the file's first non-comment
statement, which is what makes it a directive rather than a mention: 64 real,
68 naive, 4 comment-only.

Exactly `claude/traps/grep-finds-the-comment-not-the-code.md`, on the file that
governs how pages get built. Re-run the count that way, not with a bare grep.
