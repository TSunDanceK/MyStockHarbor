# The feed and the scorer diverge at one line, and the trigger is a fossil

2026-09-14. Findings for the report in `news-feed-drops-what-the-scorer-sees`
(Cowork-side; not mirrored here). **Read, not measured** — both paths are in one
render and the divergence is visible in the source. No fix applied yet.

---

## 1. The divergence, exactly

Two call sites, same render, same input array `news`:

```
lib/stock-news-data.ts:2217   const rankedNews = rankNews(news, upper, companyName);
lib/stock-news-data.ts:2220   const keywordNewsScore = scoreNews(news);
```

and inside `scoreNews`:

```
lib/stock-news-data.ts:1249   const ranked = rankNews(news);
```

**`scoreNews` calls `rankNews` with no symbol and no company name.** Follow that
through `rankNews` (line 1156):

```ts
const symbolConfirmedNews = symbol ? news.filter(…) : [];          // symbol = ""  -> []
const textRelevantNews = symbol && companyName ? news.filter(…) : news;  // guard false -> news
const relevantNews = symbolConfirmedNews.length ? symbolConfirmedNews
  : textRelevantNews.length ? textRelevantNews : news;
```

With both arguments defaulted, every branch collapses to `news`. **The score
computes over the entire stored set; the feed computes over a filtered subset of
it.** That is the whole answer to "a 14-day window found 14 headlines and a
45-day window rendered 2": the two windows are not applied to the same data.

## 2. What filters the feed — and it is NOT the text filter

`relevantNews` is a three-way preference, and the first branch is **exclusive**:
if *any* item is symbol-confirmed, the feed uses **only** those and discards
everything else.

`articleMatchesRequestedSymbol` (line 411) reads exactly two fields:

```ts
if (item.fmpSymbolMatched) return true;
return (item.fmpSymbols ?? []).…some((value) => value === target);
```

**Only `fmpProvider.ts` ever writes those fields.** Both free adapters refuse
them on purpose, in comments that say why:

- `gnewsProvider.ts:140` — "NOT written to fmpSymbols/fmpSymbolMatched: those
  drive articleMatchesRequestedSymbol, and marking every item symbol-confirmed
  would switch off the text-relevance filter"
- `secProvider.ts:232` — stamping it "would mean a single Form 4 discards the
  entire Google News feed for that symbol — the strongest evidence producing the
  worst page"

So under `NEWS_PROVIDER=free` **no newly fetched item can ever be
symbol-confirmed.** The only items that can are **FMP-era records still sitting
in the persistent store**.

### The consequence

The exclusive branch now selects, for any symbol whose store retains even one
pre-flip FMP record, **exactly the pre-flip records — and throws away the entire
free-stack feed.**

Both adapters foresaw this failure and declined to cause it. Neither could
prevent an item already written under the old provider from causing it.

## 3. Verified by running the real predicates

`getCleanCompanyName`, `articleMatchesRequestedSymbol` and
`isClearlyAboutRequestedCompany` extracted verbatim from
`lib/stock-news-data.ts` and executed against a mixed list: the three headlines
the score panel names, plus one legacy FMP-stamped item.

```
cleanCompanyName -> "fastenal"
fresh gnews items that PASS the text filter: 3 of 3
items that are symbol-CONFIRMED: 1  -> seekingalpha.com  (fmpSymbolMatched)

rankNews would keep: 1 item
    seekingalpha.com | Fastenal: A Dividend Stalwart
```

**All three named headlines pass the relevance filter.** They are discarded by
the exclusive branch, not by relevance. The text filter is exonerated — and so
is the company name, which cleans to `"fastenal"` and matches all three.

## 4. It explains every number in the report

| observation | explanation |
|---|---|
| bimodal drop at `pool` (7-9% vs 36-64%) | store holds ≥1 FMP record → only those survive; no FMP record → falls through to text relevance |
| FAST cards dated 13 Aug and 5 Aug | FMP-era items are *by definition* older than the flip |
| FAST 86 gnews → pool 8 | 8 legacy records; the 86 fresh items are discarded wholesale |
| FAST `afterFilters=3`, `within45d=2` | 8 legacy → 3 survive `isLowValueNewsItem` → 2 inside 45 days: the two rendered cards |
| AOS `pool 4`, `within45d 0` | 4 legacy records, all older than 45 days → an empty page while 61 fresh items were discarded |
| score says "8 of 14 headlines, last 14 days" | the score never applied the filter, so it sees the fresh items |

It also **supersedes the AOS explanation** in
`claude/cik-map-relay-run-47-2026-09-14.md` §4a. That section blamed relevance
ranking on the name "A.O. Smith". The mechanism is the same exclusive branch,
and the name is not implicated — consistent with SJM (punctuated) beating FAST
(clean), which refuted the name theory from the other side.

## 5. The shape of the bug, as a rule

Sitting beside the two learned earlier today:

> A token you **DROP** is a distinction you can no longer make.
> A token you **FOLD** becomes a token that matches EVERYTHING.
> **A preference expressed as a FILTER deletes everything that cannot express
> the preference.**

`fmpSymbolMatched` is evidence *for* an item. Used as a selector it became
evidence *against* every item that has no opinion — which, after the provider
flip, is all of them. The field did not change meaning; the population did.

**This is a migration hazard, not a scoring one.** Any absolute preference on a
provider-specific field survives the provider that populates it, and then reads
the absence of that field as a negative.

## 6. Fix, proposed — by shape, and not applied

Keyed on a computed property, never on a ticker; no hand-maintained list; no
widening of the window and no loosening of the filter.

**(a) A confirmation should PROMOTE, never EXCLUDE.** Make the symbol-confirmed
set a sort key rather than a filter — the union of confirmed and text-relevant,
confirmed first. This removes the whole class: it is then safe for *any* adapter
to stamp the field, which is the thing `secProvider` currently has to refuse.

**(b) One relevant set, computed once, used by both consumers.** The acceptance
criterion — the two numbers on the page must not be able to disagree — is only
structurally guaranteed if the feed and the score read the same array. Today
`scoreNews` re-derives it, and the defaulted arguments are what let the two
drift apart silently.

Note (b) changes the score as well as the feed: the score currently includes
off-topic items because no filter is applied to it. That is the same bug facing
the other way, and worth stating plainly rather than fixing only the half that
was reported.

`lib/sector-news-data.ts:390` also calls `scoreNews`, with no per-symbol
relevance to apply — so whatever shape (b) takes must keep working when there is
no symbol, which is the case `rankNews`'s defaults were written for.

## 7. Not done

The funnel sample across ~200 random symbols, for the **rate**. Four of seven is
seven data points and is not a percentage.
