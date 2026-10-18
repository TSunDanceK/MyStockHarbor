// MIRROR LINKS BETWEEN BOTTLENECK PAGES: A REPORT, NOT A CHECK (#553).
//
// A page lists who supplies the company (`supplyChain`) and who its key
// customers are (`customers`), each up to ten entries. When an entry's ticker
// has a page of its own, that page has the other half of the same relationship:
//   - X lists Y as a SUPPLIER  -> Y's page should list X as a CUSTOMER;
//   - X lists Y as a CUSTOMER  -> Y's page should list X as a SUPPLIER.
// A relationship written on one side only reads as a gap on the other page.
// This lists the missing mirrors, split by whether the list that would take the
// entry is full (10, so an entry would have to give way) or has room.
//
// It NEVER FAILS: check-all runs it as a report (REPORT_ONLY in check-all.mjs)
// and it always exits 0. Matching is by ticker (GOOG folds into GOOGL, as the
// leaderboard does); an entry with no ticker, or whose ticker has no page, is
// not checked.
//
//   node scripts/check-bottleneck-links.mjs            the full list
//   node scripts/check-bottleneck-links.mjs --brief    the counts and the first few of each (what check-all prints)
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const DIR = path.join(process.cwd(), "content/bottlenecks");
const CAP = 10;
const FOLD = { GOOG: "GOOGL" }; // the same share-class fold as lib/bottleneckHub.ts TICKER_ALIASES
const key = (t) => { const u = String(t ?? "").trim().toUpperCase(); return FOLD[u] ?? u; };

const pages = new Map(); // ticker key -> { slug, symbol, supplyChain: Set, customers: Set, nSupply, nCust }
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".md"))) {
  const { data } = matter(fs.readFileSync(path.join(DIR, file), "utf8"));
  if (!data.symbol) continue;
  const tickers = (rows) => (Array.isArray(rows) ? rows : []).map((r) => key(r?.ticker)).filter(Boolean);
  const supply = Array.isArray(data.supplyChain) ? data.supplyChain : [];
  const cust = Array.isArray(data.customers) ? data.customers : [];
  pages.set(key(data.symbol), {
    slug: file.replace(/\.md$/, ""),
    symbol: String(data.symbol).toUpperCase(),
    supplyChain: new Set(tickers(supply)),
    customers: new Set(tickers(cust)),
    nSupply: supply.length,
    nCust: cust.length,
  });
}

const missing = []; // { from, to, list, targetList, full }
for (const [fromKey, from] of pages) {
  for (const [list, mirror] of [["supplyChain", "customers"], ["customers", "supplyChain"]]) {
    for (const t of from[list]) {
      if (t === fromKey) continue;
      const to = pages.get(t);
      if (!to) continue; // no page of its own
      if (to[mirror].has(fromKey)) continue;
      const count = mirror === "customers" ? to.nCust : to.nSupply;
      missing.push({ from: from.symbol, to: to.symbol, role: list === "supplyChain" ? "supplier" : "customer", mirror, count, full: count >= CAP });
    }
  }
}

const line = (m) => `${m.to} should list ${m.from} as a ${m.mirror === "customers" ? "customer" : "supplier"} (${m.from} lists ${m.to} as a ${m.role}; ${m.to}'s ${m.mirror === "customers" ? "customers" : "suppliers"} list has ${m.count})`;
const sorted = (xs) => [...xs].sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from));
const full = sorted(missing.filter((m) => m.full));
const room = sorted(missing.filter((m) => !m.full));

let pairs = 0;
for (const [fromKey, from] of pages) for (const list of ["supplyChain", "customers"]) for (const t of from[list]) if (t !== fromKey && pages.has(t)) pairs++;

console.log(`bottleneck mirror links: ${pairs} entries name a company that has its own page; ${missing.length} have no mirror on that page (${full.length} where the other list is full, ${room.length} where it has room). Report only.`);
const BRIEF = process.argv.includes("--brief");
const SHOWN = 5;
const show = (xs) => {
  for (const m of BRIEF ? xs.slice(0, SHOWN) : xs) console.log(`  ${line(m)}`);
  if (BRIEF && xs.length > SHOWN) console.log(`  ... ${xs.length - SHOWN} more`);
};
console.log(`\nOther list is full (${CAP}): ${full.length}`);
show(full);
console.log(`\nOther list has room: ${room.length}`);
show(room);
process.exit(0);
