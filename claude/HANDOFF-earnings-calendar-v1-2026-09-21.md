# HANDOFF — /earnings-calendar v1, 2026-09-21

Supersedes `claude/HANDOFF-earnings-calendar-v1-2026-09-17.md` for stage state and next
steps. That doc's owner-action background (why the freeze mattered, why FPI market cap
needed a veto) is still accurate history; its stage table and "next, in order" list are
stale — this replaces both. Build spec
`claude/BUILD-BRIEF-earnings-calendar-v1-2026-09-15.md` and the whole-market bars spec
`claude/dashboard-off-fmp-scoping-2026-09-12.md` are both mirrored verbatim in this repo's
`claude/` folder, so a session doesn't need either pasted into context again.

## Decisions made since the 09-17 handoff (all owner-confirmed)

1. **Consensus freeze: committed.** `data/consensus/fmp-consensus-freeze.json` (5,519,554
   bytes) landed via `.github/workflows/consensus-freeze-commit.yml`, since the sandbox
   cannot reach the relay artifact blob host directly. This was the one irreversible item
   in the build — done, no longer time-sensitive.

2. **FPI market cap: decided** — suppress for HDB, IBN, TSM, BABA, ASML (stay in the list,
   sort last under nulls-last, no market cap shown rather than a wrong shares times price
   number). Implemented and merged in PR #489. P/E suppression for the same five symbols
   decided 2026-09-21 after confirming the same ADS/ordinary-share unit mismatch affects
   it; implemented in PR #491 after verifying per-filer conventions against SEC data
   directly (four of five confirmed defective by measurement — HDB, TSM, BABA, ASML — IBN
   publishes no XBRL at all so its suppression is currently vacuous but kept for when it
   might).

3. **PR #459 split: done.** #483 (failure-handling fixes) and #485 (a relay-registration
   gap #483's own split introduced) both merged. The v1 build continued as #484.

4. **Report-date reconciliation: done and merged** (#484, squashed as `2981e09`). Stage 1's
   parallel date computation (`secResultsDate.ts`) is deleted entirely. The manifest and
   the earnings-calendar page now read `secReportDatesStore` — the same store the live
   stock page already used via #472 — as the single source of truth. Along the way: the SEC
   filing-deadline table was corrected in the shared store (accelerated filers get 40 days
   for a 10-Q too, not lumped with non-accelerated at 45; an annual concept — 60/75/90 days
   by filer tier — was added where none existed before), verified against 17 CFR
   240.13a-1/13a-13. `MAX_ATTRIBUTION_DAYS` and `MAX_PERIOD_TO_ANNOUNCEMENT_DAYS`
   consolidated to one constant (120 days), now asserted as an equality so future widening
   on either side fails loudly. The 9.01-alongside-2.02 exhibit preference was restored in
   `secReportDates.ts` but narrowed to a tie-break only, since porting it literally would
   let a later 8-K/A override "earliest wins" and silently move `announcedOn`, which feeds
   the live stock page's price-reaction card. A real regression in
   `check-earnings-failure-not-absence.mjs` (introduced by #483 — a hand-rolled
   comment-stripper letting its own negative assertions pass vacuously) was found and fixed
   in the same PR.

5. **Failure-vs-absence bug at the page level: found and fixed in PR #491.** `page.tsx` was
   testing a bare `dayData.usListedCount > 0` instead of consuming
   `FullDayEarnings.complete` (set false by #483's own failure detection) — meaning a day
   where SEC's API failed and a genuinely quiet day rendered identically, undoing what #483
   was built to fix. Now wired through a proper state resolver with a call-site check so
   this can't regress silently again.

6. **Page cutover: decided** — v1 replaces `/earnings-calendar` in place when it's ready,
   relying on the due-strip state resolver for graceful degradation. Not yet built.

7. **Whole-market bars migration and dynamic top-50 (stage 5): CLOSED, 2026-09-21.** No
   budget for a paid data source (Tiingo etc. explicitly declined 2026-09-12); the free
   route (Stooq) is confirmed fully dead, not merely licence-ambiguous. This is not a
   deferral — neither is being built. Stage 4 (price + market cap) instead builds against
   the current 700-symbol analysis universe's existing bar source only; any company in the
   confirmed grid outside that universe has its price/market-cap cells **hidden** (not
   shown as absent/dash), matching the existing house pattern for lost-source columns
   (Forward PE, the Analysts tab). The due-to-report strip's static top-50 list (brief
   section 6) is now **permanent**, not an interim v1 simplification.

8. **Shared-CIK security-kind classification (the MER-PK / Bank of America bug): confirmed
   2026-09-21 as a live correctness bug** — MER-PK and 15 other securities share BAC's CIK
   `0000070858`, and SEC's own `name` field for MER-PK is literally "BANK OF AMERICA CORP
   /DE/", so the ticker map alone cannot distinguish them. A new module classifies security
   kind by **positive matching** on debt/preferred/warrant/ADR wording in the Nasdaq
   Security Name (`data/company-names.json`), never by residual exclusion — the existing
   `classifySecurityName` (built for news-suppression, "is this common stock") was measured
   against this population and found to wrongly exclude real operating companies with
   unusual name wording (ET, MPLX, BEP, BIP as LP units; ASML, BN as unrecognized wording).
   In-universe coverage is 100% (12/12 shared-CIK members in the 700-symbol analysis
   universe are named and classify correctly). Off-universe, 2,285 of 2,764 shared-CIK
   symbols have no verifiable security name at all — **decided 2026-09-21 to refuse
   rendering for these too (fail closed)** rather than the narrower fix of only blocking the
   75 confirmed derivatives, since an unverifiable security sharing another company's CIK is
   exactly the same live-wrong-render risk as MER-PK itself.

## FINAL STATE (2026-09-21, end of build)

**Everything in this build is done and live EXCEPT the due strip, which is
BLOCKED on a production data gap outside this build's scope — not on anything
left to build here.**

That distinction is the point, and it is the same one the build spent itself
enforcing elsewhere: the strip is not unbuilt, and it is not broken. Its code
path exists, is tested and works. It has nothing to render.

### Done and live

| Stage | State |
|---|---|
| **0** Consensus freeze | committed via workflow |
| **1** Results date | reconciled onto `secReportDatesStore`; `secResultsDate.ts` deleted (#484) |
| **2a** Window inverted | done |
| **2b** Due rule | done, deadline table corrected against 17 CFR 240.13a-1 |
| **3** Year-ago columns | superseded — #464/#467/#472/#479/#482 landed the extraction |
| **4** Price + market cap | **done**, revised scope — five refusal/hide reasons, below |
| **5** Dynamic top-50 | **closed**, will not be built |
| **Page cutover** | **done and live** — H1, description, grid, five-reason composition (#501) |
| **Security-kind (MER-PK)** | **done and live** — `/stock/MER-PK/earnings` no longer renders Bank of America (#495) |

### The five reasons a price or market cap is withheld

Four are refusals about a figure we have, and they form a precedence ladder
asserted in `check-sec-valuation` §8. The fifth is not a fifth tier and is
asserted separately, because it says there is nothing to refuse.

| Reason | PR | Gates at |
|---|---|---|
| security-kind | #495 | `resolveFactSetForRender`, before the store read |
| FPI / ADS unit | #489, #491 | `marketCap()` / `peRatio()`, first |
| staleness | #497 | `valuationInputs`, after the chain |
| weighted-average tag | #500 | in the chain — never becomes a count |
| **universe coverage** | #501 | `earningsCalendar` item assembly — *not* a refusal |

### BLOCKED: the due strip

Its three parts, and which is actually stuck:

1. **`dueStripState.ts`** — built, tested, 8/8 mutants. **Works.**
2. **`selectDue()`** — built. **But nothing constructs a `DueInput`.** The
   producer does not exist; it would read the store per universe symbol and
   supply `medianLagDays`, `filerCategory` and `annual`. A module on the scale
   of `dueStripState` or `securityKind` — its own PR when unblocked.
3. **The static top-50 membership list — THE BLOCKER.** It cannot be generated.
   `scripts/due-strip-universe.mjs` refuses to emit a cap-ranked list that omits
   a canary, and **NVDA has no market cap in any of the four cached sources**.
   Confirmed on a dump minutes old, so it is not staleness.

**See `claude/BRIEF-price-pool-missing-market-cap-2026-09-21.md`.** That is a
Pickers cap-sourcing problem, deliberately opened as its own item rather than
chased from here. It also affects the screener's default sort, which is by
market cap.

**The canary refusing is the build working, not failing.** A list that omitted
the largest company in it is exactly the "plausible and wrong" output this build
spent itself refusing. Do not widen `CUT` or drop NVDA from `CANARIES` to get a
green run.

### What "there is no stage 1 backfill" means

Earlier drafts of this doc and of `dueStripState.ts` said the strip was waiting
on a stage-1 backfill. **That is wrong and has been corrected.** #484 deleted
`secResultsDate.ts`; `lastResultsDate` is not stored — `latestResults()` derives
it from `secReportDatesStore`, written continuously by
`app/api/jobs/sec-facts/route.ts`, a production cron. There is no job to run.

### To finish, in order

1. Resolve the price-pool cap gap (separate brief, separate priority call).
2. Re-run `due-strip-universe` against a fresh step-0 dump; commit the list to
   `data/` with its generation date.
3. Build the `DueInput` producer.
4. Wire the strip; verify cutover requirement (b) against real rendered rows.

Steps 2–4 are ordinary work. **Step 1 is the only unknown.**

---

## State of the build

- **Stage 0** (consensus freeze): done, committed via workflow.
- **Stage 1** (results date): done, reconciled — now reads `secReportDatesStore`;
  `secResultsDate.ts` deleted.
- **Stage 2a** (window inverted): done, prior session.
- **Stage 2b** (due rule): done, deadline logic corrected, superseded by the reconciliation
  above.
- **Stage 2c** (page shell): partially done — due-strip state resolver and copy built and
  tested (`dueStripState.ts`, 19 assertions, 8/8 mutants); H1/description drafted but not
  wired — waiting on the cutover below.
- **Stage 3** (year-ago columns): blocked, still needs step 3 fact sets; check what
  #472/#464/#467/#479/#482 landed before building, may be partly superseded.
- **Stage 4** (price + market cap): blocked, revised scope — build against current
  700-symbol universe only, hide (not dash) for anything outside it; FPI/ADR suppression
  already merged (#489, #491); no whole-market expansion.
- **Stage 5** (dynamic top-50): closed, will not be built.
- **Security-kind classification**: module built and measured (5/5 mutants), wiring pending
  owner go-ahead as of this handoff — resolved 2026-09-21, wire the full refusal, land as
  its own PR.

## What's next, scoped for a fresh session, in order

1. **Wire the security-kind classification fix** (full refusal, both derivative and
   unverifiable branches) into the live render path. This is the current priority — a real,
   live, wrong-answer bug affecting real visitors.
2. **Stage 4** (price + market cap), revised scope per decision 7 above.
3. **Page cutover** — replace `app/earnings-calendar/page.tsx` in place. Write the H1 and
   description now against the "replace in place" decision; the due-strip state resolver
   already handles honest unavailable states for whatever isn't ready yet. Confirm the
   failure-vs-absence fix and the hide-pattern both survive the cutover.

## Standing rules earned this build, cumulative, still apply

- **A green suite is not a green brief** — print every uncovered brief-mutant by name every
  run, and distinguish permanently-inapplicable mutants (roadmap closures) from
  currently-uncovered ones rather than letting the denominator shrink silently.
- **Coverage answers "did the input arrive," not "is the output correct"** — keep canaries
  that refuse to emit rather than shipping a hole silently; the MER-PK fix's "wire the full
  refusal" decision is the latest instance of this same standing preference.
- **Two validators for one fact is a trap** (`claude/traps/two-validators-for-one-value.md`)
  — the report-date reconciliation is the recorded instance; `classifySecurityName` being
  wrongly reused for a different question it wasn't built to answer is a related shape of
  the same trap (using an existing validator for a question it was never measured against).
- **Flag departures** from established practice or from an instruction, rather than
  complying or silently deviating.
- **When a measurement can't judge a case cleanly, extend the check** rather than reporting
  a false negative or guessing — the TSM/IBN IFRS-taxonomy finding and the exchange-field
  case-sensitivity catch are both instances.
- **claude.ai Project docs need to be mirrored verbatim** into this repo's `claude/` folder
  when a session builds against one; a sandbox session with no Project access should get
  them pasted directly into its instructions as plain text, **not inside a single outer code
  fence** if the document itself contains fenced code blocks — that collision truncated this
  same handoff twice before it landed.
