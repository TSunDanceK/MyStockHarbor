// Two routes that answered "we are broken" with 200 and an empty body.
//
// /api/stock-valuation/[symbol] and /api/stock-analyst-rating/[symbol] are both
// fetched from StockSymbolPageClient with `?t=${Date.now()}` and guarded with
// `if (!res.ok) throw`. Both returned 200 + an empty payload when FMP_API_KEY
// was missing -- so a misconfigured deployment rendered the "no coverage" state
// on every symbol on the site, and nothing anywhere logged an error.
//
// Three different things shared one status: a bad symbol (the caller's
// mistake), a missing key (this server broken), and a ticker FMP genuinely has
// no data for (a real, correct, empty answer). Only the third should be a 200
// (claude/traps/return-type-cannot-express-failure.md).
//
// It also blocks caching, which is why it had to be fixed first: a 200 that
// might mean "we are broken" cannot safely be stored.
//
//   node scripts/check-failure-is-expressible.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const ROUTES = [
  "app/api/stock-valuation/[symbol]/route.ts",
  "app/api/stock-analyst-rating/[symbol]/route.ts",
];

// Comments stripped from every file, per
// claude/traps/a-regex-over-source-has-no-scope.md -- the notes added by this
// change quote the old shape, and matching prose would report the bug as still
// present (or as fixed, depending which way the regex leaned).
// Comments stripped with the real tokeniser, and guarded -- see scripts/lib/source-code.mjs.
const codeOf = (src, file) => stripComments(src, { file });

console.log("\n=== 1. A missing API key is a server error, not an empty answer ===\n");
for (const rel of ROUTES) {
  const code = codeOf(fs.readFileSync(path.join(ROOT, rel), "utf8"), rel);
  const name = rel.replace("app/api/", "").replace("/route.ts", "");

  check(
    `${name}: the combined \`!clean || !apiKey\` guard is gone`,
    !/if \(!clean \|\| !apiKey\)/.test(code),
    "one branch cannot answer a caller error and a server fault differently"
  );
  check(`${name}: a missing key returns 503`, /!apiKey[\s\S]{0,300}status: 503/.test(code));
  check(`${name}: a bad symbol returns 400`, /!clean[\s\S]{0,200}status: 400/.test(code));
  check(
    `${name}: neither failure carries an empty DATA payload`,
    !/!apiKey[\s\S]{0,300}emptyPayload\(/.test(code),
    "an empty body with a failure status is fine; an empty body pretending to be data is not"
  );
}

console.log("\n=== 2. A genuine absence of data still answers 200 ===\n");
// The distinction only helps if the real empty case is left alone. Over-fixing
// this -- returning 404 or 503 for a ticker nobody covers -- would swap one
// wrong reading for another, and the client would surface an error for a
// perfectly normal small-cap.
const rating = codeOf(fs.readFileSync(path.join(ROOT, ROUTES[1]), "utf8"), ROUTES[1]);
check(
  "analyst-rating: no target and no grades still returns an empty payload at 200",
  /if \(!targetRow && !gradesRow\)[\s\S]{0,200}emptyPayload\(/.test(rating) &&
    !/if \(!targetRow && !gradesRow\)[\s\S]{0,200}status:/.test(rating),
  "a ticker nobody covers is an answer, not a fault"
);
const valuation = codeOf(fs.readFileSync(path.join(ROOT, ROUTES[0]), "utf8"), ROUTES[0]);
check(
  "valuation: emptyPayload is gone, having lost its only caller",
  !/function emptyPayload/.test(valuation),
  "that route's remaining paths build a real payload of nulls, which is different"
);

console.log("\n=== 3. The client still guards on res.ok, so the status is read ===\n");
// A status nothing reads is a status that changes nothing. This is what turns
// the fix into a visible failure rather than a tidier server log.
const client = codeOf(
  fs.readFileSync(path.join(ROOT, "app/stock/[symbol]/StockSymbolPageClient.tsx"), "utf8"),
  "app/stock/[symbol]/StockSymbolPageClient.tsx"
);
for (const ep of ["stock-valuation", "stock-analyst-rating"]) {
  const idx = client.indexOf(`/api/${ep}/`);
  check(
    `${ep}: fetched and checked with if (!res.ok)`,
    idx > -1 && /if \(!res\.ok\)/.test(client.slice(idx, idx + 400)),
    idx > -1 ? "" : "call site not found — this check is measuring nothing"
  );
}

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
