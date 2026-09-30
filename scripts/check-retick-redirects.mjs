// RETICKERED STOCK PAGES REDIRECT TO THE LIVE TICKER (#553 COWORK #73, #75, #78).
//
// /stock/BK and /stock/EQR rendered full technical pages from the dead
// tickers' old price history. lib/retickRedirects.ts sends every spelling of
// them, and every page under them, to /stock/BNY and /stock/VMRK.
//
// MATCHED AS THE DEPLOYMENT MATCHES. The first version of this check used
// Next's runtime getPathMatch, which is case-insensitive, and passed while the
// preview left /stock/bk on the stale page (COWORK #78). The deployment matches
// the REGEX STRING Next writes into the routes manifest (buildCustomRoute keeps
// compiled.source, so the "i" flag is gone). So this check builds each entry
// with Next's own buildCustomRoute and tests its regex with NO flags.
//
//   1. The generated list, pinned: every case spelling of BK (4) and EQR (8),
//      each as an exact entry plus a /:path+ entry, all permanent.
//   2. Landing, on the manifest regexes: /stock/bk, /stock/Eqr/earnings,
//      /stock/EQR/news ... go to the live ticker; /stock/BKNG, /stock/BNY,
//      /stock/EA, /stock/EQRX do not.
//   3. next.config.ts spreads them into redirects().
//   MUTANTS: uppercase only (the shipped bug); subroutes dropped; a pair dropped.
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
const { buildCustomRoute } = require("next/dist/lib/build-custom-route.js");
// What next build passes for redirects (build/index.js: restrictedRedirectPaths).
// An empty list is NOT neutral: it compiles to (?!), which matches nothing.
const RESTRICTED = ["/_next"];
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

// Where a path lands: entries in order, first match wins, each matched by the
// manifest regex with no flags. The destination's :path+ takes the capture.
const land = (entries, p) => {
  for (const e of entries) {
    const { regex } = buildCustomRoute("redirect", e, RESTRICTED);
    const m = new RegExp(regex).exec(p);
    if (m) {
      const rest = m.slice(1).find((g) => g !== undefined);
      return { to: e.destination.replace(":path+", rest ?? ""), permanent: e.permanent };
    }
  }
  return null;
};

function suite(mod) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const e = mod.retickRedirects();

  // 1. the list, pinned
  const sources = new Set(e.map((x) => x.source));
  const spellings = { BK: ["BK", "Bk", "bK", "bk"], EQR: ["EQR", "EQr", "EqR", "Eqr", "eQR", "eQr", "eqR", "eqr"] };
  const want = { BK: "BNY", EQR: "VMRK" };
  for (const [old, vs] of Object.entries(spellings)) {
    for (const v of vs) {
      ok(`entry /stock/${v} -> /stock/${want[old]}`, e.some((x) => x.source === `/stock/${v}` && x.destination === `/stock/${want[old]}`));
      ok(`entry /stock/${v}/:path+ -> /stock/${want[old]}/:path+`, e.some((x) => x.source === `/stock/${v}/:path+` && x.destination === `/stock/${want[old]}/:path+`));
    }
  }
  ok("exactly 24 entries (12 spellings x page + subroutes)", e.length === 24 && sources.size === 24, String(e.length));
  ok("all permanent", e.every((x) => x.permanent === true));

  // 2. landing, as the deployment matches
  const lands = {
    "/stock/BK": "/stock/BNY", "/stock/bk": "/stock/BNY", "/stock/Bk": "/stock/BNY",
    "/stock/BK/earnings": "/stock/BNY/earnings", "/stock/bk/earnings": "/stock/BNY/earnings",
    "/stock/EQR": "/stock/VMRK", "/stock/eqr": "/stock/VMRK", "/stock/Eqr/earnings": "/stock/VMRK/earnings",
    "/stock/eqr/earnings": "/stock/VMRK/earnings", "/stock/EQR/news": "/stock/VMRK/news", "/stock/bk/news": "/stock/BNY/news",
  };
  for (const [p, to] of Object.entries(lands)) {
    const r = land(e, p);
    ok(`${p} -> ${to}, permanent`, r?.to === to && r?.permanent === true, JSON.stringify(r));
  }
  for (const p of ["/stock/BKNG", "/stock/bkng", "/stock/BNY", "/stock/VMRK", "/stock/EA", "/stock/WBS", "/stock/EQRX", "/stock/eqrx/news"]) {
    ok(`${p} is not redirected`, land(e, p) === null, JSON.stringify(land(e, p)));
  }
  ok("only retickers: exactly BK->BNY and EQR->VMRK", JSON.stringify(mod.RETICK_REDIRECTS) === '[["BK","BNY"],["EQR","VMRK"]]');
  return fails;
}

console.log("\n1-2. the generated entries, on the manifest regexes Next deploys (matched without flags)");
const base = suite(await load(src));
for (const f of base) check(f, false);
check("every spelling and subroute lands on the live ticker, and nothing else does", base.length === 0);

console.log("\n3. wired into next.config.ts");
const cfg = readCodeOnly("next.config.ts");
check("next.config imports and spreads retickRedirects() into redirects()",
  /import \{ retickRedirects \} from "\.\/lib\/retickRedirects";/.test(cfg) && /async redirects\(\) \{\s*return \[\s*\.\.\.retickRedirects\(\),/.test(cfg));

console.log("\n4. mutants");
const MUTANTS = [
  ["uppercase only (the bug the preview found)", (s) => s.replace("caseVariants(from).flatMap(", "[from].flatMap(")],
  ["subroutes dropped", (s) => s.replace(/\n\s*\{ source: `\/stock\/\$\{v\}\/:path\+`[^\n]*/, "")],
  ["a pair dropped (EQR)", (s) => s.replace('  ["EQR", "VMRK"],\n', "")],
];
for (const [label, mutate] of MUTANTS) {
  const m = mutate(src);
  if (m === src) { check(`mutant "${label}" applies`, false, "nothing replaced"); continue; }
  check(`mutant caught: ${label}`, suite(await load(m)).length > 0);
}

// The old check's blind spot, kept as evidence: Next's runtime matcher accepts
// /stock/bk against the uppercase-only source; the manifest regex does not.
{
  const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match.js");
  const runtime = !!getPathMatch("/stock/BK", { strict: true, removeUnnamedParams: true })("/stock/bk");
  const manifest = new RegExp(buildCustomRoute("redirect", { source: "/stock/BK", destination: "/stock/BNY", permanent: true }, RESTRICTED).regex).test("/stock/bk");
  check("the runtime matcher is case-insensitive but the deployed regex is not (why v1 of this check passed wrongly)", runtime && !manifest, JSON.stringify({ runtime, manifest }));
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
