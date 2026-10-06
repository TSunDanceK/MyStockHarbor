// A DEADLINE ON EVERY OUTSIDE FETCH THE NEWS BASE BUILD CAN REACH (#553
// COWORK #170/#171, the /dashboard 300 s timeouts).
//
// 1. SCAN, found by walking imports from lib/stock-news-data.ts (the module
//    getCachedStockNewsBaseData lives in), not from a list: every raw
//    `fetch(` either carries a `signal` or is lib/server/outsideFetch.ts itself,
//    and NONE passes `next: { revalidate }` -- Next refreshes such an entry
//    after the response with the signal stripped, which is the hang. The
//    exemptions are named with a reason; the list may shrink, never grow, and
//    a stale entry fails.
// 2. THE HELPER: no-store, a fresh AbortSignal.timeout per request (built in
//    the call, never shared), a non-2xx answer throws (never cached).
// 3. RUNTIME, against a local server that never answers, and one that sends
//    headers and then stalls the body: both abort at the deadline and throw;
//    "[fetch-timeout] <host>" is logged once per host.
// Every rule has a planted mutant.
//
//   node scripts/check-outside-fetch-deadlines.mjs
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
await import("./lib/register-capex-ts.mjs");
const fs = await import("node:fs");
const http = await import("node:http");
const path = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { stripComments } = await import("./lib/source-code.mjs");

const ROOT = process.cwd();
const ENTRY = "lib/stock-news-data.ts";
const HELPER = "lib/server/outsideFetch.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// Raw fetches in the graph that are NOT bounded here, each with its reason.
// MAY SHRINK, NEVER GROW.
const EXEMPT = new Map([
  ["lib/server/fmpUsage.ts", "fmpFetch: FMP is cancelled and every caller returns before it without FMP_API_KEY"],
  ["lib/server/secColdFetch.ts", "A's cold SEC path (#552), not called by the news base build; its `next: { revalidate }` is reported to A, not changed here"],
  ["lib/ai-news-briefs.ts", "getStockNewsAiData's OpenAI calls, a separate build from the cached news base; reported, not changed here"],
  ["lib/server/news/secProvider.ts", "fetchSubmissionsItems runs only in the SEC filings job, no-store; fetchForSymbol reads the store and makes no fetch (both pinned by check-sec-adapter)"],
]);
const EXEMPT_MAX = 4;

// ── 1. the scan ─────────────────────────────────────────────────────────────
function graphFrom(entry, readFile) {
  const seen = new Set();
  const queue = [entry];
  const resolve = (from, spec) => {
    let base;
    if (spec.startsWith("@/")) base = spec.slice(2);
    else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      const abs = path.join(ROOT, c);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return c;
    }
    return null;
  };
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFile(f);
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const r = resolve(f, m[1] ?? m[2]);
      if (r && /\.tsx?$/.test(r)) queue.push(r);
    }
  }
  return seen;
}

/** Each raw fetch( call's text (to its matching paren) in one file. */
function fetchCalls(file, src) {
  const code = stripComments(src, { file });
  const out = [];
  const re = /(^|[^\w.$])fetch\(/g;
  let m;
  while ((m = re.exec(code))) {
    let i = m.index + m[0].length, depth = 1;
    while (i < code.length && depth) { if (code[i] === "(") depth++; else if (code[i] === ")") depth--; i++; }
    out.push(code.slice(m.index + m[1].length, i));
  }
  return out;
}

function scanFails(readFile) {
  const fails = [];
  const files = graphFrom(ENTRY, readFile);
  const exemptHit = new Set();
  for (const f of files) {
    if (f === HELPER) continue;
    for (const call of fetchCalls(f, readFile(f))) {
      if (/\bnext:\s*\{/.test(call)) fails.push(`${f}: fetch with next: { revalidate } (Next refreshes it with no signal)`);
      else if (!/\bsignal\s*[:,}]/.test(call)) {
        if (EXEMPT.has(f)) exemptHit.add(f);
        else fails.push(`${f}: fetch with no signal`);
      }
    }
  }
  for (const f of EXEMPT.keys()) if (!exemptHit.has(f)) fails.push(`stale exemption ${f}`);
  if (EXEMPT.size > EXEMPT_MAX) fails.push(`the exemption list grew to ${EXEMPT.size}`);
  for (const must of ["lib/server/news/gnewsProvider.ts", "lib/server/news/wireProvider.ts", "lib/server/companyNames.ts", HELPER])
    if (!files.has(must)) fails.push(`the scan did not reach ${must}`);
  return { fails, files };
}

const files = {};
const realRead = (f) => (files[f] ??= read(f));

console.log("\n=== 1. Every fetch reachable from the news base build is bounded ===\n");
const real = scanFails(realRead);
check(`scanned ${real.files.size} files from ${ENTRY}`, real.files.size > 20);
check("no unbounded fetch and no next: { revalidate } fetch outside the exemptions", real.fails.length === 0, real.fails.join("; "));

// ── 2. the helper, statically ───────────────────────────────────────────────
function helperFails(src) {
  const code = stripComments(src, { file: HELPER });
  const fails = [];
  const body = (name) => {
    const i = code.indexOf(`export async function ${name}(`);
    if (i < 0) return "";
    const open = code.indexOf("{", code.indexOf(")", code.indexOf("deps", i)));
    let d = 0, j = open;
    for (; j < code.length; j++) { if (code[j] === "{") d++; else if (code[j] === "}" && --d === 0) break; }
    return code.slice(open, j);
  };
  for (const name of ["fetchWithDeadline", "outsideText"]) {
    const b = body(name);
    if (!/const signal = AbortSignal\.timeout\(ms\);/.test(b)) fails.push(`${name}: a fresh AbortSignal.timeout per call`);
    if (!/cache: "no-store", signal/.test(b)) fails.push(`${name}: no-store and the signal on the request`);
  }
  if (!/if \(!res\.ok\) throw new OutsideFetchError/.test(body("outsideText"))) fails.push("outsideText: a non-2xx answer throws");
  const top = code.replace(/\{[\s\S]*?\n\}/g, "");
  if (/AbortSignal\.timeout\(/.test(top)) fails.push("a signal built at module scope would be shared and already spent");
  return fails;
}
console.log("\n=== 2. The helper ===\n");
const helperSrc = read(HELPER);
const h = helperFails(helperSrc);
check("no-store, a fresh deadline per request, non-2xx throws", h.length === 0, h.join("; "));

// ── 3. runtime, against servers that never answer ───────────────────────────
const sockets = new Set();
const silent = http.createServer(() => {});
const stall = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.write("partial"); });
const notFound = http.createServer((_req, res) => { res.writeHead(404); res.end("no"); });
for (const s of [silent, stall, notFound]) s.on("connection", (c) => { sockets.add(c); c.on("close", () => sockets.delete(c)); });
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(s.address().port)));
const [pSilent, pStall, p404] = [await listen(silent), await listen(stall), await listen(notFound)];

let seq = 0;
const tmp = [];
async function loadHelper(src) {
  const f = path.join(ROOT, "lib", "server", `.check-ofd-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(f, src);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}
async function runtimeFails(M) {
  const fails = [];
  const lines = [];
  const log = (l) => lines.push(l);
  const timed = async (fn) => { const t = Date.now(); try { await fn(); return { threw: false, ms: Date.now() - t }; } catch (e) { return { threw: true, ms: Date.now() - t, e }; } };
  const a = await timed(() => M.outsideText(`http://127.0.0.1:${pSilent}/x`, {}, { ms: 300, log }));
  if (!a.threw || a.ms > 2000) fails.push(`no answer: must throw at the deadline (threw ${a.threw}, ${a.ms}ms)`);
  const b = await timed(() => M.outsideText(`http://127.0.0.1:${pStall}/x`, {}, { ms: 300, log }));
  if (!b.threw || b.ms > 2000) fails.push(`stalled body: must throw at the deadline (threw ${b.threw}, ${b.ms}ms)`);
  const c = await timed(() => M.fetchWithDeadline(`http://127.0.0.1:${pSilent}/y`, {}, { ms: 300, log }));
  if (!c.threw || c.ms > 2000) fails.push(`fetchWithDeadline: must throw at the deadline (threw ${c.threw}, ${c.ms}ms)`);
  const d = await timed(() => M.outsideText(`http://127.0.0.1:${p404}/z`, {}, { ms: 2000, log }));
  if (!d.threw || !(d.e instanceof M.OutsideFetchError) || d.e.status !== 404) fails.push("a 404 must throw OutsideFetchError (so it is never cached)");
  const silentHost = lines.filter((l) => l.startsWith(`[fetch-timeout] 127.0.0.1:${pSilent} `)).length;
  const stallHost = lines.filter((l) => l.startsWith(`[fetch-timeout] 127.0.0.1:${pStall} `)).length;
  if (silentHost !== 1) fails.push(`one log line per host: saw ${silentHost} for the silent host over 2 timeouts`);
  if (stallHost !== 1) fails.push(`the stalled host logged ${stallHost} times`);
  if (lines.some((l) => l.includes(`:${p404}`))) fails.push("a 404 is not a timeout and must not log one");
  return fails;
}

try {
  console.log("\n=== 3. Runtime: servers that never answer ===\n");
  const r = await runtimeFails(await loadHelper(helperSrc));
  check("aborts at the deadline (no answer, stalled body), throws, logs once per host", r.length === 0, r.join("; "));

  console.log("\n=== 4. Planted mutants (each must be caught) ===\n");
  const swap = (s, a, b) => { if (!s.includes(a)) throw new Error(`mutant anchor missing: ${a}`); return s.replace(a, b); };
  const scanWith = (file, mutate) => scanFails((f) => (f === file ? mutate(realRead(f)) : realRead(f))).fails.length > 0;
  check("mutant caught: the wire poll back on Next's fetch cache", scanWith("lib/server/news/wireProvider.ts",
    (s) => swap(s, 'return parseWireFeed(await cachedOutsideText(3600)(source.url, { "user-agent": newsUserAgent() }), source);',
      'const res = await fetch(source.url, { headers: { "user-agent": newsUserAgent() }, next: { revalidate: 3600 } }); return parseWireFeed(await res.text(), source);')));
  check("mutant caught: a bare fetch with no signal in the news build", scanWith("lib/stock-news-data.ts",
    (s) => swap(s, 'const xml = await cachedOutsideText(1800)(url);', "const xml = await (await fetch(url)).text();")));
  check("mutant caught: a signal does not excuse next: { revalidate }", scanWith("lib/server/companyNames.ts",
    (s) => swap(s, "return await cachedOutsideText(86400)(url);", "return await (await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 86400 } })).text();")));

  const HELPER_MUTANTS = [
    ["no signal on the request", (s) => swap(s, '{ ...init, cache: "no-store", signal }', '{ ...init, cache: "no-store" }')],
    ["the body read outside the deadline", (s) => swap(s, '{ headers, cache: "no-store", signal }', '{ headers, cache: "no-store" }')],
    ["a non-2xx answer returned as text", (s) => swap(s, "if (!res.ok) throw new OutsideFetchError(hostOf(url), res.status);", "")],
    ["the log not once per host", (s) => swap(s, "if (timedOutHosts.has(host)) return;", "")],
  ];
  for (const [label, mutate] of HELPER_MUTANTS) {
    const src = mutate(helperSrc);
    const caught = helperFails(src).length > 0 || (await runtimeFails(await loadHelper(src))).length > 0;
    check(`mutant caught: ${label}`, caught);
  }
  const shared = swap(helperSrc, "const timedOutHosts = new Set<string>();", "const timedOutHosts = new Set<string>();\nconst SHARED = AbortSignal.timeout(OUTSIDE_FETCH_TIMEOUT_MS);");
  check("mutant caught: a shared module-scope signal", helperFails(shared).length > 0);
} finally {
  for (const f of tmp) try { fs.unlinkSync(f); } catch {}
  for (const c of sockets) c.destroy();
  for (const s of [silent, stall, notFound]) s.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
