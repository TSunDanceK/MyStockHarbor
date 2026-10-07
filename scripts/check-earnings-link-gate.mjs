// NO "EARNINGS" LINK TO A STOCK WITH NO FILED SEC DATA (#552 COWORK #197).
//
// The rule: /stock/SYM/earnings is linked only when SYM has a stored SEC fact
// set with at least one filed period (lib/filedEarningsLinks.ts, one cached index
// read in lib/server/filedEarnings.ts). Otherwise the link is left out.
//
//   1. THE SCAN. Every earnings href in app/ and lib/ (code only, comments
//      stripped) must have a hasFiledEarnings call or value on its line or in
//      the WINDOW lines above it -- or sit on the short exemption list below,
//      each with its reason. A new, ungated earnings link fails here.
//   2. MUTANTS. Each named gate removed in memory must make the scan fail.
//   3. FIXTURES. AXON (filed) is linked; a private company (no ticker), an ETF
//      (SPY, even if indexed) and a symbol with no fact set (MYRG) or an empty
//      one (SKHY) are not -- through the predicate AND the real bottleneck card
//      render. A no-set page's noindex is run in check-sec-earnings-page.mjs.
//   4. COST. The filed list is one unstable_cache'd pipeline shared per render
//      by React cache(): 0 store commands per render while warm, 2 cold. No
//      per-symbol read exists in the module.
//
//   node scripts/check-earnings-link-gate.mjs
import { register } from "node:module";
register("./lib/tsx-render-hooks.mjs", import.meta.url);
import fs from "node:fs";
import path from "node:path";
import { stripComments, readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── 1. THE SCAN ──────────────────────────────────────────────────────────────
const WINDOW = 14;
// An earnings-page path in a string or template: "/earnings" followed by the
// end of the literal, a query or a hash. "/earnings-calendar" is not one.
const EARNINGS_HREF = /\/earnings(?=[`"'?#])/;
const GATE = /\bhasFiledEarnings\b/;

/** Not links to another symbol's earnings page, or already filtered upstream. Each says why. */
const EXEMPT = [
  { file: "app/stock/[symbol]/earnings/page.tsx", re: /mystockharbor\.com\/stock\/\$\{clean\}\/earnings/, why: "the page's own canonical / og:url / structured-data URL (noindex handles a no-set page)" },
  { file: "app/stock/[symbol]/coldFillAction.ts", re: /revalidatePath\(/, why: "cache revalidation, not a link" },
  { file: "app/stock/[symbol]/earnings/EarningsSymbolPicker.tsx", re: /router\.push\(/, why: "navigation to a symbol the reader typed on the earnings page; the page shows its not-available state" },
  { file: "app/components/SiteHeader.tsx", re: /if \(kind === "earnings"\) return/, why: "the stockHref helper; its only earnings caller is the Company Earnings entry, built only when hasFiledEarnings(lastSymbol), and the click path re-checks" },
  { file: "app/sitemap.ts", re: /toAbsoluteUrl\(`\/stock\/\$\{symbol\}\/earnings`\)/, why: "filtered by earningsRenderable, whose `filed` input is hasFiledEarningsIn (asserted below and in check-sitemap-robots)" },
  { file: "lib/latest-earnings-data.ts", re: /financialmodelingprep\.com/, why: "a data-provider API URL, not a site link" },
  { file: "app/components/MobileHomePage.tsx", re: /href: \(symbol: string\) => `\/stock\/\$\{encodeURIComponent\(symbol\)\}\/earnings`/, why: "the Earnings tile's definition; the tile is skipped at render unless hasFiledEarnings(lastSymbol) (asserted below)" },
];

// app/api/ is skipped: route handlers render no links (their /earnings strings
// are provider URLs and revalidatePath calls).
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && rel !== path.join("app", "api")) walk(rel, out); continue; }
    if (!/\.(ts|tsx)$/.test(e.name) || e.name.startsWith(".") || /\.mutant\d*\./.test(e.name)) continue;
    out.push(rel);
  }
  return out;
}

/** Every earnings href in one file's code: { line, text, gated, exempt }. */
function scanSource(rel, raw) {
  const code = stripComments(raw, { file: rel }).split("\n");
  const hits = [];
  code.forEach((text, i) => {
    if (!EARNINGS_HREF.test(text)) return;
    const from = Math.max(0, i - WINDOW);
    const gated = code.slice(from, i + 1).some((l) => GATE.test(l));
    const exempt = EXEMPT.find((x) => x.file === rel && x.re.test(text)) ?? null;
    hits.push({ file: rel, line: i + 1, text: text.trim(), gated, exempt });
  });
  return hits;
}

const files = [...walk("app"), ...walk("lib")];
const all = files.flatMap((rel) => scanSource(rel, fs.readFileSync(path.join(ROOT, rel), "utf8")));
const ungated = all.filter((h) => !h.gated && !h.exempt);

console.log("\n1. every earnings href is gated by hasFiledEarnings (code only, comments stripped)\n");
const byFile = new Map();
for (const h of all) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);
for (const [file, hs] of [...byFile].sort()) {
  console.log(`    ${file}: ${hs.map((h) => `${h.line}${h.gated ? "" : h.exempt ? " (exempt)" : " UNGATED"}`).join(", ")}`);
}
check(`${all.length} earnings hrefs found, none ungated`, all.length > 20 && ungated.length === 0,
  ungated.map((h) => `${h.file}:${h.line} ${h.text.slice(0, 90)}`).join(" | "));
check("the MobileHomePage Earnings tile is skipped without a filed set (its exemption's condition)",
  /if \(tile\.label === "Earnings" && !hasFiledEarnings\(lastSymbol\)\) return null;/.test(readCodeOnly("app/components/MobileHomePage.tsx")));
for (const x of EXEMPT) {
  check(`exemption still matches something (${x.file})`, all.some((h) => h.exempt === x), "a stale exemption is a hole");
}

// ── 2. MUTANTS ───────────────────────────────────────────────────────────────
console.log("\n2. mutants: each gate removed must fail the scan\n");
const MUTANTS = [
  ["app/components/BottleneckShockView.tsx", "the bottleneck card's Earnings →", "{hasFiledEarnings(company.ticker) ? (", "{true ? ("],
  ["app/components/PickerResultsGrid.tsx", "the picker row's Earnings button", "{isEarnings && hasFiledEarnings(entry.symbol) ? (", "{isEarnings ? ("],
  ["app/insights/[slug]/InsightPage.tsx", "the insight page's end links", "{hasFiledEarnings ? <Link href={`/stock/${sym}/earnings`}>Earnings</Link> : null}", "<Link href={`/stock/${sym}/earnings`}>Earnings</Link>"],
  ["app/components/StockPagesBottomNav.tsx", "the stock page's Earnings tab", "...(hasFiledEarnings(symbol || FALLBACK_SYMBOL)", "...(true"],
  ["app/dashboard/FiledEarningsChart.tsx", "the dashboard's filed-earnings tab link (a prop since #563 COWORK #160)", "{p.hasFiledEarnings ? <Link", "{true ? <Link"],
  ["app/stock/[symbol]/news/page.tsx", "the news page's earnings card (via LatestEarningsCard)", "hasFiledEarnings={await hasFiledEarnings(upper)}", "hasFiledEarnings={true}"],
  ["app/bottlenecks/[ticker]/BottleneckView.tsx", "the bottleneck page's partner-row Earnings → (#563 COWORK #158)", "{hasFiledEarnings ? <Link href={`/stock/${encodeURIComponent(t)}/earnings`}", "{true ? <Link href={`/stock/${encodeURIComponent(t)}/earnings`}"],
];
for (const [rel, label, from, to] of MUTANTS) {
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  if (!raw.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
  const mutated = raw.split(from).join(to);
  // The news-page mutant moves the gate out of the file that holds the href,
  // so it is caught by the prop being required, not by the scan: assert that.
  if (rel.endsWith("news/page.tsx")) {
    check(`mutant "${label}" is caught (the card's link is gated on a required prop the page must pass from hasFiledEarnings)`,
      !/hasFiledEarnings=\{await hasFiledEarnings\(/.test(mutated) && /hasFiledEarnings: boolean;/.test(readCodeOnly("app/components/LatestEarningsCard.tsx")));
    continue;
  }
  const hits = scanSource(rel, mutated).filter((h) => !h.gated && !h.exempt);
  check(`mutant "${label}" is caught`, hits.length > 0, hits[0] ? `${rel}:${hits[0].line}` : "the scan still passed");
}

// ── 3. FIXTURES ──────────────────────────────────────────────────────────────
console.log("\n3. fixtures: AXON linked; private, ETF, no set, empty set not\n");
const F = await import("../lib/filedEarningsLinks.ts");
const filed = new Set(F.filedFromIndex(["AXON", "SPY", "SKHY", "BRK-B"], ["SKHY"]));
check("AXON (a filed set) → link", F.hasFiledEarningsIn(filed, "AXON") === true);
check("a private company (no ticker) → no link", F.hasFiledEarningsIn(filed, null) === false);
check("an ETF (SPY), even when indexed → no link", F.hasFiledEarningsIn(filed, "SPY") === false && !filed.has("SPY"));
check("a symbol with no fact set (MYRG) → no link", F.hasFiledEarningsIn(filed, "MYRG") === false);
check("an indexed but EMPTY set (SKHY, 0 periods) → no link", F.hasFiledEarningsIn(filed, "SKHY") === false);
check("either spelling of a dotted ticker (BRK.B → BRK-B) → link", F.hasFiledEarningsIn(filed, "BRK.B") === true);
check("an unknown list (null: loading or unreadable) → no link", F.hasFiledEarningsIn(null, "AXON") === false);

{
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const View = (await import("../app/components/BottleneckShockView.tsx")).default;
  const co = (name, ticker) => ({ name, ticker, pct: 25, blurb: `${name} blurb` });
  const post = {
    slug: "fixture", ticker: "FIX", company: "Fixture Co", title: "Fixture", date: "2026-10-07",
    supplyChain: [co("Axon Enterprise", "AXON"), co("Private Foundry", null), co("SPDR S&P 500", "SPY"), co("MYR Group", "MYRG")],
    customers: [co("SK Hynix", "SKHY")],
  };
  const html = renderToStaticMarkup(React.createElement(View, {
    post,
    filedTickers: ["AXON", "SPY", "MYRG", "SKHY"].filter((t) => F.hasFiledEarningsIn(filed, t)),
  }));
  check("the real bottleneck card: AXON shows Earnings →", html.includes('href="/stock/AXON/earnings"'));
  check("…a private company renders no links at all", !/Private Foundry[\s\S]*?href="\/stock\/null/.test(html) && !html.includes("/stock/null"));
  check("…the ETF, the no-set and the empty-set tickers show no Earnings → (their other links stay)",
    !/\/stock\/(SPY|MYRG|SKHY)\/earnings/.test(html) && html.includes('href="/stock/MYRG"') && html.includes('href="/stock/MYRG/news"'));
}

{
  const R = await import("../lib/stockPageRobots.ts");
  check("the earnings page's robots: no filed set → noindex; unknown → unchanged",
    R.earningsPageIndexable({ hasCik: true, awaitingSecRead: false, filed: false }) === false
    && R.earningsPageIndexable({ hasCik: true, awaitingSecRead: false, filed: null }) === true
    && R.earningsPageIndexable({ hasCik: true, awaitingSecRead: false, filed: true }) === true);
  const sm = readCodeOnly("app/sitemap.ts");
  check("the sitemap's earnings entries carry the filed input (no earnings URL without a filed set)",
    /earningsPageIndexable\(\{ hasCik: cikForSymbol\(symbol\) !== null, awaitingSecRead: awaiting\(symbol\), filed: filedSet \? hasFiledEarningsIn\(filedSet, symbol\) : null \}\)/.test(sm));
}

// ── 4. COST ──────────────────────────────────────────────────────────────────
console.log("\n4. cost: one cached read per render, never a GET per link\n");
{
  const src = readCodeOnly("lib/server/filedEarnings.ts");
  check("the list is read inside unstable_cache (warm: 0 store commands)", /const readFiledList = unstable_cache\(/.test(src));
  check("…as ONE pipeline of 2 SMEMBERS (cold: 2 commands)",
    /p\.smembers\(SEC_FACTS_INDEX_KEY\);\s*p\.smembers\(SEC_FACTS_EMPTY_KEY\);/.test(src)
    && (src.match(/\bp\.\w+\(/g) ?? []).filter((m) => m !== "p.exec(").length === 2
    && (src.match(/\bredis\.\w+\(/g) ?? []).join() === "redis.pipeline(");
  check("…and shared per request by React cache() (every call in a render awaits one promise)", /export const filedEarningsSet = cache\(/.test(src));
  check("no per-symbol store read anywhere in the module (no get / exists / sismember)", !/\.(get|exists|sismember|mget)\(/.test(src));
  check("a failed read is not cached as an empty list (it throws inside the cache, null outside)",
    /throw new Error\("index unreadable"\)/.test(src) && /catch \{\s*return null;/.test(src));
  const store = readCodeOnly("lib/server/secFactStore.ts");
  check("writeFactSet keeps the empty-set key: SREM with a filed period, SADD without",
    /if \(factSetHasFiledPeriod\(set\)\) await redis\.srem\(SEC_FACTS_EMPTY_KEY, sym\);\s*else await redis\.sadd\(SEC_FACTS_EMPTY_KEY, sym\);/.test(store));
  const route = readCodeOnly("app/api/sec/filed-earnings/route.ts");
  check("the client endpoint is CDN-cached, and a failed read is a no-store 503, never an empty list",
    /s-maxage=3600/.test(route) && /status: 503, headers: \{ "Cache-Control": "no-store" \}/.test(route));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
