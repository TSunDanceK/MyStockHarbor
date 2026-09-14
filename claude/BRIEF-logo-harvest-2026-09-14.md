# BRIEF — self-host the ticker logos, and bank the domain map (2026-09-14)

Paste-ready for a fresh Claude Code session. Self-contained: assume no chat history.

**Read first:** `CLAUDE.md` (repo root), `app/api/debug/static-profile/README.md`,
`app/components/TickerLogo.tsx`.

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
6. **The logo universe is ~2,653 symbols.** An earlier draft of this brief said
   "~700" and that was wrong — corrected 2026-09-14 after the figure was traced.
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
     and "Explore More Stocks", so `TickerLogo` renders them today. **Scoping to
     ~700 would miss all of them.**

---

## PHASE 0 — probe only. Report back and STOP.

**No product code, no PR, nothing merged to `main`.** An earlier draft said "no
commits", which was self-contradictory: a runner cannot execute uncommitted code.
Committing the probe script and its registry entry to a feature branch is
expected and pre-approved.

**Mechanism — settled, do not re-derive.** Add a read-only, unprefixed task to
`scripts/relay-run.mjs` and dispatch it with `ref` pointing at the feature
branch. Do **not** add a job to `relay.yml` and do **not** add a scratch
workflow: `workflow_dispatch` only registers for workflow files on the **default
branch**, so either would cost a merge to `main` — the toll `relay.yml` exists
to avoid, and which its own header records being paid twice in one day (#436,
#444). The task stays in the job that references no secrets, so the
no-FMP-key-in-Actions constraint is never in play.

**Artifact trap:** `relay.yml`'s artifact upload globs are a fixed list on
`main`, and none match a new filename — a JSON output file is silently
discarded (the same failure its comment records for company-tickers). Send full
results to **stdout**, which `task.log` captures and uploads.

On a runner with real internet:

1. Build the candidate list per constraint 6 — the union of
   `data/company-names.json`, `data/static-profile.json` and
   `lib/curatedSymbols.ts`, ~2,653 symbols. State the figure you actually got.
2. `HEAD` or ranged-`GET` each `https://images.financialmodelingprep.com/symbol/{SYM}.png`,
   at most 8 concurrent, with a real User-Agent. Treat a 200 under ~200 bytes as
   a miss (placeholder), not a hit. Settle the `BRK.B` / `BRK-B` spelling
   question while you are in there.
3. Report:
   - total probed, hits, misses, hit rate
   - hit rate split by exchange and by whether the symbol is an ETF/fund.
     **Note `exchange` is in `static-profile.json`'s `absentFields.blocked`** —
     it is one of the eight fields Phase 1 exists to capture, so this split
     cannot come from committed data. The Nasdaq symdir files carry `Exchange`
     and an ETF `Y/N` flag natively and are free to fetch with no credential;
     `scripts/lib/nasdaq-directory.mjs` parses them but drops both columns, so
     re-parse locally (header-driven) rather than widening a shared module
     during a probe-only phase.
   - byte-size distribution of hits: min / median / max
   - **raw PNG byte total for all hits** — this sizes Phase 2 and decides where
     the harvested files live (see Phase 2)
   - wall-clock for the run, and whether any rate-limiting or 429s appeared
   - **20 named misses**, so the owner can eyeball whether they are companies
     that genuinely have no logo (muni closed-end funds, thin ETFs) or real
     names that need a gap-filler

Then stop and report. The hit rate decides whether Phase 2 is worth running at
all, and the named misses decide whether a gap-filler is needed or whether the
existing monogram is already the honest answer for that tail.

---

## PHASE 1 — bank the domain map (only on approval; independently valuable)

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

## PHASE 2 — harvest and transcode (only on approval, and only if Phase 0's hit rate justifies it)

Same mechanism as Phase 0 — a relay task dispatched at the feature branch, not a
workflow edit.

1. Fetch each hit from Phase 0.
2. Transcode with `sharp` (add as a **devDependency** — it must not enter the
   runtime bundle): `{SYM}.webp` at 64px and `{SYM}@2x.webp` at 128px, contain-fit,
   transparent background preserved.
3. **Where these live is an open decision, settled by Phase 0's byte total — do
   not assume `public/logos/`.** The earlier "~700 symbols, under ~6 MB" estimate
   was built on the wrong universe figure; at ~2,653 symbols it is roughly 3.8×
   out. The two candidate homes:
   - **`public/logos/`** — served from our own domain via Vercel's CDN, no third
     party, works in local dev. Right answer while the total is small.
   - **A separate repo published via GitHub Pages** — free, GitHub's own CDN,
     keeps this repo and every deploy lean. Right answer if the total is large,
     since `public/` bloats every clone and every build permanently.

   Rough threshold: under ~10 MB, `public/`; over ~25 MB, the separate repo;
   in between, report and ask. **Never hotlink `raw.githubusercontent.com`** —
   GitHub does not permit it as a CDN, it is rate-limited, and it would only
   trade an FMP dependency for a GitHub one.
4. Emit `data/logo-manifest.json` — a plain array of symbols that have a local
   file. `TickerLogo` reads this so it never requests a 404.
5. Open a PR. Do not merge.

---

## PHASE 3 — wire it up (same PR as Phase 2)

Change `TickerLogo.tsx` **source order only**. Do not restructure the component;
the fallback chain and the monogram are correct as they stand.

New order:

1. The harvested logo — when the symbol is in the manifest. Build the URL from a
   single base constant so the Phase 2 storage decision is one line to change.
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
   you cannot load it yourself. Suggest MU, NVDA, MUJ and a Phase 0 miss as the
   four to look at: the first two should be harvested files, MUJ should still be
   a monogram, and the miss should show whichever fallback caught it.

---

## Out of scope

No paid logo vendor and no paid storage. No Vercel Blob, no R2, no logo API
subscription — the owner has ruled out paying for logos. Both storage candidates
in Phase 2 are free.

---

## Noted, not acted on

`lib/curatedSymbols.ts` still lists `SQ`, which no longer exists as a ticker.
Separate cleanup, not part of this brief.
