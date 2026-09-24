// /dashboard Breakdown chips never widen the card (Relay B, #553 COWORK #39).
//
// WHAT IS AT RISK, none of which breaks a build: SPCX's Earnings chip read
// "Partial · 1 of 5 measured"; the `1fr 1fr` grid grew to fit it and pushed the
// right-hand chips past the card's edge (MACD and RSI values invisible). Every
// new listing with a partial earnings score did the same.
//
// Runs lib/breakdownChip.ts and the grid wiring, then again on mutants; each
// must be caught. The rendered test (SPCX / NVDA at three widths) is posted on
// #553 with the screenshots: on main SPCX's right-hand chips stood 133px past
// the card and NVDA's 31px; with this, every chip is inside and every value
// whole at 1440px, 1100px and 390px.
//
//   node scripts/check-breakdown-chips.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODULE = "lib/breakdownChip.ts";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-chips-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// The real shared label, so a change to its wording shows up here.
const P = await import(pathToFileURL(path.join(ROOT, "lib/server/secPresentation.ts")).href);

async function suite(C, dash) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  const shared = P.partialScoreLabel({ measured: 1, total: 5, low: 0, high: 100, partial: true, pinned: false });
  const v = C.breakdownChipValue(shared);
  ok("the shared partial label shortens to \"Partial 1/5\"", v.text === "Partial 1/5", JSON.stringify(v));
  ok("...and keeps the full wording for the tooltip", v.full === shared);
  ok("other counts too", C.breakdownChipValue("Partial · 3 of 5 measured").text === "Partial 3/5");
  for (const s of ["Good", "Normal 0.61×", "Bullish", "+17.36%", "Neutral"]) ok(`"${s}" is left as it is`, C.breakdownChipValue(s).text === s && C.breakdownChipValue(s).full === s);
  ok("empty / missing reads as a dash", C.breakdownChipValue(null).text === "—" && C.breakdownChipValue("").text === "—" && C.breakdownChipValue(undefined).text === "—");

  // Wiring.
  ok("the grid's columns may shrink below their content", dash.includes(`className="msh-breakdown-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))"`));
  ok("no `1fr 1fr` chip grid left (a 1fr column never shrinks below its content)", !/gridTemplateColumns: "1fr 1fr", gap: 8 \}\}>\s*\{\(customMode \? selectedBreakdownRows/.test(dash));
  ok("the chip may shrink, and carries the full text as its tooltip",
    /title=\{`\$\{item\.label\}: \$\{v\.full\}`\} style=\{\{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", columnGap: 8, rowGap: 2, alignItems: "center", minWidth: 0,/.test(dash));
  ok("a value that does not fit beside its label wraps to its own line, right-aligned (Normal 0.61× is never cut)",
    /\{\{ display: "flex", flexWrap: "wrap",/.test(dash) && /marginLeft: "auto" \}\}>\{v\.text\}<\/div>/.test(dash));
  ok("the chip value is the shortened text, cut with an ellipsis if it still does not fit",
    /minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", marginLeft: "auto" \}\}>\{v\.text\}<\/div>/.test(dash) && /const v = breakdownChipValue\(customMode \? item\.value : item\.valueText\);/.test(dash));
  ok("the phone accordion shows the short text with the full text as its tooltip",
    /<span title=\{breakdownChipValue\(customMode \? item\.value : item\.valueText\)\.full\}[^>]*textOverflow: "ellipsis"[^>]*>\{breakdownChipValue\(customMode \? item\.value : item\.valueText\)\.text\}<\/span>/.test(dash));
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const dash = readCodeOnly("app/components/DashboardClient.tsx");

const base = await suite(await loadSibling(MODULE, src), dash);
if (base.length) {
  console.error("FAIL check-breakdown-chips:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["the grid back to 1fr 1fr (the SPCX overflow)", () => [src, mut("grid", dash, `gridTemplateColumns: "repeat(2, minmax(0, 1fr))"`, `gridTemplateColumns: "1fr 1fr"`)]],
  ["the chip cannot shrink", () => [src, mut("chip", dash, `alignItems: "center", minWidth: 0, padding: "8px 10px"`, `alignItems: "center", padding: "8px 10px"`)]],
  ["the value never cut", () => [src, mut("ellipsis", dash, `minWidth: 0, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", marginLeft: "auto" }}>{v.text}`, `marginLeft: "auto" }}>{v.text}`)]],
  ["values cut instead of wrapping (the first try: Normal 0.61× hidden)", () => [src, mut("wrap", dash, `display: "flex", flexWrap: "wrap", justifyContent: "space-between"`, `display: "flex", justifyContent: "space-between"`)]],
  ["the full label shown in the chip", () => [src, mut("full", dash, `}}>{v.text}</div>`, `}}>{v.full}</div>`)]],
  ["no tooltip", () => [src, mut("tip", dash, "title={`${item.label}: ${v.full}`} ", "")]],
  ["not shortened", () => [mut("short", src, "text: m ? `Partial ${m[1]}/${m[2]}` : full", "text: full"), dash]],
  ["the tooltip loses the full wording", () => [mut("keep", src, "return { text: m ? `Partial ${m[1]}/${m[2]}` : full, full };", "return { text: m ? `Partial ${m[1]}/${m[2]}` : full, full: m ? `Partial ${m[1]}/${m[2]}` : full };"), dash]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, d] = make();
  let fails;
  try { fails = await suite(await loadSibling(MODULE, s), d); } catch { fails = ["threw"]; }
  if (!fails.length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-breakdown-chips: partial label shortened with full text kept, grid cannot widen; ${MUTANTS.length} mutants caught`);
