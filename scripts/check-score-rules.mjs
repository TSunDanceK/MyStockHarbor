// THE SCORE STOPS READING ARITHMETIC ON A TINY REVENUE LINE AS A SIGNAL
// (#535 COWORK #20, rulings in COWORK #23).
//
// Pinned on four LIVE stored sets, exported 2026-09-23 (data/sec/factset-fixture-*):
//   WKHS  revenue $3.6M, +374.9% on ~$0.76M; operating margin ~-545% vs ~-694%
//         over the score's pair; scored 72 (near GOOD) on a $20.2M loss.
//   AUR   margins in the -10,000%s; revenue +100% on $1.0M.
//   BYND  net income +$16.4M from a non-operating gain on an operating loss;
//         diluted EPS -$0.06 — "loss in both quarters" beside "profitable".
//   NBIS  +479% off $91.5M — real growth off a real base: rule 2 is a FLOOR
//         ONLY (owner ruling), so NBIS keeps its revenue-growth points (its
//         -1,170% -> -115% annual margin still goes under rule 1: 98 -> 88).
//
//   1. rule 1: a margin pair below -100% or moving beyond ±100pp is excluded
//      from the score and named "not meaningful" — MUTATION: the guard removed.
//   2. rule 2: prior-period revenue under $5M is not scored, and says "off a
//      very small base" — MUTATION: the floor removed.
//   3. rule 3: a negative margin "improved"/"worsened", never "widened" —
//      MUTATION: the verb rule removed.
//   4. BYND's wording names its measures — MUTATION: the non-operating clause removed.
import fs from "node:fs";
import { loadCards } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const once = (from, to) => (src) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times, needs exactly 1: ${from}`);
  return src.replace(from, to);
};
const score = (M, s) => {
  const set = fixture(s);
  return M.scoreFromSec(M.buildSecEarningsView(set), s, { status: "ready", set, cold: false });
};

const M = await loadCards();
const W = score(M, "WKHS"), A = score(M, "AUR"), B = score(M, "BYND"), N = score(M, "NBIS");

console.log("1. rule 1 — a margin that is not a move is not scored");
check("WKHS's margin trend is out of the score", W.contributions.marginTrend === undefined, JSON.stringify(W.contributions));
check("...and the card says why", W.unavailableWhy.some((u) => u.key === "marginTrend" && /not meaningful — revenue is too small relative to costs/.test(u.reason)),
  JSON.stringify(W.unavailableWhy));
check("AUR likewise", A.contributions.marginTrend === undefined);
check("the narrative no longer names a 658pp move", !/658/.test(W.explanation) && !/widened/.test(W.explanation), W.explanation);
{
  const Mm = await loadCards(once(
    "if (marginPair && marginMoveMeaningful(marginPair.first, marginPair.last)) {",
    "if (marginPair) {"));
  check("MUTATION: without the guard WKHS's margin is scored again (+10)", score(Mm, "WKHS").contributions.marginTrend === 10);
}

console.log("\n2. rule 2 — growth off a very small base is not scored (floor only)");
check("WKHS's revenue growth is out of the score", W.contributions.revenueGrowth === undefined);
check("...and it says 'off a very small base'", W.unavailableWhy.some((u) => u.key === "revenueGrowth" && u.reason === "off a very small base") &&
  /revenue grew 374\.9% against Q2 FY2025, off a very small base/i.test(W.explanation), W.explanation);
check("AUR (+100% on $1.0M) likewise", A.contributions.revenueGrowth === undefined);
check("NBIS (+479% on $91.5M) KEEPS its revenue-growth points", N.contributions.revenueGrowth === 22, JSON.stringify(N.contributions));
{
  const Mm = await loadCards(once(
    "if (isPct(s.revenueYoY) && !revenueBaseTooSmall(s.revenue?.val ?? null, s.revenueYoY)) {",
    "if (isPct(s.revenueYoY)) {"));
  check("MUTATION: without the floor WKHS's +22 comes back", score(Mm, "WKHS").contributions.revenueGrowth === 22);
}

console.log("\n3. the score that results");
check("WKHS 72 → about 40 (neutral band, not near GOOD)", W.score >= 36 && W.score <= 44 && W.tone === "neutral", `${W.score} ${W.tone}`);
// NBIS KEEPS ITS GROWTH POINTS; its margin trend goes under rule 1 as it
// should — its annual operating margin ran -1,170% to -115%, the same artefact.
check("NBIS: 98 → 88, and only by the margin rule", N.score === 88 && N.contributions.revenueGrowth === 22 && N.contributions.marginTrend === undefined,
  `${N.score} ${JSON.stringify(N.contributions)}`);

console.log("\n4. rule 3 and BYND — the words name the measure and the sign");
{
  const avav = fixture("AVAV");
  const v = M.scoreFromSec(M.buildSecEarningsView(avav), "AVAV", { status: "ready" });
  check("AVAV's -15.2% → -2.3% 'improved', not 'widened'", /operating margin improved 13\.0pp/.test(v.explanation), v.explanation);
  const Mm = await loadCards(once(
    "const positive = older >= 0 && newer >= 0;", "const positive = true;"));
  check("MUTATION: without the verb rule AVAV reads 'widened' again",
    /widened/.test(Mm.scoreFromSec(Mm.buildSecEarningsView(avav), "AVAV", { status: "ready" }).explanation));
}
check("BYND: EPS names its measure", B.unavailableWhy.some((u) => u.key === "epsGrowth" && u.reason === "diluted EPS negative in both quarters"),
  JSON.stringify(B.unavailableWhy));
check("BYND: the profit clause says where the profit came from", /the quarter was profitable after non-operating items/.test(B.explanation), B.explanation);
{
  const Mm = await loadCards(once("(opInc !== null && opInc < 0 ? ", "(false ? "));
  check("MUTATION: without the clause BYND reads plain 'profitable' again",
    /the quarter was profitable;|the quarter was profitable$/.test(score(Mm, "BYND").explanation.replace(/; later.*$/, ";")));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nThe score reads growth and margin only where they are signals, and says why where they are not.");
