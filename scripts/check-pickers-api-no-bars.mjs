// NO PRICE BARS IN THE PUBLIC /api/pickers ANSWER (#553 COWORK #105).
//
// Contract ruling: Tiingo-derived bars don't go out through public JSON; pages
// read them in-process. /api/pickers is public and CDN-cached, and carried
// signalRecords[].chartPoints (72 daily bars each) and the weekly sections'
// items[].chartPoints. What must hold:
//
//   1. The REAL handlePickersRequest, run on every payload path against stubbed
//      I/O (memo, cached, preview last-good, published-after-wait, fresh build,
//      forced build, degraded fallback, build-threw fallback, the warm route's
//      history force, the 500 body), answers with no `chartPoints` at ANY depth
//      -- a deep scan, not a list of known places.
//   2. The shared in-process copy is not mutated: the memo still carries every
//      bar afterwards, and getPickersData (the pages' reader) returns them.
//   3. Every NextResponse.json in the handler passes either pickersWithoutBars(..)
//      or an inline error object, so a path added later cannot skip the filter.
//   4. The pages that draw charts read bars in-process: PickerResultPage reads
//      getPickersData unfiltered and puts record/item chartPoints on its
//      entries. No browser reader of /api/pickers reads chartPoints (so the
//      stripped answer, and /pickers' stripped props, lose them nothing).
//   5. No server action reads the pickers builder: getPickersData has no
//      cache-only mode, so one would build on a POST.
//   6. Mutants: each of the above broken once, and caught.
//
//   node scripts/check-pickers-api-no-bars.mjs
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const BUILDER = "lib/server/pickersBuilder.ts";
const PUBLIC = "lib/pickersPublic.ts";
const builderRaw = read(BUILDER);
const publicRaw = read(PUBLIC);

function grabFns(src, names) {
  const sf = ts.createSourceFile(BUILDER, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = {};
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)) {
      out[n.name.text] = n.getText(sf).replace(/^export\s+/, "");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const WANTED = ["isDegradedBuild", "recordBuildStats", "getPickersData", "handlePickersRequest", "isCronAuthorized"];

// ---------------------------------------------------------------------------
// The stub bench. I/O only; the handler, getPickersData and pickersWithoutBars
// are the real source.
// ---------------------------------------------------------------------------
const PRELUDE = `
const DEGRADED_BUILD_FAILURE_RATIO = 0.15;
let MEMORY_CACHE_MS = 0;
const CACHE_SECONDS = 60;
const STALE_SECONDS = 120;
const PICKERS_LOCK_TTL_SECONDS = 120;
const PICKERS_MAX_WAIT_MS = 12_000;
let memo = null;
export const bench = {};
export const setMemoMs = (ms) => { MEMORY_CACHE_MS = ms; };
export const readMemo = () => memo;
export const resetMemo = () => { memo = null; };
const readPickersCache = async () => bench.cache;
const writePickersCache = async (data) => { bench.writes.push(data); };
const buildReducedPickersPayload = (d) => d;
const acquirePickersLock = async () => bench.lock;
const releasePickersLock = async () => {};
const flushRedisReadMeter = async () => {};
const recordBuildTrigger = async () => {};
const pickersBuildGate = () => bench.gate;
const readPickersLastGood = async () => bench.lastGood;
const waitForPickersPayload = async () => bench.published;
const buildPickersPayload = async () => {
  bench.builds++;
  if (bench.buildThrows) throw new Error("build failed");
  return bench.built;
};
const originFromReq = () => "https://example.test";
const getClientIp = () => "1.2.3.4";
const checkBackfillLockout = async () => ({ locked: false, retryAfterSeconds: 0 });
const recordBackfillFailure = async () => {};
const clearBackfillFailures = async () => {};
const checkBackfillKey = () => bench.keyOk;
const NextResponse = {
  json: (data, init) => ({ data: JSON.parse(JSON.stringify(data)), status: init?.status ?? 200, headers: init?.headers ?? {} }),
};
let lastBuildStats = null;
`;

let benchSeq = 0;
async function loadBench(builderSrc, publicSrc) {
  const fns = grabFns(builderSrc, WANTED);
  const missing = WANTED.filter((n) => !fns[n]);
  if (missing.length) throw new Error(`could not extract ${missing.join(", ")}`);
  const pub = ts.transpileModule(publicSrc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const js = ts.transpileModule(
    `${PRELUDE}\n${WANTED.map((n) => fns[n]).join("\n\n")}\n` +
      `export { getPickersData, handlePickersRequest };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }
  ).outputText;
  // The real filter, inlined ahead of the handler: same module scope, so the
  // handler's bare `pickersWithoutBars` resolves to it.
  const code = `${pub}\n${js}\n// ${benchSeq++}`;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

// ---------------------------------------------------------------------------
// Fixtures: bars where the payload carries them today, plus one in a place no
// list names, so the scan is the deep one it claims to be.
// ---------------------------------------------------------------------------
const bars = (n, base) =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, open: base + i, high: base + i + 1, low: base + i - 1, close: base + i, volume: 1000 + i, ma200: base, rsi14: 50, macd: 0 }));

function payload(label, degradedSymbolPct = 0) {
  return {
    label,
    updatedAt: "2026-10-02T21:00:00.000Z",
    universeSize: 3,
    degradedSymbolPct,
    signalRecords: [
      { symbol: "AAA", tone: "green", oversold: true, chartPoints: bars(72, 10) },
      { symbol: "BBB", tone: "red", oversold: false, chartPoints: bars(72, 20) },
      { symbol: "CCC", tone: "blue", oversold: false },
    ],
    sections: [
      { title: "Oversold Stocks", items: [{ symbol: "AAA", timeframe: "D", chartPoints: bars(72, 10) }] },
      { title: "Weekly MA200 Proximity", items: [{ symbol: "BBB", timeframe: "W", chartPoints: bars(40, 20) }] },
      { title: "Macro Support & Resistance", items: [{ symbol: "CCC", timeframe: "W", chartPoints: bars(40, 30) }] },
    ],
    tickerFeed: { topMovers: [{ symbol: "AAA", changePct: 3 }], earningsGrowth: [], extra: [{ deep: { chartPoints: bars(3, 1) } }] },
  };
}

function findBars(v, at = "$", out = []) {
  if (!v || typeof v !== "object") return out;
  if (Array.isArray(v)) { v.forEach((x, i) => findBars(x, `${at}[${i}]`, out)); return out; }
  for (const [k, x] of Object.entries(v)) {
    if (k === "chartPoints") out.push(`${at}.${k}`);
    findBars(x, `${at}.${k}`, out);
  }
  return out;
}
const countBars = (v) => findBars(v).length;
const FIXTURE_BARS = countBars(payload("x"));

const req = ({ force = false, key = "", bearer = null } = {}) => {
  const params = new URLSearchParams();
  if (force) params.set("force", "1");
  if (key) params.set("key", key);
  return {
    nextUrl: { searchParams: params },
    headers: { get: (h) => (h.toLowerCase() === "authorization" && bearer ? bearer : null) },
    url: "https://example.test/api/pickers",
  };
};

// Every payload path. `served` names the fixture the answer must be, so a
// scenario that silently fell onto another path does not pass as covering it.
const SCENARIOS = [
  // Primed through getPickersData, then the store emptied: only the memo can answer.
  { name: "memo", served: "memo", setup: (b, m) => { m.setMemoMs(60_000); b.cache = { data: payload("memo") }; }, prime: true },
  { name: "cached", served: "cached", setup: (b) => { b.cache = { data: payload("cached") }; } },
  { name: "preview last-good", served: "last-good", setup: (b) => { b.gate = "preview"; b.lastGood = { data: payload("last-good") }; } },
  { name: "next-build last-good", served: "last-good", setup: (b) => { b.gate = "next-build"; b.lastGood = { data: payload("last-good") }; } },
  { name: "published after wait", served: "published", setup: (b) => { b.lock = null; b.published = { data: payload("published") }; } },
  { name: "fresh build (cold)", served: "fresh", setup: (b) => { b.built = payload("fresh"); } },
  { name: "forced build (owner key)", served: "fresh", req: { force: true, key: "k" }, setup: (b) => { b.keyOk = true; b.cache = { data: payload("cached") }; b.built = payload("fresh"); } },
  { name: "warm route history force (cron)", served: "fresh", warm: true, req: { bearer: "Bearer s3cret" }, setup: (b) => { b.cache = { data: payload("cached") }; b.built = payload("fresh"); } },
  { name: "degraded fallback", served: "cached", req: { force: true, key: "k" }, setup: (b) => { b.keyOk = true; b.cache = { data: payload("cached") }; b.built = payload("fresh-degraded", 40); } },
  { name: "build-threw fallback", served: "cached", req: { force: true, key: "k" }, setup: (b) => { b.keyOk = true; b.cache = { data: payload("cached") }; b.buildThrows = true; } },
  { name: "500 (build threw, nothing cached)", served: null, status: 500, setup: (b) => { b.buildThrows = true; } },
];

async function runAll(m) {
  const results = [];
  process.env.CRON_SECRET = "s3cret";
  for (const s of SCENARIOS) {
    const b = m.bench;
    Object.assign(b, { cache: null, built: null, buildThrows: false, lock: "token", writes: [], builds: 0, keyOk: false, gate: "allowed", lastGood: null, published: null });
    m.resetMemo();
    m.setMemoMs(0);
    s.setup(b, m);
    if (s.prime) { await m.getPickersData("o"); b.cache = null; }
    const before = [b.cache, b.lastGood, b.published, b.built].map((x) => (x && (x.data ?? x)) || null);
    const beforeBars = before.map((x) => (x ? countBars(x) : 0));
    const res = await m.handlePickersRequest(req(s.req), s.warm ? { requestHistoryForce: true } : {});
    const memoAfter = m.readMemo();
    // The pages' reader, straight after the request: what it returns is the
    // shared copy, and it must still carry every bar.
    m.setMemoMs(60_000);
    const inProcess = memoAfter ? await m.getPickersData("o") : null;
    results.push({
      s,
      res,
      leaked: findBars(res.data),
      servedLabel: res.data?.label ?? null,
      sourcesIntact: before.every((x, i) => !x || countBars(x) === beforeBars[i]),
      memoBars: memoAfter ? countBars(memoAfter.data) : null,
      inProcessBars: inProcess ? countBars(inProcess) : null,
      writtenBars: b.writes.map(countBars),
    });
  }
  return results;
}

// Problems with one run, as strings: empty means the run is clean.
function problems(results) {
  const out = [];
  for (const r of results) {
    if (r.leaked.length) out.push(`${r.s.name}: answer carries ${r.leaked.join(", ")}`);
    if (r.s.served && r.servedLabel !== r.s.served) out.push(`${r.s.name}: served "${r.servedLabel}", expected "${r.s.served}"`);
    if (r.s.status && r.res.status !== r.s.status) out.push(`${r.s.name}: status ${r.res.status}`);
    if (!r.sourcesIntact) out.push(`${r.s.name}: the shared copy lost bars`);
    if (r.memoBars !== null && r.memoBars !== FIXTURE_BARS) out.push(`${r.s.name}: memo holds ${r.memoBars}/${FIXTURE_BARS} bar series`);
    if (r.inProcessBars !== null && r.inProcessBars !== FIXTURE_BARS) out.push(`${r.s.name}: getPickersData returns ${r.inProcessBars}/${FIXTURE_BARS} bar series`);
    if (r.writtenBars.some((n) => n !== FIXTURE_BARS)) out.push(`${r.s.name}: wrote a payload without its bars`);
    // A non-payload answer (the 500) has no label; scanning it is still the point.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Static: every NextResponse.json in the handler is filtered or an error body.
// ---------------------------------------------------------------------------
function unfilteredJson(builderSrc) {
  const fns = grabFns(builderSrc, ["handlePickersRequest"]);
  const sf = ts.createSourceFile("h.ts", fns.handlePickersRequest ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bad = [];
  let calls = 0;
  const visit = (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "NextResponse.json") {
      calls++;
      const a = n.arguments[0];
      const ok =
        (a && ts.isObjectLiteralExpression(a)) ||
        (a && ts.isCallExpression(a) && a.expression.getText(sf) === "pickersWithoutBars");
      if (!ok) bad.push(a ? a.getText(sf) : "(none)");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { calls, bad };
}

// ---------------------------------------------------------------------------
// Static: the pages and browser readers.
// ---------------------------------------------------------------------------
const code = (f, src = read(f)) => stripComments(src, { file: f });

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(rel, out); }
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const APP_FILES = [...walk("app"), ...walk("lib")];

const RESULT_PAGE = "app/components/PickerResultPage.tsx";
function resultPageProblems(src) {
  const c = code(RESULT_PAGE, src);
  const out = [];
  if (!/=\s*\(await getPickersData\(SITE_ORIGIN\)\)/.test(c)) out.push("PickerResultPage no longer reads getPickersData in-process, unfiltered");
  if (/pickersWithoutBars/.test(c)) out.push("PickerResultPage filters the bars out of its own in-process read");
  if (/fetch\([^)]*\/api\/pickers/.test(c)) out.push("PickerResultPage fetches /api/pickers (which has no bars)");
  if (!/record\.chartPoints/.test(c) || !/item\.chartPoints/.test(c)) out.push("PickerResultPage entries no longer take record/item chartPoints");
  return out;
}

// A browser reader of /api/pickers that reads chartPoints would lose them.
function routeReaderProblems(files) {
  const out = [];
  for (const [f, src] of files) {
    const c = code(f, src);
    if (!/["'`]\/api\/pickers/.test(c)) continue;
    if (/chartPoints/.test(c)) out.push(`${f} reads /api/pickers and chartPoints`);
  }
  return out;
}

// /pickers strips its client props; PickersClient must not want them.
function pickersPageProblems(pageSrc, clientSrc) {
  const out = [];
  const p = code("app/pickers/page.tsx", pageSrc);
  if (!/pickersWithoutBars\(await getPickersData\(SITE_ORIGIN\)\)/.test(p)) out.push("/pickers no longer filters the bars out of PickersClient's props");
  if (/chartPoints/.test(code("app/pickers/PickersClient.tsx", clientSrc))) out.push("PickersClient reads chartPoints, which its props no longer carry");
  return out;
}

// No "use server" module reads the pickers builder (no cache-only mode: it would build).
function serverActionProblems(files) {
  const out = [];
  for (const [f, src] of files) {
    const c = code(f, src);
    if (!/^\s*["']use server["']/m.test(c)) continue;
    if (/getPickersData|buildPickersPayload|handlePickersRequest/.test(c)) out.push(`${f} is a server action reading the pickers builder`);
  }
  return out;
}

const appSources = () => APP_FILES.map((f) => [f, read(f)]);

// ===========================================================================
console.log("\n=== 1. The real handler, every payload path ===\n");

const real = await loadBench(builderRaw, publicRaw);
const results = await runAll(real);
for (const r of results) {
  check(
    `${r.s.name}: no chartPoints at any depth`,
    r.leaked.length === 0 && (!r.s.served || r.servedLabel === r.s.served) && (!r.s.status || r.res.status === r.s.status),
    r.leaked.length ? r.leaked.join(", ") : `served ${r.servedLabel ?? `status ${r.res.status}`}, ${FIXTURE_BARS} bar series in, 0 out`
  );
}
check("the fixture really carries bars in every known place, and one unknown", FIXTURE_BARS === 6, `${FIXTURE_BARS} series`);
check("the answer keeps everything else", (() => {
  const r = results.find((x) => x.s.name === "cached");
  const d = r?.res.data;
  return d?.signalRecords?.length === 3 && d.sections?.[1]?.items?.[0]?.timeframe === "W" && d.tickerFeed?.topMovers?.[0]?.symbol === "AAA" && d.updatedAt === "2026-10-02T21:00:00.000Z";
})(), "records, sections, items, tickerFeed, updatedAt");

console.log("\n=== 2. The shared copy, and the in-process reader ===\n");
const p2 = problems(results).filter((x) => !/answer carries|served|status/.test(x));
check("no source object lost a bar; memo and getPickersData carry all of them; writes carry all of them", p2.length === 0, p2.join("; ") || `${results.length} paths`);
check("the run as a whole is clean", problems(results).length === 0, problems(results).join("; "));

console.log("\n=== 3. Every NextResponse.json in the handler ===\n");
const sj = unfilteredJson(builderRaw);
check("each passes pickersWithoutBars(..) or an inline error object", sj.calls >= 9 && sj.bad.length === 0, sj.bad.length ? sj.bad.join(", ") : `${sj.calls} calls`);

console.log("\n=== 4. Pages read bars in-process; browser readers want none ===\n");
const rp = resultPageProblems(read(RESULT_PAGE));
check("PickerResultPage reads getPickersData unfiltered and puts chartPoints on its entries", rp.length === 0, rp.join("; "));
const apps = appSources();
const readers = apps.filter(([, s]) => /["'`]\/api\/pickers/.test(s)).map(([f]) => f);
check("the browser readers of /api/pickers were found", readers.includes("app/pickers/PickersClient.tsx") && readers.includes("app/components/DashboardTicker.tsx"), readers.join(", "));
const rr = routeReaderProblems(apps);
check("none of them reads chartPoints", rr.length === 0, rr.join("; ") || readers.join(", "));
const pp = pickersPageProblems(read("app/pickers/page.tsx"), read("app/pickers/PickersClient.tsx"));
check("/pickers filters its client props, and PickersClient draws no chart", pp.length === 0, pp.join("; "));

console.log("\n=== 5. No server action reads the pickers builder ===\n");
const sa = serverActionProblems(apps);
check("no \"use server\" module calls getPickersData (it would build on a POST)", sa.length === 0, sa.join("; "));

console.log("\n=== 6. Mutants ===\n");

const mutant = async (label, fn) => {
  let caught;
  try {
    caught = await fn();
  } catch (e) {
    // A mutant that crashes the bench proves nothing about the property.
    caught = null;
    console.log(`        (bench threw: ${e.message})`);
  }
  check(`mutant caught: ${label}`, Array.isArray(caught) && caught.length > 0, Array.isArray(caught) ? caught[0] ?? "nothing flagged" : "mutation not applied");
};

// One path at a time left unfiltered.
const WRAPS = [...builderRaw.matchAll(/NextResponse\.json\(pickersWithoutBars\(([\w.]+)\),/g)];
check("every filtered path is mutated in turn", WRAPS.length === 7, `${WRAPS.length} filtered answers`);
for (const w of WRAPS) {
  const at = w.index;
  const src = builderRaw.slice(0, at) + `NextResponse.json(${w[1]},` + builderRaw.slice(at + w[0].length);
  const line = builderRaw.slice(0, at).split("\n").length;
  await mutant(`path at ${BUILDER}:${line} (${w[1]}) left unfiltered`, async () => {
    const run = problems(await runAll(await loadBench(src, publicRaw))).filter((x) => /answer carries/.test(x));
    const stat = unfilteredJson(src).bad;
    return run.length && stat.length ? run : [];
  });
}

await mutant("weekly sections left unstripped", async () => {
  const src = publicRaw.replace("if (k === BAR_KEY) {", 'if (k === BAR_KEY && (value as { timeframe?: string }).timeframe !== "W") {');
  if (src === publicRaw) return null; // mutation site not found: reported as NOT caught
  return problems(await runAll(await loadBench(builderRaw, src))).filter((x) => /items\[0\]\.chartPoints/.test(x));
});

await mutant("only signalRecords stripped (a list, not a deep walk)", async () => {
  const src = publicRaw.replace(
    "const out = strip(data) as T;",
    "const recs = (data as { signalRecords?: object[] }).signalRecords;\n  const out = (recs ? { ...data, signalRecords: recs.map((r) => ({ ...r, chartPoints: undefined })) } : data) as T;"
  );
  if (src === publicRaw) return null; // mutation site not found: reported as NOT caught
  return problems(await runAll(await loadBench(builderRaw, src))).filter((x) => /answer carries/.test(x));
});

await mutant("the shared copy mutated", async () => {
  const src = publicRaw.replace(
    "if (!out) out = { ...(value as Record<string, unknown>) };\n      delete out[k];",
    "delete (value as Record<string, unknown>)[k];\n      out = out ?? (value as Record<string, unknown>);"
  );
  if (src === publicRaw) return null; // mutation site not found: reported as NOT caught
  return problems(await runAll(await loadBench(builderRaw, src))).filter((x) => /lost bars|memo holds|getPickersData returns/.test(x));
});

await mutant("PickerResultPage loses its in-process bars (filtered read)", async () =>
  resultPageProblems(read(RESULT_PAGE).replace("(await getPickersData(SITE_ORIGIN))", "pickersWithoutBars(await getPickersData(SITE_ORIGIN))"))
);

await mutant("PickerResultPage reads the route instead", async () =>
  resultPageProblems(read(RESULT_PAGE).replace("(await getPickersData(SITE_ORIGIN))", '(await (await fetch("/api/pickers")).json())'))
);

await mutant("DashboardTicker starts drawing route chartPoints", async () =>
  routeReaderProblems(apps.map(([f, s]) => [f, f === "app/components/DashboardTicker.tsx" ? s + "\nconst pts = (data as any)?.signalRecords?.[0]?.chartPoints;\n" : s]))
);

await mutant("PickersClient starts reading chartPoints from its (stripped) props", async () =>
  pickersPageProblems(read("app/pickers/page.tsx"), read("app/pickers/PickersClient.tsx") + "\nconst pts = initialPickersPayload?.signalRecords?.[0]?.chartPoints;\n")
);

await mutant("/pickers stops filtering its client props", async () =>
  pickersPageProblems(read("app/pickers/page.tsx").replace("pickersWithoutBars(await getPickersData(SITE_ORIGIN))", "(await getPickersData(SITE_ORIGIN))"), read("app/pickers/PickersClient.tsx"))
);

await mutant("a server action that builds instead of reading cache-only", async () =>
  serverActionProblems([...apps, ["app/pickers/pickersAction.ts", '"use server";\nimport { getPickersData } from "@/lib/server/pickersBuilder";\nexport async function readPickers() { return getPickersData("o"); }\n']])
);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
