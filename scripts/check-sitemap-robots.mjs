// A STOCK URL IS IN THE SITEMAP ONLY WHILE ITS PAGE SAYS INDEX (#553 COWORK #143).
//
// The live sweep found stock pages carrying `noindex, follow` (IMOS, IART, MXL:
// their SEC set not yet read). The pages and app/sitemap.ts now share
// lib/stockPageRobots.ts. This check runs the real sitemap() (through
// scripts/lib/tsx-render-hooks.mjs) with the SEC state and the stored bars
// stubbed, and requires:
//   - an awaiting-SEC symbol: no /stock/X and no /stock/X/earnings;
//   - a symbol with no stored bars: no /stock/X (its page is noindex), while
//     its /earnings follows the earnings page's own rule;
//   - a symbol with no CIK: no /stock/X/earnings (that page is noindex);
//   - a dotted symbol's bars found under its dashed key (BRK.B -> BRK-B);
//   - either read unanswerable (null): nothing dropped, as before;
//   - a symbol off the filed list (#552 COWORK #197): no /stock/X/earnings;
// plus the predicates themselves. Each rule gets a planted mutant.
//
//   node scripts/check-sitemap-robots.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const SITEMAP = "app/sitemap.ts";
const ROBOTS = "lib/stockPageRobots.ts";
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const tag = `${process.pid}`;
const tmp = [];
const write = (rel, src) => { const f = path.join(ROOT, rel); fs.writeFileSync(f, src); tmp.push(f); return f; };

// Stubs: the fixture arrives in FIX (JSON).
const secStub = write(`scripts/.check-sitemap-sec-${tag}.mjs`, `
const F = JSON.parse(process.env.FIX);
export function cikForSymbol(s) { return F.noCik.includes(s) ? null : "0000000001"; }
export async function sitemapSecState(symbols) {
  if (F.secNull) return null;
  return { awaiting: new Set(symbols.filter((s) => F.awaiting.includes(s))), changedAt: new Map() };
}
`);
const readStub = write(`scripts/.check-sitemap-read-${tag}.mjs`, `
const F = JSON.parse(process.env.FIX);
const { priorityStocks, uniqueEtfs } = await import(process.env.ROOT + "/lib/curatedSymbols.ts");
export async function readTiingoEodLast() {
  if (F.eodNull) return null;
  const out = {};
  for (const s of [...priorityStocks, ...uniqueEtfs]) if (!F.noBars.includes(s)) out[s.replace(/\\./g, "-")] = { d: "2026-10-02" };
  return out;
}
`);
// #552 COWORK #197: the filed list. F.filed absent = unreadable (null).
const filedStub = write(`scripts/.check-sitemap-filed-${tag}.mjs`, `
const F = JSON.parse(process.env.FIX);
export async function filedEarningsSet() { return F.filed ? new Set(F.filed) : null; }
`);
const child = write(`scripts/.check-sitemap-child-${tag}.mjs`, `
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL(process.env.ROOT + "/scripts/lib/tsx-render-hooks.mjs"));
const M = await import(pathToFileURL(process.env.FILE).href);
const entries = await M.default();
process.stdout.write(JSON.stringify(entries.map((e) => e.url)));
`);

function urls(sitemapFile, robotsFile, fix) {
  const stubs = { "@/lib/server/secColdFetch": secStub, "@/lib/server/marketData/read": readStub, "@/lib/server/filedEarnings": filedStub };
  if (robotsFile) stubs["@/lib/stockPageRobots"] = robotsFile;
  const out = execFileSync(process.execPath, [child], {
    cwd: ROOT,
    env: { ...process.env, ROOT, FILE: sitemapFile, FIX: JSON.stringify({ awaiting: [], noBars: [], noCik: [], ...fix }), MEASURE_STUBS: JSON.stringify(stubs) },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Set(JSON.parse(out));
}
const U = (p) => `https://www.mystockharbor.com${p}`;

async function rules(sitemapFile, robotsFile) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const fix = { awaiting: ["AAPL"], noBars: ["MSFT"], noCik: ["TSLA"] };
  const s = urls(sitemapFile, robotsFile, fix);
  want("an awaiting-SEC symbol has neither /stock/X nor /stock/X/earnings", !s.has(U("/stock/AAPL")) && !s.has(U("/stock/AAPL/earnings")));
  want("a symbol with no stored bars has no /stock/X", !s.has(U("/stock/MSFT")));
  want("…while its /earnings follows the earnings page's own rule (CIK + read)", s.has(U("/stock/MSFT/earnings")));
  want("a symbol with no CIK has no /stock/X/earnings, and keeps /stock/X", !s.has(U("/stock/TSLA/earnings")) && s.has(U("/stock/TSLA")));
  want("an ordinary symbol keeps both", s.has(U("/stock/NVDA")) && s.has(U("/stock/NVDA/earnings")));
  want("a dotted symbol's bars are found under the dashed key (BRK.B)", s.has(U("/stock/BRK.B")));
  want("/news is unaffected (that page is always index)", s.has(U("/stock/AAPL/news")) && s.has(U("/stock/MSFT/news")));
  // #552 COWORK #197: a symbol off the filed list has no /earnings URL, and keeps /stock/X.
  const { priorityStocks } = await import(pathToFileURL(path.join(ROOT, "lib/curatedSymbols.ts")).href);
  const withFiled = urls(sitemapFile, robotsFile, { filed: priorityStocks.filter((x) => x !== "AMD") });
  want("a symbol with no filed set has no /stock/X/earnings, and keeps /stock/X (#552 COWORK #197)",
    !withFiled.has(U("/stock/AMD/earnings")) && withFiled.has(U("/stock/AMD")) && withFiled.has(U("/stock/NVDA/earnings")));
  const blind = urls(sitemapFile, robotsFile, { ...fix, secNull: true, eodNull: true });
  want("either read unanswerable (null) drops nothing", blind.has(U("/stock/AAPL")) && blind.has(U("/stock/MSFT")) && blind.has(U("/stock/AAPL/earnings")));
  const R = await import(pathToFileURL(robotsFile ?? path.join(ROOT, ROBOTS)).href);
  want("stockPageIndexable is hasData and not awaiting, for every input",
    [[true, false, true], [true, true, false], [false, false, false], [false, true, false]].every(([d, a, r]) => R.stockPageIndexable({ hasData: d, awaitingSecRead: a }) === r));
  want("earningsPageIndexable is a CIK and not awaiting, for every input",
    [[true, false, true], [true, true, false], [false, false, false], [false, true, false]].every(([c, a, r]) => R.earningsPageIndexable({ hasCik: c, awaitingSecRead: a }) === r));
  return fails;
}

try {
  console.log("\n=== the sitemap follows the pages' robots rule ===\n");
  const f = await rules(path.join(ROOT, SITEMAP), null);
  check("awaiting, no bars, no CIK, dotted, null reads, /news, both predicates", f.length === 0, f.join("; "));

  console.log("\n=== Mutants ===\n");
  const sm = fs.readFileSync(path.join(ROOT, SITEMAP), "utf8");
  const rb = fs.readFileSync(path.join(ROOT, ROBOTS), "utf8");
  const MUTANTS = [
    ["sitemap", "the sitemap ignores stored bars (the old rule)", /const hasData = \(symbol: string\) => eodLast === null \|\| Boolean\(eodLast\[toDashed\(symbol\)\]\);/, "const hasData = (_symbol: string) => true;"],
    ["sitemap", "bars looked up by the dotted spelling", /eodLast\[toDashed\(symbol\)\]/, "eodLast[symbol]"],
    ["sitemap", "a null eod-last drops everything", /eodLast === null \|\| /, ""],
    ["sitemap", "the earnings entries ignore the filed list (#552 COWORK #197)", /filed: filedSet \? hasFiledEarningsIn\(filedSet, symbol\) : null/, "filed: null"],
    ["sitemap", "the earnings entries use the stock page's rule", /!etfSymbols\.has\(symbol\) && earningsRenderable\(symbol\)/, "!etfSymbols.has(symbol) && renderable(symbol)"],
    ["robots", "the stock predicate forgets the SEC read", /return i\.hasData && !i\.awaitingSecRead;/, "return i.hasData;"],
    ["robots", "the earnings predicate forgets the CIK", /return i\.hasCik && !i\.awaitingSecRead/, "return !i.awaitingSecRead"],
  ];
  for (const [which, label, from, to] of MUTANTS) {
    const base = which === "sitemap" ? sm : rb;
    const m = base.replace(from, to);
    if (m === base) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const file = which === "sitemap" ? write(`app/.check-sitemap-${tag}-${tmp.length}.ts`, m) : write(`lib/.check-robots-${tag}-${tmp.length}.ts`, m);
    let fails;
    try { fails = await rules(which === "sitemap" ? file : path.join(ROOT, SITEMAP), which === "robots" ? file : null); } catch (e) { fails = [`threw: ${String(e.message).split("\n")[0]}`]; }
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
