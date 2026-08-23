# A regex over source has no scope unless you give it one

A harness greps a whole file for a pattern and reports the code is correct. The
pattern is real and it matched — somewhere else. The check passes while
measuring less than it claims, and nothing about a green run says which.

This has now bitten twice in two days. Both times the harness was written
carefully, both times it passed, and both times only the deliberate break
exposed it.

## The two cases

**A comment satisfied a security assertion.**
`scripts/check-cache-health-page.mjs` comment-stripped the page it was auditing,
then read `lib/server/backfillAuth.ts` **raw**. The assertion
`/CACHE_HEALTH_KEY/.test(auth)` was satisfied by the comment on
`backfillAuth.ts:79` explaining what the key is for. Pointing the actual read at
`EARNINGS_BACKFILL_KEY` — sharing the credential that authorises FMP spend, the
single thing the spec forbids most emphatically — left **all 33 checks passing**.
Eight more raw reads sat behind the same mistake.

**One regex covered two hops.**
In `scripts/check-pricepool-ohlc.mjs`, `open: num(row.open)` appears
byte-identically in `fetchStableQuote` (reading FMP's response) and in
`readPricePoolBulk` (parsing our own Redis row). One regex over the file was
satisfied by whichever survived. Deleting the write side — the entire point of
the change — failed **one** check instead of four; the read side's copy kept the
other three green.

## Why it is hard to see

The check is not wrong about the file. It is wrong about *where in the file*,
and a regex has nothing to say about that. `test(src)` answers "does this string
occur", and the question you meant was "does this string occur **in the thing I
am asserting about**". Those differ silently and only ever in the passing
direction, because a wider search finds strictly more.

It compounds with the two ordinary sources of false matches:

- **Comments.** Prose about code reads exactly like code to a regex — that is
  `grep-finds-the-comment-not-the-code.md`, one level down.
- **Repetition.** The same three-line shape appears at every hop of a pipeline.
  That is what makes hop-by-hop plumbing checks worth writing, and also what
  makes them alias.

## The rule

**Extract the region first, then match within it.**

```js
// Not this — no scope, matches anywhere in the file:
check("read off the quote", /open: num\(row\.open\)/.test(src));

// This — the function's own body, and nothing else:
const quoteFn = extractFunction(src, "fetchStableQuote");
const readFn  = extractFunction(src, "readPricePoolBulk");
check("read off the quote", /open: num\(row\.open\)/.test(quoteFn));
check("parsed back on read", /open: num\(row\.open\)/.test(readFn));
```

Three parts, all of them necessary:

1. **Extract by AST where the shape allows it.** The TypeScript compiler API is
   already a dependency of every harness in `scripts/`; `ts.isFunctionDeclaration`
   plus `node.getText()` is a few lines and gives real boundaries. String slicing
   between markers works too, and is fine — but see 2.

2. **Assert the regions are disjoint.** An extraction that silently returned the
   whole file, or overlapping halves, restores the original bug while looking
   like the fix. One line:

   ```js
   check(
     "the two scopes really are distinct",
     a.length > 0 && b.length > 0 && !a.includes(bMarker) && !b.includes(aMarker)
   );
   ```

3. **Strip comments from EVERY file you read, not just the one you were
   thinking about.** The first case above stripped the page and read three other
   sources raw. A checker that reads one source carefully and the rest casually
   is only as good as its most casual read.

And the check that catches all three when they are wrong anyway:

**Break it deliberately and count the failures.** Not "does it go red" — *how
red*. A mutation that removes one of four asserted hops should fail four checks.
Failing one is the signal that three assertions are aliased onto something else.
Both cases here were found that way and by nothing else.

## Its mirror image: what the strip LEAVES BEHIND

This doc is about a regex matching more than you scoped it to. The same
machinery fails the opposite way too, and that half is worse because it fails
green: a comment stripper that removes **too little** leaves prose in the text,
so an assertion about the code is satisfied by the comment about the code — the
original `grep-finds-the-comment-not-the-code.md` trap, sitting inside the
machinery built to close it.

That is not hypothetical here. Every comment-stripped assertion across sixteen
harnesses could have been satisfied by a **trailing** comment
(`const x = 1; // we no longer call legacyThing`), for as long as those harnesses
have existed, because `ts.getLeadingCommentRanges` deliberately excludes
same-line comments and nothing collected the trailing ones. Found 2026-08-23.

The lesson to carry across: **a stripper's omissions are as dangerous as a
regex's over-matching, and only one of the two is loud.** Written up in
`a-strippers-omissions-fail-green.md`, along with why a size threshold cannot
catch either.

## Where it does not apply

Asserting **absence** — that a symbol appears nowhere, that a dead path is
gone — is a whole-file question and should stay one. Scoping an absence check to
a function would let the thing reappear one line outside it. The rule is for
presence claims: those are always about a place.
