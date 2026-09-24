// One real poll of the four headline/wire feeds: counts, ticker resolution
// against the frozen universe, and verbatim items for the adapter fixtures.
//
// WHY A RUNNER. The sandbox is refused these hosts; the relay is the standing
// route (claude/news-adapter-spec-2026-09-13.md, and the same path the
// company-name and Google News fixtures took).
//
// THE RATIO IS THE POINT. Of the wire items, how many resolve to a symbol the
// site actually covers? That number decides whether /headlines ships with
// per-item art or gets paused, and nothing else can decide it — a wire feed that
// is 5% relevant and one that is 60% relevant look identical until counted.
//
// THE EXCHANGE PREFIXES ARE MEASURED, NOT ASSUMED. GlobeNewswire's <category>
// is exchange-prefixed ("SWX:RO", "OTC Markets:RHHBY") and the spec says to
// ignore non-US listings. Which prefixes actually appear, and in what
// proportion, is what the adapter's allowlist should be built from.
//
//   node scripts/wire-feeds-probe.mjs <dumpDir>
import fs from "node:fs";
import path from "node:path";
import { emitPayload } from "./lib/relay-capture.mjs";

const DUMP_DIR = process.argv[2] || "";
const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; news adapter evaluation)";

const FEEDS = [
  ["globenewswire", "wire", "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire---Public-Companies"],
  ["prnewswire", "wire", "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss"],
  ["marketwatch", "headlines", "https://feeds.content.dowjones.io/public/rss/mw_topstories"],
  ["cnbc", "headlines", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"],
];

// ---------------------------------------------------------------- universe
let universe = new Set();
if (DUMP_DIR) {
  const p = path.join(DUMP_DIR, "universe.json");
  if (fs.existsSync(p)) {
    const uni = JSON.parse(fs.readFileSync(p, "utf8"));
    universe = new Set((uni?.pickersSymbolsKey ?? []).map((s) => String(s).toUpperCase()));
  }
}
console.log(`[universe] symbols: ${universe.size}${universe.size ? "" : "  *** EMPTY — the ratio below is meaningless ***"}`);

const itemsOf = (xml) => xml.split(/<item[\s>]/).slice(1).map((b) => b.split("</item>")[0]);
const tagAll = (block, tag) => {
  const out = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let m;
  while ((m = re.exec(block))) out.push(m[1].trim());
  return out;
};
const tag1 = (block, tag) => tagAll(block, tag)[0] ?? null;
const clean = (s) => (s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").trim();

const prefixCounts = new Map();
const verbatim = [];
const summary = [];

for (const [name, group, url] of FEEDS) {
  console.log(`\n================ ${name} (${group})`);
  console.log(`URL ${url}`);
  let xml = "";
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    console.log(`HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`);
    if (!res.ok) { summary.push([name, group, 0, 0, 0]); continue; }
    xml = await res.text();
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    summary.push([name, group, 0, 0, 0]);
    continue;
  }

  const blocks = itemsOf(xml);
  console.log(`items: ${blocks.length}`);

  // What namespaced fields does this feed actually carry?
  const fields = new Set();
  for (const b of blocks) for (const m of b.matchAll(/<([a-z]+:[a-zA-Z]+)[\s>]/g)) fields.add(m[1]);
  console.log(`namespaced fields: ${[...fields].sort().join(", ") || "(none)"}`);

  // media:credit drives the image verdict (§6).
  const credits = new Map();
  for (const b of blocks) for (const c of tagAll(b, "media:credit")) {
    const v = clean(c);
    credits.set(v, (credits.get(v) ?? 0) + 1);
  }
  if (credits.size) {
    console.log(`media:credit values: ${[...credits].map(([v, n]) => `${JSON.stringify(v)}x${n}`).join(", ")}`);
  } else {
    console.log("media:credit values: (none)");
  }

  let withTicker = 0;
  let inUniverse = 0;
  const matched = [];

  if (group === "wire") {
    for (const b of blocks) {
      const cats = tagAll(b, "category").map(clean);
      const symbols = new Set();
      for (const c of cats) {
        if (!c.includes(":")) continue;
        const [prefix, sym] = c.split(":").map((x) => x.trim());
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
        if (sym && /^[A-Z][A-Z.\-]{0,6}$/.test(sym.toUpperCase())) symbols.add(sym.toUpperCase());
      }
      if (symbols.size) withTicker += 1;
      const hit = [...symbols].find((s) => universe.has(s));
      if (hit) { inUniverse += 1; matched.push(`${hit}  ${clean(tag1(b, "title")).slice(0, 68)}`); }
    }
    console.log(`items carrying a ticker category: ${withTicker}/${blocks.length}`);
    console.log(`items resolving to a UNIVERSE symbol: ${inUniverse}/${blocks.length}`);
    if (matched.length) console.log("matched:\n  " + matched.slice(0, 12).join("\n  "));
  }
  summary.push([name, group, blocks.length, withTicker, inUniverse]);

  // Verbatim items are held back and printed AFTER the summary: the job log is
  // read from the tail, and a release description is long enough to push the
  // numbers out of reach.
  // The headline feeds are captured too (2026-09-23): /headlines moves onto
  // MarketWatch + CNBC + the wires (spec §4), and their adapter needs verbatim
  // fixtures the same way the wire adapter did. One payload per dispatch still
  // applies -- `symbols` picks which of the four is printed.
  verbatim.push([name, blocks.slice(0, group === "wire" ? 8 : 12)]);
}

console.log("\n================ SUMMARY");
console.log("source          group      items  withTicker  inUniverse");
for (const [n, g, i, w, u] of summary) {
  console.log(`${n.padEnd(15)} ${g.padEnd(10)} ${String(i).padStart(5)} ${String(w).padStart(11)} ${String(u).padStart(11)}`);
}
const wireTotal = summary.filter((r) => r[1] === "wire").reduce((a, r) => a + r[2], 0);
const wireMatched = summary.filter((r) => r[1] === "wire").reduce((a, r) => a + r[4], 0);
console.log(`\nWIRE ITEMS RESOLVING TO A UNIVERSE SYMBOL: ${wireMatched}/${wireTotal}` +
  (wireTotal ? ` = ${((wireMatched / wireTotal) * 100).toFixed(1)}%` : ""));
console.log(`exchange prefixes seen: ${[...prefixCounts].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}=${n}`).join(", ") || "(none)"}`);
// ONE PAYLOAD PER DISPATCH, PRINTED LAST, BYTE-ACCOUNTED. See
// scripts/lib/relay-capture.mjs for why an Actions artifact does not work here.
// Whitespace between tags is still collapsed: it changes no content, and the
// fixture is only ever read through the parser.
for (const [name, blocks] of verbatim) {
  const xml = blocks.map((b) => "<item>" + b.replace(/>\s+</g, "><").trim() + "</item>").join("\n");
  emitPayload(name, xml);
}
console.log("\n[wire-feeds-probe] done");
