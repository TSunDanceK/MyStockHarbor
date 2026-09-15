# The five colliding anchors, measured — and the one that was real

*2026-09-15. Relay runs 77 and 78, 1,402 real Google News items across ten pools.*

## The question

`anchoredNameSignal` gives 66 short-named symbols a company-name match path they
did not have. Five of those needles looked like they would also fire on generic
finance copy:

```
DOW  \bDow\b   "Dow Jones Industrial Average closes higher as tech leads"
T    \bAT\b    "Stocks climb; Nasdaq AT RECORD HIGH"
NOV  \bNOV\b   "EARNINGS DUE NOV 15 FOR RETAIL"
BOX  \bBox\b   "Box office revenue hits a record for the summer"
RH   \bRH\b
```

The question asked was the right one and it was asked the right way: *for each of
the five, how many items in that symbol's current pool does the anchor admit, and
how many of those are actually about the company?*

## Method

Each pool was fetched with the query `gnewsProvider.buildQuery` builds —
`"<cleanName>" stock` — verified byte-identical by running the real
`normaliseCompanyName` over each name. The sandbox cannot reach news.google.com
(403 CONNECT), so the fetch ran on a relay runner.

Two corrections to the naive reading, both of which changed the answer:

**1. The raw admit rate is not the cost.** The anchored fallback is reached only
after `explicitTickerSignals` has already run. What it costs is the MARGINAL set
it adds on top of them. Measured by loading the real
`isClearlyAboutRequestedCompany` twice — once as shipped, once with
`if (!variants.length)` rewritten to `if (false)` — and diffing, with the guard
string asserted to occur exactly once and the anchor-off build asserted to reject
a pure index headline, so a substitution that silently matched nothing could not
produce "the anchor adds nothing" as an answer.

DOW's raw admit rate was 85/100, which reads as a broken symbol. 26 of those 85
matched `"dow stock"` / `"(dow)"` with the anchor switched off. Its real
contribution was **6 genuine Dow Inc. items against 57 index stories.**

**2. The probe did not strip the publisher suffix.** `gnewsProvider` calls
`stripPublisherSuffix` before an item is stored, and nine of FOX's apparent
collisions were the string `" - Fox Business"` on headlines about other
companies — items production never sees in that form. Counting them would have
invented a collision for every company that shares a name with a publisher.

## The result

Marginal admits, publisher suffix stripped:

| needle | adds | off-topic | precision | what the misses were |
|---|---|---|---|---|
| `\bDow\b` (Cap) | 63 | 57 | **10%** | Dow Jones, "the Dow", DJIA members, S&P Dow Jones Indices |
| `\bBox\b` (Cap) | 56 | 18 | 68% | Jack in the Box, box office, Tritax Big Box |
| `\bGap\b` (Cap) | 43 | 13 | 70% | "Shares Gap Down", "Value Gap", "The Gap Between" |
| `\bRTX\b` (CAPS) | 47 | 4 | 91% | Nvidia's GPU line |
| `\bFox\b` (Cap) | 61 | 5 | 92% | Fox Factory (FOXF), Michael J. Fox |
| `\bNOV\b` (CAPS) | 47 | 1 | 98% | Novatti Group, ASX:NOV |
| `\bAon\b` (Cap) | 35 | 0 | 100% | |
| `\bAT\b` (CAPS) | 37 | 0 | 100% | |
| `\bRH\b` (CAPS) | 52 | 0 | 100% | |
| `\bCSX\b` (CAPS) | 50 | 0 | 100% | |

## Three things this killed

**Three of the five alarms were false, and casing is why.** The month is written
`Nov`, the preposition is `at`, and the needles are case-sensitive, so `\bNOV\b`
and `\bAT\b` never see them. `\bRH\b` is clean too. The case-sensitivity was
already doing the work it was designed for.

**"A capitalised-word needle is the dirty shape" is false.** Round 1 saw only
Dow and Box among the capitalised names and both were dirty, which is a
two-point line through a hypothesis. Round 2 measured the whole set of six:
**Aon is 100% and Fox is 92%** — better than RTX, an all-caps acronym. A rule
keyed on the needle's case would have deleted 195 measured-good items to remove
57 bad ones.

**Three grammatical rules were scored and rejected**, on the same 491 marginal
items, so the next reader need not re-derive them:

| rule | kept | precision | genuine articles lost |
|---|---|---|---|
| a company-reference position (`N's`, `N Inc`, `N (`, `N stock`) | 220 | 96% | 182 |
| the token is not part of a longer phrase | 199 | 95% | 203 |
| either of those two | 337 | 95% | 74 |
| **the token is a market-index name** | **428** | **90%** | **6** |

The company-reference rule also takes AT&T to **zero**: `\bAT\b` only ever
matches inside `"AT&T"`, never before `" stock"`. The three grammatical rules buy
five points of precision for between 74 and 203 genuine articles. The index rule
removes 57 of the 98 off-topic items for 6.

## The fix

`INDEX_TOKENS` in `lib/stock-news-data.ts`: `anchoredNameSignal` returns `null`
when the name's first token is a market-index name.

DOW is not on a continuum with the rest — 10% against a floor of 68% — and the
reason is specific rather than orthographic. "Dow" is the everyday name of a
market **index**, so it appears in market-wide copy that is about no company at
all. That is the property, and it is a property of the token: if a company named
"Nasdaq" ever reached this fallback the same line would catch it. (NDAQ does not
— "Nasdaq" is six characters, so `companyNameVariants` gives it a substring
needle and `anchoredNameSignal` never runs.)

**Why this is not the kind of list this repo refuses.** The objection recorded in
`scripts/lib/symbol-spellings.mjs` is to a SNAPSHOT — a September 2026 table of
companies that returns a wrong answer silently forever as the market changes.
Index names are a closed, stable vocabulary: they do not list, delist, rename or
get acquired.

**DOW is not blanked.** The explicit ticker signals already matched 26 of its 89
items without the anchor, and they are the ones a reader wants. The cost is the 6
items with no ticker in them, and the checker records that cost as a fixture
expecting `false` rather than deleting the row.

## What ships as measured, and is not being fixed

Box at 68% and Gap at 70%. They are a real residual and it is now a number rather
than a hunch. They are not on DOW's side of the gap, the dedup and ranking and
churn filter still apply downstream, and the alternative on the table costs more
genuine coverage than it saves. Worth revisiting if a cheaper discriminator turns
up; not worth 74 real articles today.

## A count that moved: 55 → 66

The fallback-only population was reported as 55 and is 66. The difference is the
normaliser, not the population: 55 counted the RAW directory names in
`data/company-names.json` (`"Dow Inc. Common Stock"`), 66 counts them after
`cleanName` strips the instrument suffix — which is the form the live path hands
to the matcher. **66 is the number that describes production.**
