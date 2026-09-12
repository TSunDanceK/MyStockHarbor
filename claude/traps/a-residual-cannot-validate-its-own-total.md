# A quantity derived from a total cannot validate the model against that total

Found 2026-09-12, in this repo's own write-command budget.

The question was which key prefix produces the console's **1,440,133 writes per
month**. A model was built from cron cadence × write fan-out read from source.
Every writer that could be counted came to **698,640**. The remainder,
**741,493**, was divided by the per-build instrumentation cost to infer a build
rate of ~2/day, and the bandwidth meter was assigned the rest.

Then the model was checked by summing its rows against the observed total, and it
matched to 96.5%. **That match was arithmetic, not evidence.** The largest row
had been computed by subtracting the others from the total; adding them back
recovers the total by construction. A model containing one free parameter fitted
to the answer will always reproduce the answer.

Two details made it persuasive rather than obviously circular:

- **The sum was taken over a subset.** Three rows were quoted and three smaller
  writers worth 65,040 were left out, so the total fell *short* of observed and
  read as a near-miss — the signature of an independent estimate. The complete
  model sums to 101.0%, which is the identity plus a rounding of 1.96 up to 2.
- **Every other row was genuinely measured.** Verified fan-outs on five of six
  rows lent their credibility to the sixth, which was not measured at all.

- **Name the free parameter before checking the fit.** If any row was derived
  from the total, the fit tests nothing and the honest statement is a
  sensitivity range. Here: 1 build/day leaves 363,493 writes unexplained,
  3/day overshoots by 27%, and only the console's top-keys breakdown decides.
- **Quoting a subset of your own model is not simplification.** Dropping rows
  changed a tautology into apparent corroboration. If rows are omitted, the
  stated percentage is not the model's.
- **A recommendation resting on a circular number needs a different reason, not
  a smaller claim.** "Fix the meter, it is the largest write source" did not
  survive. "Fix the meter, it is a 6:1 write amplification on pure
  instrumentation, wrong at any rate" is measured and survives.
