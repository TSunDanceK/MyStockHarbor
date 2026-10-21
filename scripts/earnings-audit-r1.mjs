// EARNINGS AUDIT ROUND 1 — the changed cells, main against this branch, beside
// the SEC's own figures (fix/earnings-audit-r1).
//
// Twenty /stock/[symbol]/earnings pages were audited against companyfacts; four
// had wrong figures (KEY bank revenue, CRCL mixed revenue concepts, SYF's
// pending notice, CM's growth). This prints, per named symbol:
//
//   sec      the filer's own fiscal-year figures straight off companyfacts
//            (10-K frames of about a year, newest filing), per revenue concept
//   years    revenue / net income / diluted EPS / revenue YoY, MAIN vs BRANCH
//   quarters the same for the newest eight quarters
//   score    the earnings score, MAIN vs BRANCH
//   cover    the cover share count and the market-cap refusal, if any
//
// MAIN IS THE SHIPPED SOURCE, fetched on the runner (`git fetch origin main`),
// not a copy kept in this file, so "before" is what production runs. Both
// sides go through the same lift of the same module list.
//
// Read-only: no credential, no Redis. SEC figures are public; nothing else is
// printed.
//
//   relay task: earnings-audit-r1   symbols "KEY,CRCL,CM,GIB,XEL,AFRM,RDDT,SYF"
import fs from "node:fs";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; earnings audit round 1)";
const SYMBOLS = (process.env.SYMBOLS || process.argv[2] || "KEY,CRCL,CM,GIB,XEL,AFRM,RDDT,SYF")
  .split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

const { NEW, OLD } = await loadMainAndBranch();

const cikMap = JSON.parse(fs.readFileSync("data/cik-map.json", "utf8"));
const SHARE_CLASSES = JSON.parse(fs.readFileSync("data/sec/share-classes.json", "utf8")).entries ?? {};
const tickers = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
const cikOf = (sym) => {
  if (cikMap[sym]) return String(cikMap[sym]).padStart(10, "0");
  const rows = Array.isArray(tickers?.data) ? tickers.data : Object.values(tickers ?? {});
  for (const r of rows) {
    const t = Array.isArray(r) ? r[2] : r?.ticker;
    const c = Array.isArray(r) ? r[0] : r?.cik_str;
    if (String(t).toUpperCase() === sym) return String(c).padStart(10, "0");
  }
  return null;
};

const M = (v) => (v == null ? "—" : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : String(+v.toFixed(4)));
const P = (v) => (v == null ? "—" : typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : String(v));
const pad = (s, n) => String(s).padEnd(n);

// The filer's own annual figures: the newest-filed 10-K (or 20-F/40-F) frame of
// about a year, per concept. What the audit compared against.
const SEC_CONCEPTS = [
  "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenuesNetOfInterestExpense",
  "InterestIncomeExpenseNet", "NoninterestIncome", "RegulatedAndUnregulatedOperatingRevenue",
  "RegulatedOperatingRevenue", "ElectricUtilityRevenue", "RevenueFromContractWithCustomerIncludingAssessedTax",
  // KHC tags only the including-tax contract line; CAT's 10-K tags its profit as
  // ProfitLoss and NetIncomeLossAvailableToCommonStockholdersBasic, never
  // NetIncomeLoss (audit round 2 printed no SEC figure for either).
  "NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "EarningsPerShareDiluted",
];
function secAnnual(facts) {
  const out = new Map();
  for (const ns of ["us-gaap", "ifrs-full"]) {
    for (const tag of SEC_CONCEPTS) {
      const units = facts.facts?.[ns]?.[tag]?.units ?? {};
      for (const [unit, rows] of Object.entries(units)) {
        for (const r of rows) {
          if (!r.start || !/^(10-K|20-F|40-F)/.test(r.form ?? "")) continue;
          const days = (Date.parse(r.end) - Date.parse(r.start)) / 864e5;
          if (days < 350 || days > 380) continue;
          const k = `${r.end}|${tag}`;
          const prev = out.get(k);
          if (!prev || String(r.filed) > String(prev.filed)) out.set(k, { ...r, tag, unit });
        }
      }
    }
  }
  const ends = [...new Set([...out.keys()].map((k) => k.split("|")[0]))].sort().slice(-6);
  console.log(`  sec (10-K/20-F/40-F annual frames, newest filing; unit per concept):`);
  for (const tag of SEC_CONCEPTS) {
    const cells = ends.map((e) => out.get(`${e}|${tag}`));
    if (!cells.some(Boolean)) continue;
    console.log(`    ${pad(tag.slice(0, 44), 45)} ${cells.map((c, i) => `${ends[i].slice(0, 7)} ${c ? M(c.val) : "—"}`).join("  ")}${cells.find(Boolean)?.unit !== "USD" ? `  [${cells.find(Boolean)?.unit}]` : ""}`);
  }
}

const REV = (m) => m.SEC_FIELD_KEYS.indexOf("revenue");
const NI = (m) => m.SEC_FIELD_KEYS.indexOf("netIncome");
const EPS = (m) => m.SEC_FIELD_KEYS.indexOf("epsDiluted");
async function build(m, symbol, facts, fxCache) {
  const ex = m.extractCompanyFacts(symbol, facts);
  const set = await m.toStoredSet(ex, undefined, fxCache);
  const view = m.buildSecEarningsView(set);
  const score = m.scoreFromSec(view, symbol, { status: "ready", set, cold: false });
  return { ex, set, view, score };
}
function rows(m, b, key) {
  const list = b.set[key] ?? [];
  const home = (p) => (p ? m.storedInReportingCurrency(p, b.set.fx) : null);
  const ri = REV(m);
  return new Map(list.map((p) => {
    const prior = m.priorYearOf(list, p);
    const r = home(p)?.v[ri], r0 = home(prior)?.v[ri];
    const yoy = r != null && r0 != null && r0 > 0 ? ((r - r0) / r0) * 100 : null;
    return [p.e, { p, rev: p.v[ri], code: p.d?.[ri] ?? "?", ni: p.v[NI(m)], eps: p.v[EPS(m)], yoy }];
  }));
}
function table(title, a, b, n) {
  const ends = [...new Set([...(a?.keys() ?? []), ...b.keys()])].sort().slice(-n);
  console.log(`  ${title}: end fp/fy | revenue main → branch (code) | YoY main → branch | NI | EPS`);
  for (const e of ends) {
    const x = a?.get(e), y = b.get(e);
    const lab = `${(y ?? x).p.fp ?? ""} FY${(y ?? x).p.fy ?? ""}`;
    const same = x && y && x.rev === y.rev && x.yoy?.toFixed(1) === y.yoy?.toFixed(1);
    console.log(`    ${e} ${pad(lab, 10)} ${pad(`${M(x?.rev)} → ${M(y?.rev)} (${x?.code ?? "-"}${y?.code ?? "-"})`, 30)} ${pad(`${P(x?.yoy)} → ${P(y?.yoy)}`, 18)} NI ${pad(M(y?.ni ?? x?.ni), 9)} EPS ${M(y?.eps ?? x?.eps)}${same ? "" : "   <- changed"}`);
  }
}

const fxOld = new Map(), fxNew = new Map();
for (const symbol of SYMBOLS) {
  const cik = cikOf(symbol);
  console.log(`\n===== ${symbol} (CIK ${cik ?? "none"})`);
  if (!cik) continue;
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) { console.log(`  HTTP ${res.status}`); continue; }
    facts = await res.json();
  } catch (e) { console.log(`  fetch failed: ${e.message}`); continue; }
  secAnnual(facts);
  const excise = Object.keys(facts.facts?.["us-gaap"] ?? {}).filter((k) => /Excise/.test(k));
  console.log(`  excise-named concepts: ${excise.join(", ") || "none"} · gap concept ${NEW.revenueGapConcept(facts) ?? "none"}`);
  try {
    const nb = await build(NEW, symbol, facts, fxNew);
    const ob = OLD ? await build(OLD, symbol, facts, fxOld) : null;
    console.log(`  currency ${nb.ex.reportingCurrency}${nb.set.fx ? ` (converted, ${nb.set.fx.source})` : ""}`);
    table("years", ob && rows(OLD, ob, "years"), rows(NEW, nb, "years"), 6);
    table("quarters", ob && rows(OLD, ob, "quarters"), rows(NEW, nb, "quarters"), 8);
    const g = (b) => (b?.view?.growth ?? []).map((r) => `${r.label} ${P(r.revenueYoY)}`).join(" · ");
    if (ob) console.log(`  page growth rows main:   ${g(ob)}`);
    console.log(`  page growth rows branch: ${g(nb)}`);
    console.log(`  score main → branch: ${ob ? `${ob.score.score} ${ob.score.label}` : "—"} → ${nb.score.score} ${nb.score.label}`);
    for (const note of nb.ex.notes ?? []) if (/^revenue/.test(note)) console.log(`  note: ${note.slice(0, 240)}`);
    const c = nb.set.cover;
    console.log(`  untagged (nt): ${(nb.set.nt ?? []).filter((k) => /revenue|eps/i.test(k)).join(", ") || "none of revenue/EPS"} · epsReason ${nb.view?.epsReason ?? "null"}`);
    // A MULTI-CLASS FILER'S COVER IS SUMMED FROM ITS FILING (secCoverClasses), which
    // this lift does not fetch: NKE's 2015 undimensioned row printed here while
    // production stores the per-class sum. Say so rather than print a stale count bare.
    const classes = SHARE_CLASSES[symbol] ? " (multi-class: production sums the filing's per-class cover, data/sec/share-classes.json; not fetched here)" : "";
    console.log(`  cover: ${c ? `val ${c.val ?? "—"} asOf ${c.asOf ?? "—"} candidates ${c.candidates?.length ?? 0}` : "none"}${classes}`);
  } catch (e) {
    console.log(`  FAILED: ${e?.name}: ${String(e?.message).slice(0, 300)}`);
    for (const l of String(e?.stack ?? "").split("\n").slice(1, 5)) console.log(`    ${l.trim()}`);
  }
  await new Promise((r) => setTimeout(r, 150));
}
console.log("\nNo writes were performed.");
