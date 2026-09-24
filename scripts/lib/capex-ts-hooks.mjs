// Module hooks for the capex relay scripts (Relay C, #563): the repo's own
// ts-resolve.mjs adds ".ts" to relative imports, and this adds the two things
// the app's modules also need when run bare under Node:
//   - the "@/..." path alias (tsconfig maps "@/*" to the repo root);
//   - importing a .json file without an import attribute, as Next allows.
// Used by scripts/capex-spending-run.mjs through register-capex-ts.mjs, so the
// seed runs A's resolver and fact-set readers themselves rather than a copy.
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = process.cwd();

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = path.join(ROOT, specifier.slice(2));
    const withExt = fs.existsSync(target) ? target : fs.existsSync(`${target}.ts`) ? `${target}.ts` : target;
    return nextResolve(pathToFileURL(withExt).href, context);
  }
  if (specifier.startsWith(".") && !/\.[mc]?[jt]s$|\.json$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // fall through
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".json")) {
    const text = fs.readFileSync(fileURLToPath(url), "utf8");
    return { format: "module", source: `export default ${text};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
