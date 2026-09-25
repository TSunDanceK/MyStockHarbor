// The Tiingo key is read only by the relay's `tiingo` job (#553 COWORK #51).
//
// WHY. TIINGO_API_KEY is set in Vercel for Production AND Preview, and
// previews share production's stores. Until the adapter PR lands (with its
// own gate on where a provider call may run), nothing a Vercel build, an ISR
// render, a route or middleware executes may read it -- otherwise a preview
// or `next build` could spend the account's requests, and Tiingo data could
// reach a page before the contract obligations ship.
//
// WHAT FAILS: any reference to TIINGO_API_KEY (or a computed read of a
// TIINGO_* env var) in app/, lib/, components/, middleware, instrumentation
// or next.config. scripts/ is where the relay's probe lives and is not
// deployed code, so it is not scanned.
//
// WHEN THE ADAPTER PR LANDS it changes ALLOWED below, in the same diff, to
// the adapter's one file -- so the exception is reviewed rather than drifted
// into.
//
//   node scripts/check-tiingo-key-scope.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ALLOWED = new Set([]); // the adapter's file, when it exists
const ROOTS = ["app", "lib", "components", "hooks", "utils"];
const ROOT_FILES = ["middleware.ts", "middleware.js", "instrumentation.ts", "instrumentation-client.ts", "next.config.ts", "next.config.js", "next.config.mjs"];
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const PATTERN = /TIINGO_API_KEY|process\.env\[\s*[`'"]TIINGO/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(p, out); }
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

function scan(files) {
  return files
    .map((f) => path.relative(ROOT, f))
    .filter((rel) => !ALLOWED.has(rel) && PATTERN.test(fs.readFileSync(path.join(ROOT, rel), "utf8")));
}

const files = [...ROOTS.flatMap((d) => walk(path.join(ROOT, d), [])), ...ROOT_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f))];
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const hits = scan(files);
check(`no deployed file reads the Tiingo key (${files.length} files scanned)`, hits.length === 0, hits.join(", "));

// THE CHECK MUST BE ABLE TO FAIL: a planted read in a scratch file under lib/
// has to be caught, or the scan is measuring nothing.
const planted = path.join(ROOT, "lib", `.check-tiingo-${process.pid}.ts`);
fs.writeFileSync(planted, "export const k = process.env.TIINGO_API_KEY;\n");
try {
  check("a planted read under lib/ is caught", scan([planted]).length === 1);
} finally {
  fs.unlinkSync(planted);
}
const planted2 = path.join(ROOT, "lib", `.check-tiingo2-${process.pid}.ts`);
fs.writeFileSync(planted2, "const n = 'TIINGO_' + 'API_KEY'; export const k = process.env['TIINGO_' + 'X'];\n");
try {
  check("a computed process.env['TIINGO…'] read is caught", scan([planted2]).length === 1);
} finally {
  fs.unlinkSync(planted2);
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
