# An unchecked `cd` writes into whatever directory you were already in

A scratch directory built earlier in the session was gone — containers recycle
between sessions, taking `node_modules` and everything under `/home/user/*`
scratch with them. The rebuild script started with `cd /home/user/isr-bail`,
which failed. Every heredoc after it then wrote **relative paths into the repo**:

```
app/data.ts        app/pbail/page.tsx        app/pcontrol/page.tsx
```

`git add -A` committed all three into a PR about something else entirely.

The failure is general and has nothing to do with probes: **an unchecked `cd`
does not stop a script, it silently re-points every subsequent relative path at
whatever directory the shell happens to be in** — which, in this setup, is
always the repo. `set -e` does not save you here if the `cd` is not the last
command in its own statement; the run that caused this printed
`cd: No such file or directory` and carried on to `BUILD_EXIT=127`.

Two fixes, either sufficient:

```bash
cd /home/user/probe || exit 1          # refuse to continue in the wrong place
cat > /home/user/probe/app/data.ts     # or never use a relative path at all
```

**The habit that caught it is the part worth keeping:** reading the file list
in the `git push` / `git show --stat` output instead of assuming the commit
contains what was intended. The commit message, the diff summary and the PR
title all described one change; only the file list showed three extra files.

A related tail, once the strays were removed: `tsc` then failed on
`.next/types/validator.ts` still importing the deleted routes. Stale generated
types outlive the files they describe — `rm -rf .next` and rebuild before
believing a type error about a file that no longer exists.
