// P/E VS ITS SECTOR'S MEDIAN (#552 COWORK #147 §2, the CODE-A #150 census).
//
// Pinned here, RUN on the shipped pure module (lib/peSectorLine.ts):
//   1. the words: within ±15% of the median → "Near", above → "Above", below →
//      "Below", each with its glyph; the median printed to one decimal with ×;
//   2. no line: fewer than 20 peers, a median that moves more than ±25% on
//      half-samples, a spread that arrives as anything but a number (the Data
//      Cache is JSON: Infinity would come back null, and null <= 25 is true),
//      a loss-maker or missing P/E, no sector;
//   3. the arithmetic: the median, a deterministic half-sample spread, and
//      the "too few to say" value surviving a JSON round trip;
//   4. the copy names the peers, the sector and the date, and never says
//      cheap / expensive / buy / sell / under- or overvalued;
// and, in the page source: the line is built on the trailing P/E only (never
// the FY fallback), never for a bank, from the FMP-free sector, and drawn as a
// glyph plus words in the page's ink with the note on tap.
// A mutation for each.
//
//   node scripts/check-pe-sector-line.mjs
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (from, to) => (src) => {
  if (src.split(from).length !== 2) throw new Error(`mutation anchor must match once: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};

const FILE = "lib/peSectorLine.ts";
const RAW = fs.readFileSync(FILE, "utf8");
async function load(mutate = (s) => s) {
  const src = mutate(RAW);
  if (src === RAW) return import(`../${FILE}`);
  const tmp = `lib/.check-pe-sector-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, src);
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}

const M = (median, n = 40, spreadPct = 10) => ({ median, n, spreadPct });
const DATE = "2 Oct 2026";
const BANNED = /\b(cheap|cheaper|expensive|buy|sell|undervalued|overvalued|bargain)\b/i;

const RULES = {
  // ── 1. the words ───────────────────────────────────────────────────────
  "within ±15% of the median reads Near (●), at both edges": (P) =>
    P.peSectorLine(23, "Industrials", M(20), DATE)?.word === "Near" && P.peSectorLine(17, "Industrials", M(20), DATE)?.word === "Near"
    && P.peSectorLine(23, "Industrials", M(20), DATE)?.glyph === "●",
  "beyond +15% reads Above (▲), beyond −15% Below (▼)": (P) =>
    P.peSectorLine(23.2, "Industrials", M(20), DATE)?.word === "Above" && P.peSectorLine(23.2, "Industrials", M(20), DATE)?.glyph === "▲"
    && P.peSectorLine(16.8, "Industrials", M(20), DATE)?.word === "Below" && P.peSectorLine(16.8, "Industrials", M(20), DATE)?.glyph === "▼",
  "the text names the comparison and the median to one decimal": (P) =>
    P.peSectorLine(30, "Technology", M(21.54), DATE)?.text === "Above sector median (21.5×)",

  // ── 2. no line ─────────────────────────────────────────────────────────
  "fewer than 20 peers: no line (20 is enough)": (P) =>
    P.peSectorLine(30, "Energy", M(20, 19), DATE) === null && P.peSectorLine(30, "Energy", M(20, 20), DATE) !== null,
  "a median that moves more than ±25% on half-samples: no line (25 is enough)": (P) =>
    P.peSectorLine(30, "Communication Services", M(17, 23, 44), DATE) === null && P.peSectorLine(30, "Energy", M(20, 40, 25), DATE) !== null,
  "a spread that is not a number (null after a JSON round trip): no line": (P) =>
    P.peSectorLine(30, "Energy", { median: 20, n: 40, spreadPct: null }, DATE) === null,
  "a loss-maker, a missing P/E, or no sector: no line": (P) =>
    P.peSectorLine(null, "Energy", M(20), DATE) === null && P.peSectorLine(-5, "Energy", M(20), DATE) === null
    && P.peSectorLine(30, null, M(20), DATE) === null && P.peSectorLine(30, "Energy", undefined, DATE) === null,

  // ── 3. the arithmetic ──────────────────────────────────────────────────
  "the median of each sector, and its peer count": (P) => {
    const m = P.sectorMedians([{ sector: "A", pe: 10 }, { sector: "A", pe: 30 }, { sector: "A", pe: 20 }, { sector: "B", pe: 5 }, { sector: "A", pe: -3 }]);
    return m.A.median === 20 && m.A.n === 3 && m.B.n === 1;
  },
  "the half-sample spread is deterministic, and tight for a tight sector": (P) => {
    const tight = Array.from({ length: 40 }, (_, i) => 20 + (i % 5) * 0.1);
    const wide = Array.from({ length: 40 }, (_, i) => 5 + i * 3);
    const a = P.halfSampleSpreadPct(wide), b = P.halfSampleSpreadPct(wide);
    return a === b && P.halfSampleSpreadPct(tight) < 5 && a > P.halfSampleSpreadPct(tight);
  },
  "too few peers to say: a finite value that survives JSON and fails the bar": (P) => {
    const m = JSON.parse(JSON.stringify(P.sectorMedians([1, 2, 3].map((pe) => ({ sector: "A", pe: pe * 10 })))));
    return typeof m.A.spreadPct === "number" && m.A.spreadPct > P.PE_MAX_SPREAD_PCT;
  },

  // ── 4. the copy ────────────────────────────────────────────────────────
  "the note names the peer count, the sector and the date, and the near band": (P) => {
    const n = P.peSectorLine(30, "Healthcare", M(25.5, 71), DATE)?.note ?? "";
    return /\b71 Healthcare companies\b/.test(n) && n.includes(DATE) && /±15%/.test(n) && /Banks and loss-makers are left out/.test(n);
  },
  "no value words anywhere (cheap, expensive, buy, sell, under/overvalued)": (P) =>
    [23, 30, 10].every((pe) => { const l = P.peSectorLine(pe, "Energy", M(20), DATE); return l && !BANNED.test(`${l.text} ${l.note}`); })
    && P.PE_PEER_FLOOR === 20 && P.PE_NEAR_PCT === 15 && P.PE_MAX_SPREAD_PCT === 25,
};

// ── 5. the page ──────────────────────────────────────────────────────────
const PAGE = readCodeOnly("app/stock/[symbol]/page.tsx");
const CLIENT = readCodeOnly("app/stock/[symbol]/StockSymbolPageClient.tsx");
const SERVER = readCodeOnly("lib/server/peSectorMedians.ts");
const PAGE_RULES = {
  "the trailing P/E only, never the FY fallback, never a bank": (p) =>
    /if \(fyPe \|\| !pe\?\.ok \|\| isBankSic\(registrantFor\(upper\)\?\.sic\)\) return null;/.test(p),
  "the sector is the FMP-free classification, on the page and for the peers": (_p, s) =>
    /return sicProfileFor\(symbol\)\?\.sector \?\? null;/.test(s) && /const sector = peSectorOf\(sym\);/.test(s) && /const sector = peSectorOf\(upper\);/.test(_p),
  "the peers leave out banks and use the pool's own P/E (secCapAndPe)": (_p, s) =>
    /if \(isBankSic\(registrantFor\(sym\)\?\.sic\)\) continue;/.test(s) && /const pe = secCapAndPe\(row, last\.c\)\.pe;/.test(s),
  "from the Data Cache, with no new Redis key or write": (_p, s) =>
    /unstable_cache\(loadPeSectorMedians,/.test(s) && !/redis\.|Redis\.fromEnv/.test(s),
  "drawn as a glyph plus words in the page's ink, the note on tap": (_p, _s, c) =>
    /<span aria-hidden="true">\{valuation\.peSector\.glyph\} <\/span><ReasonedValue text=\{valuation\.peSector\.text\} reason=\{valuation\.peSector\.note\} \/>/.test(c)
    && !/data-pe-sector[^>]*style=/.test(c),
};

const P0 = await load();
console.log("1–4. the pure rules");
for (const [name, rule] of Object.entries(RULES)) {
  let ok = false; try { ok = Boolean(rule(P0)); } catch (e) { console.log(`    ${e?.message ?? e}`); }
  check(name, ok);
}
console.log("\n5. the page");
for (const [name, rule] of Object.entries(PAGE_RULES)) check(name, Boolean(rule(PAGE, SERVER, CLIENT)));

console.log("\nmutants: each must break a rule");
const MUTANTS = [
  ["the near band at 0%", once("export const PE_NEAR_PCT = 15;", "export const PE_NEAR_PCT = 0;")],
  ["no peer floor", once("export const PE_PEER_FLOOR = 20;", "export const PE_PEER_FLOOR = 0;")],
  ["the stability bar removed", once("|| !(m.spreadPct <= PE_MAX_SPREAD_PCT) ", "")],
  ["a null spread passes (the number test removed)", once('|| typeof m.spreadPct !== "number" ', "")],
  ["too few peers reported as Infinity again", once("if (pes.length < 6) return TOO_FEW_SPREAD;", "if (pes.length < 6) return Infinity;")],
  ["a loss-maker gets a line", once("|| pe <= 0 ", "")],
  ["a value word in the text", once("text: `${word} sector median", "text: `${word === \"Below\" ? \"Cheap vs\" : word} sector median")],
  ["above and below swapped", once(': d > 0 ? (["Above", "▲"] as const) : (["Below", "▼"] as const);', ': d > 0 ? (["Below", "▼"] as const) : (["Above", "▲"] as const);')],
];
for (const [label, mutate] of MUTANTS) {
  let bites = false;
  try {
    const P = await load(mutate);
    bites = Object.values(RULES).some((r) => { try { return !r(P); } catch { return true; } });
  } catch (e) { console.log(`    ${e.message}`); }
  check(`MUTATION: ${label} → caught`, bites);
}
const PAGE_MUTANTS = [
  ["the FY fallback gets a line", (p, s, c) => [p.replace("if (fyPe || !pe?.ok || ", "if (!pe?.ok || "), s, c]],
  ["a bank gets a line", (p, s, c) => [p.replace(" || isBankSic(registrantFor(upper)?.sic)) return null;", ") return null;"), s, c]],
  ["the peers include banks", (p, s, c) => [p, s.replace("if (isBankSic(registrantFor(sym)?.sic)) continue;", ""), c]],
  ["the line coloured by direction", (p, s, c) => [p, s, c.replace('data-pe-sector={valuation.peSector ? "" : undefined}', 'data-pe-sector={valuation.peSector ? "" : undefined} style={{ color: "#22c55e" }}')]],
];
for (const [label, mutate] of PAGE_MUTANTS) {
  const [p, s, c] = mutate(PAGE, SERVER, CLIENT);
  const changed = p !== PAGE || s !== SERVER || c !== CLIENT;
  check(`MUTATION: ${label} → caught`, changed && Object.values(PAGE_RULES).some((r) => !r(p, s, c)));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
