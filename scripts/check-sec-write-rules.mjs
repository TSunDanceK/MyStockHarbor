// THE sec-facts WRITE RULES (#552 COWORK #132 (a) and (b)).
//
//   (b) A RATE SERIES THAT FAILED TO LOAD NEVER BLANKS A STORED SET. ECB timed
//       out on INR and MXN in the 3 Oct 20:22 UTC run; toStoredSet then drops
//       the periods (withoutPeriods), the hash moves, and the job wrote an
//       empty set over a converted one. Both jobs now keep the prior.
//   (a) A STALE PRIOR IS WRITTEN. The manifest stamps from the set the job
//       holds, so a re-read of a stale set that was "unchanged" (#706's share
//       fields are not in contentHash) was stamped current with the old shape
//       still stored. SEC_SHARE_VERSION re-queues the sets already mis-stamped.
//
// Driven through the SHIPPED module (secFactBuild, via the app's TS loader),
// plus the wiring in both jobs, plus one mutant per rule.
//
//   node scripts/check-sec-write-rules.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

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

const ROOT = process.cwd();
const BUILD = path.join(ROOT, "lib/server/secFactBuild.ts");
const STALE = path.join(ROOT, "lib/server/secStaleness.ts");
let seq = 0;
/** secFactBuild, optionally mutated, optionally over a mutated secStaleness. */
async function build(mutate = (s) => s, mutateStale = null) {
  const tag = `__mut${process.pid}_${seq++}`;
  const tmps = [];
  try {
    let src = mutate(fs.readFileSync(BUILD, "utf8"));
    if (mutateStale) {
      const st = STALE.replace(/\.ts$/, `.${tag}.ts`);
      fs.writeFileSync(st, mutateStale(fs.readFileSync(STALE, "utf8")));
      tmps.push(st);
      src = once(src, 'from "./secStaleness";', `from "./secStaleness.${tag}";`);
    }
    const tmp = BUILD.replace(/\.ts$/, `.${tag}.ts`);
    fs.writeFileSync(tmp, src);
    tmps.push(tmp);
    return await import(pathToFileURL(tmp).href);
  } finally {
    for (const t of tmps) fs.rmSync(t, { force: true });
  }
}

const { SEC_QUARTER_WINDOW, SEC_YEAR_WINDOW, SEC_LABEL_VERSION, SEC_SHARE_VERSION } = await import("../lib/server/secExtract.ts");
const { secChainsHash } = await import("../lib/server/secFields.ts");

// ── FIXTURES ───────────────────────────────────────────────────────────────
const rec = (end, start) => ({ end, start, fp: "FY", fy: Number(end.slice(0, 4)), accession: "0000000000-24-000001", filed: "2025-03-01", values: [{ val: 100, derived: "reported" }] });
const extracted = (cur) => ({
  symbol: "IBN", cik: 1103838, entityName: "test", fieldsHash: "x",
  quarters: [], years: [rec("2024-03-31", "2023-04-01")], instants: [],
  coverShares: null, reportingCurrency: cur, taxonomies: ["ifrs-full"], refusedUnits: [], notes: [],
});
const failing = { id: "ecb-reference", supports: () => true, fetchSeries: async () => { throw new Error("timeout"); } };
const working = { id: "fred-h10", supports: () => true, fetchSeries: async (_c, from, to) => {
  const out = []; for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) out.push({ date: new Date(t).toISOString().slice(0, 10), usdPerUnit: 0.012 });
  return out;
} };
const current = () => ({ w: SEC_QUARTER_WINDOW, y: SEC_YEAR_WINDOW, lv: SEC_LABEL_VERSION, sv: SEC_SHARE_VERSION, c: secChainsHash() });
const priorWithPeriods = { quarters: [], years: [{ e: "2024-03-31" }], instants: [] };

const RULES = {
  "(b) INR series fails to load -> fresh set has no periods -> the stored set stands": async (B) => {
    const fresh = await B.toStoredSet(extracted("INR"), [failing], new Map());
    return fresh.years.length === 0 && B.periodsDroppedForFx(extracted("INR"), fresh) && B.priorStandsForFx(priorWithPeriods, extracted("INR"), fresh);
  },
  "(b) the series loads -> converted, written as usual": async (B) => {
    const fresh = await B.toStoredSet(extracted("INR"), [working], new Map());
    return fresh.years.length === 1 && Boolean(fresh.fx) && !B.priorStandsForFx(priorWithPeriods, extracted("INR"), fresh);
  },
  "(b) a prior with no periods has nothing to lose -> the fresh set is written": async (B) => {
    const fresh = await B.toStoredSet(extracted("MXN"), [failing], new Map());
    return !B.priorStandsForFx({ quarters: [], years: [], instants: [] }, extracted("MXN"), fresh) && !B.priorStandsForFx(null, extracted("MXN"), fresh);
  },
  "(b) a USD filer is never held back": async (B) => {
    const fresh = await B.toStoredSet(extracted("USD"), [failing], new Map());
    return fresh.years.length === 1 && !B.priorStandsForFx(priorWithPeriods, extracted("USD"), fresh);
  },
  "(a) same hash, prior current -> not written": async (B) =>
    B.mustWriteOver({ contentHash: "h", ...current() }, { contentHash: "h", quarters: [], years: [], instants: [] }) === false,
  "(a) same hash, prior written before the share stamp (sv absent) -> written": async (B) => {
    const rest = current();
    delete rest.sv;
    return B.mustWriteOver({ contentHash: "h", ...rest }, { contentHash: "h", quarters: [], years: [], instants: [] }) === true;
  },
  "(a) same hash, prior on old tag chains -> written": async (B) =>
    B.mustWriteOver({ contentHash: "h", ...current(), c: "old" }, { contentHash: "h", quarters: [], years: [], instants: [] }) === true,
  "(a) a moved hash is still written": async (B) =>
    B.mustWriteOver({ contentHash: "h", ...current() }, { contentHash: "g", quarters: [], years: [], instants: [] }) === true,
};
const B = await build();
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(await rule(B)); } catch (e) { ok = false; console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}

// ── WIRING ─────────────────────────────────────────────────────────────────
const FACTS = readCodeOnly("app/api/jobs/sec-facts/route.ts");
const FILINGS = readCodeOnly("lib/server/secFilingJob.ts");
const CODEC = readCodeOnly("lib/server/secFactCodec.ts");
check("sec-facts: the prior stands for a failed rate load, as for a filled period",
  /const keepForFx = priorStandsForFx\(prior, extracted, fresh\);/.test(FACTS) && /const keepPrior = keepFilled \|\| keepForFx;/.test(FACTS)
  && /const set: StoredFactSet = keepPrior \? prior! :/.test(FACTS));
check("sec-facts: changed = mustWriteOver(prior, set)", /const changed = keepPrior \? false : prior \? mustWriteOver\(prior, set\) : true;/.test(FACTS));
check("sec-facts: the manifest takes the share stamp from the set", /entry\.sv = set\.sv \?\? 1;/.test(FACTS));
check("sec-filings: both writes go through keptFromFx",
  (FILINGS.match(/keptFromFx\((stored), (base|filled), await toStoredSet\(/g) ?? []).length === 2 && /if \(priorStandsForFx\(stored, extracted, fresh\)\) \{\s*throw/.test(FILINGS));
check("the codec stamps every set it encodes", /sv: SEC_SHARE_VERSION,/.test(CODEC));

// ── MUTANTS ────────────────────────────────────────────────────────────────
const caught = async (B2) => {
  for (const r of Object.values(RULES)) { try { if (!(await r(B2))) return true; } catch { return true; } }
  return false;
};
const MUTANTS = [
  ["a failed rate load overwrites the stored set again", (s) => once(s, "  return setHasPeriods(prior) && periodsDroppedForFx(extracted, fresh);", "  return false;"), null],
  ["the guard ignores whether the fresh set converted", (s) => once(s, "  return hadPeriods && !hasPeriods && !fresh.fx;", "  return hadPeriods;"), null],
  ["a stale prior left unwritten again", (s) => once(s, " || conversionGained(prior, set) || needsReread(prior);", " || conversionGained(prior, set);"), null],
  ["the share stamp not read by needsReread", (s) => s, (s) => once(s, "    (e.sv ?? 1) < SEC_SHARE_VERSION ||\n", "")],
];
for (const [label, bm, sm] of MUTANTS) {
  let ok = false;
  try { ok = await caught(await build(bm, sm)); } catch (e) { console.log(`    ${e?.message ?? e}`); ok = false; }
  check(`MUTATION: ${label} → caught`, ok);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
