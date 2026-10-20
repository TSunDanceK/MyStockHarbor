// CAN A MULTI-CLASS FILER'S COVER COUNT BE SPLIT BY CLASS FROM THE FILING ITSELF?
//
// claude/multiclass-shares-not-computable-2026-09-21.md measured that
// companyfacts carries no class label. The filing's own XBRL instance does:
// each dei:EntityCommonStockSharesOutstanding fact has a context, and a
// multi-class cover's contexts carry us-gaap:StatementClassOfStockAxis. This
// probe reads, per symbol, (1) companyfacts' newest cover rows and (2) the
// newest 10-Q/10-K instance's cover facts with their class members, so the
// owner can see whether a per-class sum is available. Read-only, no credential.
//
// Usage: node scripts/multiclass-cover-instance-probe.mjs AFRM,RDDT,CRCL

import { readFileSync } from "node:fs";

const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; provider evaluation)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const symbols = (process.argv[2] || process.env.SYMBOLS || "AFRM,RDDT,CRCL")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

const map = JSON.parse(readFileSync("data/sec/company-tickers.json", "utf8"));
const ix = Object.fromEntries(map.fields.map((f, i) => [f, i]));
const rowsByCik = new Map();
for (const r of map.data) {
  const k = r[ix.cik];
  if (!rowsByCik.has(k)) rowsByCik.set(k, []);
  rowsByCik.get(k).push(`${r[ix.ticker]}${r[ix.exchange] ? `(${r[ix.exchange]})` : ""}`);
}

async function get(url, json = true) {
  await sleep(250);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: json ? "application/json" : "*/*" } });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, body: json ? await res.json() : await res.text() };
}

for (const sym of symbols) {
  const row = map.data.find((r) => r[ix.ticker] === sym);
  console.log(`\n=== ${sym} ===`);
  if (!row) { console.log("not in company-tickers.json"); continue; }
  const cikNum = row[ix.cik];
  const cik = String(cikNum).padStart(10, "0");
  console.log(`CIK ${cik}; tickers on this CIK: ${rowsByCik.get(cikNum).join(", ")}`);

  const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  const cover = facts.ok ? facts.body?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? [] : [];
  if (!facts.ok) console.log(`companyfacts ${facts.status}`);
  const newestAccn = [...cover].sort((a, b) => (b.end + b.accn).localeCompare(a.end + a.accn))[0]?.accn;
  const sameAccn = cover.filter((r) => r.accn === newestAccn);
  console.log(`companyfacts cover rows at newest accn ${newestAccn ?? "—"}: ${sameAccn.map((r) => `${r.val} (end ${r.end}, ${r.form})`).join(" | ") || "none"}`);

  const subs = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!subs.ok) { console.log(`submissions ${subs.status}`); continue; }
  const rec = subs.body.filings.recent;
  const i = rec.form.findIndex((f) => f === "10-Q" || f === "10-K");
  if (i < 0) { console.log("no 10-Q/10-K in recent filings"); continue; }
  const accn = rec.accessionNumber[i];
  const dir = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accn.replace(/-/g, "")}`;
  console.log(`newest periodic filing: ${rec.form[i]} ${accn} filed ${rec.filingDate[i]}`);

  const idx = await get(`${dir}/index.json`);
  if (!idx.ok) { console.log(`filing index ${idx.status}`); continue; }
  const inst = idx.body.directory.item.map((x) => x.name).find((n) => /_htm\.xml$/.test(n))
    ?? idx.body.directory.item.map((x) => x.name).find((n) => /\.xml$/.test(n) && !/^(FilingSummary|MetaLinks)/.test(n));
  if (!inst) { console.log("no XBRL instance in filing index"); continue; }
  const doc = await get(`${dir}/${inst}`, false);
  if (!doc.ok) { console.log(`instance ${doc.status}`); continue; }
  const xml = doc.body;

  const facts2 = [...xml.matchAll(/<dei:EntityCommonStockSharesOutstanding\b([^>]*)>([^<]*)</g)];
  if (!facts2.length) { console.log(`instance ${inst}: no cover share facts`); continue; }
  let sum = 0;
  for (const m of facts2) {
    const ctx = /contextRef="([^"]+)"/.exec(m[1])?.[1];
    const ctxXml = new RegExp(`<(?:xbrli:)?context id="${ctx}"[\\s\\S]*?</(?:xbrli:)?context>`).exec(xml)?.[0] ?? "";
    const members = [...ctxXml.matchAll(/<xbrldi:explicitMember dimension="([^"]+)">([^<]+)</g)].map((x) => `${x[1]}=${x[2]}`);
    const instant = /<(?:xbrli:)?instant>([^<]+)</.exec(ctxXml)?.[1];
    const v = Number(m[2]);
    sum += v;
    console.log(`  ${v.toLocaleString("en-US")} as of ${instant}  [${members.join("; ") || "no dimension"}]`);
  }
  console.log(`  sum of classes: ${sum.toLocaleString("en-US")}`);
  const sec12b = [...xml.matchAll(/<dei:TradingSymbol\b([^>]*)>([^<]*)</g)].map((m) => m[2]);
  console.log(`  dei:TradingSymbol in this filing: ${sec12b.join(", ") || "none"}`);
}

// ── EVIDENCE: the newest 10-K's own sentences on class rights, verbatim ──────
// For a share-classes.json entry (weights need the filer's words). Prints each
// sentence naming a Class and conversion / dividend / liquidation / equal rights.
if (process.env.EVIDENCE !== "0") {
  for (const sym of symbols) {
    const row = map.data.find((r) => r[ix.ticker] === sym);
    if (!row) continue;
    const cikNum = row[ix.cik];
    const subs = await get(`https://data.sec.gov/submissions/CIK${String(cikNum).padStart(10, "0")}.json`);
    if (!subs.ok) continue;
    const rec = subs.body.filings.recent;
    const i = rec.form.findIndex((f) => f === "10-K");
    console.log(`\n=== ${sym} evidence: ${i < 0 ? "no 10-K" : `10-K ${rec.accessionNumber[i]} (${rec.primaryDocument[i]})`} ===`);
    if (i < 0) continue;
    const url = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${rec.accessionNumber[i].replace(/-/g, "")}/${rec.primaryDocument[i]}`;
    const doc = await get(url, false);
    if (!doc.ok) { console.log(`primary doc ${doc.status}`); continue; }
    const text = doc.body.replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&#160;|&nbsp;/g, " ").replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
      .replace(/&amp;/g, "&").replace(/&#\d+;/g, " ").replace(/\s+/g, " ");
    const seen = new Set();
    const sentences = text.split(/(?<=[.;])\s+(?=[A-Z(])/);
    let n = 0;
    for (const s of sentences) {
      if (!/\bClass [A-C]\b/.test(s) || !/(convert|dividend|liquidat|identical|equal|rank equally|same rights)/i.test(s)) continue;
      if (s.length > 600 || seen.has(s)) continue;
      seen.add(s);
      console.log(`- ${s.trim()}`);
      if (++n >= 30) break;
    }
  }
}
