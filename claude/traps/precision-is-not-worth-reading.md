# Precision is not worth-reading

**Date:** 2026-09-13. Found on the step-7 preview, by the owner, on `/stock/MU/news`.

## What happened

13 of 15 cards on a live preview page were institutional-holding notices:

> Chokshi & Queen Wealth Advisors Inc Takes Position in Micron Technology, Inc. $MU
> OceanIQ Capital LLC Buys New Stake in Micron Technology, Inc. $MU
> NBH Bank Invests $668,000 in Micron Technology, Inc. $MU
> Micron Technology, Inc. $MU Position Decreased by Riverview Capital Advisers LLC

One article per institutional filer per stock, generated from 13F filings,
hundreds per company per quarter. Several republished with their own template
broken: the body read "during the undefined quarter".

The news score above them read **"59/100, slightly bullish, based on 8 of 37
headlines"** — a market opinion computed largely over 13F paperwork.

## Why nothing caught it

Every probe in the adapter migration measured **precision**: of the items this
query returns for MU, how many are actually about MU? The answer was **96-100%
across three runs**, and that number was correct.

These items score 100% on it. They *are* about MU. The filer really did buy
Micron stock, the headline really does name the company, the link really does
go to an article about it.

**Nothing ever measured whether an item was worth reading.** There was no
metric that could have gone down when the feed filled with churn, so no probe
could have caught it, and the one that did catch it was a person opening the
page.

## The general shape

A relevance metric answers "is this item about the subject". It cannot answer
"would a reader want this". The two come apart hardest exactly where volume is
machine-generated: filings, earnings-calendar stubs, price-quote pages,
"competitors 2026" SEO pages. All of those are perfectly on-topic.

The measured version, from the follow-up capture
(`scripts/fixtures/churn-sample.tsv`, four full Google News feeds):

| symbol | items | classified as holding churn |
|---|---|---|
| MU | 100 | 0 |
| BRK-B | 100 | 0 |
| CYRX | 53 | 4 (7%) |
| JPM | 100 | **48 (48%)** |

Nearly half of one of the most heavily covered stocks on the site. A precision
probe run against JPM that day would still have returned ~100%.

## What to do about it

1. **When adding a source, measure a composition statistic as well as a
   relevance one.** "What share of this feed is from one publisher" and "what
   share matches a machine-generated headline shape" are both cheap, and either
   would have shown this before it shipped.
2. **A denylist of publishers is not the fix, and this is the evidence.**
   `lowValueSources` in `lib/stock-news-data.ts` *already named this class of
   publisher* and did not fire, because a denylist matches a spelling and the
   free stack labels the publisher differently from FMP. The rule that replaced
   it reads the headline's shape and never the publisher —
   `lib/server/news/filingChurn.ts`.
3. **Cap, do not exclude.** The grammar has one irreducible false positive
   ("Warren Buffett's Berkshire Hathaway Inc. discloses new stake in Alphabet"
   is structurally identical to the churn and is real news). A cap keeps a
   couple, so a false positive costs a slot instead of a story — and a thin
   name whose only coverage is holding notices does not go empty.

## Related

- `claude/traps/a-visible-failure-is-not-a-harmless-one.md` — the same family: the
  page rendered perfectly the whole time.
- `claude/news-adapter-spec-2026-09-13.md` §1, whose precision figures are the
  ones that were true and insufficient.
