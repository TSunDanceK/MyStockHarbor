// THE 10-K ITEM 1 RULES PASS → data/sec/classification-overrides.json
// (#552 COWORK #3, ruled in COWORK #22: option A with conditions).
//
// Inputs, all committed and all SEC-derived or ours:
//   data/sec/registrants.json          each filer's SIC code
//   data/sec/sic-classification.json   SIC code → sector/industry, hand-assigned
//   data/sec/classification-rules.json ordered phrase rules onto the fixed labels
//   data/sec/descriptions.json         each filer's own 10-K Item 1 / 20-F text
//
// WHO GETS A RULES PASS: a filer with no SIC, a code the table does not list,
// or a code the table marks `rules`. Everyone else takes the table as is.
//
// DETERMINISTIC AND AUDITABLE: every override records the matched phrase in a
// short quote from the filing, the form, the filing date and the accession.
// When no rule matches, NO override is written; if the table has no industry
// for the code either, the symbol is listed under `needsClassification` for
// the "Classification needed" helper. No vendor label is read anywhere here.
//
//   node scripts/build-sic-classification.mjs          (writes the file)
//   node scripts/build-sic-classification.mjs --check  (exits 1 if it is stale)
import fs from "node:fs";

const OUT = "data/sec/classification-overrides.json";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

export function buildOverrides({ registrants, table, rules, descriptions }) {
  const labels = table.labels;
  const window = rules.window;
  const compiled = rules.rules.map((r) => ({
    industry: r.industry,
    sector: labels[r.industry],
    reit: r.industry.startsWith("REIT - "),
    res: r.phrases.map((p) => ({ phrase: p, re: new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi") })),
  }));
  // A CUSTOMER OR MARKET, NOT THE BUSINESS: "solutions to banks, broker-dealers"
  // names who Broadridge serves. A match right after one of these words is
  // skipped and the next occurrence is tried.
  const SERVES = /\b(solutions to(?! (?:enable|help|support|power|deliver))|services to(?! (?:enable|help|support))|products to(?! (?:enable|help))|primarily for|rather than|instead of|unlike|serving|serves|sold into|end markets|customers such as|customers including|clients such as|clients including)\b[^.;:]{0,60}$/i;
  const firstOwn = (re, text) => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (!SERVES.test(text.slice(Math.max(0, m.index - 80), m.index))) return m;
    }
    return null;
  };
  const quote = (text, at, len) => {
    const start = Math.max(0, text.lastIndexOf(".", at) + 1);
    const end = text.indexOf(".", at + len);
    const s = text.slice(start, end < 0 ? Math.min(text.length, at + 160) : end + 1).replace(/\s+/g, " ").trim();
    return s.length > 180 ? `${s.slice(0, 177)}…` : s;
  };

  const overrides = {};
  const needsClassification = [];
  const symbols = [...new Set([...Object.keys(registrants), ...Object.keys(descriptions)])].sort();
  for (const symbol of symbols) {
    const sic = registrants[symbol]?.sic ?? null;
    const listed = sic ? table.codes[sic] ?? null : null;
    if (listed && !listed.rules) continue;
    // A CODE THE TABLE DOES NOT LIST takes its major group's sector, and its
    // industry from the rules below.
    const entry = listed ?? (sic ? { sector: table.majorGroups[sic.slice(0, 2)] ?? null, industry: null, rules: true, group: true } : null);
    const row = descriptions[symbol];
    const text = row ? String(row[3] ?? "").slice(0, window) : "";
    const scope = entry?.sector ?? null;
    const reitScope = sic === "6798" || /\breal estate investment trust\b/i.test(text);
    // EARLIEST MENTION WINS, ties to rule order: the filer states its business
    // first, and a later phrase is usually a customer, a market or a peer.
    let hit = null;
    if (text) {
      const eligible = compiled.filter((r) => (!scope || r.sector === scope) && (r.reit ? reitScope : sic !== "6798"));
      for (const r of eligible) for (const p of r.res) {
        const m = firstOwn(p.re, text);
        if (m && (!hit || m.index < hit.at)) hit = { r, p, at: m.index, len: m[0].length };
      }
    }
    if (hit && hit.r.industry !== entry?.industry) {
      overrides[symbol] = {
        sector: hit.r.sector, industry: hit.r.industry, sic,
        basis: row[0] === "20-F" ? "20-F Item 4.B" : "10-K Item 1",
        phrase: hit.p.phrase, quote: quote(text, hit.at, hit.len),
        form: row[0], filedOn: row[1], accession: row[2],
      };
    } else if (!hit && entry?.group && entry.sector) {
      // Sector from the major group, industry undecided: the sector still
      // counts for filters; the industry goes to the helper.
      overrides[symbol] = { sector: entry.sector, industry: null, sic, basis: "SIC major group" };
      needsClassification.push(symbol);
    } else if (!hit && !entry?.industry) {
      needsClassification.push(symbol);
    }
  }
  return { overrides, needsClassification };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const registrants = read("data/sec/registrants.json").rows;
  const table = read("data/sec/sic-classification.json");
  const rules = read("data/sec/classification-rules.json");
  const desc = read("data/sec/descriptions.json");
  const { overrides, needsClassification } = buildOverrides({ registrants, table, rules, descriptions: desc.rows });
  const doc = {
    _comment:
      "Per-symbol sector/industry overrides from each filer's own 10-K Item 1 / 20-F text, by the rules in " +
      "data/sec/classification-rules.json. Generated by scripts/build-sic-classification.mjs; do not hand-edit. " +
      "needsClassification: symbols neither the table nor the rules could place (the helper's list).",
    descriptionsAsOf: desc.asOf,
    overrides,
    needsClassification,
  };
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  if (process.argv.includes("--check")) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === text;
    console.log(same ? "classification-overrides.json is current" : "STALE: run node scripts/build-sic-classification.mjs");
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(OUT, text);
  console.log(`${Object.keys(overrides).length} overrides, ${needsClassification.length} need classification`);
}
