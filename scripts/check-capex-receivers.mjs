// The "who is receiving" lines on /bottlenecks/capex (#563).
//
// What this pins, and the mutation each assertion is shown to catch:
//   1. The committed list is the one Cowork approved (COWORK #2): 45 lines,
//      the fixed group headings, the 15 broad lines, the four hyperscalers.
//   2. The extractor reads ONE member on ONE axis for a ~1-year period, sets
//      aside only srt:ConsolidationItemsAxis, and reads the unit's currency.
//   3. A newer filing that drops or relabels the curated member is FLAGGED and
//      the last good reading kept — never substituted.
//   4. Nothing on the page adds one company's line to another's.
//   5. The job is registered, gated, and writes nothing on dryRun.
//
//   node scripts/check-capex-receivers.mjs
import fs from "node:fs";
import { liftCapexParsers } from "./lib/capex-lift.mjs";
import { lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
/** A mutation must make its assertion fail; one that passes proves nothing. */
const caught = (label, assertion) => {
  let failed;
  try {
    failed = !assertion();
  } catch {
    failed = true;
  }
  check(`mutation caught: ${label}`, failed);
};

// ── 1. The approved list ──────────────────────────────────────────────────
console.log("\n1. The committed list is the approved one");
const file = JSON.parse(fs.readFileSync("data/capex/receivers.json", "utf8"));
const GROUPS = [
  "Chips", "Chip-making equipment", "Memory & storage", "Networking & optics",
  "Servers & assembly", "Power & cooling", "Cloud & data centres",
];
const BROAD = ["AVGO", "AMAT", "KLAC", "LRCX", "TER", "AMKR", "ETN", "GEV", "PWR", "FIX", "HUBB", "NVT", "IBM", "EQIX", "DLR"];
const SPENDERS = ["MSFT", "AMZN", "GOOGL", "ORCL"];
const listOk = (entries) =>
  entries.length === 45 &&
  new Set(entries.map((e) => `${e.ticker}|${e.element}`)).size === 45 &&
  entries.filter((e) => e.ticker === "HPE").length === 2 &&
  entries.filter((e) => e.ticker === "MSFT").length === 1 &&
  entries.every((e) => GROUPS.includes(e.group)) &&
  entries.every((e) => e.axis === "segment" || e.axis === "product");
const broadOk = (entries) =>
  JSON.stringify([...new Set(entries.filter((e) => e.broad).map((e) => e.ticker))].sort()) === JSON.stringify([...BROAD].sort());
const spenderOk = (entries) =>
  JSON.stringify(entries.filter((e) => e.alsoSpender).map((e) => e.ticker).sort()) === JSON.stringify([...SPENDERS].sort()) &&
  entries.filter((e) => e.alsoSpender).every((e) => e.group === "Cloud & data centres");
const provenanceOk = (entries) =>
  entries.every(
    (e) =>
      /^\d{10}-\d{2}-\d{6}$/.test(e.baseline.accession) &&
      /^\d{4}-\d{2}-\d{2}$/.test(e.baseline.fyEnd) &&
      /^[A-Z]{3}$/.test(e.baseline.currency) &&
      Number.isFinite(e.baseline.value) &&
      (e.baseline.filedLabel === null || e.baseline.filedLabel === e.label) &&
      (e.subLabel === null || (["filing text", "element name"].includes(e.subLabel.source) && e.subLabel.text.length > 2))
  );
const e0 = file.entries;
check("45 lines: the 44 approved plus HPE Networking; one MSFT line; known groups and axes", listOk(e0));
check("the 15 broad lines, exactly", broadOk(e0));
check("the four hyperscalers carry the also-spender note, in Cloud & data centres", spenderOk(e0));
check("every line carries its accession, fiscal year, currency and the filed label it shows", provenanceOk(e0));
check("a sub-label appears only on an acronym label", e0.every((e) => (e.subLabel === null) || /^[A-Z]{2,6}$/.test(e.label)));
caught("a 46th line (MSFT Server Products, ruled out)", () =>
  listOk([...e0, { ...e0.find((e) => e.ticker === "MSFT"), element: "msft:ServerProductsAndCloudServicesMember" }]));
caught("a broad tag dropped from AVGO", () => broadOk(e0.map((e) => (e.ticker === "AVGO" ? { ...e, broad: false } : e))));
caught("a label that is not the filed one", () => provenanceOk(e0.map((e, i) => (i === 0 ? { ...e, label: "AI chips" } : e))));

// ── 2. The extractor ──────────────────────────────────────────────────────
console.log("\n2. One member, one axis, one fiscal year");
const P = await liftCapexParsers();
const ctx = (id, start, end, dims = []) =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>` +
  (dims.length ? `<xbrli:segment>${dims.map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join("")}</xbrli:segment>` : "") +
  `</xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
const SEG = "us-gaap:StatementBusinessSegmentsAxis";
const CONS = ["srt:ConsolidationItemsAxis", "us-gaap:OperatingSegmentsMember"];
const fact = (c, v, u = "usd") =>
  `<us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="${c}" unitRef="${u}" decimals="-6">${v}</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>`;
const FIXTURE = [
  `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>`,
  `<xbrli:unit id="eur"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>`,
  ctx("fy", "2025-01-01", "2025-12-31", [[SEG, "x:CloudMember"], CONS]),
  ctx("py", "2024-01-01", "2024-12-31", [[SEG, "x:CloudMember"], CONS]),
  ctx("q4", "2025-10-01", "2025-12-31", [[SEG, "x:CloudMember"], CONS]),
  ctx("slice", "2025-01-01", "2025-12-31", [[SEG, "x:CloudMember"], ["srt:StatementGeographicalAxis", "country:US"]]),
  ctx("other", "2025-01-01", "2025-12-31", [[SEG, "x:DevicesMember"]]),
  ctx("total", "2025-01-01", "2025-12-31"),
  fact("q4", 40), fact("slice", 70), fact("other", 500), fact("total", 900), fact("fy", 120), fact("py", 100),
].join("\n");
const readOk = (fn) => {
  const r = fn(FIXTURE, "x:CloudMember", "segment");
  return r && r.value === 120 && r.prior === 100 && r.fyEnd === "2025-12-31" && r.currency === "USD";
};
check("reads 120 against 100 for FY2025, ignoring the quarter, the US slice, another member and the total", readOk(P.extractMemberRevenue));
check("reads the currency from the unit",
  P.extractMemberRevenue(FIXTURE.replace(/unitRef="usd"/g, 'unitRef="eur"'), "x:CloudMember", "segment")?.currency === "EUR");
check("the product axis does not answer for a segment member",
  P.extractMemberRevenue(FIXTURE, "x:CloudMember", "product") === null);
check("a member the filing does not carry reads as null, not zero",
  P.extractMemberRevenue(FIXTURE, "x:GoneMember", "segment") === null);
check("% change is null when there is no prior year", P.changeFraction({ value: 5, prior: 0 }) === null && Math.abs(P.changeFraction({ value: 120, prior: 100 }) - 0.2) < 1e-9);

const src = fs.readFileSync("lib/server/capexReceivers.ts", "utf8");
const liftMutated = async (from, to) => {
  const m = src.replace(from, to);
  if (m === src) throw new Error(`mutation target not found: ${from}`);
  const start = m.indexOf("// ── XBRL parsing");
  const end = m.indexOf("// ── The refresh");
  return lift(`${m.slice(m.indexOf("export type ReceiverGroup"), start)}\n${m.slice(start, end)}`, "", "mutant");
};
{
  const noCons = await liftMutated('.filter(([ax]) => ax !== "srt:ConsolidationItemsAxis")', "");
  caught("the consolidation axis no longer set aside", () => readOk(noCons.extractMemberRevenue));
  const anyDims = await liftMutated("if (dims.length !== 1) continue;", "if (!dims.length) continue;");
  caught("a fact with an extra axis (a region) accepted as the line", () =>
    anyDims.extractMemberRevenue(FIXTURE.replace(fact("fy", 120), ""), "x:CloudMember", "segment") === null);
  const anyDuration = await liftMutated("if (days < 340 || days > 380) continue;", "");
  caught("a quarter accepted as a fiscal year", () =>
    anyDuration.extractMemberRevenue(FIXTURE.replace(fact("fy", 120), "").replace(fact("py", 100), ""), "x:CloudMember", "segment") === null);
}

console.log("\n   The filed label");
const LAB =
  `<link:loc xlink:type="locator" xlink:href="x.xsd#x_CloudMember" xlink:label="loc1"/>` +
  `<link:label xlink:type="resource" xlink:label="lab1" xlink:role="http://www.xbrl.org/2003/role/label">Cloud [Member]</link:label>` +
  `<link:label xlink:type="resource" xlink:label="lab1" xlink:role="http://www.xbrl.org/2003/role/terseLabel">Cloud &amp; AI</link:label>` +
  `<link:labelArc xlink:type="arc" xlink:from="loc1" xlink:to="lab1"/>`;
check("prefers the terse label and decodes entities", P.parseLabelLinkbase(LAB).get("CloudMember") === "Cloud & AI");
check("drops the [Member] suffix from a standard label",
  P.parseLabelLinkbase(LAB.replace(/<link:label[^>]*terseLabel[^<]*<\/link:label>/, "")).get("CloudMember") === "Cloud");

// ── 3. A rename is flagged, never guessed ──────────────────────────────────
console.log("\n3. A newer filing without the curated member keeps the last reading and flags it");
const refreshSrc = src.slice(src.indexOf("// ── The refresh"))
  .replace(/const redis =[\s\S]*?: null;/, "const redis = null;");
const typesSrc = src.slice(src.indexOf("export const CAPEX_RECEIVERS_REDIS_KEY"), src.indexOf("// ── The refresh"));
const refreshMod = async (s) =>
  lift(`${typesSrc}\n${s}`, "const Redis = null; const PAGE_READ_CACHE = {};", "refresh");
const newer = { accession: "0000000001-26-000001", form: "10-K", filed: "2026-09-01" };
const stubFetch = (instance, label) => async (url) => {
  const body = url.includes("submissions")
    ? JSON.stringify({ filings: { recent: { form: ["10-K"], accessionNumber: [newer.accession], filingDate: [newer.filed] } } })
    : url.endsWith("index.json")
      ? JSON.stringify({ directory: { item: [{ name: "x-20251231_htm.xml" }, { name: "x-20251231_lab.xml" }] } })
      : url.endsWith("_lab.xml") ? label : instance;
  return new Response(body, { status: 200 });
};
const entry = {
  ticker: "XCO", cik: "1", group: "Chips", axis: "segment", element: "x:CloudMember", label: "Cloud",
  subLabel: null, broad: false, alsoSpender: false,
  baseline: { accession: "0000000001-25-000001", form: "10-K", filed: "2025-09-01", fyEnd: "2024-12-31", currency: "USD", value: 100, prior: 80, filedLabel: "Cloud" },
};
const runRefresh = async (mod, instance, label) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = stubFetch(instance, label);
  try {
    return (await mod.refreshReceivers([entry], null, "ua", new Date("2026-09-24T06:00:00Z"), 5)).doc.lines[0];
  } finally {
    globalThis.fetch = realFetch;
  }
};
{
  const mod = await refreshMod(refreshSrc);
  const moved = await runRefresh(mod, FIXTURE, LAB);
  check("a newer filing is read", moved.reading.accession === newer.accession && moved.reading.value === 120 && moved.flags.length === 1 && moved.flags[0] === "label-changed",
    `flags ${JSON.stringify(moved.flags)} — the fixture's terse label "Cloud & AI" differs from the reviewed "Cloud"`);
  const renamed = FIXTURE.replace(/x:CloudMember/g, "x:CloudAndAIMember");
  const kept = await runRefresh(mod, renamed, LAB);
  const keptOk = (l) => l.reading.accession === entry.baseline.accession && l.reading.value === 100 && l.flags.includes("element-missing");
  check("the member renamed in the newer filing: last reading kept, flagged element-missing", keptOk(kept));
  const substitutes = await refreshMod(
    refreshSrc.replace(
      "const next = await readLineFromFiling(entry, latest, ua);",
      "const next = (await readLineFromFiling(entry, latest, ua)) ?? (await readLineFromFiling({ ...entry, element: 'x:CloudAndAIMember' }, latest, ua));"
    )
  );
  const guessed = await runRefresh(substitutes, renamed, LAB);
  caught("the job guesses the renamed member instead of flagging", () => keptOk(guessed));
}

// ── 4. No sums across companies ────────────────────────────────────────────
console.log("\n4. Nothing adds one company's line to another's");
const panel = readCodeOnly("app/bottlenecks/capex/ReceiversPanel.tsx");
const page = readCodeOnly("app/bottlenecks/capex/page.tsx");
const noSums = (code) => !/\.reduce\s*\(/.test(code) && !/\btotal\w*\s*[+=]/i.test(code) && !/sum\s*\(/i.test(code);
check("the panel and the page contain no reduce, running total or sum", noSums(panel) && noSums(page));
caught("a group total added to the panel", () => noSums(panel + "\nconst groupTotal = inGroup.reduce((a, r) => a + r.reading.value, 0);"));
check("the bar is the % change, not the amount", /changeFraction\(row\.reading\)/.test(panel) && !/width:\s*`\$\{[^}]*reading\.value/.test(panel));
check("the broad tag and the also-spender note are rendered",
  /Broad line: includes non-data-centre sales/.test(panel) && /this is what they sell, not what\s+they buy/.test(panel));

// ── 5. The job ─────────────────────────────────────────────────────────────
console.log("\n5. The job is registered, gated, and dryRun writes nothing");
const route = readCodeOnly("app/api/jobs/capex-receivers/route.ts");
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const cron = vercel.crons.find((c) => c.path === "/api/jobs/capex-receivers");
const jobs = fs.readFileSync("lib/server/jobRuns.ts", "utf8");
check("scheduled in vercel.json and registered in JOBS with the same cron",
  Boolean(cron) && jobs.split("\n").some((l) => l.includes('"capex-receivers":') && l.includes(`cron: "${cron?.schedule}"`)));
check("records its run", /recordJobRun\("capex-receivers"/.test(route));
check("gated: CRON_SECRET bearer, else the debug key guard", /Bearer \$\{secret\}/.test(route) && /guardDebugRequest\(req\)/.test(route));
const dryOk = (code) => /dryRun\s*\?\s*\{[^}]*nothing written[^}]*\}\s*:\s*await writeStoredReceivers/.test(code);
check("dryRun=1 skips the write", dryOk(route));
caught("dryRun that still writes", () => dryOk(route.replace(/dryRun\s*\?\s*\{[^}]*\}\s*:\s*/, "")));

console.log(failures ? `\n${failures} FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
