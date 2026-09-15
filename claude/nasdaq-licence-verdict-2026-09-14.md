# Nasdaq IPO calendar — residential fetch and licence verdict, 2026-09-14

Fills the two cells `claude/ipo-source-probe-RESULTS-2026-09-14.md` left open. Measured
from the owner's own Chrome on his residential UK connection, via the Claude in Chrome
extension. Both cells are now answered, and **the second one closes the question.**

---

## VERDICT: Nasdaq is PROHIBITED, not silent. Do not build on it, from any egress.

The endpoint works perfectly from a residential IP. It does not matter. The terms forbid
the use regardless of where the request comes from.

---

## 1. Reachability — P1a answered: WORKS

`https://api.nasdaq.com/api/ipo/calendar?date=2026-09` returned `rCode: 200` and a full
payload, immediately, from the owner's home connection. No challenge page, no hang. This
is a clean confirmation of the split the brief predicted: **blocked from Vercel, open from
residential.** The datacentre block is an IP-reputation measure, not a dead endpoint.

Under the licence finding below, this is now a curiosity rather than an architecture.

## 2. The schema, recorded so nobody has to fetch it again

Four buckets: `priced`, `upcoming.upcomingTable`, `filed`, `withdrawn`.

`upcoming` rows carry exactly the fields the page wants:

```json
{ "dealID": "1399245-119118", "proposedTickerSymbol": "OIG",
  "companyName": "Orion180 Insurance Group Inc.",
  "proposedExchange": "NASDAQ Global Select",
  "proposedSharePrice": "15.00-17.00", "sharesOffered": "20,000,000",
  "expectedPriceDate": "9/18/2026",
  "dollarValueOfSharesOffered": "$391,000,000" }
```

**`expectedPriceDate` is a real date, precise to the day.** That is the field no SEC filing
carries and the reason this source was worth probing at all.

Mapping to `ConfirmedIpo`, had it been usable: `proposedSharePrice` `"15.00-17.00"` would
have been handled by the existing `parsePriceRange()` string branch untouched, and the
comma/`$` forms by `num()`. Dates are `M/DD/YYYY` and would need ISO conversion.

Three things worth recording anyway:

- **No market cap field exists in any bucket.** That column loses its source under every
  free route, Nasdaq included. It gets hidden, per the standing convention.
- **Every row is NASDAQ.** `NASDAQ Capital`, `NASDAQ Global`, `NASDAQ Global Select`. No
  NYSE listings anywhere in the feed. Given the site is likely moving to a Nasdaq-only
  universe that might have been acceptable — but it is a real coverage difference from FMP
  and would have needed saying on the page.
- **Thin.** September's whole `upcoming` bucket is **3 rows**, `priced` is **2**. The
  Upcoming table would have rendered three lines. That is worth knowing before anyone
  assumes a free automated feed reproduces what FMP shows.

## 3. The licence — read today at `https://www.nasdaq.com/legal`

`nasdaq.com/terms-of-service` and `/terms-and-conditions` both 404. The live agreement is
at **`https://www.nasdaq.com/legal`**, reached from the site footer's "Legal" link. Read
2026-09-14. Four clauses, quoted:

**§2, Your Responsibilities.** Users must:

> "Not access or use the Service, or any process, whether automated or manual, to capture
> data or content from the Service or circumvent any mechanisms for preventing the
> unauthorized reproduction or distribution of the Service for any reason"

**§6, License.**

> "Nasdaq grants you a personal, limited, revocable, non-exclusive, non-assignable,
> non-sublicensable and non-transferable license to use the Services solely for your
> personal, non-commercial use. Except as expressly authorized by Nasdaq, you agree not to
> sell, copy, distribute, or create derivative works based on the Services, in whole or in
> part."

**§7, Restrictions.**

> "you shall not market, sell or distribute the Services or otherwise provide the Services
> to any third parties including, but not limited to, **placing or distributing any
> Nasdaq's content on a third party platform** … without Nasdaq's prior written consent.
>
> You shall not share, transfer, disclose, copy, publish or create derivative works from
> the content, incl. associated metadata (the "Content") or the Service without Nasdaq's
> prior written approval."

**§11, Ownership.**

> "You may not copy, reproduce, transmit, display, perform, distribute, rent, sublicense,
> alter, store for subsequent use, create any derivative works from, offer products or
> services based on, or otherwise use in whole or in part in any manner the Content without
> the prior written consent of Nasdaq."

### What that rules out, specifically

Every architecture the brief was weighing:

| Approach | Status |
|---|---|
| Fetch from a Vercel function | Blocked technically **and** barred by §2/§6/§7 |
| Fetch from the owner's PC, commit JSON, page reads the file | **Barred.** §2 covers "automated or manual" capture; §7 names "placing… Nasdaq's content on a third party platform" |
| Fetch by hand and retype into a file | Still §2 "manual" capture and §7 distribution of Content |

**This is the FMP situation with the numbers filed off.** §6 grants a *personal,
non-commercial* licence — the precise category the site was found to have outgrown when FMP
came back asking for $20,000. Adopting it on a commercial site would be repeating the exact
mistake this whole migration exists to undo, with terms that are considerably more explicit
than FMP's were.

**Verdict: PROHIBITED.** Not "silent, fine as a bridge". Write it in the table as
prohibited and take Nasdaq off the candidate list permanently, the same way Stooq was.

### One more flag on top

The payload's own footer reads:

```
"LAST UPDATED: 09/14/2026* - Source: EDGAR® Online"
```

So this is not Nasdaq's own data being shared loosely — it is **a licensed commercial
product (EDGAR Online, a DFIN service) that Nasdaq redisplays under contract.** Nasdaq is
not in a position to grant rights to it even if asked. That closes the "just email and ask"
route too.

---

## 4. What this leaves

The probe's findings now line up into one answer, and it is the honest one:

- The expected listing date is **not in any filing** (measured: S-1/A carries terms at a
  median 7 days' lead but no date; 424B4 carries a date at a median 2 days, 2/8 explicit).
- The one free source that **does** carry it **forbids using it**.
- Therefore **no free, licence-clean, fully automated forward IPO calendar exists.**

That is not a failure of the probe. It is the answer, and it was worth two runs and an
egress split to establish rather than assume.

**Where the curated date would have to come from, if option 1 is pursued:** not Nasdaq,
for the reasons above, and not any other vendor's compiled calendar for the same reason —
each is somebody's licensed compilation under its own terms. The only clean sources are
primary: the issuer's own pricing press release and the prospectus. Both land at
roughly 424B4 timing, so a curated date is likely to inherit the same ~2-day lead rather
than improve on it. That should be measured before option 1 is costed as if it delivers a
week's notice.

The surviving options are costed in
`claude/ipo-query-intent-measured-2026-09-14.md` against measured query intent.
