# A derived thing cannot be evidence about the thing it was derived from

Found 2026-09-12 while establishing which Upstash meter actually bills, then hit
twice more the same day in forms that looked nothing like the first. Widened from
"a document reconstructed from code" to **anything derived** — a doc, a cached ref,
a stamp — because the document case turned out to be one instance of three.

`lib/server/redisBandwidth.ts:5` states *"The Upstash plan meters BANDWIDTH.
Commands are unlimited on it — so the 17M → 338k command reduction of #414/#415
bought real latency and real safety and bought NOTHING against the limit that
binds."* That is false. The console shows **PAY AS YOU GO**, commands at
**$0.20/100K** and ~99% of the bill; the reduction was worth ~$33/month against
a total bill of $3.83.

The reason it stood for weeks is the trap. Asked for independent confirmation,
the obvious move was `claude/outage-upstash-suspended-2026-08-28.md`, which says
the database was *"suspended for exceeding its read-bandwidth allowance."* Two
sources agreeing, one of them a dated post-mortem of a real outage.

**They were not two sources.** That file's own provenance header says so:

> This is the repo mirror. The original lives in the Claude Project … so this
> file was **reconstructed from the code and the dated docs that cite it** rather
> than copied.

The code it was reconstructed from is `redisBandwidth.ts`. The production error
text, in the Project original, reads *"suspended for exceeding the defined budget
limit. Please increase budget or switch to a Fixed plan."* — a cost suspension,
not a bandwidth one. The defect wrote itself into a post-mortem, and the
post-mortem was then read back as corroboration of the defect.

- **Check the direction of derivation before counting a source.** Two documents
  agreeing is worth nothing if one was generated from the other. The citation
  looks like independent support and is a loop.
- **A provenance header is load-bearing, not courtesy.** This one named the
  problem exactly and was still skipped, because a dated post-mortem reads as
  primary. Read the header first, then the claim.
- **"Reconstructed" means the mirror can only ever repeat what the code already
  said.** It cannot discover that the code is wrong. Only the vendor's own
  console or error text could, and that is the artefact to go find.

Second-order relative to `claude/traps/inference-about-a-source-you-cannot-open.md`:
there the risk was guessing at an unreachable document, here it is trusting a
reachable one that is a copy of the thing under test.

## It is not only documents. Three instances, one session, one shape

The doc case above was the first. Two more landed the same day, and neither looked
like it:

| Derived thing read | Source it was derived from | What it got wrong |
|---|---|---|
| `outage-upstash-suspended-2026-08-28.md`, a dated post-mortem | `redisBandwidth.ts`, the defective file | Confirmed the defect it was written from |
| The local `origin/main` ref | The actual remote | Claimed 5 commits would sweep into a PR; the remote said otherwise |
| `msh:history:newest-bar:v1`, a stamp written beside the entry | The cached series itself | `EA@2026-06-23` against a real series ending `2026-08-10` — a six-week gap that did not exist |

The third is the one that proves the class, because it is **data, not prose**. A
Redis key holding a date is not a document, has no provenance header to skip, and
reads as a measurement. It was still a derived value standing in for its source,
and it was still wrong in the same way.

## The signature: the derived thing is CHEAPER TO READ than the source

This is what makes the trap recur among people being careful, and it is the part
worth memorising. In all three cases the derived artefact was the easier read:

- a doc instead of the code
- a local ref instead of a network round-trip to the remote
- one stamp instead of parsing a 1,239-bar series

Cheapness is exactly why it gets reached for. Nobody chooses the derived value
because they trust it more; they choose it because it is right there. So the tell is
not "this source looks unreliable" — it never does — it is **"this was the
convenient thing to read."**

## The rule

**When a derived value is load-bearing for a published conclusion, go to the source
before publishing.**

Not "don't read derived data" — that would forbid the stamps, refs and mirrors that
exist precisely to be read cheaply, and they are fine for steering. The trigger is
*load-bearing* plus *published*: the moment a derived number becomes the reason a
conclusion is being asserted to someone else, it has to be checked against what it
was derived from. Reading the series after writing the doc is the same cost as
reading it before, and only one order produces a retraction.

**Cheap to read is not the same as cheap to be wrong about.**

## Why it took three instances to become visible

Worth recording, because it is the argument for the rule existing at all rather
than being obvious.

The three were hit **from opposite directions**. In the first, the error was
*believing* a derived doc — treating a reconstruction as corroboration. In the
third, the error was the mirror image: a stamp was *disbelieved* in the right
direction but for the wrong reason, then a different derived value was trusted in
its place, and the conclusion drawn (a six-week upstream gap) was more dramatic than
the truth. One was excessive credulity, one produced a false alarm.

Because the failures looked opposite, each was diagnosed as its own mistake — a
careless citation, a stale ref, a bad lookup — and the shared shape stayed invisible
until the third. Three separate one-off corrections, all landing on the same
structure, is what a class looks like before anyone names it.

The general lesson is not about derivation at all: **errors that present in opposite
directions can still share a mechanism, and per-instance correction will never
surface it.** Group by structure, not by symptom.
