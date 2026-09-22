// Load the per-symbol outlook producer AS A REAL MODULE GRAPH, not as a lift.
//
// ── WHY THIS IS NOT THE USUAL CONCATENATED LIFT ───────────────────────────
// Every other check in this suite stitches the source it needs into one string
// and imports it as a data: URL. symbolOutlook.ts reaches across six modules --
// expectedToReport, dueToReport, dueInputs, dueStripState, expectedCopy and
// secReportDates -- and two of those declare `const DAY`, `parse` and `valid`
// at top level. Concatenating them produces
//
//     SyntaxError: Identifier 'DAY' has already been declared
//
// which is exactly the failure relay 35714167889 hit on the census lift, and
// the remedy there (grab only the three constants you need) does not scale to a
// module that uses most of two files.
//
// So the modules are TRANSPILED SEPARATELY into a temp directory and imported
// through their real relative specifiers. Each file keeps its own scope, the
// collisions stop existing, and -- the part that matters for what this proves --
// the graph under test is the real one. A change to any of the six is picked up
// here without anyone remembering to widen a lift.
//
// ── TWO MODULES ARE STUBBED, AND ONLY TWO ─────────────────────────────────
// pickersBuilder and secReportDatesStore are the Redis edge. They are replaced
// with fixtures-from-globals so every branch is reachable offline, INCLUDING
// the outage branch, which is the one a live render can never show on demand.
// Anything else appearing in the stub list is a real dependency that stopped
// being tested; the loader throws rather than stubbing silently.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

/** The real modules, materialised from source on every load. */
const REAL = [
  "secReportDates",
  "expectedToReport",
  "expectedCopy",
  "dueToReport",
  "dueStripState",
  "dueInputs",
  "symbolOutlook",
];

const transpile = (src, fileName) =>
  ts.transpileModule(src, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;

/** One exported function's source, verbatim (found by the TS parser), or a loud failure. */
function realFunction(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
  const fn = sf.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn) throw new Error(`outlook-module: ${name} is not declared in ${file} any more`);
  return fn.getText(sf);
}

/**
 * The Redis edge, and the ONLY two things replaced.
 *
 * Fixtures arrive through globals rather than as constructor arguments because
 * the modules under test import these by name at module scope -- there is no
 * seam to pass anything through, and inventing one in production code so a test
 * can reach it would be the test dictating the design.
 */
const STUBS = {
  "pickersBuilder.mjs":
    `export const readPickersSymbolsIfCached = async () =>\n` +
    `  (globalThis.__OUTLOOK_UNIVERSE__ === undefined ? ["AAPL"] : globalThis.__OUTLOOK_UNIVERSE__);\n`,
  // ONLY THE READ IS STUBBED. latestResults is pure and is the one home for
  // "the latest results event", so it is carried across from the real file:
  // a stub that re-implemented it would be a second home inside the harness.
  "secReportDatesStore.mjs":
    `export const readReportDates = async (symbol) =>\n` +
    `  (globalThis.__OUTLOOK_RECORDS__?.get(symbol) ?? null);\n` +
    transpile(realFunction("lib/server/secReportDatesStore.ts", "latestResults"), "latestResults.ts"),
};


/**
 * Rewrite the specifiers Node cannot resolve, and NOTHING ELSE.
 *
 *  - `"./x"` -> `"./x.mjs"`: extensionless relative imports are a TypeScript
 *    convenience and an ESM error.
 *  - the committed JSON cut is inlined, because `import ... from "*.json"`
 *    needs an import attribute Node will not infer. It is read from the real
 *    file, never pinned as a literal here -- a checked-in list that this
 *    loader kept its own copy of would be a second home for the cut.
 */
function rewrite(js) {
  const cutPath = path.join(ROOT, "data/due-strip.json");
  let out = js.replace(
    /import\s+(\w+)\s+from\s+"(?:\.\.\/)+data\/due-strip\.json";/,
    (_m, name) => `const ${name} = ${fs.readFileSync(cutPath, "utf8")};`,
  );
  out = out.replace(/from\s+"(\.\/[A-Za-z0-9_-]+)"/g, (_m, spec) => `from "${spec}.mjs"`);
  return out;
}

/**
 * Every module specifier the file really imports, FROM THE AST.
 *
 * A textual scan cannot do this job here. The copy modules contain sentences
 * like `reads filing histories from " + "companies' own SEC filings`, and the
 * TypeScript printer emits that concatenation on one line beginning with
 * `export` -- so a regex for an import statement matched the prose and reported
 * ` + ` as an unresolvable module. The parser knows the difference between a
 * string and an import, which is the same reason readCodeOnly exists.
 */
function specifiersOf(src, file) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = [];
  for (const st of sf.statements) {
    const spec =
      (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier;
    // A TYPE-ONLY import is erased by the transpiler and never resolved at
    // runtime, so it is not a materialisation requirement.
    if (spec && ts.isStringLiteral(spec) && !(ts.isImportDeclaration(st) && st.importClause?.isTypeOnly)) {
      out.push(spec.text);
    }
  }
  return out;
}


/**
 * A fresh copy of the graph.
 *
 * `patch` maps a repo-relative .ts path to a function over its source, for the
 * mutation harness. A fresh temp directory per load is what makes the reload
 * real: Node caches modules by URL, so mutating a file and re-importing the
 * same path would return the first version and every mutant would "survive"
 * against code that was never loaded.
 */
export async function loadOutlookGraph({ patch = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outlook-"));
  for (const [name, src] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, name), src);
  for (const name of REAL) {
    const rel = `lib/server/${name}.ts`;
    const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const src = typeof patch[rel] === "function" ? patch[rel](raw) : raw;
    const unresolved = specifiersOf(src, rel).filter(
      (spec) => !REAL.includes(spec.replace("./", "")) &&
        !Object.keys(STUBS).includes(`${spec.replace("./", "")}.mjs`) &&
        !spec.endsWith(".json"),
    );
    if (unresolved.length) {
      throw new Error(
        `outlook-module: ${rel} imports ${unresolved.join(", ")}, which this loader does not ` +
          `materialise.\n  Add it to REAL (if it is real code worth testing) or to STUBS (if it ` +
          `is an I/O edge), and say in the comment which and why.`,
      );
    }
    fs.writeFileSync(path.join(dir, `${name}.mjs`), rewrite(transpile(src, rel)));
  }
  const mod = await import(path.join(dir, "symbolOutlook.mjs"));
  return {
    mod,
    dir,
    /** The copy module, for asserting on the exact strings a reader gets. */
    copy: await import(path.join(dir, "expectedCopy.mjs")),
    due: await import(path.join(dir, "dueStripState.mjs")),
    expected: await import(path.join(dir, "expectedToReport.mjs")),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Fixture plumbing, so no check has to know the global names. */
export const withStore = (records, universe) => {
  globalThis.__OUTLOOK_RECORDS__ = records ?? new Map();
  globalThis.__OUTLOOK_UNIVERSE__ = universe;
};
