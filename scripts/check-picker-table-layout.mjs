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
  "its sort key counts SCREENER MEMBERSHIP, not indicator names",
  /get: \(e\) => e\.reasons\?\.length/.test(signalsBlock),
  "firedIndicators is the composite's oversold/overbought list, populated only for stocks the composite flagged -- on a page like Near 200-Day most rows are neither, so it was blank for rows that plainly satisfy the page's own condition"
);
check(
  "the column no longer reads firedIndicators at all",
  !/firedIndicators/.test(signalsBlock.split("//").join("").split("\n").filter((l) => !l.trim().startsWith("*")).join("\n")),
  "reading both would be two quantities under one heading"
);
check(
  "an empty list sorts as null, not 0",
  /\?\.length \|\| null/.test(signalsBlock),
  "the comparator tests null before applying direction, so nulls sink both ways — a 0 would ride to the top of an ascending sort while the cell shows a dash"
);
check(
  "an empty list displays as MUTED, not a zero",
  /if \(!reasons\.length\) return MUTED;/.test(signalsBlock),
  "on an unfiltered /stock-screener view most rows legitimately have no fired checks, and that blank is correct"
);

console.log("\n=== 2. A bare count, with the names behind it ===\n");

// REPLACES the SIGNALS_COLLAPSE_AT assertions. That threshold existed to keep
// short lists rendering as text; the column is a pure number now, so the
// threshold is gone and asserting it would pin a design that was removed.
check(
  "the cell renders a bare count",
  /\{reasons\.length\}/.test(signalsBlock),
  "the column is called Signals, so the digits do not need the word repeating after them"
);
check(
  "no collapse threshold survives",
  !/SIGNALS_COLLAPSE_AT/.test(grid),
  "it protected a text rendering that no longer exists, so leaving it would be dead configuration"
);
check(
  "the full list is on hover",
  /title=\{reasons\.join/.test(signalsBlock),
  "a count with nothing behind it is the #330 failure; the names are what make it a summary rather than a substitute"
);
check(
  "the row carries its note on hover",
  /title=\{entry\.note \|\| undefined\}/.test(grid),
  "the table renders `note` nowhere else, and on the trend-flip pages it is the flip date -- which used to reach list view through this very column"
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

console.log("\n=== 4. The sidebar can actually shrink ===\n");

const nav = fs.readFileSync(path.join(process.cwd(), "app/components/ScreenerNav.tsx"), "utf8");
const shell = fs.readFileSync(path.join(process.cwd(), "app/components/ScreenerShell.tsx"), "utf8");

check(
  ".screenerNavItem sets min-width: 0",
  /\.screenerNavItem \{[^}]*min-width: 0;/s.test(nav),
  "it is a grid item, so its default min-width is auto and it refuses to shrink -- the label's ellipsis never engages and the row overflows the column instead"
);
check(
  ".screenerNavLabel can still ellipsize",
  /\.screenerNavLabel \{[^}]*min-width: 0[^}]*text-overflow: ellipsis/s.test(nav),
  "the chain is only unbroken if every level from the row down can shrink"
);
check(
  "both copies of the shell agree on the widths",
  (() => {
    const a = pageRaw.match(/\.resultWrap \{ max-width: (\d+)px/)?.[1];
    const b = shell.match(/\.resultWrap \{ max-width: (\d+)px/)?.[1];
    const c = pageRaw.match(/grid-template-columns: (\d+)px minmax/)?.[1];
    const d = shell.match(/grid-template-columns: (\d+)px minmax/)?.[1];
    return a === b && c === d;
  })(),
  "these class names are defined twice globally, so /plays and the picker pages would otherwise render different sidebars"
);
check(
  "ScreenerShell uses clip, not hidden",
  !/overflow-x:\s*hidden/.test(shell),
  "the sidebar inside it is position: sticky, and hidden coerces the other axis to auto, making a scroll container that breaks it"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
