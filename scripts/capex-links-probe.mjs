// CAPEX PHASE 2 — NAMED-LINKS PRECISION PROBE (Relay C, #563 COWORK #16).
//
// READ-ONLY. No Redis, no credential, no store, no FMP. It runs on a relay
// runner because the agent sandbox is refused www.sec.gov and data.sec.gov.
// Everything leaves the runner as log lines:
//
//   FILER {...}  one per filer read: form, accession, sentence count, links
//   LINK  {...}  one per extracted link, with the filed sentence and accession
//   DROP  {...}  counts of sentences each exclusion rule removed (per shard)
//
// WHAT CHANGED FROM THE PHASE 1 PROBE (capex-probe.mjs `links`, 28%), per
// COWORK #1 D3(a):
//   - a link needs an EXPLICIT supplier or customer pattern, and the named
//     party must sit inside the span that pattern governs (after "from", after
//     "manufactured by", before "accounted for n% of revenue", ...). A
//     supplier word elsewhere in the sentence is not enough;
//   - whole sentences are dropped for competitor, biography, exhibit/index,
//     M&A/subsidiary and litigation/receivership wording;
//   - the filer's own names, "Company", and common-word registrant names
//     (Target, Flex, Arrow, ...) without a corporate suffix are never parties;
//   - the role comes from the pattern, not from which cue word is present.
//
// Name → CIK → ticker goes through A's shipped modules: secTickerMap's
// parseTickerFile (lifted, because that module imports @upstash/redis, which
// the read-only job does not install) and secTickerNames' company name and
// exchange, imported. OTC listings are reported as unmapped: the site tracks
// Nasdaq/NYSE names.
//
//   env SHARD=i/n   which slice of the universe (by CIK order)
//   env ONLY=SYM,.. read just these filers (spot checks)
//   relay tasks: capex-links-probe-1 … -12
import fs from "node:fs";
import "./lib/register-capex-ts.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA =
  process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; capex links probe)";
const SELFTEST = process.env.SELFTEST === "1";
// RULES=v2 adds the three rules measured in CODE-C #18 (in-sample on the v1
// hand-check sample); v1 (the default) is the extractor the gate measured.
const RULES = process.env.RULES || "v1";
const V2 = RULES === "v2" || RULES === "v3" || RULES === "v4";
// RULES=v3 (#563 COWORK #17), FROZEN before the fresh gate sample was drawn:
//   R1c  a one-word listed name with no suffix is not a party when the same
//        filing also uses it as a lower-case word ("Founder"/"founder",
//        "Strategy"/"strategy") -- plus a fixed backstop list;
//   R1d  US government bodies and agencies are never parties (DoW, DoD, GSA…);
//   R4   list items under a lead-in that names competitors ("Our competitors
//        include:") are dropped, even when the item itself never says so;
//   H    hosting/cloud (AWS, Azure, Google Cloud, "host our platform") is tagged
//        role "hosting" and kept apart from supplier links.
const V3 = RULES === "v3" || RULES === "v4";
// RULES=v4 (#563 COWORK #18), the final pattern round, FROZEN before its draw.
// v3's name, agency, lead-in and hosting rules stay; the patterns are cut to
// explicit trade statements only (PATTERNS_V4), with more sentence drops
// (V4_DROPS) and the alias rule A1.
const V4 = RULES === "v4";

// ── A's modules ─────────────────────────────────────────────────────────────
const tickerSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift([
  grabFunction(tickerSrc, "padCik"),
  grabFunction(tickerSrc, "parseTickerFile"),
  "export { parseTickerFile, padCik };",
].join("\n"));
const { map: tickerMap } = tick.parseTickerFile(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const names = await import("../lib/server/secTickerNames.ts");

// ── universe: registrants.json, one entry per CIK, annual form 10-K / 20-F ──
const reg = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const UNIVERSE = new Map(); // cik(int) -> {symbols, form}
for (const [sym, r] of Object.entries(reg)) {
  if (!r?.cik || r.aliasOf) continue;
  const cik = Number(r.cik);
  const u = UNIVERSE.get(cik) ?? { symbols: [], form: r.annualForm ?? null };
  u.symbols.push(sym);
  UNIVERSE.set(cik, u);
}

// Size rank: SEC's company_tickers_exchange file lists registrants in
// descending market value, so a CIK's first row index is its size rank. Used
// only to stratify the hand-check sample (large = rank < 500).
const rawTickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const iCik = rawTickers.fields.indexOf("cik");
const SIZE_RANK = new Map();
rawTickers.data.forEach((row, k) => { const c = Number(row[iCik]); if (!SIZE_RANK.has(c)) SIZE_RANK.set(c, k); });

// ── the counterparty dictionary ─────────────────────────────────────────────
// Every Nasdaq/NYSE ticker's company name (A's secTickerNames), normalised.
const SUFFIX =
  /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|COMPANIES|CO|LTD|LIMITED|LLC|L ?P|PLC|N ?V|S ?A|AG|SE|HOLDINGS?|GROUP|THE|CLASS [A-C]|NEW|DE|ADR|ADS|SA DE CV|TECHNOLOGIES|TECHNOLOGY|INTERNATIONAL|INTL|ORDINARY SHARES?|COMMON STOCK)\b/g;
const normName = (s) =>
  ` ${String(s).toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ")} `
    .replace(SUFFIX, " ").replace(/\s+/g, " ").trim();

const LISTED = new Map(); // normalised name -> {cik, ticker}
const byCikTicker = new Map();
for (const [ticker, e] of tickerMap) {
  const cik = Number(e.cik);
  if (!names.gridAdmits(ticker)) continue; // Nasdaq / NYSE only
  if (!byCikTicker.has(cik)) byCikTicker.set(cik, ticker);
  const n = normName(names.gridCompanyName(ticker));
  if (n.length >= 3 && !LISTED.has(n)) LISTED.set(n, { cik, ticker: byCikTicker.get(cik) });
}
const tickerForCik = (cik) => byCikTicker.get(cik) ?? null;

// Short forms that do not equal a registrant name. A ticker of null means the
// company is named but is not a US listing we track (reported as unmapped).
const ALIASES = {
  TSMC: "TSM", "Taiwan Semiconductor": "TSM", NVIDIA: "NVDA", Nvidia: "NVDA", ASML: "ASML",
  Samsung: null, "SK hynix": null, "SK Hynix": null, Foxconn: null, "Hon Hai": null, Panasonic: null,
  CATL: null, "Contemporary Amperex": null, Pegatron: null, Wistron: null, Quanta: null, "LG Energy": null,
  "LG Chem": null, BOE: null, Kioxia: null, Huawei: null, Bosch: null, Siemens: null, Airbus: null,
  "Tokyo Electron": null, ASE: null, "Advanced Semiconductor Engineering": null, SPIL: null, "Siliconware Precision": null, STATSChipPAC: null, KYEC: null, Sigurd: null, "STATS ChipPAC": null,
  Mediatek: null, MediaTek: null, Denso: null, Continental: null, Aldi: null, Lidl: null, Ikea: null, IKEA: null,
  Apple: "AAPL", Microsoft: "MSFT", Amazon: "AMZN", "Amazon Web Services": "AMZN", AWS: "AMZN",
  Google: "GOOGL", Alphabet: "GOOGL", Meta: "META", Oracle: "ORCL", Intel: "INTC", AMD: "AMD",
  "Advanced Micro Devices": "AMD", Broadcom: "AVGO", Qualcomm: "QCOM", Micron: "MU", Dell: "DELL",
  "Hewlett Packard Enterprise": "HPE", HPE: "HPE", HP: "HPQ", Cisco: "CSCO", Walmart: "WMT", "Wal-Mart": "WMT",
  Costco: "COST", "Home Depot": "HD", "Lowe's": "LOW", "Best Buy": "BBY", Boeing: "BA",
  "Lockheed Martin": "LMT", Lockheed: "LMT", Raytheon: "RTX", RTX: "RTX", "Northrop Grumman": "NOC",
  "General Dynamics": "GD", "General Motors": "GM", GM: "GM", Tesla: "TSLA", McKesson: "MCK",
  "Cardinal Health": "CAH", Cencora: "COR", AmerisourceBergen: "COR", CVS: "CVS", UnitedHealth: "UNH",
  "Applied Materials": "AMAT", "Lam Research": "LRCX", KLA: "KLAC", Avnet: "AVT", "Arrow Electronics": "ARW",
  "TD Synnex": "SNX", "TD SYNNEX": "SNX", Jabil: "JBL", Celestica: "CLS", "Super Micro": "SMCI", Supermicro: "SMCI",
  CoreWeave: "CRWV", Arista: "ANET", Marvell: "MRVL", "Texas Instruments": "TXN", GlobalFoundries: "GFS",
  "United Microelectronics": "UMC", UMC: "UMC", Amkor: "AMKR", Sony: "SONY", Nokia: "NOK", Ericsson: "ERIC",
  Verizon: "VZ", "AT&T": "T", "T-Mobile": "TMUS", Comcast: "CMCSA", Kroger: "KR", Medtronic: "MDT",
  Caterpillar: "CAT", Deere: "DE", "John Deere": "DE", Honeywell: "HON", "Johnson Controls": "JCI",
  Schneider: null, "Schneider Electric": null, ABB: "ABBNY", Vertiv: "VRT", Eaton: "ETN",
  "Western Digital": "WDC", Seagate: "STX", SanDisk: "SNDK", Sandisk: "SNDK", Corning: "GLW", Coherent: "COHR",
  Lumentum: "LITE", Ciena: "CIEN", Juniper: "JNPR", Salesforce: "CRM", IBM: "IBM", Accenture: "ACN",
  Walgreens: "WBA", "Dollar General": "DG", "Dollar Tree": "DLTR", "Tractor Supply": "TSCO", Albertsons: "ACI",
  Sysco: "SYY", "US Foods": "USFD", UNFI: "UNFI", "United Natural Foods": "UNFI", Chewy: "CHWY", Wayfair: "W",
  "Procter & Gamble": "PG", PepsiCo: "PEP", "Coca-Cola": "KO", Nike: "NKE", Stellantis: "STLA", Ford: "F",
  Toyota: "TM", Honda: "HMC", Rivian: "RIVN", Lucid: "LCID", Anthropic: null, OpenAI: null, xAI: null,
};
// Registrant names that are common words: only a party when a corporate
// suffix follows ("Target Corporation"), never bare. The "Target" → TGT class.
const AMBIGUOUS = new Set([
  "TARGET", "FLEX", "ARROW", "BLOCK", "MATCH", "GAP", "SNAP", "UNITY", "BOX", "SQUARE", "VISA", "GLOBAL",
  "ENERGY", "UNITED", "AMERICAN", "GENERAL", "NATIONAL", "FIRST", "SOUTHERN", "CENTRAL", "PACIFIC", "ATLANTIC",
  "CAPITAL", "SERVICE", "SERVICES", "SOLUTIONS", "SYSTEMS", "PARTNERS", "TRUST", "BANK", "FINANCIAL", "HEALTH",
  "CARE", "HOME", "DATA", "CLOUD", "POWER", "WATER", "GOLD", "SILVER", "COPPER", "STEEL", "OIL", "GAS", "PHARMA",
  "BIO", "LABS", "MEDICAL", "DIGITAL", "NETWORK", "MOTORS", "AUTO", "FOODS", "BRANDS", "STORES", "PRODUCTS",
  "RESOURCES", "INDUSTRIES", "ENTERPRISES", "OPEN", "EQUITY", "REALTY", "PROPERTIES", "INSURANCE", "LIFE",
  "SCIENCE", "SCIENCES", "APPLIED", "ADVANCED", "INNOVATIVE", "PRECISION", "PREMIER", "SELECT", "SUMMIT",
  "PINNACLE", "FRONTIER", "LIBERTY", "PIONEER", "EAGLE", "HARBOR", "CROWN", "APEX", "NOVA", "ALPHA", "BETA",
  "PROGRESS", "TRAVELERS", "PROGRESSIVE", "FIVE", "ONE", "NEXT", "NEW", "GREEN", "BLUE", "RED", "BRIGHT",
  "SHIFT", "EDGE", "CORE", "PRIME", "ELEMENT", "INSIGHT", "VERTEX", "SIGNET", "AVIS", "HERTZ", "DAY", "LIVE",
  "PLAY", "SHOPS", "HOST", "SPIRIT", "FRESH", "SAFE", "TRUE", "PURE", "SURE", "CLEAN", "CLEAR", "SMART",
  "COMPASS", "SIGNAL", "COMMUNITY", "HERITAGE", "PEOPLES", "CITIZENS",
  "INDEPENDENT", "COMMERCE", "COMMERCIAL", "EXCHANGE", "SECURITY", "SECURITIES", "LENDING", "MORTGAGE",
]);
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
const ALIAS_RE = new RegExp(`(?<![A-Za-z])(${ALIAS_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&")).join("|")})(?![A-Za-z])`, "g");
const CORP_SUFFIX_RE = /^,?\s*(Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.,? Ltd\.?|Ltd\.?|Limited|LLC|L\.P\.|plc|N\.V\.|S\.A\.|AG|SE|GmbH)\b/;
// Names that are never a counterparty: government, standards bodies, the
// filer-side words, auditors, and banks acting as agents.
const NOT_PARTY = /^(Company|the Company|Government|U\.S\. Government|Department|Board|Nasdaq|NYSE|SEC|FDIC|Federal|State|Treasury|IRS|FASB|PCAOB|Medicare|Medicaid|Ernst|Deloitte|KPMG|PricewaterhouseCoopers|PwC|Grant Thornton|BDO|Moody|Standard & Poor|S&P|Fitch|Computershare|Broadridge|Wells Fargo|JPMorgan|Bank of America|Citibank|Citigroup|Goldman Sachs|Morgan Stanley)\b/i;

// R1d (v3): government bodies and agencies, by name or acronym.
const GOV_BODY = /^(?:the\s+)?(DoW|DOW|DoD|DOD|DoE|DOE|DoJ|DOJ|DoT|DOT|DHS|HHS|GSA|NASA|NIH|FDA|CMS|CDC|VA|EPA|USDA|NSF|DARPA|DLA|DISA|NGA|NRO|NSA|CIA|FBI|FAA|FCC|FTC|NRC|SBA|USPS|IRS|NATO|MoD|MOD|IMOD|U\.?S\.?(?:\s+(?:Army|Navy|Air Force|Space Force|Government|Department|Postal))?|United States(?:\s+Government)?|Department|Ministry|Army|Navy|Air Force|Space Force|Marine Corps|Coast Guard|Veterans Affairs|Medicare|Medicaid)\b/;
// R1c (v3) backstop for capitalised common words, when the filing's own
// lower-case vocabulary is not at hand (the offline EVAL replay).
const COMMON_CAP = new Set(["FOUNDER", "CO-FOUNDER", "MILLENNIUM", "STRATEGY", "MINERALS", "OUTDOOR", "API", "DSS", "GDS"]);
const ALIAS_DESCRIPTOR = /^(Inc|Incorporated|Corp|Corporation|Company|Co|Ltd|Limited|LLC|L\.P|plc|PLC|N\.V|S\.A|AG|SE|Holdings?|Group|International|Technologies|Technology|Semiconductor|Manufacturing|Electronics|Micro|Devices|Research|Materials|Platforms|Web|Services|Networks|Systems|Communications|Laboratories|Pharmaceuticals|Motor|Motors|Stores|Brands|Foods|Energy|Industries|Enterprises|Health|Solutions|Instruments|Precision|Products)\.?,?$/;
// Find named companies inside a text span. Returns [{name, cik, ticker, how}].
function partiesIn(span, self) {
  const out = [];
  const seen = new Set();
  const push = (name, cik, ticker, how) => {
    const key = cik ? `c${cik}` : name.toUpperCase();
    if (seen.has(key)) return;
    if (cik && self.cik === cik) return;
    if (self.norms.has(normName(name))) return;
    if (NOT_PARTY.test(name)) return;
    if (V3 && GOV_BODY.test(name)) return;
    seen.add(key);
    out.push({ name, cik: cik ?? null, ticker: ticker ?? null, how });
  };
  const aliasSpans = [];
  for (const m of span.matchAll(ALIAS_RE)) {
    const t = ALIASES[m[1]];
    const cik = t ? Number(tickerMap.get(t)?.cik) || null : null;
    // A1 (v4): an alias loses to a longer proper name that continues past it
    // ("Coca-Cola Consolidated", "Coca-Cola Canada Bottling"), unless the next
    // word only describes the company ("Coca-Cola Company", "Micron Technology").
    // The longer name is then matched (or not) by the listed-name pass below.
    if (V4) {
      const next = span.slice(m.index + m[1].length).match(/^\s+([A-Z][A-Za-z&.-]*)/);
      if (next && !ALIAS_DESCRIPTOR.test(next[1])) continue;
    }
    aliasSpans.push([m.index, m.index + m[1].length]);
    push(m[1], cik, t ? tickerForCik(cik) ?? t : null, "alias");
  }
  // capitalised word runs, longest match first, against the listed-name index
  const words = [...span.matchAll(/[A-Z][A-Za-z0-9&'.-]*/g)];
  for (let i = 0; i < words.length; i++) {
    const start = words[i].index;
    if (aliasSpans.some(([a, b]) => start >= a && start < b)) continue;
    for (let len = Math.min(5, words.length - i); len >= 1; len--) {
      const last = words[i + len - 1];
      // the run must be contiguous: only spaces/&/commas between the words
      const text = span.slice(start, last.index + last[0].length);
      if (!/^[A-Z][A-Za-z0-9&'.-]*(?:[ ,&]+(?:and |of |the )?[A-Z][A-Za-z0-9&'.-]*)*$/.test(text)) continue;
      const n = normName(text);
      if (!n) continue;
      const hit = LISTED.get(n);
      if (!hit) continue;
      const after = span.slice(last.index + last[0].length);
      const hasSuffix = CORP_SUFFIX_RE.test(after) || /\b(Inc|Corp|Corporation|Company|Ltd|plc|N\.V|S\.A)\b\.?$/.test(text);
      const single = n.split(" ").length === 1;
      if (single && AMBIGUOUS.has(n) && !hasSuffix) continue;
      // one common-looking word ("Materion" fine, "Ameren" fine; "Energy" not):
      // single-token names need a suffix or an internal capital / all caps
      if (single && !hasSuffix && !/[A-Z].*[A-Z]/.test(text) && n.length < 5) continue;
      if (V3 && !hasSuffix && single) {
        const w = text.replace(/[.,]+$/, "");
        if (COMMON_CAP.has(n) || COMMON_CAP.has(w.toUpperCase()) || (self.lower && self.lower.has(w.toLowerCase()))) continue;
      }
      if (V2 && !hasSuffix) {
        // R1a: a short acronym (GDS, DSS, DoW, API) is a registrant only with a suffix
        if (single && text.replace(/\.$/, "").length <= 4 && /[A-Z].*[A-Z]/.test(text)) continue;
        // R1b: a name inside a longer proper noun ("Information Technology Strategy
        // Committee", "Danver Outdoor Kitchens", "Antofagasta Minerals") is not that registrant
        const before = span.slice(0, start), rest = span.slice(last.index + last[0].length);
        if (/[A-Z][A-Za-z&'-]*\s$/.test(before) || /^\s[A-Z][A-Za-z]/.test(rest)) continue;
      }
      push(text, hit.cik, hit.ticker, "listed-name");
      i += len - 1;
      break;
    }
  }
  return out;
}

// ── sentence filters (whole sentence dropped) ───────────────────────────────
const DROPS = {
  competitor: /\b(compet\w*|rivals?)\b/i,
  biography: /\b(served|serves|serving) (as|on)\b|\bwas appointed\b|\bprior to joining\b|\bpreviously (served|held|was)\b|\bjoined (us|the Company|our)\b|\b(Mr|Ms|Mrs|Dr)\.\s|\b(he|she) (has|was|is|served)\b|\bboard of directors of\b|\b(years? of experience)\b/i,
  exhibit: /\bExhibit\b|\bincorporated (herein )?by reference\b|\bFiled herewith\b|\bForm (8-K|10-Q|10-K|S-1|20-F)\b.*\bfiled\b/i,
  corporateAction: /\b(acquir\w*|acquisition|merger|merged|merge|divest\w*|spin-?off|spun off|subsidiar\w+|joint venture|tender offer|business combination)\b/i,
  legal: /\b(lawsuit|litigation|complaint|plaintiffs?|defendants?|court|settlement|infring\w*|arbitration|receivership|bankruptcy)\b/i,
  investorOrLender: /\b(credit agreement|credit facility|lenders?|underwriters?|indenture|trustee|notes due|term loan|revolving)\b/i,
};

// ── the explicit patterns: each yields a role and the span the party must be in
const SPAN_END = "([^;:]{3,220})";
const PATTERNS = [
  // suppliers
  { role: "supplier", rule: "made-by", re: new RegExp(`\\b(?:manufactured|fabricated|produced|assembled|packaged|tested|supplied|provided|built|made)\\s+(?:\\w+\\s+){0,4}?(?:for us\\s+)?by\\s+${SPAN_END}`, "i") },
  { role: "supplier", rule: "buy-from", re: new RegExp(`\\b(?:we|us|our \\w+)\\s+(?:\\w+\\s+){0,3}?(?:purchase|purchases|purchased|buy|buys|bought|source|sources|sourced|procure|procures|procured|obtain|obtains|obtained|license|licenses|licensed)\\s+(?:[\\w,-]+\\s+){0,8}?from\\s+${SPAN_END}`, "i") },
  { role: "supplier", rule: "rely-on", re: new RegExp(`\\b(?:we|our \\w+)\\s+(?:\\w+\\s+){0,2}?(?:rely|relies|relied|depend|depends|depended|are dependent|is dependent)\\s+(?:heavily |primarily |substantially |significantly |solely |exclusively |entirely |in part )?(?:up)?on\\s+${SPAN_END}`, "i") },
  { role: "supplier", rule: "suppliers-such-as", re: new RegExp(`\\b(?:suppliers?|vendors?|foundr(?:y|ies)|contract manufacturers?|manufacturing partners?|sources? of supply)\\b[^.;]{0,40}?\\b(?:such as|including|include|includes|namely|like|are|is)\\s+${SPAN_END}`, "i") },
  { role: "supplier", rule: "x-is-supplier", re: /(?:^|[,;]\s*|\b(?:and|that|while)\s+)([A-Z][^;:]{2,90}?)\s+(?:is|are|was|were|serves as|remains|has been|became)\s+(?:our|the|a|an|one of our)\s+(?:\w+\s+){0,3}?(?:suppliers?|vendors?|foundry|foundries|manufacturers?|sources? of|licensors?)\b/ },
  { role: "supplier", rule: "our-supplier-x", re: new RegExp(`\\bour\\s+(?:sole|single|primary|principal|main|key|largest|major|only|current|exclusive)\\s+(?:\\w+\\s+){0,2}?(?:supplier|vendor|foundry|manufacturer|source|licensor)s?\\s*(?:,|is|are|was|—|-)\\s*${SPAN_END}`, "i") },
  // customers
  { role: "customer", rule: "accounted-for", re: /([A-Z][^;:]{2,140}?)\s*(?:\([^)]*\)\s*)?(?:,\s*)?(?:and its affiliates\s*)?(?:accounted|represented|comprised|constituted|made up)\s+(?:for\s+)?(?:approximately |about |roughly |over |more than |less than |nearly )?\d+(?:\.\d+)?\s?%\s+(?:and \d+(?:\.\d+)?\s?%\s+)?of\s+(?:our\s+|the\s+|total\s+|consolidated\s+|net\s+)*(?:revenues?|sales|net sales|net revenues?|product revenues?|accounts receivable|receivables)/ },
  { role: "customer", rule: "sales-to", re: new RegExp(`\\b(?:sales|revenues?|shipments|net sales|product sales)\\s+to\\s+${SPAN_END}`, "i") },
  { role: "customer", rule: "customers-such-as", re: new RegExp(`\\b(?:customers?|clients?|retailers?|retail partners?|distributors?|resellers?|OEMs?|hyperscalers?)\\b[^.;]{0,40}?\\b(?:such as|including|include|includes|included|namely|like)\\s+${SPAN_END}`, "i") },
  { role: "customer", rule: "x-is-customer", re: /(?:^|[,;]\s*|\b(?:and|that|while)\s+)([A-Z][^;:]{2,90}?)\s+(?:is|are|was|were|remains|has been|became)\s+(?:our|the|a|an|one of our)\s+(?:\w+\s+){0,3}?(?:customers?|clients?)\b/ },
  { role: "customer", rule: "our-customer-x", re: new RegExp(`\\bour\\s+(?:largest|single largest|largest single|primary|principal|main|key|major|significant|top)\\s+(?:\\w+\\s+){0,1}?(?:customers?|clients?)\\s*(?:,|is|are|was|were|—|-|include|included)\\s*${SPAN_END}`, "i") },
  { role: "customer", rule: "we-sell-to", re: new RegExp(`\\bwe\\s+(?:\\w+\\s+){0,2}?(?:sell|sells|sold|supply|supplies|supplied|ship|ships|shipped|deliver|delivers|delivered)\\s+(?:[\\w,-]+\\s+){0,8}?to\\s+${SPAN_END}`, "i") },
];

// v4: explicit trade statements only. The role is the sentence's own noun:
// "sales to", "customer", "purchase from", "suppliers/foundries" carry it, and
// "X accounted for n% of our net sales" takes it from the noun in X's phrase
// ("two suppliers, Cisco and Zebra, each constituted ..." is a supplier).
// The subject must be the filer ("we", "our").
const PATTERNS_V4 = [
  { role: "customer", rule: "sales-to", re: new RegExp(`(?<![A-Za-z]'s\\s)(?<!\\w's\\s(?:\\w+\\s)?)\\b(?:[Oo]ur\\s+(?:\\w+\\s+){0,2}?)?(?:[Ss]ales|[Rr]evenues?|[Ss]hipments|[Nn]et sales|[Pp]roduct sales)\\s+to\\s+${SPAN_END}`) },
  { role: "customer", rule: "accounted-for", re: /([A-Z][^;:]{2,140}?)\s*(?:\([^)]*\)\s*)?(?:,\s*)?(?:and its affiliates\s*)?(?:each\s+|collectively\s+|together\s+)?(?:accounted|represented|comprised|constituted|made up)\s+(?:for\s+)?(?:approximately |about |roughly |over |more than |less than |nearly |in excess of )?\d+(?:\.\d+)?\s?(?:%|percent)\s+(?:and \d+(?:\.\d+)?\s?(?:%|percent)\s+)?of\s+(?:our|the Company's|total|consolidated)\s+(?:total\s+|consolidated\s+|net\s+)*(?:revenues?|sales|net sales|net revenues?|product revenues?)/ },
  { role: "customer", rule: "our-largest-customer", re: new RegExp(`\\bour\\s+(?:(?:two|three|four|five|ten|\\d+)\\s+)?(?:single\\s+)?largest\\s+(?:single\\s+)?(?:\\w+\\s+)?customers?\\s*(?:,|is|are|was|were|—|-|include|included|includes)\\s*${SPAN_END}`, "i") },
  { role: "supplier", rule: "buy-from", re: new RegExp(`\\b[Ww]e\\s+(?:\\w+\\s+){0,2}?(?:purchase|purchases|purchased|buy|buys|bought|license|licenses|licensed)\\s+(?:[\\w,-]+\\s+){0,8}?from\\s+${SPAN_END}`) },
  { role: "supplier", rule: "suppliers-such-as", re: new RegExp(`\\b(?:[Oo]ur|[Ww]e\\s+(?:\\w+\\s+){0,2}?(?:use|utilize|engage|rely on))\\s+(?:[\\w,-]+\\s+){0,5}?(?:suppliers?|foundr(?:y|ies)|contract manufacturers?)\\b[^.;]{0,40}?\\b(?:such as|including|include|includes|are|is|namely)\\s+${SPAN_END}`) },
  // the one narrow manufacturing pattern COWORK #18 allowed: the filer's own
  // wafers/chips/products, made BY X (X is the agent)
  { role: "supplier", rule: "our-products-made-by", re: new RegExp(`\\b(?:[Oo]ur|[Aa]ll of our|[Ss]ubstantially all of our|[Mm]ost of our|[Tt]he majority of our)\\s+(?:[\\w-]+\\s+){0,3}?(?:wafers|chips|products|devices|semiconductors|integrated circuits|components|dies|processors|GPUs)\\s+(?:are|is|were|have been)\\s+(?:currently\\s+|primarily\\s+|principally\\s+|substantially\\s+|exclusively\\s+|all\\s+|generally\\s+)?(?:manufactured|fabricated|produced)\\s+(?:for us\\s+)?(?:primarily\\s+|exclusively\\s+|solely\\s+)?by\\s+${SPAN_END}`) },
];
const V4_DROPS = {
  glossary: /^[A-Z][^:.]{1,60}:\s|\b(?:means|is defined as|refers to)\b/,
  partnersAndCustomers: /\b(?:partners?\s+(?:and|or|&)\s+customers?|customers?\s+(?:and|or|&)\s+partners?)\b/i,
  litigation: /\b(?:assert\w*|alleg\w*|defend\w*|infring\w*|sued|lawsuits?|claims? against)\b/i,
  reliefOrExhibit: /\b(?:exemptive|promissory note|in favor of|dated (?:as of )?[A-Z][a-z]+ \d)\b/,
  biography: /\b(?:her|his)\s+(?:major\s+|former\s+)?(?:clients|career|experience|tenure)\b|\bwhere (?:she|he)\b/i,
};
// H (v3): cloud hosting is a supplier of a different kind and would swamp the
// supply-chain view (COWORK #17 D2), so it gets its own role.
const HOSTING_NAME = /^(Amazon Web Services|AWS|Azure|Microsoft Azure|Google Cloud|Google Cloud Platform|GCP|Oracle Cloud|OCI|IBM Cloud)$/i;
const HOSTING_WORDS = /\b(cloud|hosting|hosted|host|hosts|data cent(?:er|re)s?|co-?location|computing (?:and storage )?(?:capacity|infrastructure|services)|storage capacity|infrastructure services|AWS|Azure|Amazon Web Services|Google Cloud)\b/i;
const CLOUD_TICKERS = new Set(["AMZN", "MSFT", "GOOGL", "GOOG", "ORCL", "IBM"]);
function isHosting(l, sentence) {
  if (l.role !== "supplier") return false;
  if (HOSTING_NAME.test(l.name)) return true;
  return CLOUD_TICKERS.has(l.ticker ?? "") && HOSTING_WORDS.test(sentence);
}
// R2 (v2): platforms, marketplaces and partnerships are named, but they are not
// a supplier or customer of the filer ("the Apple App Store", "hyperscalers
// such as AWS", "integrates with ...").
const MENTION_ONLY = /\b(App Store|Google Play|app stores?|marketplaces?|browsers?|ecosystems?|integrat\w*|partnerships?|partnering|partnered|Infrastructure-as-a-Service|IaaS)\b/i;
function extract(sentence, self, drops) {
  for (const [k, re] of Object.entries(DROPS)) if (re.test(sentence)) { drops[k] = (drops[k] ?? 0) + 1; return []; }
  if (V2 && MENTION_ONLY.test(sentence)) { drops.mentionOnly = (drops.mentionOnly ?? 0) + 1; return []; }
  if (V4) for (const [k, re] of Object.entries(V4_DROPS)) if (re.test(sentence)) { drops[k] = (drops[k] ?? 0) + 1; return []; }
  const links = [];
  const seen = new Set();
  for (const p of V4 ? PATTERNS_V4 : PATTERNS) {
    // v2 reads every occurrence; the span is a lookahead so one match cannot
    // swallow the next ("made by Airbus or Boeing ... made by Bombardier or Embraer")
    const ms = V2
      ? [...sentence.matchAll(new RegExp(p.re.source.replace(SPAN_END, `(?=${SPAN_END})`), p.re.flags.replace("g", "") + "g"))]
      : [sentence.match(p.re)].filter(Boolean);
    for (const m of ms) {
    // "such as X, Y and Z": the span is the list up to the clause end
    let span = m[1];
    if (/customers-such-as|suppliers-such-as|our-/.test(p.rule)) span = span.split(/\b(?:and other|among others|as well as|, which|, who)\b/)[0];
    if (V2) {
      // R3a: "supplied by distributors ... are Apple, ..." -- the party must be
      // the agent of the verb, not the subject of a later clause
      if (p.rule === "made-by") span = span.split(/\b(?:are|is|were|was|include[sd]?)\b/)[0];
      // R3b: "X is a vehicle manufacturer" describes X; only "our ..." relates it
      if (/^x-is-/.test(p.rule) && !/\b(our|one of our)\s/.test(m[0].slice(m[1].length))) continue;
      // R3c: selling royalties, rights, stakes or assets is a transaction, not a customer
      if (p.rule === "we-sell-to" && /\b(sold|sell|sells)\s+(?:\w+\s+){0,3}?(royalt\w*|rights?|interests?|stakes?|assets?|shares|business|portion|licen[cs]es?)\b/i.test(`${m[0]}${m[1] ?? ""}`)) continue;
    }
    let role = p.role;
    if (V4) {
      // the clause ends at its verb: "Sales to AT&T were $500m ..." / "we purchase X from Y, and Z"
      if (p.rule === "sales-to") span = span.split(/\b(?:were|was|represented|accounted|comprised|constituted|increased|decreased|declined|grew|totaled|totalled)\b/)[0];
      if (p.rule === "our-largest-customer" || p.rule === "suppliers-such-as") span = span.split(/\b(?:and other|among others|as well as|, which|, who)\b/)[0];
      // the role is the noun in X's own phrase
      if (p.rule === "accounted-for") {
        const sup = /\b(?:suppliers?|vendors?|manufacturers? of (?:the )?products)\b/i.test(span), cus = /\b(?:customers?|clients?|wholesalers?|distributors?|retailers?)\b/i.test(span);
        if (sup && cus) continue;
        role = sup ? "supplier" : "customer";
      }
    }
    for (const party of partiesIn(span, self)) {
      const key = party.cik ? `c${party.cik}` : party.name.toUpperCase();
      if (seen.has(`${role}:${key}`)) continue;
      seen.add(`${role}:${key}`);
      links.push({ role, rule: p.rule, ...party });
    }
    }
  }
  // a party found under both roles in one sentence is ambiguous: keep neither
  const byKey = new Map();
  for (const l of links) { const k = l.cik ?? l.name.toUpperCase(); byKey.set(k, (byKey.get(k) ?? new Set()).add(l.role)); }
  const kept = links.filter((l) => byKey.get(l.cik ?? l.name.toUpperCase()).size === 1);
  if (V3) for (const l of kept) if (isHosting(l, sentence)) l.role = "hosting";
  return kept;
}

// ── text ────────────────────────────────────────────────────────────────────
function htmlToText(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&#8217;|&#x2019;|&rsquo;|&#39;/gi, "'")
    .replace(/&#8220;|&#8221;|&#x201c;|&#x201d;|&ldquo;|&rdquo;|&quot;/gi, '"')
    .replace(/&#8212;|&#x2014;|&mdash;/gi, "—")
    .replace(/&#8211;|&#x2013;|&ndash;/gi, "–")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/[’]/g, "'")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s*/g, "\n");
}
const segments = (text) =>
  text
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[a-z0-9)%"][.!?])\s+(?=[A-Z("“])/))
    .map((s) => s.trim())
    .filter(Boolean);
const keepSentence = (s) => s.length >= 30 && s.length <= 1200;

// One filing's text -> its links. v1/v2 read each sentence on its own; v3 also
// carries two pieces of document context: the filing's lower-case vocabulary
// (R1c) and whether the current segment is an item under a competitor lead-in (R4).
function linksFromText(text, self, drops) {
  const segs = segments(text);
  const ctx = V3 ? { ...self, lower: new Set(text.match(/\b[a-z][a-z-]+\b/g) ?? []) } : self;
  const found = new Map();
  let sentenceCount = 0, competitorList = false;
  for (const seg of segs) {
    if (V3) {
      const isItem = /^[a-z•·▪◦\-–—(;]/.test(seg) || /;\s*(?:and|or)?$/.test(seg);
      if (competitorList && !isItem) competitorList = false;
      if (DROPS.competitor.test(seg) && /:\s*$/.test(seg)) { competitorList = true; continue; }
      if (competitorList) { if (keepSentence(seg)) { sentenceCount++; drops.leadInCompetitor = (drops.leadInCompetitor ?? 0) + 1; } continue; }
    }
    if (!keepSentence(seg)) continue;
    sentenceCount++;
    for (const l of extract(seg, ctx, drops)) {
      const key = `${l.role}:${l.cik ?? l.name.toUpperCase()}`;
      if (found.has(key)) { found.get(key).n++; continue; }
      found.set(key, { ...l, n: 1, quote: seg.length > 600 ? `${seg.slice(0, 600)}…` : seg });
    }
  }
  return { found, sentenceCount };
}

// ── self-test: fixed sentences, no network ──────────────────────────────────
if (SELFTEST) {
  const self = { cik: 1, norms: new Set(["ACME"]) };
  const cases = [
    ["We rely on TSMC to manufacture substantially all of our wafers.", "supplier:TSM"],
    ["Our products are manufactured by Taiwan Semiconductor Manufacturing Company Limited and Samsung.", "supplier:TSM,supplier:Samsung"],
    ["Walmart Inc. accounted for 21% of our net sales in fiscal 2025.", "customer:WMT"],
    ["Sales to Microsoft represented a significant portion of revenue.", "customer:MSFT"],
    ["We compete with NVIDIA, AMD and Intel in data center GPUs.", ""],
    ["Our competitors include suppliers such as Broadcom.", ""],
    ["Target customers include small businesses.", ""],
    ["Mr. Smith served as Chief Executive Officer of Intel Corporation.", ""],
    ["In 2024 we completed the acquisition of Juniper Networks.", ""],
    ["Our customers include Amazon Web Services, Google and Oracle Corporation.", "customer:AMZN,customer:GOOGL,customer:ORCL"],
    ["Acme relies on the Company's distributors.", ""],
    ["Networking net revenue increased 51.1%, primarily due to revenue attributable to Juniper Networks.", ""],
  ];
  if (V4) {
    cases.length = 0;
    cases.push(
      ["We rely on TSMC to manufacture substantially all of our wafers.", ""],
      ["Substantially all of our wafers are manufactured by Taiwan Semiconductor Manufacturing Company Limited.", "supplier:TSM"],
      ["Walmart Inc. accounted for 21% of our net sales in fiscal 2025.", "customer:WMT"],
      ["Sales to AT&T were $500.7 million, or 10.5% of total revenue, in fiscal 2025.", "customer:T"],
      ["Products from two suppliers, Cisco and Zebra, each constituted more than 10% of our net sales for the fiscal year.", "supplier:CSCO,supplier:ZBRA"],
      ["Our largest customer, CVS Health, accounted for 28 percent of our fiscal 2026 revenue.", "customer:CVS"],
      ["We purchase memory from SK Hynix Inc., Micron Technology, Inc., and Samsung.", "supplier:SK Hynix,supplier:MU,supplier:Samsung"],
      ["Our non-alcohol customers include Coca-Cola Canada Bottling Limited and Coca-Cola Consolidated, Inc.", ""],
      ["Our largest customers include The Coca-Cola Company.", "customer:KO"],
      ["FICO score: A measure of consumer credit risk produced by Fair Isaac Corporation.", ""],
      ["Our partners and customers include NVIDIA and Lockheed Martin.", ""],
      ["We disagree with the assertions made by Qualcomm and will defend against them; sales to Qualcomm continue.", ""],
      ["We compete with NVIDIA, AMD and Intel in data center GPUs.", ""],
      ["We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, to produce our wafers.", "supplier:TSM"],
      ["Some of these therapies are manufactured and marketed by large pharmaceutical companies such as Gilead Sciences, Inc.", ""],
      ["Our products are manufactured and marketed by Gilead Sciences, Inc. under a license.", ""],
      ["Sales to Microsoft represented a significant portion of revenue.", "customer:MSFT"],
    );
  } else if (V3) {
    cases.push(
      ["Our success depends in part on the continued service of Jane Roe, our Co-Founder, and we rely on our Founder for strategy.", ""],
      ["We deliver a broad range of products, services and solutions principally to the U.S. Department of War (\"DoW\"), and our customers include the DoW and GSA.", ""],
      ["We rely on Amazon Web Services to host our platform and customer data.", "hosting:AMZN"],
      ["We rely on Illumina, Inc. as a sole supplier for our sequencers.", "supplier:ILMN"],
    );
  }
  let bad = 0;
  for (const [s, want] of cases) {
    const got = extract(s, self, {}).map((l) => `${l.role}:${l.ticker ?? l.name}`).join(",");
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(got)} want ${JSON.stringify(want)} :: ${s}`);
  }
  if (V3) {
    // R4: a list item under a competitor lead-in; the doc-level path, with a
    // negative control (the same item under a supplier lead-in is kept)
    const item = V4
      ? "we purchase security appliances and software from Zscaler, Inc. and Okta, Inc.;"
      : "independent vendors that offer a mix of security products, such as Zscaler, Inc. and Okta, Inc.;";
    const doc = (lead) => `${lead}\n${item}\nOther text follows here in a normal sentence of the filing.`;
    const a = [...linksFromText(doc("Our competitors include:"), self, {}).found.values()].length;
    const b = [...linksFromText(doc("Our suppliers include:"), self, {}).found.values()].length;
    const okR4 = a === 0 && b > 0;
    if (!okR4) bad++;
    console.log(`${okR4 ? "ok  " : "FAIL"} R4 lead-in: competitor list ${a} links (want 0), supplier list ${b} (want >0)`);
    cases.push(["(R4)", ""]);
  }
  console.log(`selftest ${cases.length - bad}/${cases.length}`);
  process.exit(bad ? 1 : 0);
}

// ── EVAL=file: re-run the extractor on hand-checked sample sentences, no network.
// Each sampled link is "kept" when this rule set still extracts that party, in
// that role, from its filed sentence.
if (process.env.EVAL) {
  const sample = JSON.parse(fs.readFileSync(process.env.EVAL, "utf8"));
  for (const [k, l] of sample.entries()) {
    const self = { cik: l.filerCik, norms: new Set([normName(names.gridCompanyName(l.filer))].filter(Boolean)) };
    const got = extract(l.quote, self, {});
    const key = (x) => (x.cik ? `c${x.cik}` : x.name.toUpperCase());
    const kept = got.some((x) => x.role === l.role && key(x) === (l.partyCik ? `c${l.partyCik}` : l.party.toUpperCase()));
    console.log(`EVAL ${JSON.stringify({ k: k + 1, kept })}`);
  }
  process.exit(0);
}

// ── fetch ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0, requests = 0, bytes = 0;
async function get(url, json = true) {
  for (let a = 0; a < 5; a++) {
    const wait = lastAt + 130 - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000) });
    } catch { await sleep(1000 * 2 ** a); continue; }
    requests++;
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * 2 ** a); continue; }
    if (!res.ok) return null;
    const text = await res.text();
    bytes += text.length;
    return json ? JSON.parse(text) : text;
  }
  return null;
}

// ── run ─────────────────────────────────────────────────────────────────────
const [si, sn] = (process.env.SHARD || "1/1").split("/").map(Number);
const only = (process.env.ONLY || process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
let ciks = [...UNIVERSE.keys()].sort((a, b) => a - b);
if (only.length) ciks = ciks.filter((c) => UNIVERSE.get(c).symbols.some((s) => only.includes(s)));
else ciks = ciks.filter((_, k) => k % sn === si - 1);
const DEADLINE = Date.now() + Number(process.env.BUDGET_MIN || 26) * 60_000;
console.log(`=== capex links probe shard ${si}/${sn}: ${ciks.length} filers; dictionary ${LISTED.size} listed names ===`);
const drops = {};
const tot = { filers: 0, noAnnual: 0, fetchFailed: 0, skippedForTime: 0, sentences: 0, links: 0, withLink: 0 };
for (const cik of ciks) {
  if (Date.now() > DEADLINE) { tot.skippedForTime++; continue; }
  const u = UNIVERSE.get(cik);
  const sub = await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
  const f = sub?.filings?.recent;
  const k = f ? f.form.findIndex((x) => x === "10-K" || x === "20-F" || x === "10-KT") : -1;
  if (k < 0) { tot.noAnnual++; console.log(`FILER ${JSON.stringify({ cik, sym: u.symbols[0], form: null })}`); continue; }
  const accn = f.accessionNumber[k];
  const html = await get(`https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${f.primaryDocument[k]}`, false);
  if (!html) { tot.fetchFailed++; console.log(`FILER ${JSON.stringify({ cik, sym: u.symbols[0], form: f.form[k], accn, fetch: "failed" })}`); continue; }
  tot.filers++;
  const self = {
    cik,
    norms: new Set([normName(sub.name), ...(sub.formerNames ?? []).map((x) => normName(x.name)), ...u.symbols.map((s) => normName(names.gridCompanyName(s)))].filter(Boolean)),
  };
  const { found, sentenceCount } = linksFromText(htmlToText(html), self, drops);
  const sents = { length: sentenceCount };
  tot.sentences += sents.length;
  tot.links += found.size;
  if (found.size) tot.withLink++;
  const rank = SIZE_RANK.get(cik) ?? null;
  console.log(`FILER ${JSON.stringify({ cik, sym: u.symbols[0], form: f.form[k], date: f.filingDate[k], accn, rank, sentences: sents.length, links: found.size })}`);
  for (const l of found.values()) {
    console.log(`LINK ${JSON.stringify({ filer: u.symbols[0], filerCik: cik, rank, form: f.form[k], accn, role: l.role, rule: l.rule, party: l.name, partyTicker: l.ticker, partyCik: l.cik, how: l.how, n: l.n, quote: l.quote })}`);
  }
}
console.log(`DROP ${JSON.stringify(drops)}`);
console.log(`TOTALS ${JSON.stringify(tot)} requests ${requests} bytes ${(bytes / 1e6).toFixed(0)}MB. Redis commands: 0 (no store touched).`);
