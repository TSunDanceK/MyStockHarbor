# News art v2: the tagged library on `/headlines` (2026-09-21)

The brief this implements was written outside the repo, so this file carries its
substance rather than a link to it. It also carries what the implementation
found, which is not the same as what the brief expected — §6 in particular.

**Status: the machinery is in, the images are not.** `manifest-v2.json` ships
empty and every tagged lookup returns null, so `/headlines` renders exactly what
it rendered before this change. §4.1 says what landing the images consists of.

---

## 1. Where the art is

330 images: a 1200×675 WebP plus a 320×180 `-sm` thumbnail each (660 files,
~24 MB), converted with the settings the shipped library already uses —
centre-crop to 16:9 → PIL LANCZOS → WebP `quality=82, method=6`.

- 67 subjects × 4 scenes, named `<subject>-any-NN` (268 files' worth).
- 16 motifs × 4 scenes, named `any-<motif>-NN`, except `any-deal` and
  `any-macro`, which hold 3 each pending two redos.
- Every image passed a text screen (tesseract `--psm 11`, conf ≥ 65, each hit
  cropped and looked at) and a by-eye check for people: no writing, logos or
  faces.
- No filename collides with the shipped `sector-*` / `event-*` library.

The manifest entry is the image's tags, keyed by the WHOLE FILE STEM:

```json
"chips-any-01":  { "primary": ["chips"], "related": ["semiconductors","ai-compute","electronics","technology"],
                   "motif": ["any"],   "tone": "flat", "palette": "neon wireframe",
                   "source": { "batch": "batch-01", "serial": "01" } },
"any-macro-01":  { "primary": [],       "related": ["guidance","utilities-grid"],
                   "motif": ["macro"],  "tone": "flat", "palette": "mono plus accent" }
```

**The files live on the owner's PC (`Downloads\zapi-img`), not in this repo and
not anywhere a Claude session can reach** — the sandbox's outbound allowlist
covers GitHub's API and npm and nothing else (CLAUDE.md, "Claude's cloud sandbox
has a restrictive outbound network allowlist"). So the code landed without them.
The manifest is the source of truth for what exists; do not assume four of
anything.

---

## 2. Why `/headlines` showed nothing, stated precisely

PR #481 wired `NewsCardArt` + `planCardArt` into `app/headlines/page.tsx` with
`sectorBucket: null` and `canGenerate: false`. That was right, and the page is
deployed and working. But it leaves exactly one way for a headline to get art:
`eventTypeFromTitle` returning `earnings`, `analyst` or `deal` — the only three
of the five event types a title-only feed can reach. Measured upper bound: 7% on
a per-symbol sample that over-represents company earnings copy.

The new library does not change that on its own, and this is the part worth
being blunt about: **Wave 1 art is tagged by subject, and a headline has no
symbol, so nothing maps.** There is not a single `any-any-*` image in the set.
Dropping 330 files into `public/news-art` and stopping there would leave the
page exactly as blank as it is now.

What makes the library reachable from a headline is a **topic classifier over
the article's own words**. That is the substance of this change.

---

## 3. Scope

**In:** a v2 manifest, a tag-scoring picker, a headline topic classifier,
`/headlines` switched to use them, and the checks.

**Out, deliberately:** `/stock/[symbol]/news`, `/sector/[slug]/news` and the
dashboard strip keep today's `bucketForItem` art untouched. They work; there is
no reason to put them in the same change as a new selection rule. The
provider-map (FMP labels + SIC → concepts) belongs with that later change. Tone
(`up`/`down`/`flat`) stays recorded-but-unused: selecting on it would mean
deciding an article is good or bad news from its headline, which is a different
and much less reliable classifier than this one.

---

## 4. What landed

### 4.1 Files

`public/news-art/manifest-v2.json`, **empty**, beside the untouched
`manifest.json`. Landing the images is a data-only follow-up:

1. Unzip both archives into `public/news-art/` (flat, beside the existing
   library).
2. Copy `news-art-manifest-full.json` to `public/news-art/manifest-v2.json`.
3. `node scripts/check-news-art.mjs` — it fails if any name lacks its two
   files, if any file is unreachable from the manifest, or if any pattern in the
   classifier names a tag no image carries.

In that order. A manifest entry with no file behind it is a broken image on a
live page, which is the one failure nothing else catches: the page renders
regardless and only a visitor sees it.

`manifest.json` is **not touched**. `lib/server/news/art.ts` imports it as
`Record<string, number>` bucket counts; a v2 shape at that path would break the
three working surfaces at build time or, worse, silently. Two manifests, two
consumers, no shared type — asserted in §5.

Repo weight when the images land: +~24 MB, largest single file ~200 KB, within
GitHub's 1 MB-per-object guidance and nowhere near the 100 MB hard limit.

### 4.1b Serving, which was already wrong and is fixed here

`claude/serving-assets-from-public-2026-09-15.md` owns how `public/` assets are
served, and checking this change against it found that **`news-art/` had neither
of the two things `logos/` has**:

- no `middleware.ts` matcher exclusion, so every illustration request ran
  `isTrapBlocked` — a Redis call — before the `/api/` early return;
- no `Cache-Control`, so Next served it `max-age=0, must-revalidate` and a
  repeat visitor re-requested every picture on the page.

Survivable while three cards a page carried art. `/headlines` is a grid of up to
50, so this change is what turns it into the logos problem. Both are fixed here
and both are asserted in §5.

### 4.2 `lib/server/news/artTags.ts` — the picker

Scoring, unchanged from the brief:

```
score = 3 × |primary ∩ subjectTags|
      + 1 × |related ∩ subjectTags|
      + 2 × |motif   ∩ articleMotifs|
```

- Highest-scoring set wins; **a score of 0 returns null**, never a random image.
- Within the winning set, the article's guid (or link) is hashed with `hashKey`
  from `art.ts` — not a second hash — and walked on collision against a per-page
  `taken` set, exactly as `pickArt` does.
- `src`/`srcSet`/width/height are built as `artAt` builds them, so `NewsCardArt`
  needed no change.
- **The name in the manifest is the whole filename stem.** The `-01` is part of
  the name; there is no `+1` here to get wrong, which is the one thing v1's
  README still carries a scar from.
- It also holds `planHeadlineArt`, which is the whole `/headlines` rule as a
  callable function. See §5 for why that matters more than it looks.

### 4.3 `lib/server/news/articleTopic.ts` — headline → tags

Pure function over `title` plus `description` when present, returning
`{ subjects, motifs }`, both usually empty. The house rules are carried straight
from `eventType.ts`: whole-word phrase-anchored matching, decisive phrases only,
the title outranking the description (a description match needs two independent
occurrences), first match wins with narrow before broad.

25 subject patterns and 8 motif patterns. The remaining 8 motifs (`cash`,
`contract`, `filing`, `launch`, `leadership`, `partnership`, `split`, `supply`)
have art but no patterns, deliberately: a motif reachable by a phrase that
carries two meanings in a financial headline costs more than a motif that is
never reached.

### 4.4 `/headlines`

One call per card to `planHeadlineArt`: tags first, then the existing
`eventTypeFromTitle` → `planCardArt` path unchanged, then nothing. Compact cards
are not in play here; the rule that at 56px a ticker beats a shrunk illustration
has not changed.

---

## 5. Checks — and one that was not good enough

`scripts/check-news-art.mjs` gained a section 9: manifest shape both ways
(no name without files, no file without a name), safe filename stems,
`manifest.json` still holding numbers, every pattern reaching at least one image
(skipped with a loud NOTE while the manifest is empty, since there is nothing to
reach), the classifier against a committed fixture of real headlines, and the
picker against a synthetic manifest — because running the scoring against
today's empty one would assert that nothing happens, which is a test that passes
because the feature is off.

**The assertion that was not good enough is worth recording, because it looked
fine.** The first version proved "tagged art is asked first" by comparing where
`pickTagged(` and `planCardArt(` appear in the page source. `if (false &&
tagged)` passed it cleanly — the identical failure this file already records
twice, where wrapping a render in `{false ? … : null}` left every identifier a
grep looked for in place while the page went blank.

So the rule moved out of the page body into `planHeadlineArt`, and section 9
tests it by calling it. The same mutation now fails three assertions. Seven
other mutations were run against the new checks and all seven fail: score-0
returning an image, the names left unsorted, motif outscoring subject, a
manifest name with no file, a file with no manifest name, the fall-through
deleted, and the description weighted as heavily as the title.

---

## 6. Measurement — and the number in the brief does not survive it

The brief's table was drafted against the 50 headlines live on `/headlines` on
2026-09-21 and measured on those same 50: **29 subject matches (58%), 15
motif-only (30%), 6 nothing**. Those patterns were written while looking at
those headlines, so that is a fitted upper bound, not a rate — the same
relationship the earlier 7% has to the event-type leg.

### The held-out re-run

**Sample:** `scripts/fixtures/eventtype-gnews.jsonl` — one real Google News
poll captured 2026-09-13 by the relay (16 symbols × 12 headlines, 192 items,
180 distinct titles), publisher suffix stripped as the adapter strips it. It
predates the pattern table by eight days and nothing in it was seen while
writing the patterns. `node scripts/newsart-topic-sample.mjs` reproduces all of
this.

**It is not the general feed.** It is the PER-SYMBOL feed, which is single-
company copy: headlines that name a company rather than an industry. That is
most of the gap below and it is why this does not replace a general-feed
measurement — it bounds it from a different side.

| | all 192 rows | 180 distinct titles |
|---|---|---|
| subject matched | 13 (6.8%) | 13 (7.2%) |
| motif only | 29 (15.1%) | 26 (14.4%) |
| nothing | 150 (78.1%) | 141 (78.3%) |

**58% fitted, 7% held out.** On company headlines the subject table is worth
about what the event leg was worth, which is the honest thing to expect: a story
about Costco's quarter says "Costco", not "retailers". The 58% figure should not
be repeated anywhere without the sample attached to it.

Subjects that fired: `ai-compute` 5, `exchanges` 4, `chips` 3, `ev` 1. Nineteen
fired not at all, which on a 16-symbol tech-and-consumer sample is expected
rather than alarming — there is no refinery, shipping or agriculture headline in
it to match.

Motifs fired on 30 of 192: `earnings` 14, `guidance` 9, `analyst` 4, `macro` 1,
`deal` 1, `legal` 1. `jobs` and `ipo` did not fire.

### The precision read-through

All 39 distinct matches were read against their headlines. Precision is what
matters here and it cannot be counted from a rate: the question is whether the
picture asserts something the article does not say.

- **30 clean.** A chips illustration on "Apple and Taiwan Semiconductor
  Manufacturing Just Announced a Cutting-Edge Chip", an analyst motif on
  "Barclays resets Oracle stock price target", earnings on "Oracle's stock edges
  up on earnings beat". No complaint about any of them.
- **1 clearly wrong.** "Costco Wholesale Corporation $COST Shares Acquired by
  Saudi Central Bank" → `macro`, because `central bank` fires on a NAMED
  INSTITUTION buying shares. `macro` is top of the motif table, so it wins
  outright on an ownership story.
- **8 defensible but not good.** Four are `exchanges` from "Wall Street" used as
  a metonym for analysts ("Fail to Wow Wall Street"), three are `earnings` from
  a valuation multiple rather than an earnings event ("Overvalued At 28x
  Earnings?"), one is `guidance` from an author's price forecast rather than
  company guidance.

All nine are in `scripts/fixtures/article-topic.jsonl` marked `imprecise` with
the reason, printed as NOTEs by the check and not asserted — so a later
narrowing that fixes one does not fail the suite for fixing it.

### What was changed, and what deliberately was not

**Changed: `banks`.** The draft was `/\b(banks?|lenders?)\b/i`. It fired three
times on the held-out sample and all three were a bank appearing in someone
else's story — "Bank of America resets Apple stock price target", "Deutsche
Bank's 304% Profit Growth Outlook" on NIO, and the Costco line above. A bank
vault on an Apple analyst note is exactly the failure the 3-vs-2 weighting
exists to bound rather than to license. The bare singular is gone; "banks",
"regional lenders" and "the banking sector" still match. It cost no true
positive on this sample — there were none to lose.

**Not changed, on one instance each** — narrowing a pattern to fit a single
occurrence is how a table stops describing the feed and starts describing the
sample:

- `macro`'s "central bank", the one clearly wrong match. First thing to re-check
  on the next capture.
- `ev`'s bare `evs?`, which fired on "Just Won An EV Backer" — a memory-chip
  story where EV describes the investor. It got the right picture anyway,
  because `chips` sits higher and won, which is luck rather than design.
- `exchanges`' "wall street". All four hits are the metonym, but that is an
  artifact of a per-symbol feed; on the general feed this page actually shows,
  "Wall Street" usually is the market story.

**Two recall misses, also left alone.** "Marvell Rises 5% as Piper Sandler
Starts Coverage With $270 Target" and "BABA Investor Alert: … Securities Class
Action Notice" both return nothing: "starts coverage", "$270 Target" and "class
action" are not in the tables. Missing a picture costs nothing; widening those
phrases would cost precision on every product-launch headline that says
"target". Both are kept in the fixture as asserted negatives so the trade is
visible rather than forgotten.

### Still owed

A general-feed measurement, on the feed `/headlines` actually renders. The
sandbox cannot reach `financialmodelingprep.com` (all outbound returns `000`
through the proxy), so it needs either a relay capture of
`getGeneralMarketHeadlines()` committed as a fixture, or the numbers taken
owner-side. Until then the honest statement of coverage on this page is "between
7% and 58%, and nobody has measured where".

---

## 7. Acceptance — what is and is not verified

Verified here: `tsc --noEmit` clean; `eslint` unchanged at 215 pre-existing
problems, none in the files this change touches; `node scripts/check-news-art.mjs`
passes in full, including the eight sections that existed before; eight
mutations fail the checks they should fail.

**Not verified here, and cannot be:** anything rendered. The sandbox cannot
reach `*.vercel.app` or `www.mystockharbor.com` (`403 CONNECT tunnel failed`),
and `next build` cannot complete without Upstash credentials — both recorded in
CLAUDE.md. Confirming the deployed page, and that `/stock/*/news`,
`/sector/*/news` and the dashboard strip are unchanged, is an owner-side step.
It is a cheap one in this case: with the manifest empty, every card on every one
of those surfaces is planned by code paths this change does not touch.

---

## 8. Open, not in this change

- **The images themselves**, per §4.1. Until they land this is machinery with
  nothing to select from, and the check says so in a NOTE on every run.
- **A general-feed measurement**, per §6.
- **The provider-map** (FMP labels + SIC → concepts) and switching the three
  symbol-led surfaces to tag scoring. That is where the 268 subject images pay
  off properly, and it needs the FMP-exit work to settle first.
- **Two motif redos** (`any-deal-03`, `any-macro-04`); the manifest already
  reflects their absence.
- **Wave 2** (a second palette and scene per subject) and **Wave 4** (subject +
  motif combinations for the busiest subjects) are not started.
- **Eight motifs with art and no patterns**, per §4.3. Add one only with a
  phrase that carries a single meaning in a financial headline.
