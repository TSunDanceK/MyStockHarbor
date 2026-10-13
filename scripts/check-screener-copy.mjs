// EVERY SCREENER PAGE CARRIES ITS OWN WRITE-UP (#553 COWORK #200 item 1).
//
// The owner's ruling (11 Oct): every picker page gets an explainer section,
// replacing the 22 Aug "test 3-4 first" plan. Indexing stays a separate,
// one-way owner step: copy first (this check), unblocking later
// (lib/noindexPickerPages.ts, guarded by check-picker-copy-before-index).
//
// What must hold, for every route in lib/pickerRoutes.ts except the one that
// only 301s (/stocks-with-positive-last-earnings, see lib/positiveLastEarnings):
//   1. bodySections with at least MIN_WORDS words of paragraph text.
//   2. relatedScreens: 2 to 4 links, each a real picker route, never itself,
//      no duplicates.
//   3. Unique: no paragraph, and no sentence of 8+ words, appears on two pages.
//   4. No advice wording (buy now, you should buy/sell, price target, ...).
//   5. Server-rendered: PickerResultPage renders the write-up and the related
//      links in its own markup (not behind a click), the links with <Link>.
// Every rule has a planted mutant.
//
//   node scripts/check-screener-copy.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MIN_WORDS = 250;
const HIDDEN = ["/stocks-with-positive-last-earnings"];
const ADVICE = /\b(buy now|sell now|you should (buy|sell)|strong buy|price target|guaranteed|can(?:'|’)t lose|good investment|time to (buy|sell))\b/i;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const routesOf = (src) => [...(src.match(/export const PICKER_ROUTES = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]);
function paragraphsOf(src) {
  const block = src.match(/\n  bodySections: \[([\s\S]*?)\n  \],/);
  if (!block) return [];
  const out = [];
  for (const p of block[1].matchAll(/paragraphs: \[([\s\S]*?)\n\s*\],/g)) for (const q of p[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push(q[1]);
  return out;
}
const words = (t) => t.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
function relatedOf(src) {
  const block = src.match(/\n  relatedScreens: \[([\s\S]*?)\n  \],/);
  return block ? [...block[1].matchAll(/href: "([^"]+)"/g)].map((m) => m[1]) : null;
}

function rules({ routesSrc, pages, renderSrc }) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const routes = routesOf(routesSrc);
  want("the picker routes were found", routes.length >= 30);
  const seenPara = new Map();
  const seenSentence = new Map();
  for (const r of routes) {
    if (HIDDEN.includes(r)) continue;
    const src = pages[r];
    if (src === undefined) { want(`${r}: page file found`, false); continue; }
    const paras = paragraphsOf(src);
    const n = paras.reduce((a, p) => a + words(p), 0);
    want(`${r}: a write-up of at least ${MIN_WORDS} words (has ${n})`, n >= MIN_WORDS);
    const rel = relatedOf(src);
    want(`${r}: 2 to 4 related screens`, Array.isArray(rel) && rel.length >= 2 && rel.length <= 4);
    for (const h of rel ?? []) want(`${r}: related ${h} is a real picker route, not itself`, routes.includes(h) && !HIDDEN.includes(h) && h !== r);
    want(`${r}: no related screen twice`, !rel || new Set(rel).size === rel.length);
    for (const p of paras) {
      want(`${r}: no advice wording`, !ADVICE.test(p));
      const other = seenPara.get(p);
      want(`${r}: paragraph not shared with ${other}`, !other || other === r);
      seenPara.set(p, other ?? r);
      for (const s of p.split(/(?<=[.!?])\s+/)) {
        if (words(s) < 8) continue;
        const key = s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
        const o = seenSentence.get(key);
        want(`${r}: sentence not shared with ${o}: "${s.slice(0, 50)}…"`, !o || o === r);
        seenSentence.set(key, o ?? r);
      }
    }
  }
  const code = stripComments(renderSrc, { file: "app/components/PickerResultPage.tsx" });
  want("the write-up renders server-side, its links with <Link>",
    /config\.bodySections\.map\(\(section\) =>/.test(code) && /config\.relatedScreens\.map\(\(r\) => \(\s*<li key=\{r\.href\}>\s*<Link href=\{r\.href\}>\{r\.label\}<\/Link>/.test(code) && !/useState[^;]*relatedScreens/.test(code));
  return fails;
}

const routesSrc = read("lib/pickerRoutes.ts");
const pages = Object.fromEntries(routesOf(routesSrc).filter((r) => fs.existsSync(path.join(ROOT, `app${r}/page.tsx`))).map((r) => [r, read(`app${r}/page.tsx`)]));
const renderSrc = read("app/components/PickerResultPage.tsx");
const base = { routesSrc, pages, renderSrc };
const real = rules(base);
for (const f of real) check(f, false);
check("every screener page carries its own write-up and related screens", real.length === 0);

const first = Object.keys(pages).find((r) => !HIDDEN.includes(r) && relatedOf(pages[r]));
const second = Object.keys(pages).find((r) => r !== first && !HIDDEN.includes(r) && paragraphsOf(pages[r]).length);
const MUTANTS = [
  ["a page without related screens", first, (s) => s.replace(/\n  relatedScreens: \[[\s\S]*?\n  \],/, "")],
  ["a page linking itself", first, (s) => s.replace(/(\n  relatedScreens: \[\s*\{ href: )"\/[^"]+"/, `$1"${first}"`)],
  ["a link to a route that does not exist", first, (s) => s.replace(/(\n  relatedScreens: \[\s*\{ href: )"\/[^"]+"/, '$1"/no-such-screen"')],
  ["a short write-up", first, (s) => s.replace(/(\n  bodySections: \[)[\s\S]*?(\n  \],)/, '$1\n    { heading: "x", paragraphs: [\n      "Too short.",\n    ],\n    },$2')],
  ["advice wording", first, (s) => s.replace(/paragraphs: \[\n(\s*)"/, 'paragraphs: [\n$1"You should buy these today. ')],
  ["a paragraph copied from another page", second, (s) => s.replace(/paragraphs: \[\n(\s*)"/, `paragraphs: [\n$1"${paragraphsOf(pages[first])[0]}",\n$1"`)],
];
for (const [label, route, mutate] of MUTANTS) {
  const m = mutate(pages[route]);
  if (m === pages[route]) { check(`mutant "${label}" applies`, false, "the mutation matched nothing"); continue; }
  const f = rules({ ...base, pages: { ...pages, [route]: m } });
  check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
}
{
  const m = renderSrc.replace("<Link href={r.href}>{r.label}</Link>", "<span>{r.label}</span>");
  const f = m === renderSrc ? ["(did not apply)"] : rules({ ...base, renderSrc: m });
  check('mutant "the related links not rendered as links" is caught', m !== renderSrc && f.length > 0, f[0] ?? "no rule failed");
}

console.log(failures ? `\n${failures} FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
