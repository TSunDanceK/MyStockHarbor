// The wire adapters — GlobeNewswire and PR Newswire.
//
// WHAT IS AT RISK. Three things, none of which break a build:
//   1. The exchange allowlist. One real poll showed the GlobeNewswire feed is
//      MOSTLY not US-listed (TSX=10, Nasdaq=10, Paris=4, SWX=2, OTC Markets=2,
//      and one each of Copenhagen, TSX-V, Frankfurt, NYSE, BMV, Shenzhen, Oslo).
//      A Toronto ticker that collides with a US one is a wrong article on a
//      stock page, which looks exactly like a right one.
//   2. The image verdict. Default-deny is the design; a credit format nobody has
//      seen must fail closed, not open.
//   3. Cross-source dedup. This is the first step where the same story really
//      does arrive twice — the release on the wire, and Google News surfacing
//      that same release. Exact-link dedup cannot fire across sources.
//
// FIXTURES: wire-prnewswire.xml is a verbatim capture with ONE marked
// constructed item; wire-globenewswire.xml is reconstructed from measured
// properties, and says so at the top. Both say which is which in the file.
//
//   node scripts/check-wire-adapters.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const loadTs = async (source, tag) => {
  const file = path.join(ROOT, `.check-${tag}.mjs`);
  fs.writeFileSync(file, ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  try { return await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
  finally { fs.unlinkSync(file); }
};

// --------------------------------------------------------------- the adapter
let src = read("lib/server/news/wireProvider.ts")
  .replace(/^import \{ stripHtmlTags, containsHtmlMarkup, decodeHtml, cleanRssDescription \} from ".\/text";$/m,
    () => read("lib/server/news/text.ts").replace(/^export /gm, ""))
  .replace(/^import type \{ NewsItem, NewsProvider \} from ".\/types";$/m, "")
  .replace("export const wireProvider: NewsProvider =", "export const wireProvider =")
  .replace(/const SUBJECT_EVENT_TYPES: Array<\[RegExp, NonNullable<NewsItem\["eventType"\]>\]>/, "const SUBJECT_EVENT_TYPES")
  .replace(/export function imageVerdictFor\(imageUrl: string \| null, credit: string \| null\): NewsItem\["imageVerdict"\]/,
           "export function imageVerdictFor(imageUrl, credit)")
  .replace(/let eventType: NewsItem\["eventType"\] = null;/, "let eventType = null;");
if (/^import /m.test(src)) {
  console.error("FAIL: an import survived inlining:\n" + src.split("\n").filter((l) => l.startsWith("import ")).join("\n"));
  process.exit(1);
}
if (!src.includes("function stripHtmlTags")) {
  console.error("FAIL: news/text was not inlined — a substitution stopped matching.");
  process.exit(1);
}
const wire = await loadTs(src, "wire");

// ----------------------------------------------------- the real dedup, extracted
const newsSrc = read("lib/stock-news-data.ts");
const grab = (name) => {
  const i = newsSrc.indexOf(`function ${name}`);
  const start = newsSrc.lastIndexOf("\n", i) + 1;
  let depth = 0, end = newsSrc.indexOf("{", i);
  for (let k = end; k < newsSrc.length; k++) {
    if (newsSrc[k] === "{") depth++;
    else if (newsSrc[k] === "}") { depth--; if (!depth) { end = k; break; } }
  }
  return newsSrc.slice(start, end + 1).replace(/^export /, "");
};
const dedupe = await loadTs([
  "type NewsItem = { title: string; link: string; pubDate: string | null; source: string | null; description: string | null };",
  grab("normaliseTitleForDedupe"), grab("titleTokens"), grab("titleOverlap"),
  "const STORY_OVERLAP_THRESHOLD = 0.6;", grab("dedupeNews"), "export { dedupeNews };",
].join("\n"), "dedupe");

const CAPTURED = Date.parse("2026-09-13T15:09:00Z");
const GNW = { id: "globenewswire", url: "x", label: "GlobeNewswire" };
const PRN = { id: "prnewswire", url: "x", label: "PR Newswire" };

console.log("\n=== 1. GlobeNewswire tickers: the feed's own field, US only ===\n");
check("an exchange-prefixed US category yields the ticker", 
  JSON.stringify(wire.tickersFromCategories(["Nasdaq:CYRX"])) === '["CYRX"]');
check("NYSE too", JSON.stringify(wire.tickersFromCategories(["NYSE:GE"])) === '["GE"]');
check(
  "a non-US listing is IGNORED, not mapped",
  wire.tickersFromCategories(["SWX:RO"]).length === 0 &&
    wire.tickersFromCategories(["TSX:NPI"]).length === 0 &&
    wire.tickersFromCategories(["Paris:OR"]).length === 0 &&
    wire.tickersFromCategories(["Copenhagen:GMAB"]).length === 0 &&
    wire.tickersFromCategories(["Shenzhen:000001"]).length === 0,
  "the measured feed is mostly non-US; a foreign ticker colliding with a US one is a wrong article on a stock page"
);
check(
  "OTC Markets is excluded too",
  wire.tickersFromCategories(["OTC Markets:RHHBY"]).length === 0,
  "the scan universe is listed equities; RHHBY resolving against it would be the false match this prevents"
);
check(
  "a free-text category is not a ticker",
  wire.tickersFromCategories(["Calendar of Events", "Mergers and Acquisitions"]).length === 0
);
check(
  "the prefix is split on the FIRST colon only",
  JSON.stringify(wire.tickersFromCategories(["NYSE American:XYZ"])) === '["XYZ"]',
  "a prefix containing a space still has exactly one colon; splitting on all of them loses the symbol"
);

console.log("\n=== 2. The GlobeNewswire feed, parsed ===\n");
const gnw = wire.parseWireFeed(read("scripts/fixtures/wire-globenewswire.xml"), GNW, CAPTURED);
check("every item parses", gnw.length === 5, `${gnw.length} of 5`);
const mu = gnw.find((i) => i.tickers?.includes("MU"));
const roche = gnw.find((i) => i.title.startsWith("Roche"));
check("a US-listed release resolves to its ticker", mu !== undefined && mu.tickers.length === 1);
check(
  "a release listed only abroad resolves to NO ticker",
  roche !== undefined && roche.tickers.length === 0,
  "SWX:RO and OTC Markets:RHHBY are both rejected — the item is kept for /headlines, it just matches no symbol"
);
check(
  "the wire's real description is kept",
  gnw.every((i) => (i.description ?? "").length > 40),
  "this is the leg where a longer extract is defensible, so these never fall to the template builders"
);
check("provider is stamped", gnw.every((i) => i.provider === "wire"));
check("the source label is the wire", gnw.every((i) => i.source === "GlobeNewswire"));

console.log("\n=== 3. PR Newswire — and what the real feed actually contains ===\n");
const prn = wire.parseWireFeed(read("scripts/fixtures/wire-prnewswire.xml"), PRN, CAPTURED);
check("every item parses", prn.length === 3, `${prn.length} of 3`);
check(
  "PR Newswire yields NO tickers — it carries no <category> at all",
  prn.every((i) => (i.tickers ?? []).length === 0),
  "measured 0/20 on the real feed; this feed contributes to fetchMarket only"
);
check(
  "prn:industry becomes categories, with the 3-letter codes dropped",
  (() => {
    const item = prn.find((i) => i.title.startsWith("Insurance Agent"));
    const cats = item?.categories ?? [];
    return cats.includes("Banking & Financial Services") && !cats.includes("INS") && !cats.includes("FIN");
  })(),
  "the same item carries both long labels and codes; length is what separates them"
);
check(
  "prn:subject drives eventType",
  prn.find((i) => i.title.startsWith("Cryoport"))?.eventType === "earnings" &&
    prn.find((i) => i.title.startsWith("Achieve"))?.eventType === "deal",
  "Earnings -> earnings, Joint Ventures -> deal"
);
check(
  "a subject with no mapping leaves eventType null rather than guessing",
  prn.find((i) => i.title.startsWith("Insurance Agent"))?.eventType === null,
  '"Broadcast Feed Annoucement" is not an event type'
);

console.log("\n=== 4. Images: a verdict, never a render ===\n");
check("the wire crediting ITSELF is allow", wire.imageVerdictFor("https://mmx.prnewswire.com/x.jpg", "PRNewswire") === "allow");
check("...and GlobeNewswire likewise", wire.imageVerdictFor("https://x/y.jpg", "GlobeNewswire") === "allow");
check("an agency credit is deny", wire.imageVerdictFor("https://x/y.jpg", "Sean Rayford/Getty Images") === "deny");
check("...including AFP, Reuters and AP", 
  wire.imageVerdictFor("https://x/y.jpg", "Joel Saget/Agence France-Presse/Getty Images") === "deny" &&
  wire.imageVerdictFor("https://x/y.jpg", "Reuters") === "deny" &&
  wire.imageVerdictFor("https://x/y.jpg", "Associated Press") === "deny");
check("no image is deny", wire.imageVerdictFor(null, "PRNewswire") === "deny");
check("no credit is deny", wire.imageVerdictFor("https://x/y.jpg", null) === "deny");
check(
  "an unrecognised credit is deny — the default fails CLOSED",
  wire.imageVerdictFor("https://x/y.jpg", "Some Photographer Nobody Has Seen") === "deny",
  "a format nobody has met must not render"
);
check(
  "the real PR Newswire items come out allow",
  prn.every((i) => i.imageVerdict === "allow"),
  "media:credit = PRNewswire on all of them, which is the §6 signal"
);
check(
  "SHOW_PUBLISHER_IMAGES is still false — the verdict is not a render",
  /export const SHOW_PUBLISHER_IMAGES = false;/.test(readCodeOnly("lib/news-image-policy.ts")),
  "both the flag and the per-item verdict have to be true before anything renders, and the flag is the master switch"
);
check(
  "the adapter does not render or rehost anything",
  !/next\/image|<img/.test(readCodeOnly("lib/server/news/wireProvider.ts"))
);

console.log("\n=== 5. Cross-source dedup: the release, and Google News surfacing it ===\n");
// THE PATH THAT MATTERS. A GlobeNewswire URL and a news.google.com redirect are
// never equal, so link dedup cannot collapse them; only title similarity can.
const release = gnw.find((i) => i.title.startsWith("Cryoport, Inc. Announces Pricing"));
const viaGoogle = {
  title: "Cryoport Prices Public Offering",              // as the adapter stores it, suffix already stripped
  link: "https://news.google.com/rss/articles/CBMiWIRE?oc=5",
  pubDate: "2026-09-11T12:45:00Z",
  source: "Reuters",
  description: null,
};
check("the two links are genuinely different", release.link !== viaGoogle.link);
check(
  "the wire release and the Google News copy collapse to one",
  dedupe.dedupeNews([release, viaGoogle]).length === 1,
  `${JSON.stringify(release.title)} vs ${JSON.stringify(viaGoogle.title)}`
);
check(
  "the WIRE copy is the one kept, because it comes first and carries the real description",
  dedupe.dedupeNews([release, viaGoogle])[0].description !== null,
  "the wire item has the issuer's own text; the Google copy has none"
);
check(
  "two genuinely different releases from the same issuer are NOT collapsed",
  dedupe.dedupeNews([release, gnw.find((i) => i.tickers?.includes("MU"))]).length === 2,
  "a dedup that eats distinct stories is worse than one that lets a duplicate through"
);

console.log("\n=== 6. One poll, two consumers ===\n");
const wireSrc = readCodeOnly("lib/server/news/wireProvider.ts");
check(
  "no URL varies by symbol",
  !/\$\{symbol\}|\$\{wanted\}|encodeURIComponent\(symbol/.test(wireSrc),
  "a per-symbol URL would be a per-symbol poll, which is what this must not be"
);
check(
  "fetchForSymbol filters the shared poll rather than requesting",
  /pollAll\(\)\)\.filter\(/.test(wireSrc) && /fetchMarket[\s\S]{0,120}pollAll\(\)/.test(wireSrc),
  "both consumers reach the same two requests"
);
check("revalidate 3600 is kept", /next: \{ revalidate: 3600 \}/.test(wireSrc));
check("exactly two feed URLs", (wireSrc.match(/https:\/\/www\.(globenewswire|prnewswire)\.com/g) ?? []).length === 2);
check("Nasdaq's rssoutbound is not reintroduced", !/rssoutbound|nasdaq\.com/i.test(wireSrc));
check(
  "no Google redirect is resolved",
  !/news\.google\.com/.test(wireSrc) && !/redirect:\s*"follow"/.test(wireSrc)
);
const vercel = JSON.parse(read("vercel.json"));
check("still no news cron", (vercel.crons ?? []).filter((c) => /news/i.test(c.path)).length === 0);

console.log("\n=== 7. The fmpSymbolMatched decision ===\n");
// THE CALL: wire items do NOT stamp it. The reason is not about how strong the
// evidence is — a <category> from the issuer is strong — it is about what the
// field DOES. rankNews treats symbol-confirmed as a HARD PREFERENCE: if any item
// is confirmed, the feed uses ONLY confirmed items and discards the rest. One
// wire release would therefore throw away every Google News item for that
// symbol, and Google News is the per-symbol primary. The field is a mode switch,
// not a confidence score.
check(
  "wire items do not set fmpSymbolMatched or fmpSymbols",
  gnw.every((i) => i.fmpSymbolMatched === undefined && i.fmpSymbols === undefined),
  "see the comment above this check — it is a mode switch, not a confidence signal"
);
check(
  "...and the attribution is carried in `tickers` instead",
  mu.tickers.includes("MU"),
  "structured, honest, and read by nothing that discards other items"
);
check(
  "the hard preference this avoids is really in rankNews",
  (() => {
    const code = readCodeOnly("lib/stock-news-data.ts");
    return /symbolConfirmedNews\.length\s*\n?\s*\?\s*symbolConfirmedNews/.test(code.replace(/\s+/g, " ").replace(/ /g, " ")) ||
      /symbolConfirmedNews\.length/.test(code);
  })(),
  "if this stops being a hard preference, the decision above is worth revisiting"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
