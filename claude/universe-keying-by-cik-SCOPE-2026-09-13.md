# Keying the universe by CIK instead of ticker — scope, not an implementation

Written 2026-09-13 after four symbols (`BK`, `EA`, `EQR`, `WBS`) came back with no
CIK from SEC's ticker map, and two of them turned out to be renames rather than
departures: CIK 1390777 now lists as `BNY`, CIK 906107 as `VMRK`.

**Nothing here is built.** This is what it would take.

## The defect, stated precisely

A ticker is a **label that the issuer can change**. A CIK is an **identifier SEC
assigns once and does not reuse**. The universe is keyed by the label.

So when `BK` disappears from the ticker file, the system cannot tell apart:

| What happened | What a ticker-keyed system sees |
|---|---|
| Renamed to `BNY` | `BK` is gone |
| Acquired, delisted | `BK` is gone |
| Went private | `BK` is gone |
| Missing row in a partial file | `BK` is gone |

The daily-index job now distinguishes the first case **whenever the manifest
already holds a CIK** — it looks the CIK up in the map's reverse index and
records a reticker instead of starting a delisting clock. That is a real fix and
it covers the steady state.

**It does not cover the cold start.** `BK` had `cik: null`, because it never
resolved in the first place, so there was no identity to trace. A ticker-keyed
universe cannot bootstrap the very identity it needs to survive a rename. That
is the structural half, and it is what keying by CIK would fix.

## What already keys by CIK

The SEC manifest entry carries `cik`, and the daily index intersects on it — the
change detector is *already* CIK-native. The ticker is only how the entry is
addressed.

## What would have to change

### 1. The universe itself
`dynamicUniverseCache` stores symbols in two Redis sorted sets (`SCORE_KEY`,
`SEEN_KEY`) with the ticker as the member. Members would become CIKs, or a
parallel `cik -> ticker` map would have to become authoritative. **This is the
load-bearing change and everything else follows from it.**

### 2. Every per-symbol Redis key
`symbolEviction.PER_SYMBOL_KEYS` lists **16** prefixes, each built as
`${PREFIX}${symbol}`. Keying by CIK means either rewriting all 16 namespaces
(a migration over live data) or keeping tickers as the storage key and treating
CIK as an index — cheaper, and it leaves the rename problem half-solved.

### 3. The things that legitimately are tickers
Not everything should move:

- **URLs.** `/stock/AAPL` is the indexed, linked, ranked form. It must stay a
  ticker, which means a rename needs a **301 from the old ticker to the new** —
  a page-level concern this scope does not cover but must not break.
- **`curatedSymbols.ts`** is hand-maintained by ticker and drives the sitemap.
- **FMP and the bars path** are keyed by ticker at the provider.
- **ETFs and indices** (`SPY`, `QQQ`) have no CIK in the equity sense.

So the honest shape is **not** "replace ticker with CIK everywhere". It is:
**CIK becomes the identity; ticker becomes a display label and a URL slug that
hangs off it, with history.**

### 4. Symbols with no CIK at all
ETFs, indices and anything SEC's map does not carry. A CIK-keyed universe needs
a **synthetic identity** for these (`ETF:SPY`) or a two-population design.
Roughly 32 ETFs in the curated list alone — not an edge case.

## Sizing

| Piece | Shape | Risk |
|---|---|---|
| `cik -> ticker` index + `formerTickers[]` on the manifest | additive, no migration | low |
| Reticker detection from the reverse index | **done** | — |
| Universe sorted sets keyed by CIK | live data migration, two keys | **high** |
| 16 per-symbol namespaces rekeyed | live data migration | **high** |
| Synthetic identities for ETFs/indices | new concept | medium |
| 301s for renamed tickers | SEO-visible | medium |

## The cheap 80%, and why it is worth doing first

Most of the benefit needs **none** of the high-risk migration:

1. **Store `formerTickers[]` on the manifest entry.** A rename appends; nothing
   is lost. Additive.
2. **Seed the CIK for every universe symbol at admission**, not lazily. The cold
   start is the whole gap — with a CIK present, the reticker detection already
   shipped covers the rename.
3. **Resolve a request for a retired ticker through `formerTickers`** and 301 to
   the current one.

That leaves the universe keyed by ticker while making a rename **survivable and
attributable**, which is the actual complaint. Full CIK-keying buys correctness
in the remaining cases at the cost of two live-data migrations across 16
namespaces.

## Recommendation

**Do the three cheap items. Do not rekey the universe yet.** Revisit when
something genuinely needs identity-over-time — a "this company was formerly X"
display, or a merger history — rather than on the strength of four symbols, two
of which the shipped reticker detection already handles.

The one thing that should not wait is **item 2**: seeding the CIK at admission.
Every symbol without one is a symbol whose rename is undetectable, and it costs
nothing but an ordering change.
