# Gate 0.2 correctness — independent verification, 2026-09-14

Closes item 4 of `claude/ipo-phase0-RESULTS-2026-09-14.md` §5. The Phase 0 run correctly
declined to mark its own homework; this is the second-surface check it asked for. Each range
was verified by locating the filing on EDGAR and reading the prospectus cover, with neutral
prompts that never mentioned the claimed value.

## GATE 0.2 CORRECTNESS: PASS — 5/5

| Company | CIK | Claimed | Filing says | Verdict |
|---|---|---|---|---|
| DEEP FISSION | 1918102 | $16.00–$18.00 | $16.00–$18.00 | **VERIFIED** |
| Eloxx Pharmaceuticals | 1035354 | $10.00–$12.00 | $10.00–$12.00 | **VERIFIED** — *but not an IPO, see §2* |
| Sinda Ltd. | 2096861 | $11.25–$13.25 | $11.25–$13.25 | **VERIFIED** |
| ITG, Inc./DE/ | 2110117 | $19.00–$22.00 | $19.00–$22.00 | **VERIFIED** — *priced at $16.00, see §3* |
| IMC Rare Earths | 2098395 | $4.00–$6.00 | $4.00–$6.00 | **VERIFIED** |

Documents read: `0001104659-26-072286` (S-1/A, 2026-06-10) · `0001193125-26-257750` (S-1/A,
2026-06-04) · `0001140361-26-026259` (S-1/A, 2026-06-24) · `0001193125-26-285598` (S-1/A,
2026-06-26) · `0001493152-26-033155` (F-1/A, 2026-07-14).

**None of the five is a warrant exercise price, a par value, or a unit price.** No `$11.50`
appeared in any of them. Sinda's quarter-dollar endpoints are genuine, not a parsing
artefact. The rebuilt phrase-anchored parser is correct on every case it answered, and the
five basis strings in §1 of the Phase 0 doc accurately reflect their filings.

Three of the five were corroborated against their final 424B4: DEEP FISSION priced at
**$16.00** (low end), Sinda at **$12.00** (inside), IMC at **$5.00** (midpoint).

---

## 2. NEW FINDING — an uplisting is a third contaminant class, and §4.10 does not catch it

**Eloxx Pharmaceuticals is not an IPO.** Its cover states the stock is already quoted on the
OTC Pink Limited Market under `ELOX`; the offering is an **uplisting to Nasdaq Capital
Market**, not a first sale to the public. Phase 0 §2 counts it among the twelve "operating
companies" and among the five genuine ranges.

Note the cover's own wording gives the signal away: it says *"an assumed public offering
price"*, not "anticipated" — the standard construction when a price is struck off an existing
market rather than discovered.

This matters because **neither existing filter catches it**:

- The **already-listed filter** (§4.3a) joins to `company_tickers_exchange.json`. Whether that
  file carries OTC Pink issuers is **unverified** and is the single cheapest check available
  — if `ELOX` is in the map, this filter already catches uplistings and nothing more is
  needed. **Check this before building anything new.**
- The **§4.10 entity filter** targets ETFs and trusts. Eloxx is an operating pharmaceutical
  company; it would pass every entity-type test.

So §4.10 as currently framed is one of *three* exclusion classes, not one:

| Class | Example | Caught by |
|---|---|---|
| Already listed on a major exchange, filing a resale | the 172 | ticker map — **proven, load-bearing** |
| ETF / commodity trust | T. Rowe Price Active Crypto ETF, Morgan Stanley Solana Trust | §4.10 — **to build** |
| **Uplisting from OTC** | **Eloxx (`ELOX`)** | **unknown — check the map first** |

Sizing is unknown: one instance in a twelve-row sample says the class exists, not how big it
is. Worth a count against the 53 before deciding how much machinery it deserves.

## 3. NEW FINDING — a published range can be 27% wrong, which independently supports the 0.1 decision

**ITG's last S-1/A said $19.00–$22.00. The deal priced at $16.00** — below range, confirmed
in the 424B4 (`0001193125-26-292853`, pricing table `$16.00 per share`, ×19,512,196 shares =
$312,195,136). No later amendment revised the range; the only filing between the amendment
and pricing was the 8-A12B.

This is §4.5 of the brief (*"a published range is not a published price"*) appearing as a
measured instance rather than a caveat, and it is **larger than §4.5 implies** — Apnimed
priced $16.00 against a $14–$16 range, i.e. at the top. ITG missed its range low by
**20–27%**.

**Read as evidence for the 0.1 FAIL decision, not merely alongside it.** A price-range column
would have displayed $19–$22 for a deal that sold at $16.00, with nothing in the pipeline to
correct it and no way for the page to know it was wrong. Dropping the column removes a class
of confidently-wrong output, which is the same reasoning the strict CSV parser earned its
keep on.

## 4. Two smaller notes for the build

- **A CIK with filing history is not proof of prior listing.** DEEP FISSION's CIK 1918102 was
  formerly *Surfside Acquisition Inc.*, a shell filing 10-Qs through 2023. Its June 2026
  offering is a genuine underwritten IPO of newly issued stock — cover states no established
  trading market has ever existed. Any "has prior filings ⇒ already listed" heuristic would
  wrongly exclude it. The ticker-map join is the correct test; filing history is not.
- **Name collisions are real.** `ITG, Inc./DE/` (CIK 2110117) is a new registrant and is
  **not** Investment Technology Group (CIK 920424, acquired by Virtu in 2019). Join on CIK,
  never on name.

## 5. Method, and one tooling warning worth carrying

EDGAR's `cgi-bin/browse-edgar` company search is **disallowed by robots.txt** and was refused
on every attempt. Filings were located via EDGAR full-text search and every accession number
then confirmed against the static `/Archives/edgar/data/<cik>/` directory listings and
`-index-headers.html` pages, which carry authoritative form type, filing date, filer name and
SIC code. That static path is the reliable one for the build.

**Do not let a language model summarise `data.sec.gov/submissions/CIK*.json`.** A summarised
read of CIK 1918102's submissions returned fabricated accession numbers and asserted an
8-A12B in 2023; the accession it named turned out to be a 10-Q from the predecessor shell.
Parse that file; never paraphrase it. Every range above was confirmed by reading the filing
document itself.

---

*Verified independently of the Phase 0 run, 2026-09-14, against primary filings on EDGAR.*
