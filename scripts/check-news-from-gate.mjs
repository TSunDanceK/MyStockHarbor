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
const readHead = grab("readHeadProbe");
const gateDate = grab("gateFromDate");
if (!readGate || !gateDate || !readHead) {
  console.error("FAIL: could not extract the gate functions — measuring nothing.");
  process.exit(1);
}

const js = ts.transpileModule(
  `${gateDate}\n${readGate}\n${readHead}\nexport { readNewsFromGate, gateFromDate, readHeadProbe };`,
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

console.log("\n=== 5. HEAD: can a size be had without the body? ===\n");
// Two of the three failure modes look like success, which is the whole reason
// this is read rather than eyeballed. A 200 is not a pass; a present
// Content-Length is not a pass; only one that MATCHES the GET body is.
const H = (over = {}) => ({ id: "news-stock-HEAD", httpStatus: 200, contentLength: 100_000, bodyBytes: 0, ...over });
const G = (over = {}) => ({ id: "baseline", httpStatus: 200, contentLength: null, bodyBytes: 100_000, ...over });

check(
  "content-length matching the GET body -> PASS",
  (() => {
    const r = m.readHeadProbe(H(), G());
    return r.verdict === "PASS" && r.freeCountPossible === true;
  })()
);
check(
  "...and the PASS still warns that bytes are not an article count",
  /not an article count/.test(m.readHeadProbe(H(), G()).detail),
  "deriving one from the other assumes a stable bytes-per-article"
);
check("405 -> FAIL", m.readHeadProbe(H({ httpStatus: 405 }), G()).verdict === "FAIL");
check("404 -> FAIL", m.readHeadProbe(H({ httpStatus: 404 }), G()).verdict === "FAIL");
// THE ONE THAT LOOKS LIKE SUCCESS.
check(
  "200 with NO content-length -> FAIL, not pass",
  (() => {
    const r = m.readHeadProbe(H({ contentLength: null }), G());
    return r.verdict === "FAIL" && r.freeCountPossible === false;
  })(),
  "a 200 that answers the question with nothing"
);
// THE WORST ONE: a number that would be believed and is wrong.
check(
  "200 with a MISMATCHED content-length -> FAIL",
  (() => {
    const r = m.readHeadProbe(H({ contentLength: 12_000 }), G({ bodyBytes: 100_000 }));
    return r.verdict === "FAIL" && r.freeCountPossible === false;
  })(),
  "a wrong number is worse than no number"
);
check(
  "...and it says so, rather than reporting a bare mismatch",
  /worse than none|would be believed/.test(m.readHeadProbe(H({ contentLength: 12_000 }), G()).detail)
);
check(
  "a 1% difference is tolerated, a 12% one is not",
  m.readHeadProbe(H({ contentLength: 100_500 }), G()).verdict === "PASS" &&
    m.readHeadProbe(H({ contentLength: 112_000 }), G()).verdict === "FAIL"
);
// Unanswered is never a pass -- same rule as the from= gate.
check(
  "HEAD probe absent -> UNKNOWN",
  m.readHeadProbe(undefined, G()).verdict === "UNKNOWN"
);
check(
  "no GET body to compare against -> UNKNOWN, not PASS on the header alone",
  m.readHeadProbe(H(), G({ bodyBytes: 0 })).verdict === "UNKNOWN",
  "an unverified length is not a verified one"
);
check(
  "every non-PASS leaves freeCountPossible false",
  [
    m.readHeadProbe(H({ httpStatus: 405 }), G()),
    m.readHeadProbe(H({ contentLength: null }), G()),
    m.readHeadProbe(H({ contentLength: 12_000 }), G()),
    m.readHeadProbe(undefined, G()),
    m.readHeadProbe(H(), G({ bodyBytes: 0 })),
  ].every((r) => r.freeCountPossible === false)
);

console.log("\n=== 5b. The probe pairs with the GET on the same URL ===\n");
check(
  "the HEAD probe exists and declares its method",
  /id: "news-stock-HEAD"[\s\S]{0,200}method: "HEAD"/.test(src)
);
check(
  "it asks the SAME url as the baseline it is compared against",
  (src.match(/path: "news\/stock\?symbols=MU&limit=50",/g) ?? []).length === 2,
  "an approximately-comparable URL is not comparable"
);
check(
  "the request actually sends the declared method",
  /method: probe\.method \?\? "GET"/.test(src)
);
check(
  "both the header and the real body length are reported, never one for the other",
  /contentLength,\n\s*bodyBytes,/.test(src)
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
