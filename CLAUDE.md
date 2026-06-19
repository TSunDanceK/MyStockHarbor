# MyStockHarbor — Insights Post Workflow (CLAUDE.md)

This file is the persistent memory for the daily/on-demand insights post pipeline.
Read this file at the start of any new chat instead of re-reading old conversation
history — it contains everything learned from building and debugging this workflow.

---

## What this is

MyStockHarbor publishes daily "Insight" posts at `/insights/[slug]` — structured
technical/fundamental write-ups on individual stocks, each with a live price chart
driven by frontmatter fields. Posts are markdown files in `content/insights/`,
read at request-time by `lib/blog.ts` via `getAllPosts()` / `getPostBySlug()`.

The strict content template lives at `content/templates/insight-template.md` —
**always read that file fresh before writing a post**, don't rely on a cached
understanding of it, since it may be edited over time.

---

## Repo

- Owner: `TSunDanceK`
- Repo: `MyStockHarbor`
- Default branch: `main`
- Posts live in: `content/insights/`
- Template lives in: `content/templates/insight-template.md`

---

## Daily workflow

1. **Ticker selection**
   - If the user has sent a ticker, use it.
   - If no ticker has been sent by **7:00am UK time**, pick one using this logic
     (in rough priority order):
     - Price testing/near Daily MA200 or Weekly MA200 ("buy zone")
     - Price hitting a major horizontal support level
     - Support test combined with bullish RSI or MACD divergence
     - A genuinely major, dated, verifiable news catalyst (M&A, partnership,
       earnings surprise, analyst action with real market reaction)

2. **Research (mandatory, every time)**
   - Web search for current price, recent price action, and the real reason
     behind any move.
   - Never invent or assume news, earnings results, guidance, analyst calls,
     product launches, lawsuits, or takeover rumours.
   - If something sounds dramatic or surprising, **search to verify it before
     assuming it's fabricated or before writing it as fact** — both directions
     of error are real (see "Lessons learned" below).
   - If no clear news/catalyst exists, say so explicitly, per the template's
     own fallback language.

3. **Chart settings (symbol / timeframe / chartBars / chartIndicators)**
   - `chartIndicators` accepts an array, but the live chart's lower panel only
     ever focuses on **one** indicator at a time (see `InsightPostClient.tsx`,
     `getFocusedOverlay()`). Pick ONE deliberate indicator that actually proves
     the thesis in the title — don't stack several expecting them all to show.
   - Match timeframe + bars + indicator to the setup type:
     | Setup | Timeframe | Indicator | Bars |
     |---|---|---|---|
     | Daily MA200 test | `d` | `MA200` | ~250 |
     | Weekly MA200 test | `w` | `MA200` | ~150–200 |
     | Support + bullish RSI divergence | `d` | `RSI(14)` | ~120–150 |
     | Support + bullish MACD divergence | `d` | `MACD(12,26,9)` | ~120–150 |
     | Fresh news-driven mover, established trend | `d` | `MA50` | ~250 |
     | Pure catalyst-day spike, no trend structure yet | `d` | `Volume` | ~250 |
   - Allowed indicators (exact spelling, from the template): MA50, MA200,
     EMA20, VWMA(20), Bollinger(20,2), RSI(14), MACD(12,26,9),
     Stochastic(14,3), ATR(14), Volume.

4. **Internal link — verify before using, every time**
   - Do NOT trust the link list inside `insight-template.md` blindly — it has
     gone stale before (see "Lessons learned").
   - Before linking to any `/some-page` path, confirm it's real by checking
     `app/sitemap.ts` in the repo — specifically the `seoGuides` array. If it's
     not listed there, don't link to it. When in doubt, link to `/pickers`
     instead (always safe).

5. **Write the post**
   - Follow `content/templates/insight-template.md` exactly — frontmatter
     fields, section order, formatting rules (Support/Resistance/Moving
     averages/Risk point bullets, Bullish/Bearish scenario bold labels, etc).
   - `date` in frontmatter should be **today's real date** for a new post.
     (Exception: if correcting/backdating an existing post to match its
     original published date, keep that original date — see "Lessons learned.")

6. **Publish via PR, never direct to `main`**
   - Create a new branch: `insight/{ticker}-{date}` (e.g. `insight/vrt-june-19-2026`)
   - Commit the `.md` file to `content/insights/`
   - Open a PR against `main` with a clear title and a short body summarizing
     the setup, chart settings, and internal link used
   - Do NOT merge automatically — this is a human-approval gate

7. **Notify for review**
   - Vercel auto-builds a preview on the PR. The **branch alias URL** (stable
     across rebuilds, found in Vercel's PR comment) is the one to share —
     not the per-build numbered URL, which changes on every push.
   - Share: the branch alias URL + the post path appended, e.g.
     `https://mystockharbor-git-{branch}-tsundanceks-projects.vercel.app/insights/{slug}`
   - Wait for explicit approval before merging.

8. **Merge on approval**
   - Once approved, merge the PR (squash merge). Vercel auto-deploys `main`
     to production within a minute or two.

---

## Lessons learned (read before repeating mistakes)

- **A page existing as a route in code doesn't mean it should be linked.**
  Always verify against `app/sitemap.ts`, not against the template's hardcoded
  link list, which can go stale. (We found and removed a dead
  `/hot-market-names-right-now` link this way — it had a real `page.tsx` but
  wasn't wanted on the site and was removed entirely; the template's link
  list was also corrected.)

- **Don't assume dramatic-sounding content is fabricated without checking.**
  An earlier post (INTC, dated April 7 2026) was initially judged "fabricated"
  because it described an Elon Musk / SpaceX / Tesla / xAI semiconductor
  venture ("Terafab") and named specific stocks (DXYZ, SMT.L, RKLB, ASTS) as
  having SpaceX exposure. On verification, **all of this was real** — Terafab
  was a genuine, dated April 7 2026 announcement, and DXYZ/SMT.L did hold
  real pre-IPO SpaceX stakes. The post's *actual* problems were narrower:
  invented flourishes (e.g. "radiation-hardened 18A-P chips"), an off-topic
  "Shadow Stocks" stock-picking digression that didn't fit the template
  structure, and — the real bug — a frontmatter `date` of April 7 paired with
  `latestNews` describing events from June. **Always web-search to verify
  before declaring something fake, in both directions.**

- **Posts are frozen snapshots tied to their `date` field**, not living
  documents. If correcting an existing post, the article content must match
  what was actually true and known **as of that post's original date** — not
  today. Don't update an old post's story to today's news while leaving its
  date unchanged, and don't change its date without good reason (it may
  already be indexed/linked).

- **A new branch does not inherit fixes merged to `main` after it was
  created.** If `main` gets an important fix (e.g. the middleware bug below)
  while other branches are open, those branches need the fix pushed to them
  directly too, or their previews will use stale code.

- **Vercel preview deployments run on `*.vercel.app` hosts, not the
  production domain.** `middleware.ts` previously force-redirected any
  non-production host straight to `https://www.mystockharbor.com`, which
  broke every single preview (always landed on the live homepage). Fixed by
  adding a `process.env.VERCEL_ENV === "preview"` bypass alongside the
  existing localhost check. If previews ever start redirecting to the
  homepage again, check `middleware.ts` first.

- **GitHub connector permissions**: write access (creating branches, files,
  PRs) requires the GitHub App/connector to be properly installed with
  write scope, not just OAuth-authorized. A 403 "Resource not accessible by
  integration" on a simple branch-creation call is a permissions problem, not
  a content problem — check the connector's install status before debugging
  anything else.

---

## How to use this file

**For a new day's post or any future manual request, start a fresh
conversation** rather than continuing a long one — this avoids re-reading
(and re-paying for) the entire history each time. Just say something like:

> Read CLAUDE.md in TSunDanceK/MyStockHarbor and write today's insight post.
> Ticker: VRT
> (or: no ticker today, pick one per the rules)

That's enough for a fresh chat to pick up the entire workflow, research the
stock, write the post correctly, and open a PR for review — without needing
any of this conversation's history.

---

## Open item: full 7am automation

True unattended scheduling (something runs at 7am UK without a human starting
a chat) requires a **GitHub Action on a cron schedule** calling the Claude API
directly, separate from this chat interface. Not yet built. Until it exists,
the daily post still needs a human (or a scheduled reminder) to kick off a
fresh chat each morning using the prompt above.
