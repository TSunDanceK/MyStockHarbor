# A preference expressed as a filter deletes everything that cannot express it

A field that marks an item as *better* becomes, when used to SELECT, a mark
against every item that has no opinion. While every item can carry the field
that is invisible. After a migration, when nothing can, it empties the feed.

This is the third of three that landed in one day, and the most general:

> A token you **DROP** is a distinction you can no longer make.
> A token you **FOLD** becomes a token that matches everything.
> **A preference expressed as a FILTER deletes everything that cannot express
> the preference.**

## What happened

`/stock/FAST/news` rendered **two cards, both five weeks old**, above its own
score panel reading *"Based on 8 of 14 headlines from the last 14 days"*. A
14-day window cannot legitimately return more than a 45-day one over the same
data, so the two were not reading the same data.

`rankNews` picked its set like this:

```ts
const relevantNews = symbolConfirmedNews.length
  ? symbolConfirmedNews            // <- exclusive
  : textRelevantNews.length ? textRelevantNews : news;
```

`articleMatchesRequestedSymbol` reads `fmpSymbolMatched` and `fmpSymbols`, and
**only `fmpProvider.ts` ever writes them**. After `NEWS_PROVIDER` flipped to
`free`, no newly fetched item could carry them — but the store is persistent, so
**pre-flip records could**.

So the branch selected *exactly the FMP-era records still in the store* and
discarded the entire free-stack feed. FAST: 86 items fetched, 8 legacy records
kept, 2 rendered. The score panel, which called `rankNews(news)` with no symbol,
never applied the filter and saw all 86 — which is why the page could disagree
with itself in print.

## The field never changed meaning. The population did.

That is the whole mechanism, and it is why nobody would find it by reading
`articleMatchesRequestedSymbol`: the function is correct, the call is correct,
and the data underneath moved. **This is a migration hazard, not a scoring one.**

Both free adapters had already foreseen the shape and refused to cause it:

- `gnewsProvider.ts` — "NOT written to fmpSymbols/fmpSymbolMatched: those drive
  articleMatchesRequestedSymbol, and marking every item symbol-confirmed would
  switch off the text-relevance filter"
- `secProvider.ts` — stamping it "would mean a single Form 4 discards the entire
  Google News feed for that symbol — the strongest evidence producing the worst
  page"

Two authors saw the danger of *adding* the mark. Neither could prevent an item
written under the old provider from *already having* it.

## The rule

When a per-item field expresses a preference:

- **Promote, never exclude.** Make it a sort key over the union, not a selector.
  A confirmed item should lead the list, not empty it.
- **Ask who can write it.** If the answer is "one provider", the preference has
  a shelf life, and it expires the moment that provider stops writing.
- **A fossil must not order anything either.** Promotion is the right shape and
  is still wrong while the field is stale-by-construction: every item carrying
  it predates the flip, so a sort key ordering on it orders *old before new*
  while appearing to order *relevant before irrelevant*. Inert until a live
  writer exists.

## Why the fix removed members from nothing

`isClearlyAboutRequestedCompany` returns true for a symbol-confirmed item on its
first line, so **confirmed ⊆ text-relevant, always**. The exclusive branch was
never adding members; it could only remove them. Deleting it changes the set in
exactly one direction.

## Where else to look

Any absolute preference on a provider-specific field. The next provider swap
will do this again with a different field, and it will look just as correct at
every call site.

## See also

- `claude/news-feed-divergence-found-2026-09-14.md` — the read that found it
- `scripts/check-news-relevance-scope.mjs` — the two-sided tripwire: it fails if
  the branch returns, AND if a live adapter starts stamping the field, because
  that is the condition under which promotion becomes safe again
- `claude/traps/grep-finds-the-comment-not-the-code.md` — the sibling case where
  the comment is right and the code is not
