// THE EARNINGS PAGE LAYOUT AND THE INCOME STATEMENT'S BARS (#552 COWORK #166,
// #168; owner requests).
//
//   #166  Growth & Margins leads the main column; the latest-earnings snapshot
//         leads the right column, above "What it means"; on a phone (≤ 980px,
//         the page's one-column breakpoint) the columns step aside and the
//         cards order Next report → Growth & Margins → snapshot → the rest
//         (C's pattern, check-stock-phone-order). The snapshot's tiles run two
//         across in the right column, one across where the card is narrow,
//         and a figure never wraps. Each card renders at most one "About these
//         figures".
//   #168  The income statement's bars are the top of the statement: every
//         line down to operating income is a bar carrying its row's figure,
//         ▲ ● ▼ mark and tap note; gross profit is a subtotal bar; other
//         operating expense is a bar when reported, a fine-print line when
//         not; the table starts at "Below operating income". Lossless: with
//         no bars (the gate refuses) every line stays in the table.
// The cards are RENDERED from the committed fact-set fixtures
// (scripts/lib/render-cards.mjs); the page layout is read from its source.
// A mutant for each rule.
//
//   node scripts/check-earnings-layout.mjs
import fs from "node:fs";
import { loadCards, html, React } from "./lib/render-cards.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times, needs exactly 1: ${from.slice(0, 70)}`);
  return src.replace(from, to);
};
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const DRAWN = ["AAPL", "AUR", "AVAV", "AXTI", "BYND", "GEV", "TSLA", "WKHS"];
const REFUSED = ["AZN", "KTOS", "SPCX"];
const ALL = [...DRAWN, ...REFUSED];
const SUMMARY = /<summary[^>]*>About these figures<\/summary>/g;
const BAR_KEYS = ["revenue", "costOfRevenue", "grossProfit", "researchAndDevelopment", "sellingGeneralAndAdministrative", "otherOperatingExpense", "operatingIncome"];

const text = (markup) => markup.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
const income = (M, view) => html(React.createElement(M.SecIncomeStatementCard, { view }));
/** The table's rows (label → value markup), in order. */
const tableRows = (h) => {
  const t = h.slice(h.lastIndexOf("</details>"));
  return [...t.matchAll(/<div style="display:flex;justify-content:space-between[^>]*><div style="[^"]*min-width:0">(.*?)<\/div><div style="[^"]*">(.*?)<\/div><\/div>/g)]
    .map(([, label, value]) => ({ label: text(label), labelHtml: label, value }));
};
/** The bars (key → label/value markup). */
const barRows = (h) => Object.fromEntries([...h.matchAll(/data-wf-key="(\w+)"><span class="wfLabel">(.*?)<\/span><div class="wfTrack">.*?<\/div><span class="wfValue">(.*?)<\/span><\/div>/g)]
  .map(([, key, labelHtml, value]) => [key, { labelHtml, label: text(labelHtml), value }]));
/** The same view with the gate refused: every line in the table, as the card printed it before #168. */
const refused = (v) => ({ ...structuredClone(v), incomeStatementComplete: false });

const RULES = {
  // ── #168: the bars carry the top of the statement ───────────────────────
  "every line down to operating income is a bar, its label exactly once in the card (drawn fixtures)": (M) => DRAWN.every((s) => {
    const v = M.buildSecEarningsView(fixture(s));
    const h = income(M, v), bars = barRows(h), rows = tableRows(h).map((r) => r.label);
    const { barKeys } = M.incomeBarRows(v);
    return [...barKeys].every((k) => {
      const label = v.incomeStatement.find((c) => c.key === k).label;
      // Exactly once in the card's visible text (#552 COWORK #168), as the bar.
      const n = text(h).split(label).length - 1;
      return bars[k]?.label === label && !rows.includes(label) && n === 1;
    });
  }),
  "each bar's figure, ▲ ● ▼ mark, tap note and label note are exactly its old table row's": (M) => DRAWN.every((s) => {
    const v = M.buildSecEarningsView(fixture(s));
    const bars = barRows(income(M, v));
    const old = Object.fromEntries(tableRows(income(M, refused(v))).map((r) => [r.label, r]));
    return Object.entries(bars).every(([k, b]) => {
      const label = v.incomeStatement.find((c) => c.key === k).label;
      return old[label] && old[label].value === b.value && old[label].labelHtml === b.labelHtml;
    });
  }),
  "gross profit is a subtotal bar (after cost of revenue)": (M) => DRAWN.every((s) => {
    const h = income(M, M.buildSecEarningsView(fixture(s)));
    return /<div class="wfRow wfSubtotal" data-wf-key="grossProfit">/.test(h)
      && h.indexOf('data-wf-key="costOfRevenue"') < h.indexOf('data-wf-key="grossProfit"')
      && h.indexOf('data-wf-key="grossProfit"') < h.indexOf('data-wf-key="researchAndDevelopment"');
  }),
  "other operating expense: the fine-print line when not reported (AAPL), no bar, no row": (M) => {
    const h = income(M, M.buildSecEarningsView(fixture("AAPL")));
    return /data-not-reported-line="otherOperatingExpense"[^>]*>Other operating expense: not reported</.test(h)
      && !/data-wf-key="otherOperatingExpense"/.test(h) && !tableRows(h).some((r) => r.label === "Other operating expense");
  },
  "...and a bar when reported (AAPL with 1B of other operating expense, operating income 1B lower)": (M) => {
    const v = structuredClone(M.buildSecEarningsView(fixture("AAPL")));
    v.incomeStatement = v.incomeStatement.map((c) => c.key === "otherOperatingExpense" ? { ...c, val: 1e9 }
      : c.key === "operatingIncome" ? { ...c, val: c.val - 1e9 } : c);
    const h = income(M, v);
    return /data-wf-key="otherOperatingExpense"/.test(h) && !/data-not-reported-line="otherOperatingExpense"/.test(h);
  },
  'the table starts at "Below operating income" where bars are drawn': (M) =>
    /<h4 data-below-operating="" class="incomeTableHeading">Below operating income<\/h4>/.test(income(M, M.buildSecEarningsView(fixture("AAPL")))),
  "lossless: with no bars, every line is in the table and there is no heading": (M) => [...REFUSED, "AAPL"].every((s) => {
    const v = s === "AAPL" ? refused(M.buildSecEarningsView(fixture(s))) : M.buildSecEarningsView(fixture(s));
    if (!v) return true;
    const h = income(M, v), rows = tableRows(h).map((r) => r.label);
    return !/data-wf-key=/.test(h) && !/Below operating income/.test(h) && v.incomeStatement.every((c) => rows.includes(c.label));
  }),
  // ── #166 §2 / #168 §3: one "About these figures" per card ───────────────
  'each card renders at most one "About these figures"': (M) => ALL.every((s) => {
    const v = M.buildSecEarningsView(fixture(s));
    if (!v) return true;
    const cards = [M.SecSnapshotCard, M.SecGrowthMarginsCard, M.SecIncomeStatementCard, M.SecAnnualCard, M.SecBalanceSheetCard, M.SecCashQualityCard, M.SecRecentPeriodsCard, M.SecTrendSummaryCard];
    return cards.every((C) => (html(React.createElement(C, { view: v })).match(SUMMARY) ?? []).length <= 1);
  }),
  "the Growth & Margins card keeps its one under the picture, with the source and crossing note merged in": (M) => {
    const h = html(React.createElement(M.SecGrowthMarginsCard, { view: M.buildSecEarningsView(fixture("AAPL")) }));
    const d = h.indexOf('class="gvAbout"');
    return d > 0 && h.indexOf("Source:", d) > d && h.indexOf("Source:", d) < h.indexOf("</details>", d) && h.indexOf("See all the numbers") > d;
  },
  "the snapshot's note and the Growth & Margins note do not say the same thing": (M) => {
    const v = M.buildSecEarningsView(fixture("AAPL"));
    const body = (h, start) => { const i = h.indexOf(start); return h.slice(i, h.indexOf("</details>", i)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); };
    const snap = body(html(React.createElement(M.SecSnapshotCard, { view: v })), "About these figures");
    const gm = body(html(React.createElement(M.SecGrowthMarginsCard, { view: v })), "About these figures");
    return snap.length > 0 && gm.length > 0 && snap !== gm;
  },
};

// ── #166 §1: the page layout, from the source ──────────────────────────────
const PAGE = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
const phoneBlock = (p) => (p.match(/@media \(max-width: 980px\) \{\s*\.contentGrid \{ gap: 18px; \}[\s\S]*?\n\s*\}/) ?? [""])[0];
const PAGE_RULES = {
  "the main column leads with Growth & Margins (after the next-report box); the snapshot is not in it": (p) => {
    const main = p.slice(p.indexOf('<div className="mainColumn"'), p.indexOf('<aside className="sideColumn">'));
    const branch = main.slice(main.indexOf("!secView ? <SecPendingCard"));
    const firstCard = (branch.match(/<(Sec\w+Card|HiddenCard)[ >]/g) ?? []).filter((t) => !t.startsWith("<HiddenCard") && !t.startsWith("<SecPendingCard"))[0];
    return firstCard === "<SecGrowthMarginsCard " && !/<SecSnapshotCard/.test(main);
  },
  'the right column leads with the snapshot, directly above "What it means"': (p) => {
    const side = p.slice(p.indexOf('<aside className="sideColumn">'));
    const snap = side.indexOf("<SecSnapshotCard"), means = side.indexOf("What it means");
    return snap > 0 && snap < means && !/<section className="card">/.test(side.slice(0, snap));
  },
  "the snapshot renders exactly when the main column's SEC cards do": (p) =>
    /const snapshotView =\s*!noRegistrant && data\.cold\.status !== "not-shown" && data\.cold\.status !== "not-issuer-equity" && data\.cold\.status !== "no-xbrl"\s*\? secView\s*: null;/.test(p),
  "phone order: the columns step aside and Next report → Growth & Margins → snapshot lead": (p) => {
    const b = phoneBlock(p);
    const ord = (c) => Number((b.match(new RegExp(`\\.${c} \\{ order: (-?\\d+); \\}`)) ?? [])[1]);
    // No inline display on the main column: it would beat display: contents.
    return /\.mainColumn, \.sideColumn \{ display: contents; \}/.test(b) && /<div className="mainColumn">/.test(p) && ord("orderNext") < ord("orderGrowth") && ord("orderGrowth") < ord("orderSnapshot") && ord("orderSnapshot") < 0
      && /<div className="orderGrowth"><SecGrowthMarginsCard/.test(p) && /<div className="orderSnapshot"><SecSnapshotCard/.test(p) && /<div className="orderNext"><NextReportCard/.test(p);
  },
  "desktop is untouched: no order or display: contents outside the phone block": (p) => {
    const rest = p.replace(phoneBlock(p), "");
    return !/(^|[\s;{])order: -?\d/.test(rest) && !/display: contents/.test(rest);
  },
  "the snapshot runs two across in the right column, one across when narrow, and no figure wraps": (p) =>
    /\.sideColumn \.snapshotGrid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/.test(p)
    && /\.snapshotGrid \.metricValue \{ white-space: nowrap; word-break: normal; \}/.test(p)
    && /\.snapshotCard \{ container-type: inline-size; \}/.test(p) && /@container \(max-width: 330px\) \{ \.snapshotGrid \{ grid-template-columns: 1fr !important; \} \}/.test(p),
};

const M0 = await loadCards();
console.log("#168 the income statement, and one disclosure per card");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(M0)); } catch (e) { console.log(`    ${e.message}`); }
  check(name, ok);
}
console.log("\n#166 the page layout");
for (const [name, rule] of Object.entries(PAGE_RULES)) check(name, Boolean(rule(PAGE)));

console.log("\nmutants: each must break a rule");
const CARD_MUTANTS = [
  ["the table keeps the bar rows (no removal)", once("const tableRows = view.incomeStatement.filter((c) => !barKeys.has(c.key) && !notReported.includes(c.key));", "const tableRows = view.incomeStatement;")],
  ["the bars print a different figure (no mark or note)", once("    return c ? { label: <NotedLabel label={c.label} note={c.sub} />, value: figure(c) } : { label: key, value: null };", "    return c ? { label: <NotedLabel label={c.label} note={c.sub} />, value: <>{c.val}</> } : { label: key, value: null };")],
  ["no gross-profit subtotal", once('subtotals.push({ afterKey: "costOfRevenue", key: "grossProfit", label: "Gross profit", value: running });', "")],
  ["the not-reported line dropped", once("const notReported = [\"researchAndDevelopment\", \"sellingGeneralAndAdministrative\", \"otherOperatingExpense\"]", "const notReported = ([] as string[])")],
  ["the heading dropped", once('{drawn ? <h4 data-below-operating="" className="incomeTableHeading">Below operating income</h4> : null}', "")],
  ["rows removed even with no bars (lossy)", once("if (!gate.ok) return { barKeys: new Set(), notReported: [] };", 'if (!gate.ok) return { barKeys: new Set(["revenue", "costOfRevenue", "operatingIncome"]), notReported: [] };')],
  ["the income card's second disclosure back", once('        {drawn ? <h4 data-below-operating=""', '        <CardDetails><p>dup</p></CardDetails>\n        {drawn ? <h4 data-below-operating=""')],
  ["the Growth & Margins card's second disclosure back", once("      </SeeAllTheNumbers>\n    </section>", "      </SeeAllTheNumbers>\n      <CardDetails><p data-fine-print=\"\">Source: {SEC_ATTRIBUTION}.</p></CardDetails>\n    </section>")],
];
for (const [label, mutate] of CARD_MUTANTS) {
  let caught = false;
  try {
    const M = await loadCards(mutate);
    caught = !Object.values(RULES).every((r) => { try { return r(M); } catch { return false; } });
  } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, caught);
}
const PAGE_MUTANTS = [
  ["the snapshot back at the top of the main column", (p) => p.replace('<div className="mainColumn">', '<div className="mainColumn"><SecSnapshotCard view={secView} />')],
  ['the snapshot under "What it means"', (p) => { const s = '{snapshotView ? <div className="orderSnapshot"><SecSnapshotCard view={snapshotView} pending={data.pendingResults} /></div> : null}'; return p.replace(s, "").replace('<HiddenCard id="forward-consensus" stacked />', `${s}<HiddenCard id="forward-consensus" stacked />`); }],
  ["the phone order puts the snapshot before Growth & Margins", (p) => p.replace(".orderGrowth { order: -2; }", ".orderGrowth { order: 0; }")],
  ["display: contents leaks to desktop", (p) => p.replace(".snapshotCard { container-type: inline-size; }", ".snapshotCard { container-type: inline-size; } .sideColumn { display: contents; }")],
  ["tile figures may wrap again", (p) => p.replace(".snapshotGrid .metricValue { white-space: nowrap; word-break: normal; }", "")],
];
for (const [label, mutate] of PAGE_MUTANTS) {
  const p = mutate(PAGE);
  check(`MUTATION: ${label} → caught`, p !== PAGE && !Object.values(PAGE_RULES).every((r) => r(p)));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
