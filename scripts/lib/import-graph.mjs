// Resolving this repo's imports, and walking the graph they form.
//
// EXTRACTED FROM check-static-safety.mjs RATHER THAN COPIED. Two scripts now ask
// import-graph questions -- "what does this route reach" and "what reaches this
// module" -- and they have to agree, because the second is what decides whether
// a bare Redis client is exempt. Two resolvers that disagree about one alias
// would quietly exempt a module a page really does reach
// (claude/traps/two-validators-for-one-value.md).
//
// Behaviour is unchanged from the original: same alias handling, same extension
// order, same type-only skip.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();

/** `@/x` and relative specifiers only. Anything else is node_modules, i.e. not our code. */
export function resolveImport(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), base]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Direct imports of one file, resolved to absolute paths.
 *
 * TYPE-ONLY IMPORTS ARE SKIPPED, and that is load-bearing rather than tidiness:
 * `import type { X }` is erased at compile time and pulls no runtime code, so
 * counting it would report a module as reachable when nothing it contains ever
 * executes -- and here that would mean failing a genuinely exempt client.
 */
export function importsOf(file) {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const out = [];
  for (const st of sf.statements) {
    if (
      (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) &&
      st.moduleSpecifier &&
      ts.isStringLiteral(st.moduleSpecifier)
    ) {
      if (ts.isImportDeclaration(st) && st.importClause?.isTypeOnly) continue;
      const r = resolveImport(st.moduleSpecifier.text, file);
      if (r) out.push(r);
    }
  }
  return out;
}

/** Every module transitively reachable from `entry`, including `entry` itself. */
export function reachableFrom(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const dep of importsOf(file)) stack.push(dep);
  }
  return seen;
}

/** Every `page.tsx` / `layout.tsx` under app/ -- the roots a render can start from. */
export function routeEntryPoints() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx" || e.name === "layout.tsx") out.push(p);
    }
  })(path.join(ROOT, "app"));
  return out;
}
