// A CELL THAT IS TAGGED, IN CHAIN, AND STILL BLANK — WHICH OF THE THREE?
//
// ── WHAT THIS IS FOR, AND WHY IT IS NOT sec-missing-field-probe ───────────
// That probe answers "did the filer tag anything that could be this figure",
// and it has now answered it: GEV capex, KTOS capex and KTOS cash are all
// TAGGED and IN CHAIN. So the null is NOT a chain gap, and listing concepts
// again cannot say another word about it. Something BETWEEN extraction and
// render is dropping a value the pipeline already holds, and there are exactly
// three places it can be dropped:
//
//   (1) EXTRACTION — the YTD differencing wants a prior frame it does not have,
//       or it has one under a DIFFERENT TAG and refuses to subtract across the
//       change. Either way the quarter cell is never written.
//   (2) PERIOD SELECTION — the value is stored, but the period the card reads
//       is not the period it is stored under. `bsAt = set.instants[0]` takes the
//       NEWEST instant date across every instant field; one stray field tagged
//       a few days later makes that a nearly-empty period, and the balance sheet
//       renders it. The cash card has the same shape: `quarterHasCash` is
//       decided by operatingCashFlow ALONE, so a quarter with OCF and no capex
//       anchors the whole card and capex renders blank beside it.
//   (3) RENDER — the "Not reported" path taking a present value.
//
// These are not distinguishable by reading any one of them. They ARE
// distinguishable by printing, for one symbol, the frames as the shipped
// resolver sees them, the stored periods, and the view's own output, side by
// side. That is all this does.
//
// ── IT RUNS THE SHIPPED CODE, IT DOES NOT MODEL IT ────────────────────────
// `rowsForField` and `resolve` are imported from secExtract, not re-written
// here. The first IFRS probe attributed hits by tag name alone and reported 71
// ifrs cells for a us-gaap-only filer; the extraction was right and the
// instrument was wrong. A probe that re-derives frames its own way can be wrong
// in exactly that shape, so it derives nothing — it prints what the shipped
// functions return.
//
// Read-only: no credential, no store, no writes. Needs the network.
//
//   SYMBOLS="GEV:capex KTOS:capex,cash" node scripts/sec-blank-cell-probe.mjs
//
// FACTS_DIR=<dir> reads <dir>/CIK<cik>.json instead of fetching, so the probe
// itself can be exercised in the sandbox — which cannot reach data.sec.gov —
// against a payload built to contain a known break. It SAYS SO on every line it
// reads that way: a probe that cannot be told apart from a live run is a probe
// whose output cannot be trusted to be live.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; blank-cell diagnosis)";

const strip = (f) =>
  fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^export \* from "\.\/[^"]+";$/gm, "");

// The view is lifted with the extractor and the codec as ONE unit, the same way
// scripts/lib/render-cards.mjs builds it, so the numbers printed under VIEW are
// the numbers the cards are handed — not a second opinion about them.
const sec = await lift([
  fs.readFileSync("lib/server/secFields.ts", "utf8"),
  strip("lib/server/secExtract.ts"),
  strip("lib/server/secFactCodec.ts"),
  strip("lib/server/secEarningsView.ts"),
].join("\n"));
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);
const {
  SEC_FIELDS, SEC_FIELD_KEYS, extractCompanyFacts, encodeFactSet,
  rowsForField, resolve, spanDays, quartersCovered,
  buildSecEarningsView, valueOf, cell, periodLabel,
} = sec;

const defOf = (key) => SEC_FIELDS.find((f) => f.key === key);
const money = (v) =>
  v === null || v === undefined ? "null"
    : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}bn`
    : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}m`
    : String(v);
const mark = (c) => (c?.derived ? `(${c.derived[0].toUpperCase()})` : "");

const TARGETS = (process.env.SYMBOLS || "GEV:capex KTOS:capex,cash")
  .split(/\s+/).filter(Boolean)
  .map((spec) => {
    const [symbol, fields] = spec.split(":");
    return { symbol: symbol.toUpperCase(), fields: (fields ?? "").split(",").filter(Boolean) };
  });

const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

/**
 * (1) EXTRACTION — every cumulative frame for one field, as the shipped
 * resolver reads it, grouped exactly as extractCompanyFacts groups them.
 *
 * Prints each fiscal year's frame ladder with the TAG THAT WON that frame, so
 * the two failure modes are visible without interpretation:
 *   - a rung missing: `n=2` present with no `n=1` — nothing to subtract.
 *   - a rung under a different tag: the differencing refuses, by design, and
 *     the refusal is in the extractor's own `notes`.
 */
function frameLadder(facts, key, limitYears = 3) {
  const field = defOf(key);
  if (!field) return [`      (no field definition for ${key})`];
  const byPeriod = new Map();
  for (const c of rowsForField(facts, field)) {
    const k = `${c.row.start ?? ""}..${c.row.end}`;
    const list = byPeriod.get(k);
    if (list) list.push(c); else byPeriod.set(k, [c]);
  }
  const byStart = new Map();
  for (const [, cands] of byPeriod) {
    const best = resolve(cands);
    if (!best?.row.start || !best.row.end) continue;
    const n = quartersCovered(spanDays(best.row.start, best.row.end));
    if (n === null) continue;
    const list = byStart.get(best.row.start);
    const e = { end: best.row.end, n, tag: best.tag, ns: best.ns, val: best.row.val, filed: best.row.filed };
    if (list) list.push(e); else byStart.set(best.row.start, [e]);
  }
  const starts = [...byStart.keys()].sort().reverse().slice(0, limitYears);
  const out = [];
  for (const start of starts) {
    // One frame per length, newest filing — the same de-duplication the
    // extractor does before it differences.
    const byLen = new Map();
    for (const f of byStart.get(start)) {
      const prev = byLen.get(f.n);
      if (!prev || String(f.filed ?? "") > String(prev.filed ?? "")) byLen.set(f.n, f);
    }
    const rungs = [1, 2, 3, 4].map((n) => {
      const f = byLen.get(n);
      return f ? `n=${n} ${f.end} ${money(f.val)} <${f.tag}>` : `n=${n} ABSENT`;
    });
    out.push(`      start ${start}`);
    for (const r of rungs) out.push(`        ${r}`);
    // Name the break rather than leaving it to be spotted in the ladder.
    for (const n of [2, 3, 4]) {
      const f = byLen.get(n), p = byLen.get(n - 1);
      if (!f) continue;
      if (!p) out.push(`        >> n=${n} CANNOT DIFFERENCE: no n=${n - 1} frame`);
      else if (p.tag !== f.tag) out.push(`        >> n=${n} CANNOT DIFFERENCE: tag ${p.tag} -> ${f.tag}`);
    }
  }
  return out;
}

for (const { symbol, fields } of TARGETS) {
  const cik = tickerMap.get(symbol)?.cik;
  console.log(`\n${"=".repeat(74)}\n${symbol}${cik ? ` (CIK ${cik})` : " — NO CIK"}`);
  if (!cik) continue;
  let facts;
  if (process.env.FACTS_DIR) {
    const path = `${process.env.FACTS_DIR}/CIK${cik}.json`;
    console.log(`  *** OFFLINE: reading ${path} — NOT live companyfacts ***`);
    facts = JSON.parse(fs.readFileSync(path, "utf8"));
  } else {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
    });
    if (!res.ok) { console.log(`  HTTP ${res.status}`); continue; }
    facts = await res.json();
  }

  const set = encodeFactSet(extractCompanyFacts(symbol, facts));
  set.at = 0;
  const view = buildSecEarningsView(set);

  // ── (3) first, because it is the cheapest to rule out ────────────────────
  // If the view already holds the number, nothing upstream dropped it and the
  // blank is the card's. If the view holds null, the card is exonerated and the
  // cause is (1) or (2).
  console.log(`\n  VIEW  anchor ${view.latestLabel} (${view.latestEnd}) basis=${view.basis}`);
  console.log(`  VIEW  cash card: period=${view.cashQuality.period} basis=${view.cashQuality.basis}`);
  console.log(`        ocf=${money(view.cashQuality.operatingCashFlow.val)}${mark(view.cashQuality.operatingCashFlow)}` +
    ` capex=${money(view.cashQuality.capex.val)}${mark(view.cashQuality.capex)}` +
    ` fcf=${money(view.cashQuality.freeCashFlow)} missing=${view.cashQuality.freeCashFlowMissing ?? "none"}`);
  console.log(`  VIEW  balance asOf=${view.balance?.asOf ?? "none"} spread=${view.balanceSheetSpreadDays}d` +
    ` cash=${money(view.balance?.cash.val ?? null)} inclRestricted=${view.balance?.cashIncludesRestricted}` +
    ` sti=${money(view.balance?.shortTermInvestments.val ?? null)}` +
    ` assets=${money(view.balance?.totalAssets.val ?? null)}`);

  // ── (2) PERIOD SELECTION ────────────────────────────────────────────────
  // How full each stored instant is. A `bsAt` with two fields out of forty-six
  // beside a neighbour with thirty is the whole answer, and it is only visible
  // when the dates are listed together.
  console.log(`\n  INSTANTS stored (newest first) — bsAt is the first`);
  for (const [i, p] of set.instants.entries()) {
    const filled = p.v.filter((v) => v !== null).length;
    const named = SEC_FIELD_KEYS.filter((k) => valueOf(p, k) !== null);
    console.log(
      `    ${i === 0 ? "->" : "  "} ${p.e}  ${String(filled).padStart(2)}/${p.v.length} filled` +
      `  cash=${money(valueOf(p, "cash"))} inclRestr=${money(valueOf(p, "cashIncludingRestricted"))}` +
      (filled <= 4 ? `  fields: ${named.join(",")}` : "")
    );
  }

  // The quarter ladder for the same reason: which stored quarter holds which of
  // the two cash-flow legs. `quarterHasCash` reads only the first of them.
  console.log(`\n  QUARTERS stored (newest 6) — ocf / capex`);
  for (const p of set.quarters.slice(0, 6)) {
    console.log(`     ${periodLabel(p)} ${p.e}  ocf=${money(valueOf(p, "operatingCashFlow"))}${mark(cell(p, "operatingCashFlow"))}` +
      `  capex=${money(valueOf(p, "capex"))}${mark(cell(p, "capex"))}`);
  }
  console.log(`  YEARS stored (newest 3) — ocf / capex`);
  for (const p of set.years.slice(0, 3)) {
    console.log(`     ${periodLabel(p)} ${p.e}  ocf=${money(valueOf(p, "operatingCashFlow"))}${mark(cell(p, "operatingCashFlow"))}` +
      `  capex=${money(valueOf(p, "capex"))}${mark(cell(p, "capex"))}`);
  }

  // ── (1) EXTRACTION ──────────────────────────────────────────────────────
  for (const key of fields) {
    const field = defOf(key);
    console.log(`\n  --- ${key} (${field?.kind ?? "?"})`);
    if (field?.kind === "instant") {
      // An instant is never differenced, so its ladder is meaningless. What
      // matters is WHICH DATES it was tagged at, against the dates stored.
      const rows = rowsForField(facts, field)
        .filter((c) => !c.row.start && c.row.end)
        .sort((a, b) => (a.row.end < b.row.end ? 1 : -1))
        .slice(0, 8);
      console.log(`      chain: ${[...(field.chain ?? []), ...(field.ifrsChain ?? [])].join(" -> ")}`);
      for (const c of rows) {
        console.log(`        ${c.row.end}  ${money(c.row.val)}  <${c.tag}> rank=${c.rank} filed=${c.row.filed}`);
      }
      const stored = new Set(set.instants.map((p) => p.e));
      const missed = rows.map((c) => c.row.end).filter((e) => !stored.has(e));
      if (missed.length) console.log(`        >> TAGGED AT DATES NOT IN THE STORED WINDOW: ${[...new Set(missed)].join(", ")}`);
      // THE VERDICT, NAMED. Stored under a date the card does not read is a
      // different defect from not stored at all, and the two look identical in
      // a list of dates.
      const bsAt = set.instants[0] ?? null;
      const newest = rows[0]?.row.end ?? null;
      if (bsAt && newest && bsAt.e !== newest && stored.has(newest)) {
        console.log(
          `        >> STORED BUT NOT READ: newest ${key} is ${newest}; the card reads instants[0] = ${bsAt.e}` +
          ` (${bsAt.v.filter((v) => v !== null).length}/${bsAt.v.length} filled)`
        );
      }
    } else {
      for (const line of frameLadder(facts, key)) console.log(line);
    }
  }

  const notes = (set.notes ?? []).filter((n) => fields.some((f) => n.startsWith(`${f} `)));
  console.log(`\n  NOTES for these fields: ${notes.length ? "" : "(none)"}`);
  for (const n of notes) console.log(`    ${n}`);

  await new Promise((r) => setTimeout(r, 150));
}
