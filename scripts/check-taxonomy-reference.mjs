// data/taxonomy.json is DERIVED. This fails if it has drifted from the snapshot.
//
// A committed reference file that nothing re-derives goes stale silently, and a
// stale taxonomy is worse than none: the SIC table, the news-art map and the
// screener filter would each be keyed on labels the data no longer uses, and
// every one of those failures renders as a missing category rather than an error.
//
// THIS CHECK ONCE PRODUCED ITS OWN EXPECTED VALUE. Importing the generator
// re-ran its top-level write, so it regenerated data/taxonomy.json and then
// compared the file to itself -- passing forever, detecting nothing. The write
// is now behind an entry-point guard, and the fix was verified by corrupting
// the file and watching this go red. See the rule in the header of
// scripts/check-sec-daily-index.mjs.
import fs from "node:fs";
import { buildTaxonomy } from "./build-taxonomy-reference.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("taxonomy reference");
const committed = JSON.parse(fs.readFileSync("data/taxonomy.json", "utf8"));
const fresh = buildTaxonomy(JSON.parse(fs.readFileSync("data/static-profile.json", "utf8")));

check("the committed reference matches the snapshot it is derived from",
  JSON.stringify(committed.sectors) === JSON.stringify(fresh.sectors) &&
    JSON.stringify(committed.industries) === JSON.stringify(fresh.industries),
  "run: node scripts/build-taxonomy-reference.mjs");
check("every row carries both labels",
  fresh.totals.withoutSector === 0 && fresh.totals.withoutIndustry === 0,
  `${fresh.totals.rows} rows, ${fresh.totals.withoutSector} without sector, ${fresh.totals.withoutIndustry} without industry`);

// THE SECTOR SET IS A CLOSED VOCABULARY and the slugs are URLs, nav and sitemap.
// A twelfth label does not fail anywhere -- it silently drops its symbols off
// sector pages, which is why this asserts the LABELS and not just the count.
const sectorsSrc = fs.readFileSync("lib/sectors.ts", "utf8");
const declared = new Set([...sectorsSrc.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]));
const aliased = new Set([...sectorsSrc.matchAll(/"([A-Z][A-Za-z &-]+)"/g)].map((m) => m[1]));
const unmapped = fresh.sectors.filter((s) => !declared.has(s.label) && !aliased.has(s.label));
check("every sector label resolves to a slug in lib/sectors.ts",
  unmapped.length === 0,
  unmapped.map((s) => `${s.label} (${s.count})`).join(", ") || `all ${fresh.sectors.length} resolve`);
check("...and there are exactly the 11 the slugs declare",
  fresh.sectors.length === 11, `${fresh.sectors.length} sector labels`);

// INDUSTRY IMPLIES SECTOR, measured. Anything keyed on industry alone can rely
// on this; if it ever stops being true, the assumption breaks silently.
const dual = fresh.industries.filter((i) => i.sectors.length > 1);
check("no industry appears under more than one sector",
  dual.length === 0,
  dual.map((i) => `${i.label} -> ${i.sectors.join("|")}`).join(", ") || "industry implies sector, 1:1");

// THE SEPARATOR POPULATION, asserted so the exact-match decision keeps its
// evidence. The news-art spec abandoned regex matching because of these.
const sep = fresh.industries.filter((i) => i.separators.length);
check("the separator population is still the majority the exact-match rule assumes",
  sep.length > fresh.industries.length / 2,
  `${sep.length} of ${fresh.industries.length} labels (${((sep.length / fresh.industries.length) * 100).toFixed(0)}%), ` +
    `${sep.reduce((a, i) => a + i.count, 0)} of ${fresh.totals.rows} symbols`);

// BARE LABELS COEXISTING WITH QUALIFIED SIBLINGS. This is the case that makes
// prefix grouping render a category present in no data, and the case a SIC code
// cannot be mapped onto without an unfalsifiable choice.
const byHead = new Map();
for (const i of fresh.industries) {
  if (!byHead.has(i.head)) byHead.set(i.head, []);
  byHead.get(i.head).push(i);
}
const bare = [...byHead.entries()].filter(([head, xs]) => xs.length > 1 && xs.some((i) => i.label === head));
check("bare labels coexisting with qualified siblings are still exactly the known two",
  bare.length === 2 && bare.every(([h]) => h === "Banks" || h === "Chemicals"),
  bare.map(([h, xs]) => `${h} (${xs.reduce((a, i) => a + i.count, 0)} across ${xs.length})`).join(", "));

console.log(failures ? `\n${failures} assertion(s) failed.\n` : "\nTaxonomy reference is current.\n");
process.exit(failures ? 1 : 0);
