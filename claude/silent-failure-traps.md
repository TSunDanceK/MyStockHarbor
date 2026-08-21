# Silent-failure traps

Instruments and interfaces that answer a question you did not ask, in a format
that looks like they answered the one you did. Each was hit live; none is
hypothetical.

The shared shape: **a check that cannot run rarely reports that it could not
run.** It returns something that reads like an answer.

## Where the entries are

One file per trap in **`claude/traps/`**. Discovery is `ls claude/traps/`, and
each filename is the finding:

```
ls claude/traps/
```

**Entries are named, not numbered, and that is deliberate.** They were numbered
until 2026-08-21, and three pull requests in a single day conflicted on this
file — every one of them two PRs appending an entry to the end. The file was
never the real problem: **the numbering was shared mutable state.** Two branches
both need "the next number", so each has to assume the other landed, and an
index does not help while entries stay numbered because the contention simply
moves to the index. Slugs remove it — two PRs adding traps now touch disjoint
files and cannot collide. A slug is also stable under insertion and reordering,
which a number is not.

So: **cite traps by slug, never by position.** `claude/traps/suspicious-uniformity.md`,
not "trap 16".

Git-shaped instruments live separately, in
`claude/stacked-branches-squash-merge-2026-08-20.md` — three-dot diffs, shallow
clones, stacked branches and squash-merge.

## Writing an entry: describe the mechanism, do not pre-authorise a conclusion

This file exists to stop repeated mistakes, so it is worth noticing that an
entry can *cause* one.

While migrating the two feed pages, an observation went into a PR body: after
adding the degraded-render bail, a `ƒ` in a **credential-less** build no longer
proves a route is blocked — it can be the bail firing correctly. That is true.
It is also the sentence that nearly closed this investigation, because when the
preview came back `ƒ`, there was a ready-made reason to stop looking. The build
had working credentials, the bail had fired on only one of the two pages, and
the real cause was three `no-store` fetches (see
`claude/traps/framework-signal-swallowed-by-a-network-handler.md`).

The difference is not accuracy. The note was accurate. The difference is that
it **supplied a conclusion in advance** — "if you see `ƒ`, it may be fine" —
rather than a mechanism to reason with.

So, when adding to this file:

- **Describe the mechanism**, and the observation that would distinguish it
  from its neighbours. "A `no-store` fetch throws `DYNAMIC_SERVER_USAGE`, which
  marks the render dynamic before any `catch` sees it" is a tool.
- **Do not write a rule that terminates an inquiry**, however true. "`ƒ` might
  be fine now" is not a tool; it is permission to stop.
- Where an entry could be read as an excuse, **say what must still be checked**.
  That entry's version: `ƒ` means read the prerender log and find out *which*
  cause — never assume the benign one.

An anomaly explained away is more expensive than an anomaly left open, because
nobody returns to it.

## Adding one

Create `claude/traps/<slug>.md` with an `# H1` title. Nothing to renumber,
nothing to insert into, no index to update.
