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

### The other ten: the join key is wrong

**The stale-ticker-on-our-side hypothesis is dead.** Three of the ten resolve at
SEC, and every one under a **different ticker string than ours**:

| ours | SEC's | CIK | title |
|---|---|---|---|
| MMC | `MRSH` | 62709 | MARSH & MCLENNAN COMPANIES, INC. |
| FI | `FISV` | 798354 | FISERV INC |
| BK | `BNY` | 1390777 | Bank of New York Mellon Corp |

Not one is a dead company, a delisting, or a gap in SEC's data. `data/cik-map.json`
is built by intersecting our symbols with `company_tickers.json` **on the ticker
string**, and a ticker is a mutable label that the two sides update on different
clocks. The company **name** is the stable thing. **The lookup is keyed on the
wrong field.**

**The seven NOT FOUNDs are not reliable negatives.** That spot-check read a
220 KB file through a summarising model, where truncation and genuine absence
produce an identical answer. Nothing in it says EA, AVB, EQR, K, WBS, NBN or
TOWN are missing from SEC's file, and they are **not recorded either way** here.

## 3a. One dispatch, not ten — `relay task "sec-titles"`

`sec-symbol-status` asks "is this company alive", per symbol. That was never the
question: these are live mega-caps. The question is *what is this company called
at SEC*, and answering it needs the whole file in hand, matched exactly — which
is what a runner has and this sandbox does not.

`scripts/sec-title-candidates.mjs` + `scripts/lib/sec-title-match.mjs`: one
read-only pass that matches every unresolved symbol's company name against every
row of `company_tickers.json` and prints ranked candidates with CIKs.

**It prints; it does not apply.** No fuzzy match is auto-applied, the script
cannot write, and the payload is deliberately shaped as an **array of records**
rather than a symbol → CIK object, so it is not one copy-paste from being
committed as a map. Asserted, not merely intended.

**Every candidate is corroborated.** For each symbol's leading candidate the
script also fetches `data.sec.gov/submissions/CIK…json` and prints the filer's
own `name`, `tickers` and `exchanges`, plus `carriesOurSymbol` — which will be
`false`, and that *is* the finding. A name match alone is a guess; a name match
the filer's own record agrees with is a corroborated claim.

**It cannot pass by measuring nothing.** A non-200 from SEC is fatal; a parsed
file with no rows, or no FISERV control row, is fatal; and **symbols with no
available company name are reported separately from symbols with no match** —
collapsing those two would recreate the exact ambiguity this task exists to
remove.

### Naming the exception to wireProvider's rule

`lib/server/news/wireProvider.ts` refuses name matching in as many words: a name
match "would reintroduce exactly the text guessing the structured field avoids".
**That is correct there and is not being softened.** The header of
`sec-title-match.mjs` states the difference rather than asserting one:

| | wireProvider | this |
|---|---|---|
| when | every render, per symbol | once, at build time |
| on a wrong match | a foreign company's release on a stock page, served to a reader | nothing — printed, and a human approves before commit |
| checkable | no | yes, against `submissions/` |
| alternative | a structured `<category>` that is always right | none; the structured field **is** what failed |

Both halves are asserted — the quoted refusal must be present, and so must the
contrast. An unexplained exception to a stated rule is how the rule gets dropped.

## 3b. Three knobs I built; two were dead and one was harmful

The matcher's first draft had three pieces of normalisation. The mutation suite
and one sharpened assertion killed all three, and they are worth recording
because each failed differently:

**`&` → `" AND "`, then dropping AND.** A mutation replacing it with a plain
space **survived every assertion**, because the two are identical in every case.
Dead elaboration — and the comment above it claimed it "is what makes MMC work".
`lib/server/news/companyName.ts` already records this exact species of mistake
about its own suffix list: *"a comment claiming the ordering is what protects the
name would have been credit in the wrong place."* Same error, one file over.
Removed rather than kept with a corrected note.

**`shared >= 2` as a floor on partial matches.** Unreachable at
`PARTIAL_FLOOR = 0.6`: with one shared token and neither side a subset, the union
is at least three, so the score cannot exceed 1/3. Proved by enumeration, not
assumed. No mutation can kill it, so it stays as insurance against someone
lowering the floor, and the **invariant** is asserted instead of the guard.

**Dropping "structural" words (HOLDINGS, GROUP, TRUST, PARTNERS) for the exact
tier — this one was actively wrong.** None of the three known cases needs it:
MMC, FI and BK reduce identically without it, because COMPANIES, INC and
CORPORATION are all *legal forms*. And **with** it, "Brookfield Corporation" and
"Brookfield Partners" both collapse to `{BROOKFIELD}` and are reported as an
**exact** match — two distinct filers at the one tier meant to be near-certain.

It survived the first suite because my assertion used a pair that *also* differed
by a non-structural word, so it would have held either way. Sharpening the
fixture to a pair differing by nothing else turned the assertion red against my
own code. The general rule now in the file: **a token you drop is a distinction
you can no longer make.** Dropping INC is safe because no two companies differ
only by it. PARTNERS is not that.

One fixture also went stale as a result — the ambiguity case stopped being a tie
once structural words survived — and the assertion failed, correctly. It now uses
the real hazard: two filers differing only by legal form (`X Corporation` /
`X Inc`), which is common and which nothing can adjudicate automatically.

**14/14 mutations killed** after those repairs.

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

- **Dispatch `sec-titles`** (read-only job, needs the dump for company names).
  One pass, ten symbols, ranked candidates plus corroboration. Owner-side.
  Then confirm by hand and add only confirmed entries to `data/cik-map.json`.
- **Re-key the map build on the name once that pass validates the approach.**
  The ticker join is what failed; this run only works around it.
- **The `companyName` fallback gap** — the snapshot carries `sector` and
  `industry` only.
- **Relevance ranking on names like "A.O. Smith"** — the real AOS item, unowned.
