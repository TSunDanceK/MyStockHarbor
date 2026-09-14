# BRIEF — self-host the ticker logos, and bank the domain map (2026-09-14)

Paste-ready for a fresh Claude Code session. Self-contained: assume no chat history.

**Read first:** `CLAUDE.md` (repo root), `app/api/debug/static-profile/README.md`,
`app/components/TickerLogo.tsx`.

**Phase 0 is complete** — see `claude/logo-coverage-probe-results-2026-09-14.md`.
Phases 1, 2 and 3 are the remaining work.

---

## Goal

Stop serving every ticker logo on the site from FMP's CDN on every page view, and
own the assets instead. Secondary, and time-critical: capture the `website` field
for the universe **while the FMP licence is still live**, because it is the key
that unlocks every free logo source that exists after FMP is gone.

## Why now

`TickerLogo.tsx` currently hotlinks `images.financialmodelingprep.com/symbol/{SYM}.png`
as its second source. That endpoint needs no API key and no quota, so it costs
nothing against the plan — but it is FMP infrastructure. If the account lapses or
they lock the CDN down, every logo on the site silently degrades to a monogram.
The logos are not FMP's intellectual property; they are the companies' trademarks.
FMP cannot license what it does not own. What it can do is stop serving them.

---

## Non-negotiable constraints (read before planning anything)

1. **Do NOT add `FMP_API_KEY` to the repository's GitHub Actions secrets.**
   `app/api/debug/static-profile/README.md` rules this out deliberately: the repo
   is public and forkable, and the credential split between production and
   `relay.yml` is a security property, not an oversight. If a step seems to need
   the FMP key in Actions, the step is wrong — re-plan it.
2. **The agent sandbox cannot reach `financialmodelingprep.com` (403 CONNECT).**
   Recorded in `data/static-profile.json`'s own comment and re-confirmed
   2026-09-14 against `images.financialmodelingprep.com` — the image CDN is
   blocked exactly like the API host. Anything that fetches from FMP runs on a
   runner, not in the sandbox.
3. **The image CDN needs no credential.** So the logo harvest is purely a
   *reachability* problem, not a credential one — which is why the relay is the
   right home for it and constraint 1 is never in play.
4. **Push mechanics:** GitHub MCP only, shell git is blocked. Every push is
   full-file content. PR against `main`, do not self-merge — this is the manual
   path, so the human-approval gate in `CLAUDE.md` step 6 applies.
5. **The sandbox cannot reach `*.vercel.app` or `www.mystockharbor.com`.** You
   cannot verify the rendered result. `tsc --noEmit` and `eslint` are the checks
   that work locally; `next build` fails locally for unrelated reasons (Upstash)
   and is **not** evidence your change broke anything. Visual verification is an
   owner-side step.
6. **The logo universe is 2,653 symbols.** An earlier draft of this brief said
   "~700" and that was wrong — corrected 2026-09-14 after the figure was traced,
   and the union has since been confirmed by the Phase 0 run.
   The numbers in the repo mean different things:
   - **~700** — `readPickersSymbolsIfCached()`, the pickers cache in Redis, sized
     for FMP call pacing. **Not the logo universe.** Unreadable from the sandbox
     and from the read-only relay job (no Upstash credentials, by design).
   - **2,592** — `data/company-names.json`, Nasdaq symdir snapshot.
   - **2,619** — `data/static-profile.json`, sector/industry only.
   - **2,653** — the full candidate union, including the **161** in
     `lib/curatedSymbols.ts`, of which **33 appear in neither committed file**.
     Those 33 are nearly every major ETF the site links — SPY, QQQ, DIA, IWM,
     VTI, VOO, ARKK, the XL* family, GLD, TLT, SMH. They feed `app/sitemap.ts`
     and "Explore More Stocks", so `TickerLogo` renders them today. Phase 0
     measured them at **33/33 coverage**; scoping to ~700 would have missed all
     of them.

---

## PHASE 0 — COMPLETE

Run **34888872483**, commit `2282a8cf` on `claude/awesome-fermat-m7vy1w`.
**2,644/2,653 hits — 99.7%**, 22s, no 429s, zero placeholders.
Full figures, splits, the 9 named misses and the byte analysis are in
`claude/logo-coverage-probe-results-2026-09-14.md`. Do not re-run it.

Mechanism, recorded because Phase 2 reuses it: a read-only, unprefixed task in
`scripts/relay-run.mjs`, dispatched with `ref` pointing at the feature branch.
**Not** a job in `relay.yml` and **not** a scratch workflow — `workflow_dispatch`
only registers for workflow files on the **default branch**, so either would cost
a merge to `main`, the toll `relay.yml` exists to avoid (its header records that
being paid twice in one day, #436 and #444). The task stays in the job that
references no secrets, so constraint 1 is never in play.

**Artifact trap:** `relay.yml`'s artifact upload globs are a fixed list on
`main`, and none match a new filename — a JSON output file is silently discarded
(the same failure its comment records for company-tickers). Send full results to
**stdout**, which `task.log` captures and uploads.

---

## PHASE 1 — bank the domain map (independently valuable; do this regardless)

This is **already built and never run**. `app/api/debug/static-profile/README.md`
documents a capture route that returns eight uncaptured fields including
`website`, running in production where the FMP key already lives — no new
credential anywhere.

**Known gap, flag it rather than working around it:** this route's universe is
the pickers cache (~700), *not* the 2,653-symbol logo universe of constraint 6.
So the domain map it produces will cover roughly a quarter of the symbols that
render a logo. That is still worth banking — it is the only window in which
`website` is obtainable at all — but do not describe the result as complete, and
report how many of the 2,653 ended up with a domain.

1. Owner runs, in a browser, walking `offset` until `done` is `true`
   (~700 symbols ≈ 3 pages):

       /api/debug/static-profile?key=$EARNINGS_BACKFILL_KEY&offset=0&limit=250

2. Owner pastes each page's `rows` object into
   `data/.wire/static-profile-extra-<page>.json`.
3. You run `scripts/static-profile-expand.mjs` and open the PR.

Do this whether or not the logo work proceeds. Once the FMP subscription ends,
`website` is gone and is genuinely hard to reconstruct; a ticker→domain map is
what makes `apple-touch-icon.png`, Clearbit and Wikidata usable forever, with no
vendor attached. The capture route is marked for deletion once its fields are
committed — delete it in the same PR, as its README instructs.

---

## PHASE 2 — harvest and transcode (settled by Phase 0)

Phase 0 measured **99.7% coverage**, so the harvest proceeds. Same mechanism as
Phase 0 — a relay task dispatched at the feature branch, not a workflow edit.

1. Fetch each of the 2,644 hits.
2. Transcode with `sharp` (add as a **devDependency** — it must not enter the
   runtime bundle). **One size only: `{SYM}.webp` at 72px**, contain-fit,
   transparent background preserved.

   **Departure from the original two-size spec, taken deliberately.**
   `TickerLogo` renders at 18 (dashboard feed), 24 (default) and 34
   (stock/news/earnings H1s). The largest display size anywhere is 34px, so a
   72px asset already exceeds 2× at every call site and the `@2x`/128px variant
   would be dead weight. This roughly halves the payload.

   Three source-shape rules, from the Phase 0 dimension data:
   - **Source wider than 72px** — downscale to 72.
   - **Source 24–72px wide** — keep at native size, do **not** upscale. 35
     symbols are in this band (AFYA, ARR, FANG, FUN and others at 16/30/32/48px);
     an upscaled 32px logo looks worse than the monogram it replaces.
   - **Source narrower than 24px** — skip entirely. It falls through the chain
     to the monogram, which is the better rendering.

   **4 hits carry no PNG IHDR** — AEFC, APXT, JOYY, NIQ, each 2.6–3.3 KB served
   under a `.png` name. Let `sharp` attempt them; on failure skip the symbol and
   list it in the PR body. Do not special-case the format.

3. **Home: `public/logos/`.** With the single-size decision the projection lands
   around 5–7 MB, clear of the ~10 MB line, so no separate repo and no GitHub
   Pages. Raw PNG total was 33.11 MB — do not commit the PNGs, only the WebPs.
4. Emit `data/logo-manifest.json` — a plain array of symbols that have a local
   file. `TickerLogo` reads this so it never requests a 404. Skipped symbols
   (sub-24px sources, `sharp` failures, the 9 misses) must be absent from it.
5. Open a PR. Do not merge. Report in the body: file count, total committed
   bytes, and every symbol skipped with its reason.

**Refresh:** the harvest goes stale as new symbols list. Re-run quarterly. Until
then new listings fall through to FMP's CDN while it works, and to the monogram
after it stops — no breakage either way.

---

## PHASE 3 — wire it up (same PR as Phase 2)

Change `TickerLogo.tsx` **source order only**. Do not restructure the component;
the fallback chain and the monogram are correct as they stand.

New order:

1. `/logos/{SYM}.webp` — when the symbol is in the manifest. Build the URL from
   a single base constant so the storage home is one line to change later.
2. Clearbit `logo.clearbit.com/{domain}` — unchanged, when a `domain` is known
3. FMP CDN — unchanged, now a fallback rather than the primary
4. Monogram — unchanged

Keep steps 2–4 exactly as they are. FMP stays in the chain deliberately: it costs
nothing while it works, and it covers anything the harvest missed.

**Flagging as a departure for the owner to veto:** this demotes Clearbit below a
harvested asset, so bottleneck rows that currently render a Clearbit domain logo
will switch to the harvested one where both exist. That is intended — the
harvested file is faster and has no third party in it — but it is a visible
change to pages that already look right today.

---

## PHASE 4 — verification

1. `npx tsc --noEmit` and `npx eslint` — both must pass.
2. Confirm the manifest and the file listing agree in both directions: no
   manifest entry without a file, no file without an entry.
3. Spot-check ten committed WebPs actually decode and are not 0-byte or
   placeholder images.
4. Report the PR's Vercel **branch alias** URL for owner-side visual checks —
   you cannot load it yourself. Suggest four: **MU** and **NVDA** (ordinary
   harvested files), **FANG** (a sub-72px source kept at native size, so the
   no-upscale rule is visible), and **JMKE** (a Phase 0 miss — should show
   whichever fallback caught it, most likely the monogram).
   Note MUJ is *not* a useful check any more: it was assumed logo-less when the
   brief was written, but Phase 0 measured it as a hit.

---

## Out of scope

No paid logo vendor and no paid storage. No Vercel Blob, no R2, no logo API
subscription — the owner has ruled out paying for logos. `public/logos/` costs
nothing.

No gap-filler for the 9 misses. Phase 0 established they are recent listings plus
two FITB preferred series — a drifting set FMP will likely backfill, not a
structural tail worth engineering against.

---

## Noted, not acted on

`lib/curatedSymbols.ts` still lists `SQ`, which no longer exists as a ticker.
Separate cleanup, not part of this brief.
