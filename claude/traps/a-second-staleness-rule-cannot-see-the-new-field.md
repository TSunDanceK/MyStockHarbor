# A second staleness rule cannot see the new field

A staleness predicate copied into a second call site does not fail when it is
written. It fails the next time a **new** staleness reason is added, because the
author adds it to the canonical rule and never learns the copy exists. The copy
then reports "current" forever for exactly the sets the new reason was invented
to select — and a cache that answers "current" is indistinguishable, from the
outside, from a cache that is genuinely up to date.

`lib/server/secStaleness.ts` already says this in its own docblock:

> That is how the rewindow migration nearly shipped with two staleness
> predicates that agreed on the day they were written.

It did not nearly ship. A second one was already there.

### The instance

`needsReread` gates on four fields: `w` (quarter window), `y` (year window),
`lv` (labelling **and admission**) and `c` (tag chains). The cron uses it.

`resolveFactSetForRender` in `lib/server/secColdFetch.ts` did not. It hand-rolled
one field:

```ts
if (SEC_UA && stored.c !== secChainsHash()) {
  const retried = await retryEmpty(clean, cik);
```

That was correct when written — the only reason an empty set was worth retrying
was a tag-chain edit. Then currency admission (#479) bumped `SEC_LABEL_VERSION`
3 → 4 and touched **no tag chain**, because admitting a filer's own currency
adds no tag. So `secChainsHash()` was unchanged, every cached empty set compared
equal, and the retry never fired.

The visible result: RYAAY and ABEV kept serving the old "reports in EUR / reports
in BRL" block, across reloads, on a deployment whose code could read them
perfectly. Nothing was broken at the point anyone was looking. The render path
simply never asked SEC again.

### Why it was invisible

Three things hid it, and each is reusable elsewhere:

1. **The symptom pointed at the wrong layer.** The page said "reports in EUR",
   which is a statement about currency handling, so the first two hypotheses
   were both about currency handling — the detection rule and the rate series.
   Both were worth testing. Neither was this.
2. **A reload does not invalidate a decision not to fetch.** "I checked after a
   reload" rules out a first-load race and rules in nothing else.
3. **One of the three filers worked.** CNI rendered correctly throughout, which
   reads as evidence the pipeline is sound and the other two are special. It was
   evidence of nothing except that CNI's cached set differed.

### The rule

A cache-invalidation predicate has exactly one home. Where a second call site
needs a narrower question than the canonical rule answers, it composes the
canonical rule — `needsReread(stored) && stored.quarters.length === 0` — rather
than reimplementing the part it cares about. The narrowing is the local
decision; the definition of "behind" is not.

Stated as a test you can apply to a diff: **if you add a field to a staleness
type, grep for every other comparison against the fields already in it.** A
call site comparing one of them by hand is a call site that will not see yours.

### Related

- `claude/traps/two-validators-for-one-value.md` — the same shape for
  validation rather than invalidation.
- `lib/server/secStaleness.ts` — the canonical rule, and the "absent must
  select, never skip" reasoning that makes a hand-rolled copy especially
  dangerous: every field was added **after** sets were already being written,
  so the entries most in need of selection are the ones with no value for it.
