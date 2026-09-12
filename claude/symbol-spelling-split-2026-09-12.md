# The same company is filed under two spellings, and only one of them is looked up

Measured 2026-09-12 from the frozen Step 0 dump (`dumpedAt 2026-09-12T11:08:18.572Z`),
analyse run `34693021767`. No Redis call, no FMP call — the artefact answered it.

## What was asked, and what came back

`BRK.B` was the single symbol in the 700-symbol analysis universe missing industry
**and** sector from either cache — the whole backfill target, one ticker. The open
question was whether that was a data gap or a symbol-shape gap, and the upstream half
could not be settled from the sandbox.

It did not need to be. **The screener cache holds the industry and the sector. It
holds them under `BRK-B`.**

```
BRK.B  [universe]  history=Y/n  profile-key=n/n  screener=n/Y  industry-either=n/Y  sector-either=n/Y
                   ^ dotted/dashed
```

Bars are filed under the dotted spelling. Taxonomy is filed under the dashed one.
Nothing looks up the dashed one. **The data was never missing; the lookup was.**

## Why the two paths disagree

| Layer | Symbol sent to FMP | Redis key | Source |
|---|---|---|---|
| Bars | `BRK-B` | dotted | `buildFmpSymbol` maps dot→dash for the REQUEST only (`lib/server/historyCache.ts:378`, one call site at `:1320`) |
| Fundamentals | `BRK.B` | dotted | **no mapping exists on this path** — `cleanSymbol` deliberately preserves dots |
| Screener ingest | n/a | **dashed** | rows come from FMP's own screener endpoint, so they arrive in FMP's spelling |

`buildFmpSymbol` is the only dot→dash mapping in the codebase. It exists because FMP
wants the dash — and that is now measured rather than inferred, because the screener
rows FMP itself returned are dashed.

## The correction to the first framing: it is not "every dotted ticker"

The first reading of this was "every dotted ticker gets bars and no taxonomy, and the
dual-class universe is full of dotted tickers." The dump says that is too broad, and
the narrower version is the useful one.

**Seven awkward-shaped tickers are in the analysis universe today, and six of them
work fine:**

| In the universe as | Symbols | Works? |
|---|---|---|
| **dashed** | `BF-B`, `EP-PC`, `FITB-PM`, `MER-PK`, `MKC-V`, `PBR-A` | **Yes** — history, profile and screener all agree on the dashed key |
| **dotted** | `BRK.B` | **No** — history dotted, taxonomy dashed, no bridge |

So the pipeline handles the dual-class shape correctly whenever the symbol arrives in
FMP's spelling, which is what happens to everything sourced from the screener. The
break is specifically at **the boundary where a human writes a ticker with a dot**.

`BRK.B` is hand-written, in five places: `lib/curatedSymbols.ts`,
`lib/server/presetUniverse.ts`, `lib/server/symbolSearch.ts`,
`lib/server/earningsCalendar.ts` and `app/api/market/route.ts`. It is the only dotted
entry in any of them.

**That is still a latent scaling bug, but a sharper one.** Not "dual-class names will
break as the universe grows" — screener-sourced growth is safe. It is: *every future
hand-edit that spells a ticker the human way rather than the vendor way breaks
silently, and the `#404` hand-edit rule guarantees there will be more hand-edits.*
The dump already holds 18 dashed dual-class and preferred names in the screener cache
(`BF-B`, `BRK-A`, `CIG-C`, `CMS-PB`, `CTA-PA`, `CTA-PB`, `EP-PC`, `FITB-PA`,
`FITB-PM`, `MER-PK`, `MKC-V`, `MOG-A`, `OAK-PA`, `OAK-PB`, `PBR-A`, `SEAL-PB`,
`TRTN-PC`, plus `BRK-B`) — each one a name a future hand-edit could reintroduce with
a dot.

## The second finding, which nobody was looking for

**`BRK-B` is in the dynamic universe zset, score 191, with no bars.**

```
BRK.B  analysis + rendered | bars yes | SERIES 2021-08-31..2026-09-11 (1263 bars, qualified)
BRK-B  zset(score 191)     | bars no
```

Berkshire is in the pipeline **twice, under two spellings**, in two different
universes. Deduplication is by exact string, so:

- the dynamic zset spends a slot on a symbol that has never had a bar fetched;
- any count, exclusion list or "distinct symbols" figure spanning both universes
  double-counts one company;
- the 700 and the 696 are not as disjoint-by-company as their sizes suggest.

This was not part of the question. It fell out of asking the question about the class
rather than about the one symbol, which is the argument for having done it that way.

## What to do, in order

1. **Normalise on the fundamentals path**, so a dotted universe entry finds the
   dashed cache row. The fix belongs where the mismatch is — one canonical form used
   for the key, applied on read and write — not a per-symbol alias table.
2. **Do not backfill.** There is nothing to fetch: the value is already cached. A
   backfill sized off the profile key would also have fetched 154 symbols that
   already had an industry from the screener.
3. **Reconcile `BRK-B` against `BRK.B`** in the dynamic universe, and check whether
   the dedup that produced the 696 is string-equality across the whole pipeline.
4. **Decide the canonical spelling explicitly and write it down**, because the repo
   currently holds both conventions and neither is documented as the one to use. The
   vendor's spelling is dashed; the hand-written lists are dotted for exactly one
   ticker. Whichever is chosen, the other needs converting at the boundary.

This is worth doing before the universe grows, not after — but for the hand-edit
reason above, not because screener-driven growth would spread it.

## Two defects in the probe itself, fixed

Recorded because the numbers in the first run's log are slightly wrong and that log
is linked from the PR:

- **`due:BRK.B` and `due:FITB-PM` printed as if they were tickers.** They are
  namespaced refresh markers in the history dataset; a `:` now disqualifies a string
  from being treated as a symbol.
- **19 split-spelling findings were reported for 18 distinct pairs.** `BRK.B` (from
  the universe) and `BRK-B` (from the zset) are both candidates and normalise to the
  same pair, which was counted twice. Now keyed by pair.

Neither changes the finding. The corrected counts are **18 pairs** and **21 → 19
awkward-shaped strings**.

## Related

- `claude/traps/a-reconstruction-cannot-corroborate-its-source.md` — the rule that
  produced this: a derived value that is load-bearing for a published conclusion gets
  checked against its source before publishing. The claim "BRK.B is a symbol-shape
  issue because `buildFmpSymbol` maps dots to dashes" was published from memory of
  the code rather than a read of it, and it was backwards.
- `claude/cached-bars-are-comparison-not-correctness-2026-09-12.md` — where the
  one-symbol backfill target was established.
