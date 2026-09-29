// THE CENSUS ROWS: NON-COMMON LISTINGS ON A COMMON FILER'S CIK (#552 COWORK #64).
//   1. every row is cited and belongs where it says: a 12(b) class that is
//      notes, debentures, preferred, warrants, rights or units (never a common
//      class); its ticker and its primary on the SAME CIK; no overlap with the
//      hand-cited primary-listings.json. MUTATION: a common row injected.
//   2. nonEquityListingOf reads them after the hand-cited entries, and the
//      valuation refuses cap and P/E, naming the common listing. MUTATION: the
//      census lookup removed.
//
//   node scripts/check-non-common-listings.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const NC = JSON.parse(fs.readFileSync("data/sec/non-common-listings.json", "utf8")).entries;
const PL = JSON.parse(fs.readFileSync("data/sec/primary-listings.json", "utf8")).entries;
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const TICKERS = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8")).data;
const cikOf = new Map();
for (const [cik, , tk] of TICKERS) if (!cikOf.has(tk)) cikOf.set(tk, String(cik).padStart(10, "0"));
const handTickers = new Set(Object.values(PL).flatMap((e) => [e.primary, ...Object.keys(e.nonEquity ?? {})]));

console.log("\n1. every census row is cited and non-common");
const NON = /\bnotes?\b|debentures?|\bbonds?\b|preferred|preference|warrants?\b|\brights?\b|\bunits?\b|capital securities/i;
const COMMON_CLASS = /^(?:class [a-c] )?(?:common|ordinary) (?:stock|shares?)\b/i;
const rowOk = (tk, r) => Boolean(r && r.cls && r.primary)
  && /^\d{10}-\d{2}-\d{6}$/.test(r.source) && /^\d{4}-\d{2}-\d{2}$/.test(r.filed) && /^(10-K|10-KT|20-F|40-F)$/.test(r.form)
  && NON.test(r.cls) && !COMMON_CLASS.test(r.cls)
  && cikOf.get(tk) === r.cik && cikOf.get(r.primary) === r.cik
  && (!REG[tk] || String(REG[tk].cik).padStart(10, "0") === r.cik)
  && tk !== r.primary && !(r.primary in NC) && !handTickers.has(tk);
const bad = Object.entries(NC).filter(([tk, r]) => !rowOk(tk, r)).map(([tk]) => tk);
check(`all ${Object.keys(NC).length} rows: a non-common 12(b) class, cited, on the same CIK as their common listing, not hand-mapped`, bad.length === 0, bad.join(", "));
check("STRK is 'Series A Perpetual Strike Preferred Stock' under MSTR; TBB is AT&T's notes under T",
  /Strike Preferred/.test(NC.STRK?.cls ?? "") && NC.STRK.primary === "MSTR" && /Global Notes/.test(NC.TBB?.cls ?? "") && NC.TBB.primary === "T");
check("MUTATION: a common class injected ('MSTR: Class A common stock') → caught",
  !rowOk("MSTR", { ...NC.STRK, cls: "Class A common stock, par value $0.001 per share", primary: "STRK" }));
check("MUTATION: a primary on another CIK (STRK under AAPL) → caught", !rowOk("STRK", { ...NC.STRK, primary: "AAPL" }));

console.log("\n2. the lookup and the refusal");
const PSRC = fs.readFileSync("lib/server/secPrimaryListing.ts", "utf8");
const I1 = 'import listingsFile from "@/data/sec/primary-listings.json";';
const I2 = 'import nonCommonFile from "@/data/sec/non-common-listings.json";';
if (!PSRC.includes(I1) || !PSRC.includes(I2)) throw new Error("secPrimaryListing no longer imports its maps the expected way");
const load = async (src) => {
  const tmp = `lib/server/.check-ncl-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, src.replace(I1, `const listingsFile = ${fs.readFileSync("data/sec/primary-listings.json", "utf8")};`)
    .replace(I2, `const nonCommonFile = ${fs.readFileSync("data/sec/non-common-listings.json", "utf8")};`));
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
};
const P = await load(PSRC);
const strk = P.nonEquityListingOf("STRK");
check("STRK → its preferred class and MSTR; MSTR itself is not non-common", strk?.primary === "MSTR" && /Preferred/.test(strk.cls) && P.nonEquityListingOf("MSTR") === null, JSON.stringify(strk));
check("hand-cited entries still answer first (SOMN → SO's Corporate Units)", P.nonEquityListingOf("SOMN")?.cls === "2025 Series A Corporate Units");
check("an unlisted ticker and a prototype key are not rows", P.nonEquityListingOf("AAPL") === null && P.nonEquityListingOf("CONSTRUCTOR") === null && P.nonEquityListingOf("__PROTO__") === null);
const V = await import("../lib/server/secValuation.ts");
const set = { symbol: "STRK", quarters: [], years: [], instants: [], cover: { asOf: "2026-06-30", accession: null, filed: null, val: 1e8, derived: "as-filed" }, cur: "USD" };
const inp = V.valuationInputs(set, "2026-09-28", { annualForm: "10-K", nonEquity: strk });
check("STRK: cap and P/E refused, naming MSTR as the common stock",
  V.marketCap(inp, 100)?.why === "ticker-is-a-debt-security" && /not its common stock; the common stock trades as MSTR/.test(V.peRatio(inp, 100)?.detail ?? ""), V.peRatio(inp, 100)?.detail);
const ANCHOR = "  return c ? { cls: c.cls, primary: c.primary } : null;";
if (PSRC.split(ANCHOR).length !== 2) throw new Error("census-lookup mutation anchor must match once");
const M = await load(PSRC.replace(ANCHOR, "  void c; return null;"));
check("MUTATION: the census lookup removed → STRK valued as common again (caught)", M.nonEquityListingOf("STRK") === null);

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
