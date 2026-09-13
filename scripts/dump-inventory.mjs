// What is actually IN the frozen Step 0 dump.
//
// Asked because the static-profile snapshot needs sector/industry/exchange for
// every symbol, and the obvious source — FMP's /stable/profile — is one call
// per symbol behind a key this sandbox does not have and a host it is refused.
// If the dump already carries the taxonomy, the snapshot costs nothing at all.
//
// Read-only, no network: the runner already has the artifact on disk.
//
//   node scripts/dump-inventory.mjs <dumpDir>
import fs from "node:fs";
import path from "node:path";

const DUMP_DIR = process.argv[2] || "";
if (!DUMP_DIR) { console.log("no dump dir"); process.exit(0); }

const wanted = ["sector", "industry", "exchange", "exchangeShortName", "country",
  "ipoDate", "isin", "cusip", "website", "ceo", "fullTimeEmployees", "employees"];

for (const file of fs.readdirSync(DUMP_DIR).sort()) {
  const full = path.join(DUMP_DIR, file);
  const bytes = fs.statSync(full).size;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(full, "utf8")); }
  catch { console.log(`${file}  ${bytes}B  (not JSON)`); continue; }

  const rows = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.rows) ? parsed.rows
    : Array.isArray(parsed?.symbols) ? parsed.symbols
    : Array.isArray(parsed?.data) ? parsed.data
    : null;

  if (!rows) {
    console.log(`${file}  ${bytes}B  object, keys: ${Object.keys(parsed).slice(0, 12).join(",")}`);
    continue;
  }
  const first = rows.find((r) => r && typeof r === "object");
  const keys = first ? Object.keys(first) : [];
  const hits = keys.filter((k) => wanted.includes(k));
  console.log(
    `${file}  ${bytes}B  ${rows.length} rows  keys=[${keys.slice(0, 14).join(",")}]` +
    (hits.length ? `  ** PROFILE FIELDS: ${hits.join(",")} **` : "")
  );
  if (hits.length && first) {
    console.log(`    sample: ${JSON.stringify(Object.fromEntries(hits.concat(["symbol"]).filter((k) => k in first).map((k) => [k, first[k]])))}`);
  }
}
