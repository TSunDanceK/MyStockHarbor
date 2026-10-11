// THE INDIVIDUAL BOTTLENECK PAGE (#563 COWORK #158): rules, then mutants.
//
// lib/bottleneckPage.ts (the rules) and app/bottlenecks/[ticker]/BottleneckView.tsx
// (the page) run through the repo's render hooks on fixtures. It fails when:
//   1. the layout is out of order: breadcrumb, hero (with At a glance), map,
//      the two dependency cards, the row of three, sources, FAQ, keep exploring;
//   2. a dependency row in any data file resolves to no grade, or a row's grade
//      chip is missing; "Critical" appears anywhere;
//   3. the meters miss their thresholds: supplier at 34/35/59/60%, customer at
//      19/20/39/40% and "no single customer > 10%";
//   4. an Earnings link shows for a symbol the gate refuses, or hides for one
//      it allows; Chart links are not chartHref's;
//   5. the map draws more than 6 boxes a side, or loses the "+N more" roll-up;
//   6. the "What could change this map" card shows with no `watch` bullets,
//      or hides with them;
//   7. the default grades break (30% supplier, single-source, diversified
//      customers) or the FAQ and its JSON-LD drift apart.
// A mutant each.
//
//   node scripts/check-bottleneck-page.mjs
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const { renderToStaticMarkup } = await import("react-dom/server");
const React = await import("react");

const RULES_SRC = "lib/bottleneckPage.ts", VIEW = "app/bottlenecks/[ticker]/BottleneckView.tsx", PAGE = "app/bottlenecks/[ticker]/page.tsx";
const read = (f) => fs.readFileSync(f, "utf8");
let seq = 0;
async function loadCopy(file, src) {
  const tmp = path.join(path.dirname(file), `.check-bn-${process.pid}-${seq++}${path.extname(file)}`);
  fs.writeFileSync(tmp, src);
  try { return await import(pathToFileURL(path.resolve(tmp)).href); } finally { fs.rmSync(tmp, { force: true }); }
}

// ── The fixture: 8 suppliers (2 roll up), 3 customers, two listed partners, one watch bullet.
const row = (name, ticker, pct, blurb, grade) => ({ name, ticker, pct, blurb, grade });
const POST = {
  slug: "fixt", symbol: "FIXT", companyName: "Fixture Holdings, Inc.", category: "Testing", domain: "example.com", title: "Fixture (FIXT) Bottlenecks: Who Fixture Depends On",
  date: "2026-09-27", updated: "", summary: "A fixture company.", disclaimer: "", supplyChainNote: "", customersNote: "",
  supplyChain: [row("Alpha Foundry", "MSFT", 40, "Single-source wafers.", "hard"), row("Beta Labs", "AMZN", 20, "Testing.", "some"), ...Array.from({ length: 6 }, (_, i) => row(`Private Supplier ${i}`, null, 5, "A private company.", "spread"))],
  customers: [row("Thousands of retail buyers", null, 60, "Spread across thousands of accounts.", "spread"), row("Gamma Corp", "GOOGL", 25, "A buyer.", "some"), row("Delta plc", "ZZZZ", 15, "A buyer.", "some")],
  watch: ["If a second foundry is named, this may ease."],
};
const DATA = {
  sector: { name: "Technology", slug: "technology" }, annualForm: "10-K", cik: "0000000001",
  moves: { FIXT: { close: 100, changePct: 1.5, date: "2026-10-06" }, MSFT: { close: 400, changePct: -0.5, date: "2026-10-06" } },
  ownMaps: new Set(["MSFT"]), namedBy: { count: 4, names: ["AAA", "BBB", "CCC"] }, filed: null,
  hasFiledEarnings: { FIXT: true, MSFT: true, AMZN: false, GOOGL: true, ZZZZ: false },
};

function rules(R, V) {
  const fails = [], want = (l, ok) => { if (!ok) fails.push(l); };
  // 3. Meters.
  const s = (a, b) => R.supplierMeter([a, b]).level;
  want("supplier meter: 34% Low, 35% Medium, 59% Medium, 60% High", s(20, 14) === "Low" && s(20, 15) === "Medium" && s(30, 29) === "Medium" && s(30, 30) === "High");
  const c = (top) => R.customerMeter([top, 5], "").level;
  want("customer meter: 19% Low, 20% Medium, 39% Medium, 40% High; 'no single customer > 10%' is Low", c(19) === "Low" && c(20) === "Medium" && c(39) === "Medium" && c(40) === "High" &&
    R.customerMeter([65, 20], "Its 10-K states that no single customer accounted for more than 10% of net sales.").level === "Low");
  // 7. Default grades.
  want("default grades: supplier 30% hard, 29% some, 9% spread; single-source hard; diversified customers spread",
    R.defaultGrade("supplier", 30, "") === "hard" && R.defaultGrade("supplier", 29, "") === "some" && R.defaultGrade("supplier", 9, "") === "spread" &&
    R.defaultGrade("supplier", 12, "a single-source supplier") === "hard" && R.defaultGrade("supplier", 15, "the sole cloud provider") === "hard" &&
    R.defaultGrade("customer", 65, "spread across thousands of individual agencies") === "spread" && R.defaultGrade("customer", 45, "one buyer") === "hard");
  // 5. Map rows.
  const side = R.mapSide(POST.supplyChain, "s");
  want("the map: at most 6 boxes a side, the rest as one \"+N more\"", side.length === 7 && side.slice(0, 6).every((n) => !("more" in n)) && side[6].more === 2 && side[6].pct === 10 && R.MAP_SIDE_MAX === 6 &&
    R.mapSide(POST.customers, "c").length === 3);
  // The page.
  let html = "";
  try {
    const sM = R.supplierMeter(POST.supplyChain.map((x) => x.pct)), cM = R.customerMeter(POST.customers.map((x) => x.pct), POST.customers.map((x) => x.blurb).join(" "));
    const faq = R.buildFaq({ name: "Fixture", symbol: "FIXT", suppliers: POST.supplyChain, customerMeter: cM, listed: ["MSFT", "AMZN", "GOOGL", "ZZZZ"] });
    html = renderToStaticMarkup(React.createElement(V.default, { post: POST, name: "Fixture", data: DATA, supplierMeter: sM, customerMeter: cM, faq, listed: ["FIXT", "MSFT", "AMZN", "GOOGL", "ZZZZ"] }));
  } catch (e) { return [...fails, `the page renders (${String(e.message).slice(0, 80)})`]; }
  // 1. Order.
  const order = ["breadcrumb", "hero", "glance", "map", "cards", "row3", "sources", "faq", "explore"].map((k) => html.indexOf(`data-bn="${k}"`));
  want("layout order: breadcrumb, hero, at a glance, map, cards, row of three, sources, FAQ, keep exploring", order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])));
  want("one h1, the brief's", (html.match(/<h1/g) ?? []).length === 1 && html.includes("Who Fixture depends on, and who depends on Fixture</h1>"));
  // 2. Grades on every row, never "Critical".
  const deps = [...html.matchAll(/<li class="bnDep" id="([sc])-(\d+)" data-dep="" data-grade="(hard|some|spread)">([\s\S]*?)<\/li>/g)];
  want("every dependency row carries its grade chip", deps.length === POST.supplyChain.length + POST.customers.length &&
    deps.every((d) => new RegExp(`class="bnGrade" data-grade="${d[3]}">${R.GRADE_WORDS[d[3]]}<`).test(d[4])) && !/critical/i.test(html));
  // 4. Gated links.
  const earn = [...html.matchAll(/href="\/stock\/([A-Z]+)\/earnings"[^>]*data-earnings-link=""/g)].map((m) => m[1]);
  want("Earnings links only where the gate allows (FIXT, MSFT, GOOGL), never AMZN or ZZZZ", earn.includes("FIXT") && earn.includes("MSFT") && earn.includes("GOOGL") && !earn.includes("AMZN") && !earn.includes("ZZZZ"));
  want("Chart links go through chartHref", /href="\/dashboard\?symbol=MSFT#analyser"/.test(html) && /href="\/dashboard\?symbol=FIXT#analyser"/.test(html) && !/href="\/dashboard\?symbol=[A-Z]+"/.test(html));
  want("an own-map link only where the page exists; unlisted rows say so", /href="\/bottlenecks\/msft"[^>]*>MSFT&#x27;s own map →/.test(html) && !/href="\/bottlenecks\/amzn"[^>]*>AMZN&#x27;s own map/.test(html) && /class="bnUnlisted">Private company</.test(html));
  want("the reverse link: ×N and three names", /Other mapped stocks that name FIXT<\/span><strong>×4<\/strong>/.test(html) && /AAA[\s\S]*BBB[\s\S]*CCC/.test(html));
  // 6. The watch card.
  want("the watch card shows with bullets", /data-watch=""/.test(html) && html.includes("If a second foundry is named, this may ease."));
  const html2 = renderToStaticMarkup(React.createElement(V.default, { post: { ...POST, watch: [] }, name: "Fixture", data: DATA, supplierMeter: R.supplierMeter([40, 20]), customerMeter: R.customerMeter([60], ""), faq: [], listed: ["FIXT"] }));
  want("the watch card hides without bullets", !/data-watch=""/.test(html2));
  const html3 = renderToStaticMarkup(React.createElement(V.default, { post: { ...POST, watch: ["Chip supply: a second source may ease this."] }, name: "Fixture", data: DATA, supplierMeter: R.supplierMeter([40, 20]), customerMeter: R.customerMeter([60], ""), faq: [], listed: ["FIXT"] }));
  want("a \"Label: text\" watch bullet shows its label in bold, with the not-a-forecast fine line (COWORK #159)", html3.includes("<strong>Chip supply:</strong> a second source may ease this.") && html3.includes("Not a forecast."));
  want("the filings card hides without filed figures", !/data-filed=""/.test(html));
  // 5 (page). The map's boxes.
  const wide = html.match(/<svg class="bnMapWide"[\s\S]*?<\/svg>/)?.[0] ?? "";
  want("the drawn map: 6 + \"+2 more\" suppliers, 3 customers, links weighted by share, an aria-label in words", (wide.match(/data-map-box="/g) ?? []).length === 10 && />\+2 more</.test(wide) &&
    /data-link-pct="40"/.test(wide) && /<figure class="bnMap" data-bn-map="" aria-label="Fixture depends on 8 mapped suppliers, the largest Alpha Foundry at about 40%/.test(html));
  // 7. FAQ: three questions, the page's and the JSON-LD's the same.
  const page = read(PAGE);
  want("the FAQ: three questions from the data, and FAQPage JSON-LD built from the same list", (html.match(/<details class="bnFaq">/g) ?? []).length === 3 &&
    /"@type": "FAQPage"/.test(page) && /mainEntity: faq\.map\(\(f\) => \(\{ "@type": "Question", name: f\.q, acceptedAnswer: \{ "@type": "Answer", text: f\.a \} \}\)\)/.test(page) &&
    /faq=\{faq\}/.test(page) && /dateModified: modifiedTime,/.test(page) && /const modifiedTime = post\.updated \? new Date\(post\.updated\)\.toISOString\(\) : publishedTime;/.test(page));
  return fails;
}

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; };
const rulesSrc = read(RULES_SRC), viewSrc = read(VIEW);
const R = await import("../lib/bottleneckPage.ts"), V = await loadCopy(VIEW, viewSrc);
console.log("The page on its fixture");
const real = rules(R, V);
check("every rule holds", real.length === 0, real.join("; "));

console.log("\nEvery data file");
const files = fs.readdirSync("content/bottlenecks").filter((f) => f.endsWith(".md"));
// Every row resolves to a grade through the loader (a written one, else the default).
// A row without a written grade is reported, not failed: the daily automation's new
// pages may land before its prompt carries `grade`, and the page defaults them.
const { getAllBottleneckPosts } = await import("../lib/bottlenecks.ts");
let rows = 0, written = 0, resolved = 0;
for (const f of files) for (const k of ["supplyChain", "customers"]) for (const r of matter(read(`content/bottlenecks/${f}`)).data[k] ?? []) { rows++; if (R.isGrade(r.grade)) written++; }
for (const p of getAllBottleneckPosts()) for (const r of [...p.supplyChain, ...p.customers]) if (R.isGrade(r.grade)) resolved++;
check(`all ${files.length} pages: every dependency row resolves to a grade (${resolved}/${rows}; ${written} written in the file, ${rows - written} by the default rule)`, rows > 1000 && resolved === rows);

console.log("\nMutants: each must be caught");
const MUTANTS = [
  ["supplier meter High at 61%", RULES_SRC, "const level = sum >= 60 ? \"High\"", "const level = sum > 60 ? \"High\""],
  ["supplier meter Medium from 36%", RULES_SRC, ": sum >= 35 ? \"Medium\"", ": sum > 35 ? \"Medium\""],
  ["customer meter High at 41%", RULES_SRC, "const level = top >= 40 ? \"High\"", "const level = top > 40 ? \"High\""],
  ["'no single customer > 10%' ignored", RULES_SRC, "if (NO_CUSTOMER_OVER_10.test(text))", "if (false)"],
  ["7 boxes a side", RULES_SRC, "export const MAP_SIDE_MAX = 6;", "export const MAP_SIDE_MAX = 7;"],
  ["the roll-up dropped", RULES_SRC, "return rest.length ? [...shown, { key: `${prefix}more`, more: rest.length, pct: Math.round(rest.reduce((a, r) => a + r.pct, 0)) }] : shown;", "return shown;"],
  ["single-source not hard", RULES_SRC, "if (side === \"supplier\" && SINGLE.test(blurb)) return \"hard\";", ""],
  ["diversified customers not spread", RULES_SRC, "if (side === \"customer\" && DIVERSIFIED.test(blurb)) return \"spread\";", ""],
  ["the map after the cards", VIEW, "<section className=\"bnCard bnMapCard\" data-bn=\"map\"", "<section className=\"bnCard bnMapCard\" data-bn=\"map-x\""],
  ["the grade chip dropped", VIEW, "<span className=\"bnGrade\" data-grade={c.grade}>{GRADE_WORDS[c.grade]}</span>", "<span className=\"bnGrade\">Critical</span>"],
  ["Earnings ungated", VIEW, "{hasFiledEarnings ? <Link href={`/stock/${encodeURIComponent(t)}/earnings`}", "{true ? <Link href={`/stock/${encodeURIComponent(t)}/earnings`}"],
  ["a hand-built chart link", VIEW, "<Link href={chartHref(t)} prefetch={false} className=\"bnLink\">Chart →</Link>", "<Link href={`/dashboard?symbol=${t}`} prefetch={false} className=\"bnLink\">Chart →</Link>"],
  ["the watch card always shown", VIEW, "{post.watch.length ? (", "{true ? ("],
  ["the reverse meter dropped", VIEW, "<strong>×{d.namedBy.count}</strong>", "<strong />"],
];
for (const [label, file, from, to] of MUTANTS) {
  const src = file === RULES_SRC ? rulesSrc : viewSrc;
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "matched nothing"); continue; }
  const m = src.replace(from, to);
  const f = file === RULES_SRC ? rules(await loadCopy(RULES_SRC, m), V) : rules(R, await loadCopy(VIEW, m));
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}
console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
