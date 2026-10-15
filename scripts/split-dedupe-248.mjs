// BEFORE / AFTER FOR #552 COWORK #248 (reads only). Every stored set, sharded.
//   relay task: write-split-dedupe-248   SYMBOLS=SHARD:i/n (or a list)
// BEFORE: main's secSplitAdjust; AFTER: this checkout's. Both on the LIVE stored
// set plus the filer's split facts read fresh from companyfacts (what a re-read
// stores), so the diff is the dedupe change alone. Also counts the sets whose
// contentHash the ssf change moves (those with any split fact).
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; split dedupe before-after)";
const keyOf = (f, n) => (fs.readFileSync(f, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const raw = process.env.SYMBOLS || "SHARD:0/1";
const SHARD = raw.match(/^SHARD:(\d+)\/(\d+)$/);
const NAMED = ["ORLY", "APH", "CVNA", "SRE", "FLG", "AAPL", "MSFT", "AMZN"];

execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
fs.rmSync(".before", { recursive: true, force: true }); fs.mkdirSync(".before");
execSync("git archive FETCH_HEAD lib | tar -x -C .before");
const imp = (rel) => import(pathToFileURL(path.join(process.cwd(), rel)).href);
const SAB = await imp(".before/lib/server/secSplitAdjust.ts");
const SAA = await imp("lib/server/secSplitAdjust.ts");
const CODEC = await imp("lib/server/secFactCodec.ts");
const F = await imp("lib/server/secFields.ts");
const K = F.SEC_FIELD_KEYS;
const EPS = ["epsDiluted", "epsBasic"].map((k) => K.indexOf(k));

const PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const manifest = await redis.get(keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"));
let symbols = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
if (SHARD) { symbols = symbols.filter((_, j) => j % Number(SHARD[2]) === Number(SHARD[1])); if (SHARD[1] === "0") for (const s of NAMED) if (!symbols.includes(s)) symbols.unshift(s); }
else symbols = raw.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
console.log(`reading ${symbols.length}${SHARD ? ` (shard ${SHARD[1]}/${SHARD[2]})` : ""}\n`);

let lastAt = 0;
const gated = async (url) => {
  for (let a = 0; a < 3; a++) {
    const wait = Math.max(0, lastAt + 120 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    try { const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(30000) }); if (res.ok) return res; } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return null;
};
const fmt = (v) => (v == null ? "—" : Number(Number(v).toFixed(4)).toString());
const printed = (SA, set) => { const out = new Map(); const page = SA.splitAdjusted(set);
  for (const [k, list] of [["q", page.quarters], ["y", page.years]]) for (const p of list) EPS.forEach((x, n) => out.set(`${k}${p.e} ${n ? "bas" : "dil"}`, p.v[x])); return out; };
const tot = { read: 0, failed: 0, noSet: 0, moved: new Map(), hashMoves: 0 };
let cmds = 1;
for (let i = 0; i < symbols.length; i += 50) {
  const batch = symbols.slice(i, i + 50);
  const sets = await redis.mget(...batch.map((s) => `${PREFIX}:${s}`)); cmds++;
  for (let j = 0; j < batch.length; j++) {
    const sym = batch[j], stored = sets[j];
    if (!stored?.quarters) { tot.noSet++; continue; }
    const res = await gated(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(manifest.symbols[sym].cik).padStart(10, "0")}.json`);
    if (!res) { tot.failed++; continue; }
    const facts = await res.json(); tot.read++;
    const m = new Map();
    for (const r of Object.values(facts.facts?.["us-gaap"]?.StockholdersEquityNoteStockSplitConversionRatio1?.units ?? {}).flat()) { const d = r.end ?? r.start; if (d && typeof r.val === "number" && r.val > 0) m.set(`${d}|${r.val}`, [d, r.val]); }
    const ssf = [...m.values()].sort((a, b) => a[0].localeCompare(b[0]));
    const set = { ...stored, ...(ssf.length ? { ssf } : {}) };
    if (ssf.length) { const { contentHash, ...rest } = set; const { contentHash: c0, ssf: _x, ...rest0 } = set; if (CODEC.contentHashOf(rest) !== CODEC.contentHashOf(rest0)) tot.hashMoves++; }
    const b = printed(SAB, set), a = printed(SAA, set);
    const diffs = [];
    for (const [key, x] of b) { const y = a.get(key); if (x === y || (x != null && y != null && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x)))) continue; diffs.push(`${key} ${fmt(x)}->${fmt(y)}`); }
    if (diffs.length) tot.moved.set(sym, diffs.length);
    if (NAMED.includes(sym) || diffs.length) console.log(`${diffs.length ? "MOVED" : "NAMED"} ${sym} · ${diffs.length} EPS cells${diffs.length ? ": " + diffs.slice(0, 12).join("; ") + (diffs.length > 12 ? " …" : "") : ""}`);
  }
}
console.log(`\n== summary · read ${tot.read} · failed ${tot.failed} · no set ${tot.noSet}`);
console.log(`MOVED ${tot.moved.size} sets, ${[...tot.moved.values()].reduce((a, b) => a + b, 0)} EPS cells: ${[...tot.moved].map(([s, n]) => `${s} ${n}`).join(", ")}`);
console.log(`HASH moves (gains ssf) ${tot.hashMoves}`);
fs.rmSync(".before", { recursive: true, force: true });
console.log(`Redis commands: ${cmds}`);
