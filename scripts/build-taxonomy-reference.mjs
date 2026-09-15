// Enumerate the sector/industry taxonomy and commit it as a reference file.
//
// WHY THIS EXISTS. The ~144 industry labels existed ONLY as values inside
// data/static-profile.json and had never been listed anywhere. screenerFields.ts
// reads them off the cached record, so there was no canonical list in code --
// and the SIC mapping table, the news-art provider map and the screener filter
// each need one. Three consumers deriving the same list separately is three
// chances to derive it differently.
//
// GENERATED, NOT HAND-MAINTAINED. The snapshot is the source; this writes the
// derived view. check-taxonomy-reference.mjs fails if the two drift, so the
// committed file cannot quietly go stale the way a hand-typed list would.
//
//   node scripts/build-taxonomy-reference.mjs        # write data/taxonomy.json
//   node scripts/build-taxonomy-reference.mjs --print
import fs from "node:fs";

const SNAPSHOT = "data/static-profile.json";
const OUT = "data/taxonomy.json";

export function buildTaxonomy(snapshotJson) {
  const rows = snapshotJson.rows ?? snapshotJson;
  const sectors = new Map();
  const industries = new Map();
  // Industry -> the sectors it appears under. A label under two sectors is a
  // finding, not a detail: it breaks any assumption that industry implies sector.
  const industrySectors = new Map();
  let total = 0;
  let withoutSector = 0;
  let withoutIndustry = 0;

  for (const key of Object.keys(rows)) {
    const row = rows[key];
    total++;
    if (row.sector) sectors.set(row.sector, (sectors.get(row.sector) ?? 0) + 1);
    else withoutSector++;
    if (row.industry) {
      industries.set(row.industry, (industries.get(row.industry) ?? 0) + 1);
      if (!industrySectors.has(row.industry)) industrySectors.set(row.industry, new Set());
      if (row.sector) industrySectors.get(row.industry).add(row.sector);
    } else withoutIndustry++;
  }

  const desc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return {
    generatedBy: "scripts/build-taxonomy-reference.mjs",
    source: SNAPSHOT,
    totals: { rows: total, withoutSector, withoutIndustry, sectors: sectors.size, industries: industries.size },
    sectors: desc(sectors).map(([label, count]) => ({ label, count })),
    industries: desc(industries).map(([label, count]) => ({
      label,
      count,
      sectors: [...(industrySectors.get(label) ?? [])].sort(),
      // Recorded because the news-art spec abandoned regex matching over exactly
      // these characters. 60% of labels carry one.
      separators: ["-", "&", ","].filter((c) => label.includes(c)),
      // The head term before the first separator. Prefix grouping on this is
      // what would render "Banks (179)" -- a category present in no data.
      head: label.split(/\s*[-,]\s*/)[0].trim(),
    })),
  };
}

// WRITING IS GUARDED BY "AM I THE ENTRY POINT".
//
// check-taxonomy-reference.mjs imports buildTaxonomy from here. Without this
// guard, that import re-runs the write at module load -- so the check would
// regenerate the file and THEN compare it to itself, passing forever and
// detecting nothing. It did exactly that on first run. An unguarded side effect
// at module top level turns a drift check into a no-op that reports success.
const isEntryPoint = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isEntryPoint) {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const taxonomy = buildTaxonomy(snapshot);
  if (process.argv.includes("--print")) {
    console.log(JSON.stringify(taxonomy, null, 2));
  } else {
    fs.writeFileSync(OUT, JSON.stringify(taxonomy, null, 1) + "\n");
    console.log(
      `wrote ${OUT} — ${taxonomy.totals.sectors} sectors, ${taxonomy.totals.industries} industries, ` +
        `${taxonomy.totals.rows} rows`
    );
  }
}
