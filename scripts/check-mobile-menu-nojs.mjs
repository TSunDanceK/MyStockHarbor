// THE MOBILE MENU OPENS WITH NO JAVASCRIPT (#553 COWORK #234).
//
// iPhone Safari left the hamburger dead after the header was split into a
// server bar and one client island (#883): the menu was a React state flip and
// its overlay mounted only after a click, so anything that stopped the island
// hydrating left no menu at all. The menu is now plain HTML in the header,
// opened by a real checkbox and its label, and the island only enhances it.
// This pins the properties that make that true, each asserted against the
// shipped source and again against a source edited to break exactly that one.
// (The browser run, JavaScript off, is scripts/verify-mobile-menu-nojs.mjs.)
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { once } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const nav = readCodeOnly("app/components/SiteHeaderNav.tsx");
const bar = fs.readFileSync("app/components/SiteHeader.tsx", "utf8");

// Each property: [label, test(navSrc, barSrc), mutation of nav or bar, which].
const props = [
  ["the hamburger is a checkbox with a label that targets it (works with no JS)",
    (n) => /type="checkbox"[\s\S]{0,200}?className="mshMenuToggle"/.test(n) && /<label htmlFor="mshMenuToggle" className="mshMobileMenuButton"/.test(n),
    "nav", once('<label htmlFor="mshMenuToggle" className="mshMobileMenuButton"', '<label htmlFor="other" className="mshMobileMenuButton"')],
  ["the menu is rendered every time, not only after a click",
    (n) => /<StaticMobileMenu navItems=\{navItems\}/.test(n) && !/mobileMenuOpen \? \(\s*<StaticMobileMenu/.test(n),
    "nav", once("<StaticMobileMenu navItems={navItems}", "{mobileMenuOpen ? (<StaticMobileMenu navItems={navItems}")],
  ["groups are native <details>, so they expand with no JS",
    (n) => /<details key=\{item\.label\} className="mshMobileOverlayGroup"/.test(n) && /<details key=\{entry\.label\} className="mshMobileOverlaySubgroup"/.test(n),
    "nav", once('<details key={item.label} className="mshMobileOverlayGroup"', '<div key={item.label} className="mshMobileOverlayGroup"')],
  ["every top-level item and every entry is rendered from the nav data",
    (n) => /navItems\.map\(\(item\) =>/.test(n) && /item\.entries\.map\(\(entry\) =>\s*entry\.kind === "link" \? \(\s*link\(/.test(n) && /entry\.items\.map\(/.test(n),
    "nav", once("{item.entries.map((entry) =>\n                entry.kind === \"link\" ? (\n                  link(", "{item.entries.slice(0, 0).map((entry) =>\n                entry.kind === \"link\" ? (\n                  link(")],
  ["the menu has a close control that works with no JS (a label on the same checkbox)",
    (n) => /<label htmlFor="mshMenuToggle" className="mshMobileOverlayClose"/.test(n),
    "nav", once('<label htmlFor="mshMenuToggle" className="mshMobileOverlayClose"', '<span className="mshMobileOverlayClose"')],
  ["CSS shows the menu on :checked below 720px (the breakpoint is unchanged)",
    (_n, b) => /@media \(max-width: 720px\) \{\s*\.mshMenuToggle:checked ~ \.mshStaticMenu \{ display: flex; \}/.test(b) && /\.mshStaticMenu \{ display: none; \}/.test(b),
    "bar", once(".mshMenuToggle:checked ~ .mshStaticMenu { display: flex; }", ".mshMenuToggle:checked ~ .mshStaticMenu { display: none; }")],
  ["the header has no backdrop-filter of its own (it would pin the fixed menu to the 50px bar)",
    (_n, b) => !/backdropFilter/.test(b) && /\.mshGlobalHeader::before \{[^}]*backdrop-filter: blur\(14px\)/.test(b),
    "bar", once('background: "rgba(10,15,26,0.94)",\n', 'background: "rgba(10,15,26,0.94)",\n        backdropFilter: "blur(14px)",\n')],
  ["a hydrated island takes the tap over and un-checks the box (static menu never shows beside the drill-down)",
    (n) => /event\.target\.checked = false;\s*setMobileMenuOpen\(true\)/.test(n),
    "nav", once("event.target.checked = false;\n          setMobileMenuOpen(true);", "setMobileMenuOpen(true);")],
];
for (const [label, ok, which, mutate] of props) {
  check(label, ok(nav, bar));
  const broke = which === "nav" ? ok(mutate(nav), bar) : ok(nav, mutate(bar));
  check(`MUTATION: ${label} — broken source is caught`, !broke);
}

console.log(failures ? `\n${failures} FAILED` : "\nThe mobile menu opens with no JavaScript.");
process.exit(failures ? 1 : 0);
