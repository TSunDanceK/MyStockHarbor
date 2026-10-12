// THE SCORE'S REASON SAYS "n/m" IN WORDS (#552 COWORK #214).
//
// JOBY's score info read "Revenue grew 257493.3% against Q2 FY2025, off a
// very small base" beside an earnings page that prints n/m (#855). When the
// view marks revenue growth not meaningful, the clause keeps its meaning and
// drops the figure. TEXT ONLY: the score number is the same with or without
// the marker. An established name keeps its percentage. Then a mutant.
//
//   node scripts/check-score-reason-nm.mjs
import { loadCards } from "./lib/render-cards.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Fact sets shaped like the census's figures (CODE-A #229), as check-not-meaningful builds them.
const shapes = (M) => {
  const per = (e, s, fp, fy, o) => {
    const v = M.SEC_FIELD_KEYS.map((k) => o[k] ?? null);
    return { e, s, fp, fy, a: null, f: null, v, d: v.map((x) => (x == null ? "-" : "F")).join("") };
  };
  const q = (fy, fp, o) => {
    const [s, e] = { Q1: ["01-01", "03-31"], Q2: ["04-01", "06-30"] }[fp];
    return per(`${fy}-${e}`, `${fy}-${s}`, fp, fy, o);
  };
  const set = (symbol, quarters) => ({ symbol, cik: null, tx: ["dei", "us-gaap"], cur: "USD", quarters, years: [], instants: [], nt: [] });
  return {
    JOBY: set("JOBY", [
      q(2026, "Q2", { revenue: 38.6e6, operatingIncome: -260.6e6, netIncome: -245.2e6, epsDiluted: -0.29 }),
      q(2026, "Q1", { revenue: 15.1e6, operatingIncome: -210e6, netIncome: -200e6, epsDiluted: -0.25 }),
      q(2025, "Q2", { revenue: 15e3, operatingIncome: -167.9e6, netIncome: -160e6, epsDiluted: -0.22 }),
      q(2025, "Q1", { revenue: 30e3, operatingIncome: -150e6, netIncome: -145e6, epsDiluted: -0.21 }),
    ]),
    KO: set("KO", [
      q(2026, "Q2", { revenue: 12.5e9, grossProfit: 7.7e9, operatingIncome: 3.6e9, netIncome: 2.6e9, epsDiluted: 0.6 }),
      q(2025, "Q2", { revenue: 11.7e9, grossProfit: 7.2e9, operatingIncome: 3.3e9, netIncome: 2.5e9, epsDiluted: 0.58 }),
    ]),
  };
};
const scoreOf = (M, sym, mutateView = (v) => v) => {
  const view = mutateView(M.buildSecEarningsView(shapes(M)[sym]));
  return { view, score: M.scoreFromSec(view, sym, { status: "ready" }) };
};

const M = await loadCards();
const joby = scoreOf(M, "JOBY"), ko = scoreOf(M, "KO");

console.log("1. JOBY: the meaning stays, the figure goes");
check("the view marks JOBY's growth n/m (the input this reads)", joby.view.snapshot.revenueYoYNotMeaningful === true);
check("the reason says why in words", /revenue rose from a very small base in Q2 FY2025, so the growth rate isn't meaningful/i.test(joby.score.explanation), joby.score.explanation);
check("…and prints no growth percentage", !/revenue (grew|fell|rose)[^.]*?\d[\d,]*\.?\d*%/i.test(joby.score.explanation) && !/257,?233/.test(joby.score.explanation));
const unmarked = scoreOf(M, "JOBY", (v) => ({ ...v, snapshot: { ...v.snapshot, revenueYoYNotMeaningful: false } }));
check("the score number is the same with or without the marker (text only)", joby.score.score === unmarked.score.score && joby.score.available === unmarked.score.available, `${joby.score.score} / ${unmarked.score.score}`);

console.log("\n2. an established name keeps its percentage");
check("KO: no marker, and the reason states its growth figure", ko.view.snapshot.revenueYoYNotMeaningful === false && /revenue grew \d+\.\d% against Q2 FY2025/i.test(ko.score.explanation), ko.score.explanation);

console.log("\n3. mutant");
{
  let applied = false;
  const anchor = "  const notMeaningful = Boolean(s?.revenueYoYNotMeaningful);";
  const Mm = await loadCards((src) => { applied = src.split(anchor).length === 2; return src.replace(anchor, "  const notMeaningful = false;"); });
  if (!applied) throw new Error(`mutant anchor must match once: ${anchor}`);
  const mj = scoreOf(Mm, "JOBY");
  check("MUTANT the reason ignores the marker: '257233.3%' back in JOBY's reason (caught)", /257,?233\.3%/.test(mj.score.explanation), mj.score.explanation);
}

if (failures) { console.log(`\nscore-reason-nm: ${failures} FAILED`); process.exit(1); }
console.log("\nscore-reason-nm: all checks passed");
