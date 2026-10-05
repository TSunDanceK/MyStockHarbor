// RENDER THE APP'S PAGES UNDER BARE NODE, FOR THE BROWSER MEASURES
// (#563 COWORK #100: scripts/measure-reading-size.mjs).
//
// A loader hook, registered only by a script that asks for it:
//   - .ts / .tsx are transpiled with the repo's own TypeScript (JSX → react-jsx);
//   - `@/x` → <repo root>/x and extensionless relatives try .ts, .tsx, /index.ts(x);
//   - `next/*`, `server-only` and CSS imports resolve to small stubs;
//   - any specifier in MEASURE_STUBS (a JSON map, specifier → stub file) is
//     replaced, which is how a measure feeds fixture data to a server page
//     instead of Redis;
//   - .json imported without an attribute is served as `export default`.
// Nothing here reaches the network or Redis.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STUB_DIR = path.join(ROOT, "scripts/lib/measure-stubs");
const BUILTIN = {
  "next/link": "next-link.mjs",
  "next/navigation": "next-navigation.mjs",
  "next/cache": "next-cache.mjs",
  "next/image": "next-image.mjs",
  "next/headers": "next-headers.mjs",
  "next/server": "next-server.mjs",
  "next/script": "next-script.mjs",
  "server-only": "empty.mjs",
};
const extra = () => { try { return JSON.parse(process.env.MEASURE_STUBS || "{}"); } catch { return {}; } };
const file = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const tryExts = (base) => [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find(file);

export async function resolve(specifier, context, nextResolve) {
  const stubs = extra();
  if (stubs[specifier]) return { url: pathToFileURL(path.resolve(ROOT, stubs[specifier])).href, shortCircuit: true };
  if (BUILTIN[specifier]) return { url: pathToFileURL(path.join(STUB_DIR, BUILTIN[specifier])).href, shortCircuit: true };
  if (/\.css$/.test(specifier)) return { url: pathToFileURL(path.join(STUB_DIR, "empty.mjs")).href, shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const hit = tryExts(path.join(ROOT, specifier.slice(2)));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const hit = tryExts(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && /\.tsx?$/.test(url)) {
    const src = fs.readFileSync(fileURLToPath(url), "utf8");
    const out = ts.transpileModule(src, {
      fileName: fileURLToPath(url),
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "react", esModuleInterop: true, verbatimModuleSyntax: false },
    }).outputText;
    return { format: "module", source: out, shortCircuit: true };
  }
  if (url.endsWith(".json") && context.importAttributes?.type !== "json") {
    return { format: "module", source: `export default ${fs.readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
