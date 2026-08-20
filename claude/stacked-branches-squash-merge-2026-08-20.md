# Stacked branches + squash-merge = a guaranteed conflict (2026-08-20)

Short version: **squash-merging a parent PR always breaks a stacked child.**
Not sometimes. Always, when both touch the same file. Either stop stacking, or
rebase the child the moment the parent lands.

## What happened

PR #285 (`claude/stock-waterfall-a`) and PR #286 (`claude/stock-waterfall-b`)
both edited `app/stock/[symbol]/StockSymbolPageClient.tsx`. #286 was branched
off #285 because the two changes genuinely overlap and reviewing them as one
diff would have been worse.

#285 was squash-merged as `16bf2afd`. That commit contains A's *content* but
shares no history with A's original commit `70d0ac98`. #286's branch still
carried `70d0ac98`, so retargeting #286 to `main` produced
`mergeable_state: dirty` — git saw two unrelated commits changing the same
lines of a 97KB file.

Nothing was wrong with either PR. This is the mechanical consequence of
squash-merge, and it will recur every time.

## The fix

Rebase the child onto the new `main`, dropping the parent's now-duplicated
commit:

```
git fetch origin main
git checkout -B <child-branch> origin/<child-branch>
git branch -f backup/<child>-prerebase          # local safety ref
git rebase --onto origin/main <parent-original-sha> <child-branch>
git push --force-with-lease -u origin <child-branch>
```

`--onto origin/main <parent-sha>` means "replay everything *after* the parent's
commit onto main", which is exactly what drops the duplicate.

**Then prove the result is child-only**, because a bad rebase is silent:

```
git diff --stat origin/main..HEAD          # expect ONLY the child's files
# and assert the parent's files are untouched:
git diff --quiet origin/main..HEAD -- <each file the parent changed> && echo ok
```

For #286 that meant confirming `app/api/history/route.ts`,
`app/components/PickerTickerSearch.tsx` and
`app/stock/[symbol]/StockTickerJump.tsx` were untouched by the rebased diff,
while still being present in the working tree (via `main`). Both halves matter:
untouched-by-diff proves no duplication, present-in-tree proves nothing was
lost.

Re-run `tsc`, `eslint` and `next build` after the rebase, not just before it.
`--force-with-lease` rather than `--force` so a concurrent push is refused
rather than clobbered. Force-pushing is only acceptable here because these are
Claude-created branches; never on a branch someone else is working from.

## Comparing lint across a rebase

`git stash` / `git checkout <ref> -- .` juggling to get a baseline is
error-prone and silently produced empty output once during this round. Use a
worktree instead — it cannot disturb the branch under test:

```
git worktree add -q --detach /tmp/mainchk origin/main
ln -s "$PWD/node_modules" /tmp/mainchk/node_modules
(cd /tmp/mainchk && "$PWD/node_modules/.bin/eslint" <files>)
git worktree remove --force /tmp/mainchk
```

## Choosing: stack or don't

Stacking is right when the second change is unreviewable without the first.
It costs one rebase per parent merge, which is cheap and mechanical.

Stacking is wrong when the child only *touches* the same file — split the work
so the two PRs edit different files and neither needs the other.

**If you do stack, rebase the child immediately after the parent merges**,
before the branch sits and the reason is forgotten. Do not hand-resolve the
conflict through the GitHub connector: editing a 97KB file through it means
retransmitting all 97KB, and a truncated upload is worse than an unshipped
change. That transport limit is already written up in
`claude/picker-pages-isr-2026-08-20.md`; a conflicted stack is the same trap
wearing a different hat.

## A stacked child cannot always be rebased pre-emptively

Tempting idea: rebase the child onto `main` *before* merging the parent, so the
conflict never happens. **This does not work when the child depends on code the
parent introduces**, and that dependency is easy to miss.

Tested during this round, not assumed: PR #284
(`claude/dashboard-timing-instrumentation`) rebased onto `main` without #283
conflicts on `app/dashboard/page.tsx`, because #284's timing wrappers call
`getInitialNews()` — a function #283 creates. The dependency is real, so the
order is forced: merge #283, then rebase #284.

Check with a throwaway worktree before claiming either way:

```
git worktree add -q --detach /tmp/t <child-branch>
(cd /tmp/t && git rebase --onto origin/main <parent-branch>; \
   git diff --name-only --diff-filter=U; git rebase --abort)
git worktree remove --force /tmp/t
```

## Unrelated but recorded here: Vercel log grouping is unreliable at short windows

While verifying PR #285 on production, the owner found Vercel's runtime-log
grouping returning **inconsistent counts across nested time windows** — 20
results in both a 20-minute and a 5-minute window, and `/pickers` showing 5 in
a 20-minute window but 10 in a 5-minute window nested inside it. A count over a
shorter window cannot exceed the same count over a window containing it, so at
least one figure is wrong.

Consequences, both of which cost real conclusions this round:

- **Do not use short-window log grouping to verify a request-count change.**
  Measure on production over hours instead.
- Earlier rounds of this work leaned on 3-hour and 24-hour groupings to argue
  about render counts. Those are likely directionally fine but should not be
  quoted as exact. Anything that mattered was re-derived from code or from a
  controlled local repro instead.

Related and already known: **cache HITs appear in the runtime logs too**, so a
raw per-route count is a *request* count, not a render count. Only routes that
are genuinely dynamic (`force-dynamic`, e.g. `/` and `/dashboard`) can have
their request count read as a render count.
