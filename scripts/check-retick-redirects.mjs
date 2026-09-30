// RETICKERED STOCK PAGES REDIRECT TO THE LIVE TICKER (#553 COWORK #73, #75).
//
// /stock/BK and /stock/EQR rendered full technical pages from the dead
// tickers' old price history. lib/retickRedirects.ts sends them (and their
// earnings pages), in any letter case, to /stock/BNY and /stock/VMRK.
//
//   1. The entries, compiled with NEXT'S OWN matcher (getPathMatch, as custom
//      routes use it): /stock/BK, /stock/bk, /stock/Eqr/earnings match and go
//      to the live ticker; /stock/BKNG, /stock/BNY, /stock/EQR/news and
//      /stock/EA do not. All permanent.
//   2. next.config.ts spreads them into redirects().
//   MUTANTS: a pair dropped; the earnings entry dropped. Each must be caught.
//
//   node scripts/check-retick-redirects.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match.js");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const MODULE = "lib/retickRedirects.ts";
const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
let seq = 0;
async function load(source) {
  const file = path.join(ROOT, "lib", `.check-retick-redirects-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

// Where a path lands, using the entries in order, as Next does (first match wins).
const land = (entries, p) => {
  for (const e of entries) {
    const m = getPathMatch(e.source, { strict: true, removeUnnamedParams: true })(p);
    if (m) return { to: e.destination, permanent: e.permanent };
  }
  return null;
};
function suite(mod) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const e = mod.retickRedirects();
  const want = {
    "/stock/BK": "/stock/BNY", "/stock/bk": "/stock/BNY", "/stock/Bk": "/stock/BNY",
    "/stock/BK/earnings": "/stock/BNY/earnings", "/stock/bk/earnings": "/stock/BNY/earnings",
    "/stock/EQR": "/stock/VMRK", "/stock/eqr": "/stock/VMRK", "/stock/Eqr/earnings": "/stock/VMRK/earnings",
  };
  for (const [p, to] of Object.entries(want)) {
    const r = land(e, p);
    ok(`${p} -> ${to}, permanent`, r?.to === to && r?.permanent === true, JSON.stringify(r));
  }
  for (const p of ["/stock/BKNG", "/stock/BNY", "/stock/VMRK", "/stock/EQR/news", "/stock/EA", "/stock/WBS", "/stock/EQRX"]) {
    ok(`${p} is not redirected`, land(e, p) === null, JSON.stringify(land(e, p)));
  }
  ok("only retickers: exactly BK->BNY and EQR->VMRK", JSON.stringify(mod.RETICK_REDIRECTS) === '[["BK","BNY"],["EQR","VMRK"]]');
  return fails;
}

console.log("\n1. the entries, on Next's own matcher (case-insensitive, as Next matches)");
const base = suite(await load(src));
check("every expected path lands (any case), and nothing else does", base.length === 0, base.join("; "));

console.log("\n2. wired into next.config.ts");
const cfg = readCodeOnly("next.config.ts");
check("next.config imports and spreads retickRedirects() into redirects()",
  /import \{ retickRedirects \} from "\.\/lib\/retickRedirects";/.test(cfg) && /async redirects\(\) \{\s*return \[\s*\.\.\.retickRedirects\(\),/.test(cfg));

console.log("\n3. mutants");
const MUTANTS = [
  ["a pair dropped (EQR)", (s) => s.replace('  ["EQR", "VMRK"],\n', "")],
  ["the earnings entry dropped", (s) => s.replace(/\n\s*\{ source: `\/stock\/\$\{from\}\/earnings`[^\n]*/, "")],
];
for (const [label, mutate] of MUTANTS) {
  const m = mutate(src);
  if (m === src) { check(`mutant "${label}" applies`, false, "nothing replaced"); continue; }
  check(`mutant caught: ${label}`, suite(await load(m)).length > 0);
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
