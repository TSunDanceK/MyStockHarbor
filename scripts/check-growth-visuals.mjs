// The earnings page's "Growth & margins" picture (#563 COWORK #26/#27): C's new
// files lib/growthVisuals.ts and app/stock/[symbol]/earnings/GrowthVisuals.tsx.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A NUMBER THE FILINGS DON'T HAVE: a ghost bar derived instead of looked up,
//      a profit invented for a year, a derived quarter shown as filed.
//   2. THE WORDS LIE: "+1235.4%" where the rule says "from a small base", a margin
//      of −194.5% printed instead of "costs were about 2.9× sales", a summary that
//      miscounts losses or misses the one-off.
//   3. THE ONE-OFF TAG on the wrong quarter, or missing where A's rule fired.
//   4. "Not reported" replaced by a blank or a zero.
//   5. THE COMPONENT FETCHES: it is presentation only (no fetch, no Redis).
//   6. AN UNMARKED ONE-OFF PROFIT (COWORK #36 blocker): without A's per-period
//      one-off notes, ONDS's Q1 FY2026 gain would draw as the biggest green bar
//      with no tag. The profit chart, its detail row and its summary clause stay
//      off until A passes `oneOffs`.
//   7. NO SCALE BEFORE A TAP (#36 ask 1): the newest bar and dot lose their
//      values, or the 0¢ / 50¢ / 100¢ guides go.
//   8. TWO PATTERNS FOR THE MULTIPLES (#36 ask 2).
//   9. THE YEARS PROFIT CHART (#563 COWORK #51 (a), on A's #552 COWORK #117
//      annual one-offs): each year's FILED net income, behind the same gate as
//      the quarters, with no bar for a year the one-off rule can't run on.
//
// Real data: ONDS's fact set (data/sec/factset-fixture-ONDS.json, captured by the
// read-only sec-fixture relay, sha256 f76d9584…), run through A's view builder.
//
//   node scripts/check-growth-visuals.mjs
import fs from "node:fs";
import { loadCards, html, visibleText, React, reasonedValueUnit } from "./lib/render-cards.mjs";
import { stripComments } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const BUILDER = "lib/growthVisuals.ts";
const COMPONENT = "app/stock/[symbol]/earnings/GrowthVisuals.tsx";
const strip = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/^"use client";$/m, "");
const appended = (builder, component) =>
  `\n${reasonedValueUnit()}\n${strip(builder)}\n${strip(component).replace("export default function GrowthVisuals", "export function GrowthVisuals")}\n`;

/** A's view stack plus C's two files, one transpiled unit (render-cards' method). */
const load = (builder = fs.readFileSync(BUILDER, "utf8"), component = fs.readFileSync(COMPONENT, "utf8")) =>
  loadCards((src) => src + appended(builder, component));

const full = JSON.parse(fs.readFileSync("data/sec/factset-fixture-ONDS.json", "utf8"));
/** ONDS as it stood after Q1 FY2026: the same filings, newest quarter not yet filed. */
const asOfQ1 = () => { const s = structuredClone(full); s.quarters = s.quarters.slice(1); return s; };
/** ONDS with every quarter's net income a loss: the loss-only shape. */
const lossOnly = (M) => {
  const s = structuredClone(full);
  const ni = M.SEC_FIELD_KEYS.indexOf("netIncome");
  for (const p of s.quarters) if (typeof p.v[ni] === "number") p.v[ni] = -Math.abs(p.v[ni]);
  return s;
};

/** Everything the rules read, for one load of the modules. */
async function measure(M) {
  const ondsView = M.buildSecEarningsView(full);
  const onds = M.buildGrowthVisuals(ondsView);
  const q1View = M.buildSecEarningsView(asOfQ1());
  // `oneOffs: {}` = "A checked every period": only the latest carries a note here.
  const q1 = M.buildGrowthVisuals(q1View, { oneOffs: {} });
  // ONDS as filed once A supplies the per-period note: Q1 FY2026 tagged with A's
  // own words for it (the note A's rule gives when Q1 is the latest period).
  const ondsChecked = M.buildGrowthVisuals(ondsView, { oneOffs: { "Q1 FY2026": q1View.largeNonOperatingNote } });
  const loss = M.buildGrowthVisuals(M.buildSecEarningsView(lossOnly(M)), { oneOffs: {} });
  const markup = (data) => html(React.createElement(M.GrowthVisuals, { data, notReported: "Not reported" }));
  const render = (data) => visibleText(markup(data));
  // "Not reported" survives: the newest quarter (the one the detail panel opens on) with no revenue.
  const blank = structuredClone(full);
  blank.quarters[0].v[M.SEC_FIELD_KEYS.indexOf("revenue")] = null;
  const blankData = M.buildGrowthVisuals(M.buildSecEarningsView(blank));
  // The card's own call (SecEarningsCards): A's per-period notes and unchecked list.
  const ondsCard = M.buildGrowthVisuals(ondsView, { oneOffs: ondsView.oneOffs, unchecked: ondsView.oneOffUnchecked });
  // One year the rule couldn't run on, one year tagged: the gate on years, not just quarters.
  const yearsMarked = M.buildGrowthVisuals(ondsView, { oneOffs: { FY2024: "A note for FY2024." }, unchecked: ["FY2023"] });
  return { onds, ondsChecked, ondsCard, ondsView, yearsMarked, q1, q1View, loss, render, markup, blankData, M };
}

let M_PROFIT_WAITS = "";
const rules = {
  "ONDS: 8 quarters, oldest first": ({ onds }) =>
    onds.quarters.periods.length === 8 && onds.quarters.periods[0].label === "Q3 FY2024" && onds.quarters.periods[7].label === "Q2 FY2026",
  "ghost bars are A's comparator, looked up by label, never derived": ({ onds }) => {
    const p = onds.quarters.periods;
    return p.slice(0, 4).every((x) => x.lastYear === null) &&
      p[7].lastYear?.label === "Q2 FY2025" && p[7].lastYear.val === p.find((x) => x.label === "Q2 FY2025").sales.val &&
      p[4].lastYear?.label === "Q3 FY2024";
  },
  "above +200% the label reads 'from a small base'": ({ onds, M }) =>
    onds.quarters.periods[7].growth === "from a small base" && M.growthWords(67.04) === "+67.0%" && M.growthWords(-44.44) === "−44.4%" &&
    M.growthWords(200) === "+200.0%" && M.growthWords("loss-both") === null,
  "gross margin is A's figure in whole cents": ({ onds }) =>
    // Q3 FY2025's 25.79% is where rounding and truncating disagree (26 vs 25).
    onds.quarters.periods[7].keptCents === 43 && onds.quarters.periods[0].keptCents === 3 && onds.quarters.periods[4].keptCents === 26,
  "margins beyond ±100% are worded, within are percentages": ({ onds, M }) =>
    onds.quarters.periods[7].operating === "operating costs were about 2.9× sales" &&
    onds.quarters.periods[6].operating === "−85.1%" &&
    onds.quarters.periods[6].net === "the net profit was about 7.2× sales" &&
    M.marginWords(-100, "net", false) === "−100.0%",
  "derived quarters keep A's derived note": ({ ondsChecked }) => {
    const p = ondsChecked.quarters.periods;
    const q4 = p.filter((x) => /^Q4 /.test(x.label));
    return q4.length === 2 && q4.every((x) => x.sales?.derivedNote && x.profit?.derivedNote) && p[7].sales.derivedNote === null;
  },
  "summary without A's notes: sales only, no profit clause": ({ onds }) =>
    onds.quarters.summary === "Sales were higher than a year earlier in each of the last 6 quarters.",
  "summary with A's notes: seven of eight losses, the one-off named": ({ ondsChecked }) =>
    ondsChecked.quarters.summary ===
      "Sales were higher than a year earlier in each of the last 6 quarters; it reported a net loss in 7 of the 8 quarters shown, and the profitable quarter includes a one-off gain.",
  // THE #36 BLOCKER, on the data AND the markup: no profit bar, no profit row in
  // the panel, and the words saying where the figures are instead.
  "blocker: without A's per-period notes, no profit figure is drawn or listed": ({ onds, markup, render }) => {
    const m = markup(onds), t = render(onds);
    return onds.quarters.periods.every((x) => x.profit === null && x.oneOff === null) &&
      onds.quarters.profitMissing === M_PROFIT_WAITS && !/class="gvPlBar"/.test(m) &&
      !/<dt>Profit or loss<\/dt>/.test(m) && !/Profit or loss per /.test(t) &&
      t.includes(M_PROFIT_WAITS);
  },
  "blocker: with A's per-period note, Q1 '26 draws tagged": ({ ondsChecked, q1View, markup }) => {
    const p = ondsChecked.quarters.periods, m = markup(ondsChecked);
    const q1 = p.find((x) => x.label === "Q1 FY2026");
    return q1.profit.val > 0 && q1.oneOff === q1View.largeNonOperatingNote &&
      p.filter((x) => x.oneOff).length === 1 && ondsChecked.quarters.profitMissing === null &&
      (m.match(/class="gvPlBar"/g) ?? []).length === 8 && (m.match(/class="gvOneOff"/g) ?? []).length === 1;
  },
  "scale: the newest sales bar and the newest dot carry their values": ({ onds, markup }) => {
    const vals = [...markup(onds).matchAll(/class="gvVal"[^>]*>([^<]+)</g)].map((x) => x[1]);
    return vals.length === 2 && vals[0] === "$83.8M" && vals[1] === "43¢";
  },
  "scale: faint 0¢ / 50¢ / 100¢ guides on the margin chart": ({ onds, markup }) => {
    const labels = [...markup(onds).matchAll(/class="gvCentLabel"[^>]*>([^<]+)</g)].map((x) => x[1]);
    return labels.join(",") === "0¢,50¢,100¢" && (markup(onds).match(/class="gvCentGuide"/g) ?? []).length === 3;
  },
  "wording: one pattern for the multiples in the panel": ({ onds, render }) =>
    render(onds).includes("operating costs were about 2.9× sales · the net loss was about 1.1× sales") &&
    !/margin: (operating|the net)/.test(render(onds)),
  "marker: on the quarter A's rule fired for, with A's words": ({ q1, q1View }) => {
    const p = q1.quarters.periods;
    return q1View.largeNonOperating === true && p.at(-1).label === "Q1 FY2026" && p.at(-1).oneOff === q1View.largeNonOperatingNote &&
      p.slice(0, -1).every((x) => x.oneOff === null);
  },
  "marker: the summary names the one-off": ({ q1 }) =>
    /the profitable quarter includes a one-off gain\.$/.test(q1.quarters.summary),
  // ON THE TAG ELEMENT, not the text: the summary and the detail panel also
  // say "one-off", so a text match passed with the tag gone.
  "ONDS as filed: no one-off tag (A's rule is false for Q2 FY2026)": ({ onds, markup }) =>
    onds.quarters.periods.every((x) => x.oneOff === null) && !/class="gvOneOff"/.test(markup(onds)),
  // ON TAP, NOT HOVER ONLY (#563 COWORK #51/#52): A's ReasonedValue, and outside
  // every column <button> (a button inside a button can't take the tap).
  "marker: the tag renders": ({ q1, markup }) => {
    const m = markup(q1), at = m.indexOf('class="gvOneOff"');
    const tag = at < 0 ? "" : m.slice(at, m.indexOf("one-off</span>", at) + 7);
    const before = m.slice(0, at);
    return (m.match(/class="gvOneOff"/g) ?? []).length === 1 &&
      /role="button"/.test(tag) && /tabindex="0"/.test(tag) &&
      /title="Includes a large non-operating gain; see the filing\."/.test(tag) && tag.endsWith("one-off") &&
      before.lastIndexOf("<button") < before.lastIndexOf("</button>") && !/<abbr class="gvOneOff"/.test(m);
  },
  "loss-only: all losses, said plainly": ({ loss }) =>
    loss.quarters.periods.every((x) => x.profit.val < 0) && /it reported a net loss in all 8 quarters shown\.$/.test(loss.quarters.summary),
  "years without A's notes: no profit drawn, and it says why": ({ onds, M }) =>
    onds.years.periods.length === 5 && onds.years.periods.every((x) => x.profit === null && x.oneOff === null) &&
    onds.years.profitMissing === M.profitWaitsForOneOffs("year"),
  "years with A's notes: each year's filed net income, never a margin": ({ ondsCard, ondsView }) => {
    const y = ondsCard.years;
    return y.profitMissing === null && y.periods.length === 5 &&
      y.periods.every((x, i) => x.label === ondsView.annual[i].label && x.profit?.val === ondsView.annual[i].netIncome.val) &&
      // FY2025 as filed: -$133.4M, not net margin × revenue rounded through a percentage.
      y.periods.at(-1).profit.val === -133381301;
  },
  "years: a year the rule can't run on gets no bar and the reason; a noted year is tagged": ({ yearsMarked, M }) => {
    const p = yearsMarked.years.periods, at = (l) => p.find((x) => x.label === l);
    return at("FY2023").profit === null && at("FY2023").oneOff === null && at("FY2023").profitUnchecked === M.PROFIT_UNCHECKED &&
      at("FY2024").oneOff === "A note for FY2024." && at("FY2024").profit !== null &&
      p.filter((x) => x.profitUnchecked).length === 1 && p.filter((x) => x.oneOff).length === 1;
  },
  "years: the summary counts the yearly losses": ({ ondsCard }) =>
    /it reported a net loss in all 5 years shown\.$/.test(ondsCard.years.summary),
  "'Not reported' survives a missing figure": ({ blankData, render }) =>
    blankData.quarters.periods.at(-1).sales === null && /Sales\s*Not reported/.test(render(blankData)),
  "the render carries the summary, the toggle and the legend words": ({ ondsChecked, render }) => {
    const t = render(ondsChecked);
    return t.includes(ondsChecked.quarters.summary) && /Quarters/.test(t) && /Years/.test(t) && /Profit \(\+\), above the line/.test(t) && /Loss \(−\), below/.test(t);
  },
};

const staticRules = {
  "no fetch, no Redis, no server reads in either file": (b, c) =>
    ![b, c].some((s) => /fetch\(|redis|Redis|unstable_cache|readTiingo|getDailyHistory|resolveFactSet/.test(s)),
  "the client component imports only React and the builder's types": (b, c) => {
    const imports = [...c.matchAll(/^import[\s\S]*?from\s*"([^"]+)";$/gm)].map((m) => m[1]);
    // Plus A's ReasonedValue for the one-off tag's note (#563 COWORK #52), by name only.
    return imports.every((i) => i === "react" || i === "@/lib/growthVisuals" || i === "@/app/components/EstimatedValue") &&
      /^import type \{[^}]*\} from "@\/lib\/growthVisuals";$/m.test(c) &&
      (!/@\/app\/components\/EstimatedValue/.test(c) || /^import \{ ReasonedValue \} from "@\/app\/components\/EstimatedValue";$/m.test(c));
  },
  "the builder imports A's formatter rather than copying it": (b) =>
    /import \{ scaledAmount \} from "\.\/server\/secPresentation";/.test(b) && /scaledAmount\(cell\.val\)/.test(b),
};

console.log("\n=== 1. ONDS, loss-only and marker-fires, through A's view builder ===\n");
const base = await measure(await load());
M_PROFIT_WAITS = base.M.profitWaitsForOneOffs("quarter");
for (const [name, rule] of Object.entries(rules)) check(name, rule(base));

console.log("\n=== 2. Static rules ===\n");
const B = fs.readFileSync(BUILDER, "utf8"), Cc = fs.readFileSync(COMPONENT, "utf8");
const code = (s, f) => stripComments(s, { file: f });
for (const [name, rule] of Object.entries(staticRules)) check(name, rule(code(B, BUILDER), code(Cc, COMPONENT)));

console.log("\n=== 3. Mutants: each must FAIL its rule ===\n");
const mutants = [
  ["above +200% the label reads 'from a small base'", "b", (s) => s.replace("export const SMALL_BASE_ABOVE_PCT = 200;", "export const SMALL_BASE_ABOVE_PCT = 100000;")],
  ["ghost bars are A's comparator, looked up by label, never derived", "b", (s) => s.replace("const prior = g?.comparedWith ? byLabel.get(g.comparedWith) : undefined;", "const prior = ordered[ordered.indexOf(p) - 1];")],
  ["gross margin is A's figure in whole cents", "b", (s) => s.replace("return { cents: Math.round(gross), note: null };", "return { cents: Math.floor(gross), note: null };")],
  ["margins beyond ±100% are worded, within are percentages", "b", (s) => s.replace("if (Math.abs(m) <= MARGIN_AS_MULTIPLE_BEYOND_PCT)", "if (true)")],
  ["derived quarters keep A's derived note", "b", (s) => s.replace("derivedNote: cell.derivedNote ?? null", "derivedNote: null")],
  ["summary with A's notes: seven of eight losses, the one-off named", "b", (s) => s.replace("const losses = withProfit.filter((p) => p.profit!.val < 0).length;", "const losses = withProfit.filter((p) => p.profit!.val <= 0).length + 1;")],
  ["summary without A's notes: sales only, no profit clause", "b", (s) => s.replace("profit: profitChecked && !unchecked.has(label) ? amount(netIncome) : null,", "profit: amount(netIncome),")],
  ["blocker: without A's per-period notes, no profit figure is drawn or listed", "b", (s) => s.replace("const profitChecked = opts.oneOffs !== undefined;", "const profitChecked = true;")],
  ["blocker: without A's per-period notes, no profit figure is drawn or listed", "c", (s) => s.replace("{showProfit ? (", "{true ? (")],
  ["blocker: with A's per-period note, Q1 '26 draws tagged", "b", (s) => s.replace("opts.oneOffs?.[label] ??", "")],
  ["scale: the newest sales bar and the newest dot carry their values", "c", (s) => s.replace("{i === newest && p.sales ? (", "{false && p.sales ? (")],
  ["scale: the newest sales bar and the newest dot carry their values", "c", (s) => s.replace("{i === newest ? (", "{false ? (")],
  ["scale: faint 0¢ / 50¢ / 100¢ guides on the margin chart", "c", (s) => s.replace("const CENT_GUIDES = [0, 50, 100] as const;", "const CENT_GUIDES = [0, 100] as const;")],
  ["wording: one pattern for the multiples in the panel", "b", (s) => s.replace("`operating costs were about ${", "`costs were about ${")],
  ["wording: one pattern for the multiples in the panel", "c", (s) => s.replace("(/%$/.test(text) ? `${kind} margin: ${text}` : text)", "`${kind} margin: ${text}`")],
  ["marker: on the quarter A's rule fired for, with A's words", "b", (s) => s.replace("(label === view.latestLabel && view.largeNonOperating", "(view.largeNonOperating")],
  ["marker: the tag renders", "c", (s) => s.replace("        if (!p.oneOff) return null;\n", "        return null;\n")],
  ["marker: the tag renders", "c", (s) => s.replace('<ReasonedValue text="one-off" reason={p.oneOff} />', "<abbr title={p.oneOff}>one-off</abbr>")],
  ["loss-only: all losses, said plainly", "b", (s) => s.replace("losses === n ? `it reported a net loss in all", "false ? `it reported a net loss in all")],
  ["years without A's notes: no profit drawn, and it says why", "b", (s) => s.replace("profitMissing: profitChecked ? null : profitWaitsForOneOffs(yw.one),", "profitMissing: null,")],
  ["years without A's notes: no profit drawn, and it says why", "b", (s) => s.replace("        ...profitOf(a.label, a.netIncome),\n", "        profit: amount(a.netIncome),\n        oneOff: null,\n")],
  ["years with A's notes: each year's filed net income, never a margin", "b", (s) => s.replace("        ...profitOf(a.label, a.netIncome),\n", "        ...profitOf(a.label, a.netIncome),\n        profit: a.net == null || a.revenue.val == null ? null : { val: (a.net / 100) * a.revenue.val, text: \"x\", derivedNote: null },\n")],
  ["years with A's notes: each year's filed net income, never a margin", "b", (s) => s.replace("        ...profitOf(a.label, a.netIncome),\n", "        profit: null,\n        oneOff: null,\n")],
  ["years: a year the rule can't run on gets no bar and the reason; a noted year is tagged", "b", (s) => s.replace("profit: profitChecked && !unchecked.has(label) ? amount(netIncome) : null,", "profit: profitChecked ? amount(netIncome) : null,")],
  ["years: a year the rule can't run on gets no bar and the reason; a noted year is tagged", "b", (s) => s.replace("        ...profitOf(a.label, a.netIncome),\n", "        ...profitOf(a.label, a.netIncome),\n        oneOff: null,\n")],
  ["years: the summary counts the yearly losses", "b", (s) => s.replace("summary: summaryLine(periods, view.annual.map((a) => a.revenueYoY), yw.one, yw.many),", "summary: summaryLine(periods.map((p) => ({ ...p, profit: null })), view.annual.map((a) => a.revenueYoY), yw.one, yw.many),")],
  ["'Not reported' survives a missing figure", "c", (s) => s.replace("const nr = <span style={{ color: C.muted }}>{notReported}</span>;", "const nr = <span>$0.0M</span>;")],
  ["the render carries the summary, the toggle and the legend words", "c", (s) => s.replace("Profit (+), above the line", "Profit")],
];
for (const [name, which, mutate] of mutants) {
  const b2 = which === "b" ? mutate(B) : B;
  const c2 = which === "c" ? mutate(Cc) : Cc;
  const changed = b2 !== B || c2 !== Cc;
  let bites = false;
  try { bites = !rules[name](await measure(await load(b2, c2))); } catch { bites = true; }
  check(`mutant bites: ${name}`, changed && bites, changed ? "" : "the mutation did not apply");
}
const staticMutants = [
  ["no fetch, no Redis, no server reads in either file", (b, c) => [b, `${c}\nconst x = fetch("/api/quote");`]],
  ["the client component imports only React and the builder's types", (b, c) => [b, `import { scaledAmount } from "@/lib/server/secPresentation";\n${c}`]],
  ["the client component imports only React and the builder's types", (b, c) => [b, c.replace("import { ReasonedValue } from", "import { ReasonedValue, notePlacement } from")]],
  ["the builder imports A's formatter rather than copying it", (b, c) => [b.replace("scaledAmount(cell.val)", "money(cell.val)"), c]],
];
for (const [name, mutate] of staticMutants) {
  const [b2, c2] = mutate(code(B, BUILDER), code(Cc, COMPONENT));
  check(`mutant bites: ${name}`, !staticRules[name](b2, c2));
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
