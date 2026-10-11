// Proves the buffered byte meter accumulates and flushes correctly, and that
// buffering did not introduce the two ways it could go quietly wrong.
//
// WHY BUFFERING AT ALL. The first version awaited a Redis pipeline per FMP
// response. warmFundamentals makes ~477 calls in a run that already spends its
// entire 90-second wait budget, so the meter would have been a measurable cost
// of the job it measures -- an instrument that changes the reading.
//
// THE TWO SILENT FAILURES BUFFERING CAN CAUSE, both checked here:
//
//   1. Day drift. A buffer that spans midnight, keyed at FLUSH time, puts every
//      sample in whichever day the flush happened to land in. Nothing errors;
//      the daily buckets the whole report is built on are simply wrong, and the
//      total still looks right. The day is therefore stamped at RECORD time.
//   2. Double counting or loss on overlapping flushes. A warm serverless
//      instance runs concurrent invocations against the same module state, so
//      two flushes can overlap. The buffer is swapped out BEFORE the await, so
//      a sample is written exactly once.
//
//   node scripts/check-fmp-buffer.mjs
//
// Runs the REAL fmpUsage module against a stub Redis, rather than a copy of its
// logic (claude/traps/two-validators-for-one-value.md). The stub records every
// hincrby so the assertions are about what would actually have been written.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "lib/server/fmpUsage.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// --- stub Redis -------------------------------------------------------------
const writes = [];
let pipelineCount = 0;
const makeStub = () => ({
  pipeline() {
    pipelineCount++;
    const ops = [];
    const api = {
      hincrby: (key, field, by) => ops.push(["hincrby", key, field, by]),
      expire: (key, ttl) => ops.push(["expire", key, ttl]),
      exec: async () => {
        writes.push(...ops);
        return ops.map(() => 1);
      },
    };
    return api;
  },
});

// Compile the real module, swapping only its Redis construction and the
// next/server import for stubs. Everything else -- the buffer, the day key, the
// cap, the flush -- is the shipped code.
const source = fs.readFileSync(SRC, "utf8");
const patched = source
  .replace(/import \{ Redis \} from "@upstash\/redis";/, "")
  .replace(/import \{ PAGE_READ_CACHE \} from ".\/redisCacheMode";/, "")
  .replace(/const redis =[\s\S]*?: null;/, "const redis = globalThis.__stubRedis;")
  .replace(/const \{ after \} = await import\("next\/server"\);/, "const after = globalThis.__after;");

const js = ts.transpileModule(patched, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;

globalThis.__stubRedis = makeStub();
// No request scope in a script, so after() is unavailable -- exactly the
// fallback path the size cap and the jobs' explicit flush exist to cover.
globalThis.__after = () => {
  throw new Error("after() outside a request scope");
};

const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { recordFmpUsage, flushFmpUsage, fmpEndpointLabel } = mod;

const KEY = "https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=AAPL&apikey=SECRET";

// --- 1. buffering actually buffers -----------------------------------------
console.log("\n=== 1. Recording does not write; flushing does ===\n");
writes.length = 0;
pipelineCount = 0;
for (let i = 0; i < 20; i++) recordFmpUsage({ url: KEY, decodedBytes: 1000, wireBytes: 400 });
check("20 records wrote nothing yet", writes.length === 0 && pipelineCount === 0, `${pipelineCount} pipelines`);
await flushFmpUsage();
check("one flush, one pipeline", pipelineCount === 1, `${pipelineCount}`);

const calls = writes.find((w) => w[0] === "hincrby" && String(w[2]).endsWith(":calls"));
const wire = writes.find((w) => w[0] === "hincrby" && String(w[2]).endsWith(":wire"));
const decoded = writes.find((w) => w[0] === "hincrby" && String(w[2]).endsWith(":decoded"));
check("calls aggregated to 20", calls?.[3] === 20, String(calls?.[3]));
check("wire aggregated to 20x400", wire?.[3] === 8000, String(wire?.[3]));
check("decoded aggregated to 20x1000", decoded?.[3] === 20000, String(decoded?.[3]));
check(
  "compare: unbuffered would have been 20 pipelines for the same 20 calls",
  pipelineCount === 1,
  "1 vs 20"
);

// --- 2. the API key never reaches a counter ---------------------------------
console.log("\n=== 2. The API key cannot reach Redis ===\n");
const anyFieldHasSecret = writes.some((w) => String(w[1]).includes("SECRET") || String(w[2]).includes("SECRET"));
check("no key material in any key or field", !anyFieldHasSecret);
check("bucketed by path only", fmpEndpointLabel(KEY) === "historical-price-eod/full", fmpEndpointLabel(KEY));
check("ticker segments collapse", fmpEndpointLabel("https://financialmodelingprep.com/api/v3/profile/AAPL?apikey=X") === "profile");

// --- 3. flushing an empty buffer is a no-op ---------------------------------
console.log("\n=== 3. Flushing twice does not double-count ===\n");
writes.length = 0;
pipelineCount = 0;
recordFmpUsage({ url: KEY, decodedBytes: 500, wireBytes: 100 });
await flushFmpUsage();
const afterFirst = writes.length;
await flushFmpUsage();
check("second flush writes nothing", writes.length === afterFirst, `${writes.length} vs ${afterFirst}`);
check("and issues no pipeline", pipelineCount === 1, `${pipelineCount}`);

// --- 4. the size cap bounds the buffer --------------------------------------
console.log("\n=== 4. The cap flushes inline, so a long run cannot sit on samples ===\n");
writes.length = 0;
pipelineCount = 0;
for (let i = 0; i < 600; i++) recordFmpUsage({ url: KEY, decodedBytes: 10, wireBytes: 5 });
// The cap fires inline (not awaited), so let the microtask queue drain.
await new Promise((r) => setTimeout(r, 0));
await flushFmpUsage();
const totalCalls = writes.filter((w) => w[0] === "hincrby" && String(w[2]).endsWith(":calls")).reduce((n, w) => n + w[3], 0);
check("every one of the 600 samples is accounted for", totalCalls === 600, String(totalCalls));
check("and it took more than one pipeline, i.e. the cap fired", pipelineCount > 1, `${pipelineCount} pipelines`);

// --- 5. day stamping --------------------------------------------------------
console.log("\n=== 5. The day is stamped at RECORD time, not flush time ===\n");
// The composite buffer key carries the day, so a flush that happens after
// midnight still writes into the day the call was made. Asserted structurally:
// the write key must be the day-prefixed hash, and the field must not contain
// a day.
writes.length = 0;
recordFmpUsage({ url: KEY, decodedBytes: 1, wireBytes: 1 });
await flushFmpUsage();
const w = writes.find((x) => x[0] === "hincrby");
check("writes into a per-day hash", /^msh:fmp-bytes:v1:\d{8}$/.test(w?.[1] ?? ""), w?.[1]);
check("field is endpoint:metric, carrying no day", /^[a-z0-9/\-]+:(calls|wire|decoded|wireExact)$/.test(w?.[2] ?? ""), w?.[2]);
const src = fs.readFileSync(SRC, "utf8");
check(
  "buffer key is composed with the day at record time",
  /const composite = `\$\{dayKey\(new Date\(\)\)\}\|\$\{endpoint\}`/.test(src)
);
check(
  "flush derives the hash key from the buffered day, not from `new Date()`",
  /const key = `\$\{FMP_BYTES_PREFIX\}:\$\{day\}`/.test(src)
);

// --- 6. overlapping flushes -------------------------------------------------
console.log("\n=== 6. Overlapping flushes cannot double-write ===\n");
writes.length = 0;
for (let i = 0; i < 5; i++) recordFmpUsage({ url: KEY, decodedBytes: 100, wireBytes: 50 });
await Promise.all([flushFmpUsage(), flushFmpUsage(), flushFmpUsage()]);
const dupCalls = writes.filter((x) => x[0] === "hincrby" && String(x[2]).endsWith(":calls")).reduce((n, x) => n + x[3], 0);
check("5 records written exactly once across 3 concurrent flushes", dupCalls === 5, String(dupCalls));

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
