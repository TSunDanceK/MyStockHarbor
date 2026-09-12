// Which venue lists the 700, by count AND by dollar volume — and what a
// Nasdaq-only universe would actually leave on the page.
//
// WHY THIS IS THE DECISION-RELEVANT MEASUREMENT. The exchange plans price the two
// halves of the tape differently at source. UTP (Tape C, Nasdaq-listed) charges
// NOTHING for delayed or end-of-day data on controlled products; CTA (Tapes A and
// B, NYSE / NYSE American / Arca) publishes indirect-access fees for delayed data
// -- $750/mo Network A last sale, $400/mo Network B, more for quotation -- and
// whether a pure EOD product escapes those is NOT stated in the policy and is not
// assumed here. So the pass-through cost of the Nasdaq half is zero and the NYSE
// half is not, which makes the split a pricing input rather than trivia.
//
// A SYMBOL COUNT IS THE WRONG NUMBER ON ITS OWN. A 50/50 split where NYSE holds
// the liquid names is a completely different product from an even one, so the
// dollar-volume weighting is reported alongside and is the figure the decision
// should turn on.
//
// AND THE PRODUCT QUESTION IS NOT THE PERCENTAGE. A section falling from 20 names
// to 3 is a page not worth publishing whatever the headline says, so per-section
// membership is reported before and after.
//
// READS THE FROZEN DUMP PLUS TWO FREE REFERENCE FILES. No vendor, no key, no new
// data source, nothing that needs a licence.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";

const DIR = path.resolve(process.argv[2] ?? "step0-dump");
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; listing-venue analysis)";

// Listing Exchange codes in Nasdaq's own file. Tape assignment follows the
// LISTING venue, which is what the plans bill on -- not where a trade printed.
const VENUE = {
  Q: { name: "Nasdaq", tape: "C (UTP)" },
  N: { name: "NYSE", tape: "A (CTA)" },
  A: { name: "NYSE American", tape: "B (CTA)" },
  P: { name: "NYSE Arca", tape: "B (CTA)" },
  Z: { name: "Cboe BZX", tape: "B (CTA)" },
  V: { name: "IEX", tape: "B (CTA)" },
};

const readJson = (name) => {
  const p = path.join(DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};

const fetchText = async (url, label) => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const text = await res.text();
  // THE SAME STRICTNESS THAT CAUGHT STOOQ: a 200 carrying HTML is not data.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(`${label}: got HTML, not data — "${text.slice(0, 160).replace(/\s+/g, " ")}"`);
  }
  return text;
};

console.log("LISTING SPLIT OF THE 700 — venue by count, by dollar volume, and by section");

// ── The universe ─────────────────────────────────────────────────────────────
const universe = readJson("universe.json");
const analysis = (universe?.pickersSymbolsKey ?? []).map(String);
if (!analysis.length) {
  console.error(`FATAL: no pickersSymbolsKey in ${DIR}/universe.json — nothing to classify.`);
  process.exit(2);
}
console.log(`analysis universe: ${analysis.length} symbols`);

// ── Reference file 1: Nasdaq's own traded list (definitive, carries an ETF flag)
const venueBySymbol = new Map();
const isEtf = new Map();
let nasdaqFileOk = false;
try {
  const txt = await fetchText(
    "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt",
    "nasdaqtraded.txt"
  );
  const lines = txt.split(/\r?\n/);
  const header = lines[0].split("|");
  const iSym = header.indexOf("Symbol");
  const iEx = header.indexOf("Listing Exchange");
  const iEtf = header.indexOf("ETF");
  const iTest = header.indexOf("Test Issue");
  if (iSym < 0 || iEx < 0) throw new Error(`unexpected header: ${lines[0].slice(0, 120)}`);
  let rows = 0;
  for (const line of lines.slice(1)) {
    const f = line.split("|");
    if (f.length < header.length) continue; // trailing "File Creation Time" line
    if (iTest >= 0 && f[iTest] === "Y") continue;
    const sym = f[iSym]?.trim();
    if (!sym) continue;
    venueBySymbol.set(sym, f[iEx]?.trim());
    if (iEtf >= 0) isEtf.set(sym, f[iEtf]?.trim() === "Y");
    rows++;
  }
  nasdaqFileOk = rows > 1000;
  console.log(`nasdaqtraded.txt: ${rows} rows, ETF flag ${iEtf >= 0 ? "present" : "ABSENT"}`);
} catch (e) {
  console.log(`nasdaqtraded.txt UNREACHABLE: ${String(e?.message ?? e)}`);
}

// ── Reference file 2: SEC's exchange map, as an independent second opinion ────
// TWO SOURCES BECAUSE ONE COULD BE WRONG OR UNREACHABLE, and a venue split built
// on a single unverifiable file is the shape that has bitten repeatedly today.
const secVenue = new Map();
let secFileOk = false;
try {
  const txt = await fetchText(
    "https://www.sec.gov/files/company_tickers_exchange.json",
    "company_tickers_exchange.json"
  );
  const j = JSON.parse(txt);
  const fields = j?.fields ?? [];
  const iT = fields.indexOf("ticker");
  const iE = fields.indexOf("exchange");
  for (const row of j?.data ?? []) {
    const t = row?.[iT];
    const e = row?.[iE];
    if (t && e) secVenue.set(String(t), String(e));
  }
  secFileOk = secVenue.size > 1000;
  console.log(`company_tickers_exchange.json: ${secVenue.size} tickers`);
} catch (e) {
  console.log(`company_tickers_exchange.json UNREACHABLE: ${String(e?.message ?? e)}`);
}

if (!nasdaqFileOk && !secFileOk) {
  console.error("FATAL: neither reference file was usable. Refusing to report a split from nothing.");
  process.exit(2);
}

// THE DOT/DASH PROBLEM AGAIN, third convention of the day. The repo stores BRK.B;
// both reference files use the dashed form. Resolved by trying both rather than
// assuming, and the misses are reported so an unresolved symbol is visible rather
// than silently filed as "other".
const lookupVenue = (sym) => {
  const alts = [sym, sym.replace(/\./g, "-"), sym.replace(/-/g, ".")];
  for (const a of alts) {
    const v = venueBySymbol.get(a);
    if (v) return { code: v, via: "nasdaqtraded", matched: a };
  }
  for (const a of alts) {
    const v = secVenue.get(a);
    if (v) return { code: null, sec: v, via: "sec", matched: a };
  }
  return { code: null, via: null };
};

// ── Dollar volume from the frozen bars ───────────────────────────────────────
// MEAN DAILY DOLLAR VOLUME OVER THE LAST 60 SESSIONS, not a single day. One day
// can be an earnings print or an index rebalance, and weighting a licensing
// decision on one session's tape would be a denominator error of its own.
const SESSIONS = Number(process.env.DV_SESSIONS ?? 60);
const dollarVol = new Map();
{
  const barsPath = path.join(DIR, "history-bars.ndjson.gz");
  if (!fs.existsSync(barsPath)) {
    console.error(`FATAL: no history-bars.ndjson.gz in ${DIR} — cannot weight by dollar volume.`);
    process.exit(2);
  }
  const want = new Set(analysis);
  const rl = readline.createInterface({
    input: fs.createReadStream(barsPath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row?._meta || !row?.symbol) continue;
      const sym = String(row.symbol);
      if (!want.has(sym)) continue;
      const daily = (Array.isArray(row?.entry?.daily) ? row.entry.daily : []).slice(-SESSIONS);
      const vals = daily
        .filter((b) => typeof b?.close === "number" && typeof b?.volume === "number" && b.volume > 0)
        .map((b) => b.close * b.volume);
      if (vals.length) dollarVol.set(sym, vals.reduce((a, b) => a + b, 0) / vals.length);
    } catch {
      // a truncated final line is not worth failing the analysis over
    }
  }
}
console.log(`dollar volume: ${dollarVol.size} of ${analysis.length} symbols have ${SESSIONS}-session data`);

// ── 1 & 2. The split, by count and by dollar volume ──────────────────────────
const byVenue = new Map();
const unresolved = [];
const disagreements = [];
const nasdaqSet = new Set();
for (const sym of analysis) {
  const hit = lookupVenue(sym);
  let label;
  if (hit.code && VENUE[hit.code]) label = VENUE[hit.code].name;
  else if (hit.code) label = `other (${hit.code})`;
  else if (hit.sec) label = `${hit.sec} (SEC only)`;
  else {
    label = "UNRESOLVED";
    unresolved.push(sym);
  }
  // CROSS-CHECK THE TWO FILES where both have an opinion. A disagreement is a
  // finding, not something to average away.
  if (hit.code && VENUE[hit.code]) {
    const s = secVenue.get(hit.matched) ?? secVenue.get(sym);
    const secSaysNasdaq = /nasdaq/i.test(s ?? "");
    const nasdaqSaysNasdaq = hit.code === "Q";
    if (s && secSaysNasdaq !== nasdaqSaysNasdaq) {
      disagreements.push({ symbol: sym, nasdaqFile: hit.code, sec: s });
    }
  }
  if (hit.code === "Q") nasdaqSet.add(sym);
  if (!byVenue.has(label)) byVenue.set(label, { count: 0, dv: 0, symbols: [] });
  const e = byVenue.get(label);
  e.count++;
  e.dv += dollarVol.get(sym) ?? 0;
  e.symbols.push(sym);
}
const totalDv = [...byVenue.values()].reduce((a, e) => a + e.dv, 0);
const rows = [...byVenue.entries()].sort((a, b) => b[1].dv - a[1].dv);

console.log(`\n══ 1 & 2. VENUE SPLIT — by count and by mean daily dollar volume ══`);
console.log(`  venue                 count      % count            $ volume      % $ vol   tape`);
for (const [label, e] of rows) {
  const code = [...Object.entries(VENUE)].find(([, v]) => v.name === label)?.[0];
  const tape = code ? VENUE[code].tape : "—";
  console.log(
    `  ${label.padEnd(20)} ${String(e.count).padStart(5)}   ${((e.count / analysis.length) * 100).toFixed(1).padStart(6)}%   ` +
      `${e.dv.toExponential(3).padStart(11)}   ${((e.dv / totalDv) * 100).toFixed(1).padStart(6)}%   ${tape}`
  );
}
const nasdaqCount = byVenue.get("Nasdaq")?.count ?? 0;
const nasdaqDv = byVenue.get("Nasdaq")?.dv ?? 0;
const nasdaqDvPct = (nasdaqDv / totalDv) * 100;
console.log(`\n  NASDAQ (tape C, zero exchange pass-through for EOD):`);
console.log(`    by count         ${nasdaqCount} / ${analysis.length}  ${((nasdaqCount / analysis.length) * 100).toFixed(1)}%`);
console.log(`    BY DOLLAR VOLUME ${nasdaqDvPct.toFixed(1)}%   <- THE DECISION-RELEVANT NUMBER`);
console.log(
  nasdaqDvPct >= 60
    ? `    >>> >=60%: a Nasdaq-only fallback is viable, and the zero-cost half of the\n        licensing problem covers most of the site.`
    : nasdaqDvPct >= 45
      ? `    >>> 45-60%: genuinely split. Neither half is the site on its own, and a\n        Nasdaq-only build loses about half the liquidity.`
      : `    >>> <45%: THE NYSE HALF IS THE SITE. A Nasdaq-only plan is a stunt rather\n        than a product, and the CTA fees are unavoidable if bars are served at all.`
);
if (unresolved.length) {
  console.log(`\n  UNRESOLVED (in neither reference file): ${unresolved.length}`);
  console.log(`    ${unresolved.slice(0, 40).join(", ")}${unresolved.length > 40 ? ", ..." : ""}`);
}
console.log(
  disagreements.length
    ? `\n  ⚠ THE TWO REFERENCE FILES DISAGREE on ${disagreements.length} symbol(s):\n` +
      disagreements.slice(0, 20).map((d) => `    ${d.symbol}: nasdaqtraded=${d.nasdaqFile} sec="${d.sec}"`).join("\n")
    : `\n  the two reference files agree on Nasdaq-vs-not for every symbol both cover`
);

// ── 3. What a Nasdaq-only universe leaves on the page ────────────────────────
// THE METHOD AND ITS LIMIT, stated up front. Section membership is filtered from
// the FROZEN payload rather than recomputed, because recomputing the signals would
// mean reimplementing pickersBuilder -- and a reimplementation cannot be evidence
// about the thing it reimplements. The consequence is that the filtered count is
// EXACT for a section showing every qualifier (foundCount == shownCount) and a
// LOWER BOUND for a capped section, where removing NYSE names would promote more
// Nasdaq names into the cap. Both are labelled.
const payload = readJson("pickers-payload.json");
const sections = payload?.data?.sections ?? payload?.sections ?? [];
console.log(`\n══ 3. SECTIONS UNDER A NASDAQ-ONLY UNIVERSE ══`);
if (!sections.length) {
  console.log(`  no sections found in the frozen payload — cannot answer this part.`);
} else {
  console.log(`  ${"section".padEnd(52)} now  nasdaq   basis`);
  const sectionOut = [];
  for (const s of sections) {
    const items = Array.isArray(s?.items) ? s.items : [];
    const kept = items.filter((it) => nasdaqSet.has(String(it?.symbol)));
    const capped = typeof s?.foundCount === "number" && typeof s?.shownCount === "number"
      ? s.foundCount > s.shownCount
      : null;
    const basis = capped === null ? "unknown" : capped ? "LOWER BOUND (capped)" : "exact (shows all)";
    console.log(
      `  ${String(s.title ?? "?").slice(0, 52).padEnd(52)} ${String(items.length).padStart(3)}  ${String(kept.length).padStart(6)}   ${basis}`
    );
    sectionOut.push({
      title: s.title,
      now: items.length,
      nasdaqOnly: kept.length,
      foundCount: s.foundCount ?? null,
      shownCount: s.shownCount ?? null,
      capped,
      basis,
    });
  }
  const dead = sectionOut.filter((s) => s.nasdaqOnly <= 3);
  const halved = sectionOut.filter((s) => s.nasdaqOnly > 3 && s.now > 0 && s.nasdaqOnly / s.now < 0.5);
  console.log(`\n  sections left with <=3 names: ${dead.length} of ${sectionOut.length}`);
  for (const s of dead) console.log(`    ${s.now} -> ${s.nasdaqOnly}   ${s.title}`);
  console.log(`  sections losing more than half: ${halved.length}`);
  for (const s of halved) console.log(`    ${s.now} -> ${s.nasdaqOnly}   ${s.title}`);
  fs.writeFileSync(path.join(DIR, "LISTING-SECTIONS.json"), JSON.stringify(sectionOut, null, 2));
}

// ── 4. The benchmark tiles ───────────────────────────────────────────────────
console.log(`\n══ 4. BENCHMARK TILES (benchmarksBuilder: SPY / QQQ / DIA / IWM) ══`);
const benchOut = [];
for (const t of ["SPY", "QQQ", "DIA", "IWM"]) {
  const hit = lookupVenue(t);
  const venue = hit.code && VENUE[hit.code] ? VENUE[hit.code] : null;
  const etf = isEtf.get(t);
  const survives = hit.code === "Q";
  console.log(
    `  ${t}  ${(venue?.name ?? hit.sec ?? "UNRESOLVED").padEnd(15)} tape ${(venue?.tape ?? "—").padEnd(9)} ` +
      `ETF=${etf === undefined ? "?" : etf ? "Y" : "N"}  ${survives ? "SURVIVES Nasdaq-only" : "LOST under Nasdaq-only"}`
  );
  benchOut.push({ symbol: t, code: hit.code ?? null, venue: venue?.name ?? hit.sec ?? null, tape: venue?.tape ?? null, etf: etf ?? null, survives });
}
const surviving = benchOut.filter((b) => b.survives).map((b) => b.symbol);
console.log(`\n  benchmark row: ${surviving.length} of 4 tiles survive` +
  (surviving.length ? ` — ${surviving.join(", ")}` : ""));

const outPath = path.join(DIR, "LISTING-SPLIT.json");
fs.writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      universeSize: analysis.length,
      sessionsForDollarVolume: SESSIONS,
      sources: { nasdaqtraded: nasdaqFileOk, secExchange: secFileOk },
      byVenue: rows.map(([label, e]) => ({
        venue: label,
        count: e.count,
        pctCount: (e.count / analysis.length) * 100,
        dollarVolume: e.dv,
        pctDollarVolume: (e.dv / totalDv) * 100,
      })),
      nasdaqPctCount: (nasdaqCount / analysis.length) * 100,
      nasdaqPctDollarVolume: nasdaqDvPct,
      unresolved,
      disagreements,
      benchmarks: benchOut,
    },
    null,
    2
  )
);
console.log(`\nwrote ${path.relative(process.cwd(), outPath)}`);
