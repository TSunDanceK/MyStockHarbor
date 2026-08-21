# Inference about a source you cannot open

Full writeup in `claude/BOTTLENECKS.md`. In short: assessing PR #246 required
reasoning about the Claude Project copy of `BOTTLENECKS.md`, which a repo
session cannot open. Every other claim was verified against current `main`; for
the one unreachable document, a PR body was trusted instead — and it was stale
on the day it was written. The inference was merged as fact and was wrong twice
over.

- **The unreachable source is where inference is least safe and most tempting.**
  Nothing pushes back there, so the guess gets written down more firmly than the
  things actually checked. Say "not verified — could not read X", never a
  conclusion about X.
- **A mirror can run *ahead* of its source, not just behind.** The Project copy
  described a backfill as done before it was, so the repo was the stale copy.
