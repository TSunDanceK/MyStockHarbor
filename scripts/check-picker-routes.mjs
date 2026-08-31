// The picker route registry, and the two ways a route-level revalidate lies.
//
// WHY A REGISTRY IS CHECKED RATHER THAN TRUSTED. warm-picker-universe
// revalidates the picker pages by path. The obvious implementation was to type
// those ~36 paths into the cron route, which is precisely the shape #376 removed
// from stalenessQueue.ts: a hand-maintained second copy that nothing compares to
// anything, and that goes stale the first time a page is added. lib/pickerRoutes.ts
// is the single declaration; this asserts it still matches the filesystem, so
// adding a page without listing it fails here instead of quietly never
// revalidating.
//
// AND THE INERT-REVALIDATE TRAP. `export const revalidate = N` on a [param]
// segment does nothing without generateStaticParams -- the segment stays fully
// dynamic and every crawl is a full render, with nothing warning
// (claude/traps/inert-route-revalidate.md). The known offenders are listed
// below with their reason, so a NEW one fails rather than joining them.
//
//   node scripts/check-picker-routes.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
}

const pages = walk(path.join(ROOT, "app"));
const registrySrc = fs.readFileSync(path.join(ROOT, "lib/pickerRoutes.ts"), "utf8");
const registry = [...registrySrc.matchAll(/^  "(\/[^"]+)",$/gm)].map((m) => m[1]);

// The two PickerResultPage importers that are not picker RESULT pages.
const NOT_RESULT_PAGES = new Set(["/pickers", "/stock/[symbol]"]);

const onDisk = pages
  .filter((p) => fs.readFileSync(p, "utf8").includes("PickerResultPage"))
  .map((p) => path.dirname(p).slice(path.join(ROOT, "app").length).replace(/\\/g, "/"))
  .filter((r) => !NOT_RESULT_PAGES.has(r))
  .sort();

console.log("\n=== 1. The registry matches the filesystem ===\n");

const missing = onDisk.filter((r) => !registry.includes(r));
const extra = registry.filter((r) => !onDisk.includes(r));

check(
  "every picker page is in PICKER_ROUTES",
  missing.length === 0,
  `a page absent here is a page the cron never revalidates, which fails silently — ${missing.join(", ") || "none missing"}`
);
check(
  "PICKER_ROUTES has no routes that no longer exist",
  extra.length === 0,
  `revalidatePath on a dead route is a no-op that reads as coverage — ${extra.join(", ") || "none stale"}`
);
check("the registry is not empty", registry.length > 0, `${registry.length} routes`);

console.log("\n=== 2. The cron derives the list rather than repeating it ===\n");

const cron = fs.readFileSync(
  path.join(ROOT, "app/api/jobs/warm-picker-universe/route.ts"),
  "utf8"
);

check(
  "the cron imports the registry",
  /PICKER_ROUTES/.test(cron) && /revalidatePath/.test(cron),
  "deriving is the whole point — a second hand-typed copy is what #376 removed one module over"
);
check(
  "the cron hard-codes no picker paths of its own",
  !registry.some((r) => cron.includes(`"${r}"`)),
  "one literal path here is the beginning of the copy this registry exists to prevent"
);

console.log("\n=== 3. The backstop is uniform ===\n");

const wrongRevalidate = registry.filter((r) => {
  const src = fs.readFileSync(path.join(ROOT, "app", r, "page.tsx"), "utf8");
  return !/export const revalidate = 1800;/.test(src);
});
check(
  "every picker page declares the 1800 backstop",
  wrongRevalidate.length === 0,
  `a shorter timer on one page reinstates the rebuild-per-scrape cost for that page alone — ${wrongRevalidate.join(", ") || "all 1800"}`
);

console.log("\n=== 4. No NEW inert route-level revalidate ===\n");

// Known-inert, with the reason they are not simply fixed. Removing an entry
// requires the route to actually gain generateStaticParams.
const KNOWN_INERT = new Set([
  // scripts/check-static-safety.mjs reports a bare Redis.fromEnv() in
  // lib/youtube.ts (no PAGE_READ_CACHE) plus no-store fetches on this route's
  // transitive read path. Prerendering it in that state is the #310 outage:
  // DYNAMIC_SERVER_USAGE at request time, a 500 rather than a fallback. The
  // revalidate stays inert until that client is routed through PAGE_READ_CACHE.
  "app/insights/videos/[videoId]/page.tsx",
]);

const inert = pages
  .map((p) => [path.relative(ROOT, p).replace(/\\/g, "/"), fs.readFileSync(p, "utf8")])
  .filter(([rel, src]) =>
    /\[[^\]]+\]/.test(rel) &&
    /export const revalidate = \d+/.test(src) &&
    !/generateStaticParams/.test(src)
  )
  .map(([rel]) => rel);

const newInert = inert.filter((r) => !KNOWN_INERT.has(r));
check(
  "no dynamic segment declares a revalidate it cannot honour",
  newInert.length === 0,
  `without generateStaticParams the constant reads as active and does nothing — ${newInert.join(", ") || "none new"}`
);

const fixed = [...KNOWN_INERT].filter((r) => !inert.includes(r));
check(
  "the known-inert list has no stale entries",
  fixed.length === 0,
  `an entry that has since been fixed is an exemption outliving its reason — ${fixed.join(", ") || "all still inert"}`
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
