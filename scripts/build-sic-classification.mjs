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
    // SELF-ONLY: generic self-descriptions ("a technology platform", "an online
    // marketplace") count only inside the filer's own "X is a …" sentence and
    // only for a catch-all code, never as a stray mention (#552 COWORK #26).
    selfOnly: Boolean(r.selfOnly),
    res: r.phrases.map((p) => ({ phrase: p, re: new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi") })),
  }));
  // A CUSTOMER OR MARKET, NOT THE BUSINESS: "solutions to banks, broker-dealers"
  // names who Broadridge serves; "banks and credit card issuers rely on our
  // solutions" names FICO's customers. A match right after one of these words
  // is skipped and the next occurrence is tried.
  const SERVES = /\b(solutions to(?! (?:enable|help|support|power|deliver))|services to(?! (?:enable|help|support))|products to(?! (?:enable|help))|primarily for|rather than|instead of|unlike|acquired|acquisition of|serve|serving|serves|sold into|end markets|customers such as|customers including|clients such as|clients including)\b[^.;:]{0,60}$/i;
  // "tailored to serve the needs of residents in … LTCFs, such as assisted
  // living facilities … and behavioral health facilities" (GRDN): the list of
  // whom a pharmacy serves runs long, so this one clause reaches further.
  const SERVES_NEEDS = /\bserve the needs of\b[^.;:]{0,160}$/i;
  const RELIED = /^[^.;:]{0,60}\b(rely on|relies on|relied on|relied upon)\b/i;
  // A LIST OF SERVICES, NOT THE BUSINESS: "As part of our services, we provide
  // consumers with payment processing services, …" (HQY) and "… services,
  // including …". A match inside such a list, in the same sentence, is skipped
  // (#552 COWORK #23).
  const LISTED = /\bincluding\b|\bas part of\b|\bprovides? [^.]{0,50}\bwith\b/i;
  // A SALES CHANNEL, NOT THE BUSINESS: "We sell through … branches, counter
  // service … and e-commerce channels" (FERG) names how a distributor sells.
  // A match in a "sell through" sentence, or followed by "channel(s)", is
  // skipped (#552 COWORK #27).
  const CHANNEL_LIST = /\b(?:sell|sells|sold|market|markets)\s+(?:\w+\s+){0,3}?through\b/i;
  const CHANNEL = /^\s*channels?\b/i;
  // A SENTENCE STOP is a period followed by a space or the end, so a decimal
  // ("2.5 billion guest arrivals", ABNB) does not start a sentence mid-number.
  const lastStop = (text, before) => {
    for (let i = Math.min(before, text.length) - 1; i >= 0; i--) if (text[i] === "." && !/\S/.test(text[i + 1] ?? " ")) return i;
    return -1;
  };
  const nextStop = (text, from) => {
    for (let i = from; i < text.length; i++) if (text[i] === "." && !/\S/.test(text[i + 1] ?? " ")) return i;
    return -1;
  };
  const sentenceStart = (text, at) => lastStop(text, at) + 1;
  const firstOwn = (re, text, from = 0, to = text.length) => {
    re.lastIndex = from;
    for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
      const before = text.slice(Math.max(0, m.index - 80), m.index);
      const lead = text.slice(Math.max(0, m.index - 200), m.index);
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 80);
      const inSentence = text.slice(sentenceStart(text, m.index), m.index);
      if (!SERVES.test(before) && !SERVES_NEEDS.test(lead) && !RELIED.test(after) && !LISTED.test(inSentence) &&
        !CHANNEL_LIST.test(inSentence) && !CHANNEL.test(after)) return m;
    }
    return null;
  };
  // THE SELF-DESCRIPTION SENTENCE FIRST ("X is a …", "We are a …"): the
  // filer's own one-line answer beats a later sentence (#552 COWORK #23).
  const SELF = /\b(?:is|are)\s+(?:a|an|the|one of)\b|\bwe are\b|\boperates as\b/i;
  const selfSentence = (text) => {
    for (const m of text.matchAll(/[^.]+\.?/g)) {
      if (SELF.test(m[0])) return [m.index, m.index + m[0].length];
    }
    return null;
  };
  const REIT_TYPES = (r) => r.reit && r.industry !== "REIT - Mortgage" && r.industry !== "REIT - Diversified";
  const quote = (text, at, len) => {
    const start = lastStop(text, at + 1) + 1;
    const end = nextStop(text, at + len);
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
    // CROSS-SECTOR codes (3559 special machinery, 4400 water transport, 3690
    // misc electrical): the table keeps its default, but the rules may place a
    // filer in another sector ("wafer" → Semiconductors, "cruise" → Travel
    // Services) (#552 COWORK #26).
    const scope = entry?.crossSector ? null : entry?.sector ?? null;
    const catchAll = !entry?.sector;
    const reitScope = sic === "6798" || /\breal estate investment trust\b/i.test(text);
    // EARLIEST MENTION WINS, ties to rule order: the filer states its business
    // first, and a later phrase is usually a customer, a market or a peer.
    let hit = null;
    if (text) {
      const eligible = compiled.filter((r) => (!scope || r.sector === scope) && (r.reit ? reitScope : sic !== "6798") && (!r.selfOnly || catchAll));
      const general = eligible.filter((r) => !r.selfOnly);
      const earliest = (from, to) => {
        let best = null;
        for (const r of general) for (const p of r.res) {
          const m = firstOwn(p.re, text, from, to);
          if (m && (!best || m.index < best.at)) best = { r, p, at: m.index, len: m[0].length };
        }
        return best;
      };
      // Inside the self-description sentence the RULE ORDER decides, so the
      // more specific rule wins ("biopharmaceutical company … generic and
      // proprietary injectable" is Specialty & Generic); across the rest of
      // the window the earliest mention does.
      const byOrder = (from, to) => {
        for (const r of eligible) for (const p of r.res) {
          const m = firstOwn(p.re, text, from, to);
          if (m) return { r, p, at: m.index, len: m[0].length };
        }
        return null;
      };
      const own = selfSentence(text);
      hit = (own && byOrder(own[0], own[1])) || earliest(0, text.length);
      // TWO OR MORE PROPERTY TYPES IN ONE SENTENCE → REIT - Diversified
      // ("office and multifamily properties", "retail, office, and multifamily").
      if (hit && REIT_TYPES(hit.r)) {
        const from = sentenceStart(text, hit.at);
        const end = nextStop(text, hit.at + hit.len);
        const to = end < 0 ? text.length : end;
        const types = new Set();
        for (const r of eligible.filter(REIT_TYPES)) for (const p of r.res) if (firstOwn(p.re, text, from, to)) types.add(r.industry);
        if (types.size >= 2) {
          const div = compiled.find((r) => r.industry === "REIT - Diversified");
          hit = { ...hit, r: div, p: { phrase: [...types].map((t) => t.replace("REIT - ", "").toLowerCase()).join(" + ") } };
        }
      }
    }
    if (hit && hit.r.industry !== entry?.industry) {
      overrides[symbol] = {
        sector: hit.r.sector, industry: hit.r.industry, sic,
        basis: row[0] === "20-F" ? "20-F Item 4.B" : "10-K Item 1",
        phrase: hit.p.phrase, quote: quote(text, hit.at, hit.len),
        form: row[0], filedOn: row[1], accession: row[2],
      };
    } else if (!hit && !entry?.industry) {
      // No industry from the table or the rules. A code the table does not
      // list still takes its major group's sector in the resolver
      // (lib/server/staticProfile.ts); the industry goes to the helper.
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
