// Shared helpers for checks that lift a TypeScript function out of the source
// and run it: grabFunction (slice one function) and lift (strip types, import).
//
// RETIRED 2026-10-12 (#553 COWORK #212): loadEarningsPlan and
// sliceWarmEarningsRunRecord, which derived warm-earnings' batch and read its
// run record, went with that job. The file keeps its name for its importers.
import ts from "typescript";
import { readCodeOnly, assertLiftIsClosed } from "./source-code.mjs";

const erase = (src) =>
  ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;

/**
 * Pull one function out of a TS module, types erased first.
 *
 * TYPES ERASED BECAUSE BRACES IN SIGNATURES BREAK EVERY TEXTUAL RULE: an inline
 * parameter type closes with `}): ... {` and an inline return type with
 * `): { ... }`, and both have already cost this repo a lifted signature
 * fragment that exported nothing. Longest prefix first, or `export async
 * function` loses its `async` and the body's `await` is a syntax error.
 */
export const grabFunction = (tsSrc, name) => {
  const src = erase(tsSrc);
  let start = -1;
  for (const prefix of [
    "export async function ",
    "async function ",
    "export function ",
    "function ",
  ]) {
    const at = src.indexOf(`${prefix}${name}(`);
    if (at !== -1) {
      start = at;
      break;
    }
  }
  if (start === -1) return null;
  const bodyStart = src.indexOf("{", src.indexOf(")", start));
  if (bodyStart === -1) return null;
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
};

/**
 * Lift source into a live module — REFUSING one that cannot resolve itself.
 *
 * The closure check runs on the ERASED output rather than the TypeScript,
 * because type positions read like value references (`x: SomeType`) and would
 * be reported as missing names. After erasure only real value references
 * remain, which is exactly the set that can throw at call time.
 *
 * See assertLiftIsClosed in scripts/lib/source-code.mjs for why this is worth
 * a gate rather than a convention: three separate checks have shipped a lift
 * missing a closed-over constant, and each failed on the first CALL, after
 * output had printed, naming the symbol and not the reason.
 */
export const lift = async (src, extra = "", label = "lift") => {
  const js = erase(`${extra}\n${src}`);
  assertLiftIsClosed(js, label);
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
