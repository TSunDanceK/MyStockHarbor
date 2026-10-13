// FMP-off clean-up (#553 CODE-B #94, B10-B12 and the three red jobs).
//
// WHAT IS PINNED, AND HOW:
//
//   1. The three FMP warm jobs (warm-earnings, warm-fundamentals,
//      warm-stock-data) stay retired: no route file and no cron entry. Until
//      2026-10-12 (#553 COWORK #212) this section RAN each route's GET to prove
//      its no-key skip; the jobs were retired with FMP.
//   2. B10: app/api/stock-earnings-debug/ is gone and no code references it.
//   3. B11: no client component calls a cron job route, in particular
//      /api/jobs/warm-earnings, and no page copy points readers at the removed
//      "Fetch Earnings" button.
//   4. B12: the stock page's fetchQuote, run in isolation: Tiingo asked, Tiingo
//      missed, no FMP key -> "no-data"; FMP configured and failing ->
//      "unavailable"; no provider asked and no key -> "unavailable".
//
// Every behavioural assertion is also run against a MUTANT of the source and
// must FAIL there, so a PASS here is not a harness that cannot see.
//
//   node scripts/check-fmpoff-cleanup.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── 1. RETIRED 2026-10-12 (#553 COWORK #212, owner GO) ────────────────────────
// Section 1 RAN each FMP warm job's GET (warm-earnings, warm-fundamentals,
// warm-stock-data) through an all-imports-stubbed harness to prove the no-key
// skip. The jobs, their crons and their routes are retired, so what is pinned
// now is that they stay gone: no route file, no cron entry.
console.log("\n1. The FMP warm jobs are retired: no route, no cron");
let seq = 0; // module-name counter for the lifts below
const RETIRED_JOBS = ["warm-earnings", "warm-fundamentals", "warm-stock-data"];
const retiredVerdicts = (vercelJson, exists) => {
  const crons = (JSON.parse(vercelJson).crons ?? []).map((c) => c.path);
  return RETIRED_JOBS.flatMap((job) => [
    [`${job}: no route file`, !exists(`app/api/jobs/${job}/route.ts`)],
    [`${job}: no cron entry`, !crons.includes(`/api/jobs/${job}`)],
  ]);
};
const vercelSrc = read("vercel.json");
const onDisk = (rel) => fs.existsSync(path.join(ROOT, rel));
for (const [label, ok] of retiredVerdicts(vercelSrc, onDisk)) check(label, ok);
// MUTANTS: a cron entry restored, and a route file restored. Each must be caught.
const withCron = JSON.stringify({ ...JSON.parse(vercelSrc), crons: [...(JSON.parse(vercelSrc).crons ?? []), { path: "/api/jobs/warm-stock-data", schedule: "7-57/10 * * * *" }] });
check('MUTANT "a retired cron restored" is caught', retiredVerdicts(withCron, onDisk).some(([, ok]) => !ok));
check('MUTANT "a retired route restored" is caught', retiredVerdicts(vercelSrc, (rel) => rel === "app/api/jobs/warm-earnings/route.ts" || onDisk(rel)).some(([, ok]) => !ok));

// ── 2. B10 ──────────────────────────────────────────────────────────────────

console.log("\n2. B10: the public FMP probe route is gone");
check(
  "app/api/stock-earnings-debug/ does not exist",
  !fs.existsSync(path.join(ROOT, "app/api/stock-earnings-debug"))
);

const SELF = "scripts/check-fmpoff-cleanup.mjs";
const CODE_EXT = /\.(?:ts|tsx|js|jsx|mjs|json)$/;
function walk(dir, out = []) {
  for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
    const rel = path.posix.join(dir, ent.name);
    if (ent.isDirectory()) walk(rel, out);
    else if (CODE_EXT.test(ent.name)) out.push(rel);
  }
  return out;
}
const codeFiles = ["app", "lib", "scripts"]
  .flatMap((d) => walk(d))
  .concat(["vercel.json", "middleware.ts", "next.config.ts", "next.config.js", "next.config.mjs"].filter((f) => fs.existsSync(path.join(ROOT, f))))
  .filter((f) => f !== SELF);
check("code corpus scanned", codeFiles.length > 200, `${codeFiles.length} files`);

const codeOnly = (rel) => {
  const raw = read(rel);
  return rel.endsWith(".json") ? raw : stripComments(raw, { file: rel, minRetainedFraction: 0 });
};
const refsToDebugRoute = codeFiles.filter((f) => codeOnly(f).includes("stock-earnings-debug"));
check("no code references stock-earnings-debug", refsToDebugRoute.length === 0, refsToDebugRoute.join(", "));

// ── 3. B11 ──────────────────────────────────────────────────────────────────

console.log("\n3. B11: no browser call to a cron job route");
const isClient = (raw) => /^\s*["']use client["']/.test(raw);
const clientJobCalls = (files, override = {}) =>
  files.filter((f) => {
    const raw = override[f] ?? read(f);
    if (!isClient(raw)) return false;
    const code = stripComments(raw, { file: f, minRetainedFraction: 0 });
    return code.includes("/api/jobs/");
  });
const clientFiles = codeFiles.filter((f) => /\.(?:tsx|ts|jsx|js)$/.test(f) && f.startsWith("app/"));
check("client components were found", clientFiles.filter((f) => isClient(read(f))).length > 20);
const offenders = clientJobCalls(clientFiles);
check("no client component calls /api/jobs/* (warm-earnings included)", offenders.length === 0, offenders.join(", "));

// MUTANT: the old fetch line put back into the pickers client.
const PICKERS = "app/pickers/PickersClient.tsx";
const pickersRaw = read(PICKERS);
const anchor = "  function toggleSection(title: string) {";
check("pickers client carries the mutation anchor", pickersRaw.includes(anchor));
const pickersMutant = pickersRaw.replace(
  anchor,
  "  async function handleFetchEarnings() {\n    await fetch(`/api/jobs/warm-earnings?t=${Date.now()}`, { cache: \"no-store\" });\n  }\n\n" + anchor
);
check(
  'MUTANT "Fetch Earnings call restored" is caught',
  clientJobCalls([PICKERS], { [PICKERS]: pickersMutant }).length === 1
);
check("pickers client no longer renders a Fetch Earnings button", !/>\s*\{?[^<]*"Fetch Earnings"/.test(codeOnly(PICKERS)) && !codeOnly(PICKERS).includes("handleFetchEarnings"));

const copyFiles = codeFiles.filter((f) => f.startsWith("app/") && /page\.tsx$/.test(f));
const staleCopy = copyFiles.filter((f) => /Fetch Earnings button/.test(read(f)));
check("no page copy points to the Fetch Earnings button", staleCopy.length === 0, staleCopy.join(", "));

// ── 4. B12 ──────────────────────────────────────────────────────────────────

console.log("\n4. B12: unknown ticker with no FMP key reads No data");
const PAGE = "app/stock/[symbol]/page.tsx";
const pageSrc = read(PAGE);

function liftFetchQuote(src) {
  const sf = ts.createSourceFile("page.tsx", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "fetchQuote");
  if (!fn) throw new Error("fetchQuote not found in " + PAGE);
  return fn.getText(sf);
}

async function runFetchQuote(src, { provider, key, tiingo, fmp }) {
  const unit =
    `const __q = globalThis.__FMPOFF_QUOTE__;\n` +
    `const priceProviderFor = (s) => (s === "STOCK_PAGE" ? __q.provider : "fmp");\n` +
    `const readTiingoQuote = async () => __q.tiingo;\n` +
    // #553 COWORK #121: a cold Tiingo symbol skips FMP; these runs are not cold.
    `const isColdTiingoCandidate = async () => false;\n` +
    `const EMPTY_QUOTE = { price: null };\n` +
    `const fmpFetch = async () => __q.fmp();\n` +
    `const toDashed = (s) => s;\n` +
    `type InitialQuote = any; type QuoteOutcome = string;\n` +
    liftFetchQuote(src) +
    `\nexport { fetchQuote };\n//${++seq}\n`;
  const js = ts.transpileModule(unit, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  globalThis.__FMPOFF_QUOTE__ = { provider, tiingo, fmp: fmp ?? (() => new Response("[]", { status: 200 })) };
  const saved = process.env.FMP_API_KEY;
  if (key === undefined) delete process.env.FMP_API_KEY;
  else process.env.FMP_API_KEY = key;
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    return (await mod.fetchQuote("ZZZZ")).outcome;
  } finally {
    if (saved === undefined) delete process.env.FMP_API_KEY;
    else process.env.FMP_API_KEY = saved;
  }
}

const tiingoHit = { price: 10, date: "2026-10-02" };
const SCENARIOS = [
  ["tiingo, no key, Tiingo miss -> no-data", { provider: "tiingo", key: undefined, tiingo: null }, "no-data"],
  ["tiingo, no key, Tiingo hit -> ok", { provider: "tiingo", key: undefined, tiingo: tiingoHit }, "ok"],
  ["fmp provider, no key -> unavailable (nothing was asked)", { provider: "fmp", key: undefined, tiingo: null }, "unavailable"],
  [
    "tiingo, key set, Tiingo miss, FMP fails -> unavailable",
    { provider: "tiingo", key: "k", tiingo: null, fmp: () => new Response("x", { status: 503 }) },
    "unavailable",
  ],
  ["tiingo, key set, Tiingo miss, FMP empty row -> no-data", { provider: "tiingo", key: "k", tiingo: null }, "no-data"],
];
for (const [label, sc, want] of SCENARIOS) {
  const got = await runFetchQuote(pageSrc, sc);
  check(label, got === want, `got ${got}`);
}

// MUTANT: the pre-change no-key answer.
const NOKEY = `outcome: tiingoAsked ? "no-data" : "unavailable" }`;
check("page carries the no-key outcome being mutated", pageSrc.includes(NOKEY));
const pageMutant = pageSrc.replace(NOKEY, `outcome: "unavailable" }`);
check(
  'MUTANT "no-key Tiingo miss reads unavailable" is caught',
  (await runFetchQuote(pageMutant, SCENARIOS[0][1])) !== "no-data"
);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall FMP-off clean-up checks passed");
process.exit(failures ? 1 : 0);
