# The calibration measured a tree that no longer exists

You break the code deliberately, run the harness, and it goes red exactly as it
should. You restore, commit, and report the number. The number is **true** — of
a working tree that stopped existing somewhere between the run and the commit.

This is not a measurement error. The harness was right, the mutation was right,
the count was right. What was wrong is *which artifact the count describes*, and
nothing downstream can catch that, because the figure is true of something. A
reviewer reading the PR sees a plausible number. A reviewer reading the branch
sees different code. Only someone who does both notices.

Happened five times in one day on this repo, and once the result was reported to
the owner as evidence for a fix that was not in the pushed commit.

## The mechanism

The calibration loop looked like this:

```bash
cal() { node scripts/check-thing.mjs | grep -c FAIL; git checkout -- .; }
mutate_something
cal "deliberate break"
```

`git checkout -- .` does not undo "the mutation". It reverts **every tracked
file to HEAD**, which is the mutation *and* whatever else was uncommitted — the
fix being calibrated, a harness edit made minutes earlier, an unrelated file
touched in the same turn. Then:

```
git add -A && git commit --amend --no-edit   # amends nothing; tree already == HEAD
git push --force-with-lease                  # succeeds, pushes the unchanged commit
```

Every step reports success. `--amend --no-edit` on an unchanged tree is a no-op
that exits 0. The force-push prints `+ abc123...def456 (forced update)` whether
or not anything moved. The harness still passes, because the code it passed
against is the code that was there before the fix.

## The second mode, which is the opposite and worse

`git checkout -- .` **does not touch untracked files.**

So in a loop where one of the mutated files is new — a harness being written, a
module being added — the restore silently skips it. The mutation stays. Every
subsequent iteration then runs against a poisoned tree, and the results look
*calm*: on this repo, three consecutive mutations reported `ALL CHECKS PASSED`
because the matcher was still mutated and the harness had been reverted to a
version that did not test it. Three green results, all meaningless, none of them
alarming.

Green is the dangerous direction. A red result gets investigated; a green one
gets believed.

## The tells

Any of these means the tree moved under you. None of them is an error:

- `git commit --amend` printing **`nothing to commit, working tree clean`**.
- `--amend --no-edit` completing instantly on a tree you know you just edited.
- A force-push whose `git log -p` afterwards shows none of the change you made.
- `git status` clean immediately after a `checkout -- .` you expected to leave
  your own work in place.
- A calibration where the *first* mutation behaves and later ones all pass. That
  is the untracked-file mode, and it reads as "the checks are robust".

## The rule

**1. Commit before calibrating, never after.** The baseline being calibrated
must already be in a commit. Then the mutation is the only uncommitted thing in
the tree, and there is nothing else for a restore to take.

**2. Restore from a copy outside git's reach.**

```bash
cp lib/server/thing.ts "$SCRATCH/thing.orig"
mutate
node scripts/check-thing.mjs | grep -c FAIL
cp "$SCRATCH/thing.orig" lib/server/thing.ts     # not: git checkout -- .
```

A file copy restores exactly what was there, tracked or not, and cannot reach
past the files you named.

**3. Never `git checkout` to undo a deliberate break.** Not `-- .`, not
`-- path/to/file`. The single-file form has the same failure at smaller scale
and is more tempting because it looks careful.

**4. Verify the artifact, not the working tree.** After pushing, read the pushed
commit — `git log --oneline origin/main..HEAD`, `git show --stat`, or the diff
on the PR. The claim in a PR body is about what is *in the branch*, and the only
way to know that is to look at the branch.

## Why this one is load-bearing

A large part of this repo's confidence rests on the calibration convention: a
check is only trusted once a deliberate break has been shown to make it fail,
because *a check never proven to fire is indistinguishable from a dead one*.
That convention is exactly as good as the guarantee that the break, the run and
the commit all describe the same tree.

Break that guarantee and the convention inverts. It stops being evidence and
becomes a ritual that produces confident numbers about code nobody shipped —
which is worse than not calibrating at all, because an uncalibrated check is
merely unproven, while a falsely-calibrated one has been vouched for.

## Related

- `a-regex-over-source-has-no-scope.md` — the harness measures less than it
  claims. Different failure: there the *number* is wrong. Here the number is
  right and the *subject* is wrong.
- `absence-needs-the-producer-to-have-run.md` — the untracked-file mode is that
  trap wearing a different hat: three passing runs that never exercised the
  thing they were named for.
