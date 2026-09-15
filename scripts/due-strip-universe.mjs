// Generate the due strip's static top-50 membership list.
//
// WHY A STATIC LIST AT ALL. The strip is a CUT -- the largest companies with
// results outstanding, not a census -- and the cut is by market cap. Computing
// that live would couple the strip to the whole-market bars migration (stage 4)
// and block a page that otherwise works with no vendor at all. Membership moves
// a few names a quarter, so it is frozen with its generation date visible.
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

// ── EVERY ZERO-CAPABLE COUNTER GETS A DENOMINATOR ─────────────────────────
// A top-50 list is a number that looks identical whether the pool answered for
// 700 symbols or for 51. The counters below are what makes the difference
// visible, and a thin denominator is a hard failure rather than a quiet list.
const poolRaw = readJson("price-pool.json")?.value ?? {};
let poolEntries = 0, unparseable = 0, noCap = 0;
const marketCap = new Map();
for (const [sym, v] of Object.entries(poolRaw)) {
  poolEntries++;
  let e = v;
  if (typeof e === "string") { try { e = JSON.parse(e); } catch { e = null; } }
  if (e == null) { unparseable++; continue; }
  const mc = Number(e?.marketCap);
  if (!Number.isFinite(mc) || mc <= 0) { noCap++; continue; }
  marketCap.set(String(sym).toUpperCase(), mc);
}

const withCap = analysis.filter((s) => marketCap.has(s));
console.log(`[due-universe] price pool: ${poolEntries} entries · ${unparseable} unparseable · ${noCap} carrying no usable cap · ${marketCap.size} usable`);
console.log(`[due-universe] analysis universe: ${analysis.length} symbols · ${withCap.length} with a pool cap (${((withCap.length / analysis.length) * 100).toFixed(1)}%)`);

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
    "against a fresh step 0 dump; do not hand-edit. Stage 5 of the earnings-calendar build " +
    "replaces this file with a live ranking off the whole-market bars pipeline.",
  generatedAt: new Date().toISOString().slice(0, 10),
  source: `step 0 dump ${path.basename(DUMP)} · price-pool marketCap · analysis universe ${analysis.length} symbols, ${withCap.length} with a cap`,
  cut: CUT,
  symbols: top,
};

emitPayload("due-strip-universe", JSON.stringify(doc, null, 2));
