# Tiingo — what we are licensed for, and what it constrains (2026-09-23)

Reference doc for the FMP → Tiingo migration. Written from three sources, kept
separate throughout because they carry different weight:

- **[CONTRACT]** — the executed Service and License Agreement + Schedule A.
  Binding. If something is not here, it is not a term.
- **[DOCS]** — Tiingo's published API documentation and product pages.
  Reliable but can change without notice.
- **[SALES]** — Blair W.'s emails during the enquiry. Useful, **not binding**,
  and two figures in them contradicted each other across emails. Treat as a
  lead to verify, never as a spec to build against.

**Status: contract reviewed, being signed 2026-09-23. Nothing measured on a
live token yet.** Every number below is on paper. See "Verify before building"
at the end.

---

## 1. Commercial shape

| | |
|---|---|
| Counterparty | Tiingo, Inc., a New York corporation |
| Licensee | Sonny Brindle, an Individual (sole trader) |
| Fee | **$150/month** [CONTRACT, Schedule A] |
| Stated standard rate | $500/month; discount holds while <5 full-time employees |
| Initial term | **1 month** from Effective Date |
| Renewal | Automatic, 1-month increments |
| Notice to cancel | 30 days, email sufficient |
| Fees | Non-refundable; exclusive of VAT and other taxes |
| Fee increases | Only to pass through Upstream Data Source licence increases, capped at that amount |
| Liability cap | 12 months of fees (~$1,800), **both parties, indemnity included** |
| Governing law | New York; exclusive jurisdiction NY state/federal courts |

The one-month term is the important one architecturally: exposure at any moment
is $150, and a migration that goes wrong is a rollback, not a year's commitment.

---

## 2. What we are licensed to receive

**[CONTRACT] Section 2 + Schedule A — three services:**

1. **End-of-Day Stock Price API** — the one we actually need
2. IEX Live and Historical Intraday Endpoint
3. Consolidated Derived Intraday Endpoint

Both real-time feeds are **included at the same $150**. We are not using them
today. They are licensed if and when the caching story can carry them — see
§7.

**[CONTRACT] End-of-Day Price Data explicitly includes:**
- Corporate Actions Data (dividends, splits)
- **Security Master data**
- Price data for Stocks, ETFs, and Mutual Fund NAVs

**[DOCS] Coverage:** history to ~1962 for active US equities/ETFs; delisted and
inactive price history from ~2014; ~70,000 securities. Fields include OHLCV,
`divCash`, `splitFactor`, both adjusted and unadjusted. Adjustments follow CRSP
guidelines.

---

## 3. Endpoints and limits

### Rate limits [CONTRACT, Schedule A §4]

```
300,000 queries per day
 20,000 requests per hour
      1 TB bandwidth
```

Note: Schedule A says **"1 TB of bandwidth"** with no qualifier. Both sales
emails described it as "WebSocket bandwidth". **The contract wording governs** —
treat 1 TB as the total allowance covering REST.

Tiingo's public EOD product page advertises 80,000/hour and 1.2M/day for the
redistribution tier. We are not on those numbers. [SALES] called the published
figures "enterprise burst ceilings", which does not match what the page says,
but it does not matter: Schedule A is the contract and Schedule A says 20,000.

[SALES] also quoted 30,000/hour in an earlier email before saying 20,000 in a
later one. **20,000 is the contractual figure.**

Over the cap returns HTTP 429 and throttles until the window resets. No overage
billing anywhere in the contract.

### Headroom against our actual usage

| Job | Requests | % of daily cap |
|---|---|---|
| 5-year seed, 700 symbols | 700 (one per symbol, full history per call) | 0.23% |
| Nightly steady state via bulk endpoint | 1 | ~0% |
| Nightly steady state per-symbol (if bulk unavailable) | 700 | 0.23% |

Bandwidth: a full seed is somewhere in the 200 MB–1 GB range as JSON, well
under half that as CSV. Against 1 TB this is not a constraint we can reach.

**This is the structural difference from FMP.** The FMP bandwidth emergency
(2026-08-30, 97% of allowance) was caused by repeated per-symbol history pulls
being the normal operating mode. One call returning full history, plus one bulk
call nightly, removes the pattern that caused it.

### Endpoints

| Endpoint | Purpose | Source |
|---|---|---|
| `/tiingo/daily/<ticker>/prices` | Full history for one symbol in one call | [DOCS] |
| `/tiingo/daily/prices` | **Bulk — whole market's daily bars in one call** | [SALES] — unverified |
| `/tiingo/daily/<ticker>` | Metadata: `name`, `exchangeCode`, `permaTicker`, `startDate`, `endDate`, `description` | [DOCS] |
| `/tiingo/utilities/search` | Ticker search / autocomplete | [DOCS] |
| `supported_tickers.zip` | Full ticker list, updated daily, public URL | [DOCS] |

`format=csv` on any of these. [DOCS] state CSV parses 4–5× faster than JSON and
the payload is materially smaller — **use CSV everywhere**, not JSON.

The bulk endpoint is the single biggest win in this migration and is the one
thing here resting only on a sales claim. Verify first, design second.

---

## 4. Migration gotchas

### Symbology — dashes, not periods

[DOCS] Tiingo uses `-` where FMP uses `.`:

```
BRK.A   (FMP)  →  BRK-A     (Tiingo)
SPG-P-J        →  preferred series pattern
```

This lands directly on the dotted-names work finished 2026-09-14. Whatever
normalisation exists for FMP's format needs a Tiingo mapping. **Preferred
series are the failure case to watch** — they will 404 quietly rather than
erroring loudly, so they surface as missing rows in a picker rather than as a
caught exception.

### Update timing

[DOCS] EOD publishes **5:30pm EST**, with exchange corrections applied through
to **8:00pm EST**.

In UK time that is roughly 22:30 and 01:00. **The nightly warm job should run
after ~01:30 UK** to pick up corrections rather than the first pass. Running
earlier caches prices that get revised an hour later.

---

## 5. Not included — what still needs a source

| Data | Status | Plan |
|---|---|---|
| Fundamentals (P/E, market cap, ratios) | **$200/mo add-on**, third-party sourced | SEC pipeline |
| Sector / industry classification | Only via the Fundamentals add-on | SEC SIC codes, mapped to our buckets |
| Earnings calendar | **Not offered by Tiingo** | SEC pipeline |
| Analyst estimates / ratings / targets | **Not offered** | Not replacing |
| Company logos | **Not offered** | Harvested, self-hosted (PR #458) |
| News | Separate product, not licensed | Existing news adapter |

**The SEC pipeline is load-bearing.** It carries fundamentals, sector and
earnings — three things currently displayed. The $200/month it saves is real
and recurring. Priced fallback if it stalls: EODHD earnings calendar at
$100/month.

Company *names* do come with what we're buying — via the metadata endpoint and
Security Master, explicitly covered [CONTRACT].

---

## 6. Contract obligations that constrain the build

These are terms, not preferences. Breach is a termination event.

### Must add — attribution [CONTRACT §5.4.1]

> "Market Data from Tiingo.com"

Hyperlinked to Tiingo.com where technically feasible, on the **legal / about /
disclaimer page**. Ship this in the migration PR — it is easy to forget and it
is a breach if absent.

### Must add — End Customer terms [CONTRACT §5.1.2]

We are responsible for agreements with End Customers "at least as protective"
of §§5.1–5.4. For a public site with no login this means site Terms of Use
covering the use restrictions. If any export capability exists, the terms must
state exported data is for **personal research purposes only**.

### No bulk or machine-readable export [CONTRACT §5.3(ix)]

> No export or distribution "in bulk or machine-readable form, including CSV,
> Excel, JSON, API access, or other raw data exports."

§5.1.2 carves out limited export "pertaining to one or a few stock tickers".

**Open risk.** The site serves same-origin JSON from `/api/quote`,
`/api/pickers`, `/api/history`, `/api/symbols` — normal Next.js architecture,
but unauthenticated and directly reachable. Existing mitigations are the
defence and are strong: `/api/` disallowed in robots.txt, BotID across 16
routes, Deep Analysis on `/api/quote`, the quote-token gate, the honeypot trap,
per-IP rate limits.

**Question sent to Tiingo, answer not yet received.** Until it is, do not add
any new public JSON surface, and do not add a CSV/export feature.

### AI use is limited to authenticated products [CONTRACT §5.3(x)]

Tiingo data may be used as context for research, screening, alerts and
natural-language summaries **within authenticated Company Products and
Services**, via US/EEA LLM providers that neither train on nor retain the data.
Prohibited: training or fine-tuning any model on it.

**The site is unauthenticated.** Any AI-generated output drawing on Tiingo
price data — video automation, insight generation — needs reading against this
clause before it is wired up. Existing AI routes that work from news article
text rather than price data are not affected.

### Data fingerprinting [CONTRACT §5.4.2]

Tiingo fingerprints its data to track downstream distribution. Assume anything
served is traceable.

### Caching is permitted [CONTRACT §5.4]

Storing, caching and persisting Tiingo Data on our systems is explicitly
allowed **during the term**.

---

## 7. Termination — what survives

[CONTRACT §4.3(iii)] On termination, all raw Tiingo Data must be deleted and
destroyed, with **written certification** to Tiingo.

**The carve-out, verbatim:**

> "this obligation does not apply to derivative works created by Company that
> (a) are not a substitute for Tiingo Data and (b) cannot be reverse
> engineered into Tiingo Data."

Practical reading:

- **Deleted:** raw OHLCV bars, the history store, cached price payloads
- **Retained:** computed indicators, trend states, support/resistance levels,
  chart archives — provided they fail both tests above

**Architectural consequence: the history store is rented, the computed layer is
owned.** Anything we want to keep permanently has to exist as computed output,
not as bars. Worth weighing when deciding what the Redis/storage layer holds.

---

## 8. Verify before building

Nothing below is measured. Confirm on the live token before writing anything
that depends on it.

1. **Bulk endpoint** — does `/tiingo/daily/prices?format=csv` return the full
   market in one call on our token? Everything about the nightly job assumes
   yes, on a sales claim alone.
2. **Provisioned limits** — is the account actually configured at 300,000/day
   and 20,000/hour, or still on free-tier caps? A contract figure and an
   account setting are different things.
3. **Symbol coverage** — run our ~700 universe against Tiingo symbology and
   count misses. Preferred and multi-class names first.
4. **Metadata completeness** — does `/tiingo/daily/<ticker>` return usable
   `name` for the full universe, or are there gaps needing the Nasdaq symdir
   fallback (which we already hold and which is not FMP-sourced)?
5. **Search quality** — one report found ~20% of search results unusable for
   name→ticker matching. Our preview does the easier ticker-prefix case, but
   do not assume drop-in parity with the FMP search.
6. **VAT** — fees are exclusive of taxes and we are a UK individual buying from
   a US vendor. Confirm on the first invoice.

## 9. Sequencing

- **Do not cancel FMP until Tiingo is verified page by page.** Running both for
  a month is the cheapest insurance available, and the recorded failure mode on
  this codebase is presentation layers rendering plausible values when data is
  absent. A provider swap is exactly the event that produces widespread nulls.
- **Run the logo harvest (PR #458 Phase 2) before cancelling.** Once the FMP
  account lapses their CDN may lock, and 2,644 logos become monograms.
- **Drop the FMP CDN fallback at cancellation.** Fine while subscribed;
  hotlinking a third party's infrastructure with no relationship afterwards.
- **Access starts on first payment** [CONTRACT §2] — not on signature.
