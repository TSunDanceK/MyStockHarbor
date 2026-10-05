// THE CURRENT POPULAR SCREEN READS LIKE A TICKED FILTER (#553 COWORK #163).
//
// In ScreenerNav (the desktop sidebar and the phone Screens sheet render the
// same list):
//   - ONE class, screenerNavSelected, carries the selected look (the accent
//     wash, the inset 2 px bar, the bold label) for a ticked filter row AND for
//     the link row of the page you are on, so the two cannot drift;
//   - the active link row also carries aria-current="page"; no checkbox is
//     added and the opens-page arrow stays;
//   - "active" is exactly `item.href === currentHref`, so only the page you are
//     on is highlighted, and a non-preset page highlights no Popular Screen.
// Runtime: the real ScreenerNav, server-rendered with react-dom/server for
// each preset page and for /oversold-stocks-today. Every rule has a mutant.
//
//   node scripts/check-picker-current-row.mjs
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";

register("./lib/tsx-render-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const NAV = "app/components/ScreenerNav.tsx";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PRESETS = ["/low-pe-stocks", "/high-dividend-yield-stocks", "/dividend-growth-stocks", "/cash-rich-value-stocks", "/semiconductor-stocks", "/cheap-tech-stocks", "/stock-screener"];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function sourceRules(raw) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const c = stripComments(raw, { file: NAV });
  want("a ticked filter row carries screenerNavSelected", /checked \? "checked screenerNavSelected" : ""/.test(c));
  want("the active link row carries the same class and aria-current",
    /className=\{active \? "screenerNavItem active screenerNavSelected" : "screenerNavItem"\}\s*aria-current=\{active \? "page" : undefined\}/.test(c));
  want("active is the page you are on, and nothing else", /const active = item\.href === currentHref;/.test(c));
  const sel = (c.match(/\.screenerNavSelected \{([^}]*)\}/) ?? [])[1] ?? "";
  want("the one selected style: wash, inset 2 px accent bar, bright text", /background: rgba\(56,189,248,0\.08\)/.test(sel) && /box-shadow: inset 2px 0 0 var\(--picker-accent\)/.test(sel) && /color: #f8fafc/.test(sel));
  want("and a bold label", /\.screenerNavSelected \.screenerNavLabel \{ font-weight: 800; \}/.test(c));
  want("no second, drifting copy of the selected look", !/\.screenerNavCheckable\.checked \{[^}]*box-shadow/.test(c) && !/\.screenerNavItem\.active \{[^}]*box-shadow/.test(c));
  return fails;
}

async function renderRules(navSrc) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const f = path.join(ROOT, "app/components", `.check-pcr-${process.pid}-${Math.random().toString(36).slice(2)}.tsx`);
  fs.writeFileSync(f, navSrc);
  try {
    const React = (await import("react")).default;
    const { renderToStaticMarkup } = await import("react-dom/server");
    const Nav = (await import(pathToFileURL(f).href)).default;
    const html = (href) => renderToStaticMarkup(React.createElement(Nav, { currentHref: href, variant: "full", showFilters: true, alwaysFilterMode: true }));
    const rowsFor = (h) => [...h.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)].map((m) => ({ href: m[1], tag: m[0] }));
    for (const href of PRESETS) {
      const rows = rowsFor(html(href)).filter((r) => PRESETS.includes(r.href));
      const own = rows.filter((r) => r.href === href);
      const others = rows.filter((r) => r.href !== href);
      want(`${href}: its row is selected and aria-current`, own.length >= 1 && own.every((r) => /screenerNavSelected/.test(r.tag) && /aria-current="page"/.test(r.tag)));
      want(`${href}: no other Popular Screen row is`, others.every((r) => !/screenerNavSelected|aria-current/.test(r.tag)));
    }
    const off = rowsFor(html("/oversold-stocks-today")).filter((r) => PRESETS.includes(r.href));
    want("/oversold-stocks-today: no Popular Screen row is highlighted", off.length >= 6 && off.every((r) => !/screenerNavSelected|aria-current/.test(r.tag)));
  } catch (err) {
    fails.push(`render failed: ${String(err).slice(0, 160)}`);
  } finally {
    fs.rmSync(f, { force: true });
  }
  return fails;
}

const navSrc = read(NAV);
console.log("\n1. The source");
const s = sourceRules(navSrc);
check("one selected class for ticked filters and the current page; aria-current; active = this page", s.length === 0, s.join("; "));
console.log("\n2. Rendered, per page");
const r = await renderRules(navSrc);
check("each preset page highlights its own row only; a non-preset page none", r.length === 0, r.join("; "));

console.log("\n3. Planted mutants");
const SRC_MUTANTS = [
  ["the current row back to bold-only", 'className={active ? "screenerNavItem active screenerNavSelected" : "screenerNavItem"}', 'className={active ? "screenerNavItem active" : "screenerNavItem"}'],
  ["a ticked row off the shared class", 'checked ? "checked screenerNavSelected" : ""', 'checked ? "checked" : ""'],
  ["a drifting second copy of the look", ".screenerNavSelected .screenerNavLabel { font-weight: 800; }", ".screenerNavSelected .screenerNavLabel { font-weight: 800; }\n        .screenerNavItem.active { box-shadow: inset 3px 0 0 #38bdf8; }"],
  ["the bar dropped from the selected look", "box-shadow: inset 2px 0 0 var(--picker-accent); color: #f8fafc;\n        }\n        .screenerNavSelected", "color: #f8fafc;\n        }\n        .screenerNavSelected"],
];
for (const [label, from, to] of SRC_MUTANTS) {
  if (!navSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
  const f = sourceRules(navSrc.replace(from, to));
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}
const RENDER_MUTANTS = [
  ["every Popular Screen highlighted", "const active = item.href === currentHref;", "const active = Boolean(item.href);"],
  ["aria-current dropped from the link row", 'className={active ? "screenerNavItem active screenerNavSelected" : "screenerNavItem"}\n                  aria-current={active ? "page" : undefined}', 'className={active ? "screenerNavItem active screenerNavSelected" : "screenerNavItem"}'],
];
for (const [label, from, to] of RENDER_MUTANTS) {
  if (!navSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
  const f = await renderRules(navSrc.replace(from, to));
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
