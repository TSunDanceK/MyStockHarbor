# When ABSENCE is the evidence, prove the producer ran

`return-type-cannot-express-failure` inverted, and harder to catch.

A check whose passing condition is *"X is not there"* cannot distinguish between
**X is genuinely gone** and **the thing that would have produced X never ran**.
Both return zero. A false positive at least shows you something to be suspicious
of; a false *negative* shows you nothing at all, which is exactly what you were
hoping for.

Caught mid-PR while verifying that a retired route had stopped being built:

```bash
grep -c "recently-added-to-index" build.log   # => 0
#   "0 occurrences — route no longer exists"
```

The count was real. The build had exited **127** — `node_modules` had vanished
to a container recycle, so `next build` never ran and `build.log` held a
`command not found` message and nothing else. Every route was "absent". The
grep was measuring an empty file and reporting it as a clean result, and it was
one step from going into a PR body as evidence.

**The rule: before believing an absence, prove the producer succeeded.** Check
the exit code, or assert on something that *must* be present in a healthy run:

```bash
grep -q "Compiled successfully" build.log \
  && ! grep -q "recently-added-to-index" build.log
```

The second clause is the finding; the first is what makes it mean anything.

The same shape appears wherever a negative is the result — no errors in a log
that was never written, no failing tests in a suite that did not start, no
`[degraded]` lines from a page that was never prerendered (which is how a
green build was briefly mistaken for a fix in #304). Every one of those reads
as success and is indistinguishable from a no-op.
