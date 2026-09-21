# Dashboard off FMP — scoping, 2026-09-12

Read from the repo at `08ea24a`, not inferred. Phase 2, after Pickers is stable.
Companion to `claude/stooq-sec-probe-INSTRUCTIONS-2026-09-12.md`.

---

## 1. The rest of the market — two universes, currently welded together

Today the analysis universe and the data universe are the same 700 symbols, because every
symbol costs FMP calls. **A whole-market bulk file breaks that weld**, and the dashboard is
the reason to break it:

| | Analysis universe | Data universe |
|---|---|---|
| Size | 700 (`ANALYSIS_UNIVERSE_CAP`) | the whole market |
| What it gets | signals computed, scored, in the pickers payload | bars stored, nothing computed |
| Serves | Pickers | search, any stock page, benchmarks |
| Cost driver | build time + payload bytes | storage + write commands |

**Keep everything. Compute on 700.** The file contains the whole market whether 700 symbols
are used or 11,000.

### What keeping it costs, on the meter that bills

Storage, at the measured 92.52 B/bar and ~1,188 bars:
```

~8,000 symbols × 109,917 B ≈ 880 MB against 100 GB → 0.9%

```

Storage is not the question. **Commands are.** Written the obvious way — one `SET` per
symbol — the whole market is 8,000 commands a day, ~240k/month, ~$0.48/month. Affordable,
but it is 12% of the current bill for symbols nobody has looked at.

### Write it with chunked MSET

Upstash bills per command, and **an `MSET` of N keys is one command.** Byte-chunked at the
same 5 MB budget `chunkByBytes.ts` already uses:
```

880 MB ÷ 5 MB ≈ 176 MSETs instead of 8,000 SETs

```

Per-symbol keys preserved, ~45× fewer commands. This is the **write-side mirror of the
chunked MGET pattern already used on reads** — not a new idea, the existing one applied to
the other direction.

**This also attacks the biggest finding from the console read:** writes are 1,440,133
against 457,157 reads — **76% of all commands.** The same MSET treatment applies to
`fundamentalsCache.ts`'s 755 per-symbol `SET`s per hourly run.

**Departure, flag for veto:** `MSET` takes no TTL, so per-key expiry needs either separate
`EXPIRE`s (individually billed — which gives the saving straight back) or an `expiresAt`
field carried inside the value and honoured on read, with a periodic sweep for deletion.
The second is a real change to how this cache expires. Note it also answers the objection
that killed **#379** — a shared hash TTL would let delisted symbols persist, but a per-key
`expiresAt` expires each symbol on its own schedule. Worth re-deriving that decision.

---

## 2. Benchmarks — already solved, and the design is why

`lib/server/benchmarksBuilder.ts`:

```ts
const BENCH_DEFS_STOCK = [
  { key: "spy", label: "S&P 500 (via SPY)",     symbol: "SPY" },
  { key: "ndx", label: "Nasdaq 100 (via QQQ)",  symbol: "QQQ" },
  { key: "dia", label: "Dow Jones (via DIA)",   symbol: "DIA" },
  { key: "iwm", label: "Russell 2000 (via IWM)", symbol: "IWM" },
] as const;
```

**These are ETF proxies, not index values — and that distinction is worth a lot here.**

Index *levels* (the S&P 500 number itself) are licensed intellectual property of the index
provider, and that is a separate licence from exchange price data — the one place where
"it's end-of-day, so it's free to display" stops being true. Databento's own guidance notes
exchanges specifically restrict end-of-day data used to generate index-based products.

SPY, QQQ, DIA and IWM are ordinary exchange-listed securities. **Whatever this site can
legally display about AAPL, it can display about SPY.**

So the answer to "does Stooq carry the benchmarks" is: **the question does not arise.**
They are four more US equity tickers, and they will be in the same bulk file as everything
else. No index dataset, no separate licence, no extra source.

Whoever chose ETF proxies and labelled them "via SPY" made this phase much cheaper than it
would otherwise have been.

**What changes:** currently four live `stable/quote` calls behind a 5-minute memory cache
and a 24-hour Redis fallback. Under EOD they become four reads from the same bar store the
pickers use — close and previous close, which is exactly what `BenchItem` already holds
(`close`, `prevClose`, `changePct`).

**Keep unchanged:** `hasRealData()` — the guard that refuses to cache an all-null payload
because *"writing it to Redis would poison EVERY instance, and for as long as the entry
lives"* — and the stale-serving fallback. Both are provider-independent and both are right.

**The tiles need the same honesty as the picker rows.** They currently imply an intraday
figure; under EOD they are a close. Label accordingly.

---

## 3. Search — one function to replace, and a trap already documented

`app/api/symbols/route.ts` → `lib/server/symbolSearch.ts`. Two live FMP calls **per
uncached search**: `/stable/search-symbol` (matches tickers) and `/stable/search-name`
(matches company names), merged, deduped, filtered to `NASDAQ / NYSE / AMEX`, ranked.

**Almost none of that is FMP-specific.** `rankResult`, `POPULAR_SYMBOLS`,
`isDerivativeSymbol`, the merge order and the dedup are all local logic. **Only
`fetchFmpSearch` touches FMP**, and it returns `SymbolRow[]` — `{ symbol, name, exchange }`.

So replacing search is replacing one function behind an unchanged interface.

### READ THIS BEFORE PROPOSING A LOCAL INDEX

`symbolSearch.ts` carries an explicit warning, because **the obvious replacement is what
this route used to do and it failed**:

> this route previously downloaded Nasdaq Trader's `nasdaqlisted.txt` + `otherlisted.txt`
> on every uncached request and searched them locally. That had three fatal bugs:
> 1. It dropped any name containing "ADS"/"ADR"/"DEPOSITARY", which silently excluded
>    legitimate US-listed companies — ARM could never be found at all.
> 2. Its loose fallback matched the query as a bare substring anywhere in the company
>    name, so "arm" matched "Ph-ARM-aceuticals".
> 3. It fetched two large text files per request just to do a string search.
>
> **Do not reintroduce name-substring matching or name-based exclusion filters here; rank
> by symbol/word-prefix instead.**

**A local index is still the right answer — but only because all three bugs are already
fixed, and none of them was the source's fault:**

| Bug | Status |
|---|---|
| ADS/ADR exclusion filter | gone — no name-based exclusion exists now |
| substring matching | replaced by `rankResult`'s symbol/word-prefix tiers, still in the file |
| fetching per request | the thing to fix: build the index **once into Redis**, not per search |

The source was fine. The handling was not, and the handling has since been rewritten. **But
build this deliberately and cite the comment in the PR**, or a future session reads it as
the return of a known-bad design.

### The index

- **SEC `company_tickers_exchange.json`** — ticker, name, CIK **and exchange**. (Plain
  `company_tickers.json` has no exchange field, and `ALLOWED_EXCHANGES` needs one.)
- **Nasdaq Trader `nasdaqtraded.txt`** for ETFs and instruments that are not SEC filers —
  SPY, QQQ, DIA and IWM among them, which matters given §2.

~10–12k rows × ~60 B ≈ **under 1 MB**, byte-chunked into Redis, refreshed monthly. Search
becomes one Redis read instead of two live API calls — **faster and cheaper than today**,
not merely equivalent.

### The trap to close at the same time

`ALLOWED_EXCHANGES` exists because *"picking one of those would open a chart page with no
data behind it."* That constraint gets sharper, not softer: **a search result is a promise
that the page behind it works.** Which is precisely why §1 says store the whole market's
bars — search breadth and data breadth have to be the same set, or the exchange filter
stops being sufficient and the promise breaks.

---

## 4. Crypto — hide, same mechanism as the picker columns

Four places: `BENCH_DEFS_CRYPTO` (BTCUSD/ETHUSD/SOLUSD/TRXUSD via `stable/quote`),
`CRYPTO_USD_PAIRS` in `symbolSearch.ts`, `DashboardClient`'s `CRYPTO_PRESETS`, and the
toggle itself.

Hide by **provider capability**, exactly as the five picker columns do — not a hardcoded
flag — so it returns on the same switch if FMP comes back.

Worth recording: crypto is the one place FMP's live data was genuinely live —
`claude/pickers-earnings-longcache-and-price-pool-2026-07-22.md` verified `/stock/BTCUSD`
ticking $65,998.49 → $65,976.76 in ~75 seconds, because crypto trades 24/7. So this is a
real capability loss, not a cosmetic one. Stooq does publish crypto, but as a separate
dataset of unknown coverage and quality. **Not today.**

---

## 5. News — deferred, and already half-done

`news/stock` was 1.33 GB/month and FMP's **#2 bandwidth consumer**. But **#380 already made
news a stored dataset with no FMP call on render** (`claude/news-as-stored-dataset-spec-2026-08-22.md`).

**So the render path is already decoupled — only ingest needs a new source.** That is a much
better starting position than Pickers had. Tackle it with the news pages, as agreed.

---

## 6. Audit still to do

`app/api/ticker-lookup/route.ts` surfaced alongside the benchmarks work and has not been
read. **Scan for every FMP call site on the dashboard path before planning phase 2** — do
not hand-list from this document. The house rule applies: scan directories rather than
trusting a list someone wrote down.

---

## Order

1. Pickers stable on Stooq + SEC, reversibility switch tested both ways.
2. **Whole-market bars stored** (§1) — the precondition for everything below.
3. Benchmarks (§2) — four symbols, smallest piece, good confidence-builder.
4. Search (§3) — one function, behind an unchanged interface.
5. Crypto hidden (§4).
6. News (§5), with the news pages.
