// Pickers sector/industry come from A's SEC resolver, never FMP (Relay B,
// #553 COWORK #3/#16, 2026-09-24). Replaces check-industry-coverage.mjs, which
// guarded the FMP /stable/profile selection this change deletes.
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. A PRESET SELECTS ON A LABEL NOTHING PRODUCES. /semiconductor-stocks
//      filters industry == "Semiconductors" and /cheap-tech-stocks sector ==
//      "Technology". If the resolver's label set does not contain the value the
//      page asks for, the page is empty -- not a dash, no rows.
//   2. FMP CREEPS BACK. The warm fetching /stable/profile again, feeding the
//      resolver a vendor label as "cached", or the page overwriting the
//      resolver's answer with the cached fundamentals row.
//   3. THE RESOLVER STOPS COVERING THE PRESETS. Measured on the committed data:
//      the preset universe's semiconductor names and tech sector must resolve.
//
//   node scripts/check-pickers-taxonomy.mjs
import fs from "node:fs";
import path from "node:path";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lookupSpellingIn } from "../lib/symbolSpellings.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// A's resolver files, read the way staticProfile.sicProfileFor reads them.
const CLASS = JSON.parse(read("data/sec/sic-classification.json"));
const OVERRIDES = JSON.parse(read("data/sec/classification-overrides.json")).overrides ?? {};
const REG = JSON.parse(read("data/sec/registrants.json")).rows ?? {};
function resolve(sym) {
  const o = lookupSpellingIn(OVERRIDES, sym)?.value;
  if (o && (o.sector || o.industry)) return { sector: o.sector ?? null, industry: o.industry ?? null };
  const sic = lookupSpellingIn(REG, sym)?.value?.sic;
  if (!sic) return { sector: null, industry: null };
  const row = CLASS.codes[sic];
  return { sector: row?.sector ?? (row ? null : CLASS.majorGroups[sic.slice(0, 2)] ?? null), industry: row?.industry ?? null };
}

function suite(code) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // 1. every preset's category values exist in the resolver's label set
  const industries = new Set(Object.keys(CLASS.labels));
  const sectors = new Set(Object.values(CLASS.labels));
  const presets = code.presets;
  let checked = 0;
  for (const [page, src] of Object.entries(presets)) {
    for (const m of src.matchAll(/\{\s*kind:\s*"category",\s*field:\s*"(sector|industry)",\s*values:\s*\[([^\]]*)\]/g)) {
      const values = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      for (const v of values) {
        checked++;
        ok(`${page}: ${m[1]} "${v}" is a resolver label`, (m[1] === "industry" ? industries : sectors).has(v));
      }
    }
  }
  ok("the category presets were found (semiconductors, cheap tech)", checked >= 2, String(checked));

  // 2. no FMP taxonomy anywhere on the path
  ok("the warm makes no /stable/profile call", !/stable\/profile/.test(code.cache));
  ok("the warm keeps no profile cache", !/msh:pickers:profile/.test(code.cache) && !/readCachedProfilesBulk|fetchProfile/.test(code.cache));
  ok("the warm feeds the resolver no vendor label", /cleanSymbols\.map\(\(sym\) => \(\{ symbol: sym, cached: null \}\)\)/.test(code.cache));
  ok("the page reads sector/industry from the resolver", /resolveProfileBulk\(\s*entries\.map\(\(e\) => \(\{ symbol: e\.symbol, cached: null \}\)\)/.test(code.page));
  ok("the page never takes them from the cached fundamentals row", !/entry\.(industry|sector) = f\.(industry|sector)/.test(code.page));

  // 3. the resolver covers the presets, on the committed data
  const universe = Object.keys(REG);
  const semis = universe.filter((s) => resolve(s).industry === "Semiconductors");
  const tech = universe.filter((s) => resolve(s).sector === "Technology");
  ok("semiconductor names resolve (NVDA, AMD, INTC, AVGO, MU)", ["NVDA", "AMD", "INTC", "AVGO", "MU"].every((s) => resolve(s).industry === "Semiconductors"), ["NVDA", "AMD", "INTC", "AVGO", "MU"].map((s) => `${s}=${resolve(s).industry}`).join(" "));
  ok("enough semiconductors for the page (>= 25)", semis.length >= 25, String(semis.length));
  ok("enough technology names for cheap-tech (>= 150)", tech.length >= 150, String(tech.length));
  return { fails, semis: semis.length, tech: tech.length, checked };
}

const PRESET_PAGES = ["semiconductor-stocks", "cheap-tech-stocks", "low-pe-stocks", "high-dividend-yield-stocks", "dividend-growth-stocks", "cash-rich-value-stocks"];
const code = {
  cache: readCodeOnly("lib/server/fundamentalsCache.ts"),
  page: readCodeOnly("app/components/PickerResultPage.tsx"),
  presets: Object.fromEntries(PRESET_PAGES.map((p) => [p, readCodeOnly(`app/${p}/page.tsx`)])),
};
const base = suite(code);
if (base.fails.length) {
  console.error("FAIL check-pickers-taxonomy:\n  " + base.fails.join("\n  "));
  process.exit(1);
}

const MUTANTS = [
  ["a preset asks for a label the resolver never produces", { ...code, presets: { ...code.presets, "semiconductor-stocks": code.presets["semiconductor-stocks"].replace('"Semiconductors"', '"Semiconductor Equipment & Materials"') } }],
  ["the warm fetches /stable/profile again", { ...code, cache: code.cache + "\nconst u = `https://financialmodelingprep.com/stable/profile?symbol=${s}`;" }],
  ["the warm feeds a vendor label", { ...code, cache: code.cache.replace("({ symbol: sym, cached: null })", "({ symbol: sym, cached: sc })") }],
  ["the page takes the cached row's industry", { ...code, page: code.page + "\nif (f.industry) entry.industry = f.industry;" }],
];
let survived = 0;
for (const [label, c] of MUTANTS) {
  if (!suite(c).fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-pickers-taxonomy: ${base.checked} preset labels in the resolver's set; ${base.semis} semiconductors, ${base.tech} technology names resolve; ${MUTANTS.length} mutants caught`);
