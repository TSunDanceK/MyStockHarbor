// A MULTI-CLASS FILER'S COVER COUNT, FROM ITS OWN FILING (#552 COWORK #31).
//
//   1. parseCoverClasses: per-class dei:EntityCommonStockSharesOutstanding on
//      the StatementClassOfStockAxis ALONE; a fact on another axis (SPG's
//      LegalEntityAxis row) or with no dimension is left out.
//   2. coverFromClasses: the newest cover date only; weights applied (BRK: a
//      Class A share = 1,500 Class B); a class the cited entry does not name
//      REFUSES; a missing listed class refuses. MUTATIONS: the unknown-class
//      refusal removed (a class would be dropped and the cap understated);
//      the weights ignored (BRK.A counted as one B share).
//   3. Every companyfacts reader applies it after extracting (cold fetch, the
//      sec-facts cron, the sec-filings job). MUTATION: one reader unwired.
//   4. The committed map: every entry names its listed class among its
//      weights, cites evidence, and uses positive weights.
//
//   node scripts/check-sec-cover-classes.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const SRC = readCodeOnly("lib/server/secCoverClasses.ts");
const load = (src) => lift([grabFunction(src, "parseCoverClasses"), grabFunction(src, "coverFromClasses"),
  "export { parseCoverClasses, coverFromClasses };"].join("\n"));
const M = await load(SRC);

const ctx = (id, date, dims) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>${dims.length
  ? `<xbrli:segment>${dims.map(([d, m]) => `<xbrldi:explicitMember dimension="${d}">${m}</xbrldi:explicitMember>`).join("")}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period></xbrli:context>`;
const fact = (id, v) => `<dei:EntityCommonStockSharesOutstanding contextRef="${id}" unitRef="shares" decimals="INF">${v}</dei:EntityCommonStockSharesOutstanding>`;
const AX = "us-gaap:StatementClassOfStockAxis";
// BRK-shaped: two dates (an older cover must not be summed in), A and B, plus
// an operating-partnership row on another axis and an undimensioned fact.
const XML = [
  ctx("a", "2026-07-29", [[AX, "us-gaap:CommonClassAMember"]]), ctx("b", "2026-07-29", [[AX, "us-gaap:CommonClassBMember"]]),
  ctx("old", "2026-04-20", [[AX, "us-gaap:CommonClassBMember"]]),
  ctx("lp", "2026-07-29", [["dei:LegalEntityAxis", "brk:OperatingPartnershipMember"]]),
  ctx("any", "2026-07-29", []),
  fact("a", "488450"), fact("b", "1408035161"), fact("old", "1400000000"), fact("lp", "0"), fact("any", "999"),
].join("\n");

console.log("1. parseCoverClasses");
const facts = M.parseCoverClasses(XML);
check("class-axis facts only (A, B and the older B); the LegalEntityAxis and undimensioned facts are left out",
  facts.length === 3 && facts.every((f) => /^CommonClass[AB]Member$/.test(f.member)), JSON.stringify(facts));

console.log("\n2. coverFromClasses");
const BRK = { listed: "CommonClassBMember", weights: { CommonClassAMember: 1500, CommonClassBMember: 1 }, evidence: ["x"], source: "y" };
const brk = M.coverFromClasses(facts, BRK, { accession: "0001193125-26-341032", filed: "2026-08-10" });
check("BRK.B: 488,450 A × 1,500 + 1,408,035,161 B on the newest date (2026-07-29), as computed",
  brk.ok && brk.cover.val === 488450 * 1500 + 1408035161 && brk.cover.asOf === "2026-07-29" && brk.cover.derived === "computed", JSON.stringify(brk));
const onlyA = { listed: "CommonClassBMember", weights: { CommonClassBMember: 1 }, evidence: ["x"], source: "y" };
check("a class on the cover that the entry does not name REFUSES", !M.coverFromClasses(facts, onlyA, {}).ok);
check("the listed class missing from the cover refuses",
  !M.coverFromClasses(facts, { listed: "CommonClassCMember", weights: { CommonClassAMember: 1500, CommonClassBMember: 1, CommonClassCMember: 1 }, evidence: ["x"], source: "y" }, {}).ok);
check("no per-class facts refuses", !M.coverFromClasses([], BRK, {}).ok);
{
  const Mm = await load(once(SRC, "if (unknown.length) return", "if (false) return"));
  check("MUTATION: unknown-class refusal removed → a class is silently dropped", Mm.coverFromClasses(facts, onlyA, {}).ok === true);
  const Mw = await load(once(SRC, "a + f.val * (entry.weights[f.member] ?? 0)", "a + f.val"));
  const w = Mw.coverFromClasses(facts, BRK, {});
  check("MUTATION: weights ignored → BRK.A counted as one B share", w.ok && w.cover.val !== brk.cover.val);
}

console.log("\n3. every companyfacts reader applies it after extracting");
const READERS = {
  "lib/server/secColdFetch.ts": /const extracted = extractForSymbol\(symbol, facts\);\s*extracted\.coverShares = await withClassCover\(symbol, cik, extracted\.coverShares,/,
  "app/api/jobs/sec-facts/route.ts": /const extracted = extractForSymbol\(symbol, facts\);\s*extracted\.coverShares = await withClassCover\(symbol, cik, extracted\.coverShares, secGetGated\)/,
  "lib/server/secFilingJob.ts": /const base = extractForSymbol\(symbol, cf\);\s*base\.coverShares = await withClassCover\(symbol, cik, base\.coverShares, fetch\.get\)/,
};
const SRCS = Object.fromEntries(Object.keys(READERS).map((f) => [f, readCodeOnly(f)]));
const wired = (srcs) => Object.entries(READERS).every(([f, re]) => re.test(srcs[f]));
check("cold fetch, the sec-facts cron and the sec-filings job all apply it", wired(SRCS));
check("MUTATION: the cron unwired → caught", !wired({ ...SRCS,
  "app/api/jobs/sec-facts/route.ts": once(SRCS["app/api/jobs/sec-facts/route.ts"], "extracted.coverShares = await withClassCover(symbol, cik, extracted.coverShares, secGetGated);", "") }));
check("the filing fill keeps the class cover on its merged extraction",
  /coverShares: base\.coverShares/.test(SRCS["lib/server/secFilingJob.ts"]));

console.log("\n4. the committed map");
const MAP = JSON.parse(fs.readFileSync("data/sec/share-classes.json", "utf8")).entries;
check("every entry names its listed class, cites evidence and a source, and uses positive weights",
  Object.values(MAP).every((e) => e.listed in e.weights && e.evidence?.length && e.source && Object.values(e.weights).every((w) => w > 0)));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
