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
//   (c) A KEPT PRIOR TAKES A NEWER COVER OR TTM EPS, AND IS NOT A
//       VERIFICATION (#552 COWORK #222). V's 2010 cover was kept over the
//       10-Q's per-class count while companyfacts lagged its filled quarter,
//       and the pass stamped verifiedAt, which retired its re-read request.
//       keptWithNewer merges a usable, STRICTLY newer cover (and a te running
//       to a later period end) into the kept set; the job writes only when it
//       merged, and stamps verifiedAt only on a pass that did not keep the
//       prior (keptOpen records the hold instead).
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

// (c) FIXTURES: V's shape on 2026-10-13 (CODE-A #238), and C's.
const TODAY = "2026-10-13";
const cov = (asOf, val, derived = "as-filed", extra = {}) => ({ asOf, accession: "0000000000-26-000001", filed: asOf, val, derived, ...extra });
const te = (periodEnd, val = 11.75) => ({ val, periodEnd, yearEnd: "2025-09-30", ytdStart: "2025-10-01", ytdDays: 273, kind: "diluted", member: null, concept: "EarningsPerShareDiluted", k: null, q: null });
const keptPrior = (over = {}) => ({
  h: "x", symbol: "V", cik: "0001403161", entityName: "test", at: 1, contentHash: "c05f59b7",
  quarters: [{ e: "2026-06-30", a: "0001403161-26-000104", v: [1], d: "as-filed" }], years: [], instants: [],
  cover: cov("2010-01-27", 469280842),
  ff: { form: "10-Q", accn: "0001403161-26-000104", filed: "2026-07-29", reportDate: "2026-06-30" },
  w: 12, y: 6, lv: 5, c: "d60776c6", ...over,
});

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
  "(c) V's shape: a 2026 per-class cover over a kept 2010 one → merged, hash moved, figures/ff/stamps kept": async (B) => {
    const prior = keptPrior();
    const k = B.keptWithNewer(prior, { cover: cov("2026-07-21", 1867047260, "computed"), te: undefined }, TODAY);
    return k !== prior && k.cover.val === 1867047260 && k.cover.asOf === "2026-07-21" && k.contentHash !== prior.contentHash
      && k.quarters === prior.quarters && k.ff === prior.ff && k.c === prior.c && k.sv === prior.sv && k.at === prior.at;
  },
  "(c) C's shape: the kept cover (from the filled 10-Q) is newer → the prior itself, unwritten": async (B) => {
    const prior = keptPrior({ symbol: "C", cover: cov("2026-06-30", 1677436783) });
    return B.keptWithNewer(prior, { cover: cov("2026-01-31", 1749319009) }, TODAY) === prior;
  },
  "(c) the same asOf → not merged (strictly newer)": async (B) => {
    const prior = keptPrior({ cover: cov("2026-07-21", 1) });
    return B.keptWithNewer(prior, { cover: cov("2026-07-21", 2, "computed") }, TODAY) === prior;
  },
  "(c) an ambiguous fresh cover (no value, candidates) → not merged": async (B) => {
    const prior = keptPrior();
    return B.keptWithNewer(prior, { cover: cov("2026-07-21", null, "ambiguous", { candidates: [1704112694, 2180148] }) }, TODAY) === prior;
  },
  "(c) a fresh cover past the age limit → not merged, even if newer": async (B) => {
    const prior = keptPrior();
    return B.keptWithNewer(prior, { cover: cov("2024-01-02", 2000000000) }, TODAY) === prior;
  },
  "(c) te to a later period end → merged; to an earlier one → not": async (B) => {
    const prior = keptPrior({ cover: cov("2026-07-21", 1867047260, "computed"), te: te("2026-03-31", 10.9) });
    const later = B.keptWithNewer(prior, { cover: prior.cover, te: te("2026-06-30") }, TODAY);
    const earlier = B.keptWithNewer(prior, { cover: prior.cover, te: te("2025-12-31") }, TODAY);
    return later !== prior && later.te.periodEnd === "2026-06-30" && later.cover === prior.cover && earlier === prior;
  },
  "(c) a converted (fx) prior is kept as it is": async (B) => {
    const prior = keptPrior({ fx: { refused: [] } });
    return B.keptWithNewer(prior, { cover: cov("2026-07-21", 1867047260, "computed") }, TODAY) === prior;
  },
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
  && /const set: StoredFactSet = keepPrior \? kept! :/.test(FACTS));
check("sec-facts: a kept prior goes through keptWithNewer",
  /const kept = keepPrior \? keptWithNewer\(prior!, fresh, new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\) : null;/.test(FACTS));
check("sec-facts: changed = kept !== prior when kept, else mustWriteOver(prior, set)",
  /const changed = keepPrior \? kept !== prior : prior \? mustWriteOver\(prior, set\) : true;/.test(FACTS));
// (c) verifiedAt ONLY on a pass that did not keep the prior; keptOpen records the hold.
const stampsOnlyWhenRead = (src) =>
  (src.match(/entry\.verifiedAt = Date\.now\(\);/g) ?? []).length === 1
  && /if \(keepPrior\) \{\s*entry\.keptOpen = \{\s*since: entry\.keptOpen\?\.since \?\? Date\.now\(\),[\s\S]{0,200}?\} else \{\s*entry\.verifiedAt = Date\.now\(\);\s*entry\.keptOpen = null;\s*\}/.test(src);
check("sec-facts: a pass that keeps the prior does not stamp verifiedAt; keptOpen keeps its first `since`", stampsOnlyWhenRead(FACTS));
check("MUTATION: verifiedAt stamped on every pass again → caught",
  !stampsOnlyWhenRead(once(FACTS, "        if (keepPrior) {\n          entry.keptOpen", "        entry.verifiedAt = Date.now();\n        if (keepPrior) {\n          entry.keptOpen")));
check("MUTATION: keptOpen.since reset on every kept pass → caught",
  !stampsOnlyWhenRead(once(FACTS, "since: entry.keptOpen?.since ?? Date.now(),", "since: Date.now(),")));
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
  ["(c) a cover that merely differs replaces the kept one (C would take an older count)", (s) => once(s, "&& fresh.cover!.asOf > (prior.cover?.asOf ?? \"\");", "&& fresh.cover!.asOf !== (prior.cover?.asOf ?? \"\");"), null],
  ["(c) the usability test dropped (an ambiguous or stale cover merged)", (s) => once(s, "const coverNewer = coverIsUsable(fresh.cover, today, COVER_SHARES_MAX_AGE_DAYS)\n", "const coverNewer = Boolean(fresh.cover?.asOf)\n"), null],
  ["(c) te merged when it merely differs", (s) => once(s, "fresh.te.periodEnd > prior.te.periodEnd", "fresh.te.periodEnd !== prior.te.periodEnd"), null],
  ["(c) a converted set merged on a different hash basis", (s) => once(s, "  if (prior.fx) return prior;\n", ""), null],
  ["(c) nothing merged into a kept set (V stays on its 2010 cover)", (s) => once(s, "  if (!coverNewer && !teNewer) return prior;\n", "  return prior;\n"), null],
];
for (const [label, bm, sm] of MUTANTS) {
  let ok = false;
  try { ok = await caught(await build(bm, sm)); } catch (e) { console.log(`    ${e?.message ?? e}`); ok = false; }
  check(`MUTATION: ${label} → caught`, ok);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
