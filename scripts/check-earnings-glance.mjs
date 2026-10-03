// THE EARNINGS PAGE READS AT A GLANCE (#552 COWORK #124/#125, owner ruling).
//
//   1. EVERY DOTTED VALUE OPENS A NOTE. Any element styled as "has a note"
//      (a dotted underline or a help cursor) is the shared note trigger
//      (EstimatedValue's Noted: role="button", a non-empty data-estimate-note,
//      the click/keyboard handler) or the score's focusable InfoTip with its
//      text. No <abbr title>: a title never opens on a tap ("Loss both periods"
//      had the underline and nothing happened).
//   2. NO REFUSAL SENTENCE INLINE. Outside the cards' <details> and the notes,
//      the visible text carries none of the explanations that used to sit
//      under values ("Not measured: …", "Can't calculate …", the "Not
//      reported" footer, "Cash and short-term investments less total debt",
//      the Trend card's method line…). The word is the value; the sentence is
//      its note.
//   3. THE TREND CARD IS THREE TILES, each with the same four rows (label,
//      figure, Latest, pills), the method in its <details>.
//   4. "derived" SITS BEFORE ITS FIGURE on the cards (the figure stays last).
//   plus MUTANTS, one per rule, each caught. A missing anchor fails.
//
//   node scripts/check-earnings-glance.mjs
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw Object.assign(new Error(`mutation anchor matched ${n} times: ${from.slice(0, 70)}`), { anchor: true });
  return src.replace(from, to);
};
const el = React.createElement;
const FIXTURES = ["ONDS", "AVAV", "AAPL", "KGC", "WKHS", "AZN"];

/** Every SEC card on the page, rendered for one fixture. */
function pageOf(M, sym) {
  const set = JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8"));
  const view = M.buildSecEarningsView(set);
  const score = M.scoreFromSec(view, sym, { status: "ready" });
  const coverage = M.coverageOf(score);
  const r = (C, props) => html(el(C, props));
  return {
    sym, view,
    cards: {
      score: r(M.SecScoreCard, { symbol: sym, score, coverage }),
      snapshot: r(M.SecSnapshotCard, { view, pending: null }),
      growth: view.tableBasis === "year" ? "" : r(M.SecGrowthMarginsCard, { view }),
      annual: r(M.SecAnnualCard, { view, sole: view.tableBasis === "year" }),
      trend: r(M.SecTrendSummaryCard, { view }),
      valuation: r(M.SecValuationCard, { view, inputs: M.valuationInputs(set, "2026-10-02"), price: 10, priceAsOf: "2026-10-02", today: "2026-10-02" }),
      cash: r(M.SecCashQualityCard, { view }),
      balance: r(M.SecBalanceSheetCard, { view }),
      income: r(M.SecIncomeStatementCard, { view }),
      recent: r(M.SecRecentPeriodsCard, { view }),
    },
  };
}

/** Rule 1's offenders in one card's markup. */
function noteProblems(markup) {
  const out = [];
  if (/<abbr\b/.test(markup)) out.push("an <abbr> (a title never opens on a tap)");
  for (const m of markup.matchAll(/<(\w+)\b([^>]*)>/g)) {
    const attrs = m[2];
    const styled = /cursor:\s*help|dotted/.test(attrs);
    if (!styled) continue;
    const noted = /role="button"/.test(attrs) && /data-estimate-note="[^"]+"/.test(attrs) && /tabindex="0"/.test(attrs);
    const tip = /class="infoTip"/.test(attrs);
    if (!noted && !tip) out.push(`<${m[1]}${attrs.slice(0, 90)}>`);
  }
  for (const m of markup.matchAll(/<span class="infoTipText"[^>]*>([^<]*)<\/span>/g)) if (!m[1].trim()) out.push("an empty InfoTip");
  return out;
}

const REFUSAL_SENTENCES = [
  /Not measured:/, /Can.t calculate/, /not on file\./, /Twelve months of diluted EPS/, /means the company.s SEC filing has no figure/,
  /Q4 EPS is not filed as a separate period/, /Cash and short-term investments less total debt/, /This filer tags equity only/,
  /lifted by a run/, /middle value across/i, /Positive means cash is running ahead/, /cash spent on productive assets/,
];
/** Rule 2's offenders: the visible text outside <details>. */
function inlineSentences(markup) {
  const shown = visibleText(markup.replace(/<details[\s\S]*?<\/details>/g, " "));
  return REFUSAL_SENTENCES.filter((re) => re.test(shown)).map((re) => re.source);
}

function measure(M) {
  const pages = FIXTURES.map((s) => pageOf(M, s));
  const notes = [], inline = [];
  for (const p of pages) for (const [name, markup] of Object.entries(p.cards)) {
    for (const x of noteProblems(markup)) notes.push(`${p.sym} ${name}: ${x}`);
    for (const x of inlineSentences(markup)) inline.push(`${p.sym} ${name}: ${x}`);
  }
  const onds = pages[0];
  return { pages, notes, inline, trend: onds.cards.trend, balance: onds.cards.balance, cash: onds.cards.cash };
}

const RULES = {
  "1. every dotted / help-cursor element opens a note (role=button, a note, keyboard) — no <abbr title>":
    ({ notes }) => notes.length === 0,
  "2. no refusal or method sentence printed inline, across six fixtures":
    ({ inline }) => inline.length === 0,
  "3. the Trend card is three tiles of four rows, the method in its <details>":
    ({ trend }) => {
      const tiles = trend.split('data-trend-tile=""').slice(1);
      return tiles.length === 3 && tiles.every((t) => /class="metricLabel trendTileLabel"/.test(t) && /class="metricValue trendTileValue"/.test(t) && /class="trendLatest"/.test(t) && /class="trendChipRow"/.test(t))
        && /<details class="cardDetails"><summary>About these figures<\/summary>[\s\S]*middle value across/.test(trend);
    },
  "3b. the EPS growth tile's refusal is the word, its reason the note (ONDS)":
    ({ trend }) => /data-estimate-note="[^"]*loss[^"]*"[^>]*>Not meaningful</.test(trend),
  "4. 'derived' sits before its figure (the figure is the last child)":
    ({ pages }) => pages.every((p) => Object.values(p.cards).every((m) =>
      // never a figure directly followed by a "derived" word
      !/>[^<>"]*[\d%×][^<>"]*(<\/[a-z]+>)*<span style="position:relative;display:inline-block"><span role="button"[^>]*data-estimate-note="[^"]*"[^>]*>derived</.test(m)))
      && /data-estimate-note="Derived[^"]*"[^>]*>derived<\/span><\/span>-?\$/.test(pages[0].cards.cash),
};

const real = measure(await loadCards());
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = rule(real); } catch { ok = false; }
  const detail = name.startsWith("1.") ? real.notes.slice(0, 3).join("; ") : name.startsWith("2.") ? real.inline.slice(0, 3).join("; ") : "";
  check(name, ok, ok ? "" : detail);
}

const MUTANTS = [
  ["a crossing word back to <abbr title> (the click that opened nothing)", (s) => once(s,
    "  if (v != null && isCrossing(v)) return <ReasonedValue text={CROSSING_WORDS[v]} reason={CROSSING_NOTE} />;",
    "  if (v != null && isCrossing(v)) return <abbr className=\"crossTip\" title={CROSSING_NOTE} tabIndex={0}>{CROSSING_WORDS[v]}</abbr>;")],
  ["a dotted value with no note", (s) => once(s,
    "  return <ReasonedValue text=\"Not meaningful\" reason={EMPTY_REASONS.revenueIncomplete} style={MUTED_VALUE} />;",
    "  return <span style={{ ...MUTED_VALUE, borderBottom: \"1px dotted currentColor\", cursor: \"help\" }}>Not meaningful</span>;")],
  ["the Trend refusal printed under the tile again", (s) => once(s,
    "                ) : l.latestWords ? l.latestWords : \"\\u00a0\"}",
    "                ) : l.latestWords ? l.latestWords : l.reason ? `Not measured: ${l.reason}` : \"\\u00a0\"}")],
  ["a bar row's explanation printed under it again", (s) => once(s,
    "          <HBar value={r.value} max={max} tone={r.tone} />\n",
    "          <HBar value={r.value} max={max} tone={r.tone} />\n          {r.sub ? <span className=\"hbarSub\">{r.sub}</span> : null}\n")],
  ["the Q4 EPS footnote printed outside the details", (s) => once(s,
    "      <CardDetails>\n        <p>{view.recentPeriods.some(q4EpsNotReported) ? <>{Q4_EPS_NOTE} </> : null}Source: {SEC_ATTRIBUTION}.</p>\n      </CardDetails>",
    "      <p className=\"earningsDataNote\">{view.recentPeriods.some(q4EpsNotReported) ? <>{Q4_EPS_NOTE} </> : null}Source: {SEC_ATTRIBUTION}.</p>")],
  ["the Trend method line back as a subtitle", (s) => once(s,
    "      <h3>What does a typical {w.one} look like?</h3>\n",
    "      <h3>What does a typical {w.one} look like?</h3>\n      <p>Middle value across the {w.many} on file.</p>\n")],
  ["a tile losing its Latest row (alignment)", (s) => once(s, `<div className="trendLatest" style=`, `<div className="trendLatestGone" style=`)],
  ["'derived' after the figure again", (s) => once(s,
    "              <DerivedValue value={c.freeCashFlow} missing={c.freeCashFlowMissing} />\n            </>",
    "              <DerivedValue value={c.freeCashFlow} missing={c.freeCashFlowMissing} />\n              {c.freeCashFlowDerived ? <CardDerivedWord note=\"Derived after\" /> : null}\n            </>").replace(
    "              {c.freeCashFlowDerived ? (\n                <CardDerivedWord note={`Derived: operating cash flow minus capital expenditure, both of which the filer reports year-to-date, so this ${w.one} is the difference between two cumulative figures.`} />\n              ) : null}\n", "")],
];
for (const [label, mutate] of MUTANTS) {
  let caught, why = "";
  try {
    const m = measure(await loadCards(mutate));
    caught = Object.values(RULES).some((r) => { try { return !r(m); } catch { return true; } });
  } catch (e) { caught = !e?.anchor; if (e?.anchor) why = e.message; }
  check(`MUTATION: ${label} → caught`, caught, why);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
