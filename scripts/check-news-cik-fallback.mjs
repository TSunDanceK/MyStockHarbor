// THE NEWS LEG'S CIK FALLS BACK TO A's MAP, AND WARRANTS STAY OUT (#553 COWORK #146/#148).
//
// 88 symbols tracked by A's manifest had no CIK in data/cik-map.json, so the
// SEC news backfill retried them nightly and never filled them. newsCikFor
// asks the news map first and A's committed ticker map (secColdFetch.cikForSymbol,
// imported, not copied) second. Warrants (Nasdaq fifth letter W, NYSE WS) that
// share a CIK with another tracked symbol leave the job's queues; funds stay.
//
// Runs the REAL modules against the committed files (no Redis, no network),
// plus crafted resolvers for the order rules. Every rule has a planted mutant.
//
//   node scripts/check-news-cik-fallback.mjs
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/next-server-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

const ROOT = process.cwd();
const PROVIDER = "lib/server/news/secProvider.ts";
const JOB = "lib/server/news/secFilingsJob.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
const tmp = [];
async function load(rel, src) {
  const dir = path.dirname(path.join(ROOT, rel));
  const f = path.join(dir, `.check-ncf-${process.pid}-${seq++}${path.extname(rel)}`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

async function runtimeRules(P, J) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const OWN = { "AAA": "0000000001" };
  const other = (s) => (s === "AAA" ? "0000000099" : s === "BBB" ? "0000000002" : null);
  want("the news map wins when it has the symbol", P.newsCikFor("AAA", OWN, other) === "0000000001");
  want("a news-map miss falls back to A's resolver", P.newsCikFor("BBB", OWN, other) === "0000000002");
  want("...normalised (trimmed, upper-cased) before asking it", P.newsCikFor("  bbb ", OWN, other) === "0000000002");
  want("both missing is undefined, never a guess", P.newsCikFor("ZZZ", OWN, other) === undefined);
  // The real files: three of the 88 and the three funds named in COWORK #146.
  for (const s of ["RVSN", "ADSE", "NCPL", "SPY", "GLD", "IBIT"]) {
    want(`${s}: no news-map CIK, resolved through A's map`, P.cikFor(s) === undefined && /^\d{10}$/.test(P.newsCikFor(s) ?? ""));
  }
  want("a symbol both maps hold resolves the same either way (AAPL)", P.cikFor("AAPL") === P.newsCikFor("AAPL"));
  // Warrants.
  const real = ["RVSN", "RVSNW", "ADSE", "ADSEW", "NCPL", "NCPLW", "SPY", "GLD", "IBIT", "SNOW", "AAPL"];
  const w = J.warrantSymbols(real);
  want("RVSNW, ADSEW and NCPLW are recognised as warrants", w.has("RVSNW") && w.has("ADSEW") && w.has("NCPLW"));
  want("...and nothing else in that list (commons, funds, SNOW)", w.size === 3);
  const crafted = (m) => (s) => m[s];
  want("an NYSE WS warrant sharing its issuer's CIK is recognised", J.warrantSymbols(["XYZ", "XYZ-WS"], crafted({ XYZ: "1", "XYZ-WS": "1" })).has("XYZ-WS"));
  want("a fifth-letter-W ticker with a CIK of its own is NOT a warrant", J.warrantSymbols(["ABCDW", "EFGH"], crafted({ ABCDW: "7", EFGH: "8" })).size === 0);
  return fails;
}

function wiringRules(providerSrc, jobSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  want("A's resolver is imported, not copied", /import \{ cikForSymbol \} from "\.\.\/secColdFetch";/.test(providerSrc) && !/loadTickerMap\(|secTickerMap|readFileSync\(/.test(providerSrc));
  const code = providerSrc;
  const fetchFor = code.slice(code.indexOf("async function fetchForSymbol"), code.indexOf("async function fetchForSymbol") + 400);
  const fetchSubs = code.slice(code.indexOf("export async function fetchSubmissionsItems"), code.indexOf("export async function fetchSubmissionsItems") + 300);
  want("the render read (fetchForSymbol) resolves through newsCikFor", /const cik = newsCikFor\(upper\);/.test(fetchFor));
  want("the job's fetch (fetchSubmissionsItems) resolves through newsCikFor", /const cik = newsCikFor\(upper\);/.test(fetchSubs));
  want("the job takes warrants out of the tracked set", /const warrants = warrantSymbols\(tracked\);/.test(jobSrc) && /const trackedSet = new Set\(tracked\.filter\(\(s\) => !warrants\.has\(s\)\)\);/.test(jobSrc));
  want("...and the backfill draws from that set, not the raw list", /missingSecFilingItems\(\[\.\.\.trackedSet\]\.filter/.test(jobSrc));
  return fails;
}

try {
  const pSrc = read(PROVIDER);
  const jSrc = read(JOB);
  const P = await import(pathToFileURL(path.join(ROOT, PROVIDER)).href);
  const J = await import(pathToFileURL(path.join(ROOT, JOB)).href);

  console.log("\n1. Runtime, on the committed files");
  const rt = await runtimeRules(P, J);
  check("the fallback order, the real symbols, and the warrant rule hold", rt.length === 0, rt.join("; "));

  console.log("\n2. Wiring");
  const wr = wiringRules(readCodeOnly(PROVIDER), readCodeOnly(JOB));
  check("both CIK reads go through newsCikFor; warrants leave the job's queues", wr.length === 0, wr.join("; "));

  console.log("\n3. Planted mutants");
  const RT_MUTANTS = [
    ["the fallback removed", PROVIDER, "  return (upper && fallback(upper)) || undefined;", "  return undefined;"],
    ["A's map asked first", PROVIDER, "  const own = cikFor(symbol, ciks);\n  if (own) return own;", "  const first = String(symbol).trim().toUpperCase();\n  const theirs = first && fallback(first);\n  if (theirs) return theirs;\n  const own = cikFor(symbol, ciks);\n  if (own) return own;"],
    ["the shared-CIK test dropped from the warrant rule", JOB, "(byCik.get(c) ?? 0) >= 2", "true"],
    ["the warrant spelling widened to any trailing W", JOB, "const WARRANT_SPELLING = /^[A-Z]{4}W$|[.-]WS(?:[.-][A-Z])?$/;", "const WARRANT_SPELLING = /W$/;"],
  ];
  for (const [label, file, from, to] of RT_MUTANTS) {
    const src = file === PROVIDER ? pSrc : jSrc;
    if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const m = src.replace(from, to);
    let f;
    try {
      if (file === PROVIDER) {
        const Pm = await load(PROVIDER, m);
        f = await runtimeRules(Pm, J);
      } else {
        const Jm = await load(JOB, m.replace('from "./secProvider"', `from "${pathToFileURL(path.join(ROOT, PROVIDER)).href}"`).replace('from "./secFilingsStore"', `from "${pathToFileURL(path.join(ROOT, "lib/server/news/secFilingsStore.ts")).href}"`));
        f = await runtimeRules(P, Jm);
      }
    } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const WIRE_MUTANTS = [
    ["the render read back on the news map alone", PROVIDER, /async function fetchForSymbol[\s\S]*?const cik = newsCikFor\(upper\);/, (m) => m.replace("newsCikFor(upper)", "cikFor(upper)")],
    ["the job's fetch back on the news map alone", PROVIDER, /export async function fetchSubmissionsItems[\s\S]*?const cik = newsCikFor\(upper\);/, (m) => m.replace("newsCikFor(upper)", "cikFor(upper)")],
    ["the warrant filter not applied", JOB, /const trackedSet = new Set\(tracked\.filter\(\(s\) => !warrants\.has\(s\)\)\);/, () => "const trackedSet = new Set(tracked);"],
    ["the backfill drawn from the raw list", JOB, /missingSecFilingItems\(\[\.\.\.trackedSet\]\.filter/, () => "missingSecFilingItems(tracked.filter"],
  ];
  for (const [label, file, from, to] of WIRE_MUTANTS) {
    const code = readCodeOnly(file);
    const m = code.replace(from, to);
    if (m === code) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = file === PROVIDER ? wiringRules(m, readCodeOnly(JOB)) : wiringRules(readCodeOnly(PROVIDER), m);
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
