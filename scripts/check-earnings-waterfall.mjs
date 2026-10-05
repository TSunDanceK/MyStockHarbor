// THE P&L WATERFALL WHEN COSTS EXCEED REVENUE, AND THE MARGIN BADGE'S VERB
// (#552 COWORK A-queue items 1 and 2). RENDERED from stored fact sets.
//
//   1. WKHS Q2 FY2026 (data/sec/factset-fixture-WKHS.json): revenue $3.6M,
//      costs $11.0M + $4.1M + $7.8M, operating income −$19.4M. The old axis
//      was 0..max(running totals), so the cost bars sat past the track's
//      right edge (empty tracks) and the result bar took |total| in the
//      positive blue. Asserted: every bar has visible width inside the track;
//      the cost of revenue crosses the zero line; operating income ends AT
//      zero, lies left of it, in the loss colour. MUTATION: the old 0..max
//      scale; the old always-blue result bar.
//   2. AAPL (a profit) draws exactly as before: no zero line, revenue full
//      width from 0, the result bar in the blue from 0.
//   3. BYND's operating margin −50.0% → −44.8% badge reads "Improving", not
//      "Widening". MUTATION: the badge without #550's rule-3 verb.
//
//   node scripts/check-earnings-waterfall.mjs
import fs from "node:fs";
import { loadCards, html, React } from "./lib/render-cards.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times, needs exactly 1: ${from}`);
  return src.replace(from, to);
};
const fixture = (s) => JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${s}.json`, "utf8"));
const LOSS = "#ef4444";
const BLUE = "rgba(147,197,253,0.85)";

/** The waterfall rows as drawn: label, bar left/width (%), colour, zero line. */
function bars(M, sym) {
  const out = html(React.createElement(M.SecIncomeStatementCard, { view: M.buildSecEarningsView(fixture(sym)) }));
  const i = out.indexOf('class="waterfall"');
  if (i < 0) return null;
  // To the end of the waterfall: what follows it changed with #552 COWORK #168
  // (fine-print lines, then the one "About these figures").
  const body = out.slice(i, out.indexOf("</div></div><", i) + 12);
  // Rows by key (data-wf-key): the bars carry the statement's own labels now,
  // and Gross profit is a subtotal row between cost of revenue and R&D.
  return [...body.matchAll(/<div class="wfRow[^"]*" data-wf-key="(\w+)"><span class="wfLabel">(.*?)<\/span><div class="wfTrack">(.*?)<\/div>/g)].map(([, key, label, track]) => {
    const st = /class="wfBar" style="([^"]*)"/.exec(track)?.[1] ?? "";
    const num = (k) => Number(new RegExp(`${k}:(-?[\\d.]+)%`).exec(st)?.[1] ?? 0);
    const zero = /class="wfZero" style="left:(-?[\d.]+)%"/.exec(track);
    return {
      key,
      label: label.replace(/<[^>]+>/g, "").replace("&amp;", "&"),
      left: num("margin-left"), width: num("width"),
      colour: /background:([^;"]+)/.exec(st)?.[1] ?? "",
      zero: zero ? Number(zero[1]) : null,
    };
  });
}
// The part of [left, left+width] that lands inside the 0..100 track.
const visible = (b) => Math.min(b.left + b.width, 100) - Math.max(b.left, 0);
const near = (a, b) => Math.abs(a - b) < 0.01;

function wkhsHolds(M) {
  const r = bars(M, "WKHS");
  if (!r) return { drawn: false };
  const costs = r.filter((b) => !["revenue", "grossProfit", "operatingIncome"].includes(b.key));
  const cor = r.find((b) => b.key === "costOfRevenue");
  const tot = r.find((b) => b.key === "operatingIncome");
  const zero = r[0].zero;
  return {
    drawn: true, r, zero,
    costsVisible: costs.length === 3 && costs.every((b) => visible(b) > 1),
    allInside: r.every((b) => b.left >= -0.01 && b.left + b.width <= 100.01),
    crosses: zero !== null && cor.left < zero && cor.left + cor.width > zero,
    lossLeftOfZero: zero !== null && near(tot.left + tot.width, zero) && tot.left < zero,
    lossColour: tot.colour === LOSS,
  };
}

const M = await loadCards();

console.log("1. WKHS: costs > revenue");
{
  const w = wkhsHolds(M);
  check("the waterfall is drawn (the gate passes)", w.drawn);
  check("a zero line is drawn", w.zero !== null && w.zero > 0 && w.zero < 100, `zero=${w.zero}`);
  check("no cost bar is an empty track", w.costsVisible, JSON.stringify(w.r?.map((b) => [b.label, +b.left.toFixed(1), +b.width.toFixed(1)])));
  check("every bar lies inside the track", w.allInside);
  check("cost of revenue floats across zero (+3.6M → −7.4M)", w.crosses);
  check("operating income ends at zero and lies left of it", w.lossLeftOfZero);
  check("operating income is in the loss colour, not the blue", w.lossColour, w.r?.at(-1)?.colour);
  const Mm = await loadCards(once(
    "const lo = Math.min(0, total, ...ends);",
    "const lo = 0;"));
  const m = wkhsHolds(Mm);
  check("MUTATION: the old 0..max scale leaves cost bars off the track", !(m.costsVisible && m.allInside));
  const Mc = await loadCards(once(
    'background: bar.loss ? toneColor("weak") : "rgba(147,197,253,0.85)"',
    'background: "rgba(147,197,253,0.85)"'));
  check("MUTATION: the always-blue result bar fails the colour assertion", !wkhsHolds(Mc).lossColour);
}

console.log("\n2. AAPL: a profit draws as before");
{
  const r = bars(M, "AAPL");
  check("drawn", !!r);
  check("no zero line", r.every((b) => b.zero === null));
  check("revenue runs 0 → 100%", near(r[0].left, 0) && near(r[0].width, 100));
  const tot = r.at(-1);
  check("operating income from 0, in the blue", near(tot.left, 0) && tot.width > 0 && tot.colour === BLUE, JSON.stringify(tot));
  // THE ARITHMETIC OF A STEP: each cost's right end is the previous running total.
  // The gross-profit subtotal (#552 COWORK #168) is a level, not a step: it runs
  // from 0 to the running total after cost of revenue, in the subtotal blue.
  let run = r[0].left + r[0].width;
  let ok = true, gpOk = false;
  for (const b of r.slice(1, -1)) {
    if (b.key === "grossProfit") { gpOk = near(b.left, 0) && near(b.width, run) && b.colour === BLUE; continue; }
    ok &&= near(b.left + b.width, run); run = b.left;
  }
  check("gross profit is a subtotal bar from 0 to the running total after cost of revenue, in the blue", gpOk);
  check("each cost bar ends where the previous running total was", ok);
  check("the result bar ends where the last cost began", near(tot.left + tot.width, run));
}

console.log("\n3. the Growth & Margins badge verb");
{
  const badge = (Mod, sym) => {
    const out = html(React.createElement(Mod.SecGrowthMarginsCard, { view: Mod.buildSecEarningsView(fixture(sym)) }));
    const i = out.indexOf("Operating margin vs");
    return i < 0 ? null : out.slice(i, out.indexOf("</p>", i)).replace(/<[^>]+>/g, "");
  };
  const b = badge(M, "BYND");
  check("BYND's line is rendered", b !== null, b ?? "");
  check("BYND −50.0% → −44.8% reads \"Improving\"", /−44\.8% from −50\.0%/.test(b) && /Improving/.test(b) && !/Widening/.test(b), b);
  const a = badge(M, "AAPL");
  check("AAPL (both ends positive) keeps Widening/Narrowing/Steady", a !== null && /(Widening|Narrowing|Steady)/.test(a) && !/Improving|Worsening/.test(a), a ?? "");
  const Mm = await loadCards(once(
    "word={marginToneWord(tone, { older: prior.operating, newer: latest.operating })}",
    "word={marginToneWord(tone)}"));
  check("MUTATION: the badge without rule 3 says \"Widening\" again", /Widening/.test(badge(Mm, "BYND") ?? ""));
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
