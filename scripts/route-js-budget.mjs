// FIRST-LOAD JAVASCRIPT PER ROUTE, AGAINST A BUDGET (#552 COWORK #228 (2) / #231).
//
// Next 16 prints no per-route size table, so this reads the build's own
// manifests: each app route's client-reference manifest lists the chunks its
// entries load (the root layout's and the page's), the build manifest lists
// the framework's root chunks, and every chunk is gzipped and summed. The
// numbers are what a first visit downloads, compressed.
//
// It needs a compiled .next (no data, no Redis): `--build` runs
// `next build --experimental-build-mode=compile` first. A full `next build`
// cannot finish locally (see CLAUDE.md: ISR pages need Upstash), and compile
// mode emits the same client chunks. check-all cannot build, so this runs as
// its own step: .github/workflows/js-budget.yml on pull requests, or by hand:
//
//   node scripts/route-js-budget.mjs --build      # build, then measure
//   node scripts/route-js-budget.mjs              # measure an existing .next
//
// BUDGETS are gzipped bytes, set from the 2026-10-14 build after the header
// split (#552 COWORK #231) plus a little headroom. A budget is raised on
// purpose, in the PR that needs it, never to make a red check green.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const BUDGET = {
  // React + Next's runtime (rootMainFiles): moves with framework upgrades.
  framework: 127_000,
  // The root layout's own client JS: the header island and the other layout
  // islands, on every page. 14,242 B before the header split, 8,456 B after.
  layout: 9_000,
  // Page-only JS (beyond framework + layout), per route group.
  page: [
    { name: "home / dashboard", test: /^\/(dashboard)?$/, max: 100_000 },
    { name: "stock page", test: /^\/stock\/\[symbol\]$/, max: 86_000 },
    { name: "picker / screener pages", test: /stocks?|screener|pickers|plays|divergence|breakout|flip|signals|today$/, max: 53_000 },
    { name: "every other page", test: /./, max: 52_000 },
  ],
};

if (process.argv.includes("--build")) {
  const r = spawnSync("npx", ["next", "build", "--experimental-build-mode=compile"], { stdio: "inherit" });
  if (r.status !== 0) { console.error("compile build failed"); process.exit(1); }
}
const N = ".next";
if (!fs.existsSync(path.join(N, "build-manifest.json"))) {
  console.error("No .next build here: run with --build (or `next build --experimental-build-mode=compile`) first.");
  process.exit(1);
}
const gz = new Map();
const size = (f) => {
  if (!gz.has(f)) { const p = path.join(N, f); gz.set(f, fs.existsSync(p) ? zlib.gzipSync(fs.readFileSync(p)).length : 0); }
  return gz.get(f);
};
const sum = (files) => [...files].reduce((a, f) => a + size(f), 0);
const root = JSON.parse(fs.readFileSync(path.join(N, "build-manifest.json"), "utf8")).rootMainFiles ?? [];

const routes = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "page_client-reference-manifest.js") {
      const ctx = { globalThis: {} };
      vm.runInNewContext(fs.readFileSync(p, "utf8"), ctx);
      const [route, m] = Object.entries(ctx.globalThis.__RSC_MANIFEST)[0];
      const layout = new Set(), page = new Set();
      for (const [entry, files] of Object.entries(m.entryJSFiles ?? {})) for (const f of files) (/app\/layout$/.test(entry) ? layout : page).add(f);
      for (const f of layout) page.delete(f);
      for (const f of root) { layout.delete(f); page.delete(f); }
      routes.push({ route: route.replace(/\/page$/, "") || "/", layout: sum(layout), page: sum(page) });
    }
  }
})(path.join(N, "server", "app"));

const framework = sum(root);
const layout = Math.max(...routes.map((r) => r.layout));
let failures = 0;
const line = (ok, label, val, max) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${val.toLocaleString("en-US")} B gz (budget ${max.toLocaleString("en-US")})`); if (!ok) failures++; };
console.log(`route JS budget: ${routes.length} routes`);
line(framework <= BUDGET.framework, "framework (root chunks, every page)", framework, BUDGET.framework);
line(layout <= BUDGET.layout, "root layout incl. the header island (every page)", layout, BUDGET.layout);
const pages = routes.filter((r) => !r.route.startsWith("/api") && !r.route.startsWith("/_"));
for (const g of BUDGET.page) {
  const mine = pages.filter((r) => !r.taken && g.test.test(r.route));
  for (const r of mine) r.taken = true;
  if (!mine.length) continue;
  const worst = mine.reduce((a, b) => (b.page > a.page ? b : a));
  line(worst.page <= g.max, `${g.name}, largest page-only (${worst.route}, ${mine.length} routes)`, worst.page, g.max);
}
const top = [...pages].sort((a, b) => b.page - a.page).slice(0, 5);
console.log(`  largest first loads: ${top.map((r) => `${r.route} ${Math.round((framework + layout + r.page) / 1024)} kB`).join(", ")}`);
console.log(failures ? `\n${failures} OVER BUDGET` : "\nWithin budget.");
process.exit(failures ? 1 : 0);
