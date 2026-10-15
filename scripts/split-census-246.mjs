// CENSUS FOR #552 COWORK #246: every stored set whose filer states a
// whole-ratio split (StockholdersEquityNoteStockSplitConversionRatio1) that
// main's secSplitAdjust does not recognise. Reads only.
//   relay task: write-split-census-246   SYMBOLS=SHARD:i/n (all manifest sets)
// Per filer with a whole-ratio split fact: main's factors on the LIVE stored set
// vs this checkout's factors on the same set plus its filed split facts; every
// stored EPS cell whose factor differs is a cell this PR's split proof fixes.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const ROOT = process.cwd();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; split census)";
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SHARD = (process.env.SYMBOLS || "").match(/^SHARD:(\d+)\/(\d+)$/);

execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
fs.rmSync(".before", { recursive: true, force: true }); fs.mkdirSync(".before");
execSync("git archive FETCH_HEAD lib | tar -x -C .before");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const SAB = await imp(".before/lib/server/secSplitAdjust.ts");
const SAA = await imp("lib/server/secSplitAdjust.ts");
const cur = fs.readFileSync("lib/server/secCurrency.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const ex = fs.readFileSync("lib/server/secExtract.ts", "utf8").replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "").replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secCurrency";/, "");
const XA = await lift(`${fs.readFileSync("lib/server/secFields.ts", "utf8")}\n${fs.readFileSync("lib/server/fxRates.ts", "utf8")}\n${cur}\n${ex}`);
const K = XA.SEC_FIELD_KEYS;
const EPS = ["epsDiluted", "epsBasic"].map((k) => K.indexOf(k));

const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
let cmds = 1;
let symbols = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
if (SHARD) symbols = symbols.filter((_, j) => j % Number(SHARD[2]) === Number(SHARD[1]));
console.log(`reading ${symbols.length}${SHARD ? ` (shard ${SHARD[1]}/${SHARD[2]})` : ""}\n`);

let lastAt = 0;
const gated = async (url) => {
  for (let a = 0; a < 3; a++) {
    const wait = Math.max(0, lastAt + 120 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    try { const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(30000) }); if (res.ok || res.status === 404) return res; } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return new Response("{}", { status: 599 });
};
const whole = (r) => { const k = r >= 1 ? r : 1 / r; return k >= 1.9 && Math.abs(k - Math.round(k)) <= 0.02 * k ? Math.round(k) : null; };
const out = { fixed: [], mainKnows: [], unproven: [], none: 0, failed: 0, noSet: 0 };
let cells = 0;
for (let i = 0; i < symbols.length; i += 50) {
  const batch = symbols.slice(i, i + 50);
  const sets = await redis.mget(...batch.map((s) => `${PREFIX}:${s}`)); cmds++;
  for (let j = 0; j < batch.length; j++) {
    const sym = batch[j], set = sets[j];
    if (!set?.quarters) { out.noSet++; continue; }
    const res = await gated(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(manifest.symbols[sym].cik).padStart(10, "0")}.json`);
    if (!res.ok) { out.failed++; continue; }
    let r;
    try { r = XA.extractCompanyFacts(sym, await res.json()); } catch (e) { out.failed++; console.log(`ERROR ${sym} ${e.message}`); continue; }
    const stated = (r.splitFacts ?? []).filter(([, x]) => whole(x));
    if (!stated.length) { out.none++; continue; }
    const fb = SAB.splitFactors(set), fa = SAA.splitFactors({ ...set, ssf: r.splitFacts });
    let n = 0; const moved = [];
    for (const [kind, list] of [["q", set.quarters], ["y", set.years]]) for (const p of list) {
      if ((fb.get(p.e) ?? 1) === (fa.get(p.e) ?? 1)) continue;
      const c = EPS.filter((x) => p.v[x] != null).length; n += c; if (c) moved.push(`${kind}${p.e}`);
    }
    const tag = `${sym} ${stated.map(([d, x]) => `${d}:${whole(x)}${x < 1 ? "fwd" : "rev"}`).join(",")}`;
    if (n) { out.fixed.push(sym); cells += n; console.log(`FIXED ${tag} · ${n} EPS cells · ${moved.slice(0, 6).join(" ")}${moved.length > 6 ? " …" : ""}`); }
    else if (fb.size) { out.mainKnows.push(sym); console.log(`MAIN-KNOWS ${tag} · main factors ${fb.size}`); }
    else { out.unproven.push(sym); console.log(`UNPROVEN ${tag} · no share-count step (or nothing pre-split stored)`); }
  }
}
console.log(`\n== summary · ${symbols.length} sets · no set ${out.noSet} · failed ${out.failed} · no whole split fact ${out.none}`);
console.log(`FIXED ${out.fixed.length} (${cells} EPS cells): ${out.fixed.join(" ")}`);
console.log(`MAIN-KNOWS ${out.mainKnows.length}: ${out.mainKnows.join(" ")}`);
console.log(`UNPROVEN ${out.unproven.length}: ${out.unproven.join(" ")}`);
fs.rmSync(".before", { recursive: true, force: true });
console.log(`Redis commands: ${cmds}`);
