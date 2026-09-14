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

**The stale-ticker-on-our-side hypothesis is dead.** The resolved cases are all
present at SEC under a **different ticker string than ours**:

| ours | SEC's | CIK | status |
|---|---|---|---|
| FI | `FISV` | 0000798354 | **corroborated** — the run's own control line, twice |
| BK | `BNY` | 0001390777 | **corroborated** — the four-missing-ciks note |
| ~~MMC~~ | ~~`MRSH`~~ | ~~62709~~ | **WITHDRAWN 2026-09-14 — do not act on it** |

> **Why MMC is withdrawn, and why it matters more than one symbol.** It came
> only from reading SEC's 220 KB file through a summarising model. That same
> channel later returned *"EQR → CIK 1650107 → COCA-COLA EUROPACIFIC PARTNERS
> plc"* — **1650107 is CCEP**, so the channel had fabricated a field
> association: a real CIK, a real company, bolted to the wrong symbol.
>
> A channel that mis-associates fields makes its POSITIVES worthless too, not
> just its negatives. The earlier caveat here said only the negatives were
> unreliable; that was too generous, and this corrects it. FI and BK survive
> because each has independent corroboration — FI from the run's own control
> line, BK from the prior note — not because they came from the same read.
>
> This is the same discipline the wire-egress probe needed: a measurement is
> evidence for exactly what was measured, through a channel you can vouch for.

Not one is a dead company, a delisting, or a gap in SEC's data. `data/cik-map.json`
is built by intersecting our symbols with `company_tickers.json` **on the ticker
string**, and a ticker is a mutable label that the two sides update on different
clocks. The company **name** is the stable thing. **The lookup is keyed on the
wrong field.**

**Nothing from that channel is recorded either way** — neither the NOT FOUNDs
(truncation and absence give an identical answer) nor the hits (see above).
EA, AVB, EQR, K, WBS, NBN, TOWN and now MMC are open.

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

## 3c. Run 48 was void, and the guard is why we know

`sec-titles` dispatched at `94f6a12`. The SEC half worked perfectly — HTTP 200,
10,426 rows, FISERV control found. And:

    [titles] name fields found: NONE
    [titles] NO NAME AVAILABLE, so not matchable (≠ absent at SEC):
             AVB, BK, EA, EQR, FI, K, MMC, NBN, TOWN, WBS
    [titles] done — 0 exact, 0 subset, 0 partial, 0 with nothing above the floor.

**Void by the run's own criterion.** Without the no-name/no-match split this
reads as ten real negatives, and seven live mega-caps get recorded as absent
from SEC's file. The guard fired on its first outing.

### The cause, established rather than guessed — and it is not a sixth spelling

`scripts/static-profile-build.mjs` runs the **identical** traversal over the
**same three dump files** — `?.values`, `Object.entries`,
`value.symbol || symbolFromKey(key)`, same typeof guard — and it *succeeds*,
yielding screener 2,609 / fundamentals 760 / profile 651 rows.

So the dump shape is right and the traversal was right. Those FMP cache rows
carry `sector` and `industry` and **no company-name field at all** — which is
exactly why `data/static-profile.json` holds only those two fields. There was
nothing to read.

### The shape worth seeing

**The missing-name problem and the missing-CIK problem have the same root:
there is no committed, non-FMP source of company IDENTITY.** The taxonomy
survived the FMP exit because it happened to be cached. The names did not.

## 3d. Repointed at the Nasdaq Trader directory — and it closes the second gap

Names now come from `nasdaqlisted.txt` + `otherlisted.txt`, which is where
`lib/stock-news-data.ts`'s `fetchCompanyName` already reads at render time. The
sandbox is refused `www.nasdaqtrader.com` by policy; a runner is not.

- **All ten get a name**, so the re-run yields evidence instead of a void.
- **`needsDump` is now `false`.** The dump is still read when present (it adds
  the pickers half of the universe — one symbol, the dotted `BRK.B`), but
  requiring an artifact the task does not need was making it wait for nothing.
- **It emits a second payload, `company-names`** — a committable snapshot for
  the universe, which is the other open gap. Same fetch, one piece of work.

Two things about that second payload, because they are the parts that could go
wrong quietly:

**It is a different kind of artifact from the candidate list, and that is why
one may be committed wholesale and the other may not.** A candidate is a fuzzy
name match and needs a human. The snapshot is a direct transcription keyed on
the exact symbol, from the directory the render path already trusts. Nothing to
adjudicate.

**It stores RAW directory names.** The app has its own normaliser
(`companyNames.ts` `cleanName`) which runs over whatever `fetchCompanyName`
returns. Baking this script's cleaning into the data would mean two cleanings,
one of them invisible.

### Parsing

Header-driven, not positional. Three places in this repo already split these
files and they disagree — two take `cols[0]`/`cols[1]`, `listing-split.mjs`
reads the header. The header is right, and the difference bites the moment
anyone points a positional parser at `nasdaqtraded.txt`, whose first column is
a `Nasdaq Traded` Y/N flag with the symbol at index 1.

`otherlisted.txt` carries `ACT Symbol` (dotted `BRK.B`) **and** `NASDAQ Symbol`
(dashed `BRK-B`), so both spellings resolve to one name — the same dot/dash
split that cost the CIK lookup a symbol, handled at the source for once.

The instrument clause ("— Common Stock", "Class A Common Stock") is stripped,
mirroring `companyNames.ts`'s `INSTRUMENT_SUFFIX_RE` and `RATIO_CLAUSE_RE`
rather than re-deriving them. Measured on the committed 155-name fixture:
**104 of 155 real names change.** Left in, `ELECTRONIC ARTS COMMON STOCK`
scores against SEC's `ELECTRONIC ARTS INC.` as a *subset* rather than an
*exact* — a certainty downgraded to a candidate for no reason.

**It is a phrase rule, not a token rule, and that is why it lives in the parser
rather than in the matcher's stopword list.** The clause "american depositary
shares" is noise; the token `AMERICAN` is not. Dropping it would collapse
American Airlines, American Express and American Tower toward each other.
Asserted directly.

## 3e. A checker that passed against code that would have crashed

Repointing the name source deleted the block defining `fieldHits` and left a
`console.log` still referencing it. **Line 129 was a `ReferenceError`.** It got
past three gates:

| gate | why it passed |
|---|---|
| `node --check` | it only parses |
| `npx eslint` | this repo's config has `no-undef` off, as TS-centric configs do |
| the checker's own assertions | they grep for the *string*, which was still in the file |

That last one is `claude/traps/grep-finds-the-comment-not-the-code.md` arriving
from the other direction: a grep agreeing with broken code rather than with
absent code.

A relay script gets one shot — it runs once, on a runner, three minutes into a
dispatch — so the property is now checked with the only tool in the repo that
catches it: the TypeScript compiler in `checkJs` mode, filtered to
"Cannot find name" (TS2304/2552), over the script and both its modules. With a
positive control, because a misconfigured program reports zero diagnostics for
everything.

**Mutation coverage after the repairs: 9/10** (the tenth is a guard deleted as
provably redundant, below). The first pass was 3/10 — the parser had a
well-argued header and **no behavioural test at all**, so dropping the
test-issue filter, the header check and the instrument strip all survived. The
fix was to run it against the committed real-name fixture rather than to
describe it.

### A fourth dead guard

`parseDirectory` had a `looks like HTML` check copied from
`company-name-sample.mjs`. A mutation deleting it survived, and correctly: the
header check is **strictly stronger**, since an HTML page's first line does not
split on `|` into fields named `Symbol` and `Security Name`. Removed — a test
that can only fire on a subset of what another test already rejects is a line
no assertion can defend.

That is the fourth piece of unearned machinery in this work (`&` expansion,
`shared >= 2`, structural-word dropping, and now this). Three were harmless and
one was actively wrong. The common thread: each was added because it sounded
prudent, and none was measured until a mutation asked.

## 3f. Run 49, and the common cause — found in this repo, not on a runner

    [titles] directory rows: nasdaqlisted 5596, otherlisted 7586
    [titles] names available for 13700 symbols  →  covering 2/10 unresolved
    [titles] NO NAME AVAILABLE …: AVB, BK, EA, EQR, FI, K, MMC, WBS
    [titles] company-name snapshot: 2592/2620 universe symbols (128,918 bytes)

Eight symbols absent from **both** national sources. Two independent national
listings both missing eight large, currently-traded US companies is not
plausible as a fact about the world — so the cause is ours.

**It was already written down here, twice, and I had not read it.**
`lib/server/presetUniverse.ts` and `scripts/check-symbol-eviction.mjs` both
record:

    MMC -> MRSH   2026-01-14, NYSE, with the rebrand to Marsh
    FI  -> FISV   2025-11-11, NYSE -> Nasdaq, reinstating the original ticker

Both are **ticker renames, not delistings**, raised by the hand-edit alarm
(`presetNeedsHandEdit MMC, FI`) when FMP stopped serving bars weeks after each
change. `presetUniverse.ts` was hand-edited to the new spellings.
`data/static-profile.json` was **not** — it is a frozen FMP capture and still
carries the retired ones.

Measured across our own three datasets:

| old | new | old in snapshot | new in snapshot | old has CIK | new has CIK |
|---|---|---|---|---|---|
| MMC | MRSH | ✓ | ✓ | ✗ | **0000062709** |
| FI | FISV | ✓ | ✓ | ✗ | **0000798354** |
| BK | BNY | ✓ | ✓ | ✗ | **0001390777** |

The snapshot carries **both spellings**. The company is already in our data
under its current symbol, with a CIK. The retired spelling is a stale duplicate
that no national source can resolve because it is no longer listed.

### I was wrong about FI, and the correction runs the other way

I wrote that `FI` "inverts the stale-ticker hypothesis" — that our universe had
the current ticker and SEC's file was the stale one. **That was backwards.** I
read `FISV` as Fiserv's predecessor because that is the order it takes outside
this repo; here the rename went `FI → FISV` on 2025-11-11 and the repo says so
in two files I had not read.

So the original hypothesis — a stale ticker on our side — was right, and the
evidence for it was in the working tree the whole time. The lesson is narrower
than "read more": **before reasoning about which of two tickers is newer, check
whether this repo has already dated the change.** It had.

### MMC/MRSH — withdrawn on one channel, re-established on another

`MMC → MRSH → 62709` was withdrawn because it came from a model reading SEC's
220 KB file, a channel that also produced `EQR → 1650107 → COCA-COLA
EUROPACIFIC PARTNERS` — a fabricated field association. **That withdrawal
stands, and the CIK is not being reinstated on that basis.**

But `data/cik-map.json` — built by a runner from SEC's own file, byte-verified
at 50,777 — carries `MRSH → 0000062709` independently. Same number, different
and trustworthy provenance, and the rename half is documented in the repo.

**Not acted on.** No alias map has been added and no CIK has been assigned to
`MMC`. Whether the site should resolve a retired spelling at all — or simply
stop carrying it — is a content decision, and the snapshot is the place it
would be fixed. Flagged, not taken.

### The remaining question, and what run 50 answers

Five of the eight (AVB, EA, EQR, K, WBS) have no documented rename here, and
NBN/TOWN have names but no SEC match. The raw substring search now prints a
verdict per symbol:

| verdict | reading |
|---|---|
| PRESENT IN BOTH RAW SOURCES | we reported it missing, so the bug is entirely ours |
| PRESENT IN ONE ONLY | our parsing, or the other source |
| ABSENT FROM BOTH | not currently listed under this spelling |

The absent verdict deliberately does **not** assert a rename. "Not listed under
this spelling" is what the bytes support; which symbol replaced it is a further
claim needing further evidence.

## 3g. The two "real negatives" overstated, and the fix

`NBN` and `TOWN` were reported as "a REAL negative, the file was searched in
full". The search was exhaustive; **the matcher is not**, and conflating them
overstates what that line knows:

| symbol | our name | likely title | old score |
|---|---|---|---|
| TOWN | Towne Bank | `TOWNEBANK` | `{TOWNE,BANK}` vs `{TOWNEBANK}` — **zero shared tokens, 0.00** |
| NBN | Northeast Bank | `NORTHEAST BANCORP`-shaped | 1 of 3 = **0.33**, under the 0.6 floor |

TOWN is not a weak match, it is an **invisible** one: tokenising put a boundary
where the other side has none. Two fixes, both confined to the candidate tier
where a human confirms every hit:

**Compound spacing.** Tokens joined end to end, so `Towne Bank` meets
`TOWNEBANK`. Its own tier, ranked just under `exact`, so a reviewer sees which
rule fired. **Order is preserved** — the first version sorted, which broke the
one case it existed for (`BANK`+`TOWNE` never meets `TOWNEBANK`) and would have
matched any anagram.

**Bank legal forms FOLDED, not dropped.** `BANCORP`/`BANCSHARES`/`BANKSHARES` →
`BANK`. Dropping the token would make bare "Northeast" match either, throwing
away a real distinction; folding keeps the token and only equates its spellings.
It is safe precisely **because** two real candidates then tie and set
`ambiguous`. Scoped to banks because that is where it was measured — run 49's
only two matchable symbols were both banks — and no other sector gets an alias
list without its own evidence.

**These titles are hypothesised, not observed.** What is asserted is a
capability: *if* the title has that shape, the matcher now surfaces it. Whether
it does is for run 50 to say.

**11/11 mutations killed**, after two survivors were closed: widening the fold
to sector words like FINANCIAL, and swapping the rank of `exact` and
`compound` — neither of which any existing fixture exercised.

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
- **Wire `data/company-names.json` into the render path** once the re-run's
  `company-names` payload is committed. The data comes first; wiring a loader to
  a file that does not exist yet is how a documented degradation becomes one the
  code never actually performs.
- **Relevance ranking on names like "A.O. Smith"** — the real AOS item, unowned.
