// MIRROR LINKS BETWEEN BOTTLENECK PAGES: A GUARD (#553).
//
// A page lists who supplies the company (`supplyChain`) and who its key
// customers are (`customers`), each up to ten entries. When an entry's ticker
// has a page of its own, that page has the other half of the same relationship:
//   - X lists Y as a SUPPLIER  -> Y's page should list X as a CUSTOMER;
//   - X lists Y as a CUSTOMER  -> Y's page should list X as a SUPPLIER.
// A relationship written on one side only reads as a gap on the other page.
//
// A missing mirror passes only when it is an accepted exception in
// content/bottlenecks/_mirror-exceptions.json ({ source, target, role, reason,
// provisional? }, where role is the role `target` has on `source`'s page).
// It FAILS (exit 1) on an unexplained gap, and on a stale exception (one that no
// longer matches a gap, e.g. because the mirror was added). Provisional
// exceptions are gaps we could not yet close (no sourced weight, or nothing
// removable); their count is printed on every run. It is a RATCHET: the file
// stores `provisionalCount`, and the guard fails if the real count differs from
// it (a rise is refused; a fall must be written down by lowering the number).
//
// Matching is by ticker (GOOG folds into GOOGL, as the leaderboard does); an
// entry with no ticker, or whose ticker has no page, is not checked.
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

const EXC_FILE = path.join(DIR, "_mirror-exceptions.json");
const excDoc = fs.existsSync(EXC_FILE) ? JSON.parse(fs.readFileSync(EXC_FILE, "utf8")) : { provisionalCount: 0, exceptions: [] };
const exceptions = excDoc.exceptions;
const ek = (source, target, role) => `${String(source).toUpperCase()}|${String(target).toUpperCase()}|${role}`;
const excMap = new Map(exceptions.map((e) => [ek(e.source, e.target, e.role), e]));
const gapKeys = new Set(missing.map((m) => ek(m.from, m.to, m.role)));
const unexplained = missing.filter((m) => !excMap.has(ek(m.from, m.to, m.role)));
const stale = exceptions.filter((e) => !gapKeys.has(ek(e.source, e.target, e.role)));
const provisional = exceptions.filter((e) => e.provisional).length;
const ratchet = excDoc.provisionalCount;

const line = (m) => `${m.to} should list ${m.from} as a ${m.mirror === "customers" ? "customer" : "supplier"} (${m.from} lists ${m.to} as a ${m.role}; ${m.to}'s ${m.mirror === "customers" ? "customers" : "suppliers"} list has ${m.count})`;
const sorted = (xs) => [...xs].sort((a, b) => a.to.localeCompare(b.to) || a.from.localeCompare(b.from));
const full = sorted(unexplained.filter((m) => m.full));
const room = sorted(unexplained.filter((m) => !m.full));

let pairs = 0;
for (const [fromKey, from] of pages) for (const list of ["supplyChain", "customers"]) for (const t of from[list]) if (t !== fromKey && pages.has(t)) pairs++;

console.log(`bottleneck mirror links: ${pairs} entries name a company that has its own page; ${missing.length} have no mirror on that page; ${missing.length - unexplained.length} are accepted exceptions (${provisional} provisional, ratchet ${ratchet}); ${unexplained.length} unexplained; ${stale.length} stale exceptions.`);
const BRIEF = process.argv.includes("--brief");
const SHOWN = 5;
const show = (xs) => {
  for (const m of BRIEF ? xs.slice(0, SHOWN) : xs) console.log(`  ${line(m)}`);
  if (BRIEF && xs.length > SHOWN) console.log(`  ... ${xs.length - SHOWN} more`);
};
if (full.length) { console.log(`\nUnexplained, other list is full (${CAP}): ${full.length}`); show(full); }
if (room.length) { console.log(`\nUnexplained, other list has room: ${room.length}`); show(room); }
if (stale.length) {
  console.log(`\nStale exceptions (no matching gap - delete them): ${stale.length}`);
  for (const e of BRIEF ? stale.slice(0, SHOWN) : stale) console.log(`  ${e.source} -> ${e.target} (${e.role})`);
}
if (provisional !== ratchet) {
  console.log(`\nProvisional exceptions: ${provisional}, but the stored ratchet (provisionalCount in _mirror-exceptions.json) is ${ratchet}.`);
  console.log(provisional > ratchet ? "The count may only fall: close the gap instead of adding a provisional exception." : "A gap was closed: lower provisionalCount to the new number.");
}
if (unexplained.length || stale.length || provisional !== ratchet) {
  console.log("\nFix: add the mirror on the target page (and make room), or record an exception in content/bottlenecks/_mirror-exceptions.json.");
  process.exit(1);
}
process.exit(0);
