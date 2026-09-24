// Keyboard navigation in every ticker search box (Relay B, #553 COWORK #36).
//
// WHAT IS AT RISK, none of which breaks a build: a box that drifts from the
// others (its own key handling, no highlight, no ARIA), Enter stealing the
// "top match" behaviour when nothing is highlighted, Up never returning to
// the typed text, Escape or Tab picking a row.
//
// Runs lib/listboxNav.ts, checks every listed box is wired through the shared
// hook, then again on mutants; each must be caught.
//
//   node scripts/check-search-keyboard.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const MODULE = "lib/listboxNav.ts";

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-kbd-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

// Every ticker search box on the site (#553 COWORK #36 inventory). A new one
// must be added here. `list` names the file that draws the rows when a shared
// dropdown does; `nav` is the hook variable in the box.
const DROPDOWN = "app/components/TickerJumpDropdown.tsx";
export const BOXES = [
  { name: "Stock page: change stock (desktop sidebar + mobile)", file: "app/stock/[symbol]/StockTickerJump.tsx", list: DROPDOWN, nav: "nav" },
  { name: "Stock earnings: symbol picker", file: "app/stock/[symbol]/earnings/EarningsSymbolPicker.tsx", list: DROPDOWN, nav: "nav" },
  { name: "Stock news: change stock", file: "app/stock/[symbol]/news/StockNewsTickerJump.tsx", list: DROPDOWN, nav: "nav" },
  { name: "Dashboard hero search (desktop)", file: "app/components/DashboardClient.tsx", nav: "navDesk" },
  { name: "Dashboard hero search (phone)", file: "app/components/DashboardClient.tsx", nav: "navMobile" },
  { name: "Home page on phones", file: "app/components/MobileHomePage.tsx", nav: "nav" },
  { name: "Pickers: search a ticker", file: "app/components/PickerTickerSearch.tsx", nav: "nav" },
  { name: "Earnings calendar: ticker search", file: "app/earnings-calendar/EarningsTickerSearch.tsx", nav: "nav" },
];
const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function suite(N, code) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };
  const k = (key, a, n = 5, open = true) => N.navKey(key, a, n, open);
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  ok("Down from the text highlights the first row", eq(k("ArrowDown", -1), { kind: "move", index: 0 }));
  ok("Down moves down", eq(k("ArrowDown", 1), { kind: "move", index: 2 }));
  ok("Down on the last row stays there", eq(k("ArrowDown", 4), { kind: "move", index: 4 }));
  ok("Up moves up", eq(k("ArrowUp", 3), { kind: "move", index: 2 }));
  ok("Up from the first row returns to the typed text", eq(k("ArrowUp", 0), { kind: "move", index: -1 }));
  ok("Up from the text stays on the text", eq(k("ArrowUp", -1), { kind: "move", index: -1 }));
  ok("Enter picks the highlighted row", eq(k("Enter", 2), { kind: "select", index: 2 }));
  ok("Enter with nothing highlighted is left to the box (top match / exact ticker)", eq(k("Enter", -1), { kind: "none" }));
  ok("a stale highlight past the list is nothing highlighted", eq(k("Enter", 7, 3), { kind: "none" }));
  ok("Escape closes and keeps the text", eq(k("Escape", 2), { kind: "close", preventDefault: true }));
  ok("Tab closes, picks nothing, and lets focus move on", eq(k("Tab", 2), { kind: "close", preventDefault: false }));
  ok("closed or empty list: arrows do nothing", eq(k("ArrowDown", -1, 5, false), { kind: "none" }) && eq(k("ArrowDown", -1, 0), { kind: "none" }));
  ok("closed list: Enter is left to the box", eq(k("Enter", 2, 5, false), { kind: "none" }));
  ok("other keys (typing) are left alone", eq(k("a", 2), { kind: "none" }));
  const dark = N.activeRowStyle(true), light = N.activeRowStyle(false);
  ok("the highlight is a solid tint plus a ring in both themes, not a faint tint", /inset 0 0 0 2px/.test(dark.boxShadow) && /inset 0 0 0 2px/.test(light.boxShadow));

  // The hook.
  const h = code.hook;
  ok("the hook resets the highlight when the typed text changes", /useEffect\(\(\) => \{ setActive\(-1\); \}, \[resetKey, open\]\);/.test(h));
  ok("the hook keeps the highlighted row in view", /scrollIntoView\?\.\(\{ block: "nearest" \}\)/.test(h));
  ok("hovering a row moves the highlight (one highlight, mouse and keyboard)", /onMouseMove: \(\) => \{ if \(index !== active\) setActive\(index\); \}/.test(h));
  ok("the hook sets the combobox ARIA", /role: "combobox"/.test(h) && /"aria-activedescendant": cur >= 0 \? optionId\(listId, cur\) : undefined/.test(h) && /role: "listbox"/.test(h) && /"aria-selected": index === cur/.test(h));

  // Every box.
  ok("every ticker search box is listed", BOXES.length > 0);
  for (const b of BOXES) {
    const c = code.boxes[b.file] ?? "";
    const n = esc(b.nav);
    ok(`${b.name}: uses the shared hook`, new RegExp(`const ${n} = useListboxNav\\(\\{`).test(c), b.file);
    ok(`${b.name}: the hook sees keys first`, new RegExp(`if \\(${n}\\.onKeyDown\\(e\\)\\) return;`).test(c));
    ok(`${b.name}: input carries the combobox ARIA`, new RegExp(`\\{\\.\\.\\.${n}\\.inputAria\\}`).test(c));
    if (b.list) {
      ok(`${b.name}: hands the hook to the shared dropdown`, new RegExp(`<TickerJumpDropdown [^>]*nav=\\{${n}\\} />`).test(c));
    } else {
      ok(`${b.name}: list is a listbox, rows are options`, new RegExp(`\\{\\.\\.\\.${n}\\.listProps\\}`).test(c) && new RegExp(`\\{\\.\\.\\.${n}\\.optionProps\\(i\\)\\}`).test(c));
      ok(`${b.name}: the highlighted row is drawn`, new RegExp(`\\.\\.\\.\\(${n}\\.active === i \\? activeRowStyle\\(true\\) : null\\)`).test(c));
    }
  }
  const dd = code.boxes[DROPDOWN] ?? "";
  ok("the shared dropdown: listbox ids, option props and the highlight", /\{\.\.\.nav\?\.listProps\}/.test(dd) && /\{\.\.\.nav\?\.optionProps\(i\)\}/.test(dd) && /\.\.\.\(nav\?\.active === i \? activeRowStyle\(true\) : null\)/.test(dd));
  ok("no ticker search box on the site is left out", code.unlisted.length === 0, code.unlisted.join(", "));
  return fails;
}

const src = fs.readFileSync(path.join(ROOT, MODULE), "utf8");
// Any file that fetches /api/symbols suggestions renders a ticker search box;
// each must be in BOXES (or be the shared dropdown's data source).
function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".") && e.name !== "api") walk(rel, out); }
    else if (/\.tsx$/.test(e.name) && !e.name.startsWith(".")) out.push(rel);
  }
  return out;
}
// Orphans: not imported anywhere (PickerResultPage.tsx and ScreenerNav.tsx say
// so). If one is ever mounted again it must join BOXES.
const ORPHANS = ["app/components/CustomScreenerSymbolSearch.tsx", "app/components/TickerSearchBox.tsx"];
// Files that call /api/symbols WITHOUT a search box: background name lookups.
const NOT_BOXES = {
  "app/pickers/PickersClient.tsx": "resolves company names for listed symbols in batches; its box is PickerTickerSearch",
};
const listed = new Set([...BOXES.map((b) => b.file), ...Object.keys(NOT_BOXES)]);
const unlisted = walk("app")
  .filter((f) => /\/api\/symbols\?q=/.test(fs.readFileSync(path.join(ROOT, f), "utf8")))
  .filter((f) => !listed.has(f) && !ORPHANS.includes(f));
for (const o of ORPHANS) {
  const importers = walk("app").filter((f) => f !== o && new RegExp(`from ["'][^"']*/${path.basename(o, ".tsx")}["']`).test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  if (importers.length) unlisted.push(`${o} (now imported by ${importers.join(", ")})`);
}
const files = [...new Set([...BOXES.map((b) => b.file), DROPDOWN])];
const code = { hook: readCodeOnly("app/components/useListboxNav.ts"), boxes: Object.fromEntries(files.map((f) => [f, readCodeOnly(f)])), unlisted };

const base = await suite(await loadSibling(MODULE, src), code);
if (base.length) {
  console.error("FAIL check-search-keyboard:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["Enter with nothing highlighted takes the first row", () => [mut("enter", src, `return has && cur >= 0 ? { kind: "select", index: cur } : { kind: "none" };`, `return has ? { kind: "select", index: Math.max(cur, 0) } : { kind: "none" };`), code]],
  ["Up stops at the first row", () => [mut("up", src, `index: cur <= 0 ? -1 : cur - 1`, `index: Math.max(cur - 1, 0)`), code]],
  ["Down wraps to the top", () => [mut("down", src, `index: Math.min(cur + 1, count - 1)`, `index: (cur + 1) % count`), code]],
  ["Tab swallowed (focus trapped)", () => [mut("tab", src, `return open ? { kind: "close", preventDefault: false } : { kind: "none" };`, `return open ? { kind: "close", preventDefault: true } : { kind: "none" };`), code]],
  ["Escape picks the row", () => [mut("esc", src, `return open ? { kind: "close", preventDefault: true } : { kind: "none" };`, `return has && cur >= 0 ? { kind: "select", index: cur } : { kind: "none" };`), code]],
  ["highlight not reset on typing", () => [src, { ...code, hook: mut("reset", code.hook, "useEffect(() => { setActive(-1); }, [resetKey, open]);", "") }]],
  ["no scroll into view", () => [src, { ...code, hook: mut("scroll", code.hook, `scrollIntoView?.({ block: "nearest" })`, `focus?.()`) }]],
  ["hover does not move the highlight", () => [src, { ...code, hook: mut("hover", code.hook, "onMouseMove: () => { if (index !== active) setActive(index); },", "") }]],
  ["the Pickers box keeps its own key handling (skips the hook)", () => [src, { ...code, boxes: { ...code.boxes, "app/components/PickerTickerSearch.tsx": mut("pick", code.boxes["app/components/PickerTickerSearch.tsx"], "if (nav.onKeyDown(e)) return;", "") } }]],
  ["the phone hero draws no highlight", () => [src, { ...code, boxes: { ...code.boxes, "app/components/DashboardClient.tsx": mut("mob", code.boxes["app/components/DashboardClient.tsx"], "...(navMobile.active === i ? activeRowStyle(true) : null)", "") } }]],
  ["the shared dropdown drops the hook", () => [src, { ...code, boxes: { ...code.boxes, [DROPDOWN]: mut("dd", code.boxes[DROPDOWN], "{...nav?.optionProps(i)}", "") } }]],
  ["a stock-page box does not hand the hook over", () => [src, { ...code, boxes: { ...code.boxes, "app/stock/[symbol]/news/StockNewsTickerJump.tsx": mut("news", code.boxes["app/stock/[symbol]/news/StockNewsTickerJump.tsx"], " nav={nav} />", " />") } }]],
  ["a new search box left out", () => [src, { ...code, unlisted: ["app/some/NewSearch.tsx"] }]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [s, c] = make();
  let fails;
  try { fails = await suite(await loadSibling(MODULE, s), c); } catch { fails = ["threw"]; }
  if (!fails.length) { survived++; console.error(`MUTANT SURVIVED: ${label}`); }
}
if (survived) process.exit(1);
console.log(`check-search-keyboard: rules hold, ${BOXES.length} boxes wired through one hook; ${MUTANTS.length} mutants caught`);
