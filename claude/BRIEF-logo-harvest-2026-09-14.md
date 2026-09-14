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
   blocked exactly like the API host. Anything that fetches from FMP runs in
   `relay.yml`, not in the sandbox.
3. **The image CDN needs no credential.** So the logo harvest is purely a
   *reachability* problem, not a credential one — which is why `relay.yml` is the
   right home for it and constraint 1 is not in play.
4. **Push mechanics:** GitHub MCP only, shell git is blocked. Every push is
   full-file content. PR against `main`, do not self-merge — this is the manual
   path, so the human-approval gate in `CLAUDE.md` step 6 applies.
5. **The sandbox cannot reach `*.vercel.app` or `www.mystockharbor.com`.** You
   cannot verify the rendered result. `tsc --noEmit` and `eslint` are the checks
   that work locally; `next build` fails locally for unrelated reasons (Upstash)
   and is **not** evidence your change broke anything. Visual verification is an
   owner-side step.
6. Universe is **~700 symbols**, not 10,000. Do not scope for 10,000.
   Note the two different figures in the repo and do not conflate them:
   `data/static-profile.json` holds sector/industry for **2,619** symbols (free,
   from the Step 0 dump), while the capture route's own README sizes a full
   capture at **~700 symbols, three pages**. Phase 0 reports the real number.

---

## PHASE 0 — probe only. Report back and STOP.

No branches, no commits, no file changes. The only output is a report.

Add a temporary `workflow_dispatch` job to `relay.yml` (or a scratch workflow —
your call, say which) that, on a runner with real internet:

1. Builds the candidate symbol list from the site's actual universe. Find where
   that lives — `lib/curatedSymbols.ts`, `data/company-names.json` and
   `app/api/debug/universe-size/route.ts` are the starting points. State plainly
   which source you used and how many symbols it yielded.
2. `HEAD` or ranged-`GET` each `https://images.financialmodelingprep.com/symbol/{SYM}.png`,
   at most 8 concurrent, with a real User-Agent. Treat a 200 under ~200 bytes as
   a miss (placeholder), not a hit.
3. Report:
   - total probed, hits, misses, hit rate
   - hit rate split by exchange and by whether the symbol is an ETF/fund
   - byte-size distribution of hits: min / median / max
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

In `relay.yml`, `workflow_dispatch`:

1. Fetch each hit from Phase 0.
2. Transcode with `sharp` (add as a **devDependency** — it must not enter the
   runtime bundle): `{SYM}.webp` at 64px and `{SYM}@2x.webp` at 128px, contain-fit,
   transparent background preserved.
3. Write to `public/logos/`. Budget: **~700 symbols × 2 sizes should land under
   ~6 MB.** If the real figure exceeds ~15 MB, stop and report rather than
   committing — at that point `public/` is the wrong home and it becomes an
   owner decision about storage.
4. Emit `data/logo-manifest.json` — a plain array of symbols that have a local
   file. `TickerLogo` reads this so it never requests a 404.
5. Open a PR. Do not merge.

---

## PHASE 3 — wire it up (same PR as Phase 2)

Change `TickerLogo.tsx` **source order only**. Do not restructure the component;
the fallback chain and the monogram are correct as they stand.

New order:

1. `/logos/{SYM}.webp` — when the symbol is in the manifest
2. Clearbit `logo.clearbit.com/{domain}` — unchanged, when a `domain` is known
3. FMP CDN — unchanged, now a fallback rather than the primary
4. Monogram — unchanged

Keep steps 2–4 exactly as they are. FMP stays in the chain deliberately: it costs
nothing while it works, and it covers anything the harvest missed.

**Flagging as a departure for the owner to veto:** this demotes Clearbit below a
local asset, so bottleneck rows that currently render a Clearbit domain logo will
switch to the harvested one where both exist. That is intended — a local file is
faster and has no third party in it — but it is a visible change to pages that
already look right today.

---

## PHASE 4 — verification

1. `npx tsc --noEmit` and `npx eslint` — both must pass.
2. Confirm the manifest and the file listing agree in both directions: no
   manifest entry without a file, no file without an entry.
3. Spot-check ten committed WebPs actually decode and are not 0-byte or
   placeholder images.
4. Report the PR's Vercel **branch alias** URL for owner-side visual checks —
   you cannot load it yourself. Suggest MU, NVDA, MUJ and a Phase 0 miss as the
   four to look at: the first two should be local files, MUJ should still be a
   monogram, and the miss should show whichever fallback caught it.

---

## Out of scope

No paid logo vendor. No new storage service. No Vercel Blob, no R2, no logo API
subscription — the owner has ruled out paying for logos, and at ~700 symbols the
repo can hold them.
