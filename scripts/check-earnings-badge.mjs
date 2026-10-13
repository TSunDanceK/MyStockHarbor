// THE STRENGTH BADGE'S EARNINGS INPUT (#552 COWORK #154, #563 COWORK #102).
//
// RUN on lib/earningsBadge.ts with snapshots built by the shipped pipeline
// (buildSecEarningsView → scoreFromSec → buildSecEarningsSnapshot) from the
// committed fact-set fixtures, offline:
//   1. AAPL (all 5 measured, 76) → Good, and KTOS (all 5, 61) → Mixed: the
//      word is the card's own band, its number and period;
//   2. SPCX, a fresh filer scored on 3 of 5 → none, "partial": the card shows
//      no verdict on a partial score, so the badge counts none;
//   3. SPY (a fund, through the real seed gate) and a symbol not yet read →
//      none, "no earnings read";
//   4. every Weak path: the weak band maps to Weak (a real snapshot with its
//      tone and number set into the weak band — no fixture is fully measured
//      and weak);
//   5. no reads of its own: type-only imports, no Redis, no fetch.
// A mutation for each.
//
//   node scripts/check-earnings-badge.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { loadSnapshot } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  if (src.split(from).length !== 2) throw new Error(`mutation anchor must match once: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const FILE = "lib/earningsBadge.ts";
const RAW = fs.readFileSync(FILE, "utf8");
async function load(mutate = (s) => s) {
  const src = mutate(RAW);
  if (src === RAW) return import(`../${FILE}`);
  const tmp = `lib/.check-earnings-badge-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, src);
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

// The shipped view, scorer and snapshot builder, through the render harness
// (it strips the snapshot module's server-only imports).
const H = await loadSnapshot();
const V = H, N = H;
const S = await import("../lib/server/secEarningsScore.ts");
const C = await import("../lib/server/secColdFetch.ts");
const NONE_NEXT = { kind: "none", headline: "", value: null, hedge: "" };
const snapshotOf = (symbol, cold) => {
  const view = cold.status === "ready" ? V.buildSecEarningsView(cold.set) : null;
  return N.buildSecEarningsSnapshot({ symbol, view, score: H.scoreFromSec(view, symbol, cold), reported: null, nextReport: NONE_NEXT });
};
const fixture = (s) => snapshotOf(s, { status: "ready", set: JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8")), cold: false });
const SNAP = {
  AAPL: fixture("AAPL"),
  KTOS: fixture("KTOS"),
  SPCX: fixture("SPCX"),
  SPY: snapshotOf("SPY", await C.resolveFactSetForRender("SPY")),
  UNREAD: snapshotOf("ZZZZ", { status: "pending", reason: C.NOT_YET_READ }),
};

const RULES = {
  "AAPL, all 5 measured → Good, with the card's number and period": (B) => {
    const r = B.earningsBadgeInput(SNAP.AAPL);
    return r.word === "Good" && SNAP.AAPL.toneLabel === "Good" && r.score === SNAP.AAPL.score && r.score === 76
      && r.period === SNAP.AAPL.periodLabel && r.note === `Earnings: Good (76/100, ${SNAP.AAPL.periodLabel})`;
  },
  "KTOS, all 5 measured at 61 → Mixed, the card's own word": (B) => {
    const r = B.earningsBadgeInput(SNAP.KTOS);
    return r.word === "Mixed" && SNAP.KTOS.toneLabel === "Mixed" && r.score === 61;
  },
  "SPCX, a fresh filer scored on 3 of 5 → none (partial), and the note says so": (B) => {
    const r = B.earningsBadgeInput(SNAP.SPCX);
    return SNAP.SPCX.partial && SNAP.SPCX.score != null && r.word === null && r.why === "partial"
      && r.note === "earnings score partial (3 of 5 measured), not counted";
  },
  "SPY (a fund, through the seed gate) → none, no earnings read": (B) => {
    const r = B.earningsBadgeInput(SNAP.SPY);
    return SNAP.SPY.score === null && r.word === null && r.why === "not-read" && r.note === "no earnings read";
  },
  "a symbol not yet read, or no snapshot at all → none, no earnings read": (B) =>
    [SNAP.UNREAD, null, undefined].every((s) => { const r = B.earningsBadgeInput(s); return r.word === null && r.why === "not-read"; }),
  "the weak band → Weak": (B) => {
    const weak = { ...SNAP.AAPL, tone: "weak", toneLabel: "Weak", score: S.SCORE_BANDS.find((b) => b.tone === "weak").from + 20 };
    return B.earningsBadgeInput(weak).word === "Weak" && S.bandFor(weak.score) === "weak";
  },
};
const SOURCE_RULES = {
  "no reads of its own: type-only imports, no Redis, no fetch": (src) =>
    [...src.matchAll(/^import\s+(.*?)\s+from/gm)].every((m) => /^type\b/.test(m[1]))
    && !/redis|fetch\(|readFactSet|resolveFactSetForRender/i.test(src),
};

const B0 = await load();
const SRC0 = readCodeOnly(FILE);
console.log("the shipped function, on snapshots built from the fixtures");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(B0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}
for (const [name, rule] of Object.entries(SOURCE_RULES)) check(name, rule(SRC0));

console.log("\nmutants: each must break a rule");
const MUTANTS = [
  ["a partial score counted", once("  if (snapshot.partial) {", "  if (false) {")],
  ["Mixed and Good swapped", once('{ good: "Good", neutral: "Mixed", weak: "Weak" }', '{ good: "Mixed", neutral: "Good", weak: "Weak" }')],
  ["the weak band read as Mixed", once('weak: "Weak" }', 'weak: "Mixed" }')],
  ["an unscored snapshot read as the seed's Mixed", once("if (!snapshot || snapshot.score == null)", "if (!snapshot)")],
];
for (const [label, mutate] of MUTANTS) {
  let bites = false;
  try {
    const B = await load(mutate);
    bites = Object.values(RULES).some((r) => { try { return !r(B); } catch { return true; } });
  } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, bites);
}
check("MUTATION: a value import of the store → caught",
  !SOURCE_RULES["no reads of its own: type-only imports, no Redis, no fetch"](SRC0.replace('import type { SecEarningsSnapshot }', 'import { readFactSet } from "@/lib/server/secFactStore";\nimport type { SecEarningsSnapshot }')));

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
