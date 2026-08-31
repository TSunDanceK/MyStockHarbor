// The picker results table: the sort key must be the thing on screen, and the
// overflow values must stay clip.
//
// TWO INVARIANTS, both of which have bitten before and neither of which the
// type-checker can see.
//
// 1. A COLUMN MUST ORDER BY WHAT IT DISPLAYS. `get` is the sort key and `cell`
//    is the display, and nothing ties them together. The Signals column showed
//    a joined string and sorted by that string; now it shows a COUNT above a
//    threshold, so `get` has to be the count. Leave them out of step and the
//    header sorts by something the reader cannot see -- which is not a visible
//    failure, just an order that looks arbitrary.
//
// 2. overflow-x MUST BE `clip`, NEVER `hidden`. Per the CSS Overflow spec a
//    non-visible value on one axis coerces the other to `auto`, which makes the
//    element a scroll container, which silently breaks `position: sticky` for
//    everything inside it. That is what stopped the results table's sticky
//    header working once already. `clip` is the carve-out: it never creates a
//    scroll container.
//
//   node scripts/check-picker-table-layout.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const gridRaw = fs.readFileSync(path.join(process.cwd(), "app/components/PickerResultsGrid.tsx"), "utf8");
const grid = readCodeOnly("app/components/PickerResultsGrid.tsx");
const pageRaw = fs.readFileSync(path.join(process.cwd(), "app/components/PickerResultPage.tsx"), "utf8");

const signalsBlock = grid.slice(
  grid.indexOf("const signals: Col = {"),
  grid.indexOf("\n    };", grid.indexOf("const signals: Col = {"))
);

console.log("\n=== 1. Signals orders by the number it shows ===\n");

check(
  "the signals column was found",
  signalsBlock.length > 0,
  "every assertion below reads this block, so an empty slice would pass them all vacuously"
);
check(
  "it sorts numerically",
  /sortType: "num"/.test(signalsBlock),
  "a string sort under a numeric cell orders the column by something the reader cannot see"
);
check(
  "its sort key is the COUNT, not a joined string",
  /get: \(e\) => e\.firedIndicators\?\.length/.test(signalsBlock) && !/join\(/.test(signalsBlock.split("cell:")[0]),
  "get is the sort key and cell is the display; nothing in the types ties the two together"
);
check(
  "an empty list sorts as null, not 0",
  /\?\.length \|\| null/.test(signalsBlock),
  "the comparator tests null before applying direction, so nulls sink both ways — a 0 would ride to the top of an ascending sort while the cell shows a dash"
);
check(
  "an empty list displays as MUTED, not a zero",
  /if \(!fired\.length\) return MUTED;/.test(signalsBlock),
  "on an unfiltered /stock-screener view most rows legitimately have no fired checks, and that blank is correct"
);

console.log("\n=== 2. Short lists keep their text ===\n");

const threshold = Number(grid.match(/const SIGNALS_COLLAPSE_AT = (\d+);/)?.[1]);
check(
  "a collapse threshold exists",
  Number.isFinite(threshold),
  "a blanket count is the regression this guards against"
);
check(
  "the threshold is at least 3",
  threshold >= 3,
  "every daily trend-flip row carries exactly 2 entries — measured, 27 of 27 — so collapsing at 2 would replace the flip date the page is ordered by with the words '2 signals'"
);
check(
  "the collapse is keyed on LENGTH, not on which page it is",
  /fired\.length >= SIGNALS_COLLAPSE_AT/.test(signalsBlock) && !/href|pathname|slug/.test(signalsBlock),
  "a page test would need updating for every page added; a length test cannot fall out of date"
);
check(
  "the full list is still on hover",
  /title=\{full\}/.test(signalsBlock),
  "collapsing the text is only acceptable because nothing is actually lost"
);

console.log("\n=== 3. The layout levers, and the one that must not move ===\n");

const wrapWidth = Number(pageRaw.match(/\.resultWrap \{ max-width: (\d+)px;/)?.[1]);
const sidebar = Number(pageRaw.match(/\.resultShell \{ display: grid; grid-template-columns: (\d+)px/)?.[1]);

check(
  "the shell cap and the sidebar are both set",
  Number.isFinite(wrapWidth) && Number.isFinite(sidebar),
  `these two compete for the same row, so they are only meaningful together — ${wrapWidth}px cap, ${sidebar}px sidebar`
);
check(
  "the cap grew by more than the sidebar did",
  wrapWidth - 1360 > sidebar - 288,
  `otherwise the sidebar is taking width off the table and making the scroll worse, which is the opposite of the ask — cap +${wrapWidth - 1360}, sidebar +${sidebar - 288}`
);

// `hidden` IS THE DANGEROUS VALUE, not every non-clip value. .listScrollTop
// declares overflow-x: auto and is meant to: it IS the table's scrollbar strip,
// and nothing sticky lives inside it. What must never appear is `hidden`, which
// coerces the other axis to auto and turns an ANCESTOR of the sticky header
// into a scroll container.
const hiddenX = [...pageRaw.matchAll(/overflow-x:\s*hidden/g)];
check(
  "no overflow-x: hidden anywhere in the page",
  hiddenX.length === 0,
  `hidden coerces the other axis to auto, making a scroll container and killing sticky — clip is the carve-out that does not — found ${hiddenX.length}`
);

const stickyAncestors = ["\\.pickerResultPage \\{ overflow-x: clip", "\\.resultWrap \\{ width: 100%[^}]*overflow-x: clip"];
check(
  "the sticky elements' ancestors still use clip",
  stickyAncestors.every((re) => new RegExp(re).test(pageRaw)),
  "these two wrap the results table and the controls row, which are the things that stop sticking"
);
check(
  "neither .resultWrap nor .resultShell declares overflow in the desktop rules",
  !/\.resultWrap \{ max-width[^}]*overflow/.test(pageRaw) &&
    !/\.resultShell \{ display: grid[^}]*overflow/.test(pageRaw),
  "the sticky header and the sticky controls row both live inside these"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
