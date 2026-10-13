// THE INCOME STATEMENT'S TRAFFIC LIGHTS (#552 COWORK #137 §2).
//
// Green improved, white little change, red weaker, each figure against the
// same quarter a year earlier (or the prior fiscal year). The rules are the
// pure lineTrend() in lib/lineTrend.ts; the card only draws them. This runs a
// fixture per rule (seasonal base, the ±3% band, a cost as a share of revenue,
// the share count, sign flips, a one-off, a missing base, an incomplete revenue
// line, a line with no direction), renders the card on the committed fixtures
// (key line, glyphs, notes, a loss in red), and breaks each rule on purpose.
// It also prints the tone mix across the fixtures, which is what the ±3% band
// was measured against: it must not swallow most rows.
//
//   node scripts/check-line-trend.mjs
import fs from "node:fs";
import { loadCards, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const FIXTURES = fs.readdirSync("data/sec").filter((f) => /^factset-fixture-.+\.json$/.test(f)).map((f) => f.slice(16, -5));
const viewOf = (M, sym) => M.buildSecEarningsView(JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8")));

// A synthetic base: `now` and `then` per line, labelled like a quarter.
const B = (now, then, extra = {}) => ({ now, then, label: "Q1 FY2025", revenueIncomplete: false, ...extra });
const NONE = { now: false, then: false };

/** The row of the income card whose label is `label`, up to the row's end. */
const rowOf = (h, label) => {
  // THE LINE WHEREVER IT SITS (#552 COWORK #168): a table row, or — for the
  // lines down to operating income — the bar that now carries its figure,
  // mark and note.
  const i = h.indexOf(`min-width:0">${label}<`);
  if (i >= 0) return h.slice(i, h.indexOf("</div></div>", i));
  const b = h.indexOf(`<span class="wfLabel">${label}</span>`);
  if (b < 0) return null;
  const next = h.indexOf("data-wf-key=", b + 1);
  return h.slice(b, next < 0 ? h.indexOf("</div></div>", b) : next);
};

const RULES = {
  // ── THE PURE RULES ──────────────────────────────────────────────────────
  "seasonal: a Q1 up on last year's Q1 is green, whatever the quarter before it did": (M) => {
    const t = M.lineTrend("revenue", B({ revenue: 120 }, { revenue: 100 }), NONE);
    return t.trend === "improved" && t.kind === "pct" && Math.abs(t.pct - 20) < 1e-9;
  },
  "the band: within ±3% reads little change, beyond it takes a colour": (M) =>
    M.lineTrend("revenue", B({ revenue: 102.9 }, { revenue: 100 }), NONE).trend === "flat"
    && M.lineTrend("revenue", B({ revenue: 97.1 }, { revenue: 100 }), NONE).trend === "flat"
    && M.lineTrend("revenue", B({ revenue: 104 }, { revenue: 100 }), NONE).trend === "improved"
    && M.lineTrend("revenue", B({ revenue: 96 }, { revenue: 100 }), NONE).trend === "weaker",
  "a cost is read as a share of revenue: a cost that rose but fell as a share is green": (M) => {
    // 60 of 120 (50%) vs 55 of 100 (55%): the raw cost rose 9%, its share fell.
    const t = M.lineTrend("costOfRevenue", B({ revenue: 120, costOfRevenue: 60 }, { revenue: 100, costOfRevenue: 55 }), NONE);
    return t.trend === "improved" && t.kind === "share" && Math.abs(t.shareNow - 50) < 1e-9 && Math.abs(t.shareThen - 55) < 1e-9;
  },
  "a cost that grew faster than revenue is red": (M) =>
    M.lineTrend("sellingGeneralAndAdministrative", B({ revenue: 100, sellingGeneralAndAdministrative: 30 }, { revenue: 100, sellingGeneralAndAdministrative: 20 }), NONE).trend === "weaker",
  "the share count: fewer is green (buybacks), more is red (dilution)": (M) =>
    M.lineTrend("sharesDiluted", B({ sharesDiluted: 95 }, { sharesDiluted: 100 }), NONE).trend === "improved"
    && M.lineTrend("sharesDiluted", B({ sharesDiluted: 105 }, { sharesDiluted: 100 }), NONE).trend === "weaker",
  "a sign flip is coloured by the improvement, in words, not a %": (M) => {
    const up = M.lineTrend("netIncome", B({ netIncome: 10 }, { netIncome: -5 }), NONE);
    const down = M.lineTrend("operatingIncome", B({ operatingIncome: -5 }, { operatingIncome: 10 }), NONE);
    const smaller = M.lineTrend("netIncome", B({ netIncome: -5 }, { netIncome: -10 }), NONE);
    const larger = M.lineTrend("netIncome", B({ netIncome: -10 }, { netIncome: -5 }), NONE);
    return up.trend === "improved" && up.kind === "flip" && up.words === "from a loss to a profit"
      && down.trend === "weaker" && down.words === "from a profit to a loss"
      && smaller.trend === "improved" && smaller.words === "a smaller loss"
      && larger.trend === "weaker" && larger.words === "a larger loss";
  },
  "a flagged one-off in either period: no colour below operating income, and the note says why": (M) => {
    const t = M.lineTrend("netIncome", B({ netIncome: 200 }, { netIncome: 100 }), { now: false, then: true });
    const op = M.lineTrend("operatingIncome", B({ operatingIncome: 200 }, { operatingIncome: 100 }), { now: false, then: true });
    return t.trend === null && /one-off/.test(t.reason) && /Q1 FY2025/.test(t.reason) && op.trend === "improved";
  },
  "a period the one-off rule could not run on is not 'none': no colour below operating income": (M) => {
    const t = M.lineTrend("epsDiluted", B({ epsDiluted: 2 }, { epsDiluted: 1 }), { now: "unchecked", then: false });
    return t.trend === null && /can't be checked/.test(t.reason);
  },
  "no figure for the base period: no colour, and the note names the period": (M) => {
    const t = M.lineTrend("grossProfit", B({ grossProfit: 50 }, { grossProfit: null }), NONE);
    return t.trend === null && /no figure for Q1 FY2025/.test(t.reason);
  },
  "an incomplete revenue line: no colour on revenue and the lines read against it, the rest still coloured": (M) => {
    const base = B({ revenue: 120, costOfRevenue: 60, operatingIncome: 20 }, { revenue: 100, costOfRevenue: 55, operatingIncome: 10 }, { revenueIncomplete: true });
    return M.lineTrend("revenue", base, NONE).trend === null
      && M.lineTrend("costOfRevenue", base, NONE).trend === null
      && M.lineTrend("operatingIncome", base, NONE).trend === "improved";
  },
  "tax, interest, other income and noncontrolling interest take no colour": (M) =>
    ["incomeTaxExpense", "interestExpense", "nonOperatingIncomeExpense", "netIncomeToNoncontrollingInterest"]
      .every((k) => M.lineTrend(k, B({ [k]: 200 }, { [k]: 100 }), NONE).reason === M.NO_COLOUR_LINE),

  // ── THE VIEW: THE BASE IS THE SAME PERIOD A YEAR EARLIER ───────────────
  "on every fixture, the base is the same quarter a year earlier, or the prior fiscal year": (M) => FIXTURES.every((sym) => {
    const v = viewOf(M, sym);
    const b = v.incomeTrendBase;
    if (!b) return true;
    const q = /^(Q\d) FY(\d{4})$/.exec(b.nowLabel), q0 = /^(Q\d) FY(\d{4})$/.exec(b.label);
    const y = /^FY(\d{4})$/.exec(b.nowLabel), y0 = /^FY(\d{4})$/.exec(b.label);
    // A filer labelled by period end (SPCX): the base ends 11-13 months earlier.
    const d = /^\d{4}-\d{2}-\d{2}$/.test(b.nowLabel) && /^\d{4}-\d{2}-\d{2}$/.test(b.label)
      ? (Date.parse(b.nowLabel) - Date.parse(b.label)) / 86400000 : null;
    return b.nowLabel === v.latestLabel && (q && q0 ? q[1] === q0[1] && Number(q[2]) - Number(q0[2]) === 1
      : y && y0 ? Number(y[1]) - Number(y0[1]) === 1
        : d !== null ? d >= 335 && d <= 396 : false);
  }),

  // ── THE CARD ───────────────────────────────────────────────────────────
  "AAPL: the key line under the title names the base and says costs are read as a share of revenue": (M) => {
    const v = viewOf(M, "AAPL");
    const h = html(React.createElement(M.SecIncomeStatementCard, { view: v }));
    const key = /data-trend-key=""[^>]*>([\s\S]*?)<\/p>/.exec(h);
    const t = key ? visibleText(key[1]) : "";
    return Boolean(v.incomeTrendBase) && t.includes(`vs ${v.incomeTrendBase.label}.`) && t.includes(M.TREND_KEY_WORDS)
      && /Improved/.test(t) && /Little change/.test(t) && /Weaker/.test(t) && !/\bbuy\b|\bsell\b/i.test(t);
  },
  "AAPL: revenue carries a glyph and a note giving both figures and the change; tax carries neither": (M) => {
    const h = html(React.createElement(M.SecIncomeStatementCard, { view: viewOf(M, "AAPL") }));
    const rev = rowOf(h, "Revenue"), tax = rowOf(h, "Income tax");
    return Boolean(rev) && /data-trend-glyph=""[^>]*>[▲●▼]</.test(rev)
      && /data-estimate-note="\$[\d.]+[MBT] vs \$[\d.]+[MBT] in Q\d FY\d{4}, (up \d+\.\d%|down \d+\.\d%|little change \(within ±3%\))\."/.test(rev)
      && Boolean(tax) && !/data-trend-glyph/.test(tax) && !/data-estimate-note/.test(tax);
  },
  "no glyph can be read as a minus sign on the figure beside it": (M) => !Object.values(M.TREND_GLYPH).some((g) => /[-–—−]/.test(g)),
  "never colour alone: every coloured figure on every fixture has a glyph": (M) => FIXTURES.every((sym) => {
    const h = html(React.createElement(M.SecIncomeStatementCard, { view: viewOf(M, sym) }));
    const spans = [...h.matchAll(/data-line-trend="(improved|flat|weaker)">([\s\S]*?)<\/span><\/span><\/span>|data-line-trend="(improved|flat|weaker)">([\s\S]*?)<\/span><\/span>/g)];
    return spans.every((m) => /data-trend-glyph/.test(m[2] ?? m[4]));
  }),
  "a loss keeps its minus sign in red, beside a green ▲ when it is a smaller loss": (M) => {
    const v = structuredClone(viewOf(M, "AAPL"));
    v.incomeTrendBase.now.netIncome = -5e9;
    v.incomeTrendBase.then.netIncome = -8e9;
    v.incomeTrendBase.oneOff = { now: false, then: false };
    v.incomeStatement = v.incomeStatement.map((c) => (c.key === "netIncome" ? { ...c, val: -5e9, derivedNote: null } : c));
    const row = rowOf(html(React.createElement(M.SecIncomeStatementCard, { view: v })), "Net income");
    return Boolean(row) && /data-trend-glyph=""[^>]*color:#22c55e[^>]*>▲</.test(row)
      && /color:#ef4444[^>]*>-\$5\.00B</.test(row) && /a smaller loss\./.test(row);
  },
  "a converted filer's note names no figures in the wrong currency": (M) => {
    const v = structuredClone(viewOf(M, "AAPL"));
    const rev = v.incomeStatement.find((c) => c.key === "revenue");
    v.incomeTrendBase.now.revenue = rev.val * 150; // as if stored in yen
    v.incomeTrendBase.then.revenue = rev.val * 140;
    const row = rowOf(html(React.createElement(M.SecIncomeStatementCard, { view: v })), "Revenue");
    return Boolean(row) && /in the company&#x27;s reporting currency|in the company's reporting currency/.test(row) && !/vs \$/.test(row);
  },
};

const M0 = await loadCards();
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(M0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}

// ── THE TONE MIX ACROSS THE FIXTURES (the band's measurement) ───────────
const mix = { improved: 0, flat: 0, weaker: 0, none: 0 };
for (const sym of FIXTURES) {
  const v = viewOf(M0, sym);
  if (!v.incomeTrendBase) continue;
  for (const c of v.incomeStatement) {
    if (c.val == null) continue;
    const t = M0.lineTrend(c.key, v.incomeTrendBase, v.incomeTrendBase.oneOff);
    if (t.trend === null && t.reason === M0.NO_COLOUR_LINE) continue;
    mix[t.trend ?? "none"]++;
  }
}
const coloured = mix.improved + mix.flat + mix.weaker;
console.log(`  tone mix on ${FIXTURES.length} fixtures, directional lines: improved ${mix.improved}, little change ${mix.flat}, weaker ${mix.weaker}, no colour ${mix.none}`);
check("the ±3% band does not swallow most rows (little change under half of the coloured lines)", coloured > 0 && mix.flat / coloured < 0.5,
  `${mix.flat}/${coloured}`);

const MUTANTS = [
  ["the band at 0%", once("export const LINE_TREND_FLAT_PCT = 3;", "export const LINE_TREND_FLAT_PCT = 0;")],
  ["costs read raw, not as a share of revenue", once("if (COST_SHARE.has(key)) {", "if (false) {")],
  ["the share count read as higher-is-better", once("return { trend: lineBand(pct, false), kind: \"pct\", pct };", "return { trend: lineBand(pct, true), kind: \"pct\", pct };")],
  ["a sign flip read as a % change", once("if (then < 0 && now >= 0) return { trend: \"improved\", kind: \"flip\"", "if (false) return { trend: \"improved\", kind: \"flip\"")],
  ["one-offs ignored", once("if (oneOff.now === true || oneOff.then === true) {", "if (false) {")],
  ["an unchecked period read as none", once("if (oneOff.now === \"unchecked\" || oneOff.then === \"unchecked\") {", "if (false) {")],
  ["an incomplete revenue line ignored", once("if (READ_AGAINST_REVENUE.has(key) && base.revenueIncomplete) {", "if (false) {")],
  ["tax coloured as higher-is-better", once("export const HIGHER_BETTER = new Set([", "export const HIGHER_BETTER = new Set([\"incomeTaxExpense\", \"interestExpense\", \"nonOperatingIncomeExpense\", \"netIncomeToNoncontrollingInterest\", ")],
  ["the base a quarter back, not a year", once("label: periodLabel(yearAgo),\n            nowLabel", "label: periodLabel(q.find((p) => p !== latest) ?? yearAgo),\n            nowLabel")],
  ["the key line dropped", once("{base ? <TrendKey label={base.label} /> : null}", "")],
  ["the little-change glyph a dash again (reads as a minus)", once("flat: \"●\"", "flat: \"–\"")],
  ["the glyph dropped (colour alone)", once("{glyph ? (", "{false ? (")],
  ["a loss printed in its trend colour", once("const ink = v < 0 ? LOSS_INK : ", "const ink = ")],
  ["a converted filer's note printing home-currency figures as dollars", once("const vs = sameUnits && then != null", "const vs = then != null")],
];
for (const [label, mutate] of MUTANTS) {
  let bites = false;
  try {
    const Mm = await loadCards(mutate);
    bites = Object.values(RULES).some((r) => { try { return !r(Mm); } catch { return true; } });
  } catch (e) { bites = !/mutation anchor/.test(String(e?.message)); if (!bites) console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, bites);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
