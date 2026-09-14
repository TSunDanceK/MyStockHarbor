# Taxonomy and SIC mapping (brief)

> **Provenance.** The authoritative document is the Claude Project copy of the
> same name. This repo mirror was **written from the owner's summary, not copied
> from the original**, which is Project-only and not visible from a coding
> session. Where the two differ, **the Project copy wins** and this file should
> be re-synced. Mirrored per `CLAUDE.md`'s "Where the automation docs live".

**Enumeration, which was blocking:** done —
`claude/taxonomy-enumeration-2026-09-14.md`, reference file `data/taxonomy.json`.

## Owner decisions

1. **The 11 sectors in `lib/sectors.ts` do not change.** They are URL slugs, nav
   and sitemap. FMP only *populates* them.
2. **Resolution order becomes:** live cache → screener cache → static snapshot →
   **SIC** → unclassified. The SIC leg does not exist yet; nothing in the repo
   reads `sic` or `sicDescription`.
3. **Every SIC code must map**, or the symbol lands in an explicit **reported**
   unclassified bucket. `sectorUniverse.ts` already carries classified/total
   counts for exactly this reason; the SIC leg inherits that rule.
4. **Industries: carry both labels with provenance**, rather than mapping SIC
   onto FMP's vocabulary. Present the coarser label plainly rather than dressing
   it as the finer one.

## Do this before anything writes labels

Add **`sectorSource` / `industrySource`** to the profile record.

There is no conditional check on the SEC payloads, so a field added later means
re-reading the universe to backfill it — the same argument as the stored field
list in the step-3 brief (`claude/step3-stored-field-list-2026-09-14.md` §1).

## Not urgent: the mapping table itself

The snapshot covers **2,619 symbols**, so at a 1,500 universe the SIC leg never
renders. It becomes load-bearing as the universe approaches 2,619 — which tracks
the **growth plan**, not the FMP clock.

## Evidence added from the enumeration

### The bare-label families are the strongest argument for decision 4

Measured: **14 head-term families covering 1,143 symbols (44% of coverage)**, and
**two of them contain a bare label alongside qualified siblings** —

```
Banks (2)      beside  Banks - Regional (157)   and  Banks - Diversified (20)
Chemicals (9)  beside  Chemicals - Specialty (35)
```

These are **flat siblings, not a hierarchy.** `Banks` is a peer of
`Banks - Regional`, not its parent. So prefix grouping renders **"Banks (179)"**
— a category present in no data.

And under a map-SIC-onto-FMP approach, **SIC 6022 "State Commercial Banks" has no
defensible target among the three**, and no way to detect a wrong choice later:
every one of the three is a plausible-looking destination, and a symbol filed
under the wrong one renders as a normal category page. **That is an unfalsifiable
mapping over 179 symbols** — the same failure shape as the four traps in the
step-3 brief, where the wrong answer is indistinguishable from the right one at
the point of writing.

Carrying both labels with provenance avoids the choice entirely: the SIC label
and the FMP label each say what they are, and `sectorSource`/`industrySource`
records which one a page is showing.

### SIC is a SECOND OPINION, not only a fallback

Decision 2 lists SIC as the fourth leg of the resolution chain — used when the
first three have nothing. **It should also run where they do have something.**

`Media & Entertainment` (1 symbol, LION — Lionsgate) is filed under sector
**Technology** while all 43 other media-adjacent symbols are under Communication
Services. That is a **sector-column** error, and neither remedy on the table
reaches it: an industry alias map operates on the wrong column, and a per-symbol
override list is the hand-edit vector this brief already rules out.

SIC classifies Lionsgate **independently of the snapshot**. So where the
snapshot's sector and the SIC-derived sector **disagree**, that is a candidate
error in one of them —

- **countable** (a number, tracked over time, not an anecdote),
- **auditable** (each disagreement names two sources and a symbol),
- **generated rather than maintained** (no list for anyone to keep current).

LION surfaces in that diff without anyone having to spot it.

**And this is the part that decides it is standing rather than a one-off audit:**

> LION was findable **only because its industry label happened to be a
> singleton.** A symbol misfiled inside `Software - Application` leaves no trace
> of that kind.

That is **not an argument for a better audit.** It is the argument that **no
audit finds this class of error**, and only a standing generated diff does. The
tail enumeration found LION by accident of label size — 121 symbols sit under
`Software - Application` and a wrong sector on any one of them produces no
singleton, no anomaly, and nothing for a reviewer to notice. The 43 correctly
filed media symbols were only visible *as a comparison group* because the wrong
one had been isolated first.

A recurring diff needs no one to suspect anything. That is the whole difference.

**This does not change decision 1.** The 11 sectors are fixed; SIC produces a
*disagreement report*, not an override. What is done about each disagreement is a
separate decision, and defaulting to "SIC wins" would be the same unfalsifiable
mapping the bare-label families argue against.

### Separators, and why exact match is scoped

**87 of 144 labels (60%) carry `-`, `&` or `,`**, covering **1,601 of 2,619
symbols.** A separator-splitting rule misfires on the majority of the taxonomy,
not on an edge case — and a rule written against `-` and `&` alone misses five
comma-bearing labels.

**Exact match is right for IDENTITY and wrong for DISCOVERY.** The art mapping,
the SIC table and the stored value must match exactly. User-facing search must
not: `screenerFields.ts` says industry is "the one people actually search for —
'semiconductor'", so `semiconductor` must match `Semiconductors` and `bank` must
surface all three bank labels. Full statement in
`claude/taxonomy-enumeration-2026-09-14.md` §4.

### The flat-filter problem is answered by the 1:1 verification

The check measured that **no industry appears under more than one sector**. That
makes the screener's industry filter **two-level — sector → industry, ~13 per
sector — rather than a flat 144.**

So "68 labels returning ≤10 symbols" stops being an affordance problem: nobody
sees all 144 at once. The conclusion falls directly out of the check rather than
being a design preference, and it is asserted, so if industry ever stops implying
sector the two-level filter's precondition fails loudly instead of quietly
rendering a symbol under two parents.

### Folding: an alias map at resolution, never a hand-edit

**Do not hand-edit `data/taxonomy.json` or the snapshot.** This repo already
records hand-editing a data file as the vector — the committed ticker file
carried a stray `#` at byte 0 and was unparseable until one byte was removed.
`data/taxonomy.json` is generated; editing it is overwritten by the next
`build-taxonomy-reference.mjs` run, and editing the snapshot destroys the record
of what the provider actually said.

The pattern already exists one layer up: **`lib/sectors.ts` carries an `aliases`
table** so "Health Care" folds onto the `healthcare` slug without touching data.
The industry equivalent is the same shape:

- a **recorded, checked alias map**, applied at **resolution**;
- the **raw value preserved** in the record, so provenance survives and the fold
  is reversible;
- covered by a check, so an alias whose target stops existing fails loudly.

The tail is the evidence it is needed —
`claude/taxonomy-tail-audit-2026-09-14.md`. **Not built yet**: the audit is
report-only by instruction, and the map should be populated from a reviewed fold
list rather than from my reading of it. Two of the sixteen labels are not fold
candidates at all (a sector error and a universe-composition question), so the
alias map is not the whole remedy either.

### Sizing, for the unclassified bucket and any per-industry asset

**Half of all symbols sit in the top 22 labels (15% of them); 68 of 144 labels
hold ≤10 symbols and cover 14.5%.** The ≤3 band is 16 labels / 30 symbols /
**1.1% of coverage**.

**But rank the tail by WEIGHT, not count.** `Home Improvement` holds three
symbols — two of which are **Home Depot and Lowe's**. By symbol count it is in
the smallest decile; by any measure a reader would recognise it is one of the
largest categories on the site. A count-based floor would have folded it, and the
only reason that did not happen is that the audit listed the symbols rather than
trusting the number.

The frozen dump carries `history-bars.ndjson.gz`, so **mean daily dollar volume is
computable per label** — the same weighting `scripts/listing-split.mjs` already
applies to the venue split, where it changed a 32.9%-by-count answer into a
62.5%-by-dollar-volume one. Any size floor should be weighted the same way, and
the machinery exists.

`claude/taxonomy-tail-audit-2026-09-14.md` is the worked example: of 16 labels in
the ≤3 band, four survived inspection as genuinely distinct.
