// CAN A LAGGING FILER'S NEWEST PERIOD BE READ FROM THE FILING ITSELF?
//
// ── WHY (#535 COWORK #6, option C, MEASURE FIRST) ─────────────────────────
// 92 of 862 filers show an older period than their newest 10-Q/10-K/20-F
// because SEC's companyfacts has not published the filed period (CODE #5).
// The figures exist in the filing's own XBRL instance, which SEC extracts from
// the inline document and publishes in the filing folder (`*_htm.xml`).
//
// THE SAME RULES, BY CONSTRUCTION. The instance's facts are reshaped into
// companyfacts rows (same namespaces, units, start/end/val/accn/fy/fp/form/
// filed) and merged in FILL-ONLY: a (tag, unit, start, end) companyfacts
// already has is never replaced. The merged payload then goes through the
// SHIPPED extractCompanyFacts -> encodeFactSet -> buildSecEarningsView, so the
// chains, preferred-tag logic and YTD -> quarter derivation are the ones the
// site runs, not a second copy.
//
// AND IT PRINTS THE PRESS RELEASE BESIDE IT. The newest Item 2.02 8-K's EX-99
// exhibit is fetched and the sentences naming revenue / net income / per-share
// figures are printed, so the filing-derived numbers can be checked against
// what the company announced.
//
// Read-only: no Redis, no writes. Runs on a runner (the sandbox is refused
// data.sec.gov / www.sec.gov with 403 CONNECT).
//
//   SYMBOLS="KO,DUK,V,F,TSM,ENB,MICC" node scripts/sec-filing-xbrl-probe.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const SYMBOLS = (process.argv[2] || process.env.SYMBOLS || "KO,DUK,V,F,TSM,ENB,MICC")
  .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; filing xbrl probe)";

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"),
  strip("lib/server/secCurrency.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secEarningsView.ts"),
].join("\n"));
const { extractCompanyFacts, encodeFactSet, periodLabel, valueOf } = sec;

const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

let lastAt = 0;
const get = async (url, as = "json") => {
  const wait = Math.max(0, lastAt + 150 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: as === "json" ? await res.json() : await res.text() };
};

// ── THE INSTANCE, AS COMPANYFACTS ROWS ──────────────────────────────────────
// Namespaces are matched by URI, never by prefix: a prefix is the filer's
// choice. Only the four companyfacts publishes are kept; extension concepts are
// not in companyfacts either, so admitting them would be a second rule.
const NS_BY_URI = [
  [/fasb\.org\/us-gaap\//, "us-gaap"],
  [/xbrl\.ifrs\.org\/taxonomy\/.*ifrs-full/, "ifrs-full"],
  [/xbrl\.sec\.gov\/dei\//, "dei"],
  [/fasb\.org\/srt\//, "srt"],
];
const unitKey = (m) => m.replace(/^iso4217:/, "").replace(/^xbrli:/, "");
function instanceToFacts(xml, meta) {
  const prefixNs = new Map();
  for (const m of xml.matchAll(/xmlns:([\w.-]+)="([^"]+)"/g)) {
    const hit = NS_BY_URI.find(([re]) => re.test(m[2]));
    if (hit) prefixNs.set(m[1], hit[1]);
  }
  // CONTEXTS WITHOUT DIMENSIONS ONLY — companyfacts publishes only those, and
  // a segment (a business line, a subsidiary) is not the consolidated figure.
  const ctx = new Map();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const body = m[2];
    if (/<(?:[\w-]+:)?(segment|scenario)\b/.test(body)) continue;
    const start = body.match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/)?.[1];
    const end = body.match(/<(?:[\w-]+:)?endDate>\s*([\d-]+)/)?.[1];
    const instant = body.match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1];
    ctx.set(m[1], instant ? { end: instant } : { start, end });
  }
  const units = new Map();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?unit>/g)) {
    const ms = [...m[2].matchAll(/<(?:[\w-]+:)?measure>\s*([^<\s]+)/g)].map((x) => unitKey(x[1]));
    units.set(m[1], /divide>/.test(m[2]) && ms.length === 2 ? `${ms[0]}/${ms[1]}` : ms[0]);
  }
  const dei = (tag) => xml.match(new RegExp(`<[\\w-]+:${tag}\\b[^>]*>\\s*([^<]+)<`))?.[1]?.trim();
  const fy = Number(dei("DocumentFiscalYearFocus")) || null;
  const fp = dei("DocumentFiscalPeriodFocus") || null;
  const facts = {};
  const seen = new Set();
  let n = 0;
  for (const m of xml.matchAll(/<([\w-]+):(\w+)\b([^>]*?\bcontextRef="([^"]+)"[^>]*)>([^<]*)<\/\1:\2>/g)) {
    const ns = prefixNs.get(m[1]);
    if (!ns) continue;
    const c = ctx.get(m[4]);
    if (!c) continue;
    const u = m[3].match(/\bunitRef="([^"]+)"/)?.[1];
    if (!u) continue;
    const val = Number(m[5].trim());
    if (!Number.isFinite(val)) continue;
    const unit = units.get(u);
    if (!unit) continue;
    const key = `${ns}|${m[2]}|${unit}|${c.start ?? ""}|${c.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = { end: c.end, val, accn: meta.accn, fy, fp, form: meta.form, filed: meta.filed };
    if (c.start) row.start = c.start;
    ((((facts[ns] ??= {})[m[2]] ??= { units: {} }).units[unit] ??= [])).push(row);
    n++;
  }
  return { facts, n, contexts: ctx.size, fy, fp };
}

// FILL-ONLY: companyfacts wins wherever it already has the (tag, unit, span).
function mergeFillOnly(cf, filing) {
  const out = structuredClone(cf);
  out.facts ??= {};
  let added = 0;
  for (const [ns, tags] of Object.entries(filing)) {
    for (const [tag, def] of Object.entries(tags)) {
      for (const [unit, rows] of Object.entries(def.units)) {
        const target = (((out.facts[ns] ??= {})[tag] ??= { units: {} }).units[unit] ??= []);
        const have = new Set(target.map((r) => `${r.start ?? ""}|${r.end}`));
        for (const r of rows) {
          if (have.has(`${r.start ?? ""}|${r.end}`)) continue;
          target.push(r);
          added++;
        }
      }
    }
  }
  return { merged: out, added };
}

const fmt = (v) => (v == null ? "—" : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : String(v));
const describe = (set, label) => {
  const q = set.quarters?.[0];
  const y = set.years?.[0];
  const p = q && (!y || q.e >= y.e) ? q : y;
  if (!p) return `  ${label}: no period`;
  return `  ${label}: newest ${periodLabel(p)} (end ${p.e})  revenue ${fmt(valueOf(p, "revenue"))}` +
    `  net income ${fmt(valueOf(p, "netIncome"))}  EPS diluted ${fmt(valueOf(p, "epsDiluted"))}` +
    `  EPS basic ${fmt(valueOf(p, "epsBasic"))}  currency ${set.cur ?? "USD"}`;
};

const PERIODIC = /^(10-K|10-Q|20-F|40-F)$/;
for (const symbol of SYMBOLS) {
  console.log(`\n${"=".repeat(78)}\n${symbol}`);
  const cik = tickerMap.get(symbol)?.cik;
  if (!cik) { console.log("  no CIK"); continue; }
  const subs = (await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).body;
  const r = subs?.filings?.recent;
  if (!r) { console.log("  no submissions"); continue; }
  let filing = null, pr = null;
  for (let i = 0; i < r.accessionNumber.length; i++) {
    const f = { form: r.form[i], filed: r.filingDate[i], period: r.reportDate[i], accn: r.accessionNumber[i],
      doc: r.primaryDocument[i], items: String(r.items?.[i] ?? "") };
    if (!filing && PERIODIC.test(f.form)) filing = f;
    if (!pr && f.form === "8-K" && f.items.includes("2.02")) pr = f;
    if (filing && pr) break;
  }
  if (!filing) { console.log("  no periodic filing"); continue; }
  console.log(`  newest periodic: ${filing.form} filed ${filing.filed}, period ${filing.period}, accn ${filing.accn}`);

  const cf = (await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`)).body;
  if (!cf) { console.log("  companyfacts unreadable"); continue; }
  const before = encodeFactSet(extractCompanyFacts(symbol, cf));
  console.log(describe(before, "companyfacts only"));

  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accn.replace(/-/g, "")}`;
  const idx = (await get(`${base}/index.json`)).body;
  const names = (idx?.directory?.item ?? []).map((x) => x.name);
  const inst = names.find((n) => /_htm\.xml$/i.test(n)) ??
    names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre)\.xml$/i.test(n));
  if (!inst) { console.log(`  NO INSTANCE in filing folder (${names.length} files)`); continue; }
  const xmlRes = await get(`${base}/${inst}`, "text");
  if (!xmlRes.body) { console.log(`  instance ${inst}: HTTP ${xmlRes.status}`); continue; }
  const parsed = instanceToFacts(xmlRes.body, filing);
  console.log(`  instance ${inst}: ${(xmlRes.body.length / 1e6).toFixed(1)} MB, ${parsed.contexts} plain contexts, ` +
    `${parsed.n} facts in us-gaap/ifrs-full/dei/srt, DEI fy=${parsed.fy} fp=${parsed.fp}`);
  const nsCounts = Object.entries(parsed.facts).map(([ns, t]) => `${ns} ${Object.keys(t).length}`).join(", ");
  console.log(`  concepts by namespace: ${nsCounts}`);

  const { merged, added } = mergeFillOnly(cf, parsed.facts);
  const after = encodeFactSet(extractCompanyFacts(symbol, merged));
  console.log(`  fill-only merge added ${added} rows`);
  console.log(describe(after, "companyfacts + filing"));
  const q0 = after.quarters?.[0];
  if (q0) {
    const filled = sec.SEC_FIELD_KEYS ?? [];
    const got = filled.filter((k) => valueOf(q0, k) !== null).length;
    console.log(`  newest quarter fields resolved: ${got} of ${filled.length || "?"}`);
  }
  // Every field on the newest period, before vs after, where they differ.
  const pick = (set) => {
    const q = set.quarters?.[0]; const y = set.years?.[0];
    return q && (!y || q.e >= y.e) ? q : y;
  };
  const pb = pick(before), pa = pick(after);
  if (pa && pb && pa.e === pb.e) console.log("  (newest period unchanged by the merge)");

  // ── THE PRESS RELEASE, FOR THE COMPARISON ─────────────────────────────────
  if (!pr) { console.log("  no Item 2.02 8-K (expected for a 20-F filer)"); continue; }
  const pbase = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${pr.accn.replace(/-/g, "")}`;
  const pidx = (await get(`${pbase}/index.json`)).body;
  const ex = (pidx?.directory?.item ?? []).map((x) => x.name)
    .find((n) => /ex-?99|ex99|exhibit99|dex99/i.test(n) && /\.html?$/i.test(n));
  console.log(`  press release: 8-K filed ${pr.filed} (accn ${pr.accn}), exhibit ${ex ?? "not found"}`);
  if (!ex) continue;
  const html = (await get(`${pbase}/${ex}`, "text")).body ?? "";
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ");
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hits = sentences.filter((s) =>
    /(net (revenue|sales|income)|revenues?|operating revenue|per (diluted )?share|EPS)/i.test(s) &&
    /\$\s?[\d.,]+|\d+\.\d{2}/.test(s)).slice(0, 6);
  for (const h of hits) console.log(`    PR> ${h.slice(0, 260)}`);
}
