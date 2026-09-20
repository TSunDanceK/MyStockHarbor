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

## 6. Fix, applied — (a) only

**SHIPPED.** The exclusive branch is gone; `rankNews` takes an explicit scope.
Verified against the real old code on the same fixture:

    BEFORE (HEAD):  1 item(s) -> seekingalpha.com
    AFTER:          4 item(s) -> ad-hoc-news.de, gurufocus.com, seekingalpha.com, zacks.com

Three of the three headlines the score panel names are recovered, and the legacy
item is **kept too** — the bug was exclusivity, not the old article's presence.

Three refinements the report asked for, each of which changed the design:

**The field stays INERT; it is not promoted either.** Promotion is the right
shape and is what makes it safe for any adapter to stamp the field — but
promoting on `fmpSymbolMatched` *today* would promote **staleness**. Nothing
live writes it, so every item carrying it predates the flip by construction, and
a sort key ordering on it orders *old before new* while looking like it orders
*relevant before irrelevant*. Same bug in a better hat.

`scripts/check-news-relevance-scope.mjs` asserts both halves, and the tripwire is
**two-sided on purpose**: it fails if the branch or a sort key returns, AND it
fails if a live adapter starts stamping the field — because that is the
condition under which promotion becomes safe again. The failure message says so
rather than reading as a regression.

**Nothing was lost by removing the branch.**
`isClearlyAboutRequestedCompany` returns true for a symbol-confirmed item on its
first line, so **confirmed ⊆ text-relevant, always**. The branch was never adding
members; it could only remove them.

**Scope is asked for, never fallen into.** `rankNews(news, scope)` has no
default. The no-symbol path is legitimate — `lib/sector-news-data.ts` has no
symbol to be about — so the defect was never that it exists, only that it was
reachable by forgetting two arguments. Market scope is now something a caller
names.

That is the same failure shape as two others today: the User-Agent env read that
could go blank, and the `fieldHits` ReferenceError that passed three gates.
**Silent defaults are how all three shipped.**

## 6a. ~~HELD~~ **LANDED 2026-09-20** — the score half

> **Superseded by the change itself.** `scoreNews` now takes a `NewsScope` and
> passes the caller's through, so `getStockNewsData` hands the *same*
> `newsScope` binding to `rankNews` and to `scoreNews` two lines apart. The
> section below is kept as the original filing; what it describes as pending is
> done.
>
> **The before/after, and the number that moved is not the score.** On the FAST
> fixture mixed with three real off-topic headlines (Apple, Coca-Cola, Bank of
> America, captured from relay run 199), both scopes come out **50** — so a
> score delta would have been the wrong assertion. What market scope inflated is
> the **evidence claim**: it reported `available: true`, *"Based on 5 of 5
> headlines from the last 14 days"*, **Medium** confidence, when only **2** of
> those headlines were about Fastenal. Under symbol scope the same pool returns
> `available: false` and **Low** — the honest answer. A tone read off other
> companies' news is the user-visible defect, not the integer beside it.
>
> `check-news-relevance-scope.mjs` asserts it by *running* both scopes over one
> pool, with a control that market scope on a clean pool still agrees with
> symbol scope — so the narrowing is removing irrelevant news, not relevant
> news. 3 / 3 mutations caught.

### The original filing


The acceptance criterion in the report — "the two numbers must not be able to
disagree" — was corrected by its own author and the narrower version is right:
the score panel is a **14-day** window and the feed a **45-day** one, so they
*should* differ. What must not differ is the **relevance set** they compute over.

The score still computes at market scope, so it scores over headlines the feed
correctly rejects. That is the same bug facing the other way. It is **not
bundled here**: correcting it moves a user-visible number on every one of 2,620
pages and deserves its own before/after rather than arriving inside an outage
fix. Filed as its own task; the explicit `MARKET_NEWS_SCOPE` argument is what
keeps it visible while it waits.

## 7. Original proposal, for the record

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

## 8. Not done

The funnel sample across ~200 random symbols, for the **rate**. Four of seven is
seven data points and is not a percentage. **Worth running after (a) lands**,
since the numbers have now changed and the pre-fix ones would only measure the
bug.
