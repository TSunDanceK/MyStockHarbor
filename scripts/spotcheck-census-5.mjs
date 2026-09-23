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
// THE FALLBACK THROUGH THE EXTRACTOR, not by raw row matching: a stored quarter
// is often DERIVED (YTD differencing), its start is the prior period's end, and
// no companyfacts row carries that span. So the same payload is extracted a
// second time with revenue's chain set to the fallback tags only, and a flagged
// period takes revenue from the SAME period (end + fiscal label) of that pass.
const fieldsSrc = fs.readFileSync("lib/server/secFields.ts", "utf8");
const FB_CHAIN = `{ key: "revenue", chain: ["Revenues", "RevenuesNetOfInterestExpense"], unit: "USD" }`;
const fbFields = fieldsSrc.replace(/\{ key: "revenue", chain: \[[^\]]*\], unit: "USD" \}/, FB_CHAIN);
if (fbFields === fieldsSrc) { console.error("FATAL: revenue chain not found in secFields.ts"); process.exit(2); }
const XF = await lift([fbFields, strip("lib/server/secExtract.ts"),
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
console.log(`${"=".repeat(78)}\n#6-B TARGETED FALLBACK THROUGH THE EXTRACTOR`);
const REVENUE_FAMILY = /^(Revenues?|RevenuesNetOfInterestExpense|RevenueFromContractWithCustomer\w*|SalesRevenue\w*|InterestAndDividendIncomeOperating|NoninterestIncome|OperatingLeasesIncomeStatementLeaseRevenue|RealEstateRevenueNet|PremiumsEarnedNet|RevenuesExcludingInterestAndDividends|InterestIncomeExpenseNet|Revenue)$/;
const dayAfter = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const spanMatch = (f, p) => f.end === p.e && (f.start === p.s || f.start === dayAfter(p.s));
const flaggedFilers = [...sets].filter(([, set]) => [...set.quarters, ...set.years].some(incomplete));
let periods = 0, found = 0, resolved = 0, newestRefused = 0, newestUnder = 0, newestOver = 0, newestNone = 0, exceeds = 0;
for (const [s, set] of flaggedFilers) {
  const cik = manifest.symbols[s].cik;
  const cf = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!cf) { console.log(`  ${s}: companyfacts unreadable`); continue; }
  const fb = XF.extractCompanyFacts(s, cf);
  const REV = XF.SEC_FIELD_KEYS.indexOf("revenue");
  const fbOf = (p, list) => list.find((x) => x.end === p.e && x.fp === p.fp)?.values?.[REV]?.val ?? null;
  let fp = 0, ff = 0, fr = 0;
  for (const [p, list] of [...set.quarters.map((p) => [p, fb.quarters]), ...set.years.map((p) => [p, fb.years])]) {
    if (!incomplete(p)) continue;
    fp++; periods++;
    const alt = fbOf(p, list);
    if (alt == null) continue;
    ff++; found++;
    const bar = v(p, "operatingIncome") ?? v(p, "preTaxIncome");
    if (alt >= bar) { fr++; resolved++; }
  }
  let newest = "";
  const q = set.quarters[0];
  if (q && incomplete(q)) {
    newestRefused++;
    const alt = fbOf(q, fb.quarters);
    const ni = v(q, "netIncome");
    const bar = v(q, "operatingIncome") ?? v(q, "preTaxIncome");
    if (alt == null || alt < bar) { newestNone++; newest = ` · NEWEST ${q.fp} ${q.e}: stays refused (${alt == null ? "no fallback" : `fallback ${fmt(alt)} < ${fmt(bar)}`})`; }
    else {
      const nm = ni != null && alt > 0 ? ni / alt : null;
      if (nm != null && nm < 1) newestUnder++; else newestOver++;
      // THE 10-Q'S OWN LINES for that span: the rescued figure must not exceed them.
      const subs = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
      const r = subs?.filings?.recent;
      let k = -1;
      if (r) for (let j = 0; j < r.form.length; j++) if (["10-Q", "10-K"].includes(r.form[j]) && r.reportDate[j] === q.e) { k = j; break; }
      const xml = k >= 0 ? await instanceFor(cik, r.accessionNumber[k]) : null;
      let lines = "filing unreadable", flag = "";
      if (xml) {
        const byName = new Map();
        for (const f of instanceFacts(xml)) if (!f.dims.length && spanMatch(f, q) && REVENUE_FAMILY.test(f.name)) byName.set(f.name, f.val);
        if (byName.size && alt > Math.max(...byName.values()) * 1.0005) { exceeds++; flag = " ⚠ EXCEEDS every revenue line"; }
        lines = `${r.form[k]} ${[...byName].map(([n, x]) => `${n}=${fmt(x)}`).join(" ") || "no revenue-family line for the span"}`;
      }
      newest = ` · NEWEST ${q.fp} ${q.e}: rescued ${fmt(alt)} (chain ${fmt(v(q, "revenue"))}) net margin ${pct(nm)}${flag}\n           ${lines}`;
    }
  }
  console.log(`  ${s.padEnd(6)} flagged ${fp} · fallback ${ff} · resolves ${fr}${newest}`);
}
console.log(`  TOTAL flagged periods ${periods} · fallback ${found} · resolved ${resolved} · outside flagged: 0 by construction`);
console.log(`  NEWEST QUARTER (what a reader sees): refused ${newestRefused} · rescued under 100% ${newestUnder} · rescued >=100% ${newestOver} · stays refused ${newestNone} · rescued above the 10-Q's revenue lines ${exceeds}`);

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
  return q && q.fp !== "Q4" && v(q, "netIncome") !== null && v(q, "epsDiluted") === null && v(q, "epsBasic") === null;
});
const q4 = [...sets].filter(([, set]) => { const q = set.quarters[0]; return q && q.fp === "Q4" && v(q, "netIncome") !== null && v(q, "epsDiluted") === null && v(q, "epsBasic") === null; }).length;
console.log(`  (excluded: ${q4} filers whose newest quarter is a Q4 derived from a 10-K, which reports annual EPS only)`);
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
  const facts = instanceFacts(xml).filter((f) => spanMatch(f, q));
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
