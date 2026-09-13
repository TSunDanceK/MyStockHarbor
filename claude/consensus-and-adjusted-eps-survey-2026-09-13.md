# Analyst consensus and adjusted EPS — the survey (2026-09-13)

Researched after the SEC probe closed, to answer the one gap left on the earnings page.

**Headline: there is no free, cleanly-licensed consensus source, and the question is not
"free versus paid" — it is how small a quote. But the adjusted-EPS problem dissolves the
moment you buy, which changes the decision.**

---

## 1. Alpha Vantage is out, and the terms say so explicitly

Earlier notes recorded this as "suggestive, not permission". That was too generous. Their
Terms of Service define commercial use to include, verbatim:

> "You are using the Alpha Vantage Platform as or on behalf of a corporation, firm,
> partnership, trust or any other association and not as an individual."

> "You plan to use or provide information accessed through the Alpha Vantage Platform as
> part of any type of commercial activity that allows individuals or entities other than
> User to access information directly or indirectly"

That second clause is a description of MyStockHarbor. A public, ad-supported site letting
other people see the data is the thing being excluded. Commercial users are directed to
`premium@alphavantage.co` — i.e. a quote, not a tier.

**So the "25 requests a day fits with room" arithmetic is dead.** It was never a licensing
question of silence; the answer was written down. Do not build on the free tier.

---

## 2. Every other vendor has the same shape, and one of them is startling

| Vendor | Published ladder | Licence on it |
|---|---|---|
| **Alpha Vantage** | free · $49.99 → $249.99 | personal; commercial → contact |
| **Finnhub** | free · **All-In-One $3,500/mo** | **both marked "Personal Use. Terms apply"** |
| **Finnhub Enterprise** | *unpublished* | **"Commercial use. Redistribution right."** |
| **EODHD** | free · $19.99 · $29.99 · **Fundamentals $59.99** · All-In-One $99.99 | all five: *"For commercial use, choose Startups & Enterprise Data Solution Plan"* |
| **FMP** | the personal plan the site was on | $20,000/yr quoted for the commercial licence |

**Finnhub publishes a $3,500/month plan that is still personal use.** That is worth sitting
with. It is not a cheap tier and it still does not permit this site. Anyone reasoning "we
will just pay for a proper plan" without reading the licence line would buy the most
expensive wrong thing available.

Underneath all of them, consensus traces back to **I/B/E/S (LSEG) and Zacks** — institutional
products licensed per-seat and per-use. Nobody redistributes that for free, and the couple of
"open" datasets that used to exist are gone.

---

## 3. The structural insight: buying solves both halves at once

The page has two related problems, and they have always been treated separately:

1. no consensus estimates
2. the headline EPS is the **adjusted** figure, which SEC cannot supply

**They are one problem.** Every consensus vendor returns the actual and the estimate together,
on the same basis, because a surprise percentage is meaningless otherwise. EODHD's earnings
calendar returns:

```
code · report_date · date · before_after_market · currency
actual · estimate · difference · percent          back to the 1990s
```

That is the Latest Report card, the 8-quarter trend chart, the history table and the Next
Expected date, from one endpoint — **and `before_after_market` also settles the
before-open/after-close question for the Price Reaction card**, which is otherwise a
timezone-inference problem.

Finnhub's enterprise tier goes further: EPS Surprises 20+ years, EPS and Revenue Estimates
20+ years historical and 5 forward, Recommendation Trends, Price Targets, Upgrade/Downgrade.
**That set would also un-hide the five Pickers columns** — Forward PE, Rating, Analysts,
Price Target, PT Upside — which are behind the flag for exactly the same reason.

So the choice is cleaner than it looked:

- **Free:** GAAP-only. Internally consistent, no vendor, no licence, never breaks. The page
  says less.
- **Paid:** actual and estimate arrive together on one basis, the surprise columns work, the
  price-reaction timing comes free, and the Pickers Analysts tab comes back.
- **The bad outcome is mixing**, which is what the page does today — $0.45 adjusted at the
  top, $0.25 GAAP a thousand pixels below.

---

## 4. Adjusted EPS on its own is not worth chasing

Worth recording so it is not revisited: the company's own non-GAAP EPS lives in the earnings
press release, furnished as Exhibit 99.1 to an 8-K under Item 2.02. **It is not XBRL-tagged**
— only the financial statements in the 10-K/10-Q carry structured tags, and the 8-K facts
that do appear in `companyfacts` are `us-gaap` elements, i.e. GAAP figures.

So recovering adjusted EPS free means parsing free-text press releases, per company, per
quarter, with no schema. Fragile, endless, and **pointless if the estimate side is bought
anyway**, since the vendor supplies the matching actual.

---

## 5. What to do

**Send one written letter to three, and re-scope the fourth.** Same letter as the news survey.

1. **Finnhub Enterprise.** The only one whose own page says *"Commercial use. Redistribution
   right."* in plain words. Widest coverage; would fix Pickers as well. Price unpublished.
2. **EODHD Startups.** List price for the same data class is $59.99/month personal, so the
   commercial quote anchors from somewhere sane rather than from $20,000. They claim
   onboarding in three business days.
3. **Alpha Vantage commercial** via `premium@`, for completeness — their fundamentals are not
   exchange-regulated, so the quote may be modest.
4. **Re-quote FMP, and make the ask much smaller than last time.** `NEXT-SESSION-2026-09-12`
   already says the FMP conversation shrank once SEC covered fundamentals. It has shrunk
   again: SEC now demonstrably covers the statements *and* the segment splits. **What is
   actually still wanted from FMP is consensus and daily bars — nothing else.** The $20,000
   was quoted for a product that included everything now replaced.

The letter, unchanged in shape:

> MyStockHarbor.com is a publicly accessible, ad-supported stock-analysis website with
> roughly N page views/month. I intend to display quarterly reported and estimated EPS and
> revenue, surprise percentages, and forward full-year analyst consensus on public ticker
> pages, cached, for roughly M symbols. Does that fall within plan [P] at the listed price,
> or does it require a separate commercial or redistribution licence? Please confirm in
> writing, including the price.

*Not legal advice — confirm licensing with the vendor in writing.*

---

## 6. The recommendation stands, and nothing blocks on it

**Ship GAAP-only.** It is complete, free, defensible and available today, and every quote
above is a reply that may take a week or may never come. Wire the consensus provider behind
the same env switch as the news adapter, so the estimate columns light up the day a quote is
accepted — and stay dark, harmlessly, if none ever is.

The one thing that is genuinely urgent is unchanged: **the estimate/surprise history in Redis
is the only copy of the consensus series the site will ever have for free, and it dies with
the FMP key.** If a vendor is eventually bought, that history can be rebuilt. If not, it is
gone. Dump it.
