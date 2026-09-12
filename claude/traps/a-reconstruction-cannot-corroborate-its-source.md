# A document reconstructed from code cannot be evidence about that code

Found 2026-09-12, while establishing which Upstash meter actually bills.

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
