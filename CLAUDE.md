# MyStockHarbor — Insights Post Workflow (CLAUDE.md)

This file is the persistent memory for the daily/on-demand insights post pipeline.
Read this file at the start of any new chat instead of re-reading old conversation
history — it contains everything learned from building and debugging this workflow.

**Note (2026-07-09):** this file had drifted out of sync with the actual live
automation for a while — the "Full daily automation" section below was missing
from `main` even though the automation was already built and running via a
Cowork/Claude Code scheduled task. This edit reconciles the two.

---

## What this is

MyStockHarbor publishes daily "Insight" posts at `/insights/[slug]` — structured
technical/fundamental write-ups on individual stocks, each with a live price chart
driven by frontmatter fields. Posts are markdown files in `content/insights/`,
read at request-time by `lib/blog.ts` via `getAllPosts()` / `getPostBySlug()`.

The strict content template lives at `content/templates/insight-template.md` —
**always read that file fresh before writing a post**, don't rely on a cached
understanding of it, since it may be edited over time.

There are now **two publishing paths**:

- **Manual / chat-initiated** (below, steps 1–8): you send a ticker (or ask for a
  pick) in a chat, Claude opens a PR, you review the preview link, and you approve
  the merge yourself.
- **Fully automated daily run** (see "Full daily automation" section below): a
  scheduled task fires **twice a day** with nobody watching, picks its own two
  tickers, self-checks its own work, publishes straight to production with no
  preview, and verifies the live deploy — fixing it if something's broken.

---

## Repo

- Owner: `TSunDanceK`
- Repo: `MyStockHarbor`
- Default branch: `main`
- Posts live in: `content/insights/`
- Template lives in: `content/templates/insight-template.md`

---

## Daily workflow (manual / chat-initiated)

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
     *(this rule applies to the manual path only — see the automated path below
     for when it's intentionally skipped)*

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

## Full daily automation (scheduled task)

Built via a Cowork/Claude Code **scheduled task** (a "Routine"), which fires
**twice a day**, starts a completely fresh session with no chat history, and
runs unattended — no human needs to open Claude. Editing the trigger itself
(cron, prompt text, connectors) has to be done from within Cowork/Claude Code's
routine settings — there is no tool for it from a normal claude.ai chat.

This path deliberately differs from the manual workflow above in two ways: ticker
selection is fully self-directed, and the human-approval gate is replaced with a
self-QA pass plus a post-deploy verification/auto-fix loop, since nobody is
watching to catch problems.

1. **Ticker selection — pick TWO tickers per run, not one (changed 2026-07-09):**
   - **Pick A — Good buying level:** same logic as the manual path above —
     price testing/near Daily or Weekly MA200 ("buy zone"); price at a major
     horizontal support level; support test + bullish RSI/MACD divergence; or
     a genuinely major, dated, verifiable news catalyst.
   - **Pick B — Retail-hungry, accumulating stage:** a stock showing strong
     retail attention (high StockTwits/Reddit/financial-news mention volume,
     elevated relative volume, or a recent viral catalyst) that is currently
     base-building/accumulating rather than already breaking out — price
     holding a range or a support shelf with rising volume on up-days, not yet
     extended. Prefer names **not in the S&P 500** (mid/small-cap, recent IPO,
     or meme-adjacent) — deliberately lower-competition SEO territory than the
     mega-caps everyone already covers. Caveat: genuinely "retail-hungry" names
     are often also the most content-saturated on the internet (every finance
     blog chases the same meme tickers) — the low-competition edge only holds
     if the pick is caught during genuine early accumulation, before the
     content crowd piles on too.
   - Pull the most recent 50 posts from `content/insights/` (sort by date) and
     build a single shared exclude-list from their tickers, applied to both
     picks.
   - Web search for today's high-traffic / most-active stocks (for Pick A
     candidates) and for trending/most-discussed retail names (for Pick B
     candidates — e.g. StockTwits trending, Reddit trending tickers, "most
     active" retail-skewed screens).
   - If nothing clears the bar for Pick A, fall back to the best available
     high-traffic mover anyway and say so plainly in its PR body. If nothing
     clears the bar for Pick B specifically, fall back to the best available
     retail-attention name anyway and say so in its PR body — don't silently
     drop back to a second Pick-A-style pick instead.

2. **Research, chart settings, internal links, writing the post** — identical to
   steps 2–5 of the manual workflow above, run once per pick (twice total per
   day). No shortcuts here even though nobody is reviewing it before it goes
   live.

3. **Self-QA pass (replaces the human reviewer)** — before publishing each post,
   check:
   - Frontmatter `date` is today's actual date.
   - Ticker is not in the shared 50-post exclude-list.
   - Every internal link verified against `app/sitemap.ts`'s `seoGuides` array.
   - No invented facts — every claim traces back to an actual search result.
   - Chart symbol/timeframe/indicator/bar count match the setup table and the
     stated thesis.
   - Formatting matches the template exactly.
   - Fix anything that fails before moving on.

4. **Publish with no preview and no wait**
   - For each pick, open the PR as usual (branch `insight/{ticker}-{date}`,
     clear title/body), then **immediately squash-merge it** — do not wait for
     a human. Two picks means two branches, two PRs, two merges.

5. **Post-deploy verification (do not skip)**
   - Vercel deploys `main` to production within a couple of minutes. Poll each
     live production URL (`https://www.mystockharbor.com/insights/{slug}`) for
     up to ~10 minutes until it returns 200 with the right content.
   - If it's not live in time, or something's visibly broken (wrong content,
     404, chart not rendering, build failure), diagnose from the repo and push
     a fix commit to `main`, then re-verify. Retry once more if still broken.

6. **Notify**
   - Send a push notification: both tickers picked (and why each was chosen —
     Pick A vs Pick B rationale), both post URLs, deploy status for each, and
     a one-line note on anything that needed correcting.

**Search Console indexing nudge — infrastructure built, decision pending:**
A Google Cloud project (`mystockharbor-indexing`), a service account
(`mystockharbor-indexing@mystockharbor-indexing.iam.gserviceaccount.com`, added
as a Full user on the `mystockharbor.com` Search Console property), and its key
(stored at project doc `automation/gcp-search-console-service-account.json`)
were built and tested for the sitemap-ping idea (nudging Google to recrawl
`https://www.mystockharbor.com/sitemap.xml`, which already auto-includes every
new insight post via `getAllPosts()` in `app/sitemap.ts`).

**Real constraint found:** Claude's own cloud sandbox network policy only
allowlists a few hosts (GitHub's API works; `googleapis.com`,
`oauth2.googleapis.com`, npm, and PyPI are all blocked — confirmed by testing).
So the daily scheduled task **cannot** call the Google API directly from its
own environment. Two live options if this is ever revisited:
1. **Do nothing extra (current default)** — the sitemap already exists, is
   already registered with Google, and auto-updates with every new post.
   Google recrawls it on its own normal cadence with no ping needed; this
   matches "a few days is fine."
2. **GitHub Actions relay** — add a `workflow_dispatch` GitHub Action to the
   repo that does the Google OAuth + sitemap-submit call (Actions runners have
   full internet access, unlike Claude's sandbox), triggered via the GitHub
   API (which Claude's sandbox *can* reach) after each daily deploy. Needs one
   more one-time manual step: the user pastes the service account JSON into
   the repo's GitHub Actions secrets. Not built by default — more moving parts
   for a speed-up the user said they don't need.

**Known caveat — DST drift:** the scheduled task's cron expression is set in UTC
(e.g. `0 6 * * *` for 7:00am UK time while the UK is on BST, UTC+1). When the UK
switches to/from BST, the actual UK-local fire time shifts by an hour until the
cron is manually updated. Ask Claude to nudge the schedule at the late-March and
late-October clock changes if 7:00am UK time needs to stay exact.

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
  anything else. This matters even more for the automated path, since there's
  no human present to notice a stuck/failed run beyond the notification sent.

- **Claude's cloud sandbox has a restrictive outbound network allowlist.**
  Confirmed reachable: GitHub's API. Confirmed blocked: googleapis.com,
  oauth2.googleapis.com, npm registry, PyPI. Any future automation idea that
  needs to call a third-party API directly from a Claude session/scheduled
  task should check reachability first (a plain `curl -sI <host>` test) rather
  than assuming it'll work — GitHub Actions (triggered via the GitHub API,
  which Claude's sandbox can reach) is the fallback relay for anything that
  needs real internet access Claude's own sandbox doesn't have.

- **This file can drift from the actual live automation.** The "Full daily
  automation" section above didn't exist on `main` for a while even though
  the automation was already built and running — the scheduled task's stored
  prompt is the actual source of truth for what runs, and this file is
  documentation of it, not the mechanism itself. If a schedule/rule change is
  made, update both: this file (for anyone reading the repo) and the trigger's
  stored prompt directly in Cowork/Claude Code (for what actually runs) —
  updating one does not update the other.

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

For the automated path, nothing needs to be said each day — the scheduled task's
own stored prompt already contains the full self-contained instructions (a copy
of the "Full daily automation" section above), since a fresh triggered session
also starts with no chat memory. **If you change the rules here, remember to
also update the trigger's stored prompt in Cowork/Claude Code — the two are not
linked.**

---

## Open item: full 7am automation — RESOLVED

~~True unattended scheduling... requires a GitHub Action on a cron schedule...~~
Superseded: built as a Cowork/Claude Code **scheduled task** instead (see "Full
daily automation" above). No GitHub Action was needed. If the schedule ever needs
changing (time, frequency, pausing it), ask Claude to update or list the
scheduled task/routine directly — no code changes required.
