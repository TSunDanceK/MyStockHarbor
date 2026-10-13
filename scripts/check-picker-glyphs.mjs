// THE PICKERS MENU'S SIGNAL GLYPHS (#553 COWORK #155, Option B).
//
//   1. Every row of the menu names a glyph, every glyph it names exists, and no
//      glyph is orphaned -- names and drawings cannot drift apart.
//   2. No text-character icon is left in the list (▲ ▼ ● ★ ↗ ↘ ◆ ▮ ↕ ...), and
//      no row carries an `icon:` or `tone:` field any more.
//   3. Colour means bullish, bearish or neutral only: every fill and stroke in
//      a glyph is one of the palette names (grey context, BULL, BEAR, ACCENT,
//      the band wash); each glyph carries ONE colour family; screens whose name
//      says bullish / bearish use that colour. Section headings carry no colour
//      of their own.
//   4. The rest of the brief: the native checkbox restyled with a visible
//      focus ring, "none today" in place of a 0 pill (the box not greyed), the
//      OPENS PAGE text replaced by the arrow, row labels at 0.875rem (above
//      --fs-label), glyphs aria-hidden.
// Every rule has a planted mutant.
//
//   node scripts/check-picker-glyphs.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const NAV = "app/components/ScreenerNav.tsx";
const GLYPH = "app/components/PickerGlyph.tsx";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const TEXT_ICONS = /[▲▼●★⊖↗↘◆◇▮▇↕◈☆▦⚇⇄△⚑▽✓]/;

function glyphMap(src) {
  const body = src.match(/const G = \{([\s\S]*?)\n\} satisfies Record<string, ReactElement>;/);
  if (!body) return null;
  const map = new Map();
  const re = /\n  (?:"([a-z0-9-]+)"|([a-z0-9]+)): \(\n([\s\S]*?)\n  \),/g;
  for (const m of body[1].matchAll(re)) map.set(m[1] ?? m[2], m[3]);
  return map;
}

function rules(navRaw, glyphRaw) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const nav = stripComments(navRaw, { file: NAV });
  const g = glyphMap(stripComments(glyphRaw, { file: GLYPH }));
  want("the glyph map was found", g instanceof Map && g.size > 0);
  const groups = nav.match(/const GROUPS: NavGroup\[\] = \[([\s\S]*?)\n\];/);
  want("the menu's GROUPS were found", !!groups);
  const list = groups ? groups[1] : "";
  const rows = [...list.matchAll(/\{ href: "([^"]+)", label: "([^"]+)"([^}]*)\}/g)];
  want("the menu's rows were found", rows.length >= 30);

  // 1. names <-> glyphs
  const used = new Set();
  for (const [, href, label, rest] of rows) {
    const id = rest.match(/glyph: "([a-z0-9-]+)"/)?.[1];
    want(`${label} (${href}) names a glyph`, !!id);
    if (id) { used.add(id); want(`${label}: glyph "${id}" exists`, !!g?.has(id)); }
  }
  for (const id of g?.keys() ?? []) want(`glyph "${id}" is used by a row`, used.has(id));

  // 2. no text icons
  want("no row carries an icon: or tone: field", !/\bicon: "|\btone: "/.test(list));
  want("no text-character icon remains in the list", !TEXT_ICONS.test(list));
  want("no row renders item.icon any more", !/item\.icon/.test(nav));

  // 3. colour: the palette, one family per glyph, meaning from the name
  const allowed = new Set(["CTX", "CTX2", "BULL", "BEAR", "ACCENT", "BAND"]);
  for (const [id, body] of g ?? []) {
    const refs = [...body.matchAll(/(?:fill|stroke)=\{([A-Z0-9]+)\}/g)].map((m) => m[1]);
    const literals = [...body.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]).filter((v) => v !== "none");
    want(`glyph "${id}": every fill/stroke is a palette name`, refs.length > 0 && refs.every((r) => allowed.has(r)) && literals.length === 0);
    const families = new Set(refs.filter((r) => r === "BULL" || r === "BEAR" || r === "ACCENT"));
    want(`glyph "${id}": one coloured mark family`, families.size === 1);
    if (/bullish|buy-|ascending|bull-flag/.test(id)) want(`glyph "${id}": bullish, so green`, families.has("BULL"));
    if (/bearish|sell-|descending/.test(id)) want(`glyph "${id}": bearish, so red`, families.has("BEAR"));
  }
  const palette = glyphRaw.match(/export const GLYPH_COLOURS = \{([\s\S]*?)\} as const;/)?.[1] ?? "";
  want("the palette is the brief's: #475569, #94a3b8, #22c55e, #ef4444, #38bdf8",
    /CTX: "#475569"/.test(palette) && /CTX2: "#94a3b8"/.test(palette) && /BULL: "#22c55e"/.test(palette) && /BEAR: "#ef4444"/.test(palette) && /ACCENT: "#38bdf8"/.test(palette));
  want("section headings carry no colour of their own", !/headingColor/.test(nav) && /<div className="screenerNavHeading">/.test(nav));

  // 4. the rest of the brief
  want("glyphs are aria-hidden", /className="pickerGlyph"[^>]*?aria-hidden="true"/.test(glyphRaw));
  want("the checkbox is the native input, restyled (appearance: none), with a visible focus ring",
    /input\[type="checkbox"\] \{\s*appearance: none;/.test(nav) && /input\[type="checkbox"\]:focus-visible \{ outline: 2px solid/.test(nav));
  want("a 0 count reads \"none today\", with the name dimmed, not the whole row",
    (nav.match(/dead \? \(\s*<span className="screenerNavNone"[^>]*>none today<\/span>/g) ?? []).length === 2 &&
      /\.screenerNavCheckable\.dead \.screenerNavLabel \{ color:/.test(nav) && !/\.screenerNavCheckable\.dead \{ opacity/.test(nav));
  want("OPENS PAGE is an arrow, not text", /<OpensPageArrow \/>/.test(nav) && !/>opens page<\/span>\) : null/.test(nav) && !/text-transform: uppercase; color: rgba\(148,163,184,0\.4\)/.test(nav));
  want("row labels are at 0.875rem (above --fs-label)", /\.screenerNavItem \{[\s\S]*?font-size: 0\.875rem;/.test(nav));
  return fails;
}

const navSrc = read(NAV);
const glyphSrc = read(GLYPH);
console.log("\n1. The real menu");
const real = rules(navSrc, glyphSrc);
for (const f of real) check(f, false);
check("every row has its glyph; no text icons; colour for meaning only; the brief's details", real.length === 0);

console.log("\n2. Planted mutants");
const MUTANTS = [
  ["a row without a glyph", "nav", (s) => s.replace('label: "Volume Spike", glyph: "volume-spike"', 'label: "Volume Spike"')],
  ["a row naming a missing glyph", "nav", (s) => s.replace('glyph: "atr-spike"', 'glyph: "atr-spikes"')],
  ["an orphaned glyph", "glyph", (s) => s.replace("\n} satisfies Record<string, ReactElement>;", '\n  "spare": (\n    <>\n      <circle cx="3" cy="3" r="1" fill={ACCENT} />\n    </>\n  ),\n} satisfies Record<string, ReactElement>;')],
  ["a text icon back in the list", "nav", (s) => s.replace('label: "Oversold", glyph: "oversold"', 'label: "Oversold ●", glyph: "oversold"')],
  ["a hex colour literal in a glyph", "glyph", (s) => s.replace('<rect x="23" y="1" width="4" height="16" rx=".8" fill={ACCENT} />', '<rect x="23" y="1" width="4" height="16" rx=".8" fill="#fb923c" />')],
  ["two colour families in one glyph", "glyph", (s) => s.replace('<circle cx="20" cy="16" r="1.8" fill={BULL} />', '<circle cx="20" cy="16" r="1.8" fill={BULL} />\n      <circle cx="4" cy="4" r="1" fill={BEAR} />')],
  ["a bearish screen drawn green", "glyph", (s) => s.replace('<circle cx="27" cy="16" r="1.8" fill={BEAR} />', '<circle cx="27" cy="16" r="1.8" fill={BULL} />')],
  ["a section heading coloured again", "nav", (s) => s.replace('<div className="screenerNavHeading">', '<div className="screenerNavHeading" style={{ color: group.headingColor }}>')],
  ["glyphs no longer aria-hidden", "glyph", (s) => s.replace('aria-hidden="true"\n      focusable="false"\n      style', 'focusable="false"\n      style')],
  ["the focus ring removed", "nav", (s) => s.replace(/\.screenerNavCheckable input\[type="checkbox"\]:focus-visible \{[^}]*\}/, "")],
  ["the 0 pill instead of none today", "nav", (s) => s.replace(/dead \? \(\s*<span className="screenerNavNone" aria-hidden="true">none today<\/span>\s*\) : /, "")],
  ["the whole empty row dimmed", "nav", (s) => s.replace(".screenerNavCheckable.dead .screenerNavLabel { color: #64748b; }", ".screenerNavCheckable.dead { opacity: 0.45; }")],
  ["OPENS PAGE text back", "nav", (s) => s.replace("<OpensPageArrow />", "OPENS PAGE")],
  ["row labels shrunk to 11px", "nav", (s) => s.replace("font-size: 0.875rem; font-weight: 650;", "font-size: 11px; font-weight: 650;")],
];
for (const [label, which, mutate] of MUTANTS) {
  const n = which === "nav" ? mutate(navSrc) : navSrc;
  const gl = which === "glyph" ? mutate(glyphSrc) : glyphSrc;
  if (n === navSrc && gl === glyphSrc) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
  const f = rules(n, gl);
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
