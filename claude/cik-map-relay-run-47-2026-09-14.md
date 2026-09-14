# Relay run 47 — the CIK map, 695 → 2,609

2026-09-14. [Run 34843237101](https://github.com/TSunDanceK/MyStockHarbor/actions/runs/34843237101),
dispatched against `claude/loving-faraday-8mskr9 @ 0880960` so the widened
generator ran. Success in 14s, on the `read-only` job.

---

## 1. Result

    [sec] universe symbols: 2620 (pickers 700 ∪ static-profile 2619)
    [sec] company_tickers.json: HTTP 200 (219510 bytes) — entries: 10426
    [sec] universe symbols with a CIK: 2609/2620 (99.6%)
    [sec] no CIK for: AVB, BK, BRK.B, EA, EQR, FI, K, MMC, NBN, TOWN, WBS
    [sec] trimmed map: 2609 entries, 50777 bytes

| | before | after |
|---|---|---|
| entries | 695 | **2,609** |
| coverage of profiled symbols | 26.5% | **99.6%** |
| committed bytes | 14,782 | 50,777 |

`AOS` now resolves to CIK `0000091142`.

**Transcription was verified, not assumed.** The payload came through the run
log (the artifact and log-blob hosts are both refused from the agent sandbox —
`403 CONNECT tunnel failed`). The emitted header declares `bytes=50777`; the
written file measures 50,777 bytes and parses to exactly 2,609 entries. A
declared byte count that matches the written file leaves no room for a silent
truncation or a mangled character, which is the failure mode a copy-through
invites.

## 2. The denominator trade-off, now priced

Recorded in `scripts/sec-probe.mjs`'s header with the numbers, so the gap cannot
be rediscovered the way it was found:

| denominator | entries | committed file |
|---|---|---|
| pickers universe (the old bug) | 695 | 14.8 KB |
| **pickers ∪ static-profile** | **2,609** | **50.8 KB** |
| SEC's whole `company_tickers.json` | 10,426 | ~779 KB |

**15× the bytes for the tail.** Trimming is now a decision rather than an
oversight: the file is imported at build time into every bundle touching the SEC
adapter, and the ~7,800 symbols in the tail are ones this site holds no other
data about — no profile row, no sector, no art bucket. A symbol outside the trim
is on the §8 lazy path: the miss logs and returns `[]`, it does not fetch. The
header says to widen if that stops being true, and not to widen because 99.6%
looks untidy.

## 3. The eleven misses are not one thing

Split by evidence available inside our own data. **Only the first is settled.**

### BRK.B — ours, and settled: a separator mismatch

| | in the new map |
|---|---|
| `BRK-B` | **`0001067983`** |
| `BRK.B` | absent |

SEC writes the dashed form. This repo's screener cache writes the dashed form.
The **pickers universe carries the dotted one** — so both spellings of one
company sit in our own data and nothing bridged them.

This is the same bug #448 fixed for taxonomy, re-landing on a different lookup.
`claude/symbol-spelling-split-2026-09-12.md` measured BRK.B as the only universe
symbol missing *both* sector and industry, for exactly this reason, and
`scripts/check-symbol-spelling.mjs` exists because of it. Its own header names
the vector: a person typing a ticker the way a human writes it into a hardcoded
list — a standing practice here, not a one-off. So it will happen again to the
next dotted ticker that enters the universe.

**Fixed at the lookup**, not by adding a second map entry: `cikFor()` falls back
from the dotted spelling to the dashed one. One direction only — the dashed form
is canonical everywhere this repo stores data, and a two-way normalisation would
make the dotted form look equally valid, which is the habit that caused this.
Exact match is always tried first, so a symbol legitimately holding its own
spelling resolves to itself before any rewriting.

### BK and FI — the counterpart CIK is already in the map

|  | in the new map |
|---|---|
| `BK` | absent | 
| `BNY` | **`0001390777`** |
| `FI` | absent |
| `FISV` | **`0000798354`** |

`BK` matches what is already known: CIK 1390777 now files as BNY. (That finding
lives in a Claude-Project-side note, `four-missing-ciks-are-corporate-actions`,
which is **not mirrored into this repo** — it is deliberately not cited as a
repo path here, because a citation to a file that is not in the checkout is a
dead reference, which is what `scripts/check-doc-citations.mjs` exists to catch.
If that note should be readable from GitHub, mirroring it under `claude/` is the
fix.)

**`FI` inverts the stale-ticker hypothesis, and this is worth pausing on.** The
expectation was a stale ticker on *our* side. But our universe carries **`FI`**,
the current Fiserv ticker, and the entry that resolved is **`FISV`**, the old
one. Both are in our universe; only the old one is in SEC's file. On this
evidence it is **SEC's `company_tickers.json` that lags**, not us — which is the
opposite diagnosis and implies the opposite fix. Normalising on our side would
do nothing.

**Not settled.** That `FISV` is in the map proves it is in SEC's file and in our
universe. It does not prove *why* `FI` is absent. `sec-symbol-status` answers it
per symbol by asking `submissions/` by CIK.

### AVB, EA, EQR, K, MMC, NBN, TOWN, WBS — unresolved

No variant spelling in the map, no successor or predecessor ticker in the map.
Nothing in our own data explains them.

`AVB`, `EA`, `EQR`, `K` and `MMC` are large, current, unambiguous US filers, and
SEC omitting them from a 10,426-entry file is implausible on its face. `NBN`,
`TOWN` and `WBS` are small/mid-cap banks and a genuine tail is plausible there.

**Deliberately not written up as corporate actions.** A miss is either a stale
ticker on our side or a real absence at SEC, and those need opposite responses —
`FI` above is the proof that guessing gets it backwards. Ten symbols is one
`sec-symbol-status` dispatch, and that should happen before any of them is
recorded as settled.

## 4. One thing the run log corrected about the previous commit

    [sec] user-agent: "MyStockHarbor/1.0 (contact@mystockharbor.com)"

That is the **older** literal. Consolidating the User-Agent covered the
adapters; `scripts/sec-probe.mjs` and `scripts/news-timing-probe.mjs` each keep
their own copy, because a `.mjs` relay script cannot import a `.ts` module
without the transpile machinery the `check-*.mjs` harnesses use.

So "one string instead of two that drift" was true of the adapters and
overstated for the repo. Bounded and harmless — those scripts talk only to
sec.gov, which accepts either, and `SEC_USER_AGENT` overrides all three — but
now written down in `lib/server/news/userAgent.ts` so the next reader does not
take that file for the only copy and go hunting a bug when a probe log disagrees
with it. **Noticed because the run printed it**, which is the argument for
probes echoing their own configuration.

## 5. AOS — withdrawn, and not a CIK story

`claude/cik-map-coverage-2026-09-14.md` §4 claimed AOS's empty page was explained
by its missing CIK. That was wrong, and the map regeneration does not fix that
page. The measured cause:

    [gnews] AOS q="\"A.O. Smith\" stock" items=61
    [news-feed] AOS pool=4 afterFilters=4 within45d=0 lead=0/5 compact=0/10

`displayNewsPool` is the **ranked** set. gnews ran, had a usable company name,
returned 61 items; relevance ranking cut the stored set to 4 and none were
inside 45 days. ROL: 98 items → pool=35.

The original error was reasoning from a structural fact (no CIK ⇒ empty SEC leg)
to a page-level conclusion without measuring the leg that actually carries the
page. The SEC leg was empty *and irrelevant*. §4a of that document now records
this; the `companyName` fallback gap stays open on its own merits and is
explicitly not AOS's cause.

## 6. Coverage of the checks

`scripts/check-sec-adapter.mjs` §11, **7/7 mutations killed** — normalisation
removed, rewrite reversed, made two-way, a miss inventing a CIK, the input no
longer trimmed, and `fetchForSymbol` bypassing the helper.

Two of those needed the assertion rewritten first, for a reason that has now come
up three times today: **"exact match wins" is indistinguishable from "the rewrite
wins" against the real map**, because no key in it both contains a dot and exists
in its own right, so the branch that separates the two implementations is never
taken. `cikFor` takes its map as a parameter purely so a crafted one
(`{"A.B": …, "A-B": …}`) can discriminate them. Same move as
`classifyProviderStats` and `cikCoverage` — a constant can only be compared, a
function can be probed.

## 7. Open

- **One `sec-symbol-status` dispatch** for the ten non-BRK.B misses. Owner-side.
- **The `companyName` fallback gap** — the snapshot carries `sector` and
  `industry` only.
- **Relevance ranking on names like "A.O. Smith"** — the real AOS item, unowned.
