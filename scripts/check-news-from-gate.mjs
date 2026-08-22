// Tests the reader that decides whether the stored-news design gets built.
//
// WHY THIS IS WORTH A HARNESS AT ALL. The gate is one comparison, and it is the
// comparison that authorises or kills a substantial piece of work. Both ways of
// getting it wrong are expensive: a false PASS builds an incremental refresh on
// a parameter FMP ignores, so every refresh silently re-fetches the whole window
// and the saving never arrives; a false FAIL kills a sound design outright.
//
// The subtle one is neither of those. It is a probe that FAILED -- 402, a
// timeout, skipped for budget -- reading as a pass because "no contradicting
// evidence" and "evidence of no contradiction" look identical in a boolean
// (claude/traps/absence-needs-the-producer-to-have-run.md). UNKNOWN is a
// first-class outcome here and most of the cases below are about that.
//
//   node scripts/check-news-from-gate.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ROUTE = "app/api/debug/fmp-endpoints/route.ts";
const src = fs.readFileSync(path.join(ROOT, ROUTE), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const sf = ts.createSourceFile(ROUTE, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const grab = (name) => {
  let out = null;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      out = node.getText(sf).replace(/^export\s+/, "");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
};

const readGate = grab("readNewsFromGate");
const gateDate = grab("gateFromDate");
if (!readGate || !gateDate) {
  console.error("FAIL: could not extract the gate functions — measuring nothing.");
  process.exit(1);
}

const js = ts.transpileModule(
  `${gateDate}\n${readGate}\nexport { readNewsFromGate, gateFromDate };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }
).outputText;
const m = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const FROM = "2026-08-21";
const row = (over = {}) => ({
  id: "x",
  ok: true,
  httpStatus: 200,
  rows: 50,
  oldestPublished: "2026-06-01T10:00:00Z",
  ...over,
});

console.log("\n=== 1. The two real answers ===\n");
// from= filters: the gated request reached back only to within the window,
// while the baseline reached months further.
const pass = m.readNewsFromGate(
  row({ oldestPublished: "2026-06-01T10:00:00Z" }),
  row({ oldestPublished: "2026-08-21T06:00:00Z" }),
  FROM
);
check("gated oldest inside the window -> PASS", pass.verdict === "PASS");
check("...and it says so explicitly", pass.clearedToBuild === true, pass.detail);

// from= ignored: the gated request came back with the same reach as the
// baseline. This is the case a lone probe cannot distinguish from success.
const fail = m.readNewsFromGate(
  row({ oldestPublished: "2026-06-01T10:00:00Z" }),
  row({ oldestPublished: "2026-06-01T10:00:00Z" }),
  FROM
);
check("gated oldest identical to baseline -> FAIL", fail.verdict === "FAIL");
check("...and the design is NOT cleared", fail.clearedToBuild === false);
check(
  "...and the detail names what is left, rather than just refusing",
  /tuning `limit`/.test(fail.detail)
);
// Partially honoured is still not honoured.
check(
  "gated oldest anywhere before from -> FAIL",
  m.readNewsFromGate(row(), row({ oldestPublished: "2026-08-20T23:59:00Z" }), FROM).verdict === "FAIL"
);
check(
  "gated oldest exactly at the from boundary -> PASS",
  m.readNewsFromGate(row(), row({ oldestPublished: "2026-08-21T00:00:00Z" }), FROM).verdict === "PASS"
);

console.log("\n=== 2. An unanswered gate is never a pass ===\n");
// THE POINT. Every one of these must be UNKNOWN with clearedToBuild false.
const unknowns = [
  ["baseline probe 402'd", m.readNewsFromGate(row({ ok: false, httpStatus: 402 }), row(), FROM)],
  ["gated probe 402'd", m.readNewsFromGate(row(), row({ ok: false, httpStatus: 402 }), FROM)],
  ["baseline skipped for budget (absent)", m.readNewsFromGate(undefined, row(), FROM)],
  ["gated skipped for budget (absent)", m.readNewsFromGate(row(), undefined, FROM)],
  ["both absent", m.readNewsFromGate(undefined, undefined, FROM)],
  ["rows carried no publish dates", m.readNewsFromGate(row({ oldestPublished: null }), row(), FROM)],
  ["gated rows carried no publish dates", m.readNewsFromGate(row(), row({ oldestPublished: null }), FROM)],
  ["unparseable date", m.readNewsFromGate(row(), row({ oldestPublished: "not a date" }), FROM)],
];
for (const [label, result] of unknowns) {
  check(`${label} -> UNKNOWN, not cleared`, result.verdict === "UNKNOWN" && result.clearedToBuild === false, result.verdict);
}
check(
  "UNKNOWN says plainly that it is not a pass",
  unknowns.every(([, r]) => /NOT a pass/.test(r.detail))
);

console.log("\n=== 3. One definition of 'yesterday' ===\n");
// Two copies of this date -- one in the probe that SENDS from=, one in the
// reader that JUDGES against it -- drifting by a day would report FAIL on a
// working parameter, killing a sound design. So there is one function, and both
// call it.
check(
  "gateFromDate is yesterday, UTC, date-only",
  m.gateFromDate(new Date("2026-08-22T12:00:00Z")) === "2026-08-21"
);
check(
  "...and it holds across a month boundary",
  m.gateFromDate(new Date("2026-09-01T00:30:00Z")) === "2026-08-31"
);
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");
check(
  "the probe and the reader both call it — no second copy of the arithmetic",
  (code.match(/gateFromDate\(/g) ?? []).length === 3,
  "one definition, two call sites"
);

console.log("\n=== 4. The probe is a PAIR, and reads content not status ===\n");
check("a baseline probe without from= exists", /news-stock-BASELINE-no-from/.test(code));
check("a gated probe with from= exists", /news-stock-GATE-from/.test(code));
check(
  "both report oldestPublished",
  /oldestPublished: publishedRange\(arr\)\.oldest/.test(code)
);
check(
  "oldest is a real minimum over all rows, not the last one",
  /times\.reduce\(\(a, b\) => \(b\.t < a\.t \? b : a\)\)/.test(code),
  "assuming newest-first ordering would be assuming what the probe verifies"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
