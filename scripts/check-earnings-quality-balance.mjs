// THE QUALITY-OF-EARNINGS AND BALANCE-SHEET CARDS (#552 COWORK #169, owner pick).
//
// Each card answers its own title. Rendered from the committed fact sets, plus
// synthetic views where no fixture has the shape (named below). What must hold:
//
//   Quality of earnings
//   Q1. the lead line follows the figures: OCF ≥ net income "ahead" (green),
//       below "behind" (amber), net income ≤ 0 the loss line, with no ratio;
//   Q2. four tiles as percentages — AAPL 115% / 107% / 7% / 11% — the first
//       two green at ≥ 100% (amber below), the other two in neutral ink;
//   Q3. never a % of a figure at or below zero: n/m and the dollar figure
//       (WKHS: a loss; synthetic AAPL with negative free cash flow);
//   Q4. the chart: fixed 0–200% (KGC FY2021 at 513% drawn to the top with its
//       true label), a loss period a marker and no bar (KGC FY2022), hidden with
//       one line under 4 usable periods (synthetic AAPL, 3 periods);
//   Balance sheet
//   B1. the lead line: net debt red (AAPL $19.95B), net cash green (TSLA),
//       "cash" alone when short-term investments are missing (WKHS);
//   B2. one shared scale, the gap box on the longer bar's side (AAPL: cash
//       $39.54B + inv. $22.86B against debt $82.35B; TSLA the other way);
//   B3. the current-ratio meter clamps at 3 and prints the true value (AVAV 4.26);
//   Both
//   X1. one "About these figures" per card, every fixture;
//   X2. no rating or advice words; the chart is aria-hidden with a text version.
// plus MUTANTS, one per rule, each caught. A missing mutation anchor fails.
//
//   node scripts/check-earnings-quality-balance.mjs
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
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const SYMS = ["AAPL", "WKHS", "KGC", "TSLA", "AVAV", "ONDS", "GEV", "BYND"];
const SETS = Object.fromEntries(SYMS.map((s) => [s, fixture(s)]));

function measure(M) {
  const views = Object.fromEntries(SYMS.map((s) => [s, M.buildSecEarningsView(SETS[s])]));
  const cash = (v) => html(el(M.SecCashQualityCard, { view: v }));
  const bal = (v) => html(el(M.SecBalanceSheetCard, { view: v }));
  const A = views.AAPL;
  // SYNTHETIC SHAPES no fixture has, each a copy of AAPL's view with one figure moved.
  const behind = structuredClone(A); behind.cashQuality.operatingCashFlow.val = A.cashQuality.netIncome.val * 0.8;
  const negFcf = structuredClone(A); negFcf.cashQuality.freeCashFlow = -5e9;
  const few = structuredClone(A); few.cashHistory = A.cashHistory.slice(-3);
  // INTC'S SHAPE (#552 COWORK #176): a loss quarter with positive operating and
  // free cash flow, OCF derived from year-to-date filings; and a snapshot whose
  // EPS growth is the word "Loss both periods".
  const intc = structuredClone(A);
  intc.cashQuality.netIncome.val = -11.03e9;
  intc.cashQuality.operatingCashFlow.val = 7.01e9;
  intc.cashQuality.operatingCashFlow.derivedNote = "Derived: the quarter is the year-to-date figure less the previous one.";
  intc.cashQuality.freeCashFlow = 4.45e9;
  const lossBoth = structuredClone(A); lossBoth.snapshot.epsYoY = "loss-both";
  // #552 COWORK #188: TSLA's shape (217%-825%, over the 300% cap) and TXN's
  // (72%-194%, under it), on AAPL's eight labels, net income $1B a period.
  const withPcts = (pcts) => { const v = structuredClone(A); v.cashHistory = A.cashHistory.slice(-pcts.length).map((h, i) => ({ ...h, netIncome: 1e9, ocf: pcts[i] * 1e7 })); return v; };
  const TSLA_PCTS = [217, 288, 454, 527, 610, 700, 760, 825], TXN_PCTS = [72, 95, 110, 130, 150, 170, 185, 194];
  return {
    views,
    cash: Object.fromEntries(SYMS.map((s) => [s, cash(views[s])])),
    bal: Object.fromEntries(SYMS.map((s) => [s, bal(views[s])])),
    behind: cash(behind), negFcf: cash(negFcf), few: cash(few), intc: cash(intc),
    tslaConv: cash(withPcts(TSLA_PCTS)), txnConv: cash(withPcts(TXN_PCTS)), convLabels: A.cashHistory.slice(-8).map((h) => h.label),
    snap: html(el(M.SecSnapshotCard, { view: lossBoth, pending: null })),
    toneColor: M.toneColor,
  };
}
const tile = (h, label) => (h.split(`data-ratio-tile="${label}"`)[1] ?? "").split('data-ratio-tile="')[0];
const value = (t) => (t.match(/class="metricValue"[^>]*>([^<]*)</) ?? [])[1] ?? "";
const slot = (h, label) => (h.split(`data-bar="${label}"`)[1] ?? "").split("data-bar=")[0];
const leadOf = (h) => h.match(/<p class="qualityLead" data-lead="([^"]+)">([\s\S]*?)<\/p>/);
const RATING = /\b(good|bad|healthy|strong|weak|buy|sell|hold|risky|safe|should)\b/i;

const RULES = {
  "Q1a. OCF ≥ net income: 'ahead of reported profit', green (AAPL)": (m) => {
    const l = leadOf(m.cash.AAPL);
    return l?.[1] === "ahead" && /color:#22c55e[^>]*>ahead of reported profit</.test(l[2].replace(/;/g, "")) === false
      ? false : l?.[1] === "ahead" && l[2].includes(`color:${m.toneColor("good")}`) && /ahead of reported profit/.test(l[2]);
  },
  "Q1b. OCF below net income: 'behind reported profit', amber (synthetic AAPL)": (m) => {
    const l = leadOf(m.behind);
    return l?.[1] === "behind" && l[2].includes(`color:${m.toneColor("neutral")}`) && /behind reported profit/.test(l[2]);
  },
  "Q1c. a loss: the loss line with the signed cash figure, and no ratio (WKHS)": (m) => {
    const l = leadOf(m.cash.WKHS);
    return l?.[1] === "loss" && /reported a loss/.test(visibleText(l[2])) && /[−+]\$/.test(visibleText(l[2])) && !/%/.test(l[2]);
  },
  "Q2a. AAPL's four tiles read 115% / 107% / 7% / 11%": (m) =>
    ["Operating cash flow", "Free cash flow", "Spent on equipment", "Paid in shares"].map((t) => value(tile(m.cash.AAPL, t))).join(" ") === "115% 107% 7% 11%",
  "Q2b. the first two green at ≥ 100%; the other two carry no ink at all": (m) => {
    const g = m.toneColor("good");
    return tile(m.cash.AAPL, "Operating cash flow").includes(`color:${g}`) && tile(m.cash.AAPL, "Free cash flow").includes(`color:${g}`)
      && !/class="metricValue" style=/.test(tile(m.cash.AAPL, "Spent on equipment")) && !/class="metricValue" style=/.test(tile(m.cash.AAPL, "Paid in shares"))
      && !/background:/.test((tile(m.cash.AAPL, "Spent on equipment").match(/^[^>]*>/) ?? [""])[0]);
  },
  "Q2c. below 100% the tile is amber, not green (synthetic AAPL, OCF at 80%)": (m) =>
    value(tile(m.behind, "Operating cash flow")) === "80%" && tile(m.behind, "Operating cash flow").includes(`color:${m.toneColor("neutral")}`),
  "Q3a. a loss: the cash tiles show n/m and the dollar figure, never a % (WKHS)": (m) => {
    const o = tile(m.cash.WKHS, "Operating cash flow"), f = tile(m.cash.WKHS, "Free cash flow");
    return /n\/m: net income was a loss/.test(o) && /n\/m: net income was a loss/.test(f) && !/%/.test(value(o)) && !/%/.test(value(f)) && /\$/.test(visibleText(o));
  },
  "Q3b. negative free cash flow: 'Paid in shares' is n/m, not a % (synthetic AAPL)": (m) => {
    const t = tile(m.negFcf, "Paid in shares");
    return /n\/m: free cash flow was negative/.test(t) && !/%/.test(value(t));
  },
  "Q3c. across every fixture, no tile prints a % of a figure at or below zero": (m) => SYMS.every((s) => {
    const c = m.views[s].cashQuality;
    const n = (v) => (typeof v === "number" ? v : null);
    const ocf = n(c.operatingCashFlow.val), ni = n(c.netIncome.val), fcf = n(c.freeCashFlow);
    const pairs = [["Operating cash flow", ni], ["Free cash flow", ni], ["Spent on equipment", ocf], ["Paid in shares", fcf]];
    return pairs.every(([t, of]) => !(of !== null && of <= 0) || !/%/.test(value(tile(m.cash[s], t))));
  }),
  "Q4a. a period over the 300% cap is drawn to the top, with a break mark and its true label (KGC FY2021, 513%)": (m) => {
    const g = slot(m.cash.KGC, "FY2021");
    return /^[^>]*data-height="100\.00"/.test(g) && /data-clamped="1"/.test(g) && /data-break=""/.test(g) && />513%</.test(g) && /class="convBar"/.test(g);
  },
  "Q4d. TSLA's shape (217%-825%): heights ordered by value up to the 300% cap, the capped bars break-marked, 100% line at a third (#552 COWORK #188)": (m) => {
    const h = m.convLabels.map((l) => slot(m.tslaConv, l));
    const height = (g) => Number((g.match(/data-height="([\d.]+)"/) ?? [])[1]);
    const ordered = height(h[0]) < height(h[1]) && height(h[1]) < height(h[2]) && Math.abs(height(h[0]) - 72.33) < 0.01;
    const capped = h.slice(2).every((g) => height(g) === 100 && /data-clamped="1"/.test(g) && /data-break=""/.test(g));
    const notCapped = h.slice(0, 2).every((g) => /data-clamped="0"/.test(g) && !/data-break=""/.test(g));
    return ordered && capped && notCapped && /data-line-100=""[^>]*\* 0\.3333/.test(m.tslaConv) && />825%</.test(h[7]);
  },
  "Q4e. TXN's shape (72%-194%): the top follows the data (200%), no break marks, 100% line at half": (m) => {
    const h = m.convLabels.map((l) => slot(m.txnConv, l));
    return /data-height="97\.00"/.test(h[7]) && !/data-break=""/.test(m.txnConv) && /data-line-100=""[^>]*\* 0\.5000/.test(m.txnConv);
  },
  "Q4f. the tap says bars above 300% are cut short and the label shows the real figure": (m) =>
    /bars above 300% are cut short; the label shows the real figure/.test(m.cash.AAPL.replace(/<!-- -->/g, "")),
  "Q4b. a loss period: a 'loss' marker and no bar (KGC FY2022)": (m) => {
    const g = slot(m.cash.KGC, "FY2022");
    return /^[^>]*data-loss="1"/.test(g) && !/class="convBar"/.test(g) && />loss</.test(g);
  },
  "Q4c. fewer than 4 usable periods: no chart, one line saying why (synthetic AAPL)": (m) =>
    !/data-conversion-chart/.test(m.few) && /data-conversion-hidden="">Fewer than 4 quarters/.test(m.few) && /data-conversion-chart/.test(m.cash.AAPL),
  "B1a. net debt: red, AAPL $19.95B": (m) => {
    const l = leadOf(m.bal.AAPL);
    return l?.[1] === "net-debt" && l[2].includes(`color:${m.toneColor("weak")}`) && /Debt is larger than cash and short-term investments:/.test(visibleText(l[2])) && /net debt of \$19\.95B/.test(visibleText(l[2]));
  },
  "B1b. net cash: green (TSLA)": (m) => {
    const l = leadOf(m.bal.TSLA);
    return l?.[1] === "net-cash" && l[2].includes(`color:${m.toneColor("good")}`) && /Cash and short-term investments are larger than debt: net cash of \$/.test(visibleText(l[2]));
  },
  "B1c. short-term investments missing: the lead says 'cash' (WKHS)": (m) =>
    /Debt is larger than cash: net debt of \$/.test(visibleText(leadOf(m.bal.WKHS)?.[2] ?? "")) && !/data-seg="sti"/.test(m.bal.WKHS),
  "B2a. one scale: AAPL's segments are cash 48.0% + inv. 27.8% of the debt bar's 100%": (m) =>
    /data-seg="cash" data-pct="48\.0\d"/.test(m.bal.AAPL) && /data-seg="sti" data-pct="27\.7\d"/.test(m.bal.AAPL) && /data-seg="debt" data-pct="100\.00"/.test(m.bal.AAPL),
  "B2b. the gap box sits on the longer bar's side, labelled with the net figure": (m) =>
    /data-gap-side="debt"/.test(m.bal.AAPL) && /data-gap-label="debt"[^>]*>net debt \$19\.95B</.test(m.bal.AAPL.replace(/<!-- -->/g, ""))
      && /data-gap-side="cash"/.test(m.bal.TSLA) && /data-gap-label="cash"[^>]*>net cash \$/.test(m.bal.TSLA.replace(/<!-- -->/g, "")),
  "B3. the current-ratio meter: the dot clamps at 3, the true value is printed (AVAV 4.26)": (m) =>
    /data-meter-dot="100\.00" data-clamped="1"/.test(m.bal.AVAV) && /data-ratio-value="">4\.26</.test(m.bal.AVAV)
      && /data-meter-dot="33\.\d+" data-clamped="0"/.test(m.bal.AAPL) && /1\.0 · just covered/.test(m.bal.AAPL),
  "Q5a. n/m tile (INTC): the big line is the figure ALONE; the rest is the small line, 'derived' first": (m) => {
    const t = tile(m.intc, "Operating cash flow");
    const big = (t.match(/class="metricValue" data-tile-figure="">([\s\S]*?)<\/div>/) ?? [])[1] ?? "";
    const small = visibleText((t.match(/data-not-meaningful="">([\s\S]*?)<\/div>/) ?? [])[1] ?? "");
    return visibleText(big) === "$7.01B" && /^derived vs net income [−-]\$11\.03B · n\/m: net income was a loss$/.test(small);
  },
  "Q5b. ...the same for free cash flow: '$4.45B' big, 'after equipment · n/m: …' small": (m) => {
    const t = tile(m.intc, "Free cash flow");
    return visibleText((t.match(/data-tile-figure="">([\s\S]*?)<\/div>/) ?? [])[1] ?? "") === "$4.45B"
      && /^(derived )?after equipment · n\/m: net income was a loss$/.test(visibleText((t.match(/data-not-meaningful="">([\s\S]*?)<\/div>/) ?? [])[1] ?? ""));
  },
  "S1. a snapshot word value ('Loss both periods') is drawn as a word; a number is not": (m) =>
    /<div class="metricValue metricWord">[\s\S]{0,400}?Loss both periods/.test(m.snap)
      && /<div class="metricLabel">Revenue<\/div><div class="metricValue">/.test(m.snap),
  "X1. one 'About these figures' per card, every fixture": (m) =>
    SYMS.every((s) => [m.cash[s], m.bal[s]].every((h) => (h.match(/<summary>About these figures<\/summary>/g) ?? []).length === 1)),
  "X2a. no rating or advice words on either card, every fixture": (m) =>
    SYMS.every((s) => !RATING.test(visibleText(m.cash[s])) && !RATING.test(visibleText(m.bal[s]))),
  "X2b. the chart is aria-hidden, with a visually hidden text version": (m) =>
    /class="convChart" aria-hidden="true"/.test(m.cash.AAPL) && /<ul class="srOnly"><li>[^<]*/.test(m.cash.AAPL) && /data-balance-legend/.test(m.bal.AAPL),
};

const real = measure(await loadCards());
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(real)); } catch (e) { console.log(`    ${e.message}`); }
  check(name, ok);
}

const MUTANTS = [
  ["the n/m tile's big line is the whole dollar line again (INTC overflow)", (s) => once(s, 'data-tile-figure="">{figure}</div>', 'data-tile-figure="">{dollars}</div>')],
  ["the snapshot's word value drawn at the figure size again", (s) => once(s, "word={!isNumberPct(s.epsYoY)}", "word={false}")],
  ["the lead's comparison reversed", (s) => once(s, `kind: ocf >= netIncome ? "ahead" : "behind"`, `kind: ocf <= netIncome ? "ahead" : "behind"`)],
  ["a loss no longer gets its own lead line", (s) => once(s, `  if (netIncome <= 0) return { kind: "loss", ocf, netIncome };\n`, "")],
  ["the n/m guard dropped (a % of a negative figure)", (s) => once(s, `  if (of <= 0) return { ok: false, why: "not-meaningful" };\n`, "")],
  ["green from 0% instead of 100%", (s) => once(s, `return s.pct >= 100 ? "good" : "neutral";`, `return s.pct >= 0 ? "good" : "neutral";`)],
  ["capex and share-based pay inked too", (s) => once(s, `if (!s.ok || tile === "capex" || tile === "sbc") return null;`, `if (!s.ok) return null;`)],
  ["the fixed 200% clip restored (#552 COWORK #188)", (s) => once(s, "const top = Math.min(CONVERSION_MAX_PCT, Math.max(100, Math.ceil(high / CONVERSION_TOP_STEP) * CONVERSION_TOP_STEP));", "const top = 200;")],
  ["the 300% cap removed", (s) => once(s, "const top = Math.min(CONVERSION_MAX_PCT, Math.max(100, Math.ceil(high / CONVERSION_TOP_STEP) * CONVERSION_TOP_STEP));", "const top = Math.max(100, Math.ceil(high / CONVERSION_TOP_STEP) * CONVERSION_TOP_STEP);")],
  ["the break mark dropped", (s) => once(s, `{b.clamped ? <span className="convBreak" data-break="" /> : null}`, "{null}")],
  ["the 100% line on the cap's scale, not the plot's", (s) => once(s, "const linePct = (100 / top) * 100;", "const linePct = (100 / CONVERSION_MAX_PCT) * 100;")],
  ["a loss period no longer marked", (s) => once(s, "const loss = h.netIncome !== null && h.netIncome <= 0;", "const loss = false;")],
  ["the chart shown with too few periods", (s) => once(s, "if (usable < CONVERSION_MIN_PERIODS) {", "if (usable < 1) {")],
  ["net cash and net debt swapped", (s) => once(s, `return net >= 0 ? { kind: "cash", amount: net } : { kind: "debt", amount: -net };`, `return net < 0 ? { kind: "cash", amount: -net } : { kind: "debt", amount: net };`)],
  ["the gap box on the wrong side", (s) => once(s, `kind: net >= 0 ? "cash" : "debt", amount: Math.abs(net)`, `kind: net >= 0 ? "debt" : "cash", amount: Math.abs(net)`)],
  ["each bar on its own scale", (s) => once(s, "const scale = Math.max(liquid, d);", "const scale = Math.max(liquid, 1);")],
  ["the lead says 'cash and short-term investments' with none filed", (s) => once(s, `const liquidWords = stiMissing ? "cash" : "cash and short-term investments";`, `const liquidWords = "cash and short-term investments";`)],
  ["the current-ratio clamp removed", (s) => once(s, "const v = Math.min(Math.max(ratio, 0), RATIO_METER_MAX);", "const v = Math.max(ratio, 0);")],
  ["a second 'About these figures' on the balance card", (s) => once(s, `        <p data-fine-print="">Source: {SEC_ATTRIBUTION}.</p>\n      </CardDetails>\n    </section>\n  );\n}\n\n/** Whether any figure on the balance sheet card`, `        <p data-fine-print="">Source: {SEC_ATTRIBUTION}.</p>\n      </CardDetails>\n      <CardDetails><p>Again.</p></CardDetails>\n    </section>\n  );\n}\n\n/** Whether any figure on the balance sheet card`)],
  ["a rating word in the lead", (s) => once(s, `{lead.kind === "ahead" ? "ahead of reported profit" : "behind reported profit"}`, `{lead.kind === "ahead" ? "ahead of reported profit, a good sign" : "behind reported profit"}`)],
  ["the chart's text version dropped", (s) => once(s, `<ul className="srOnly">`, `<ul className="gone">`)],
];
console.log("\nmutants: each must break a rule");
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
