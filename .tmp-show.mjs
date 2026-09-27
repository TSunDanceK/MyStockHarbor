import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url"; import ts from "typescript";
const ROOT = process.cwd(); const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
globalThis.__symbolSpellings = await import(pathToFileURL(path.join(ROOT, "lib/symbolSpellings.mjs")).href);
const src = read("lib/server/staticProfile.ts")
  .replace(/^import cikMap from "@\/data\/cik-map.json";$/m, () => `const cikMap = ${read("data/cik-map.json")};`)
  .replace(/^import registrantsFile from "@\/data\/sec\/registrants.json";$/m, () => `const registrantsFile = ${read("data/sec/registrants.json")};`)
  .replace(/^import classificationFile from "@\/data\/sec\/sic-classification.json";$/m, () => `const classificationFile = ${read("data/sec/sic-classification.json")};`)
  .replace(/^import overridesFile from "@\/data\/sec\/classification-overrides.json";$/m, () => `const overridesFile = ${read("data/sec/classification-overrides.json")};`)
  .replace(/^import \{ lookupSpellingIn \} from "@\/lib\/symbolSpellings\.mjs";$/m, "const { lookupSpellingIn } = globalThis.__symbolSpellings;");
const f = path.join(ROOT, `.tmp-sp-${process.pid}.mjs`);
fs.writeFileSync(f, ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const M = await import(pathToFileURL(f).href); fs.unlinkSync(f);
for (const s of process.argv[2].split(",")) console.log(s, JSON.stringify(M.sicProfileFor(s)));
