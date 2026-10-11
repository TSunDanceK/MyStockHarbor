# A stripper's omissions fail green

**Class:** verification machinery
**Found:** 2026-08-23, sweeping sixteen harnesses onto one comment stripper (#363)
**Related:** `grep-finds-the-comment-not-the-code.md` (the trap this machinery
exists to close), `a-regex-over-source-has-no-scope.md` (its over-matching
sibling), `measuring-the-wrong-layer.md`

---

## The shape

`grep-finds-the-comment-not-the-code.md` says: strip comments before asserting
anything about source, or the prose describing a bug will satisfy the assertion
about the bug. Sixteen harnesses in this repo do exactly that.

**The stripper itself is then load-bearing, and it can be wrong in two
directions that are not equally visible.**

- It can remove **too much**. Real code disappears from the text.
- It can remove **too little**. Comments survive into the text.

Both are silent, and the second is the original trap, unchanged, sitting inside
the machinery built to prevent it.

## Why removing too much fails green

This is the counter-intuitive half, and it is the one that cost us most.

A strip that eats a region makes **positive** assertions fail loudly — "this
function calls X" goes red because the function is gone. That is survivable;
someone investigates.

It makes **negative** assertions pass:

- "this pattern is gone"
- "nothing here imports X"
- "there is no second copy of this constant"
- "no write path is gated on `!forceRefresh`"

*Nothing appears in text that was deleted.* Every one of those goes green, for
the worst possible reason, and negative assertions are disproportionately the
ones guarding against regressions.

The concrete instance: `lib/server/historyCache.ts` sends an `Accept` header
containing `*/*`. To

```js
src.replace(/\/\*[\s\S]*?\*\//g, "")
```

that `*/` closes whatever block comment came before it and the following `/*`
opens a new one. The strip deleted 12,773 of 40,647 characters — a third of the
file — and every negative assertion made against the remainder was vacuous.

## Why removing too little is worse than it sounds

`ts.getLeadingCommentRanges` **deliberately excludes** a comment that sits on the
same line as preceding code. That is what `getTrailingCommentRanges` is for. A
stripper that collects only leading ranges leaves every

```ts
const x = computeThing(); // we do NOT call legacyThing here any more
```

in the text — so an assertion asking whether the code still calls `legacyThing`
is satisfied by the comment saying it does not.

That gap was open across all sixteen harnesses for as long as they have existed.
Not one of them noticed, because the failure is that a check passes.

## Why it survived so long

Three reinforcing reasons, and all three are general:

1. **The subject and the instrument were never separated.** Each harness read
   its subject through its own copy of the stripper. Nothing ever asked the
   stripper what it had done.

2. **The fixtures were real files, and real files drift.** The assertion
   `"a trailing comment is gone too"` checked that `skipTrivia` was absent from
   stripped `historyCache.ts` — a word that file has never contained. It was
   true no matter what the stripper did. A real-file fixture can go vacuous
   silently; a synthetic one cannot.

3. **The stripper was never calibrated.** Making it a complete no-op failed only
   four checks, none of which named the trailing-comment case.

## What to do

**Guard every strip, independently of the mechanism that did it.** Parse the
source (a different mechanism from the strip), collect identifiers and string
literals — definitionally outside every comment — and require every one to
survive the strip. `scripts/lib/source-code.mjs` does this on every call.

**Count occurrences, not presence.** "Does this name still appear somewhere" is
satisfied by any surviving reference. A 400-character bite out of
`parseFmpHistoricalRows` removed the declaration and left the call site, and a
presence check saw nothing wrong.

**Do not reach for a size threshold.** It is the obvious guard and it does not
work in either direction. The real bug retained **68.6%** of its file, which no
plausible floor rejects; meanwhile `app/stock/[symbol]/layout.tsx` is genuinely
92% comment lines, so a correct strip of it returns 8% and any floor tight
enough to catch the bug cries wolf on the healthy file. Content, not volume.

**Fixture the semantics synthetically.** Write the fixture in the harness, not
in the tree, one marker per semantic: line comment, block comment, **trailing
comment**, JSDoc, a `*/` inside a string literal, a string following a template
literal on the same line. Nothing can edit the subject out from under it. This
is what found the trailing-comment gap; no real-file fixture would have.

**Calibrate the instrument like anything else.** Break the stripper deliberately
and count. A no-op strip should fail many checks; if it fails few, the fixtures
are not asserting what you think.

## The generalisation

Whenever a check reads its subject through a transform — a comment stripper, a
minifier, a formatter, a normaliser, a JSON reshape, a log parser — **the
transform is part of the assertion and needs its own evidence.** An assertion
about text that has been through an unverified filter is an assertion about the
filter.

Ask of any such transform: *if this silently dropped part of its input, which of
my checks would go green?* If the answer is "the ones about things being
absent", that transform needs a guard, not a code review.
