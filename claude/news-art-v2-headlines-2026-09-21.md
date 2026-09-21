# News art v2: the tagged library on `/headlines` (2026-09-21)

The brief this implements was written outside the repo, so this file carries its
substance rather than a link to it. It also carries what the implementation
found, which is not the same as what the brief expected — §6 in particular.

**Status: complete. The machinery and all 330 images are in.**
`manifest-v2.json` holds 330 tagged entries, every one of them backed by its two
files, and the check's manifest and tag assertions execute for real rather than
skipping. `/headlines` now has the whole library reachable from a headline's own
words.

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

**Landed on `main` on 2026-09-21**, after the code. The manifest is FLAT —
`Object.keys()` gives image names, with no `version`/`images` wrapper — which is
the shape `artTags.ts` reads.

**`any-deal` and `any-macro` hold THREE images, not four.** `any-deal-03` and
`any-macro-04` are being regenerated. Their names are not contiguous either:
`any-deal` is 01, 02, 04. Nothing assumes four and nothing derives a filename
from an index, so neither costs anything — but it is the concrete reason the
manifest is the source of truth for what exists.

**One incident worth keeping.** The tagged entries were briefly written over
`manifest.json` itself. The build failed at `art.ts:27` — the exact failure the
two-manifests rule above predicts — and nothing reached production. `manifest.json`
was restored byte-for-byte. A shape check would not have been the thing that
saved it; a separate file was.

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

`public/news-art/manifest-v2.json` with its 330 entries, beside the untouched
`manifest.json`, and the 660 image files alongside the v1 library. The order for
adding more, which the first landing did not follow and got away with:

1. Both sizes of every image into `public/news-art/`.
2. Then the names into `manifest-v2.json` with their tags.
3. `node scripts/check-news-art.mjs` — it fails if any name lacks its two files,
   if any file is unreachable from the manifest, or if any pattern in the
   classifier names a tag no image carries.

In that order. A manifest entry with no file behind it is a broken image on a
live page, which is the one failure nothing else catches: the page renders
regardless and only a visitor sees it.

`manifest.json` is **not touched**. `lib/server/news/art.ts` imports it as
`Record<string, number>` bucket counts; a v2 shape at that path would break the
three working surfaces at build time or, worse, silently. Two manifests, two
consumers, no shared type — asserted in §5.

Repo weight: +~24 MB, largest single file ~200 KB, within
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
tests it by calling it. The same mutation now fails three assertions.

**A second assertion was not good enough either, and it cost three defects.**
"Every tag exists in the manifest" proves a tag has a PICTURE; it cannot prove
the tag ever FIRES. Three patterns that never fired shipped in the first cut,
each looking perfectly alive in the source — see §6. So every tag in the table
must now be proven to fire by a fixture row that produces it, which is a
requirement on the fixture as much as on the table: a tag added without a row
fails immediately.

Eleven mutations have been run against these checks and all eleven fail:
score-0 returning an image, the names left unsorted, motif outscoring subject,
a manifest name with no file, a file with no manifest name, the tagged branch
constant-false, the fall-through deleted, the description weighted as heavily as
the title, and each of §6's three dead-pattern shapes put back.

One of those eleven initially passed and the probe was wrong, not the check: the
`pharma` row said "wins approval for its new vaccine", so it matched on
`vaccines?` and proved nothing about the spelling under test. A probe for a
pattern has to be a string only that pattern can match.

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

### A second held-out sample, on the general feed

A review run against **42 live `/headlines` headlines the table was never
written against** was reported to me as scoring **31% subject / 14% motif-only /
55% nothing**, with all 19 matches read by eye: 17 fair, 2 weak, 0 wrong.

**Those numbers are recorded second-hand and cannot be reproduced from this
repo.** The review they come from,
`claude/REVIEW-news-art-v2-held-out-2026-09-21.md`, is not on `main` and not in
this branch — I looked. Neither is the 42-headline sample. Anyone quoting the
31% should find that doc first; if it stays unmirrored, the number has the same
standing as a figure from a chat, which is the gap `check-doc-citations` exists
to shrink.

What that run **did** produce, and what is verified here, is five defects. Each
was reproduced against the shipped code before being patched, and each now has a
fixture row pinning it:

| defect | evidence | patch |
|---|---|---|
| `pipelines` shadowed | "Natural gas pipeline operator lifts its expansion budget" scored `oil-gas-upstream`; "Crude pipeline outage lifts diesel prices" scored `refining` | moved above both commodity patterns — one word with one meaning beats two words that appear in many stories |
| `pharma` cannot match "Pharmaceuticals" | "Shares of Acme Pharmaceuticals slide" → nothing | `pharma(?:ceuticals?)?`, with `biopharma` still spelled out (no word boundary in front of its own `pharma`) |
| bond/yield stories reach nothing | "Bond yields jump after the auction" → nothing, while "Treasury yields climb" matched | `(treasury\|bond) yields?` and `bond market`. A bare `yields?` is NOT added — "the strategy yields returns" is not a rates story |
| trade-talks stories reach nothing | "US and China open fresh trade talks" → nothing, while `trade war` matched | `trade (war\|truce\|talks\|negotiations)`, plus `g7\|g20`. A bare `summit` is deliberately absent: an AI summit and a developer summit are not macro |
| **`banks` never fired at all** | "Big banks rally as lenders report stronger margins" → nothing | the pattern line was **missing** — fourteen lines of comment explaining its narrowing, and no pattern. An editing accident in the first cut, found here |

The fifth is mine and was not in the review; it is the worst of the five,
because the comment above it describes a narrowing that the code did not
implement, so the file read as if the tag worked. Nothing caught it: it breaks
no build, no type, and no manifest assertion. That is what the new
proven-to-fire check in §5 exists for.

**The patches are mine, not the review's.** I could not read the review's, so
where it proposed something different the two should be compared before this is
called settled.

### The patches do not move the per-symbol number

Re-running the 2026-09-13 sample after all five: **still 6.8% / 15.1% /
78.1%**, byte-identical. None of the five patched patterns fires on a per-symbol
tech-and-consumer feed at all. That is not a disappointment, it is the argument
for the second sample: three dead patterns and two coverage gaps were completely
invisible on the sample I had, and only a different feed exposed them.

### Still owed

A general-feed measurement **reproducible from this repo**. The sandbox cannot
reach `financialmodelingprep.com` (all outbound returns `000` through the
proxy), so it needs a relay capture of `getGeneralMarketHeadlines()` committed
as a fixture, the way `eventtype-gnews.jsonl` was. Until then the honest
statement of coverage on this page is "7% on company copy, 31% on the general
feed per an unmirrored review, and one reproducible number short".

---

## 7. Acceptance — what is and is not verified

Verified here: `tsc --noEmit` clean; `eslint` unchanged at its pre-existing
problem count, none in the files this change touches; `node
scripts/check-news-art.mjs` passes in full with the REAL 330-entry manifest —
every name backed by two files, no file unreachable, all 25 subjects and 8
motifs both present in the manifest and proven to fire; `node
scripts/check-all.mjs` green; eleven mutations fail the checks they should.

**Not verified here, and cannot be:** anything rendered. The sandbox cannot
reach `*.vercel.app` or `www.mystockharbor.com` (`403 CONNECT tunnel failed`),
and `next build` cannot complete without Upstash credentials — both recorded in
CLAUDE.md. So the one thing left is an owner-side look at the deployed page:

1. `/headlines` shows art on the cards the classifier matches and nothing on the
   rest — not a picture on every card, which would mean something is guessing.
2. Spot-check five pictures against their headlines. The failure to look for is
   a picture that asserts something the article does not say; a merely generic
   one is fine.
3. `/stock/*/news`, `/sector/*/news` and the dashboard strip are unchanged.
   Confirm by loading one of each, not by reasoning about the diff.
4. No broken images. Every name is asserted against its files here, so a 404
   would mean a deploy or serving problem, not a manifest one — check the
   `news-art/` matcher exclusion survived if so.

---

## 8. Open, not in this change

- **A reproducible general-feed measurement**, per §6. The most valuable single
  thing left.
- **Mirroring `claude/REVIEW-news-art-v2-held-out-2026-09-21.md`** into the
  repo, and comparing its four patches against the five landed here.
- **Two motif redos** — `any-deal-03`, `any-macro-04`. `any-deal` and
  `any-macro` hold three images until then, and `any-deal`'s names are not
  contiguous (01, 02, 04). Nothing assumes four.
- **The provider-map** (FMP labels + SIC → concepts) and switching the three
  symbol-led surfaces to tag scoring. That is where the 268 subject images pay
  off properly, and it needs the FMP-exit work to settle first.
- **Wave 2** (a second palette and scene per subject) and **Wave 4** (subject +
  motif combinations for the busiest subjects) are not started.
- **Eight motifs with art and no patterns** — `cash`, `contract`, `filing`,
  `launch`, `leadership`, `partnership`, `split`, `supply`. Add one only with a
  phrase that carries a single meaning in a financial headline. Each will need a
  fixture row, which §5's proven-to-fire check now enforces.
- **42 of the 67 subjects have art and no pattern.** Same rule, same cost: a
  pattern is worth adding when a phrase for it is decisive, not because an image
  is sitting there.
