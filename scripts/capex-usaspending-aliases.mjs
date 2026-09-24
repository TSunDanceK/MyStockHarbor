// Federal contracts: what USAspending actually calls the top recipients, and
// who their parents are (Relay C, #563 COWORK #1 D5). READ-ONLY; builds the
// evidence the committed alias list (data/capex/contract-aliases.json) is
// written from -- each alias carries this run's basis, not a guess.
//
//   relay task: write-capex-contract-aliases (0 Redis; USAspending only, plus
//   SEC submissions for formerNames of the universe names it cannot match)
//   SYMBOLS="pages=10 detail=250 concurrency=3"
import fs from "node:fs";

const opt = Object.fromEntries((process.env.SYMBOLS || "").split(/\s+/).filter(Boolean).map((a) => a.split("=")));
const PAGES = Number(opt.pages ?? 10);
const DETAIL = Number(opt.detail ?? 250);
const CONC = Number(opt.concurrency ?? 3);
const API = "https://api.usaspending.gov/api/v2";
const UA = "MyStockHarbor/1.0 (+https://www.mystockharbor.com; contact sonnybrindle@mystockharbor.com)";

// The last 12 full calendar months.
const now = new Date();
const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
const iso = (d) => d.toISOString().slice(0, 10);
const filters = { time_period: [{ start_date: iso(start), end_date: iso(end) }], award_type_codes: ["A", "B", "C", "D"] };

async function post(path, body) {
  for (let a = 0; a < 4; a++) {
    const t = Date.now();
    try {
      const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
      if (r.ok) return { data: await r.json(), ms: Date.now() - t };
      if (r.status < 500 && r.status !== 429) return { data: null, ms: Date.now() - t, status: r.status };
    } catch {}
    await new Promise((res) => setTimeout(res, 2000 * 2 ** a));
  }
  return { data: null, ms: 0 };
}
async function getJson(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise((res) => setTimeout(res, 1500 * 2 ** a));
  }
  return null;
}

// Universe names (registrants.json CIKs) -> ticker, from company-tickers.
const SUFFIX = /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|LLC|L ?P|PLC|N ?V|S ?A|AG|SE|HOLDINGS?|GROUP|THE|CLASS [A-C]|NEW|DE|ADR|SA DE CV)\b/g;
const norm = (s) => ` ${String(s).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ")} `.replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
const reg = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const universeCik = new Map(Object.entries(reg).map(([sym, r]) => [Number(r.cik), sym]));
const tick = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const fi = tick.fields;
const nameToTicker = new Map();
for (const row of tick.data) {
  const cik = Number(row[fi.indexOf("cik")]);
  const sym = universeCik.get(cik);
  if (!sym) continue;
  const n = norm(row[fi.indexOf("name")]);
  if (n.length >= 3 && !nameToTicker.has(n)) nameToTicker.set(n, { ticker: sym, cik, secName: row[fi.indexOf("name")] });
}

console.log(`window ${iso(start)}..${iso(end)}; pages ${PAGES} x 100, concurrency ${CONC}; universe names ${nameToTicker.size}`);
const t0 = Date.now();
const pages = [];
for (let p = 1; p <= PAGES; p += CONC) {
  const batch = await Promise.all(Array.from({ length: Math.min(CONC, PAGES - p + 1) }, (_, i) => post("/search/spending_by_category/recipient/", { filters, category: "recipient", limit: 100, page: p + i })));
  batch.forEach((b, i) => { console.log(`  page ${p + i}: ${b.data ? b.data.results.length + " rows" : "FAILED " + (b.status ?? "")} ${b.ms} ms`); pages[p + i - 1] = b.data?.results ?? []; });
}
const rec = pages.flat();
console.log(`recipients ${rec.length} in ${((Date.now() - t0) / 1000).toFixed(0)} s; first row keys: ${Object.keys(rec[0] ?? {}).join(",")}`);

const out = [];
let detailCalls = 0;
for (let k = 0; k < rec.length; k++) {
  const r = rec[k];
  const byName = nameToTicker.get(norm(r.name ?? ""));
  let parent = null, parentUei = null, byParent = null;
  if (!byName && k < DETAIL && r.recipient_id) {
    detailCalls++;
    const d = await getJson(`${API}/recipient/${encodeURIComponent(r.recipient_id)}/`);
    parent = d?.parent_name ?? null;
    parentUei = d?.parent_uei ?? null;
    byParent = parent ? nameToTicker.get(norm(parent)) ?? null : null;
  }
  out.push({ rank: k + 1, name: r.name, code: r.code ?? r.uei ?? null, id: r.recipient_id, amount: r.amount, byName: byName?.ticker ?? null, parent, parentUei, byParent: byParent?.ticker ?? null });
}
const total = rec.reduce((a, r) => a + (r.amount ?? 0), 0);
const mapped = out.filter((o) => o.byName || o.byParent);
console.log(`detail calls ${detailCalls}; mapped ${mapped.length} (name ${out.filter((o) => o.byName).length}, parent ${out.filter((o) => !o.byName && o.byParent).length}); mapped $${(mapped.reduce((a, o) => a + o.amount, 0) / 1e9).toFixed(1)}bn of $${(total / 1e9).toFixed(1)}bn in these ${rec.length}`);
console.log(`\nMAPPED (rank | name | parent | ticker | how | $m):`);
for (const o of mapped) console.log(`  ${o.rank} | ${o.name} | ${o.parent ?? ""} | ${o.byName ?? o.byParent} | ${o.byName ? "name" : "parent"} | ${(o.amount / 1e6).toFixed(0)}`);
console.log(`\nUNMAPPED in the top 250 (rank | name | parent | parentUei | $m):`);
for (const o of out.filter((o) => !o.byName && !o.byParent && o.rank <= 250)) console.log(`  ${o.rank} | ${o.name} | ${o.parent ?? ""} | ${o.parentUei ?? ""} | ${(o.amount / 1e6).toFixed(0)}`);
console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(0)} s; Redis 0`);
