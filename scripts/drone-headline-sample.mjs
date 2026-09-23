// Real Google News headlines for the drone/defence symbols, captured on a
// runner because the sandbox cannot reach news.google.com (403 CONNECT).
//
// ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
// /stock/[symbol]/news now picks art in layers, and layer 1 reads the headline.
// The question this capture answers is narrow and was asked explicitly: on a
// drone company's own news feed, how many headlines reach `aerospace-defence`,
// and what do the ones that reach nothing actually say? Neither half can be
// answered from the 2026-09-13 fixture, which holds none of these symbols.
//
// ── IT DUMPS ONLY, AND THAT IS THE DESIGN ──────────────────────────────────
// No classification happens here. The same rule as scripts/eventtype-sample.mjs:
// if the derivation ran on the runner, the numbers would describe a
// reimplementation of articleTopic rather than articleTopic. This emits titles;
// scripts/newsart-drone-measure.mjs runs the SHIPPED classifier over them.
//
// ── THE QUERY, AND WHY TWO SHAPES ──────────────────────────────────────────
// Google News wants a company name, not a ticker. Three of these five are not
// in scripts/fixtures/company-names.txt (a sampled fixture, not a directory),
// and INVENTING a name would quietly change what was searched for. So a symbol
// the fixture knows is queried by name and one it does not is queried by
// ticker, and every line says which — a capture that does not record how it
// searched is a capture nobody can reproduce.
//
//   node scripts/drone-headline-sample.mjs
import fs from "node:fs";

const SYMBOLS = (process.env.SYMBOLS || "ONDS,RCAT,UMAC,AVAV,KTOS")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

const LOCALE = "hl=en-US&gl=US&ceid=US:en";
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; news art evaluation)";
const ITEMS_PER_SYMBOL = 14;

/** Nasdaq display names, where the committed fixture happens to hold one. */
const names = new Map();
try {
  for (const line of fs.readFileSync("scripts/fixtures/company-names.txt", "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [sym, display] = line.split("|");
    if (sym && display) names.set(sym.trim().toUpperCase(), display.trim());
  }
} catch {
  // Absent fixture is not fatal: every symbol then takes the ticker query and
  // says so, which is a worse search and an honest one.
}

/** "Ondas Inc - Common Stock" -> "Ondas". The suffixes are noise in a search. */
function searchName(display) {
  return display
    .replace(/\s*-\s*(Common Stock|Class [A-Z].*|Ordinary Shares.*|American Depositary.*)$/i, "")
    .replace(/,?\s+(Inc|Corp|Corporation|Holdings|Company|Co|Ltd|plc|N\.V\.|S\.A\.)\.?$/i, "")
    .trim();
}

for (const symbol of SYMBOLS) {
  const display = names.get(symbol);
  const shape = display ? "name" : "ticker";
  const query = display ? `"${searchName(display)}" stock` : `"${symbol}" stock`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${LOCALE}`;

  console.log(`\n===== ${symbol} :: query-shape=${shape} :: ${query}`);
  console.log(`===== ${url}`);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    console.log(`===== HTTP ${res.status}`);
    if (!res.ok) continue;

    const xml = await res.text();
    const blocks = xml.split("<item>").slice(1);
    console.log(`===== items in feed: ${blocks.length}`);

    for (const block of blocks.slice(0, ITEMS_PER_SYMBOL)) {
      const raw =
        block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] ??
        block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ??
        "";
      const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? "";
      if (!raw) continue;
      // The SUFFIX IS LEFT ON, exactly as eventtype-gnews.jsonl leaves it: the
      // adapter strips it and so does the measurement, and a capture that
      // pre-strips hides whether the stripper still works.
      console.log(JSON.stringify({ src: "gnews", symbol, shape, pubDate, title: raw }));
    }
  } catch (err) {
    console.log(`===== FETCH FAILED: ${err?.message ?? err}`);
  }
}

console.log("\n===== done");
