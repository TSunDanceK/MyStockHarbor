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
  return {
    views,
    cash: Object.fromEntries(SYMS.map((s) => [s, cash(views[s])])),
    bal: Object.fromEntries(SYMS.map((s) => [s, bal(views[s])])),
    behind: cash(behind), negFcf: cash(negFcf), few: cash(few),
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
  "Q4a. a quarter over 200% is drawn to the top with its true label (KGC FY2021, 513%)": (m) => {
    const g = slot(m.cash.KGC, "FY2021");
    return /^[^>]*data-height="100\.00"/.test(g) && />513%</.test(g) && /class="convBar"/.test(g);
  },
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
  ["the lead's comparison reversed", (s) => once(s, `kind: ocf >= netIncome ? "ahead" : "behind"`, `kind: ocf <= netIncome ? "ahead" : "behind"`)],
  ["a loss no longer gets its own lead line", (s) => once(s, `  if (netIncome <= 0) return { kind: "loss", ocf, netIncome };\n`, "")],
  ["the n/m guard dropped (a % of a negative figure)", (s) => once(s, `  if (of <= 0) return { ok: false, why: "not-meaningful" };\n`, "")],
  ["green from 0% instead of 100%", (s) => once(s, `return s.pct >= 100 ? "good" : "neutral";`, `return s.pct >= 0 ? "good" : "neutral";`)],
  ["capex and share-based pay inked too", (s) => once(s, `if (!s.ok || tile === "capex" || tile === "sbc") return null;`, `if (!s.ok) return null;`)],
  ["the 200% clamp removed", (s) => once(s, "(Math.min(Math.max(pct, 0), CONVERSION_MAX_PCT) / CONVERSION_MAX_PCT) * 100", "(Math.max(pct, 0) / CONVERSION_MAX_PCT) * 100")],
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
