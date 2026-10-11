// FMP-off clean-up (#553 CODE-B #94, B10-B12 and the three red jobs).
//
// WHAT IS PINNED, AND HOW:
//
//   1. warm-earnings, warm-fundamentals and warm-stock-data answer 200 with
//      { ok: true, skipped: true, reason: "no FMP_API_KEY" } (the warm-price-pool shape) when the key is unset, record the
//      run as ok + skipped, and do NOTHING else first -- no target derivation,
//      no queue enqueue, no lock. Proven by RUNNING each route's GET: the route
//      is transpiled with every import replaced by a call-recording stub, so
//      "nothing else first" is the list of stub calls the handler made, not an
//      offset comparison. With the key set the same harness shows the handler
//      going past the gate (unchanged path). Auth still comes first (401).
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

// ── harness: a route module with every import stubbed ───────────────────────

const HARNESS = `
const __h = globalThis.__FMPOFF_HARNESS__;
const __mk = (name) => new Proxy(function () {}, {
  apply(_t, _this, args) { __h.calls.push(name); return __mk(name + "()"); },
  construct() { __h.calls.push("new " + name); return __mk(name + " instance"); },
  get(_t, p) {
    if (p === Symbol.toPrimitive) return () => 1;
    if (p === "then") return undefined;
    return __mk(name + "." + String(p));
  },
});
`;

// Names with real behaviour; everything else imported becomes a recording stub.
const SPECIAL = {
  NextResponse: `{ json: (body, init) => new Response(JSON.stringify(body ?? null), { status: init?.status ?? 200, headers: { "content-type": "application/json" } }) }`,
  NextRequest: `Request`,
  recordJobRun: `async (...args) => { __h.calls.push("recordJobRun"); __h.records.push(args); }`,
  guardJob: `(_job, handler) => handler`,
  Redis: `class { static fromEnv() { return __mk("redis"); } }`,
};

function stubbedModuleSource(src) {
  const sf = ts.createSourceFile("route.ts", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const names = new Set();
  const cuts = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    cuts.push([st.getStart(sf), st.getEnd()]);
    const clause = st.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.add(clause.name.text);
    const nb = clause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) if (!el.isTypeOnly) names.add(el.name.text);
    } else if (nb && ts.isNamespaceImport(nb)) names.add(nb.name.text);
  }
  let body = src;
  for (const [a, b] of cuts.reverse()) body = body.slice(0, a) + body.slice(b);
  const stubs = [...names]
    .map((n) => `const ${n} = ${SPECIAL[n] ?? `__mk(${JSON.stringify(n)})`};`)
    .join("\n");
  return HARNESS + stubs + "\n" + body;
}

let seq = 0;
async function loadRoute(src, env) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  const h = { calls: [], records: [] };
  globalThis.__FMPOFF_HARNESS__ = h;
  const js = ts.transpileModule(stubbedModuleSource(src) + `\n//${++seq}\n`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return { mod, h, restore };
}

// Fake values only: every client is a stub, nothing connects anywhere.
const BASE_ENV = {
  UPSTASH_REDIS_REST_URL: "stub",
  UPSTASH_REDIS_REST_TOKEN: "stub",
  CRON_SECRET: "s3cret",
  NEXT_PUBLIC_SITE_URL: "http://localhost",
};
const authed = (job) =>
  new Request(`http://localhost/api/jobs/${job}`, { headers: { authorization: "Bearer s3cret" } });

async function runGet(src, job, { key, auth = true }) {
  const { mod, h, restore } = await loadRoute(src, { ...BASE_ENV, FMP_API_KEY: key });
  try {
    h.calls.length = 0; // only what the HANDLER does, not module initialisation
    let res = null;
    let threw = null;
    try {
      res = await mod.GET(auth ? authed(job) : new Request(`http://localhost/api/jobs/${job}`));
    } catch (e) {
      threw = e;
    }
    const body = res ? await res.json().catch(() => null) : null;
    return { status: res?.status ?? null, body, calls: [...h.calls], records: [...h.records], threw };
  } finally {
    restore();
  }
}

/** The no-key contract, as a list of [label, ok, detail]. */
async function noKeyVerdicts(src, job) {
  const out = [];
  const r = await runGet(src, job, { key: undefined });
  out.push([`${job}: no key -> 200`, r.status === 200, `status ${r.status}`]);
  out.push([
    `${job}: no key -> body { ok: true, skipped: true, reason: "no FMP_API_KEY" }`,
    r.body?.ok === true && r.body?.skipped === true && r.body?.reason === "no FMP_API_KEY",
    JSON.stringify(r.body),
  ]);
  const rec = r.records[0];
  out.push([
    `${job}: no key -> recorded as ok + skipped (not failed, not silent)`,
    r.records.length === 1 &&
      rec[0] === job &&
      rec[1] === true &&
      rec[2]?.skipped === true &&
      rec[2]?.reason === "no FMP_API_KEY",
    JSON.stringify(r.records),
  ]);
  out.push([
    `${job}: no key -> no work before the skip (only the run record)`,
    r.calls.length === 1 && r.calls[0] === "recordJobRun",
    r.calls.join(", ") || "(none)",
  ]);
  return out;
}

const JOBS = [
  {
    job: "warm-earnings",
    // With a key the stubbed lock read is not "OK", so the run reaches the
    // lock-skip: past the FMP gate, and stops before any FMP call.
    withKey: (r) => r.status === 200 && r.body?.reason === "locked",
  },
  { job: "warm-fundamentals", withKey: (r) => r.calls.includes("getWarmTargetSymbols") },
  { job: "warm-stock-data", withKey: (r) => r.calls.includes("getWarmTargetSymbols") },
];

const SKIP_RETURN = `return NextResponse.json({ ok: true, skipped: true, reason: "no FMP_API_KEY" });`;
const OLD_500 = `return NextResponse.json({ error: "Missing FMP_API_KEY environment variable." }, { status: 500 });`;
const NEW_RECORD = (job) => `await recordJobRun("${job}", true, { skipped: true, reason: "no FMP_API_KEY" });`;

console.log("\n1. FMP warm jobs skip with 200 without the key");
for (const { job, withKey } of JOBS) {
  const rel = `app/api/jobs/${job}/route.ts`;
  const src = read(rel);

  for (const [label, ok, detail] of await noKeyVerdicts(src, job)) check(label, ok, detail);

  const keyed = await runGet(src, job, { key: "stub-key" });
  check(
    `${job}: key set -> handler goes past the gate (unchanged path)`,
    withKey(keyed) && !keyed.records.some((r) => r[2]?.reason === "no FMP_API_KEY"),
    `status ${keyed.status}, calls: ${keyed.calls.slice(0, 4).join(", ")}`
  );

  const unauth = await runGet(src, job, { key: undefined, auth: false });
  check(
    `${job}: unauthorized -> 401 before the skip, nothing recorded`,
    unauth.status === 401 && unauth.records.length === 0,
    `status ${unauth.status}`
  );

  // MUTANT "500 restored": the pre-change answer. Must be caught.
  check(`${job}: source carries the skip return being mutated`, src.includes(SKIP_RETURN));
  const m500 = src.replace(SKIP_RETURN, OLD_500);
  const v500 = await noKeyVerdicts(m500, job);
  check(`${job}: MUTANT "500 restored" is caught`, v500.some(([, ok]) => !ok));

  // MUTANT "gate removed": no key check at all, so the run does the work
  // anyway. Must be caught by the no-work-before-the-skip assertion.
  const blockStart = src.indexOf("  if (!process.env.FMP_API_KEY) {");
  const blockEnd = src.indexOf("\n  }\n", src.indexOf(SKIP_RETURN)) + 4;
  const mGone = blockStart >= 0 ? src.slice(0, blockStart) + src.slice(blockEnd) : src;
  check(`${job}: MUTANT "gate removed" differs from the source`, mGone !== src && !mGone.includes(NEW_RECORD(job)));
  const vGone = await noKeyVerdicts(mGone, job);
  check(`${job}: MUTANT "gate removed" is caught`, vGone.some(([, ok]) => !ok));
}

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
