// THE DAY SLIDER (#552 COWORK #189): one row per report, 1–30 trading days.
//
// Held here: day N is the close on the Nth session from the reaction session
// against the pre-report close, from the page's OWN anchor rule (after close /
// before open), so days 1, 5 and 20 equal the card's existing figures; SPY is
// measured over the same dates; the series end stops the slider; and NO PRICE
// reaches the client -- the rows are held to an allow-list and searched for
// any fixture close or volume.
//
//   node scripts/check-reaction-days.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";
import { loadReactionCharts, html, visibleText, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (anchor, replacement) => (src) => {
  if (src.split(anchor).length !== 2) throw new Error(`mutation anchor must match once: ${anchor}`);
  return src.replace(anchor, replacement);
};

const D = await import("../app/stock/[symbol]/earnings/reactionDays.ts");
const PAGE = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
const RX = await lift([
  (PAGE.match(/const REACTION_SESSION_GAP_DAYS = \d+;/) ?? [""])[0],
  (PAGE.match(/const VOLUME_MIN_SESSIONS = \d+;/) ?? [""])[0],
  grabFunction(PAGE, "computeEarningsReactionDetail"), "export { computeEarningsReactionDetail };"].join("\n"));

// 60 weekday-ish sessions; closes 200, 201.5, 203… (never round), volume 1,234,567+i.
const series = Array.from({ length: 60 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 3, 1) + i * 86_400_000).toISOString().slice(0, 10),
  close: 200 + i * 1.5, volume: 1_234_567 + i,
}));
const SPY = series.map((p, i) => ({ date: p.date, close: 500 + i * 0.25 })).filter((_, i) => i !== 12); // SPY skips one day
const pct = (a, b) => Math.round(((a - b) / Math.abs(b)) * 10000) / 100;

console.log("1. day N = close on the Nth session from the reaction ÷ the pre-report close − 1");
{
  const amcRow = { date: series[10].date, time: "amc" };
  const amc = RX.computeEarningsReactionDetail(amcRow, series);
  check("after close: the page's anchor is base = report day, Day 1 = next session", amc.anchor?.baseIdx === 10 && amc.anchor?.reactIdx === 11, JSON.stringify(amc.anchor));
  const { pct: path } = D.dayPath(series, amc.anchor);
  check("Day 12 = close[22] ÷ close[10] − 1", path[11] === pct(series[22].close, series[10].close), `${path[11]}`);
  check("Days 1, 5 and 20 equal the card's reaction, +5 and +20 figures",
    Math.abs(path[0] - amc.reactionPct) < 0.006 && Math.abs(path[4] - amc.drift5Pct) < 0.006 && Math.abs(path[19] - amc.drift20Pct) < 0.006,
    `${path[0]}/${amc.reactionPct.toFixed(2)} ${path[4]}/${amc.drift5Pct.toFixed(2)} ${path[19]}/${amc.drift20Pct.toFixed(2)}`);
  const bmo = RX.computeEarningsReactionDetail({ date: series[10].date, time: "bmo" }, series);
  check("before open: base = the session before, Day 1 = the report day", bmo.anchor?.baseIdx === 9 && bmo.anchor?.reactIdx === 10 && D.dayPath(series, bmo.anchor).pct[0] === pct(series[10].close, series[9].close));
  check("thirty days on a long series", path.length === 30);
}

console.log("\n2. the latest report stops at the series end; SPY over the same dates");
{
  const late = RX.computeEarningsReactionDetail({ date: series[50].date, time: "amc" }, series);
  const rows = D.reactionDayRows([{ label: "Q2 FY2026", date: series[50].date, time: "amc", anchor: late.anchor }], series, SPY);
  check("nine sessions after the reaction → nine days, truncated", rows[0].pct.length === 9 && rows[0].truncated === true, `${rows[0].pct.length}`);
  const early = RX.computeEarningsReactionDetail({ date: series[2].date, time: "amc" }, series);
  const r = D.reactionDayRows([{ label: "Q4 FY2025", date: series[2].date, time: "amc", anchor: early.anchor }], series, SPY)[0];
  check("SPY's Day 5 = SPY close on that date ÷ SPY on the base date − 1", r.spy[4] === pct(500 + 7 * 0.25, 500 + 2 * 0.25), `${r.spy[4]}`);
  check("a day SPY has no bar is null, never a guess (session 12 = Day 10)", r.spy[9] === null);
  check("the timing tag and the short date travel", r.timing === "after close" && r.dayDates[0] === D.shortDate(series[3].date));
  check("a report the series does not cover is left out", D.reactionDayRows([{ label: "x", date: "2020-01-01", time: "amc", anchor: null }], series, SPY).length === 0);
}

console.log("\n2b. newest report first (#552 COWORK #192)");
{
  const rep = (i, label) => ({ label, date: series[i].date, time: "amc", anchor: RX.computeEarningsReactionDetail({ date: series[i].date, time: "amc" }, series).anchor });
  const order = (mod) => mod.reactionDayRows([rep(5, "old"), rep(25, "mid"), rep(40, "new")], series, SPY).map((r) => r.label).join(",");
  check("oldest-first input renders newest first", order(D) === "new,mid,old", order(D));
  const src = fs.readFileSync("app/stock/[symbol]/earnings/reactionDays.ts", "utf8");
  const mutant = src.replace(/return rows\.sort\([^\n]*\n/, "return rows;\n");
  check("the mutation applied", mutant !== src);
  const tmp = "app/stock/[symbol]/earnings/reactionDays.mutant-order.ts";
  fs.writeFileSync(tmp, mutant);
  try {
    const M = await import(`../${tmp}`);
    check("MUTATION: without the sort the oldest report leads (caught)", order(M) === "old,mid,new", order(M));
  } finally { fs.rmSync(tmp, { force: true }); }
}

console.log("\n3. no price reaches the client");
const ALLOWED = ["label", "reportDate", "timing", "pct", "spy", "dayDates", "truncated"];
const leaks = (rows) => {
  const raw = new Set([...series.flatMap((p) => [p.close, p.volume]), ...SPY.map((p) => p.close)]);
  const nums = JSON.stringify(rows).match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const keys = rows.flatMap((r) => Object.keys(r));
  return { badKeys: keys.filter((k) => !ALLOWED.includes(k)), priced: nums.filter((n) => raw.has(n) && n > 100) };
};
{
  const reports = [0, 10, 20, 30, 40].map((i) => ({ label: `R${i}`, date: series[i].date, time: i % 2 ? "bmo" : "amc", anchor: RX.computeEarningsReactionDetail({ date: series[i].date, time: i % 2 ? "bmo" : "amc" }, series).anchor }));
  const rows = D.reactionDayRows(reports, series, SPY);
  const l = leaks(rows);
  check("the rows carry only the allowed fields, and no close or volume from the bars", rows.length > 0 && !l.badKeys.length && !l.priced.length, JSON.stringify(l));
  const SRC = fs.readFileSync("app/stock/[symbol]/earnings/reactionDays.ts", "utf8");
  const tmp = `app/stock/[symbol]/earnings/.check-days-${process.pid}.ts`;
  fs.writeFileSync(tmp, once("      truncated: pct.length < REACTION_SLIDER_DAYS,", "      truncated: pct.length < REACTION_SLIDER_DAYS,\n      closes: points.slice(r.anchor.baseIdx, r.anchor.baseIdx + 31).map((p) => p.close),")(SRC));
  let M;
  try { M = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  const m = leaks(M.reactionDayRows(reports, series, SPY));
  check("MUTATION: the closes ride along → caught by the allow-list and the price search", m.badKeys.includes("closes") && m.priced.length > 0, JSON.stringify(m).slice(0, 120));
  check("the page hands the card the rows and nothing priced", /days=\{data\.reactionDays\}/.test(PAGE) && /const reactionDays = reactionDayRows\(/.test(PAGE));
}

console.log("\n4. the slider, server-rendered");
{
  const RC = await loadReactionCharts();
  const reports = [5, 15, 25, 35, 50].map((i, k) => ({ label: `Q${k + 1} FY2026`, date: series[i].date, time: "amc", anchor: RX.computeEarningsReactionDetail({ date: series[i].date, time: "amc" }, series).anchor }));
  const rows = RC.reactionDayRows(reports, series, SPY);
  const card = html(React.createElement(RC.PriceReactionCard, { symbol: "TSLA", latest: null, reaction: [{ label: "x", value: 1 }], drift: [], days: rows,
    datesFromSec: true, uncoveredLabels: [], noPriceHistoryNote: "" }));
  const days = [...card.matchAll(/data-row="[^"]+" data-day="(\d+)"/g)].map((m) => Number(m[1]));
  check("each row opens at a different preset, cycling 1 / 5 / 20", JSON.stringify(days) === JSON.stringify([1, 5, 20, 1, 5]), JSON.stringify(days));
  const text = visibleText(card);
  check("a readout per row ('Day 5: +x%'), the date, and the S&P figure", /Day 5: \+\d+\.\d%/.test(text) && / to \d{1,2} [A-Z][a-z]{2}/.test(text) && /S&P \+\d+\.\d%/.test(text), text.slice(0, 160));
  check("the readout is aria-live polite, and every slider is named", (card.match(/aria-live="polite"/g) ?? []).length === rows.length && (card.match(/aria-label="Q\d FY2026: trading days after the report"/g) ?? []).length === rows.length);
  check("'Set all to day' and 'Reset' above the rows; the fixed 1/5/20 chart is replaced", /Set all to day/.test(text) && />Reset</.test(card) && /data-day-slider-block=""/.test(card) && !/driftBar/.test(card));
  check("the card keeps the market caveat", /Includes broader market moves/.test(text));
  const noRows = html(React.createElement(RC.PriceReactionCard, { symbol: "TSLA", latest: null, reaction: [{ label: "x", value: 1 }],
    drift: [{ label: "x", reactionPct: 1, drift5Pct: 2, drift20Pct: 3, drift5Pending: false, drift20Pending: false }], days: [], datesFromSec: true, uncoveredLabels: [], noPriceHistoryNote: "" }));
  check("with no rows the fixed chart still renders", /driftBar/.test(noRows) && !/data-day-slider/.test(noRows));
}

if (failures) { console.log(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
