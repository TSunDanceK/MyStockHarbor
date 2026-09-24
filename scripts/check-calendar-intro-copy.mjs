// The earnings-calendar intro, gap message and Backfill control (#552, COWORK
// #26 items 2-4), checked with a mutation per assertion.
//
//   2. The intro no longer promises "EPS/revenue estimates": the SEC-fed grid
//      shows none, so the sentence described a column that is not there.
//   3. The day-state note ("Results for this date cannot be listed right
//      now...") renders ONCE, in the day panel, not also under the heading.
//   4. BackfillButton renders nothing when there is nothing to fetch, instead
//      of a disabled "Backfill (no earnings on this date)" label every reader
//      saw.
//
// Item 4 is RENDERED (react-dom/server); items 2-3 are read from page.tsx,
// which is an async server component with Redis reads and cannot be rendered
// here. Comments are stripped first so a dated comment quoting the old copy
// cannot satisfy or fail an assertion.
//
//   node scripts/check-calendar-intro-copy.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { stripComments, assertStripKeptTheCode } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "package.json"));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const strip = (src, file) => {
  const code = stripComments(src, { file });
  assertStripKeptTheCode(src, code, file);
  return code;
};

const PAGE = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/page.tsx"), "utf8");
const BTN = fs.readFileSync(path.join(ROOT, "app/earnings-calendar/BackfillButton.tsx"), "utf8");

// ── items 2 + 3: the intro paragraph ────────────────────────────────────────
// The intro is the first <p> after the <h1> ("Earnings filed ...").
const introOf = (page) => {
  const code = strip(page, "app/earnings-calendar/page.tsx");
  const h1 = code.indexOf("Earnings filed today");
  if (h1 < 0) return null;
  const start = code.indexOf("<p", h1);
  const end = code.indexOf("</p>", start);
  return start < 0 || end < 0 ? null : code.slice(start, end);
};
const noteUses = (page) => (strip(page, "app/earnings-calendar/page.tsx").match(/\{\s*dayStateNote\s*\}|:\s*dayStateNote\s*\}/g) ?? []).length;

const pageHolds = (page) => {
  const intro = introOf(page);
  return {
    found: intro != null,
    noEstimates: intro != null && !/estimate/i.test(intro),
    noNoteInIntro: intro != null && !/dayStateNote/.test(intro),
    noteOnce: noteUses(page) === 1,
  };
};

console.log("\n2-3. INTRO COPY AND THE GAP MESSAGE");
{
  const r = pageHolds(PAGE);
  check("the intro paragraph was located", r.found);
  check("the intro does not mention estimates", r.noEstimates);
  check("the intro does not repeat the day-state note", r.noNoteInIntro);
  check("the day-state note renders exactly once (the day panel)", r.noteOnce, `uses=${noteUses(PAGE)}`);
  check("that one use is inside the day panel, after the date heading",
    strip(PAGE, "app/earnings-calendar/page.tsx").search(/:\s*dayStateNote\s*\}/) > strip(PAGE, "app/earnings-calendar/page.tsx").indexOf("formatDateLabel(selectedDate)}</div>"));
}

const pageMutation = (name, from, to, key) => {
  if (!PAGE.includes(from)) {
    check(`mutation "${name}" could not be applied`, false, `source no longer contains: ${from.slice(0, 70)}`);
    return;
  }
  const r = pageHolds(PAGE.replace(from, to));
  check(`MUTATION "${name}" breaks the assertion`, !r[key],
    r[key] ? "the property still held with the fix removed — the assertion proves nothing" : "");
};
pageMutation("estimates back in the intro",
  "date for tickers, price and market cap.", "date for tickers, EPS/revenue estimates, price and market cap.", "noEstimates");
pageMutation("gap message back under the heading",
  "                  See how many companies have filed on each day",
  "                  {dayStateNote} See how many companies have filed on each day", "noteOnce");

// ── item 4: BackfillButton, rendered ────────────────────────────────────────
const buildBtn = async (src) => {
  const js = ts.transpileModule(src.replace(/^"use client";\s*/, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", "React", js)(require, mod, mod.exports, React);
  return mod.exports.default;
};
const renderBtn = async (src, hasEarnings) =>
  renderToStaticMarkup(React.createElement(await buildBtn(src), { date: "2026-09-21", hasEarnings }));

console.log("\n4. BACKFILL CONTROL");
{
  const none = await renderBtn(BTN, false);
  const some = await renderBtn(BTN, true);
  check("no candidates → renders nothing", none === "", JSON.stringify(none).slice(0, 80));
  check("with candidates → the owner control still renders", /Backfill this date/.test(some));
  check("no reader-facing \"no earnings on this date\" text anywhere in the code",
    !/no earnings on this date/i.test(strip(BTN, "app/earnings-calendar/BackfillButton.tsx")));

  const from = "  if (!hasEarnings) {\n    return null;\n  }";
  if (!BTN.includes(from)) {
    check("mutation \"disabled label back\" could not be applied", false);
  } else {
    const mutated = BTN.replace(from,
      '  if (!hasEarnings) {\n    return <button type="button" disabled>Backfill (no earnings on this date)</button>;\n  }');
    const r = await renderBtn(mutated, false);
    check("MUTATION \"disabled label back\" breaks the assertion", r !== "", r ? "" : "still rendered nothing");
  }
}

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}\n`);
process.exit(failures ? 1 : 0);
