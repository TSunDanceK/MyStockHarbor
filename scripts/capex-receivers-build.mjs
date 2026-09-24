// BUILD data/capex/receivers.json — the curated "who is receiving" lines.
//
// The list itself (which company, which member, which group) is the one Cowork
// approved on #563 (COWORK #2: the 44 from CODE-C #2 plus HPE Networking).
// Everything else in each entry is READ FROM THE FILING, not typed here:
//   - the filing (latest 10-K / 20-F / 40-F) and its accession,
//   - the line's current and prior fiscal-year revenue, and currency,
//   - the filer's own label for the member (label linkbase),
//   - for an acronym label, a verbatim expansion from the filing text
//     ("Cloud Memory Business Unit"), else the element name split into words,
//     with the source recorded either way.
// The parsers are lifted from lib/server/capexReceivers.ts, so the committed
// baseline and the daily job read a filing with the same code.
//
// Read-only, uncredentialled: runs on a relay runner (the sandbox is refused
// data.sec.gov). Prints the JSON between markers; nothing is written anywhere.
//
//   node scripts/capex-receivers-build.mjs
import fs from "node:fs";
import { liftCapexParsers } from "./lib/capex-lift.mjs";

const { extractMemberRevenue, parseLabelLinkbase, RECEIVER_GROUPS } = await liftCapexParsers();

const UA =
  process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; capex receivers build)";

// ticker, group, axis, element, reviewed label, broad, alsoSpender
const CURATED = [
  ["NVDA", "Chips", "product", "nvda:DataCenterMember", "Data Center", false, false],
  ["AMD", "Chips", "segment", "amd:DatacenterMember", "Datacenter", false, false],
  ["AVGO", "Chips", "segment", "avgo:SemiconductorSolutionsMember", "Semiconductor Solutions", true, false],
  ["MRVL", "Chips", "product", "mrvl:DataCenterMember", "Data center", false, false],
  ["INTC", "Chips", "segment", "intc:DatacenterAndAIMember", "DCAI", false, false],
  ["ASML", "Chip-making equipment", "product", "asml:NXEMember", "NXE", false, false],
  ["AMAT", "Chip-making equipment", "segment", "amat:SemiconductorSystemsSegmentMember", "Semiconductor Systems", true, false],
  ["LRCX", "Chip-making equipment", "product", "lrcx:SystemMember", "Systems Revenue", true, false],
  ["KLAC", "Chip-making equipment", "segment", "klac:SemiconductorProcessControlMember", "Semiconductor Process Control", true, false],
  ["TER", "Chip-making equipment", "segment", "ter:SemiconductorTestMember", "Semiconductor Test", true, false],
  ["MU", "Memory & storage", "segment", "mu:CMBUMember", "CMBU", false, false],
  ["SNDK", "Memory & storage", "product", "sndk:DatacenterMember", "Datacenter", false, false],
  ["WDC", "Memory & storage", "product", "wdc:CloudMember", "Cloud", false, false],
  ["CSCO", "Networking & optics", "product", "csco:NetworkingMember", "Networking", false, false],
  ["HPE", "Networking & optics", "segment", "hpe:NetworkingMember", "Networking", false, false],
  ["CIEN", "Networking & optics", "product", "cien:OpticalNetworkingMember", "Optical Networking", false, false],
  ["COHR", "Networking & optics", "segment", "iivi:DatacenterAndCommunicationsSegmentMember", "Datacenter & Communications", false, false],
  ["LITE", "Networking & optics", "segment", "lite:SystemsMember", "Systems", false, false],
  ["FN", "Networking & optics", "product", "fn:DataCenterMember", "Data center", false, false],
  ["AAOI", "Networking & optics", "product", "aaoi:DataCenterMember", "Data Center", false, false],
  ["GLW", "Networking & optics", "product", "glw:OpticalCommunicationsMember", "Optical Communications", false, false],
  ["DELL", "Servers & assembly", "segment", "dell:InfrastructureSolutionsGroupMember", "Infrastructure Solutions Group", false, false],
  ["HPE", "Servers & assembly", "segment", "hpe:ServerSegmentMember", "Server", false, false],
  ["JBL", "Servers & assembly", "segment", "jbl:IntelligentInfrastructureMember", "Intelligent Infrastructure", false, false],
  ["CLS", "Servers & assembly", "segment", "cls:CCSSegmentMember", "CCS", false, false],
  ["FLEX", "Servers & assembly", "segment", "flex:CloudPowerInfrastructureCPIMember", "CPI", false, false],
  ["AMKR", "Servers & assembly", "product", "amkr:AdvancedProductsMember", "Advanced Products", true, false],
  ["ETN", "Power & cooling", "segment", "etn:ElectricalAmericasSegmentMember", "Electrical Americas", true, false],
  ["GEV", "Power & cooling", "segment", "gev:PowerSegmentMember", "Power", true, false],
  ["PWR", "Power & cooling", "segment", "pwr:ElectricPowerMember", "Electric", true, false],
  ["FIX", "Power & cooling", "segment", "fix:MechanicalSegmentMember", "Mechanical Segment", true, false],
  ["MTZ", "Power & cooling", "segment", "mtz:CommunicationsMember", "Communications", false, false],
  ["HUBB", "Power & cooling", "segment", "hubb:ElectricalSegmentMember", "Electrical Solutions", true, false],
  ["NVT", "Power & cooling", "segment", "nvt:EnclosuresSegmentMember", "Systems Protection", true, false],
  ["MOD", "Power & cooling", "product", "mod:DataCentersMember", "Data centers", false, false],
  ["MSFT", "Cloud & data centres", "segment", "msft:IntelligentCloudMember", "Intelligent Cloud", false, true],
  ["AMZN", "Cloud & data centres", "segment", "amzn:AmazonWebServicesSegmentMember", "AWS", false, true],
  ["GOOGL", "Cloud & data centres", "segment", "goog:GoogleCloudMember", "Google Cloud", false, true],
  ["ORCL", "Cloud & data centres", "product", "orcl:CloudInfrastructureMember", "Cloud Infrastructure", false, true],
  ["IBM", "Cloud & data centres", "segment", "ibm:InfrastructureMember", "Infrastructure", true, false],
  ["NBIS", "Cloud & data centres", "segment", "nbis:NebiusSegmentMember", "Nebius", false, false],
  ["APLD", "Cloud & data centres", "segment", "apld:HPCHostingBusinessMember", "HPC Hosting Business", false, false],
  ["IREN", "Cloud & data centres", "segment", "iren:AICloudServicesMember", "AI Cloud", false, false],
  ["EQIX", "Cloud & data centres", "product", "eqix:ColocationMember", "Colocation", true, false],
  ["DLR", "Cloud & data centres", "product", "dlr:RentalAndOtherServicesMember", "Rental and other services", true, false],
];

const tick = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikOf = new Map(tick.data.map(([cik, , t]) => [t, String(cik).padStart(10, "0")]));

let last = 0;
async function get(url, json = true) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + 150 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); continue; }
      if (!res.ok) return null;
      return json ? res.json() : res.text();
    } catch { await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt)); }
  }
  return null;
}

const textOf = (html) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;|&#xa0;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&#8217;|&#x2019;|&rsquo;/gi, "'")
    .replace(/&#8220;|&#8221;|&#x201c;|&#x201d;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");

const STOP = new Set(["and", "&", "of", "the", "for"]);
/** "Cloud Memory Business Unit" matches "CMBU"; "Connectivity & Cloud Solutions" matches "CCS". */
const initialsMatch = (words, acr) => {
  const initials = words.split(/[\s-]+/).filter((w) => w && !STOP.has(w.toLowerCase())).map((w) => (/^[A-Z]{2,}$/.test(w) ? w : w[0].toUpperCase())).join("");
  return initials === acr;
};
function expandFromText(text, acr) {
  const re = new RegExp(`((?:[A-Z][A-Za-z]*|and|&|of|the|for)(?:[\\s-]+(?:[A-Z][A-Za-z]*|and|&|of|the|for)){1,7})\\s*\\(\\s*(?:the\\s+)?"?${acr}"?\\s*\\)`, "g");
  for (const m of text.matchAll(re)) {
    const words = m[1].trim().split(/\s+/);
    // The expansion is the SHORTEST tail of the run whose initials spell the acronym.
    for (let i = words.length - 1; i >= 0; i--) {
      const tail = words.slice(i).join(" ");
      if (initialsMatch(tail, acr)) return tail;
    }
  }
  return null;
}
// The element name split into words, less a trailing copy of the acronym
// itself ("CloudPowerInfrastructureCPI" -> "Cloud Power Infrastructure").
const fromElement = (element, acr) =>
  element.replace(/^[^:]+:/, "").replace(/(Segment)?Member$/, "").replace(new RegExp(`${acr}$`), "")
    .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").trim();

const entries = [];
const problems = [];
const latestCache = new Map();
for (const [ticker, group, axis, element, label, broad, alsoSpender] of CURATED) {
  if (!RECEIVER_GROUPS.includes(group)) throw new Error(`${ticker}: unknown group ${group}`);
  const cik = cikOf.get(ticker);
  if (!cik) { problems.push(`${ticker}: no CIK`); continue; }
  if (!latestCache.has(cik)) {
    const sub = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const r = sub?.filings?.recent;
    const i = r ? r.form.findIndex((f) => ["10-K", "20-F", "40-F"].includes(f)) : -1;
    latestCache.set(cik, i < 0 ? null : { accession: r.accessionNumber[i], form: r.form[i], filed: r.filingDate[i], doc: r.primaryDocument[i] });
  }
  const filing = latestCache.get(cik);
  if (!filing) { problems.push(`${ticker}: no annual filing`); continue; }
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replace(/-/g, "")}`;
  const idx = await get(`${base}/index.json`);
  const names = idx?.directory?.item?.map((x) => x.name) ?? [];
  const instName = names.find((n) => /_htm\.xml$/i.test(n)) ?? names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre|MetaLinks)/i.test(n));
  const labName = names.find((n) => /_lab\.xml$/i.test(n)) ?? names.find((n) => /\.xsd$/i.test(n));
  const inst = instName ? await get(`${base}/${instName}`, false) : null;
  const found = inst ? extractMemberRevenue(inst, element, axis) : null;
  if (!found) { problems.push(`${ticker} ${element}: not in ${filing.accession}`); continue; }
  const labels = labName ? parseLabelLinkbase((await get(`${base}/${labName}`, false)) ?? "") : new Map();
  const filedLabel = labels.get(element.replace(/^[^:]+:/, "")) ?? null;
  if (filedLabel !== null && filedLabel !== label) problems.push(`${ticker} ${element}: filed label "${filedLabel}" differs from reviewed "${label}"`);
  if (filedLabel === null) problems.push(`${ticker} ${element}: no filed label found (${labName ?? "no label file"})`);
  let subLabel = null;
  if (/^[A-Z]{2,6}$/.test(label)) {
    const html = await get(`${base}/${filing.doc}`, false);
    const expanded = html ? expandFromText(textOf(html), label) : null;
    const split = fromElement(element, label);
    subLabel = expanded ? { text: expanded, source: "filing text" } : split ? { text: split, source: "element name" } : null;
    if (!subLabel) problems.push(`${ticker}: acronym "${label}" has no expansion in the filing text or the element name`);
  }
  entries.push({
    ticker, cik, group, axis, element, label: filedLabel ?? label, subLabel, broad, alsoSpender,
    baseline: { accession: filing.accession, form: filing.form, filed: filing.filed, ...found, filedLabel },
  });
}

const out = {
  _comment:
    "Curated 'who is receiving' lines for /bottlenecks/capex (#563 COWORK #2). One filed revenue line per entry, in the filer's own words; never summed across companies. Built by scripts/capex-receivers-build.mjs (relay task capex-receivers-build) from each filer's latest annual XBRL instance and label linkbase. The daily job capex-receivers refreshes readings into Redis when a newer annual filing appears.",
  builtAt: new Date().toISOString().slice(0, 10),
  source: "SEC EDGAR XBRL instances and label linkbases",
  entries,
};
console.log(`entries ${entries.length} of ${CURATED.length}; problems ${problems.length}`);
for (const p of problems) console.log(`PROBLEM ${p}`);
console.log("=====BEGIN receivers.json=====");
console.log(JSON.stringify(out, null, 1));
console.log("=====END receivers.json=====");
