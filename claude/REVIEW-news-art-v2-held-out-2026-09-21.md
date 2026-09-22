# REVIEW — news art v2: the held-out general-feed measurement, and six defects

Written from Cowork, which has Chrome and the live site. Mirrored into the repo
on 2026-09-21 because the branch cites it and `project_write` does not commit to
git — the same loss `claude/HANDOFF-news-production-verification-2026-09-20.md`
§process records. Cite this path, not the knowledge-base one.

---

## 1. What the branch got right

- **Manifest-first shipping.** An empty `manifest-v2.json` is a working state:
  `TAGGED_COUNT` 0, every `pickTagged` null, `/headlines` byte-for-byte as
  before. A count raised ahead of its files is the one failure only a visitor
  sees.
- **`planHeadlineArt` as a callable rule**, after the source-position assertion
  passed against `if (false && tagged)`. Third time this tree has recorded that
  lesson and the first time the fix was to move the rule rather than sharpen the
  grep.
- **`ANY` filtered on both axes**, so the 268 subject images cannot all tie at 2.
- **`banks` narrowed on evidence** — three hits, three wrong, every one a bank
  inside someone else's story — and `ev` left alone on a single ambiguous hit.

## 2. The held-out measurement

The per-symbol sample (192 headlines, 2026-09-13) is not the population
`/headlines` serves. This one is: **42 headlines read off the live grid on
2026-09-21**, after the feed had rotated past the 50 the table was fitted on.

Committed as `scripts/fixtures/article-topic-general-2026-09-21.jsonl` so it is
reproducible rather than remembered.

| | count | share |
|---|---|---|
| subject art | 14 | **33%** |
| motif art only | 6 | 14% |
| nothing | 22 | 52% |

Three numbers, each meaningless without its sample:

| sample | feed | subject rate |
|---|---|---|
| 50 headlines, **fitted** | general | 58% |
| 42 headlines, held out | general | **33%** |
| 192 headlines, held out | per-symbol | 6.8% |

Caveats, both mine: the captured excerpts are truncated at ~100 characters, so
the description leg fires less here than in production (33% is a floor); and the
sample is the same news cycle as the fitted 50, so its topic mix is correlated —
five Trump-Xi stories, four bond stories.

Precision, all 19 matches read by eye at the time: **17 fair, 2 weak, 0 wrong.**
The two weak ones are recorded as `imprecise` rows in the fixture.

## 3. Six defects, all reproduced against shipped code

Four came out of the held-out run. Two more are in the fixes for them.

| # | defect | evidence |
|---|---|---|
| 1 | `pipelines` shadowed by the commodity patterns | "Saudi East-West pipeline shutdown … crude importers" → `oil-gas-upstream` |
| 2 | `\bpharma\b` cannot match "Pharmaceuticals" | "ADARx Pharmaceuticals … in US IPO" → no subject |
| 3 | bond/yield stories reach nothing | 4 of 42; `treasury yields` matched, `bond yields` did not |
| 4 | trade-talks stories reach nothing | 5 of 42; `trade war` matched, `trade talks` did not |
| 5 | **`pipelines` now takes the metaphor** | see below |
| 6 | **`banks` matches "Banksy"** | see below |

1–4 are fixed on this branch. 5 and 6 are open.

### 5. Every metaphorical pipeline now scores an oil pipeline

Moving `pipelines` above the commodity patterns fixed the shadowing and put it
above `pharma` as well, so `drug` no longer wins the headlines where both
appear. Against the shipped pattern:

```
Novo Nordisk's obesity drug pipeline deepens …      -> pipelines
Pfizer highlights its oncology pipeline …           -> pipelines
Salesforce says its sales pipeline is strongest …   -> pipelines
Biotech M&A pipeline builds as rates fall           -> pipelines
```

"Pipeline" is ordinary business English for a queue of work, and in drug
coverage it is the standard word. An oil pipeline on a Novo story asserts
something the article does not say — the failure `banks` was narrowed for.

Phrase-anchoring keeps the two real ones and drops all four:

```ts
["pipelines", /\b(?:oil|gas|crude|natural gas|lng|fuel|energy|midstream)\s+pipelines?\b|\bpipelines?\s+(?:operator|network|shutdown|outage|capacity|rupture|system)\b/i],
```

Checked against both fixture rows the patch was written for — "Natural gas
pipeline operator lifts its expansion budget" and "Saudi East-West pipeline
shutdown" — and both still match.

### 6. `banks` has no trailing word boundary

```ts
["banks", /\b(banks|lenders|banking (sector|industry|stocks)|regional bank\b)/i],
```

The group closes without `\b`, so `banks` matches inside a longer word:
"Banksy artwork sells for record sum at auction" → `banks`. Closing the group
with `\b` fixes it. The narrowing itself holds — "Bank of America resets Apple
stock price target" still reaches nothing.

## 4. Two notes on the manifest, from the generator side

- **Motif entries carry `related` tags that mix motif names and subject names**
  (`any-macro-*` has `["guidance","utilities-grid"]`). Motif names are inert
  against a subject set; the subject ones are live, so an article tagged
  `utilities-grid` gives `any-macro-01` a +1 it has not earned. Harmless at
  today's weights, cheap to make honest.
- **`any-deal` and `any-macro` hold 3 images**, and `any-deal` is 01/02/04 —
  non-contiguous. Nothing derives a filename from an index, so it costs nothing;
  it is recorded because any future naming that does would 404.

## 5. Still owed

Rendering. Nothing on this branch has been seen by a browser: the sandbox gets
`403 CONNECT` to both `*.vercel.app` and the live domain. Once there is a
preview, the checks are: `/headlines` shows art on **some** cards and not all —
art on every card would mean something is guessing — and `/stock/*/news`,
`/sector/*/news` and the dashboard strip are unchanged, confirmed by loading
them rather than by reasoning about the diff.
