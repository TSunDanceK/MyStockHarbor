# Data pipeline rebuild — gate probe verdicts (2026-09-01)

Task 1 of the rebuild. Eight tasks depend on these answers; none should start
until the network ones are filled in.

## Status: PARTIAL. Two answered, seven pending an owner-side run.

**The probes are written and deployed-ready; they have not been RUN.** Claude's
sandbox cannot reach `financialmodelingprep.com` — `403 CONNECT tunnel failed`,
re-tested today, consistent with the note in `CLAUDE.md`. Every network answer
below therefore says PENDING rather than carrying a number.

That is deliberate. This task exists because three claims had to be withdrawn in
two days for being inferences from a sample rather than measurements; filling
these in from reasoning would be a fourth. **Q7 and Q8 are code and reasoning
questions and are answered in full below.**

### How to run it

```
GET /api/debug/fmp-endpoints?key=<EARNINGS_BACKFILL_KEY>
```

Read the new `gate` object at the top of the response — it carries a verdict and
a detail string per question. The per-probe rows underneath carry the raw
numbers each verdict was computed from.

Costs ~9 additional FMP calls on top of the existing ~12, all inside
`reserveFmpCallSlot`. `stock-list` is deliberately NOT re-probed: its size is
known (38,826 symbols, 3.04 MB) and it is 3 MB a go.

**Q10 must be run Mon–Fri 14:00–19:45 UTC or its answer is meaningless.** The
probe reports its own window validity; an out-of-window result must not be
written up.

---

## Q1 — Does the screener `limit` exceed 1000?

**PENDING.** Probe `Q1-screener-limit-3000` requests the live screener call with
`limit=3000`.

Read `rows`. Above 1000 means the cap is ours to raise. Exactly 1000 means FMP
paginates there, the coverage floor is set by FMP rather than by us, and
**banding (Q2) is the only route to wider coverage** — which makes Q2 blocking
rather than merely useful.

## Q2 — Is `marketCapLowerThan` supported?

**PENDING.** Probe `Q2-screener-band-1b-2b`.

**This one cannot be read from the status code**, and the verdict is computed
accordingly. A 200 that silently ignores the parameter returns the same top-1000
as the unbanded call — a FAIL that looks like a PASS. `Q2_marketCapLowerThanSupported`
passes only if **both** hold:

- every returned `marketCap` falls inside 1–2B (`marketCapMin`/`marketCapMax`), and
- the set differs from the unbanded `company-screener-1b` probe.

The comparison is why the verdict is computed after all probes rather than per
probe: the banded response alone cannot answer it.

## Q3 — What is the market cap of the LAST row?

**PENDING.** `lastRowMarketCap` and `lastRowSymbol` are now on every probe row.

This is the real coverage floor and nothing recorded it before — the existing
screener probe samples the first five rows and says nothing about the tail.

Context worth keeping attached to the number: `SCREENER_MIN_MARKET_CAP` is set to
$1B but is **inert**, because the $300M and $1B calls returned byte-identical
responses. `limit` truncates before the floor binds, so the floor that matters is
wherever the 1000th row lands. Expected around $5B.

## Q4 — Does ratios-ttm actually change only quarterly?

**PENDING, and this is the one to read first.** Probes `Q4-ratios-ttm-AAPL` and
`Q4-ratios-ttm-KO`.

The plan moves income-statement, cash-flow, ratios-ttm, dividends and
analyst-estimates off a clock and onto the earnings calendar, worth ~885 MB/month.
That is safe for the statements, which change on filing. **ratios-ttm is
trailing-twelve-month and partly price-derived**, so it may legitimately move
daily — and if it does, putting it on an earnings trigger means serving a stale
number between filings.

The probe reports `priceDerivedCount`, `priceDerivedPct`, `priceDerivedFields`
and `allFields` — every field with its value, because the classifier is a
name-pattern heuristic (`price|yield|marketcap|enterprisevalue|ev*|pe|peg|pb|ps`)
and must be overrulable by reading the actual numbers.

Two symbols, not one: a single response cannot separate "this field is
price-derived" from "this issuer happens to report it".

**If a meaningful share moves with price, ratios-ttm stays on a clock while the
other four move.** That is a partial kill of the 885 MB figure, and the point of
asking before building.

## Q5 — Does `isActivelyTrading` flip for delisted names?

**PENDING.** Probes `Q5-profile-FB`, `Q5-profile-WFM`, `Q5-profile-AAPL-control`.

The whole delisting mechanism rests on this boolean. FB became META; WFM was
taken private — two different delisting reasons that may behave differently.

**Absence is an equally usable signal** and the verdict records whichever it is:
if the dead tickers simply do not appear, that is the mechanism, and it is worth
recording as such rather than treated as a failed probe. The AAPL control exists
so "FB returns nothing" stays distinguishable from "the profile endpoint returns
nothing".

## Q6 — What is in the earnings calendar's 697 KB?

**PENDING.** Probe `Q6-earnings-calendar`, using the same today−3d → end-of-month+3
window `earningsCalendar.ts` fetches, so the numbers describe what production pays
for rather than an approximation of it.

Reports `totalRows`, `uniqueSymbols`, `oldestDate`, `newestDate`, and
`epsEstimatedRows`.

The question behind the size is coverage: **a symbol missing from this calendar
would never have its fundamentals refreshed again** under the event-driven model.
The estimate count is reported separately because a row with no estimate still
triggers a refresh but cannot be used to anticipate one.

## Q7 — What calls the earnings endpoint 656 times a day?

**ANSWERED. The hypothesis in the brief is close but not correct, and the
correction changes the forecast's shape.**

The brief guessed `/api/stock-earnings/[symbol]` on page render. That route
exists and is one caller, but it is one of **five**, and it is not the dominant
one.

### Every call site of `/stable/earnings`

| Site | Kind | Reached from |
|---|---|---|
| `lib/latest-earnings-data.ts:447` | shared lib | 4 pages + 1 API route (below) |
| `app/api/jobs/warm-earnings/route.ts:207` | cron | daily 07:15 |
| `app/api/debug/earnings/[symbol]/route.ts` | debug | by hand |
| `app/api/stock-earnings-debug/[symbol]/route.ts` | debug | by hand |

`getLatestEarningsData` in `lib/latest-earnings-data.ts` is the shared path, and
it is imported by:

- `app/stock/[symbol]/page.tsx`
- `app/stock/[symbol]/earnings/page.tsx`
- `app/stock/[symbol]/news/page.tsx`
- `app/dashboard/page.tsx`
- `app/api/stock-earnings/[symbol]/route.ts`

**A fifth call site exists and is a different endpoint.**
`app/stock/[symbol]/earnings/page.tsx:446` calls `/earnings` on **`api/v3`**, not
`stable` — so it does *not* land on the `/stable/earnings` meter line at all.
Worth knowing before anyone counts it twice.

### The shape of the load — and it is neither of the two options in the brief

All three `/stock/[symbol]/*` pages are **fully dynamic**: dynamic segment, no
`generateStaticParams`, and no `revalidate` or `dynamic` export at all. Every
request is a full render.

But the fetch inside `getLatestEarningsData` carries `next: { revalidate: 86400 }`.
So the Next Data Cache collapses repeats **per symbol per 24 hours**.

That means the driver is **distinct symbols rendered per day** — not raw traffic,
and not the symbol universe:

- Traffic on already-seen symbols is free for 24h.
- A crawler sweeping 600 *different* tickers costs 600 calls.
- The cron contributes ~40/day (`checked 315 · fetched 40`, batch-limited).

656 − ~40 ≈ **~616 distinct symbols rendered per day**, which is consistent with
crawler traffic across `/stock/[symbol]` and its two children.

### What this means for the plan

**It scales with crawl breadth, and the existing 24h Data Cache is already the
control.** Two consequences:

1. Moving fundamentals to an earnings trigger does **not** touch this line —
   these are render-path calls with their own cache, not cron calls.
2. The lever that would actually reduce it is making those three routes
   non-dynamic, or lengthening the 24h window. Both are separate decisions from
   the event-driven work, and neither is in the current plan.

Flagging because the brief expected this to be either traffic-shaped or
symbol-shaped. It is neither: it is *distinct-symbols-per-day* shaped, bounded
above by the universe and below by however much of it gets crawled.

## Q8 — How often does stock-list actually change?

**ANSWERED: monthly is defensible; weekly buys nothing measurable.**

Not re-fetched — it is 3.04 MB a go and its size is already known.

What changes a 38,826-row symbol → companyName dictionary:

- **New listings.** US IPOs run roughly 150–300/year across all venues. Against
  38,826 rows that is well under 0.1% a week.
- **Ticker renames and M&A.** Rarer still, and the ones that matter (FB → META)
  are exactly the cases where the *old* row disappearing is the signal, not the
  new one appearing.
- **Delistings.** Removal, not addition — and Q5 is the mechanism for those.

The consumer is `earningsCalendar.ts`, joining calendar rows against it for a
display name. **The failure mode of a stale entry is a missing or outdated
company name on a calendar row — cosmetic, and self-correcting at the next
refresh.** It is not a pricing, universe-membership or correctness input.

So the cost of staleness is low and the cost of the refresh is 3.04 MB. **Monthly**,
with the caveat that a newly-listed symbol may show its ticker rather than its
name for up to a month. If that proves visible, weekly is a 4× cost increase for
a cosmetic gain — worth doing only if someone actually reports it.

**Do not delete stock-list.** That was a withdrawn recommendation: it is
market-wide, and the screener's 1,000 rows cannot cover 38,826 symbols.

## Q9 — Does the IPO calendar give usable lead time?

**PENDING.** Probe `Q9-ipo-calendar`.

Reports `rows`, the date range, and the full `rowKeys`. Both halves matter: lead
time is only useful if the row also carries enough to admit the symbol to the
universe. A row that names a future date but carries no exchange or company name
is visibility without actionability.

## Q10 — Does the today-bar append or replace?

**UNKNOWN, and deliberately left that way.**

The probe is valid only Mon–Fri 14:00–19:45 UTC. It has not been run inside that
window, and this session cannot run it at all.

This is recorded as UNKNOWN rather than filled in because the previous run
reported UNKNOWN honestly for the same reason, and that is why the question is
still askable. An out-of-window result would be a number that looks like an
answer.

It decides whether a price-pool-synthesised intraday bar appends or replaces —
and getting it wrong corrupts every indicator at once, since
`parseFmpHistoricalRows` sorts by date and does not collapse duplicates.

---

## What is blocked until these are filled in

| Depends on | Blocked by |
|---|---|
| Universe widening / banding | Q1, Q2, Q3 |
| Event-driven fundamentals (~885 MB/month) | **Q4** — a partial kill if ratios-ttm moves with price |
| Delisting removal | Q5 |
| Any event-driven refresh at all | Q6 — a symbol absent from the calendar never refreshes |
| Forecast accuracy | Q7 (answered — and it reshapes the forecast), Q9 |
| Intraday bar synthesis | Q10 |

Q7 and Q8 need nothing further. The other seven need one authenticated call.
