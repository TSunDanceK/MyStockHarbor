# `fund-or-note` stays a warning. A skip would delete news from real companies.

2026-09-20. Measured on relay run **199**
(`.github/workflows/relay.yml`, task `fund-or-note`,
`scripts/fund-or-note-sample.mjs`), against the live Google News feed from a
runner — `news.google.com` is refused from the agent sandbox with 403 CONNECT.

Settles the question left open by
[`claude/spelling-helper-recovered-18-2026-09-15.md`](spelling-helper-recovered-18-2026-09-15.md)
and by #463's PR body: *"Whether a `fund-or-note` verdict should suppress the
fetch outright is a question about existing symbols too, and is not decided
here."* It is decided here. **It stays a warning.**

---

## 1. The disagreement, in the code

`assessCompanyName` (`lib/server/news/companyName.ts`) returns `fund-or-note`
and its own comment says such names *"should never reach a per-symbol news
query"*.

`gnewsProvider` (`lib/server/news/gnewsProvider.ts`) logs the verdict as an
override candidate and queries anyway.

One of the two had to be wrong, and neither file could settle which.

## 2. The population is 90, not 11

Measured against the committed snapshot (`data/company-names.json`, 2,610 names
after #463) by running the **real** normaliser and assessor through `tsc` —
not a mirror:

| verdict | count |
|---|---|
| `ok` | 2,504 |
| **`fund-or-note`** | **90** |
| `too-short` | 10 |
| `single-common-word` | 6 |

The 11 that #463 added are an eighth of the population. The other 79 have
queried this way for as long as the adapter has shipped, so this was never a
question about the 18 recovered names.

## 3. The verdict fires on three different things

This is the finding that decides it. The marker regex
(`/\b(ETF|ETN|Fund|Notes?|Debentures?|Preferred|Preference|Units?)\b/i`)
does not separate an instrument from a company:

1. **Real operating companies whose UNITS are the tradeable line** — ET
   *"Energy Transfer LP Common Units"*, MPLX, WES, SUN, CQP, BIP. Large-cap
   MLPs with continuous coverage.
2. **Real companies with a security word in their OWN NAME** — PFBC is a
   commercial bank literally called *"Preferred Bank"*; MSDL and BXSL are BDCs
   whose **common stock** trades.
3. **Genuine instruments** — TBB *"AT&T Inc. 5.350% Global Notes due 2066"*,
   the junior subordinated debentures, the preferreds.

A skip keyed on this verdict pays for (3) with (1) and (2).

## 4. What the feed actually returned

Two queries per symbol: **LIVE**, exactly what `gnewsProvider` sends today, and
**PARENT**, the same name with the instrument clause cut off. Controls are
`ok`-verdict names and are the measuring-nothing guard — most rows here were
expected to be empty, so an aggregate threshold would have been satisfied by
the controls alone while every real query failed silently.

| symbol | LIVE | PARENT | |
|---|---|---|---|
| ET | **98** | 100 | on-topic: Seeking Alpha, Business Wire, Stock Titan |
| PFBC | **67** | — | dividend declarations, MarketBeat, Seeking Alpha |
| MSDL | **63** | — | earnings call, MarketBeat, Seeking Alpha |
| BIP | **42** | 100 | |
| PFH | 11 | 100 | |
| CQP | 8 | 80 | |
| SOJC | 8 | 100 | |
| TBB | 7 | 100 | |
| UNMA | 6 | 100 | |
| DUKB | 6 | 100 | |
| MPLX | 5 | 100 | |
| FITB-PM | 4 | 100 | |
| PBR-A | 3 | 100 | all three off-topic (Shell, Chevron, TotalEnergies) |
| SUN | 3 | 100 | |
| WES | 2 | 100 | |
| CMS-PB | 1 | 100 | |
| CTA-PA | 1 | 10 | |
| BXSL | **0** | 100 | |
| MER-PK | **0** | 100 | |
| EP-PC | **0** | 78 | |
| *AAPL (control)* | *100* | — | |
| *KO (control)* | *100* | — | |

**17 of 20 returned a non-empty pool.** The three that returned nothing all
have a PARENT pool, so even there the symbol has news and the *query* missed
it — which is the one case a skip cannot distinguish from "no news exists".

**There is no row on which a skip is the better answer.**

## 5. Two corrections to what #463's PR body claimed

- *"A long quoted phrase returns approximately nothing"* — **false as stated.**
  The genuine-instrument queries return 1–11 items each, not zero.
- *"The cost is 11 wasted fetches rather than wrong content"* — **the cost is
  in fact some wrong content, at low volume.** The instrument pools are largely
  auto-generated content-farm output (`CarePlus VietNam`, `dars.gov.et`,
  `Stock Traders Daily`) keyed on the ticker. Much of it names the ticker
  explicitly, so it clears `isClearlyAboutRequestedCompany`'s explicit-ticker
  branch and is not stopped downstream. PBR-A is the counter-case: its three
  items name other oil majors and are dropped by that filter.

Neither correction changes the verdict — it makes the status quo slightly worse
than advertised, and a skip is still far worse.

## 6. The decision

**`fund-or-note` stays a warning in `gnewsProvider`. No code change to the
skip/warn behaviour.**

The verdict is doing its documented job: the log line is what a manual override
list gets built from, and it now has measured evidence behind it rather than an
assumption. `assessCompanyName`'s comment claiming such names *should never*
reach a query is the half that was wrong, and is corrected in place.

**What this measurement does NOT license.** PARENT is a *diagnostic*, not a
proposed fix. Widening the normaliser to cut the instrument clause would point
a preferred's page at its parent company's news, and two rows show that going
wrong: EP-PC's PARENT `"El Paso"` returns the **food brand** (*"Old El Paso puts
its name on the Sun Bowl"*), and SOJC's `"Southern"` returns Norfolk Southern
and Southern Copper. A preferred is not its issuer, and merging the two is a
separate decision with its own evidence bar.

## 7. The narrower change this evidence would support

Not taken here, because the brief was skip-or-document:

`Units?` and `Preferred` are the two markers doing the false-positive damage —
`Units?` catches every MLP, and `Preferred` catches a bank named "Preferred
Bank". Narrowing those two (e.g. requiring `Preferred` to be adjacent to
`Stock`/`Shares`/`Units`, and exempting `Common Units`) would shrink the 90
toward the population the verdict is actually about, and make the override log
worth reading. That is a change to `assessCompanyName`, measurable by re-running
this same relay task.
