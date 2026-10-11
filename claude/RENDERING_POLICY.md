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

- **`~49 files use "use client"` is now 64.** But the total is the wrong number
  to track, because growth in islands is the policy working and growth in
  page-level components is the policy not holding, and one figure cannot tell
  them apart. Split:

  | | 2026-07-19 | 2026-08-22 |
  |---|---|---|
  | page-level | 10 (the named list) | **14** |
  | islands | ~39 | **50** |
  | total | ~49 | 64 |

  No `page.tsx` is itself a client component.

- **Four page-level components exist that the policy does not name:**
  `InsightPostClient` (`/insights/[slug]`), `VideoPageClient`
  (`/insights/videos/[videoId]`), `SPXChartClient` (`/markets/spx`),
  `VerifyClient` (`/verify`). All ten named ones are still present, so this is
  addition, not churn. **Track the page-level delta, not the total.**

**The outstanding action item, done (2026-08-22).** "Eventually re-audit the
page-level `*Client.tsx` list to confirm each one's `page.tsx` does the actual
data fetch and only hands off interaction" — open since 19 July.

All four of the new ones are compliant:

- `InsightPostClient` — `page.tsx` fetches the post server-side; the client
  component holds the chart interaction only.
- `VideoPageClient` — `page.tsx` calls `getYouTubeVideoById`,
  `getLatestYouTubeVideos` and `getVideoStockData`, and does the remark→HTML
  pass, all server-side.
- `SPXChartClient` — `page.tsx` fetches; the client half is the chart.
- `VerifyClient` — `/verify` is a human-verification interstitial whose entire
  content is a POST to `/api/internal/verify-human`. There is no data to
  server-render. This is exactly the "core value *is* the interactivity"
  exception the policy names, and `page.tsx` still owns the metadata.

**A METHOD NOTE, because this audit produced two false findings before it
produced a true one, and both were the same mistake in different clothes.**

The first was the comment-vs-code grep described above. The second was a
heuristic for "does `page.tsx` fetch server-side" that pattern-matched
`await get[A-Z]`-shaped calls: it reported `app/insights/page.tsx` as doing no
server fetch, when that file calls `getPaginatedPosts`, `getLatestYouTubeVideos`
and `getAllVideoMeta` — it fetches plenty. Publishing that table would have
raised a false alarm against a compliant page.

The directive COUNT is mechanical and trustworthy: `"use client"` as the first
non-comment statement is exact, and so is the page-level/island split, which
keys off filename and import edges rather than behaviour. **Per-file compliance
verdicts are not mechanical** and were reached by reading the four new files.
Anyone re-running this should re-count freely and re-read before judging.

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
