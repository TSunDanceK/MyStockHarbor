// The capex page's presentation rules (Relay C, #563 COWORK #2), all of which
// a reviewer would only catch by reading every row:
//   * the bar is the % change; the amount is secondary text, in the FILED
//     currency (ASML stays EUR);
//   * grouped under our headings with NO group totals and no cross-company sum;
//   * "FY to <month year>" per row, a 52/53-week year ending in the first week
//     of a month belonging to the month before;
//   * the broad-line tag, the hyperscaler note (on the cloud group only), and a
//     sub-label only once verified against the filing;
//   * a +600% line capped on the bar, never flattening every other bar;
//   * sources under each panel; no arrows or flows; noindex until Layer 1.
//
//   node scripts/check-capex-page.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PRESENT = "lib/capexPresent.ts";
const PAGE = "app/bottlenecks/capex/page.tsx";

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "lib", `.check-cxp-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const GROUPS = [
  { id: "chips", heading: "Chips" },
  { id: "chip-equipment", heading: "Chip-making equipment" },
  { id: "cloud-datacentres", heading: "Cloud & data centres" },
];
const E = (id, group, extra = {}) => ({ id, ticker: id.toUpperCase(), group, filedLabel: `${id} line`, subLabel: null, broad: false, hyperscaler: false, ...extra });
const F = (current, prior, extra = {}) => ({ fyEnd: "2025-12-31", currency: "USD", current, prior, changePct: prior && prior > 0 ? ((current - prior) / prior) * 100 : null, subLabelOk: false, staleSince: null, form: "10-K", ...extra });
const ENTRIES = [
  E("nvda", "chips"),
  E("intc", "chips", { subLabel: { text: "Datacenter and AI" } }),
  E("mu", "chips", { subLabel: { text: "Cloud Memory Business Unit" } }),
  E("asml", "chip-equipment"),
  E("amat", "chip-equipment", { broad: true }),
  E("msft", "cloud-datacentres", { hyperscaler: true }),
  E("iren", "cloud-datacentres"),
  E("apld", "cloud-datacentres"),
];
const FIGS = {
  nvda: F(193.74e9, 115.19e9, { fyEnd: "2026-01-25" }),
  intc: F(16.92e9, 16.13e9, { fyEnd: "2025-12-27", subLabelOk: true }),
  mu: F(13.52e9, 3.79e9, { fyEnd: "2025-08-28", subLabelOk: false }),
  asml: F(10.45e9, 7.86e9, { currency: "EUR" }),
  amat: F(20.8e9, 19.91e9, { fyEnd: "2025-10-26" }),
  msft: F(137.79e9, 106.27e9, { fyEnd: "2026-06-30" }),
  iren: F(0.13e9, 0.0166e9, { fyEnd: "2026-06-30" }),
  apld: F(0.39e9, 0, { fyEnd: "2026-05-31" }),
};

async function suite(P, pageCode) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  ok("FY label: a year ending mid-month is that month", P.fyToLabel("2026-01-25") === "FY to Jan 2026");
  ok("FY label: a 53-week year ending 3 Jul is June's", P.fyToLabel("2026-07-03") === "FY to Jun 2026" && P.fyToLabel("2025-11-02") === "FY to Oct 2025");
  ok("FY label: January's first week rolls back a year", P.fyToLabel("2026-01-02") === "FY to Dec 2025");
  ok("amounts in the filed currency", P.formatAmount(10.45e9, "EUR") === "EUR 10.4bn" && P.formatAmount(193.74e9, "USD") === "$194bn" && P.formatAmount(0.39e9, "USD") === "$390m", `${P.formatAmount(10.45e9, "EUR")} ${P.formatAmount(193.74e9, "USD")} ${P.formatAmount(0.39e9, "USD")}`);
  ok("no prior year reads 'New line'", P.changeText(null) === "New line" && P.changeText(68.2) === "+68%" && P.changeText(-4.6) === "−5%");

  const groups = P.buildReceiverGroups(GROUPS, ENTRIES, FIGS);
  ok("groups keep the heading order", groups.map((g) => g.heading).join("|") === "Chips|Chip-making equipment|Cloud & data centres");
  ok("a group carries NO total -- only its rows", groups.every((g) => Object.keys(g).sort().join() === "heading,hyperscalerNote,id,rows"), JSON.stringify(Object.keys(groups[0])));
  const chips = groups[0].rows;
  ok("rows sort by change, largest first", chips.map((r) => r.id).join() === "mu,nvda,intc", chips.map((r) => r.id).join());
  ok("a sub-label shows only once verified", chips.find((r) => r.id === "intc").subLabel === "Datacenter and AI" && chips.find((r) => r.id === "mu").subLabel === null);
  const asml = groups[1].rows.find((r) => r.id === "asml");
  ok("ASML shown in EUR as filed, with its % change", asml.amount === "EUR 10.4bn" && asml.changeText === "+33%", JSON.stringify(asml));
  ok("the broad tag rides through", groups[1].rows.find((r) => r.id === "amat").broad === true);
  ok("the hyperscaler note sits on the cloud group only", groups.map((g) => g.hyperscalerNote).join() === "false,false,true");
  const cloud = groups[2].rows;
  const iren = cloud.find((r) => r.id === "iren");
  ok("a +683% line is capped on the bar, text keeps the value", iren.capped && iren.barPct === 100 && iren.changeText === "+683%", JSON.stringify(iren));
  const msft = cloud.find((r) => r.id === "msft");
  ok("an uncapped line keeps its proportion", !msft.capped && Math.abs(msft.barPct - (29.66 / 150) * 100) < 0.5, String(msft.barPct));
  ok("a new line has no bar and sorts last", cloud[cloud.length - 1].id === "apld" && cloud[cloud.length - 1].barPct === 0 && cloud[cloud.length - 1].changeText === "New line");
  ok("a company with no figures yet is simply absent", P.buildReceiverGroups(GROUPS, ENTRIES, { nvda: FIGS.nvda }).length === 1);

  const c = P.buildContractRows([{ ticker: "LMT", amount: 50e9, entities: [{ name: "LOCKHEED MARTIN CORP" }, { name: "SIKORSKY" }] }, { ticker: "GD", amount: 25e9, entities: [{ name: "ELECTRIC BOAT" }] }], 15);
  ok("contract bars scale to the largest, in dollars", c[0].barPct === 100 && c[1].barPct === 50 && c[0].amount === "$50.0bn" && c[0].entityCount === 2);

  // The page.
  ok("the hyperscaler note is Cowork's wording", pageCode.includes("These companies are also among the largest spenders above; this is what they sell, not what they buy."));
  ok("the broad tag is Cowork's wording", pageCode.includes("Broad line: includes non-data-centre sales"));
  ok("each panel has a sources line", (pageCode.match(/style=\{sourceStyle\}/g) ?? []).length >= 2 && pageCode.includes("USAspending.gov") && pageCode.includes("SAM.gov") && pageCode.includes("filed with the SEC"));
  ok("no arrows or flows between panels", !/[→⟶⇒➔]|flows? (to|from)|pays? (to|whom)(?! here)/i.test(pageCode.replace("nothing here estimates who pays whom", "")));
  ok("nothing is summed on the page", !/\.reduce\(/.test(pageCode));
  ok("noindex until Layer 1", /robots:\s*\{\s*index:\s*false/.test(pageCode));
  return fails;
}

const src = read(PRESENT);
const pageCode = readCodeOnly(PAGE, { dropLines: false });
const base = await suite(await load(src), pageCode);
if (base.length) {
  console.error("FAIL check-capex-page:\n  " + base.join("\n  "));
  process.exit(1);
}
const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["the first-week roll-back removed", () => mut("fy", src, "if (d <= 7) {", "if (false) {")],
  ["a sub-label shown unverified", () => mut("sub", src, "subLabel: e.subLabel && f.subLabelOk ? e.subLabel.text : null,", "subLabel: e.subLabel ? e.subLabel.text : null,")],
  ["the bar cap removed", () => mut("cap", src, "(Math.min(Math.abs(pct), BAR_CAP_PCT) / BAR_CAP_PCT) * 100", "Math.abs(pct)")],
  ["the hyperscaler note on every group", () => mut("note", src, "hyperscalerNote: entries.some((e) => e.group === g.id && e.hyperscaler)", "hyperscalerNote: true")],
  ["a group total added", () => mut("total", src, "if (rows.length) out.push({ id: g.id, heading: g.heading,", "if (rows.length) out.push({ total: rows.length, id: g.id, heading: g.heading,")],
  ["amounts converted to dollars", () => mut("cur", src, 'const prefix = currency === "USD" ? "$" : `${currency} `;', 'const prefix = "$";')],
];
let survived = 0;
for (const [label, make] of MUTANTS) {
  const fails = await suite(await load(make()), pageCode);
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);

// ── The nav (#563 COWORK #3, N1): Bottlenecks is a drop-down, stock pages first ──
function navSuite(header, sections) {
  const fails = [];
  const i = header.indexOf('label: "Bottlenecks"');
  const block = i < 0 ? "" : header.slice(header.lastIndexOf("{", i), header.indexOf("],", i));
  const first = block.indexOf('href: "/bottlenecks"');
  const capex = block.indexOf('href: "/bottlenecks/capex"');
  if (!/kind: "dropdown"/.test(block)) fails.push("Bottlenecks is a drop-down");
  if (!(first >= 0 && capex > first)) fails.push("its entries are /bottlenecks first, then /bottlenecks/capex");
  if (/label: "Follow the Money"/.test(header)) fails.push("no separate top-level capex link");
  if (!sections.includes('{ href: "/bottlenecks/capex", label: "Capex — Follow the money" }')) fails.push("the crawlable nav lists the capex page");
  return fails;
}
const header = read("app/components/SiteHeader.tsx");
const sections = read("lib/navSections.ts");
const navFails = navSuite(header, sections);
if (navFails.length) {
  console.error("FAIL check-capex-page (nav):\n  " + navFails.join("\n  "));
  process.exit(1);
}
if (!navSuite(header.replace('kind: "dropdown",\n        label: "Bottlenecks",', 'kind: "link",\n        label: "Bottlenecks",'), sections).length) {
  console.error("MUTANT SURVIVED: Bottlenecks back to a plain link");
  process.exit(1);
}
console.log(`check-capex-page: all assertions pass; ${MUTANTS.length + 1} mutants caught`);
