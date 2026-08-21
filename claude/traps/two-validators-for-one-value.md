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
