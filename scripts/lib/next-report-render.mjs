// Render the two next-report surfaces to reader-visible text:
//   the /stock/[symbol] Earnings snapshot tile (app/components/LatestEarningsCard.tsx)
//   the /stock/[symbol]/earnings "Next report" card (app/stock/[symbol]/earnings/NextReportCard.tsx)
//
// Shared by scripts/check-next-report-band.mjs (fixtures + mutants) and
// scripts/next-report-band-render.mjs (live records, via the relay), so the
// check and the live render read the components the same way.
import fs from "node:fs";
import ts from "typescript";
import { loadSnapshot, html, visibleText, React } from "./render-snapshot.mjs";
import { OLD_CARD_TSX } from "./next-report-legacy.mjs";

/** Transpile a .tsx source and import it from a real path (so react/jsx-runtime resolves). */
export async function importTsx(src, name) {
  const js = ts.transpileModule(src, {
    fileName: `${name}.tsx`,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react",
    },
  }).outputText;
  const tmp = `scripts/.next-report-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`;
  fs.writeFileSync(tmp, js);
  try {
    return await import(`${process.cwd()}/${tmp}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export const CARD_FILE = "app/stock/[symbol]/earnings/NextReportCard.tsx";

/** The shipped card. NextReportCard imports only a type, so it loads alone. */
export const loadCard = (mutate = (s) => s) => importTsx(mutate(fs.readFileSync(CARD_FILE, "utf8")), "card");
/** The removed card, for mutants and the "before" column. */
export const loadOldCard = () => importTsx(OLD_CARD_TSX, "oldcard");

export { loadSnapshot };

/**
 * The tile's visible text, with `nextReport` in the slot the page fills.
 *
 * The figures come from a committed SEC fact-set fixture: this renders the
 * WHOLE card so a date anywhere in it is scanned, but only the next-report
 * cell varies. `facts` are the snapshot's own filed dates, which the card may
 * legitimately print.
 */
export function tileText(S, symbol, nextReport, factset) {
  const view = S.buildSecEarningsView(factset);
  const score = S.scoreFromSec(view, symbol, { status: "ready", set: factset, cold: false });
  const snapshot = S.buildSecEarningsSnapshot({ symbol, view, score, reported: null, nextReport });
  const text = visibleText(html(React.createElement(S.default, { snapshot, symbol })));
  return { text, facts: [snapshot.periodEnd, snapshot.reportedOn], periodLabel: snapshot.periodLabel };
}

/** Just the tile's "Next earnings" cell, as a reader sees it. */
export function tileNextCell(text, periodLabel) {
  const start = text.indexOf("Next earnings");
  if (start < 0) return null;
  const end = periodLabel ? text.indexOf(periodLabel, start) : -1;
  return text.slice(start, end > start ? end : undefined).trim();
}

export const cardText = (C, outlook) =>
  outlook ? visibleText(html(React.createElement(C.default, { outlook }))) : "";

export const oldCardText = (Old, view, clean) =>
  visibleText(html(React.createElement(Old.default, { nextReport: view, clean })));
