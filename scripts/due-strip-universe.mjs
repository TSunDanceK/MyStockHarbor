// Generate the due strip's static top-50 membership list.
//
// WHY A STATIC LIST AT ALL. The strip is a CUT -- the largest companies with
// results outstanding, not a census -- and the cut is by market cap. Computing
// that live would couple the strip to the whole-market bars migration and block
// a page that otherwise works with no vendor at all. Membership moves a few
// names a quarter, so it is frozen with its generation date visible.
//
// ── THIS IS PERMANENT, NOT AN INTERIM V1 SIMPLIFICATION (2026-09-21) ───────
// It was written as a stopgap for stage 5, which would have replaced it with a
// live ranking off a whole-market bars pipeline. OWNER DECISION 4/5 OF
// 2026-09-21 PUT BOTH OFF THE ROADMAP -- closed, not deferred. There is no
// budget for a paid bars source (Tiingo and the rest declined 2026-09-12 and
// reconfirmed), and the free route is gone: Stooq was eliminated from three
// independent egress paths (GitHub runner, a residential UK browser, and Vercel
// iad1), so it is not a datacentre-IP problem, not a rate limit, and not a
// retry candidate.
//
// So this file is the design, not a placeholder in front of one. It keeps its
// periodic regeneration and its visible generation date, and nothing is waiting
// to replace it. Do not reintroduce a TODO pointing at a live ranking.
//
// WHAT IS FROZEN IS MEMBERSHIP, NOT A READING. data/static-profile.json's own
// header is explicit that freezing marketCap "puts a stale number on a live page,
// which is worse than an absent row because a reader cannot tell it is stale",
// and check-static-profile.mjs enforces it. That rule is about DISPLAYED
// readings. This file carries tickers and a date and no cap figure at all, so
// nothing stale can reach a page through it -- the worst a stale list can do is
// include a company that has slipped to 55th, which is a membership question the
// generation date already exposes.
//
// FPIs ARE INCLUDED, and that is not the same as the market-cap column's rule.
// The column will refuse a cap for foreign private issuers because computing one
// from SEC shares x price is wrong for ADS ratios (TSM is 1 ADS = 5 ordinary).
// These caps are not computed that way -- they are the pool's own figures -- so
// the flaw does not apply and excluding them here would drop five of the largest
// listed companies from the strip for a reason that is not true of this input.
//
// READ-ONLY. No network, no Redis, no FMP: one frozen Step 0 dump, arithmetic,
// and a payload on stdout.
//
//   relay task: due-strip-universe  (dispatch with a run_id carrying a step 0 dump)
import fs from "node:fs";
import path from "node:path";
import { emitPayload } from "./lib/relay-capture.mjs";

const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
const CUT = 50;

if (!DUMP) {
  console.error("FATAL: no dump directory. Dispatch the relay with a run_id carrying a step 0 dump.");
  process.exit(2);
}
const readJson = (n) => {
  const f = path.join(DUMP, n);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
};

const universeDoc = readJson("universe.json");
if (!universeDoc) { console.error("FATAL: universe.json missing from the dump."); process.exit(1); }
const analysis = [...new Set((universeDoc.pickersSymbolsKey ?? []).map((s) => String(s).toUpperCase()))];
if (analysis.length < 100) {
  console.error(`FATAL: analysis universe read ${analysis.length} symbols — too short to cut a top ${CUT} from.`);
  process.exit(1);
}

// ── ONE SOURCE WAS NOT ENOUGH, AND THE COUNTERS DID NOT SAY SO ────────────
//
// The first run read market caps from price-pool.json alone and reported 840
// entries, 0 unparseable and 99.4% universe coverage. Every counter green, and
// the resulting "top 50 by market cap" had NVDA nowhere in it: NVDA is in the
// analysis universe and is one of the six pool entries carrying no usable cap.
// Coverage of 99.4% and "the largest company in the list is missing" are the
// same run.
//
// So caps are read from every dataset in the dump that carries one, WIDEST
// FIRST, and a later source only fills a gap -- the same precedence rule
// static-profile-build.mjs uses for sector and industry. Per-source counts are
// reported because "the pool answered for it" and "something answered for it"
// are different facts and only one of them was being measured.
//
// ── CORRECTED 2026-09-21: THE 2026-09-15 "834 -> 834" CONCLUSION WAS WRONG,
// AND IT WAS WRONG BECAUSE OF THIS FILE, NOT BECAUSE OF THE DUMP ───────────
// The dump does not wrap every dataset the same way: price-pool.json carries
// its rows under `.value`, but screener-fundamentals.json, fundamentals.json
// and stockdata.json carry theirs under `.values` (plural). entriesOf() below
// only ever unwrapped `.value`, so for the other three it fell through to the
// bare wrapper object and enumerated ITS five keys (dumpedAt, dataset, key,
// present, values) as if they were ticker symbols -- which is exactly why
// three files of 176 KB, 650 KB and 680 KB each reported "5 entries" and
// contributed nothing. The sources were never actually read, so "nothing in
// the step 0 dump prices NVDA" was a claim about a reader, not about the data.
// See claude/BRIEF-price-pool-missing-market-cap-2026-09-21.md for the full
// measurement (probe: scripts/pricepool-cap-gap-probe.mjs).
//
// With the reader fixed, fundamentals.json alone prices 699 of 700 universe
// symbols including NVDA, and screener-fundamentals.json prices 693 of 700.
// Two smaller, separate issues remain and are NOT fixed here (recorded in the
// brief above, not silently folded into this change): a handful of price-pool
// rows carry a real partial-write (null marketCap/volume/OHLC together), and
// BRK.B/BRK-B is a spelling split across sources that this reader does not
// reconcile (lib/symbolSpellings.mjs exists for that and isn't wired in here).
const CAP_SOURCES = ["price-pool.json", "screener-fundamentals.json", "fundamentals.json", "stockdata.json"];

/**
 * Symbol -> entry, from either a {SYM: entry} map or an array of {symbol,...}.
 *
 * The step 0 dump wraps datasets in two different shapes: price-pool.json as
 * `{ ..., value }` and the other three as `{ ..., values }` (plural). Both
 * must be checked -- `.value ?? .values ?? doc` -- or the plural-wrapped
 * sources silently fall through to the wrapper object itself and get read as
 * five bogus "symbols" (dumpedAt/dataset/key/present/values). See the header
 * comment above for what that cost.
 */
function entriesOf(doc) {
  const v = doc?.value ?? doc?.values ?? doc;
  if (Array.isArray(v)) {
    const out = [];
    for (const e of v) { const sym = e?.symbol ?? e?.ticker; if (sym) out.push([String(sym), e]); }
    return out;
  }
  if (v && typeof v === "object") return Object.entries(v);
  return [];
}

const capOf = (e) => {
  let x = e;
  if (typeof x === "string") { try { x = JSON.parse(x); } catch { return null; } }
  for (const k of ["marketCap", "mktCap", "marketCapitalization"]) {
    const n = Number(x?.[k]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
};

const marketCap = new Map();
const capSource = new Map();
for (const name of CAP_SOURCES) {
  const doc = readJson(name);
  if (doc == null) { console.log(`[due-universe] ${name}: ABSENT from this dump`); continue; }
  const rows = entriesOf(doc);
  let filled = 0, alreadyKnown = 0, noCap = 0;
  for (const [sym, e] of rows) {
    const S = String(sym).toUpperCase();
    const mc = capOf(e);
    if (mc == null) { noCap++; continue; }
    if (marketCap.has(S)) { alreadyKnown++; continue; }
    marketCap.set(S, mc);
    capSource.set(S, name);
    filled++;
  }
  console.log(`[due-universe] ${name}: ${rows.length} entries · ${filled} new caps · ${alreadyKnown} already known · ${noCap} carrying no usable cap`);
}

const withCap = analysis.filter((s) => marketCap.has(s));
console.log(`[due-universe] caps assembled: ${marketCap.size} symbols from ${CAP_SOURCES.length} candidate sources`);
console.log(`[due-universe] analysis universe: ${analysis.length} symbols · ${withCap.length} with a cap (${((withCap.length / analysis.length) * 100).toFixed(1)}%)`);

if (withCap.length < CUT * 4) {
  console.error(
    `FATAL: only ${withCap.length} of ${analysis.length} analysis symbols have a pool cap. A top ` +
      `${CUT} drawn from that is a top ${CUT} of whatever the pool happened to answer for, not of ` +
      `the universe, and nothing downstream could tell the difference.`
  );
  process.exit(1);
}

const ranked = withCap.slice().sort((a, b) => marketCap.get(b) - marketCap.get(a));
const top = ranked.slice(0, CUT);

// ── THE CANARY, BECAUSE HEALTHY COUNTERS DO NOT MEAN A HEALTHY LIST ───────
//
// The first run of this script reported 840 pool entries, 0 unparseable and
// 99.4% universe coverage -- every counter green -- and produced a "top 50 by
// market cap" with NVDA nowhere in it. Coverage counts answer "did the input
// arrive"; they cannot answer "is the ranking the thing it claims to be", and
// the second question is the one a default-sorted page depends on.
//
// So a handful of names that cannot plausibly sit outside a top 50 of US-listed
// companies are checked by NAME, and a miss is attributed to one of exactly
// three causes rather than left as a shrug. It is a hard failure: a list that
// omits one of these is wrong whichever cause it is, and the right response is
// to fix the input, not to ship the list and reason about it later.
const CANARIES = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META"];
const rankOf = (s) => { const i = ranked.indexOf(s); return i < 0 ? null : i + 1; };
const missing = CANARIES.filter((c) => !top.includes(c));
console.log(`[due-universe] canaries: ${CANARIES.map((c) => `${c}=${top.includes(c) ? `#${rankOf(c)}(${capSource.get(c)})` : "MISSING"}`).join(" ")}`);
if (missing.length) {
  console.error(`\nFATAL: ${missing.length} of ${CANARIES.length} canary symbols are not in the top ${CUT}. Attribution:`);
  for (const c of missing) {
    const inUniverse = analysis.includes(c);
    const hasCap = marketCap.has(c);
    const src = capSource.get(c) ?? "none";
    const rank = rankOf(c);
    console.error(
      `  ${c}: in analysis universe=${inUniverse} · has a cap=${hasCap} (source: ${src}) · ` +
        (rank == null ? "never ranked" : `ranked #${rank} of ${ranked.length}`)
    );
  }
  console.error(
    `\nAll three causes produce the same empty space in the list and mean different things:\n` +
      `  not in the universe  -> the analysis universe is the wrong input for a cap ranking\n` +
      `  no cap in any source -> nothing in the dump priced it; the cut is of what answered\n` +
      `  ranked below the cut -> the caps themselves are wrong or stale\n` +
      `Fix the input. Do not widen CUT to paper over it.`
  );
  process.exit(1);
}

// The ranks either side of the cut, so a suspicious ordering is visible rather
// than inferred from the membership list.
console.log(`[due-universe] ranks 45-55: ${ranked.slice(44, 55).map((s, i) => `${i + 45}.${s}`).join(" ")}`);

// ── HOW STABLE IS THE BOUNDARY? ───────────────────────────────────────────
// The only thing that can go stale here is the edge of the cut, so the ratio
// between the last name in and the first name out is the staleness signal. A
// ratio near 1.00 means the two are interchangeable and the list will churn; a
// wide one means the cut is decisive. Reported as a RATIO, not as two cap
// figures -- the figures are readings and do not belong in a committed artefact
// or, by the same argument, a log that gets pasted into one.
const edgeRatio = ranked.length > CUT ? marketCap.get(top[CUT - 1]) / marketCap.get(ranked[CUT]) : null;
console.log(`[due-universe] boundary: rank ${CUT} / rank ${CUT + 1} cap ratio = ${edgeRatio == null ? "n/a" : edgeRatio.toFixed(3)}`);
console.log(`[due-universe] top ${CUT}: ${top.join(" ")}`);

const doc = {
  _comment:
    "The due strip's top-50 membership, frozen. The strip is a CUT -- the largest companies " +
    "with results outstanding, not a census -- and this is the cut. Membership only: no market " +
    "cap figure is stored, because a frozen reading on a live page is worse than an absent one " +
    "(see data/static-profile.json). Regenerate with the relay task \"due-strip-universe\" " +
    "against a fresh step 0 dump; do not hand-edit. This list is PERMANENT: the live ranking " +
    "that would have replaced it was taken off the roadmap on 2026-09-21 along with the " +
    "whole-market bars migration it depended on.",
  generatedAt: new Date().toISOString().slice(0, 10),
  source: `step 0 dump ${path.basename(DUMP)} · marketCap from ${CAP_SOURCES.join(" -> ")} (widest first, later sources fill gaps only) · analysis universe ${analysis.length} symbols, ${withCap.length} with a cap`,
  cut: CUT,
  symbols: top,
};

emitPayload("due-strip-universe", JSON.stringify(doc, null, 2));
