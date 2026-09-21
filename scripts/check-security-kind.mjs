// The shared-CIK guard, run against the REAL committed maps.
//
// NOT AGAINST HAND-BUILT FIXTURES. The step 3 brief's own validation rule is
// that a fixture reverse-engineered from the expected answer cannot test the
// thing that produces the answer -- §17 of check-sec-daily-index.mjs is the
// worked example. Every symbol below is looked up in
// data/sec/company-tickers.json and data/company-names.json as shipped.
//
//   node scripts/check-security-kind.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/securityKind.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// The module imports cikForSymbol from secColdFetch, which drags in Redis.
// Only the pure half is under test, so the import is stripped -- the impure
// helper (cikGroupFor) is not exercised here and is not what decides anything.
const SOURCE = fs.readFileSync(SRC, "utf8");
const build = async (src) => {
  const pure = src
    .replace(/import \{ cikForSymbol \} from "\.\/secColdFetch";/, "const cikForSymbol = () => null;")
    .replace(/export function cikGroupFor[\s\S]*$/, "");
  const js = ts.transpileModule(pure, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
};
const m = await build(SOURCE);

const underMutation = async (name, from, to, probe) => {
  if (!SOURCE.includes(from)) {
    check(`mutation "${name}" could not be applied`, false, `source no longer contains: ${from.slice(0, 60)}`);
    return;
  }
  let stillHolds;
  try { stillHolds = await probe(await build(SOURCE.replace(from, to))); } catch { stillHolds = false; }
  check(`MUTATION "${name}" breaks the assertion`, !stillHolds,
    stillHolds ? "the property still held with the rule removed — the assertion above proves nothing" : "");
};

// ── the real maps ─────────────────────────────────────────────────────────
const sec = JSON.parse(fs.readFileSync(path.join(ROOT, "data/sec/company-tickers.json"), "utf8"));
const NAMES = JSON.parse(fs.readFileSync(path.join(ROOT, "data/company-names.json"), "utf8")).rows;
const fi = sec.fields, TI = fi.indexOf("ticker"), CI = fi.indexOf("cik"), XI = fi.indexOf("exchange");
const cikOf = new Map(), byCik = new Map();
for (const r of sec.data) {
  const t = String(r[TI]).toUpperCase(), c = String(r[CI]);
  cikOf.set(t, c);
  if (!byCik.has(c)) byCik.set(c, []);
  byCik.get(c).push(t);
}
const ON_EXCHANGE = new Set(["nasdaq", "nyse", "amex", "nyse american", "nyse mkt", "cboe"]);
const listed = (t) => {
  const r = sec.data.find((x) => String(x[TI]).toUpperCase() === t);
  return r ? ON_EXCHANGE.has(String(r[XI] ?? "").trim().toLowerCase()) : false;
};
const verdictFor = (symbol) => m.admitForExtraction({
  symbol,
  cik: cikOf.get(symbol) ?? null,
  cikGroup: byCik.get(cikOf.get(symbol)) ?? [],
  securityName: NAMES[symbol] ?? null,
});

console.log("\n1. THE LIVE BUG — /stock/MER-PK/earnings");
{
  check("MER-PK really does resolve to Bank of America's CIK in the shipped map",
    cikOf.get("MER-PK") === cikOf.get("BAC") && cikOf.get("MER-PK") === "70858",
    `MER-PK=${cikOf.get("MER-PK")} BAC=${cikOf.get("BAC")} — if this ever fails the bug moved, it did not go away`);
  check("...and sixteen other symbols share it",
    (byCik.get("70858") ?? []).length === 17,
    `${(byCik.get("70858") ?? []).length} symbols on CIK 70858`);
  const v = verdictFor("MER-PK");
  check("MER-PK is REFUSED",
    v.admit === false && v.reason === "derivative-of-issuer",
    JSON.stringify(v));
  check("...and the refusal names a sibling the reader can go to",
    m.refusalWords(v).includes("BAC"),
    m.refusalWords(v));
  check("BAC itself is admitted — the parent is not collateral damage",
    verdictFor("BAC").admit === true);
}

console.log("\n2. THE OTHER NAMED TARGETS");
for (const s of ["TBB", "CTA-PA", "CTA-PB", "EP-PC", "BMNP"]) {
  const v = verdictFor(s);
  check(`${s} is refused`, v.admit === false,
    `${JSON.stringify(NAMES[s] ?? "(no name)").slice(0, 64)}`);
}

console.log("\n3. THE FIVE THAT classifySecurityName WOULD HAVE DELETED");
{
  // This section is the reason this module exists rather than reusing the
  // news classifier. Every one of these is an operating company.
  for (const s of ["ET", "MPLX", "BEP", "BIP", "ASML", "AEG", "BN", "KOF", "AMX"]) {
    check(`${s} is ADMITTED`, verdictFor(s).admit === true,
      `${JSON.stringify(NAMES[s] ?? "(no name)").slice(0, 64)}`);
  }
}

console.log("\n4. SHARE CLASSES AND ADRs STAY — rule 2, not rule 1");
for (const s of ["BRK-A", "BRK-B", "GOOG", "GOOGL", "MKC-V", "BABA", "BHP"]) {
  check(`${s} is admitted`, verdictFor(s).admit === true);
}

console.log("\n5. A LONE CIK IS ALWAYS ADMITTED, WHATEVER ITS NAME SAYS");
{
  const lone = m.admitForExtraction({
    symbol: "XYZ", cik: "999", cikGroup: ["XYZ"],
    securityName: "Some Company 7.5% Subordinated Notes due 2099",
  });
  check("a standalone note issuer is admitted — nobody to be confused with",
    lone.admit === true,
    "a name-only rule would refuse standalone issuers and closed-end funds");
}

console.log("\n6. UNVERIFIABLE FAILS CLOSED, AND ONLY OFF-UNIVERSE");
{
  const v = m.admitForExtraction({
    symbol: "BACRP", cik: cikOf.get("BACRP") ?? null,
    cikGroup: byCik.get(cikOf.get("BACRP")) ?? [], securityName: NAMES["BACRP"] ?? null,
  });
  check("BACRP has no Security Name in the shipped snapshot",
    NAMES["BACRP"] == null,
    "this is the null-name case the brief says reads as 'not a preferred'");
  check("...and it is REFUSED rather than passed through",
    v.admit === false && v.reason === "unverifiable",
    JSON.stringify(v));
  check("a blank name is unverifiable, not issuer-equity",
    m.securityKindFromName("") === "unverifiable" &&
      m.securityKindFromName(null) === "unverifiable" &&
      m.securityKindFromName("   ") === "unverifiable");

  // THE DENOMINATOR BESIDE THE COUNTER, per the standing rule. If name
  // coverage over the universe ever slips, unverifiable stops being an
  // off-universe-only verdict and this refusal starts costing real pages.
  const preset = [...new Set(
    [...fs.readFileSync(path.join(ROOT, "lib/server/presetUniverse.ts"), "utf8")
      .slice(fs.readFileSync(path.join(ROOT, "lib/server/presetUniverse.ts"), "utf8")
        .indexOf("PRESET_UNIVERSE: string[] = ["))
      .matchAll(/"([A-Z0-9.\-]{1,8})"/g)].map((x) => x[1])
  )];
  const sharedInUniverse = preset.filter((s) => (byCik.get(cikOf.get(s)) ?? []).length > 1);
  const unnamed = sharedInUniverse.filter((s) => NAMES[s] == null);
  check("every shared-CIK symbol IN THE UNIVERSE has a name, so none is refused as unverifiable",
    sharedInUniverse.length > 0 && unnamed.length === 0,
    `${sharedInUniverse.length - unnamed.length}/${sharedInUniverse.length} named` +
    (unnamed.length ? ` — UNNAMED: ${unnamed.join(" ")}` : "") +
    " — a zero here with a zero denominator would prove nothing, hence the length check");
}

console.log("\n7. POPULATION — reported, because a rule nobody sized is a guess");
{
  let onEx = 0, shared = 0, refusedDeriv = 0, refusedUnver = 0, admitted = 0;
  for (const [t, c] of cikOf) {
    if (!listed(t)) continue;
    onEx++;
    if ((byCik.get(c) ?? []).length < 2) continue;
    shared++;
    const v = verdictFor(t);
    if (v.admit) admitted++;
    else if (v.reason === "derivative-of-issuer") refusedDeriv++;
    else refusedUnver++;
  }
  console.log(`\n  exchange-listed symbols        ${onEx}`);
  console.log(`  ...sharing a CIK               ${shared}  (${(100 * shared / onEx).toFixed(1)}%)`);
  console.log(`     admitted                    ${admitted}`);
  console.log(`     refused: derivative         ${refusedDeriv}`);
  console.log(`     refused: unverifiable       ${refusedUnver}  (all off-universe — see §6)`);
  check("the refused-derivative set is a minority of shared CIKs, not most of them",
    refusedDeriv > 0 && refusedDeriv < shared * 0.2,
    "a rule refusing most of its population is matching something other than what it names");
}

console.log("\n8. THE MUTANTS");
{
  await underMutation(
    "step 3: the shared-CIK guard removed (a derivative renders the parent's financials)",
    "if (!inputs.cik || siblings.length === 0) return { admit: true };",
    "if (true) return { admit: true };",
    (mm) => mm.admitForExtraction({
      symbol: "MER-PK", cik: "70858", cikGroup: byCik.get("70858"), securityName: NAMES["MER-PK"],
    }).admit === false
  );
  await underMutation(
    "step 3: a missing Security Name reads as issuer equity (fail-open)",
    'if (securityName == null || String(securityName).trim() === "") return "unverifiable";',
    "",
    (mm) => mm.admitForExtraction({
      symbol: "BACRP", cik: "70858", cikGroup: byCik.get("70858"), securityName: null,
    }).admit === false
  );
  await underMutation(
    "step 3: ADR wording no longer checked first (BABA and KOF get excluded)",
    "if (ADR_WORDING.test(name)) return \"issuer-equity\";",
    "",
    (mm) => mm.admitForExtraction({
      symbol: "BABA", cik: cikOf.get("BABA"), cikGroup: byCik.get(cikOf.get("BABA")),
      securityName: NAMES["BABA"],
    }).admit === true
  );
  await underMutation(
    "step 3: exclusion becomes residual instead of positive (ET and ASML deleted)",
    'if (DEBT_WORDING.test(name) || PREFERRED_WORDING.test(name) || WARRANT_WORDING.test(name)) {\n    return "derivative-of-issuer";\n  }\n  return "issuer-equity";',
    'if (/common stock/i.test(name)) return "issuer-equity";\n  return "derivative-of-issuer";',
    (mm) => ["ET", "ASML", "BN"].every((s) => mm.admitForExtraction({
      symbol: s, cik: cikOf.get(s), cikGroup: byCik.get(cikOf.get(s)), securityName: NAMES[s],
    }).admit === true)
  );
  await underMutation(
    "step 3: debt wording narrowed to 'preferred' only (MER-PK and TBB slip through)",
    "const DEBT_WORDING =\n  /\\bnotes?\\b|\\bdebentures?\\b|\\bsubordinated\\b|\\bbonds?\\b|\\bcapital securities\\b|\\btrust preferred\\b/i;",
    "const DEBT_WORDING = /\\bnever-matches-anything\\b/i;",
    (mm) => ["MER-PK", "TBB"].every((s) => mm.admitForExtraction({
      symbol: s, cik: cikOf.get(s), cikGroup: byCik.get(cikOf.get(s)), securityName: NAMES[s],
    }).admit === false)
  );
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}`);
process.exit(failures ? 1 : 0);
