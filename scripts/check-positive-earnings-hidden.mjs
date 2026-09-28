// Positive Last Earnings hidden behind one flag (#553 COWORK #64;
// lib/positiveLastEarnings.ts).
//
// WHAT IS AT RISK: the screener is ranked on FMP surprise fields that end on
// 14 Oct. Hidden means: its page 301s to Strong Earnings Growth (and is noindex
// if it ever renders), no nav or list links to it, its filter chip is gone, and
// the builder neither scores it nor ships its section. Missing one gate leaves a
// link to a page that redirects, or a section ranked on data about to vanish.
//
// The flag's states are exercised on the real module (a fresh import per
// state); each gated site is held by a predicate and a mutant with its gate
// removed must fail it.
//
//   node scripts/check-positive-earnings-hidden.mjs
import "./lib/register-ts-here.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const url = pathToFileURL(path.join(ROOT, "lib/positiveLastEarnings.ts")).href;
const ENV = "NEXT_PUBLIC_POSITIVE_LAST_EARNINGS_ENABLED";
delete process.env[ENV];
const OFF = await import(`${url}?state=off`);
process.env[ENV] = "1";
const ON = await import(`${url}?state=on`);
process.env[ENV] = "true";
const TYPO = await import(`${url}?state=typo`);
delete process.env[ENV];

const PAGE = "/stocks-with-positive-last-earnings";
check("off by default", OFF.POSITIVE_LAST_EARNINGS_ENABLED === false);
check("only \"1\" turns it on (\"true\" stays off)", ON.POSITIVE_LAST_EARNINGS_ENABLED === true && TYPO.POSITIVE_LAST_EARNINGS_ENABLED === false);
check("the path and the 301 target are pinned",
  OFF.POSITIVE_LAST_EARNINGS_PATH === PAGE && OFF.POSITIVE_LAST_EARNINGS_REDIRECT === "/stocks-with-strong-earnings-growth");
check("off: its link is hidden, Strong Earnings Growth's is not",
  OFF.positiveLastEarningsHidden(PAGE) && !OFF.positiveLastEarningsHidden("/stocks-with-strong-earnings-growth"));
check("mutant caught: flag on, the link comes back", !ON.positiveLastEarningsHidden(PAGE));

const SITES = [
  {
    label: "next.config 301s the page to Strong Earnings Growth while the flag is off",
    file: "next.config.ts",
    ok: (c) => /\.\.\.\(POSITIVE_LAST_EARNINGS_ENABLED\s*\?\s*\[\]\s*:\s*\[\{ source: POSITIVE_LAST_EARNINGS_PATH, destination: POSITIVE_LAST_EARNINGS_REDIRECT, permanent: true \}\]\)/.test(c),
    mutate: (c) => c.replace("...(POSITIVE_LAST_EARNINGS_ENABLED\n        ? []", "...(true\n        ? []"),
  },
  {
    label: "the page itself redirects (permanent) and is noindex while the flag is off",
    file: "app/stocks-with-positive-last-earnings/page.tsx",
    ok: (c) => /if \(!POSITIVE_LAST_EARNINGS_ENABLED\) permanentRedirect\(POSITIVE_LAST_EARNINGS_REDIRECT\);\s*return <PickerResultPage/.test(c) &&
      /\.\.\.\(POSITIVE_LAST_EARNINGS_ENABLED \? \{\} : \{ robots: \{ index: false, follow: true \} \}\)/.test(c),
    mutate: (c) => c.replace("if (!POSITIVE_LAST_EARNINGS_ENABLED) permanentRedirect(", "if (false) permanentRedirect("),
  },
  ...[
    ["app/components/ScreenerNav.tsx", "the screener sidebar's Earnings group", "] satisfies NavItem[]).filter((item) => !positiveLastEarningsHidden(item.href)),"],
    ["app/components/SiteHeader.tsx", "the header's Earnings submenu", "] satisfies NavChild[]).filter((item) => !positiveLastEarningsHidden(item.href)),"],
    ["lib/navSections.ts", "the crawlable nav's Signals & Earnings section", "].filter((link) => !positiveLastEarningsHidden(link.href)),"],
    ["app/pickers/page.tsx", "the /pickers setup list", "{SETUP_LINKS.filter((s) => !positiveLastEarningsHidden(s.href)).map((s) => ("],
  ].map(([file, where, gate]) => ({
    label: `${where} leaves the link out while the flag is off`,
    file,
    ok: (c) => c.includes(gate),
    mutate: (c) => c.replace(gate, gate.replace(/!positiveLastEarningsHidden\([^)]*\)/, "true")),
  })),
  {
    label: "the filter chip is left out of FILTER_DEFS while the flag is off",
    file: "lib/pickerFilters.ts",
    ok: (c) => c.includes('] satisfies FilterDef[]).filter((d) => POSITIVE_LAST_EARNINGS_ENABLED || d.key !== "positiveLastEarnings");'),
    mutate: (c) => c.replace('POSITIVE_LAST_EARNINGS_ENABLED || d.key !== "positiveLastEarnings"', "true"),
  },
  {
    label: "the builder scores nothing while the flag is off (so the signal flag stays false)",
    file: "lib/server/pickersBuilder.ts",
    ok: (c) => /const positiveLastEarningsCandidate = POSITIVE_LAST_EARNINGS_ENABLED\s*\?\s*computePositiveLastEarningsCandidate\(earningsRows\)\s*:\s*null;/.test(c),
    mutate: (c) => c.replace(/const positiveLastEarningsCandidate = POSITIVE_LAST_EARNINGS_ENABLED\s*\?/, "const positiveLastEarningsCandidate = true ?"),
  },
  {
    label: "the builder leaves the section out (not shipped empty) while the flag is off",
    file: "lib/server/pickersBuilder.ts",
    ok: (c) => /\.\.\.\(POSITIVE_LAST_EARNINGS_ENABLED \? \[buildSection\(\{\s*title: "Stocks With Positive Last Earnings",[\s\S]*?\}\)\] : \[\]\),/.test(c),
    mutate: (c) => c.replace("...(POSITIVE_LAST_EARNINGS_ENABLED ? [buildSection({", "...(true ? [buildSection({"),
  },
];
for (const site of SITES) {
  const code = readCodeOnly(site.file);
  check(site.label, site.ok(code), site.file);
  const mutant = site.mutate(code);
  check("...mutant caught: that gate removed, the screener comes back", mutant !== code && !site.ok(mutant));
}
check("hide, don't delete: the page config, the section builder and the filter key are still in the code",
  /presetFilters: \["positiveLastEarnings"\]/.test(readCodeOnly("app/stocks-with-positive-last-earnings/page.tsx")) &&
    /function computePositiveLastEarningsCandidate/.test(readCodeOnly("lib/server/pickersBuilder.ts")) &&
    /\| "positiveLastEarnings"/.test(readCodeOnly("lib/pickerFilters.ts")));

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
