// What a Nasdaq-only-then-refilled universe would cost, measured offline.
//
// THE PREMISE BEING TESTED. Weekly MA200 Proximity collapsing 20 -> 5 was caused
// by shrinking the universe to 230, not by Nasdaq-only as such: only 27 of 700
// qualified, so a third of the names leaves a fifth of the hits. Refilling to 700
// from the Nasdaq-listed pool should restore the hit rate. The open question is
// what the swap costs in dividend coverage, sector coverage and indexed pages.
//
// ONE LIMIT STATED UP FRONT, because it bounds question 2. Ranking the ENTRANTS by
// dollar volume needs volume for symbols the frozen dump does not contain, and
// nasdaqtraded.txt carries listing venue but no prices. So the entrants' dollar
// volume floor is NOT MEASURABLE from these artefacts. What is measurable is how
// many Nasdaq-listed names already have bars, which is the backfill question and
// the one that costs money. Reported as such rather than estimated.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";

const DIR = path.resolve(process.argv[2] ?? "step0-dump");
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; refill analysis)";
const SESSIONS = Number(process.env.DV_SESSIONS ?? 60);
const readJson = (n) => {
  const p = path.join(DIR, n);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};
const fmtUsd = (v) =>
  v == null ? "—" : v >= 1e12 ? `${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : `${(v / 1e6).toFixed(0)}M`;

console.log("NASDAQ-ONLY REFILL — what the swap costs");

// ── Venue map (same two free files as #448) ──────────────────────────────────
const venueBySymbol = new Map();
const etfFlag = new Map();
{
  const res = await fetch("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) {
    console.error(`FATAL: nasdaqtraded.txt HTTP ${res.status} — no venue map, nothing to report.`);
    process.exit(2);
  }
  const txt = await res.text();
  if (/^\s*<(!doctype|html)/i.test(txt)) {
    console.error("FATAL: nasdaqtraded.txt returned HTML, not data.");
    process.exit(2);
  }
  const lines = txt.split(/\r?\n/);
  const h = lines[0].split("|");
  const iS = h.indexOf("Symbol"), iE = h.indexOf("Listing Exchange"),
    iF = h.indexOf("ETF"), iT = h.indexOf("Test Issue");
  for (const line of lines.slice(1)) {
    const f = line.split("|");
    if (f.length < h.length) continue;
    if (iT >= 0 && f[iT] === "Y") continue;
    const s = f[iS]?.trim();
    if (!s) continue;
    venueBySymbol.set(s, f[iE]?.trim());
    etfFlag.set(s, f[iF]?.trim() === "Y");
  }
}
// The dot/dash convention, fourth appearance. Tried rather than assumed.
const venueOf = (sym) =>
  venueBySymbol.get(sym) ??
  venueBySymbol.get(sym.replace(/\./g, "-")) ??
  venueBySymbol.get(sym.replace(/-/g, ".")) ??
  null;
const isNasdaq = (sym) => venueOf(sym) === "Q";
console.log(`venue map: ${venueBySymbol.size} symbols · Nasdaq-listed in the file: ${[...venueBySymbol.values()].filter((v) => v === "Q").length}`);

// ── Frozen data ──────────────────────────────────────────────────────────────
const analysis = (readJson("universe.json")?.pickersSymbolsKey ?? []).map(String);
const fundVals = readJson("fundamentals.json")?.values ?? {};
const screenerVals = readJson("screener-fundamentals.json")?.values ?? {};
const profileVals = readJson("profile.json")?.values ?? {};
const pick = (sym, field) => {
  const alt = sym.replace(/\./g, "-");
  for (const src of [fundVals, profileVals, screenerVals]) {
    const v = src[sym]?.[field] ?? src[alt]?.[field];
    if (v != null && v !== "") return v;
  }
  return null;
};

const dollarVol = new Map();
const barSymbols = new Set();
{
  const p = path.join(DIR, "history-bars.ndjson.gz");
  const rl = readline.createInterface({
    input: fs.createReadStream(p).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row?._meta || !row?.symbol) continue;
      const sym = String(row.symbol);
      barSymbols.add(sym);
      const daily = (Array.isArray(row?.entry?.daily) ? row.entry.daily : []).slice(-SESSIONS);
      const vals = daily
        .filter((b) => typeof b?.close === "number" && typeof b?.volume === "number" && b.volume > 0)
        .map((b) => b.close * b.volume);
      if (vals.length) dollarVol.set(sym, vals.reduce((a, b) => a + b, 0) / vals.length);
    } catch { /* truncated final line */ }
  }
}
const dv = (s) => dollarVol.get(s) ?? dollarVol.get(s.replace(/\./g, "-")) ?? 0;

const nyse = analysis.filter((s) => !isNasdaq(s) && venueOf(s));
const nasdaq = analysis.filter((s) => isNasdaq(s));

// ── 1. WHAT IS BEING LOST, as companies ──────────────────────────────────────
console.log(`\n══ 1. THE ${nyse.length} NON-NASDAQ NAMES, top 50 by dollar volume ══`);
console.log(`  #   symbol   $ vol/day    market cap   sector`);
const nyseRanked = [...nyse].sort((a, b) => dv(b) - dv(a));
nyseRanked.slice(0, 50).forEach((s, i) => {
  console.log(
    `  ${String(i + 1).padStart(3)} ${s.padEnd(8)} ${fmtUsd(dv(s)).padStart(9)}    ` +
      `${fmtUsd(pick(s, "marketCap")).padStart(9)}   ${String(pick(s, "sector") ?? "—")}`
  );
});
const nyseDvTotal = nyse.reduce((a, s) => a + dv(s), 0);
const top50Dv = nyseRanked.slice(0, 50).reduce((a, s) => a + dv(s), 0);
console.log(`\n  the top 50 are ${((top50Dv / nyseDvTotal) * 100).toFixed(1)}% of all non-Nasdaq dollar volume`);
console.log(`  so the loss is CONCENTRATED: ${nyse.length} names, half the money in the top 50`);

// ── 2. THE REFILLED 700 — and the part that is not measurable ────────────────
console.log(`\n══ 2. A REFILLED 700 ══`);
const nasdaqInFile = [...venueBySymbol.entries()].filter(([, v]) => v === "Q").map(([s]) => s);
const nasdaqWithBars = nasdaqInFile.filter((s) => barSymbols.has(s) || barSymbols.has(s.replace(/-/g, ".")));
const entrantsNeeded = Math.max(0, 700 - nasdaq.length);
console.log(`  Nasdaq-listed pool (nasdaqtraded.txt):        ${nasdaqInFile.length}`);
console.log(`  already in the 700:                           ${nasdaq.length}`);
console.log(`  ENTRANTS NEEDED to refill to 700:             ${entrantsNeeded}`);
console.log(`  Nasdaq-listed symbols that already have bars: ${nasdaqWithBars.length}`);
const spareWithBars = Math.max(0, nasdaqWithBars.length - nasdaq.length);
console.log(`    of which not already in the 700:            ${spareWithBars}  <- entrants needing NO backfill`);
console.log(`  ENTRANTS NEEDING A FULL BACKFILL:             ${Math.max(0, entrantsNeeded - spareWithBars)}`);

const nasdaqDvSorted = [...nasdaq].sort((a, b) => dv(b) - dv(a));
const allDvSorted = [...analysis].sort((a, b) => dv(b) - dv(a));
console.log(`\n  TODAY'S floor (700th by dollar volume):       ${fmtUsd(dv(allDvSorted[allDvSorted.length - 1]))}/day`);
console.log(`  Nasdaq-only floor at ${nasdaq.length} names:               ${fmtUsd(dv(nasdaqDvSorted[nasdaqDvSorted.length - 1]))}/day`);
console.log(`  Nasdaq median:                               ${fmtUsd(dv(nasdaqDvSorted[Math.floor(nasdaq.length / 2)]))}/day`);
console.log(`\n  ⚠ THE ENTRANTS' DOLLAR-VOLUME FLOOR IS NOT MEASURABLE HERE.`);
console.log(`    nasdaqtraded.txt carries listing venue and no prices, and the frozen`);
console.log(`    dump has bars for only ${barSymbols.size} symbols. Ranking ${entrantsNeeded} entrants by`);
console.log(`    dollar volume needs volume for names neither artefact covers. Stating`);
console.log(`    that rather than estimating it: the floor would fall, by an unmeasured`);
console.log(`    amount, and measuring it needs one bulk quote pull from a provider.`);

// ── 3. DIVIDENDS AND SECTORS ─────────────────────────────────────────────────
console.log(`\n══ 3. DIVIDEND AND SECTOR COVERAGE ══`);
const payer = (s) => {
  const alt = s.replace(/\./g, "-");
  const d = screenerVals[s]?.lastAnnualDividend ?? screenerVals[alt]?.lastAnnualDividend;
  return typeof d === "number" && d > 0;
};
const payersAll = analysis.filter(payer);
const payersNasdaq = nasdaq.filter(payer);
console.log(`  dividend payers in the current 700:   ${payersAll.length}  (${((payersAll.length / analysis.length) * 100).toFixed(1)}%)`);
console.log(`  dividend payers among the ${nasdaq.length} Nasdaq: ${payersNasdaq.length}  (${((payersNasdaq.length / nasdaq.length) * 100).toFixed(1)}% of them)`);
console.log(`  RETENTION: ${((payersNasdaq.length / Math.max(1, payersAll.length)) * 100).toFixed(1)}% of payers survive`);
console.log(`  NOTE: a refill to 700 would add payers back, but Nasdaq's listing mix is`);
console.log(`  tech-weighted and pays less, so the rate above is the honest guide.`);

const PUBLISHABLE = 10;
const sectorCount = (syms) => {
  const m = new Map();
  for (const s of syms) {
    const sec = String(pick(s, "sector") ?? "(none)");
    m.set(sec, (m.get(sec) ?? 0) + 1);
  }
  return m;
};
const secAll = sectorCount(analysis);
const secNas = sectorCount(nasdaq);
console.log(`\n  sector                        now   nasdaq   verdict (publishable = ${PUBLISHABLE}+)`);
const sectorRows = [];
for (const [sec, n] of [...secAll.entries()].sort((a, b) => b[1] - a[1])) {
  const k = secNas.get(sec) ?? 0;
  const verdict = k === 0 ? "GONE" : k < PUBLISHABLE ? `BELOW THRESHOLD (${k})` : "ok";
  console.log(`  ${sec.slice(0, 28).padEnd(28)} ${String(n).padStart(4)}   ${String(k).padStart(6)}   ${verdict}`);
  sectorRows.push({ sector: sec, now: n, nasdaq: k, verdict });
}
const lost = sectorRows.filter((r) => r.verdict !== "ok");
console.log(`\n  sectors below a publishable count: ${lost.length} of ${sectorRows.length}`);
for (const r of lost) console.log(`    ${r.sector}: ${r.now} -> ${r.nasdaq}`);

// ── 4. THE SEO COST — and the premise needed correcting ──────────────────────
// THE 700 DOES NOT DRIVE THE PER-SYMBOL SITEMAP. app/sitemap.ts builds
// /stock/{sym}, /stock/{sym}/news and /stock/{sym}/earnings from
// curatedSymbols.ts's priorityStocks + uniqueEtfs -- a HAND-MAINTAINED list --
// not from the dynamic universe. So changing the universe drops no indexed
// per-symbol page at all. The SEO cost only exists if the curated list is ALSO
// filtered, which is a separate decision, and it is measured here as such.
console.log(`\n══ 4. THE SEO COST — the premise needed correcting ══`);
// EXTRACTED WITHOUT THE TYPESCRIPT COMPILER, deliberately. The relay's read-only
// job does not run `npm ci` -- that is an asserted property in
// check-relay-isolation.mjs, and the point of it is that the job has no client it
// could reach the database with. Importing typescript here would have forced
// npm ci into that job and traded a security guarantee for a parsing convenience.
//
// So these are read as literal arrays. A regex over source has no scope
// (claude/traps/a-regex-over-source-has-no-scope.md), which is why the counts are
// CROSS-CHECKED against the values an AST parse produced locally rather than
// trusted: a mismatch means the extraction is wrong and the job stops instead of
// reporting a page count built on a bad parse.
const curatedSrc = fs.readFileSync("lib/curatedSymbols.ts", "utf8");
const arrayNamed = (name) => {
  const m = curatedSrc.match(new RegExp(`${name}\\s*(?::[^=]*)?=\\s*\\[([\\s\\S]*?)\\]`));
  if (!m) return null;
  return [...m[1].matchAll(/"([A-Z0-9.\-]+)"/g)].map((x) => x[1]);
};
const EXPECTED = { coreMegaCaps: 41, retailInterestStocks: 30, recognizableMidCaps: 58, etfs: 32 };
const parsed = {};
for (const [name, want] of Object.entries(EXPECTED)) {
  const got = arrayNamed(name);
  if (!got || got.length !== want) {
    console.error(
      `FATAL: curatedSymbols.ts ${name} parsed as ${got ? got.length : "null"}, expected ${want}. ` +
        `The list changed or the extraction broke -- either way the page counts below would be wrong. ` +
        `Re-derive the expected counts with an AST parse before trusting a new number.`
    );
    process.exit(2);
  }
  parsed[name] = got;
}
const priority = [...new Set([...parsed.coreMegaCaps, ...parsed.retailInterestStocks, ...parsed.recognizableMidCaps])];
const etfs = [...new Set(parsed.etfs)];
if (priority.length !== 129 || new Set([...priority, ...etfs]).size !== 161) {
  console.error(`FATAL: derived priorityStocks=${priority.length} union=${new Set([...priority, ...etfs]).size}, expected 129/161.`);
  process.exit(2);
}
const stockSymbols = [...new Set([...priority, ...etfs])];
const pagesFor = (syms, etfSet) =>
  syms.length * 2 + syms.filter((s) => !etfSet.has(s)).length; // /stock + /news for all, /earnings for non-ETFs
const etfSet = new Set(etfs);
const nowPages = pagesFor(stockSymbols, etfSet);
console.log(`  app/sitemap.ts builds per-symbol URLs from curatedSymbols.ts, NOT the ${analysis.length}.`);
console.log(`    priorityStocks ${priority.length} · uniqueEtfs ${etfs.length} · union ${stockSymbols.length}`);
console.log(`    URLs: ${stockSymbols.length} /stock + ${stockSymbols.length} /news + ${stockSymbols.length - etfs.length} /earnings = ${nowPages}`);
console.log(`\n  >>> A UNIVERSE-ONLY SWITCH TO NASDAQ DROPS ZERO INDEXED PER-SYMBOL PAGES.`);
console.log(`      The ${analysis.length} universe drives picker sections; the curated ${stockSymbols.length} drives /stock/*.`);
console.log(`      The two are independent, so the SEO cost is NOT coupled to this decision.`);
const curatedNasdaq = stockSymbols.filter(isNasdaq);
const curatedEtfNas = etfs.filter(isNasdaq);
const wouldPages = pagesFor(curatedNasdaq, new Set(curatedEtfNas));
console.log(`\n  IF the curated list were ALSO filtered to Nasdaq (a separate decision):`);
console.log(`    curated symbols ${stockSymbols.length} -> ${curatedNasdaq.length}   (ETFs ${etfs.length} -> ${curatedEtfNas.length})`);
console.log(`    per-symbol URLs ${nowPages} -> ${wouldPages}   = ${nowPages - wouldPages} DROPPED`);
console.log(`    new pages created: 0 unless the curated list is also EXTENDED, which is`);
console.log(`    a hand-edit -- and per #443 a hand-edit is exactly how a dotted ticker`);
console.log(`    enters the source, so check-symbol-spelling would police it.`);

fs.writeFileSync(
  path.join(DIR, "NASDAQ-REFILL.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      universe: analysis.length,
      nasdaq: nasdaq.length,
      nonNasdaq: nyse.length,
      top50NonNasdaq: nyseRanked.slice(0, 50).map((s) => ({
        symbol: s, dollarVolume: dv(s), marketCap: pick(s, "marketCap"), sector: pick(s, "sector"),
      })),
      refill: {
        nasdaqPool: nasdaqInFile.length,
        entrantsNeeded,
        nasdaqWithBars: nasdaqWithBars.length,
        entrantsWithBars: spareWithBars,
        entrantsNeedingBackfill: Math.max(0, entrantsNeeded - spareWithBars),
        entrantFloorMeasurable: false,
      },
      dividends: { payersNow: payersAll.length, payersNasdaq: payersNasdaq.length },
      sectors: sectorRows,
      seo: { curatedSymbols: stockSymbols.length, pagesNow: nowPages, pagesIfCuratedFiltered: wouldPages, universeDrivesSitemap: false },
    },
    null, 2
  )
);
console.log(`\nwrote ${path.relative(process.cwd(), path.join(DIR, "NASDAQ-REFILL.json"))}`);
