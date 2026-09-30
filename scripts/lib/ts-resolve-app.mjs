// THE APP'S TYPESCRIPT, WITH ITS `@/` ALIAS AND ITS PLAIN JSON IMPORTS, UNDER
// BARE NODE (#552 COWORK #70: the archive diff run rebuilds Layer 2 through the
// SHIPPED pipeline -- extractForSymbol, withPredecessorFacts, toStoredSet --
// whose modules import `@/data/sec/*.json` without an import attribute).
//
// A SEPARATE HOOK FROM ts-resolve.mjs, ON PURPOSE. That one is registered by
// many scripts and must not start rewriting their JSON imports. This one is
// registered only by a script that asks for it (register-ts-app.mjs):
//   - `@/x`            → <repo root>/x, trying x, x.ts, x.tsx, x/index.ts;
//   - `./x` (no ext)   → ./x.ts, as ts-resolve.mjs does;
//   - a .json file imported WITHOUT `with { type: "json" }` (the TS source's
//     form) is served as `export default <json>`. A .json imported WITH the
//     attribute is left to Node, unchanged.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = path.join(ROOT, specifier.slice(2));
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return nextResolve(pathToFileURL(cand).href, context);
    }
  }
  if (specifier.startsWith(".") && !/\.[mc]?[jt]s$|\.json$/.test(specifier)) {
    try { return await nextResolve(`${specifier}.ts`, context); } catch { /* fall through */ }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json") && context.importAttributes?.type !== "json") {
    const text = fs.readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${text};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
