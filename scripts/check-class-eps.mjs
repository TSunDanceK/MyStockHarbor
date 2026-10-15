// #552 COWORK #243/#244/#245: per-class quarterly EPS, the split proven by the
// filer's own split fact, and the split-aware EPS gate.
//   COVER   one registered security, its symbol the listed ticker, its title
//           "Class X Common Stock" -> CommonClassXMember; two securities, a
//           title with no class, or another symbol -> refused
//   NEWEST  each quarter from the newest 10-Q stating it: CVNA Q2 FY2025 is
//           $0.26 (restated in the Q2 FY2026 10-Q), not $1.28 (first filed)
//   PLAIN   a frame the filer states undimensioned is never filled per class
//   SPLIT   a filed 5-for-1 (CVNA files 0.2) plus a pre-split period whose
//           shares x5 match the post-split reference -> Q1 FY2026 $1.69 reads
//           ~$0.34, Q2 FY2025 stays $0.26; an 18:1-looking exchange ratio is
//           never a split; no corroborating period -> nothing moves
//   GATE    a closure ratio on one of the filer's split ratios does not trip it
// plus a mutation per rule.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
let seq = 0;
async function mutated(rel, from, to) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf8");
  if (src.split(from).length !== 2) throw new Error(`mutation anchor not found once: ${from.slice(0, 60)}`);
  const tmp = abs.replace(/\.ts$/, `.__mut${process.pid}_${seq++}.ts`);
  fs.writeFileSync(tmp, src.replace(from, to));
  try { return await import(pathToFileURL(tmp).href); } finally { fs.rmSync(tmp, { force: true }); }
}
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const C = await imp("lib/server/secClassEps.ts");
const SA = await imp("lib/server/secSplitAdjust.ts");
const F = await imp("lib/server/secFields.ts");
const X = await imp("lib/server/secExtract.ts");

// ── a 10-Q instance, CVNA-shaped ──
const instance = ({ symbols = ["CVNA"], title = "Class A Common Stock, Par Value $0.001 Per Share", eps = [] }) => `<xbrl>
<unit id="usdPerShare"><divide><unitNumerator><measure>iso4217:USD</measure></unitNumerator><unitDenominator><measure>xbrli:shares</measure></unitDenominator></divide></unit>
<context id="cover"><entity><identifier>1</identifier></entity><period><startDate>2026-01-01</startDate><endDate>2026-06-30</endDate></period></context>
${eps.map((e, i) => `<context id="c${i}"><entity><identifier>1</identifier>${e.member ? `<segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:${e.member}</xbrldi:explicitMember></segment>` : ""}</entity><period><startDate>${e.start}</startDate><endDate>${e.end}</endDate></period></context>`).join("\n")}
${symbols.map((s) => `<dei:TradingSymbol contextRef="cover">${s}</dei:TradingSymbol>`).join("")}
<dei:Security12bTitle contextRef="cover">${title}</dei:Security12bTitle>
${eps.map((e, i) => `<us-gaap:${e.concept ?? "EarningsPerShareDiluted"} contextRef="c${i}" unitRef="usdPerShare" decimals="2">${e.val}</us-gaap:${e.concept ?? "EarningsPerShareDiluted"}>`).join("\n")}
</xbrl>`;
const A = "CommonClassAMember";
const q226 = instance({ eps: [
  { start: "2026-04-01", end: "2026-06-30", member: A, val: 0.42 },
  { start: "2026-01-01", end: "2026-06-30", member: A, val: 0.76 }, // six months: not a quarter
  { start: "2025-04-01", end: "2025-06-30", member: A, val: 0.26 }, // the restated comparative
] });
const q225 = instance({ eps: [{ start: "2025-04-01", end: "2025-06-30", member: A, val: 1.28 }] }); // first filed, pre-split
const q126 = instance({ eps: [{ start: "2026-01-01", end: "2026-03-31", member: A, val: 1.69 }] });

console.log("COVER");
{
  const p = C.parseClassInstance(q226);
  check("parses the cover and three-month class EPS only", p.cover.symbols.join() === "CVNA" && p.eps.length === 2, JSON.stringify(p.eps));
  const id = C.listedClassMember(p.cover, "CVNA");
  check("one security, listed ticker, 'Class A Common Stock' -> CommonClassAMember", id.member === A, JSON.stringify(id));
  check("two securities on the cover -> refused (AIG-shaped)", "refused" in C.listedClassMember({ symbols: ["AIG", "AIG 67EU"], titles: ["Common Stock", "Debentures"] }, "AIG"));
  check("a title naming no class -> refused", "refused" in C.listedClassMember({ symbols: ["MAIN"], titles: ["Common Stock, par value $0.01"] }, "MAIN"));
  check("another symbol on the cover -> refused (QNME's old LSH cover)", "refused" in C.listedClassMember({ symbols: ["LSH"], titles: ["Class A Common Stock"] }, "QNME"));
}

console.log("NEWEST / PLAIN");
const blanks = [
  { start: "2026-04-01", end: "2026-06-30", key: "epsDiluted" },
  { start: "2026-01-01", end: "2026-03-31", key: "epsDiluted" },
  { start: "2025-04-01", end: "2025-06-30", key: "epsDiluted" },
];
const insts = [["0001690820-26-000055", q226], ["0001690820-26-000035", q126], ["0001690820-25-000312", q225]].map(([accession, xml]) => ({ accession, parsed: C.parseClassInstance(xml) }));
const runFills = (M) => Object.fromEntries(M.classEpsFills("CVNA", insts, blanks).fills.map((f) => [f.end, f.val]));
{
  const f = runFills(C);
  check("Q2 FY2026 $0.42", f["2026-06-30"] === 0.42, JSON.stringify(f));
  check("Q1 FY2026 $1.69 (stated only before the split)", f["2026-03-31"] === 1.69);
  check("Q2 FY2025 $0.26 from the newest 10-Q, not $1.28 first filed", f["2025-06-30"] === 0.26);
  const plain = [{ accession: "x", parsed: C.parseClassInstance(instance({ eps: [{ start: "2026-04-01", end: "2026-06-30", member: null, val: 0.5 }, { start: "2026-04-01", end: "2026-06-30", member: A, val: 0.42 }] })) }];
  check("a frame stated undimensioned is not filled per class", C.classEpsFills("CVNA", plain, blanks.slice(0, 1)).fills.length === 0);
  const M = await mutated("lib/server/secClassEps.ts", "    for (const i of instances) {", "    for (const i of [...instances].reverse()) {");
  check("mutant (oldest filing wins) is caught", runFills(M)["2025-06-30"] === 1.28);
  const M2 = await mutated("lib/server/secClassEps.ts", "  if (syms.length !== 1) return { refused: `${syms.length} securities on the cover` };", "");
  check("mutant (one-security rule dropped) is caught", !("refused" in M2.listedClassMember({ symbols: ["AIG", "AIG 67EU"], titles: ["Class A Common Stock"] }, "AIG")));
}

console.log("APPLY");
{
  const keys = F.SEC_FIELD_KEYS;
  const vals = () => keys.map(() => null);
  const q = (start, end) => ({ start, end, fp: "Q2", fy: 2026, values: vals() });
  const ex = { quarters: [q("2026-04-01", "2026-06-30")], notes: [] };
  ex.quarters[0].values[F.SEC_FIELD_INDEX.netIncome] = { val: 310e6, derived: "as-filed" };
  ex.quarters[0].values[F.SEC_FIELD_INDEX.epsBasic] = { val: 0.43, derived: "as-filed" };
  const b = C.blankEpsCells(ex);
  check("blank cells: diluted only (basic is filed)", b.length === 1 && b[0].key === "epsDiluted", JSON.stringify(b));
  const q4 = { quarters: [{ ...q("2025-10-01", "2025-12-31"), fp: "Q4" }] };
  q4.quarters[0].values[F.SEC_FIELD_INDEX.netIncome] = { val: 1, derived: "differenced" };
  check("a blank Q4 is never a reason to read a 10-Q", C.blankEpsCells(q4).length === 0);
  const n = C.applyClassEps(ex, [{ end: "2026-06-30", key: "epsDiluted", val: 0.42, accession: "a" }, { end: "2026-06-30", key: "epsBasic", val: 9, accession: "a" }], A);
  check("writes the blank as filed, never over a filed cell", n === 1 && ex.quarters[0].values[F.SEC_FIELD_INDEX.epsDiluted].val === 0.42 && ex.quarters[0].values[F.SEC_FIELD_INDEX.epsBasic].val === 0.43);
}

console.log("SPLIT");
const K = F.SEC_FIELD_KEYS;
const period = (e, s, fp, fy, cells, f = null) => {
  const v = K.map((k) => (k in cells ? cells[k] : null));
  return { e, s, fp, fy, a: null, f, v, d: K.map((k) => (k in cells ? "F" : "-")).join("") };
};
const cvnaSet = (ssf) => ({
  quarters: [
    period("2026-06-30", "2026-04-01", "Q2", 2026, { netIncome: 310e6, sharesDiluted: 739.96e6, epsDiluted: 0.42 }, "2026-07-29"),
    period("2026-03-31", "2026-01-01", "Q1", 2026, { netIncome: 250e6, epsDiluted: 1.69 }, "2026-04-29"),
    // restated in the Q2 FY2026 10-Q, filed after the split
    period("2025-06-30", "2025-04-01", "Q2", 2025, { netIncome: 183e6, sharesDiluted: 716.153e6, epsDiluted: 0.26 }, "2026-07-29"),
  ],
  years: [], instants: [], ...(ssf ? { ssf } : {}),
});
{
  const f = SA.splitFactors(cvnaSet([["2022-12-31", 0.0556], ["2026-05-08", 0.2]]));
  check("filed 0.2 + Q1's shares x5 = Q2's -> Q1 FY2026 factor 5", f.get("2026-03-31") === 5, JSON.stringify([...f]));
  check("...Q2 FY2025 (restated) and Q2 FY2026 are not moved", !f.has("2025-06-30") && !f.has("2026-06-30"));
  const adj = SA.splitAdjusted({ ...cvnaSet([["2026-05-08", 0.2]]), h: "x", symbol: "CVNA", cik: null, entityName: null, at: 0, cover: null });
  const eps = (e) => adj.quarters.find((p) => p.e === e).v[K.indexOf("epsDiluted")];
  check("split-adjusted: Q1 FY2026 ≈ $0.34, Q2 FY2025 $0.26", Math.abs(eps("2026-03-31") - 0.338) < 1e-9 && eps("2025-06-30") === 0.26, `${eps("2026-03-31")} / ${eps("2025-06-30")}`);
  check("the 0.0556 exchange ratio alone proves nothing", SA.splitFactors(cvnaSet([["2022-12-31", 0.0556]])).size === 0);
  check("no split fact -> nothing moves (as before)", SA.splitFactors(cvnaSet(null)).size === 0);
  const lone = cvnaSet([["2026-05-08", 0.2]]); lone.quarters = lone.quarters.filter((p) => p.e !== "2026-03-31");
  check("no pre-split period that corroborates -> nothing moves", SA.splitFactors(lone).size === 0);
  // FLG-shaped: the old periods were restated by filings after the split date -> nothing moves.
  const restated = cvnaSet([["2026-05-08", 0.2]]);
  restated.quarters = restated.quarters.map((p) => (p.e === "2026-03-31" ? { ...p, f: "2026-08-01", v: p.v.map((x, i) => (K[i] === "epsDiluted" ? 0.338 : x)) } : p));
  check("a period filed after the split date is never moved (already restated)", SA.splitFactors(restated).size === 0, JSON.stringify([...SA.splitFactors(restated)]));
  // A restatement proof that APPLIES the ratio takes the filed split's place (no double move)...
  const held = { ...cvnaSet([["2026-05-08", 0.2]]), asr: [["2025-06-30", 5]] };
  check("a restatement proof that already moves the period is not doubled", SA.provenSplits(held).length === 1 && SA.splitFactors(held).get("2026-03-31") === 5, JSON.stringify([...SA.splitFactors(held)]));
  // ...and one held the other way up never inverts or doubles it.
  const inverted = { ...cvnaSet([["2026-05-08", 0.2]]), asr: [["2025-06-30", 0.2]] };
  check("...held the other way up, the period still moves exactly x5", SA.splitFactors(inverted).get("2026-03-31") === 5, JSON.stringify([...SA.splitFactors(inverted)]));
  // ORLY-shaped (#552 COWORK #248): asr holds 15 but its only reference is stored
  // on the old basis, so it moves nothing; the filed 15-for-1 must still apply.
  const orly = {
    quarters: [
      period("2026-06-30", "2026-04-01", "Q2", 2026, { netIncome: 640e6, sharesDiluted: 850e6, epsDiluted: 0.75 }, "2026-07-30"),
      period("2024-03-31", "2024-01-01", "Q1", 2024, { netIncome: 547e6, sharesDiluted: 59.454e6, epsDiluted: 9.2 }, "2025-05-09"),
      period("2023-12-31", "2023-10-01", "Q4", 2023, { netIncome: 537e6, epsDiluted: 9.0 }, "2026-02-27"),
    ],
    years: [], instants: [], asr: [["2023-12-31", 15]], ssf: [["2025-06-10", 15]],
  };
  const of = SA.splitFactors(orly);
  check("ORLY-shaped: a held ratio that moves nothing does not swallow the filed split (Q1 2024 x15)", of.get("2024-03-31") === 15 && !of.has("2026-06-30"), JSON.stringify([...of]));
  const MO = await mutated("lib/server/secSplitAdjust.ts", "      if (same.length && appliesBefore(set as Pick<StoredFactSet, \"quarters\" | \"years\">, same, f.date!)) continue;\n", "      if (same.length) continue;\n");
  check("mutant (dedupe on the ratio alone) is caught", !MO.splitFactors(orly).has("2024-03-31"));
  const MD = await mutated("lib/server/secSplitAdjust.ts", "      if (split.date && !(p.f && p.f < split.date)) continue;\n", "");
  const both = cvnaSet([["2026-05-08", 0.2]]); both.quarters.push(period("2024-06-30", "2024-04-01", "Q2", 2024, { netIncome: 18e6, sharesDiluted: 128e6, epsDiluted: 0.14 }, "2026-08-01"));
  check("mutant (filing-date rule dropped) is caught", MD.splitFactors(both).get("2024-06-30") === 5 && !SA.splitFactors(both).has("2024-06-30"));
  const M = await mutated("lib/server/secSplitAdjust.ts", "      if (!out.some((s) => s.k === f.k && s.date === f.date)) out.push(f);", "");
  check("mutant (filed split ignored) is caught", M.splitFactors(cvnaSet([["2026-05-08", 0.2]])).size === 0);
}

console.log("HASH");
{
  // ssf IN contentHash ONLY WHEN PRESENT (#552 COWORK #248): a set that only
  // gains split facts is written; a set without them keeps its hash exactly.
  const CODEC = await imp("lib/server/secFactCodec.ts");
  const OLD = await mutated("lib/server/secFactCodec.ts", "  if (set.ssf?.length) for (const [d, r] of set.ssf) feed(`ss${d}=${r}`);\n", "");
  const plain = cvnaSet(null), split = cvnaSet([["2026-05-08", 0.2]]);
  check("a set with no split facts keeps its hash", CODEC.contentHashOf(plain) === OLD.contentHashOf(plain));
  check("gaining split facts moves the hash (so the re-read writes it)", CODEC.contentHashOf(split) !== CODEC.contentHashOf(plain));
  check("mutant (ssf not hashed) is caught", OLD.contentHashOf(split) === OLD.contentHashOf(plain));
}

console.log("GATE");
{
  const row = (start, end, val, fp, form = fp === "FY" ? "10-K" : "10-Q", filed = "2026-08-01") => ({ start, end, val, accn: "0000000000-26-000001", fy: 2026, fp, form, filed });
  const payload = (withSplit) => ({
    cik: 1, entityName: "Fixture",
    facts: { "us-gaap": {
      NetIncomeLoss: { units: { USD: [row("2026-01-01", "2026-03-31", 250e6, "Q1"), row("2026-04-01", "2026-06-30", 310e6, "Q2")] } },
      // Q1's EPS first filed before the split, its count restated after it.
      EarningsPerShareDiluted: { units: { "USD/shares": [row("2026-01-01", "2026-03-31", 1.69, "Q1")] } },
      WeightedAverageNumberOfDilutedSharesOutstanding: { units: { shares: [row("2026-01-01", "2026-03-31", 740e6, "Q1"), row("2026-04-01", "2026-06-30", 739.96e6, "Q2")] } },
      ...(withSplit ? { StockholdersEquityNoteStockSplitConversionRatio1: { units: { pure: [{ end: "2026-05-08", val: 0.2, accn: "0000000000-26-000001", fy: 2026, fp: "Q2", form: "10-Q", filed: "2026-08-01" }] } } } : {}),
    } },
  });
  const q2 = (M, f) => M.extractCompanyFacts("FIX", f).quarters.find((p) => p.end === "2026-06-30")?.values[K.indexOf("epsDiluted")] ?? null;
  const yes = q2(X, payload(true)), no = q2(X, payload(false));
  check("a closure ratio on the filer's 0.2 split does not trip the gate", yes?.derived === "computed" && Math.abs(yes.val - 310 / 739.96) < 1e-9, JSON.stringify(yes));
  check("...without the split fact the same ratio still trips it", no?.val == null, JSON.stringify(no));
  const r = X.extractCompanyFacts("FIX", payload(true));
  check("split facts reach the result", JSON.stringify(r.splitFacts) === JSON.stringify([["2026-05-08", 0.2]]));
  const M = await mutated("lib/server/secExtract.ts", "      if (Math.abs(r - 1) > RATIO_CLOSE_TOLERANCE && !splitShaped(r)) return false;", "      if (Math.abs(r - 1) > RATIO_CLOSE_TOLERANCE) return false;");
  check("mutant (split-aware test removed) is caught", q2(M, payload(true))?.val == null);
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
