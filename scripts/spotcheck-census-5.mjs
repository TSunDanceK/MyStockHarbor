// #535 COWORK #11 — the three follow-ups to CODE #13/#16. Read-only.
//
//   #6-B  PAGE-VISIBLE RESCUE: filers whose NEWEST quarter is refused by the
//         #540 rule (the refusal a reader sees). With the targeted fallback
//         (`Revenues`, then `RevenuesNetOfInterestExpense`, same span, only in
//         a flagged period), how many come back with net margin < 100%, and
//         does any rescued revenue exceed the filer's own revenue lines in the
//         10-Q it came from (every non-dimensional revenue-family concept in
//         that filing's instance, same span)?
//   #2    The stored newest-quarter label for CRWD, AAP, CRM, PFGC, NTAP, ORCL,
//         UHAL (the company's own naming is compared in the report).
//   EPS   Filers whose newest quarter has net income and no EPS: does their
//         newest 10-Q/10-K instance carry EPS dimensioned by share class, EPS
//         per partnership unit, or neither? The reason text must be true.
// relay task: write-spotcheck-census-5
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; spot-check census 5)";
const strip = (f) => fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const X = await lift([fs.readFileSync("lib/server/secFields.ts", "utf8"), strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts")].join("\n"));
const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (n) => (manifestSrc.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const manifest = await redis.get(pick("SEC_MANIFEST_KEY"));
const FACTS = pick("SEC_FACTS_PREFIX");
const all = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
const sets = new Map();
for (let i = 0; i < all.length; i += 50) {
  const b = all.slice(i, i + 50);
  const ss = await Promise.all(b.map((s) => redis.get(`${FACTS}:${s}`)));
  b.forEach((s, k) => { if (ss[k]?.quarters) sets.set(s, ss[k]); });
}
let lastAt = 0;
const get = async (url, as = "json") => {
  const w = Math.max(0, lastAt + 130 - Date.now());
  if (w) await new Promise((r) => setTimeout(r, w));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return null;
  return as === "json" ? res.json() : res.text();
};
const v = (p, k) => X.valueOf(p, k);
const incomplete = (p) => {
  const rev = v(p, "revenue"); if (rev === null || rev <= 0) return false;
  const op = v(p, "operatingIncome"); if (op !== null) return op > rev;
  const pre = v(p, "preTaxIncome"); return pre !== null && pre > rev;
};
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const fmt = (x) => (x == null ? "—" : `${(x / 1e6).toFixed(1)}M`);

// Non-dimensional facts of an instance, by local concept name, for one span.
function instanceFacts(xml) {
  const ctx = new Map();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const body = m[2];
    const dims = [...body.matchAll(/dimension="([^"]+)"[^>]*>\s*([^<\s]+)/g)].map((d) => `${d[1]}=${d[2]}`);
    const start = body.match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/)?.[1];
    const end = body.match(/<(?:[\w-]+:)?endDate>\s*([\d-]+)/)?.[1] ?? body.match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1];
    ctx.set(m[1], { start, end, dims });
  }
  const out = [];
  for (const m of xml.matchAll(/<([\w-]+):(\w+)\b([^>]*?\bcontextRef="([^"]+)"[^>]*)>([^<]*)<\/\1:\2>/g)) {
    const c = ctx.get(m[4]);
    const val = Number(m[5].trim());
    if (!c || !Number.isFinite(val)) continue;
    out.push({ prefix: m[1], name: m[2], val, ...c });
  }
  return out;
}
const instanceFor = async (cik, accn) => {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}`;
  const idx = await get(`${base}/index.json`);
  const inst = (idx?.directory?.item ?? []).map((x) => x.name).find((n) => /_htm\.xml$/i.test(n));
  return inst ? get(`${base}/${inst}`, "text") : null;
};

// ── #6-B ────────────────────────────────────────────────────────────────────
console.log(`${"=".repeat(78)}\n#6-B PAGE-VISIBLE RESCUE (newest quarter refused)`);
const FALLBACK = ["Revenues", "RevenuesNetOfInterestExpense"];
const REVENUE_FAMILY = /^(Revenues?|RevenuesNetOfInterestExpense|RevenueFromContractWithCustomer\w*|SalesRevenue\w*|InterestAndDividendIncomeOperating|NoninterestIncome|OperatingLeasesIncomeStatementLeaseRevenue|RealEstateRevenueNet|PremiumsEarnedNet|RevenuesExcludingInterestAndDividends|InterestIncomeExpenseNet|Revenue)$/;
const refusedNow = [...sets].filter(([, set]) => set.quarters[0] && incomplete(set.quarters[0]));
console.log(`  filers whose newest quarter is refused: ${refusedNow.length}`);
let under = 0, over = 0, noFallback = 0, stillRefused = 0, exceeds = 0;
for (const [s, set] of refusedNow) {
  const p = set.quarters[0];
  const cik = manifest.symbols[s].cik;
  const cf = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  let row = null, tag = null;
  for (const t of FALLBACK) {
    const rows = cf?.facts?.["us-gaap"]?.[t]?.units?.USD ?? [];
    row = rows.filter((x) => x.end === p.e && x.start === p.s).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0] ?? null;
    if (row) { tag = t; break; }
  }
  const ni = v(p, "netIncome"), op = v(p, "operatingIncome"), pre = v(p, "preTaxIncome");
  if (!row) { noFallback++; console.log(`  ${s.padEnd(6)} ${p.s}..${p.e} no fallback row — refusal stays`); continue; }
  const bar = op ?? pre;
  if (row.val < bar) { stillRefused++; console.log(`  ${s.padEnd(6)} ${tag} ${fmt(row.val)} < op/pre ${fmt(bar)} — refusal stays`); continue; }
  const nm = ni != null && row.val > 0 ? ni / row.val : null;
  if (nm != null && nm < 1) under++; else over++;
  // The 10-Q the rescued row came from: every revenue-family line, same span, no dimensions.
  const xml = row.accn ? await instanceFor(cik, row.accn) : null;
  let lines = "instance unreadable", flag = "";
  if (xml) {
    const same = instanceFacts(xml).filter((f) => !f.dims.length && f.start === p.s && f.end === p.e && REVENUE_FAMILY.test(f.name));
    const byName = new Map();
    for (const f of same) byName.set(f.name, f.val);
    const maxLine = Math.max(...byName.values());
    if (byName.size && row.val > maxLine) { exceeds++; flag = " ⚠ EXCEEDS every revenue line"; }
    lines = [...byName].map(([n, x]) => `${n}=${fmt(x)}`).join(" ") || "no revenue-family line";
  }
  console.log(`  ${s.padEnd(6)} ${row.form} ${row.accn} ${tag} ${fmt(row.val)} (chain ${fmt(v(p, "revenue"))}) · net margin ${pct(nm)}${flag}\n         10-Q lines: ${lines}`);
}
console.log(`  TOTAL ${refusedNow.length}: rescued under 100% ${under} · rescued but >=100% ${over} · fallback below op/pre ${stillRefused} · no fallback ${noFallback} · rescued above every 10-Q revenue line ${exceeds}`);

// ── #2 ──────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\n#2 STORED NEWEST-QUARTER LABELS`);
for (const s of ["CRWD", "AAP", "CRM", "PFGC", "NTAP", "ORCL", "UHAL"]) {
  const set = sets.get(s);
  const q = set?.quarters?.[0], y = set?.years?.[0];
  console.log(`  ${s.padEnd(5)} newest quarter ${q ? `${q.fp} FY${q.fy} (${q.s}..${q.e})` : "—"} · newest year ${y ? `FY${y.fy} ending ${y.e}` : "—"}`);
}

// ── EPS ─────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\nEPS: newest quarter has net income and no EPS`);
const noEps = [...sets].filter(([, set]) => {
  const q = set.quarters[0];
  return q && v(q, "netIncome") !== null && v(q, "epsDiluted") === null && v(q, "epsBasic") === null;
});
console.log(`  filers: ${noEps.length} — ${noEps.map(([s]) => s).join(",")}`);
const verdicts = {};
for (const [s, set] of noEps) {
  const q = set.quarters[0];
  const cik = manifest.symbols[s].cik;
  const subs = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = subs?.filings?.recent;
  let i = -1;
  if (r) for (let k = 0; k < r.form.length; k++) if (["10-Q", "10-K", "20-F", "40-F"].includes(r.form[k]) && r.reportDate[k] === q.e) { i = k; break; }
  if (i < 0) { verdicts[s] = "no filing for the period"; console.log(`  ${s.padEnd(6)} no 10-Q/10-K with reportDate ${q.e}`); continue; }
  const xml = await instanceFor(cik, r.accessionNumber[i]);
  if (!xml) { verdicts[s] = "no instance"; console.log(`  ${s.padEnd(6)} ${r.form[i]} ${r.accessionNumber[i]} no instance`); continue; }
  const facts = instanceFacts(xml).filter((f) => f.end === q.e && f.start === q.s);
  const eps = facts.filter((f) => /^(EarningsPerShare\w*|IncomeLossFromContinuingOperationsPerBasicShare|IncomeLossFromContinuingOperationsPerDilutedShare)$/.test(f.name));
  const classEps = eps.filter((f) => f.dims.some((d) => /ClassOfStockAxis|StatementClassOfStockAxis/.test(d)));
  const plainEps = eps.filter((f) => !f.dims.length);
  const unit = facts.filter((f) => /PerOutstandingLimitedPartnershipUnit|PerLimitedPartnershipUnit|PerUnit|NetIncomeLossPerOutstandingLimitedPartnershipAndGeneralPartnershipUnit/.test(f.name));
  const ext = facts.filter((f) => !/^(us-gaap|ifrs-full|dei|srt)$/.test(f.prefix) && /PerShare|PerUnit|EarningsPer/i.test(f.name));
  const verdict = plainEps.length ? "PLAIN EPS in filing (chain miss)"
    : classEps.length ? "class-dimensioned EPS"
    : unit.length ? "per-unit figures"
    : ext.length ? "extension per-share concept only"
    : "no per-share figure";
  verdicts[s] = verdict;
  const ex = (a) => a.slice(0, 3).map((f) => `${f.prefix}:${f.name}${f.dims.length ? `[${f.dims.join(";").slice(0, 80)}]` : ""}=${f.val}`).join(" | ");
  console.log(`  ${s.padEnd(6)} ${r.form[i]} ${q.fp} ${q.e}: ${verdict}\n         ${ex(plainEps.length ? plainEps : classEps.length ? classEps : unit.length ? unit : ext)}`);
}
const tally = {};
for (const x of Object.values(verdicts)) tally[x] = (tally[x] ?? 0) + 1;
console.log(`  TALLY ${JSON.stringify(tally)}`);
