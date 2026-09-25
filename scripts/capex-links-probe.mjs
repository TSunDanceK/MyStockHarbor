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
    seen.add(key);
    out.push({ name, cik: cik ?? null, ticker: ticker ?? null, how });
  };
  const aliasSpans = [];
  for (const m of span.matchAll(ALIAS_RE)) {
    const t = ALIASES[m[1]];
    const cik = t ? Number(tickerMap.get(t)?.cik) || null : null;
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

function extract(sentence, self, drops) {
  for (const [k, re] of Object.entries(DROPS)) if (re.test(sentence)) { drops[k] = (drops[k] ?? 0) + 1; return []; }
  const links = [];
  const seen = new Set();
  for (const p of PATTERNS) {
    const m = sentence.match(p.re);
    if (!m) continue;
    // "such as X, Y and Z": the span is the list up to the clause end
    let span = m[1];
    if (/customers-such-as|suppliers-such-as|our-/.test(p.rule)) span = span.split(/\b(?:and other|among others|as well as|, which|, who)\b/)[0];
    for (const party of partiesIn(span, self)) {
      const key = party.cik ? `c${party.cik}` : party.name.toUpperCase();
      if (seen.has(`${p.role}:${key}`)) continue;
      seen.add(`${p.role}:${key}`);
      links.push({ role: p.role, rule: p.rule, ...party });
    }
  }
  // a party found under both roles in one sentence is ambiguous: keep neither
  const byKey = new Map();
  for (const l of links) { const k = l.cik ?? l.name.toUpperCase(); byKey.set(k, (byKey.get(k) ?? new Set()).add(l.role)); }
  return links.filter((l) => byKey.get(l.cik ?? l.name.toUpperCase()).size === 1);
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
function sentences(text) {
  return text
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[a-z0-9)%"][.!?])\s+(?=[A-Z("“])/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 1200);
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
  let bad = 0;
  for (const [s, want] of cases) {
    const got = extract(s, self, {}).map((l) => `${l.role}:${l.ticker ?? l.name}`).join(",");
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(got)} want ${JSON.stringify(want)} :: ${s}`);
  }
  console.log(`selftest ${cases.length - bad}/${cases.length}`);
  process.exit(bad ? 1 : 0);
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
  const sents = sentences(htmlToText(html));
  tot.sentences += sents.length;
  const found = new Map();
  for (const s of sents) {
    for (const l of extract(s, self, drops)) {
      const key = `${l.role}:${l.cik ?? l.name.toUpperCase()}`;
      if (found.has(key)) { found.get(key).n++; continue; }
      found.set(key, { ...l, n: 1, quote: s.length > 600 ? `${s.slice(0, 600)}…` : s });
    }
  }
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
