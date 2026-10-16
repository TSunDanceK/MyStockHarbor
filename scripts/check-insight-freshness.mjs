// INSIGHT POSTS: DATES, SAME-TICKER LINKS, THE STOCK PAGE LIST, THE SITEMAP (#553).
//   1. THE DATA, on the real content/insights: posts on one ticker point at each
//      other (newest-first order, "previous" = the next one back, "newer" = the
//      newest on the ticker and only on OLDER posts); a one-post ticker has
//      neither; lastmod/dateModified is `updated`, else `date`.
//   2. THE STOCK PAGE LIST renders newest first, title and date, and nothing at
//      all for a ticker with no posts.
//   3. THE PAGES (source, each asserted again against a broken copy): the dates
//      line, the banner, the previous link, the Article JSON-LD dates, the
//      sitemap's lastmod, and the stock page's list.
import { register } from "node:module";
register("./lib/tsx-render-hooks.mjs", import.meta.url);
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n1. the data");
const { getAllPosts, getInsightsForSymbol, getSameSymbolLinks, insightModifiedDate } = await import("../lib/blog.ts");
const all = getAllPosts();
const ionq = getInsightsForSymbol("ionq");
check("a ticker's posts come back newest first, case-insensitively", ionq.length >= 2 && ionq.every((p, i) => i === 0 || ionq[i - 1].date >= p.date), ionq.map((p) => p.date).join(" > "));
const [newest, older] = [ionq[0], ionq[ionq.length - 1]];
const onNewest = getSameSymbolLinks(newest.slug, "IONQ");
const onOlder = getSameSymbolLinks(older.slug, "IONQ");
check("the newest post has a previous link and no 'newer' banner", onNewest.previous?.slug === ionq[1].slug && onNewest.newest === null);
check("an older post gets the newest as its 'newer' banner, and no previous when it is the oldest", onOlder.newest?.slug === newest.slug && onOlder.previous === null);
const single = all.find((p) => p.symbol && getInsightsForSymbol(p.symbol).length === 1);
const lone = getSameSymbolLinks(single.slug, single.symbol);
check("a one-post ticker has neither link", lone.previous === null && lone.newest === null, single.symbol);
check("an unknown slug or empty symbol gives nothing", getSameSymbolLinks("nope", "IONQ").previous === null && getInsightsForSymbol("").length === 0 && getInsightsForSymbol(null).length === 0);
check("dateModified is `updated` when set, else the date",
  insightModifiedDate({ date: "2026-07-28", updated: "2026-10-07" }) === "2026-10-07" && insightModifiedDate({ date: "2026-07-28", updated: "" }) === "2026-07-28");
const edited = all.filter((p) => p.updated);
check("the posts that carry `updated` read it (existing content untouched)", edited.length >= 1 && edited.every((p) => p.updated >= p.date), edited.map((p) => `${p.slug} ${p.updated}`).join(", "));
check("the order is a total order (same-date posts fall back to the slug)", new Set(all.map((p) => p.slug)).size === all.length && all.every((p, i) => i === 0 || all[i - 1].date > p.date || (all[i - 1].date === p.date && all[i - 1].slug < p.slug)));

console.log("\n2. the stock page list");
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const StockInsights = (await import("../app/components/StockInsights.tsx")).default;
const html = renderToStaticMarkup(React.createElement(StockInsights, { symbol: "IONQ" }));
const at = (needle) => html.indexOf(needle);
check("it lists this ticker's posts newest first, title then date",
  ionq.every((p) => at(p.title.replace(/&/g, "&amp;")) > 0) && at(ionq[0].title.replace(/&/g, "&amp;")) < at(ionq[1].title.replace(/&/g, "&amp;")) && /Jun 2026/.test(html) && /May 2026/.test(html));
check("each row links to its insight", ionq.slice(0, 5).every((p) => html.includes(`href="/insights/${p.slug}"`)));
check("a ticker with no posts renders nothing", renderToStaticMarkup(React.createElement(StockInsights, { symbol: "ZZZZ" })) === "");

console.log("\n3. the pages");
const page = readCodeOnly("app/insights/[slug]/InsightPage.tsx");
const route = readCodeOnly("app/insights/[slug]/page.tsx");
const sitemap = readCodeOnly("app/sitemap.ts");
const stock = readCodeOnly("app/stock/[symbol]/page.tsx");
const once = (src, find, repl) => { if (src.split(find).length - 1 !== 1) throw new Error(`mutation anchor not unique: ${find.slice(0, 50)}`); return src.replace(find, repl); };
const props = [
  ["the dates line says Published, prices as of the close date, and Updated when edited", page,
    (s) => /Published \{dayWords\(n\.date\)\}\s*\{thumbTo \? <>, prices as of \{dayWords\(thumbTo\)\}<\/> : null\}\s*\{n\.updated && n\.updated !== n\.date \? <> · Updated \{dayWords\(n\.updated\)\}<\/> : null\}/.test(s),
    (s) => once(s, "{n.updated && n.updated !== n.date ?", "{false ?")],
  ["an older post carries the 'Newer insight on SYM: title' banner", page,
    (s) => /sameSymbol\.newest \? \(\s*<aside className="inNewer"[\s\S]{0,200}Newer insight on \{sym\}: <Link href=\{`\/insights\/\$\{sameSymbol\.newest\.slug\}`\}>\{sameSymbol\.newest\.title\}/.test(s),
    (s) => once(s, "sameSymbol.newest ? (", "false ? (")],
  ["the end of the post carries the 'Previous insight on SYM' link", page,
    (s) => /sameSymbol\.previous \? \([\s\S]{0,200}Previous insight on \{sym\}: \{sameSymbol\.previous\.title\}/.test(s),
    (s) => once(s, "sameSymbol.previous ? (", "false ? (")],
  ["the route computes the links from content/insights (and none for a preview fixture)", route,
    (s) => /sameSymbol=\{isInsightFixture\(post\.slug\) \? \{ previous: null, newest: null \} : getSameSymbolLinks\(post\.slug, data\.n\.symbol\)\}/.test(s),
    (s) => once(s, "getSameSymbolLinks(post.slug, data.n.symbol)", "{ previous: null, newest: null }")],
  ["the Article JSON-LD has datePublished and dateModified, the latter moving only with `updated`", route,
    (s) => /datePublished: publishedTime,\s*dateModified: modifiedTime,/.test(s) && /const modifiedTime = data\.n\.updated \?/.test(s),
    (s) => once(s, "dateModified: modifiedTime,", "")],
  ["the sitemap's lastmod for an insight is its dateModified", sitemap,
    (s) => /lastModified: new Date\(insightModifiedDate\(post\)\)/.test(s),
    (s) => once(s, "new Date(insightModifiedDate(post))", "new Date(post.date)")],
  ["the stock page shows the Insights list", stock,
    (s) => /<StockInsights symbol=\{upper\} \/>/.test(s),
    (s) => once(s, "<StockInsights symbol={upper} />", "")],
];
for (const [label, src, ok, mutate] of props) {
  check(label, ok(src));
  let broke;
  try { broke = ok(mutate(src)); } catch (e) { check(`MUTATION anchor for: ${label}`, false, e.message); continue; }
  check(`MUTATION: ${label} — broken source is caught`, !broke);
}

console.log(failures ? `\n${failures} FAILED` : "\nThe insight pages hold.");
process.exit(failures ? 1 : 0);
