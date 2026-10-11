# Two validators for one value

Duplicating a validation function is not a duplication problem, it is a
**correctness** problem, and it fails in the quietest way available: the two
copies agree on every input anyone thinks to try, and disagree only on the
inputs nobody tests.

### The instance

`/dashboard` resolves its symbol on both sides of the wire. The server uses
`cleanSymbolParam()` in `app/dashboard/page.tsx`; the client got
`cleanClientSymbol()` in `app/components/DashboardClient.tsx` (#296), so the
URL could win over the remembered symbol before hydration instead of after.

Those two functions **must** agree on every input. Where they disagree, the
server renders one symbol and the client immediately renders another — which
is precisely the deep-link flash #296 exists to remove, reappearing for a
narrow set of inputs and therefore much harder to notice than the original.

The first draft of the client copy diverged on exactly that axis:

| input | server (`cleanSymbolParam`) | first-draft client | result |
|---|---|---|---|
| `NVDA` | `NVDA` | `NVDA` | agree |
| `nvda` | `NVDA` | `NVDA` | agree |
| `NVDA!` | `NVDA` (**strips**) | `""` (**rejects**) | **flash returns** |

The server *strips* disallowed characters; the draft client *rejected* the
whole string. Every ordinary ticker agreed. Only punctuation exposed it. It
was caught before pushing by diffing the two implementations across 15
deliberately awkward inputs rather than by reading them.

### Why a comment is not a fix

Both functions carry a comment saying an edit to one must be made to the
other. That is a **warning, not a guarantee** — it works only for as long as
whoever edits one happens to read it, which is exactly the assumption that
fails during a hurried change six months later.

The real fix is the same shape as `feedCache`: **export one function and
import it on both sides**, so divergence becomes impossible rather than
discouraged. Make the wrong thing unrepresentable instead of documented.

### The general rule

**Any value validated on both the server and the client must be validated by
one shared function.** If a value crosses the wire and both sides normalise
it, that normalisation is a single piece of logic with two call sites, never
two pieces of logic that are meant to match.

Symptoms, when it goes wrong: content that flashes and corrects itself, a
hydration mismatch on some inputs but not others, or a value that "works
everywhere except one weird ticker". None of them point at the validator,
which is what makes this expensive to debug.

---

## Instance, 2026-09-21: two filing-deadline tables, and the second one was wrong

Found while reconciling the /earnings-calendar v1 build against `main`. It is
worth recording because it breaks the comforting assumption in the section
above — that the two copies *start* identical and drift. **These never agreed.
The second was born wrong, and it was the newer one.**

`lib/server/secReportDates.ts` (#472) owns the statutory deadlines as a table
keyed by filer category, covering both periodic report types:

```
                        10-Q    10-K
large accelerated        40      60
accelerated              40      75
non-accelerated          45      90
```

`lib/server/dueToReport.ts` (stage 2b, written later) carried its own:
`DEADLINE_LARGE_ACCELERATED_DAYS = 40`, `DEADLINE_OTHER_DAYS = 45`, selected
by a boolean `largeAccelerated`. Against 17 CFR 240.13a-1 / 13a-13 that is
**wrong in two of the six cells**:

- an **accelerated** filer files its 10-Q in **40** days, not 45. Only the
  non-accelerated tier gets 45. The boolean collapsed two tiers that differ.
- there was **no annual concept at all**, so a 10-K period was capped at 40 or
  45 days instead of 60/75/90. A punctual annual filer could be dropped from
  the strip up to **50 days before its own statutory deadline**.

### What made it survive review

Both numbers were *plausible* and one of them was *right*. 40/45 is a real
pair that appears in the rules, so the constants read as researched. What they
were missing was a dimension, not a digit — and a missing dimension does not
look like an error at the call site, it looks like a simpler API.

### The tell that a reviewer can actually use

**Two modules, both naming a statute in their comments.** Where two files
independently cite the same regulation, they are two readings of one source of
truth, and one of them is stale or partial by construction. Grep for the
citation, not for the constant — the constant is what differs.

### A consolidation can consume a safety margin silently

`dueToReport` deliberately omitted an attribution-horizon clause because its
widest cap, 45 + 30 = 75 days, sat far inside the 120-day horizon, making the
clause unreachable. Adopting the correct table moved the widest cap to the
non-accelerated annual cell: **90 + 30 = 120, exactly the horizon.**

No gap opened — the two now meet precisely — but the margin went from 45 days
to zero, and nothing about the consolidation announced that. The check was
changed from an inequality to an **equality** so that any future widening of
either number, in either module, fails loudly rather than opening a window in
which a symbol sits in the strip that attribution can never clear.

**Deduplicating is a behaviour change.** The surviving copy's values become
live on every call site the deleted copy served, including the ones whose
invariants were only true under the wrong numbers.
