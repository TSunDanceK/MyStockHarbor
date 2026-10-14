// THE HEADER'S NAV TREE, AS DATA (#552 COWORK #231).
//
// The header was one 1,885-line client component whose entries carried
// isActive() functions. It is now a server component (bar, styles, logo) and
// one client island (app/components/SiteHeaderNav.tsx), fed the tree as data
// from lib/navSections.ts (HEADER_NAV, active rules as NavMatch). This pins:
//   1. the server/client split: SiteHeader has no "use client" and passes
//      HEADER_NAV; the island imports only types from navSections (so the tree
//      is not in the JavaScript bundle);
//   2. the active rules, on real paths, as the old predicates answered them
//      (an old-vs-new equivalence run over every href was identical);
//   3. no drift: every static header href is in the crawlable footer list.
// Mutants: an exception dropped, a footer link dropped, "use client" added.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";
import { once } from "./lib/render-snapshot.mjs";
import "./lib/register-ts-app.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n1. the split");
const header = fs.readFileSync("app/components/SiteHeader.tsx", "utf8");
const island = fs.readFileSync("app/components/SiteHeaderNav.tsx", "utf8");
const isClient = (src) => /^\s*["']use client["'];/.test(src);
check("SiteHeader is a server component and hands the island HEADER_NAV", !isClient(header) && /items=\{HEADER_NAV\}/.test(header));
check("SiteHeaderNav is the client island", isClient(island));
check("the island imports only types from navSections (the tree stays out of the bundle)",
  /import type \{[^}]*\} from "@\/lib\/navSections";/.test(island) && !/import \{[^}]*\} from "@\/lib\/navSections";/.test(island));
check("MUTATION: \"use client\" added to SiteHeader is caught by the first check", isClient(`"use client";\n\n${header}`));

console.log("\n2. active rules on real paths");
const M = await lift(readCodeOnly("lib/navMatch.ts"));
const { HEADER_NAV, CRAWLABLE_NAV_SECTIONS } = await import("../lib/navSections.ts");
const ruleOf = (c) => c.match ?? { exact: [c.href] };
/** Every entry whose rule matches the path, as "Top/Entry/Item" labels. */
const activeAt = (nav, matches, path) => {
  const out = [];
  for (const it of nav) {
    if (matches(it.kind === "link" ? ruleOf(it) : it.match, path)) out.push(it.label);
    for (const e of it.entries ?? []) {
      if (matches(e.kind === "submenu" ? e.match : ruleOf(e), path)) out.push(`${it.label}/${e.label}`);
      for (const c of e.items ?? []) if (matches(ruleOf(c), path)) out.push(`${it.label}/${e.label}/${c.label}`);
    }
  }
  return out.sort().join(" | ");
};
const CASES = [
  ["/", "Dashboard"],
  ["/plays/bull-flags", "Pickers | Pickers/Chart Plays | Pickers/Chart Plays/Bull Flag Plays"],
  ["/plays/anything-new", "Pickers | Pickers/Chart Plays"],
  ["/insights/videos/abc", "Insights | Insights/Video Breakdowns"],
  ["/insights/a-post", "Insights | Insights/Insights"],
  ["/bottlenecks/capex", "Bottlenecks | Bottlenecks/Capex — Follow the money"],
  ["/bottlenecks/NVDA", "Bottlenecks | Bottlenecks/Stock bottlenecks"],
  ["/stock/AAPL", "Analysis | Analysis/Stock Analysis"],
  ["/stock/AAPL/earnings", "Earnings | Earnings/Company Earnings"],
  ["/sector/technology/news", "News | News/Sector News | News/Sector News/Technology"],
  ["/stocks-with-strong-earnings-growth", "Pickers | Pickers/Earnings | Pickers/Earnings/Strong Earnings Growth | Pickers/Signals & Screens"],
  ["/learn/rsi", "Learn"],
  ["/pickers#custom-screener", ""],
];
for (const [p, want] of CASES) { const got = activeAt(HEADER_NAV, M.navMatches, p); check(`${p} → ${want || "(nothing)"}`, got === want, got); }
const noExcept = await lift(once("  if (rule.exceptPrefixes?.some((p) => path.startsWith(p))) return false;\n", "")(readCodeOnly("lib/navMatch.ts")));
check("MUTATION: exceptions ignored → 'Insights' lights up on a video page (caught)", activeAt(HEADER_NAV, noExcept.navMatches, "/insights/videos/abc").includes("Insights/Insights"));

console.log("\n3. no drift between the header and the crawlable footer");
const footer = new Set(CRAWLABLE_NAV_SECTIONS.flatMap((s) => s.links.map((l) => l.href)));
// Not separate URLs, or resolved in the browser: the "#custom-screener"
// fragment of /pickers, and the stock links (href filled from the last symbol).
const headerHrefs = (nav) => nav.flatMap((it) => [it, ...(it.entries ?? []), ...(it.entries ?? []).flatMap((e) => e.items ?? [])])
  .filter((x) => x.href && !x.stockNav && !x.href.includes("#")).map((x) => x.href);
const missing = (f) => [...new Set(headerHrefs(HEADER_NAV))].filter((h) => !f.has(h));
check("every static header href is in the crawlable footer list", missing(footer).length === 0, missing(footer).join(", "));
const lessFooter = new Set([...footer].filter((h) => h !== "/bottlenecks/capex"));
check("MUTATION: a header link missing from the footer is caught", missing(lessFooter).includes("/bottlenecks/capex"));

console.log(failures ? `\n${failures} FAILED` : "\nThe header nav holds.");
process.exit(failures ? 1 : 0);
