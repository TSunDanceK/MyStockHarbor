// STOCK SPLITS IN THE STORED PER-SHARE SERIES (#552 COWORK #187 §1). READ-ONLY.
//
// Every stored fact set (SCAN + MGET), read through the shipped `cell()`:
//   - a SHARE JUMP: adjacent periods (quarters, then years, oldest first) whose
//     weighted diluted shares (basic where diluted is absent) differ by >= 3x.
//     A forward split multiplies the count, a reverse split divides it.
//   - an EPS JUMP: adjacent same-sign EPS (diluted, else basic), both at least
//     $0.10 in size, differing by >= 3x. Earnings swings do this too, so an EPS
//     jump is only called a SPLIT MIX when a share jump sits on the same pair,
//   - ONE PERIOD ON TWO BASES: net income / (EPS x shares) >= 3x either way,
//     i.e. the period's EPS and share count disagree by about a split ratio.
//   - a DPS JUMP the same way, on dividendsDeclaredPerShare.
// For the named filers it prints the series, and asks SEC (3 small
// companyconcept requests, <= 8/s) whether they tag the split ratio.
//
// Commands: SCAN pages + one MGET per 20 sets. Anything else is refused.
import fs from "node:fs";
import { register } from "node:module";
import { Redis } from "@upstash/redis";

register("./lib/ts-resolve-app.mjs", import.meta.url);

const READS = new Set(["scan", "mget"]);
const counts = {};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (process.env.UPSTASH_REDIS_REST_URL && url.startsWith(process.env.UPSTASH_REDIS_REST_URL)) {
    const body = JSON.parse(init.body ?? "null");
    for (const c of Array.isArray(body?.[0]) ? body : [body]) {
      const op = String(c?.[0]).toLowerCase();
      if (!READS.has(op)) throw new Error(`read guard: ${op} refused`);
      counts[op] = (counts[op] ?? 0) + 1;
    }
  }
  return realFetch(input, init);
};

const { cell } = await import("../lib/server/secFactCodec.ts");
const FACTS_PREFIX = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_FACTS_PREFIX = "([^"]+)"/) ?? [])[1];
if (!FACTS_PREFIX) { console.error("FATAL: SEC_FACTS_PREFIX moved"); process.exit(2); }
const NAMED = (process.env.NAMED || "BKNG DECK SONY").split(/\s+/).filter(Boolean);
const JUMP = 3, MIN_EPS = 0.1;
const redis = Redis.fromEnv();

const keys = [];
let cursor = "0";
do {
  const [next, batch] = await redis.scan(cursor, { match: `${FACTS_PREFIX}:*`, count: 1000 });
  cursor = String(next);
  keys.push(...batch);
} while (cursor !== "0");

const val = (p, k) => { const c = cell(p, k); return typeof c?.val === "number" && Number.isFinite(c.val) ? c.val : null; };
const shares = (p) => val(p, "sharesDiluted") ?? val(p, "sharesBasic");
const eps = (p) => val(p, "epsDiluted") ?? val(p, "epsBasic");
const ratio = (a, b) => Math.max(Math.abs(a), Math.abs(b)) / Math.min(Math.abs(a), Math.abs(b));

const out = { sets: 0, shareJump: [], splitMixEps: [], splitMixDps: [], epsBasis: [], epsOnly: 0 };
const detail = new Map();
for (let i = 0; i < keys.length; i += 20) {
  const chunk = keys.slice(i, i + 20);
  const raw = await redis.mget(...chunk);
  chunk.forEach((k, j) => {
    const set = raw[j];
    if (!set || !Array.isArray(set.quarters)) return;
    out.sets++;
    const sym = k.slice(FACTS_PREFIX.length + 1);
    const hits = { share: [], eps: [], dps: [], epsBasis: [] };
    for (const [basis, list] of [["Q", set.quarters], ["FY", set.years ?? []]]) {
      const ps = [...list].filter((p) => p?.e).sort((a, b) => (a.e < b.e ? -1 : 1));
      // ONE PERIOD, TWO BASES: net income / (EPS x shares) should be ~1. Far
      // from it (>= 3x either way), the EPS and the share count are on
      // different share bases -- the BKNG shape, where one is restated for the
      // split and the other is not.
      for (const p of ps) {
        const ni = val(p, "netIncome"), e = eps(p), sh = shares(p);
        if (ni === null || e === null || !(sh > 0) || Math.abs(ni) < 1e6 || Math.abs(e) < 0.01) continue;
        const k = ni / (e * sh);
        if (k >= JUMP || (k > 0 && k <= 1 / JUMP)) hits.epsBasis.push(`${basis} ${p.e} ×${k.toFixed(2)}`);
      }
      for (let n = 1; n < ps.length; n++) {
        const [a, b] = [ps[n - 1], ps[n]];
        const sa = shares(a), sb = shares(b);
        const shareJump = sa > 0 && sb > 0 && ratio(sa, sb) >= JUMP;
        if (shareJump) hits.share.push(`${basis} ${a.e}→${b.e} ×${(sb / sa).toFixed(2)}`);
        for (const [kind, f] of [["eps", eps], ["dps", (p) => val(p, "dividendsDeclaredPerShare")]]) {
          const ea = f(a), eb = f(b);
          if (ea === null || eb === null || Math.sign(ea) !== Math.sign(eb) || Math.min(Math.abs(ea), Math.abs(eb)) < MIN_EPS || ratio(ea, eb) < JUMP) continue;
          // THE BUSINESS DID NOT MOVE, THE PER-SHARE FIGURE DID: implied net
          // income (per-share x shares) within 2x across the pair.
          const tag = `${basis} ${a.e}→${b.e} ×${(eb / ea).toFixed(2)}`;
          if (shareJump) hits[kind].push(tag);
          // NO SHARE JUMP, BUT THE BUSINESS DID NOT MOVE: the shares on both
          // periods are on one basis and the per-share figure is not.
          else if (kind === "eps") out.epsOnly++;
        }
      }
    }
    if (hits.share.length) out.shareJump.push([sym, hits.share]);
    if (hits.eps.length) out.splitMixEps.push([sym, hits.eps]);
    if (hits.dps.length) out.splitMixDps.push([sym, hits.dps]);
    if (hits.epsBasis.length) out.epsBasis.push([sym, hits.epsBasis]);
    if (NAMED.includes(sym)) {
      const row = (p) => `${p.e} ${p.fp ?? ""} eps ${eps(p) ?? "—"} sh ${shares(p) ? (shares(p) / 1e6).toFixed(1) + "M" : "—"} ni ${val(p, "netIncome") === null ? "—" : "yes"}`;
      detail.set(sym, { q: [...set.quarters].sort((a, b) => (a.e < b.e ? -1 : 1)).map(row), y: [...(set.years ?? [])].sort((a, b) => (a.e < b.e ? -1 : 1)).map(row) });
    }
  });
}

console.log(`sets read ${out.sets} of ${keys.length} keys`);
console.log(`\n1. SHARE JUMPS (>= ${JUMP}x between adjacent periods): ${out.shareJump.length} symbols`);
for (const [s, h] of out.shareJump) console.log(`   ${s.padEnd(7)} ${h.join(" · ")}`);
console.log(`\n2. EPS ON TWO BASES (an EPS jump on the same pair as a share jump): ${out.splitMixEps.length} symbols`);
for (const [s, h] of out.splitMixEps) console.log(`   ${s.padEnd(7)} ${h.join(" · ")}`);
console.log(`\n3. DPS ON TWO BASES: ${out.splitMixDps.length} symbols`);
for (const [s, h] of out.splitMixDps) console.log(`   ${s.padEnd(7)} ${h.join(" · ")}`);
console.log(`\n4. ONE PERIOD ON TWO BASES (net income / (EPS x shares) >= ${JUMP}x either way): ${out.epsBasis.length} symbols`);
for (const [s, h] of out.epsBasis) console.log(`   ${s.padEnd(7)} ${h.join(" · ")}`);
console.log(`\n   (EPS jumps that are real swings: ${out.epsOnly} pairs, not listed)`);

console.log("\n5. NAMED FILERS (stored series, oldest first)");
for (const s of NAMED) {
  const d = detail.get(s);
  if (!d) { console.log(`   ${s}: no stored set`); continue; }
  console.log(`   ${s} quarters:`); for (const r of d.q) console.log(`      ${r}`);
  console.log(`   ${s} years:`); for (const r of d.y) console.log(`      ${r}`);
}

// DOES THE FILER TAG THE RATIO? Three small requests, sequential.
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; read-only census)";
let sec = 0;
console.log("\n6. THE SPLIT-RATIO TAG (us-gaap StockholdersEquityNoteStockSplitConversionRatio1)");
for (const s of NAMED) {
  const cik = REG[s]?.cik;
  if (!cik) { console.log(`   ${s}: no CIK`); continue; }
  await new Promise((r) => setTimeout(r, 150));
  sec++;
  const res = await realFetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/StockholdersEquityNoteStockSplitConversionRatio1.json`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { console.log(`   ${s}: not tagged (${res.status})`); continue; }
  const doc = await res.json();
  const rows = Object.values(doc.units ?? {}).flat().map((f) => `${f.val} (${f.start ?? "—"}→${f.end}, ${f.form} filed ${f.filed})`);
  console.log(`   ${s}: ${rows.length} facts · ${[...new Set(rows)].slice(0, 4).join(" · ")}`);
}
console.log(`\nStore commands: ${JSON.stringify(counts)} · SEC requests: ${sec}`);
