// The due strip's selection rule, RUN rather than pattern-matched.
//
// Every constant in it is a measurement, and every one of them has a plausible
// wrong value that changes the page without breaking it. k=7 instead of 5 is a
// different list, not an error message. So the assertions are about the DAY a
// symbol enters and the day it leaves, against dates computed by hand from the
// rule -- not against the module's own arithmetic.
//
//   node scripts/check-due-to-report.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/dueToReport.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const raw = fs.readFileSync(SRC, "utf8");
const js = ts.transpileModule(raw, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const DAY = 86_400_000;
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const P = "2026-03-31";
const sym = (o) => ({ symbol: o.symbol ?? "AAA", periodEnd: o.periodEnd ?? P, medianLagDays: o.medianLagDays ?? 30, largeAccelerated: o.largeAccelerated ?? true });
const has = (rows, s) => rows.some((r) => r.symbol === s);

// ── 1. k is 7, and the entry day is exactly where 7 puts it ────────────────
console.log("\n1. The entry day — k=7, measured, not preferred");
{
  check("DUE_LEAD_DAYS is 7 and is exported", m.DUE_LEAD_DAYS === 7, String(m.DUE_LEAD_DAYS));

  const one = [sym({ medianLagDays: 30 })];
  // Hand-computed: median lag 30, k 7, so the strip opens on P+23.
  check("not due on P+22", !has(m.selectDue(one, shift(P, 22)), "AAA"), shift(P, 22));
  check("due on P+23 — medianLag 30 minus k 7", has(m.selectDue(one, shift(P, 23)), "AAA"), shift(P, 23));
  check("still due on P+30, its own median", has(m.selectDue(one, shift(P, 30)), "AAA"));

  // THE PAIR ABOVE IS WHAT PINS k, and it is worth being explicit about how:
  // with medianLag 30, k=5 opens on P+25 and would fail "due on P+23", while
  // k=10 opens on P+20 and would fail "not due on P+22". Both neighbours the
  // sweep considered are excluded by those two lines together -- neither one
  // alone does it. (A third assertion here originally tested for a symbol that
  // was never in the input, so it passed against every possible k. Removed.)
  const lag12 = [sym({ medianLagDays: 12 })];
  check("a short-lag filer opens on P+5, not P+7 or P+2", has(m.selectDue(lag12, shift(P, 5)), "AAA") && !has(m.selectDue(lag12, shift(P, 4)), "AAA"));
}

// ── 2. The period must have ENDED ──────────────────────────────────────────
console.log("\n2. A period that has not ended is never due");
{
  const future = [sym({ periodEnd: shift(P, 10), medianLagDays: 2 })];
  // medianLag 2 minus k 7 is NEGATIVE, so the lead rule alone would admit it
  // five days before its own period end. Only the period-end guard stops it.
  check("a lead longer than the lag does not reach back past the period end", !has(m.selectDue(future, P), "AAA"));
  check("and it becomes due the day the period ends", has(m.selectDue([sym({ medianLagDays: 2 })], P), "AAA"));
}

// ── 3. The overdue cap — the safeguard that has never fired ────────────────
console.log("\n3. The overdue cap — inert in the shipped cut, and still bounded");
{
  check("OVERDUE_GRACE_DAYS is 30", m.OVERDUE_GRACE_DAYS === 30, String(m.OVERDUE_GRACE_DAYS));
  check("the two statutory deadlines are 40 and 45", m.DEADLINE_LARGE_ACCELERATED_DAYS === 40 && m.DEADLINE_OTHER_DAYS === 45);

  // Large accelerated: 40 + 30 = 70 days past the period end.
  const la = [sym({ largeAccelerated: true, medianLagDays: 30 })];
  check("a large accelerated filer is still listed on P+70", has(m.selectDue(la, shift(P, 70)), "AAA"));
  check("and is dropped on P+71", !has(m.selectDue(la, shift(P, 71)), "AAA"));

  // Everyone else: 45 + 30 = 75.
  const other = [sym({ largeAccelerated: false, medianLagDays: 30 })];
  check("a non-accelerated filer is still listed on P+75", has(m.selectDue(other, shift(P, 75)), "AAA"));
  check("and is dropped on P+76", !has(m.selectDue(other, shift(P, 76)), "AAA"));
  check(
    "the two deadlines are not interchangeable",
    has(m.selectDue(other, shift(P, 73)), "AAA") && !has(m.selectDue(la, shift(P, 73)), "AAA"),
    "P+73 is inside one cap and outside the other"
  );
}

// ── 4. The invariant that replaces an attribution-horizon clause ───────────
//
// selectDue deliberately has NO check against secResultsDate's 120-day
// attribution horizon, because the overdue cap already keeps every entry well
// inside it and the clause would have been an unreachable branch. That is only
// true while the numbers hold, so the relationship is asserted here.
console.log("\n4. The strip can never outlast the window attribution works in");
{
  const attribution = /MAX_ATTRIBUTION_DAYS = (\d+)/.exec(fs.readFileSync(path.join(ROOT, "lib/server/secResultsDate.ts"), "utf8"));
  check("MAX_ATTRIBUTION_DAYS is readable from the attribution module", attribution != null);
  const horizon = Number(attribution?.[1]);
  const widest = m.DEADLINE_OTHER_DAYS + m.OVERDUE_GRACE_DAYS;
  check(
    "the widest the cap allows is inside the attribution horizon",
    widest <= horizon,
    `widest ${widest}d vs horizon ${horizon}d — if this fails, selectDue needs the horizon clause back`
  );
}

// ── 5. Ordering, and the slice the strip renders ──────────────────────────
console.log("\n5. Ordered by the symbol's own expected date, earliest first");
{
  const rows = m.selectDue(
    [
      sym({ symbol: "LATE", medianLagDays: 40 }),
      sym({ symbol: "EARLY", medianLagDays: 20 }),
      sym({ symbol: "MID", medianLagDays: 30 }),
    ],
    shift(P, 50)
  );
  check("all three are listed", rows.length === 3, JSON.stringify(rows.map((r) => r.symbol)));
  check("ordered EARLY, MID, LATE", rows.map((r) => r.symbol).join(",") === "EARLY,MID,LATE", rows.map((r) => r.symbol).join(","));
  check("expectedOn is periodEnd + the symbol's own median lag", rows[1]?.expectedOn === shift(P, 30), String(rows[1]?.expectedOn));
  check("dueFrom is that minus k", rows[1]?.dueFrom === shift(P, 23), String(rows[1]?.dueFrom));
  check("daysOutstanding counts from the period end", rows[0]?.daysOutstanding === 50, String(rows[0]?.daysOutstanding));

  // Ties break on symbol, so the strip's order does not wobble between renders.
  const tied = m.selectDue([sym({ symbol: "BBB" }), sym({ symbol: "AAA" })], shift(P, 40));
  check("a tie breaks on the symbol, so the order is stable", tied.map((r) => r.symbol).join(",") === "AAA,BBB");
}

// ── 6. Rubbish in is dropped, not rendered ────────────────────────────────
console.log("\n6. Unusable input is dropped rather than guessed at");
{
  check("an unparseable period end is dropped", m.selectDue([sym({ periodEnd: "not-a-date" })], shift(P, 40)).length === 0);
  check("a NaN median lag is dropped", m.selectDue([sym({ medianLagDays: Number.NaN })], shift(P, 40)).length === 0);
  check("a negative median lag is dropped", m.selectDue([sym({ medianLagDays: -5 })], shift(P, 40)).length === 0);
  check("an unparseable `today` yields nothing", m.selectDue([sym({})], "nonsense").length === 0);
  check("no inputs yields nothing", m.selectDue([], shift(P, 40)).length === 0);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
