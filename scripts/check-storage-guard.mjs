// Browser storage never crashes a page (Relay B, #553 COWORK #33).
//
// WHAT IS AT RISK, none of which breaks a build: with site data blocked, READING
// `window.localStorage` throws. SiteHeader read it bare in an effect, so the
// whole site crashed for those visitors (privacy modes, some embedded browsers).
//
// TWO PARTS:
//   1. lib/browserStorage.ts, run against storages that throw on the property
//      read, on getItem and on setItem: null / false back, never a throw.
//   2. EVERY localStorage / sessionStorage access in app/, lib/ and components/
//      sits inside a `try` block (TypeScript's own parser, not a regex), so a new
//      bare read anywhere on the site fails here.
// The rendered test (the header with a throwing storage, in a browser) is
// scripts/preview-screenshots.mjs page=storage.
//
//   node scripts/check-storage-guard.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = process.cwd();
const MODULE = "lib/browserStorage.ts";
const DIRS = ["app", "lib", "components"];

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-storage-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

function walkFiles(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walkFiles(rel, out); }
    else if (/\.(tsx?|mjs|js)$/.test(e.name) && !e.name.startsWith(".check-")) out.push(rel);
  }
  return out;
}

/** Storage accesses NOT inside a try block: [{file, line, text}]. */
export function unguardedAccesses(files) {
  const out = [];
  for (const [file, text] of files) {
    if (!/\b(localStorage|sessionStorage)\b/.test(text)) continue;
    const kind = file.endsWith("x") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const visit = (node) => {
      const isAccess =
        (ts.isPropertyAccessExpression(node) && (node.name.text === "localStorage" || node.name.text === "sessionStorage")) ||
        (ts.isIdentifier(node) && (node.text === "localStorage" || node.text === "sessionStorage") && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node));
      if (isAccess) {
        let guarded = false;
        for (let p = node; p.parent; p = p.parent) {
          if (ts.isTryStatement(p.parent) && p.parent.tryBlock === p) { guarded = true; break; }
          // Crossing into a nested function: the try must be inside it, not around its definition.
          if (ts.isFunctionLike(p)) break;
        }
        if (!guarded) out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: node.getText().slice(0, 60) });
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

async function suite(S, files) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const g = globalThis;
  const had = Object.getOwnPropertyDescriptor(g, "window");
  try {
    g.window = {};
    Object.defineProperty(g.window, "localStorage", { get() { throw new Error("SecurityError: blocked"); } });
    let threw = false, got;
    try { got = S.browserStorage(); } catch { threw = true; }
    ok("blocked storage (the property read throws): browserStorage is null, no throw", !threw && got === null);
    let r;
    try { r = S.readStored("k"); } catch { r = "threw"; }
    ok("blocked storage: readStored is null", r === null, String(r));
    let w;
    try { w = S.writeStored("k", "v"); } catch { w = "threw"; }
    ok("blocked storage: writeStored is false", w === false, String(w));
  } finally {
    if (had) Object.defineProperty(g, "window", had); else delete g.window;
  }
  const throwing = { getItem() { throw new Error("x"); }, setItem() { throw new Error("quota"); } };
  ok("getItem throws: null", S.readStored("k", throwing) === null);
  ok("setItem throws: false", S.writeStored("k", "v", throwing) === false);
  ok("no window (server): null / false", S.browserStorage() === null && S.readStored("k") === null && S.writeStored("k", "v") === false);
  const mem = new Map(); const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  ok("a working storage round-trips", S.writeStored("k", "v", store) === true && S.readStored("k", store) === "v" && S.readStored("absent", store) === null);

  const bad = unguardedAccesses(files);
  ok("every localStorage / sessionStorage access on the site is inside a try", bad.length === 0, bad.map((b) => `${b.file}:${b.line} ${b.text}`).join("; "));
  ok("the scan sees the site (the header and the helper)", files.has("app/components/SiteHeader.tsx") && files.has(MODULE));
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
const files = new Map(DIRS.flatMap((d) => walkFiles(d)).map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf8")]));

const base = await suite(await loadSibling(MODULE, src), files);
if (base.length) {
  console.error("FAIL check-storage-guard:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const withFile = (f, from, to) => { const m = new Map(files); m.set(f, mut(f, files.get(f), from, to)); return m; };
const MUTANTS = [
  ["the header's bare read is back (the original crash)", () => [src, withFile("app/components/SiteHeader.tsx", "setLastSymbol(cleanSymbol(readStored(SYMBOL_STORAGE_KEY)));", `setLastSymbol(cleanSymbol(window.localStorage.getItem("msh_last_symbol")));`)]],
  ["the header's click-time read unguarded", () => [src, withFile("app/components/SiteHeader.tsx", "return cleanSymbol(readStored(SYMBOL_STORAGE_KEY));", `return cleanSymbol(window.localStorage.getItem("msh_last_symbol"));`)]],
  ["the platforms write unguarded", () => [src, withFile("app/platforms/PlatformsClient.tsx", `writeStored("msh-platform-region", nextRegion);`, `window.localStorage.setItem("msh-platform-region", nextRegion);`)]],
  ["a bare sessionStorage read", () => [src, withFile("app/platforms/PlatformsClient.tsx", `const saved = readStored("msh-platform-region");`, `const saved = sessionStorage.getItem("msh-platform-region");`)]],
  ["a try around a function's DEFINITION, not its body", () => [src, withFile("app/platforms/PlatformsClient.tsx", `writeStored("msh-platform-region", nextRegion);`, `try { const f = () => window.localStorage.setItem("r", nextRegion); f(); } catch {}`)]],
  ["the property read outside the helper's try", () => [mut("prop", src, `  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }`, `  return typeof window === "undefined" ? null : window.localStorage;`), files]],
  ["readStored lets getItem throw", () => [mut("read", src, `  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }`, `  return storage?.getItem(key) ?? null;`), files]],
  ["writeStored lets setItem throw", () => [mut("write", src, `  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }`, `  storage.setItem(key, value);
  return true;`), files]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, f] = make();
  let fails;
  try { fails = await suite(await loadSibling(MODULE, s), f); } catch { fails = ["threw"]; }
  if (!fails.length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-storage-guard: throwing storage handled; ${files.size} files scanned, every storage access guarded; ${MUTANTS.length} mutants caught`);
