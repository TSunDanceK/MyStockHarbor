// Capex "Who is receiving": the line reader, the refresh, and the curated list
// (Relay C, #563 COWORK #2, 2026-09-24).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE WRONG NUMBER UNDER THE RIGHT LABEL. A member crossed with a
//      geography, a quarter, or the other axis read as the fiscal-year line;
//      a 52/53-week year missed; current and prior from two different concepts.
//   2. A RENAME GUESSED. A filing that dropped the element must keep the old
//      figures, marked stale and flagged -- never a blank, never a neighbour.
//   3. WORDS THAT ARE NOT THE FILER'S. A sub-label shown without being found
//      in the element name or the filing text.
//   4. COST. A company whose annual accession did not change must cost one
//      submissions request, not a 4.5 MB instance.
//   5. THE RULINGS DRIFT: the 45 lines, the 7 headings, the 16 broad tags, the
//      4 hyperscaler notes, the 4 sub-labels (COWORK #2).
//
// THE XBRL BELOW IS CONSTRUCTED, shaped like real instances (contexts with
// xbrldi:explicitMember, srt:ConsolidationItemsAxis beside the segment axis,
// iso4217 units, a label linkbase with terse and standard roles). The live
// check against real filings is the relay dry run (write-capex-receivers).
//
//   node scripts/check-capex-receivers.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const XBRL = "lib/server/capexXbrl.ts";
const CORE = "lib/server/capexReceiversCore.ts";

let seq = 0;
async function load(xbrlSrc, coreSrc) {
  const tag = `.check-cxr-${process.pid}-${seq++}`;
  const xf = path.join(ROOT, "lib/server", `${tag}-x.ts`);
  const cf = path.join(ROOT, "lib/server", `${tag}-c.ts`);
  fs.writeFileSync(xf, xbrlSrc);
  const patched = coreSrc.replace(`from "./capexXbrl";`, `from "./${tag}-x.ts";`);
  if (patched === coreSrc) throw new Error("capexReceiversCore no longer imports ./capexXbrl");
  fs.writeFileSync(cf, patched);
  try {
    return { X: await import(pathToFileURL(xf).href), C: await import(pathToFileURL(cf).href) };
  } finally {
    fs.unlinkSync(xf);
    fs.unlinkSync(cf);
  }
}

// ── constructed filing ──────────────────────────────────────────────────────
const ctx = (id, start, end, dims = []) =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier>${dims.length ? `<xbrli:segment>${dims.map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join("")}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
const SEG = "us-gaap:StatementBusinessSegmentsAxis";
const PROD = "srt:ProductOrServiceAxis";
const OPS = ["srt:ConsolidationItemsAxis", "srt:OperatingSegmentsMember"];
const REV = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
const fact = (concept, c, v, unit = "usd", extra = "") => `<${concept} contextRef="${c}" unitRef="${unit}" decimals="-6"${extra}>${v}</${concept}>`;
function instance({ periodEnd = "2026-01-25", withElement = true, eur = false } = {}) {
  const u = eur ? "eur" : "usd";
  return `<?xml version="1.0"?><xbrli:xbrl>
<dei:DocumentPeriodEndDate contextRef="d">${periodEnd}</dei:DocumentPeriodEndDate>
<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
<xbrli:unit id="eur"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>
<xbrli:unit id="usdPerShare"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
${ctx("cy", "2025-01-27", "2026-01-25")}${ctx("py", "2024-01-29", "2025-01-26")}
${ctx("cyDC", "2025-01-27", "2026-01-25", [OPS, [SEG, "x:DataCenterMember"]])}
${ctx("pyDC", "2024-01-29", "2025-01-26", [OPS, [SEG, "x:DataCenterMember"]])}
${ctx("cyDCus", "2025-01-27", "2026-01-25", [[SEG, "x:DataCenterMember"], ["srt:StatementGeographicalAxis", "country:US"]])}
${ctx("q4DC", "2025-10-27", "2026-01-25", [[SEG, "x:DataCenterMember"]])}
${ctx("cyDCprod", "2025-01-27", "2026-01-25", [[PROD, "x:DataCenterMember"]])}
${ctx("cyGame", "2025-01-27", "2026-01-25", [[SEG, "x:GamingMember"]])}
${ctx("cyNet", "2025-01-27", "2026-01-25", [[SEG, "x:NetMember"]])}${ctx("pyNet", "2024-01-29", "2025-01-26", [[SEG, "x:NetMember"]])}
${fact(REV, "cy", 200000000000, u)}
${withElement ? fact(REV, "cyDC", 150000000000, u) + fact(REV, "pyDC", 100000000000, u) : ""}
${fact("us-gaap:Revenues", "cyDC", 149000000000, u)}
${fact(REV, "cyDCus", 90000000000, u)}
${fact(REV, "q4DC", 40000000000, u)}
${fact(REV, "cyDCprod", 7000000000, u)}
${fact(REV, "cyGame", 20000000000, u)}
${fact(REV, "cyNet", 5000000000, u)}${fact("us-gaap:Revenues", "cyNet", 6000000000, u)}${fact("us-gaap:Revenues", "pyNet", 3000000000, u)}
${fact(REV, "pyDC", 0, u, ' xsi:nil="true"')}
</xbrli:xbrl>`;
}
const LAB = `<link:linkbase><link:labelLink>
<link:loc xlink:type="locator" xlink:href="x-20260125.xsd#x_DataCenterMember" xlink:label="loc_dc"/>
<link:label xlink:type="resource" xlink:label="lab_dc" xlink:role="http://www.xbrl.org/2003/role/label">Data Center [Member]</link:label>
<link:label xlink:type="resource" xlink:label="lab_dc" xlink:role="http://www.xbrl.org/2003/role/terseLabel">Data Center</link:label>
<link:labelArc xlink:type="arc" xlink:from="loc_dc" xlink:to="lab_dc"/>
<link:loc xlink:type="locator" xlink:href="x-20260125.xsd#x_CMBUMember" xlink:label="loc_cm"/>
<link:label xlink:type="resource" xlink:label="lab_cm" xlink:role="http://www.xbrl.org/2003/role/label">CMBU [Member]</link:label>
<link:labelArc xlink:type="arc" xlink:from="loc_cm" xlink:to="lab_cm"/>
</link:labelLink></link:linkbase>`;

function fakeSec({ accession, inst, lab = LAB, doc = "<p>Our Cloud Memory Business Unit (&#8220;CMBU&#8221;) serves hyperscalers.</p>" }) {
  const hits = [];
  const f = {
    json: async (u) => {
      hits.push(u);
      if (u.includes("/submissions/")) return { filings: { recent: { form: ["8-K", "10-K/A", "10-K", "10-K"], accessionNumber: ["a-8k", "a-amend", accession, "old"], filingDate: ["2026-03-01", "2026-02-20", "2026-02-15", "2025-02-15"], primaryDocument: ["e.htm", "a.htm", "x.htm", "o.htm"], reportDate: ["", "2026-01-25", "2026-01-25", "2025-01-26"] } } };
      if (u.endsWith("index.json")) return { directory: { item: [{ name: "x-20260125_htm.xml" }, { name: "x-20260125_lab.xml" }, { name: "x-20260125.xsd" }, { name: "x.htm" }] } };
      return null;
    },
    text: async (u) => {
      hits.push(u);
      if (u.endsWith("_htm.xml")) return inst;
      if (u.endsWith("_lab.xml")) return lab;
      if (u.endsWith("x.htm")) return doc;
      return null;
    },
  };
  return { f, hits };
}
const ENTRY = { id: "x-dc", ticker: "XX", cik: 1, group: "chips", axis: "segment", element: "x:DataCenterMember", filedLabel: "Data Center", subLabel: null, broad: false, hyperscaler: false, probeAccession: null };
const OPTS = { now: 1, maxFilings: 10, budgetMs: 60_000 };

async function suite({ X, C }, data) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // 1. the line reader
  const line = X.readMemberLine(instance(), "x:DataCenterMember", "segment", "2026-01-25");
  ok("the segment line is the fiscal-year fact beside ConsolidationItemsAxis", line?.current === 150e9 && line?.prior === 100e9, JSON.stringify(line));
  ok("current and prior come from ONE concept (the one carrying both years)", line?.concept === REV, line?.concept);
  const net = X.readMemberLine(instance(), "x:NetMember", "segment", "2026-01-25");
  ok("when only the second concept carries both years, both years come from it", net?.concept === "us-gaap:Revenues" && net?.current === 6e9 && net?.prior === 3e9, JSON.stringify(net));
  ok("the product-axis fact of the same member is a different line", X.readMemberLine(instance(), "x:DataCenterMember", "product", "2026-01-25")?.current === 7e9);
  ok("a 53-week year ending two days off the period end still counts",
    X.readMemberLine(instance(), "x:DataCenterMember", "segment", "2026-01-27")?.current === 150e9);
  ok("a year ending 3 weeks off the period end does not", X.readMemberLine(instance(), "x:DataCenterMember", "segment", "2026-02-20") === null);
  ok("the currency is the filed one (EUR stays EUR)", X.readMemberLine(instance({ eur: true }), "x:DataCenterMember", "segment", "2026-01-25")?.currency === "EUR");
  ok("an absent element is null, not a neighbour", X.readMemberLine(instance({ withElement: false }), "x:DataCenterMember", "segment", "2026-01-25")?.current === 149e9 &&
    X.readMemberLine(instance(), "x:NetworkingMember", "segment", "2026-01-25") === null);
  ok("discovery lists the segment members", X.listMembers(instance(), "segment", "2026-01-25").sort().join() === "x:DataCenterMember,x:GamingMember,x:NetMember");
  ok("% change needs a positive prior", X.percentChange(150, 100) === 50 && X.percentChange(1, 0) === null && X.percentChange(1, null) === null);

  // 2. labels and sub-labels
  const labels = X.parseLabels(LAB);
  ok("the terse label wins and [Member] is dropped", labels.get("DataCenterMember") === "Data Center" && labels.get("CMBUMember") === "CMBU", JSON.stringify([...labels]));
  ok("an element-sourced sub-label is found in the element name",
    X.subLabelVerified({ text: "Datacenter and AI", source: "element" }, "intc:DatacenterAndAIMember", null));
  ok("an element-sourced sub-label NOT in the element name is refused",
    !X.subLabelVerified({ text: "Data Centre and AI", source: "element" }, "intc:DatacenterAndAIMember", null));
  ok("a filing-text sub-label is found through entities and '&'",
    X.subLabelVerified({ text: "Connectivity & Cloud Solutions", source: "filing-text" }, "cls:CCSSegmentMember", "<p>Connectivity &amp; Cloud Solutions (&#8220;CCS&#8221;)</p>"));
  ok("a filing-text sub-label with no document is refused", !X.subLabelVerified({ text: "Cloud Memory Business Unit", source: "filing-text" }, "mu:CMBUMember", null));
  ok("the latest annual skips 8-Ks and amendments", X.latestAnnual({ filings: { recent: { form: ["8-K", "10-K/A", "10-K"], accessionNumber: ["a", "b", "c"], filingDate: ["", "", ""], primaryDocument: ["", "", ""], reportDate: ["", "", ""] } } })?.accession === "c");

  // 3. the refresh
  const s1 = fakeSec({ accession: "acc-2026", inst: instance() });
  const r1 = await C.refreshReceivers([ENTRY], null, s1.f, OPTS);
  const row = r1.record.rows["x-dc"];
  ok("a first run reads the filing", row?.accession === "acc-2026" && row?.changePct === 50 && row?.labelInFiling === "Data Center" && r1.changed, JSON.stringify(row));
  ok("no flags when element and label match", r1.record.flags.length === 0, JSON.stringify(r1.record.flags));

  const s2 = fakeSec({ accession: "acc-2026", inst: instance() });
  const r2 = await C.refreshReceivers([ENTRY], r1.record, s2.f, OPTS);
  ok("an unchanged accession costs ONE request and writes nothing", s2.hits.length === 1 && !r2.changed, `${s2.hits.length} requests, changed ${r2.changed}`);

  const s3 = fakeSec({ accession: "acc-2027", inst: instance({ withElement: false }).replace(/x:DataCenterMember/g, "x:DataCentreMember") });
  const r3 = await C.refreshReceivers([ENTRY], r1.record, s3.f, OPTS);
  const stale = r3.record.rows["x-dc"];
  ok("a dropped element keeps the old figures, marked stale", stale?.current === 150e9 && stale?.accession === "acc-2026" && stale?.staleSince === "acc-2027", JSON.stringify(stale));
  ok("…and is flagged, not guessed", r3.record.flags.some((f) => f.kind === "element-missing"), JSON.stringify(r3.record.flags));

  const s4 = fakeSec({ accession: "acc-2027", inst: instance(), lab: LAB.replace(">Data Center<", ">Data Center Compute<") });
  const r4 = await C.refreshReceivers([ENTRY], r1.record, s4.f, OPTS);
  ok("a changed label keeps the new figures and flags the rename", r4.record.rows["x-dc"]?.accession === "acc-2027" && r4.record.flags.some((f) => f.kind === "label-changed"), JSON.stringify(r4.record.flags));

  const mu = { ...ENTRY, id: "x-cm", element: "x:CMBUMember", filedLabel: "CMBU", subLabel: { text: "Cloud Memory Business Unit", source: "filing-text" } };
  const inst5 = instance().replace(/x:DataCenterMember/g, "x:CMBUMember");
  const s5 = fakeSec({ accession: "acc-2026", inst: inst5 });
  const r5 = await C.refreshReceivers([mu], null, s5.f, OPTS);
  ok("a filing-text sub-label is verified against the filing document", r5.record.rows["x-cm"]?.subLabelOk === true && s5.hits.some((u) => u.endsWith("x.htm")));
  const s6 = fakeSec({ accession: "acc-2026", inst: inst5, doc: "<p>Our memory unit.</p>" });
  const r6 = await C.refreshReceivers([mu], null, s6.f, OPTS);
  ok("…and refused (flagged, not shown) when the text is not there", r6.record.rows["x-cm"]?.subLabelOk === false && r6.record.flags.some((f) => f.kind === "sub-label-unverified"));

  const two = [ENTRY, { ...ENTRY, id: "y-dc", cik: 2 }];
  const s7 = fakeSec({ accession: "acc-2026", inst: instance() });
  const r7 = await C.refreshReceivers(two, null, s7.f, { ...OPTS, maxFilings: 1 });
  ok("the per-run filing cap defers the rest to the next day", r7.stats.filingsRead === 1 && r7.stats.deferred === 1, JSON.stringify(r7.stats));

  // 4. the curated list (COWORK #2)
  const rows = data.rows;
  const ids = new Set(rows.map((r) => r.id));
  ok("45 lines: the 44 plus HPE Networking", rows.length === 45 && ids.size === 45 && ids.has("hpe-networking") && ids.has("hpe-server"));
  ok("MSFT has one line only (Server Products left out)", rows.filter((r) => r.ticker === "MSFT").length === 1);
  const heads = data.groups.map((g) => g.heading).join("|");
  ok("the seven headings, as ruled", heads === "Chips|Chip-making equipment|Memory & storage|Networking & optics|Servers & assembly|Power & cooling|Cloud & data centres", heads);
  ok("every line sits under one of them", rows.every((r) => data.groups.some((g) => g.id === r.group)));
  const BROAD = "amat amkr avgo dlr eqix etn fix gev hpe-networking hubb ibm klac lrcx nvt pwr ter";
  ok("the 15 broad lines plus HPE Networking carry the tag", rows.filter((r) => r.broad).map((r) => r.id).sort().join(" ") === BROAD, rows.filter((r) => r.broad).map((r) => r.id).sort().join(" "));
  ok("the hyperscaler note sits on MSFT, AMZN, GOOGL, ORCL", rows.filter((r) => r.hyperscaler).map((r) => r.ticker).sort().join() === "AMZN,GOOGL,MSFT,ORCL");
  const subs = rows.filter((r) => r.subLabel).map((r) => `${r.ticker}:${r.subLabel.source}`).sort().join();
  ok("four sub-labels, each with its source", subs === "CLS:filing-text,FLEX:element,INTC:element,MU:filing-text", subs);
  ok("every element-sourced sub-label is in its element name", rows.filter((r) => r.subLabel?.source === "element").every((r) => X.subLabelVerified(r.subLabel, r.element, null)));
  ok("axes are segment or product only", rows.every((r) => r.axis === "segment" || r.axis === "product"));
  return fails;
}

const xbrlSrc = read(XBRL);
const coreSrc = read(CORE);
const data = JSON.parse(read("data/capex/receivers.json"));
const base = await suite(await load(xbrlSrc, coreSrc), data);
if (base.length) {
  console.error("FAIL check-capex-receivers:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return src.replace(from, () => to);
};
const MUTANTS = [
  ["ConsolidationItemsAxis no longer neutral", () => [mut("neutral", xbrlSrc, `new Set(["srt:ConsolidationItemsAxis"])`, `new Set([])`), coreSrc]],
  ["the 53-week tolerance removed", () => [mut("week", xbrlSrc, `if (Math.abs(gap) <= 7) slot.cy`, `if (gap === 0) slot.cy`), coreSrc]],
  ["a crossed geography accepted", () => [mut("cross", xbrlSrc, `if (dims.length !== 1 || !axes.has(dims[0][0])`, `if (!dims.length || !axes.has(dims[0][0])`), coreSrc]],
  ["concepts mixed across years", () => [mut("concept", xbrlSrc, `const both = order.find((c) => byConcept.get(c)?.cy && byConcept.get(c)?.py);`, `const both = undefined;`), coreSrc]],
  ["the standard label preferred", () => [mut("terse", xbrlSrc, `pick("/terseLabel") ?? pick("/label")`, `pick("/label") ?? pick("/terseLabel")`), coreSrc]],
  ["element sub-labels always accepted", () => [mut("sub", xbrlSrc, `if (sub.source === "element") return foldForMatch(localName(element).replace(/Member$/, "")).includes(want);`, `if (sub.source === "element") return true;`), coreSrc]],
  ["an unchanged accession re-reads the filing", () => [xbrlSrc, mut("skip", coreSrc, `if (current && !opts.force) { keepFlags(); continue; }`, ``)]],
  ["a dropped element blanks the row", () => [xbrlSrc, mut("stale", coreSrc, `rows[e.id] = { ...old, staleSince: filing.accession };`, `delete rows[e.id];`)]],
  ["label renames not flagged", () => [xbrlSrc, mut("rename", coreSrc, `if (labelInFiling !== null && labelInFiling !== e.filedLabel) {`, `if (false) {`)]],
];
let survived = 0;
for (const [label, make] of MUTANTS) {
  const [x, c] = make();
  const fails = await suite(await load(x, c), data);
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-capex-receivers: all assertions pass; ${MUTANTS.length} mutants caught`);
