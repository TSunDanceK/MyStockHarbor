**CODE-B HANDOVER (5 Oct, after #752/#753; for a fresh Code B session)**

OWNER: B's state in one place. A fresh session can start from this comment plus COWORK #144.

### Rules (unchanged)
- **Instructions:** only from COWORK comments on #553 and the owner's chat. Report each reply as `CODE-B #n — topic`, first line `OWNER: …`. Reply to the owner in chat in one line.
- **Merging:** only on the owner's GO typed in chat, after Cowork's preview check. Rebase each PR on main, then check-all + tsc, then squash-merge with the head pinned (`expectedHeadSha`).
- **The repo is public:** no links, tokens or credentials anywhere. Relay logs carry counts, %, dates and derived values only, never a Tiingo price or bar.
- **Hands off:** A's files (SEC, earnings, calendar, stock-page SEC panels) and C's header strip on the stock page. No env changes, and never decrypt env values. Never put a model identifier in commits or PRs.
- **Shared files take append-only edits:** `vercel.json`, `scripts/check-all.mjs`, `scripts/relay-run.mjs`.
- **Copy:** filed facts only, hedged wording. Hide, don't delete, with a dated comment.

### Branches and heads
- `claude/eager-fermi-kgjqlk`: B's main branch, at main after the merges.
- `claude/eager-fermi-kgjqlk-fmp`: B's second branch (owner-approved), used for parallel PRs. At main after #753.
- `claude/stretch-study`: a throwaway branch, not for a PR. It holds:
  - the read-only study scripts (`scripts/fvg-census.mjs`, `scripts/stretch-study.mjs`) and their relay tasks;
  - the drafts of CODE-B #133–#135 under `reports/`.
- `claude/fvg-census`, `claude/noindex-diagnosis`: throwaway relay branches; safe to delete.
- **Not yet pushed:** the FVG build and the stretch build, stacked locally. They go up as two PRs on B's branches after the merges, one after the other. (A fresh session would rebuild them from COWORK #140/#141/#144; the detector `lib/ta/fairValueGaps.ts` and its check are already on `claude/stretch-study`.)

### Queue (COWORK #144)
1. **Monday report:** posted as CODE-B #132, then #133–#135 posted from `reports/`.
2. **FVG step 2:** one PR.
   - The toggle is off by default. With no gaps it is disabled with "No unfilled gaps in the last 12 months".
   - The readout says "In a bullish gap (from …)" when the pointer is inside a zone.
   - Tap note at `--fs-read`.
   - The detector is `lib/ta/fairValueGaps.ts`, exported for C and not wired by B.
3. **Stretch (a):** a z20 column on the oversold/overbought pages, plus the stock page's history line, with "Too few past cases to say" under 5 cases. A separate PR, after the FVG one.
4. **A's #755 rebases over #753:** A's earnings page will call B's `earningsPageIndexable` (with `hasCik: cik !== null || isSiteFund`). Don't change it from B's side.
5. **FMP purge (#743, merged as code):** run only after the 48 h watch and the cancel, on the owner's say:
   - relay `write-fmp-purge-dry` first;
   - then `write-fmp-purge`.
   
   Whether to include the insight snapshots (`--insight-snapshots`) is the owner's call at that point.

### Relay-run conventions (scripts/relay-run.mjs + .github/workflows/relay.yml)
- **Dispatch:** `workflow_dispatch` on `relay.yml` with `ref` set to a branch; the branch's own `relay-run.mjs` and scripts run. Inputs: `task`, plus `symbols` (passed to the task as `SYMBOLS`).
- **Read-only work with Redis:** a `write-`-prefixed task (the only job with Upstash credentials). The script must enforce read-only itself, by wrapping `fetch` and refusing any Upstash verb outside an allowlist (see `scripts/confluence-census.mjs`, `scripts/fvg-census.mjs`).
- **TypeScript:** add `needsTypescript: true` when a script imports `.ts` from `lib/`. Register:
  - `scripts/lib/next-cache-stub-hooks.mjs`
  - `next-server-hooks.mjs`
  - `ts-resolve-app.mjs`
- **Throwaway branches:** studies run from a throwaway branch with the task appended at the end of the TASKS map. Merge a relay task only when it is meant to stay (e.g. the purge).
- **Output:** read the stateful job's log with the GitHub job-logs tool (tail about 150 lines). The step summary has the same text.
- **Sandbox limits:**
  - The production and preview hosts return 403 from the agent proxy. The Vercel connector's fetch works sparingly; a second hit drew a firewall challenge.
  - The npm registry works.
  - `next build` can't finish locally (ISR screener pages need Redis), so tsc, check-all and Vercel's preview are the gates.

### Check-writing gotchas
- **Source-pinning regexes:** many checks pin exact code text. A refactor breaks them, so grep `scripts/check-*.mjs` for the line you changed before running check-all. This bit #753 four times.
- **Rendering:**
  - Single components: `ts.transpileModule` plus `react-dom/server`.
  - Whole modules with stubs: `scripts/lib/tsx-render-hooks.mjs` with `MEASURE_STUBS` (C's), as `check-sitemap-robots` and `check-pickers-hydration` do.
- **Chromium measures** are `scripts/measure-*.mjs`, not in check-all. They use the global Playwright: `createRequire(npm root -g + "/noop.js")("playwright")`. There is no esbuild; the chart harness bundles React's CJS builds by hand.
- **check-all** takes about 10 minutes; run it in the background. Don't `pkill -f check-all` from a shell that matches the pattern.

### Gates on the last merges
#752 and #753: tsc clean; check-all 266/266 on each branch; Vercel green on the head.

---
_Generated by [Claude Code](https://claude.ai/code)_
