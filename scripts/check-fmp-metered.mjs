// Reports which FMP call sites the byte meter actually observes.
//
// A PARTIAL METER IS THE FAILURE MODE THIS WHOLE THING EXISTS TO FIX. The call
// guard is not wrong about calls; it is simply blind to bytes, and nothing said
// so. A byte meter wired into half the call sites has exactly the same defect
// one level down: it would report a confident, plausible, low total, and the
// endpoint eating the cap could be one of the unmetered ones. A number whose
// coverage is unknown is not a measurement.
//
//   node scripts/check-fmp-metered.mjs
//
// Exits non-zero when an FMP fetch is not going through fmpFetch, so the gap is
// a build-time finding rather than something to notice later in a dashboard
// that disagrees with production.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "scripts"]);

// Deliberately NOT metered, with a reason each. An exemption without a reason
// is how a gap becomes permanent.
const EXEMPT = new Map([
  [
    "app/api/debug/fmp-endpoints/route.ts",
    "owner-only probe, ~12 calls by hand and never on a cron; metering it would " +
      "put diagnostic traffic into the production usage figure it exists to explain",
  ],
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Strip comments: several files EXPLAIN the FMP endpoints in prose, and matching
// that would invent call sites that do not exist
// (claude/traps/grep-finds-the-comment-not-the-code.md).
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (l.trim().startsWith("//") ? "" : l))
    .join("\n");

// The API host WITH a scheme, which is narrower than it looks and deliberately
// so. The first draft matched the bare string "financialmodelingprep.com" and
// reported four files as unmetered call sites that make no API call at all:
//
//   app/components/TickerLogo.tsx        images.financialmodelingprep.com --
//                                        a DIFFERENT host, loaded by the browser
//                                        as an <img src>, carrying no API key and
//                                        costing the API plan nothing
//   app/upcoming-ipos/page.tsx           "Data source: financialmodelingprep.com"
//   app/headlines/page.tsx               same attribution line
//   app/earnings-calendar/page.tsx       same attribution line
//
// Stripping comments was not enough because these live in JSX copy, not
// comments -- the same trap one layer over
// (claude/traps/grep-finds-the-comment-not-the-code.md). Requiring `https://`
// plus the exact API host excludes the image CDN and every prose mention, and a
// coverage figure that counts non-call-sites as gaps is a number nobody will
// trust twice.
const FMP_API_URL = /https:\/\/financialmodelingprep\.com\//;

const files = walk(ROOT);
const metered = [];
const unmetered = [];
const exempt = [];

for (const full of files) {
  const rel = path.relative(ROOT, full);
  const code = stripComments(fs.readFileSync(full, "utf8"));
  if (!FMP_API_URL.test(code)) continue;

  const fmpCalls = (code.match(/\bawait fmpFetch\s*\(/g) ?? []).length;
  // A plain `fetch(` in a file that also builds FMP URLs. Files that talk to
  // other hosts too (stock-news-data.ts: Yahoo, stooq, Google News, Nasdaq
  // Trader) legitimately keep plain fetches, so a bare count would false-positive
  // -- what matters is whether any FMP URL reaches a plain fetch.
  const plainCalls = (code.match(/\bawait fetch\s*\(/g) ?? []).length;

  if (EXEMPT.has(rel)) {
    exempt.push({ rel, fmpCalls, plainCalls });
    continue;
  }
  if (fmpCalls > 0) metered.push({ rel, fmpCalls, plainCalls });
  else unmetered.push({ rel, fmpCalls, plainCalls });
}

const pad = (s, n) => String(s).padEnd(n);
console.log("\n=== Files building FMP URLs ===\n");
console.log(`  ${pad("file", 52)} fmpFetch  plain fetch`);
for (const r of [...metered].sort((a, b) => a.rel.localeCompare(b.rel))) {
  console.log(`  ${pad(r.rel, 52)} ${pad(r.fmpCalls, 9)} ${r.plainCalls}`);
}

if (exempt.length) {
  console.log("\n  EXEMPT (reason recorded in this script):");
  for (const r of exempt) console.log(`    ${r.rel}\n      ${EXEMPT.get(r.rel)}`);
}

const total = metered.length + unmetered.length;
console.log(`\n=== Coverage: ${metered.length} of ${total} non-exempt files ===\n`);

if (unmetered.length) {
  console.log("  NOT METERED — every FMP byte from these is invisible to readFmpUsage():\n");
  for (const r of unmetered.sort((a, b) => a.rel.localeCompare(b.rel))) {
    console.log(`    ${pad(r.rel, 52)} ${r.plainCalls} plain fetch call(s)`);
  }
  console.log(
    "\n  Either swap `await fetch(` for `await fmpFetch(` on the FMP calls, or add an\n" +
      "  entry to EXEMPT in this script WITH a reason. An unexplained gap makes the\n" +
      "  30-day total an underestimate of unknown size, which is worse than no total.\n"
  );
  process.exit(1);
}

console.log("  Every FMP call site is metered or explicitly exempt.\n");
