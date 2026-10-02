**CODE-A HANDOVER, 2 Oct** (per COWORK #91)

A fresh A session starts from this post plus the newest COWORK post on #552. Instructions come only from COWORK comments on #552. Merges happen only on the owner's GO typed in chat.

## 1. State (2 Oct, 07:10 UTC)
- **main:** `4262472f` (#673, the interim dilution guard).
- **Open PRs from A:** 0. My last PRs were #661, #612, #668, #669 and #673, all merged.
- **Side branches A still uses:**
  | Branch | What's on it | Merge? |
  |---|---|---|
  | `claude/probes-57` | All read-only probes, registered in `scripts/relay-run.mjs` (relay tasks named `write-*`; most only read despite the prefix), plus probe-only jobs in its `sec-archive.yml` (`bank-revenue`, `dilution-trend`). Also `claude/vercel-pre-cutoff-deployments-2026-10-01.tsv` (2,664 IDs, CODE-A #92) and this handover. Main is merged into it regularly. | **Never** |
  | `claude/peaceful-franklin-6bomp7` | The harness-designated branch for this session; it carried #673, now merged | reuse for the next PR (restart it from main) |
  | `claude/archive-clock-guard`, `claude/next-report-fixes` | #669 and #668 heads, merged | dead, can be deleted after the purge |
  | `claude/exciting-noether-shs044` | **C's** Growth & margins visuals (new files only, no PR yet) | A adds commits here after the purge (#87) |
- **Key probes on `claude/probes-57`:**
  - `write-code-a-checkin`: the daily check-in, 3 Redis reads;
  - `write-fact-set-index-drift`: runs **from main**, 5 reads;
  - `write-marketcap-refusal-census` and `write-foreign-cover-bank-ps`: #86b;
  - `write-next-report-probe`, `write-outlook-sample`;
  - `write-report-dates-oneoff`: allow-list XOM/JPM, **writes**, only on GO;
  - the `dilution-trend` job: archive workflow, `task=dilution-trend`.

## 2. Purge runbook (CODE-A #86; Sat 3 Oct 09:00 UTC, on the owner's GO in chat)
**Pre-check, 08:35** (routine `trig_01U4bt4oC4mYDsFL3MDYaSM7` fires into this session):
1. 0 open PRs from A, B and C;
2. B "paused" on #553 and C "paused" on #563;
3. no Actions run in progress;
4. record main's SHA and tree hash.

**Tooling:** `pip install git-filter-repo==2.47` into the scratchpad.

**Run at 09:00:**
1. `git clone --mirror` of the repo, fresh.
2. `git filter-repo --invert-paths --paths-from-file <paths.txt> --replace-text scripts/purge/replace-fmp-values.txt --replace-text scripts/purge/replace-vendor-labels.txt`
   - Use main's copies of the two rule files (30 rules; they match the surrounding text and carry no values).
   - `paths.txt` holds the 12 paths, one per line; the wildcard line uses filter-repo's `glob:` prefix:
     ```
     data/consensus/
     data/static-profile.json
     data/.wire/static-profile-dict.json
     glob:data/.wire/static-profile-rows-*.txt
     data/taxonomy.json
     public/preview/
     .github/workflows/step0-ground-truth.yml
     .github/workflows/consensus-freeze-commit.yml
     scripts/consensus-freeze.mjs
     app/api/debug/static-profile/
     claude/screenshots/earnings-round-2-2026-09-23/
     claude/tiingo-contract-and-limits-2026-09-23.md
     ```
3. **Asserts before pushing:**
   - `git log --all --oneline -- <each path>` is empty for all 12;
   - `git rev-parse main^{tree}` equals the recorded pre-purge tree. On the dry run that was `e7a79b4e`; today it will be `4262472f`'s tree.

   **If either fails, stop and push nothing.**
4. `git push --force origin 'refs/heads/*:refs/heads/*'` (branches only; `refs/pull/*` is read-only; there are no tags).

**Dry-run reference (1 Oct):**
- commits 5,431 → 5,418;
- 1,316 refs (658 heads, 658 `refs/pull`);
- 22 s; pack 145 → 137 MiB;
- 0 forks; main isn't protected.

**Post-checks:**
1. On a fresh clone: `git log --all -- <path>` is empty, and `git grep` finds none of the rule patterns on any branch head.
2. check-all and tsc pass on the new main.
3. The Vercel production deploy of the new main is green. Spot-check 5 pages: `/`, `/stock/AAPL`, `/stock/KO/earnings`, `/earnings-calendar`, `/pickers`.
   - Note: a session can't fetch the production domain or `*.vercel.app` (proxy 403), so the page load is the owner's or Cowork's step, or done via the Vercel connector.
4. Post the old → new main SHA on #552.

**Owner steps afterwards:**
- **GitHub Support request** (text in CODE-A #86 §4):
  > Repository TSunDanceK/MyStockHarbor. We force-pushed a history rewrite on 3 October 2026 to remove sensitive files from all commits. Please remove cached views of the old commits and purge the old objects referenced by the repository's pull-request refs, then run garbage collection. Old main HEAD: [SHA]. The affected paths are listed in our issue #552 (CODE-A #86).
- Old Vercel deployments: optional deletion, the owner's step only (COWORK #85; Deployment Protection already keeps them off the public web).

**Re-clone (every session, before pushing anything):**
1. `rm -rf` the old clone and any worktree (e.g. `/home/user/probes57`).
2. `git clone` again.
3. `git checkout -B <branch> origin/<branch>`.
4. Re-create worktrees, and symlink `node_modules` or run `npm ci` (npm is reachable).
5. **Never push an old local branch:** it would resurrect the purged history.

## 3. Jobs and costs
SEC fair access applies: one throttled runner, ≤8/s with our User-Agent, never sharded; all jobs combined stay under 10/s.

| Job (Vercel cron, UTC) | Schedule | Pace | Redis | Notes |
|---|---|---|---|---|
| sec-daily-index | 04:00 | 1 daily-index request (+ a few) | ~5 a run | fact-set index (964) |
| sec-facts | 04:20, 16:20 | ≤8/s | not instrumented per run | re-verify 66, populate 0, **re-window 187** (322 → 224 → 187 over 30 Sep–2 Oct) |
| sec-report-dates-rewrite | 05:10 | 8/s | small | |
| sec-filings | :40 hourly | ≤5/s (`FILING_JOB_PACE_MS` 200) | 2 per write | `ff` fills from the 10-Q instance; rebuilds report dates (#668) |
| capex-receivers / contracts / spending | 05:50 / 06:10 / 06:30 | — | ~1 | |
| warm-earnings 07:15, warm-pickers-sec 05:35 | | no SEC | warm-pickers-sec ~860 a run | **B's** files |

- **SEC job windows, kept by the archive's clock guard (#669, `inSecJobWindow`):** 03:55–06:50 and 16:15–16:50 UTC, plus :38–:48 of even hours in reporting season. A start inside a window exits green without reading.
- **Archive (Cloudflare R2), `.github/workflows/sec-archive.yml`:**
  - `incremental`: cron 03:05, **but GitHub starts it about 6–7 h late**; ≤4/s; ~760 SEC requests on 1 Oct, 0 failed.
  - `backfill`: one-off, done.
  - `diff`: on dispatch; reads R2 plus Redis, 0 SEC.
  - Universe = registrants ∪ `archive-extra-ciks.json` ∪ predecessors = 2,615 CIKs.
  - Last diff (1 Oct): 770 identical, 190 differ (filing-fill timing, and a CNY FX 502 artefact).
- **Per-day Redis per A job isn't fully instrumented**; that's the "instrumentation" item in the queue.

## 4. Post-purge queue, in order
1. **#86b market-cap fixes** (COWORK #86b, CODE-A #93/#98):
   - cited 20-F/40-F covers, newer-only: 8 fill now, ~7 more with the common-line rule;
   - multi-class gets its own reason, never stale or no-cover; cite only where the filing states the conversion; trace V's existing row;
   - ADS ratio rows for the 16, each cited, direct listings checked per filing;
   - ZION: refuse P/S for SIC 6000–6299 filers without a total-revenue concept;
   - GDDY: P/B "not meaningful" below an equity/cap threshold, in `PE_MIN_EPS` style. **Waiting on Cowork:** may the counts-only census run? Otherwise use 1%;
   - `warm-pickers-sec` doesn't pass `citedCover`: that's B's file; Cowork to assign.
2. **#87, C's visuals,** commits on `claude/exciting-noether-shs044` after C opens the PR:
   - swap `<GrowthMarginsChart>` for `<GrowthVisuals data={buildGrowthVisuals(view)} notReported={NOT_REPORTED} />` and wrap the table's scroll div in `<SeeAllTheNumbers>`;
   - append C's two files to `scripts/lib/render-cards.mjs`;
   - a per-period one-off note on `recentPeriods`, using `largeNonOperating` for every period (**the blocker**: ONDS Q1 '26);
   - `netIncome` on `annual`;
   - review C's three re-wordings;
   - Cowork previews ONDS at desktop and 400 px.
3. **#88/#89, the dilution series fix and layout:**
   - split adjustment from restated comparatives;
   - no line across an unexplained step over 100×;
   - pre-listing points dropped;
   - gaps over 15 months: fill from the filings, else break the line and label it "no filing data";
   - 3-year trend with a base within 6 months before the cut, else "Recent history too short"; two figures side by side;
   - hedged wording, and drop "(buybacks)" (COWORK #90);
   - layout: chart and "Learn the indicators" full width after `clear: both`;
   - screenshots of PAC, AAPL, GDDY and AMZN at desktop and 375 px. AAPL's 9 quarterly points go into the same trace.
4. **Bank revenue** (COWORK #81/#83):
   - an R then N chain (`RevenuesNetOfInterestExpense`, then NII + noninterest income), gated to SIC 6000–6299;
   - a mutation proving gross interest income is never used;
   - state the re-window command cost;
   - IFRS banks later.
5. **The archive switch PR** (COWORK #84 rules):
   - keep the cover, instance-EPS and `ff` layers;
   - the diff tags `ff` sets and retries FX.
6. **PR 2,** as before.
7. **Outlook** (low): the table-row classifier pass, then re-run the same 100 filers at ≤4/s clear of the windows, posting 20 rows with 8-K accession numbers.

## 5. Gotchas
- **Previews never write SEC state.** `secWriteGate`/`canWriteSecState` require `VERCEL_ENV=production`.
  - A preview cold-fill does **not** warm production.
  - Never fake `VERCEL_ENV`. Production writes from runners happen only on the owner's GO (like the XOM/JPM one-off).
- **The cold-fill limiter:** `fetchColdSubmissions` claims `claimColdFetch` before every SEC call and throws without a User-Agent. `coldSecConfigured()` gates it, and preview counters use a separate `secCounterPrefix`.
- **XOM's predecessor:** report dates and facts merge the predecessor CIK (`withPredecessorSubmissions`, `predecessorCikFor`). Without the merge XOM had 1 event; with it, 20.
- **JPM's short feed:** its submissions `recent` holds under 3 years of filings because of 424B noise, so `feedShort: true` gives the "short-feed" copy rather than an estimate. The cadence from archived older pages is a later item.
- **The `ff` layer:** the filing job fills the newest quarter from the 10-Q's XBRL instance before companyfacts has it.
  - The set's stamp `ff` marks it, and the archive diff must tag it.
  - Report-date records are rebuilt by `reportDatesNeedRebuild` (older than `set.at`, or a lagging period at least 20 h old).
- **ADS refusals:** any 20-F filer without a cited ratio in `data/sec/ads-ratios.json` refuses cap and P/E, and is never defaulted to 1. Direct listings are `kind: "ordinary"`, ratio 1, with citations.
- **No links, tokens or credentials** in relay inputs, logs or comments (the repo and Actions logs are public). Logs carry status and counts only.
  - SEC values may be printed; FMP/vendor data never (presence only).
- **SEC 429/403:** stop, don't re-dispatch, and post on #552 first.
- **The relay loader:** probes that import modules using the `@/` alias need `scripts/lib/register-ts-app.mjs`, not `register-ts-here.mjs`.
- **Local `next build` fails** without Upstash (ISR timeouts). That isn't evidence of breakage; tsc, eslint, check-all and Vercel are the checks.
- **File ownership:** Pickers, screeners, price and the warm-pickers job are **B's** files; A's are listed in the #552 body. Shared files take append-only edits.

## 6. Waiting on the owner or Cowork
- **Owner:** the purge GO for Sat 09:00 UTC; the GitHub Support request after it; optional deletion of the old Vercel deployments.
- **Cowork:**
  - whether the counts-only P/B equity/cap census is allowed (CODE-A #93 §5);
  - who adds `citedCover` to `warm-pickers-sec` (B's file);
  - a ruling on the outlook classifier pass if it's to run.
- **Routines bound to this session:**
  - the purge pre-check `trig_01U4bt4oC4mYDsFL3MDYaSM7` (Sat 08:35).
  - B's and C's own "paused" routines fire Sat 08:25 and 08:10 into their sessions.
  - The daily check-ins were one-off routines; none is set for 3 Oct onward, so a new A session should create its own (05:05 UTC: `write-code-a-checkin` from the probe branch, `write-fact-set-index-drift` from main).
