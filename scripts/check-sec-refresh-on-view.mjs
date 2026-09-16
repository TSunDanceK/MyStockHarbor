// REFRESH-ON-VIEW AND THE COLD-PATH CIK — the guards RUN, not read.
//
// ── WHY THE FUNCTIONS ARE LIFTED AND CALLED ───────────────────────────────
// Every property here is about ORDER and ARITHMETIC over guards — which one
// rejects first, what a second concurrent view does, whether a failing symbol
// retries. A regex over the source can see that four guards exist and cannot
// see any of that: the three position-is-not-order failures this repo has
// already had were all of exactly this shape.
//
// So the guards are lifted with a FAKE REDIS whose behaviour is real — SET NX
// actually refuses a second write, INCR actually counts — and the assertions
// are what the functions do when called.
//
// THE FAKE IS NOT AN ORACLE. It implements the Redis primitives, not the
// module's rules; it does not know what a cooldown is or which guard runs
// first. Every expected value below comes from calling the shipped code.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const REFRESH_SRC = readCodeOnly("lib/server/secRefreshOnView.ts");
const COLDCIK_SRC = readCodeOnly("lib/server/secColdCik.ts");
const COLD_SRC = readCodeOnly("lib/server/secColdFetch.ts");
const JOB_SRC = readCodeOnly("app/api/jobs/sec-facts/route.ts");
const STALE_SRC = readCodeOnly("lib/server/secStaleness.ts");

/**
 * A Redis good enough to be wrong against.
 *
 * SET NX, INCR, EXPIRE, DEL, HSET, HLEN, HGETALL, HDEL — the exact commands the
 * two modules use, with the semantics that make the guards mean anything. `ops`
 * records every call so "how many Redis commands did the common case cost" is
 * measurable rather than asserted.
 */
const makeRedis = (opts = {}) => {
  const store = new Map();
  const hashes = new Map();
  const ops = [];
  return {
    ops,
    store,
    hashes,
    async set(key, val, o = {}) {
      ops.push(["set", key]);
      if (opts.throwOn === "set") throw new Error("redis down");
      if (o.nx && store.has(key)) return null;
      store.set(key, val);
      return "OK";
    },
    async incr(key) {
      ops.push(["incr", key]);
      if (opts.throwOn === "incr") throw new Error("redis down");
      const n = (store.get(key) ?? 0) + 1;
      store.set(key, n);
      return n;
    },
    async expire(key) { ops.push(["expire", key]); return 1; },
    async del(key) { ops.push(["del", key]); return store.delete(key) ? 1 : 0; },
    async hlen(key) { ops.push(["hlen", key]); return (hashes.get(key) ?? new Map()).size; },
    async hset(key, obj) {
      ops.push(["hset", key]);
      const h = hashes.get(key) ?? new Map();
      for (const [k, v] of Object.entries(obj)) h.set(k, v);
      hashes.set(key, h);
      return 1;
    },
    async hgetall(key) {
      ops.push(["hgetall", key]);
      const h = hashes.get(key);
      return h ? Object.fromEntries(h) : null;
    },
    async hdel(key, ...fields) {
      ops.push(["hdel", key]);
      const h = hashes.get(key) ?? new Map();
      for (const f of fields) h.delete(f);
      return fields.length;
    },
  };
};

/**
 * Lift secRefreshOnView with the fake Redis and a fake `after()`.
 *
 * `after` RUNS ITS CALLBACK IMMEDIATELY here, which is what makes the guards
 * observable at all — in production it runs after the response, and the
 * assertion that it is USED rather than awaited inline is separate (see §1).
 */
/**
 * ── EVERY LIFT NEEDS ITS OWN NONCE, AND THIS COST REAL TIME TO FIND ───────
 *
 * `lift` imports a `data:` URL, and Node caches ES modules BY SPECIFIER. Two
 * lifts of identical source produce identical base64 and therefore the SAME
 * cached module instance — so the second test block got the FIRST block's
 * module, still holding the FIRST block's fake Redis.
 *
 * The symptom was not an error. It was `redis.ops` reading empty on a refresh
 * that had demonstrably run, and a site-wide budget test counting 8 where the
 * cap is 10, because the rate bucket had been partly spent by an earlier
 * block's module writing into a Redis this block could not see.
 *
 * The nonce makes each lift a distinct specifier, so every block gets a module
 * whose `const redis = globalThis.__FAKE_REDIS__` is evaluated against its own.
 */
let nonce = 0;
const loadRefresh = async (mutate = (s) => s, redis = makeRedis()) => {
  const src = mutate(REFRESH_SRC)
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^const redis =[\s\S]*?: null;$/m, "const redis = __REDIS__;");
  const mod = await lift(
    [
      readCodeOnly("lib/server/secFields.ts"),
      `const SEC_QUARTER_WINDOW = 12;`,
      `const SEC_YEAR_WINDOW = 6;`,
      STALE_SRC.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "").replace(/export function/g, "function"),
      // ── THE FAKE after() RECORDS THE PROMISE, AND THE TEST DRAINS IT ──────
      // maybeRefreshOnView deliberately does NOT await the callback — that is
      // the property §1 asserts, and it is why the first version of this file
      // read `refetch called 0×` on a refresh that was in fact running. The
      // work is real and simply had not finished when the assertion ran.
      // `settle()` waits for it, so the assertions are about the guards rather
      // than about a race with them.
      `const __AFTERS__ = [];`,
      `const after = (fn) => { const p = fn(); __AFTERS__.push(p); return p; };`,
      `async function settle() { while (__AFTERS__.length) { await __AFTERS__.shift(); } }`,
      src.replace(/export (const|async function|function|type)/g, "$1"),
      "export { maybeRefreshOnView, needsReread, settle, REFRESH_FETCHES_PER_MINUTE, REFRESH_COOLDOWN_S, REFRESH_LOCK_TTL_S };",
      `// lift-nonce ${nonce++}`,
    ].join("\n").replace("__REDIS__", "globalThis.__FAKE_REDIS__")
  );
  return mod;
};

const withRedis = async (fn, mutate = (s) => s) => {
  const redis = makeRedis();
  globalThis.__FAKE_REDIS__ = redis;
  const mod = await loadRefresh(mutate, redis);
  const r = await fn(mod, redis);
  return r;
};

/** A stored set shaped like the real one, current or stale on demand. */
const setFor = (symbol, { stale }) => ({
  symbol,
  w: 12,
  y: 6,
  // The chain hash is read from the shipped function inside the module, so a
  // "current" set must carry whatever that returns — supplied per test below.
  c: stale ? "deadbeef" : null,
  quarters: [], years: [], instants: [],
});

console.log("\n1. the refresh is scheduled, never awaited into the render");

check("(a) the refresh runs inside after(), not on the render path",
  /after\(async \(\) => \{/.test(REFRESH_SRC) &&
    /import \{ after \} from "next\/server"/.test(REFRESH_SRC),
  "a stale set must render immediately; the corrected values land on the next view");
check("...and the after() call itself is wrapped, because after() throws outside a request scope",
  /try \{\s*after\(/.test(REFRESH_SRC),
  "same guard as fmpUsage's scheduleFlush — the cron is the floor, this is the fast path");
check("...and the whole callback body is wrapped, so a background failure cannot reach a page",
  /after\(async \(\) => \{\s*try \{/.test(REFRESH_SRC),
  "the response is already sent; the worst outcome is the set stays stale until the cron");

console.log("\n2. staleness is the SHARED function, not a second predicate");

check("(b) needsReread is imported from secStaleness, not re-implemented here",
  /import \{ needsReread(, staleReasons)? \} from "\.\/secStaleness"/.test(REFRESH_SRC) &&
    !/\?\?\s*8\)\s*<|\?\?\s*5\)\s*</.test(REFRESH_SRC),
  "the read path and the queue must not be able to disagree about what stale means");
check("...and the queue selects on the same one",
  /needsReread\(e\)/.test(JOB_SRC) || /needsReread/.test(JOB_SRC),
  "one function, two callers");

await withRedis(async (M, redis) => {
  const current = { symbol: "CUR", w: 12, y: 6, c: M.__chains ?? undefined };
  // THE CURRENT SET IS BUILT FROM THE SHIPPED HASH, not from a literal.
  const chains = (await lift(readCodeOnly("lib/server/secFields.ts") + "\nexport { secChainsHash };")).secChainsHash();
  const currentSet = { symbol: "CUR", w: 12, y: 6, c: chains };
  let called = 0;
  await M.maybeRefreshOnView(currentSet, async () => { called++; });
  await M.settle();
  check("a CURRENT set schedules nothing and costs ZERO Redis commands",
    called === 0 && redis.ops.length === 0,
    `${redis.ops.length} commands, refetch called ${called}× — this is every view once the migration drains`);
  void current;
});

console.log("\n3. the guards, in order, under concurrency");

await withRedis(async (M, redis) => {
  let called = 0;
  const refetch = async () => { called++; };
  await M.maybeRefreshOnView(setFor("AAA", { stale: true }), refetch);
  await M.settle();
  check("(c) a STALE set refreshes exactly once",
    called === 1, `refetch called ${called}×`);
  const opsAfterFirst = redis.ops.length;

  // A SECOND VIEW IN THE SAME HOUR. The cooldown is what must stop it — and the
  // assertion below proves it is the COOLDOWN and not the lock, because the
  // lock was released by the first pass's finally.
  await M.maybeRefreshOnView(setFor("AAA", { stale: true }), refetch);
  await M.settle();
  check("...and a second view of the same symbol does NOT fetch again",
    called === 1, `refetch still ${called}× after two views`);
  check("...rejected by the COOLDOWN, before the rate budget is touched",
    redis.ops.length === opsAfterFirst + 1 &&
      redis.ops[opsAfterFirst][0] === "set" &&
      redis.ops[opsAfterFirst][1].includes("cooldown"),
    `the second view cost one command: ${redis.ops[opsAfterFirst]?.join(" ")} — a per-symbol ` +
      `rejection must not spend the site-wide budget`);
  check("...and the lock was RELEASED by the first pass",
    redis.ops.some(([op, key]) => op === "del" && key.includes("refresh-lock")),
    "held on failure too it would block the cron's own refresh of the same symbol");
});

await withRedis(async (M, redis) => {
  // A FAILING SYMBOL. The cooldown is set BEFORE the attempt and not cleared,
  // so one bad symbol costs one fetch an hour rather than one per reader.
  let called = 0;
  const failing = async () => { called++; throw new Error("HTTP 500"); };
  for (let i = 0; i < 3; i++) {
    await M.maybeRefreshOnView(setFor("BAD", { stale: true }), failing);
    await M.settle();
  }
  check("a symbol that FAILS every fetch is attempted once, not once per view",
    called === 1, `${called} attempts across three views`);
  check("...and the lock is released despite the throw",
    redis.ops.some(([op, key]) => op === "del" && key.includes("refresh-lock")),
    "the cooldown stops the retry; holding the lock as well would add nothing");
});

await withRedis(async (M, redis) => {
  // THE SITE-WIDE BUDGET, across DIFFERENT symbols so the cooldown cannot be
  // what stops them. The cap is read from the module rather than retyped.
  const cap = M.REFRESH_FETCHES_PER_MINUTE;
  let called = 0;
  for (let i = 0; i < cap + 5; i++) {
    await M.maybeRefreshOnView(setFor(`S${i}`, { stale: true }), async () => { called++; });
    await M.settle();
  }
  check(`(d) the site-wide budget stops at ${cap} refreshes a minute, across all symbols`,
    called === cap,
    `${cap + 5} distinct stale symbols viewed, ${called} fetched — each has its own cooldown, ` +
      `so only the shared budget can be what refused the rest`);
  void redis;
});

console.log("\n4. the mutations");

{
  // MUTATION (i): the staleness guard removed, so every view refreshes.
  const m = (s) => s.replace("if (!needsReread(set)) return;", "");
  check("the no-staleness-guard mutation actually applied", m(REFRESH_SRC) !== REFRESH_SRC);
  await withRedis(async (M, redis) => {
    const chains = (await lift(readCodeOnly("lib/server/secFields.ts") + "\nexport { secChainsHash };")).secChainsHash();
    let called = 0;
    await M.maybeRefreshOnView({ symbol: "CUR", w: 12, y: 6, c: chains }, async () => { called++; });
    await M.settle();
    check("MUTATION: without the staleness guard, a CURRENT set fetches 3MB anyway",
      called === 1 && redis.ops.length > 0,
      `${redis.ops.length} Redis commands and ${called} fetch on a set that needed neither — ` +
        `paid on every view of every symbol, forever`);
  }, m);
}

{
  // MUTATION (ii): the cooldown written AFTER the attempt instead of before,
  // so a failing symbol retries on every view.
  const m = (s) => s.replace(
    "        if (!(await claimCooldown(symbol))) return;\n",
    ""
  ).replace("          await refetch(symbol);", "          await refetch(symbol);\n          await claimCooldown(symbol);");
  check("the cooldown-after mutation actually applied", m(REFRESH_SRC) !== REFRESH_SRC);
  await withRedis(async (M) => {
    let called = 0;
    const failing = async () => { called++; throw new Error("HTTP 500"); };
    for (let i = 0; i < 3; i++) {
      await M.maybeRefreshOnView(setFor("BAD", { stale: true }), failing);
      await M.settle();
    }
    check("MUTATION: a cooldown set only on SUCCESS gives a failing symbol unlimited retries",
      called === 3,
      `${called} attempts across three views — one bad symbol becomes one 3MB fetch per reader`);
  }, m);
}

{
  // MUTATION (iii): the lock taken BEFORE the rate check, so every budget
  // refusal strands the lock for its full TTL.
  const m = (s) => s.replace(
    "        if (!(await claimRate())) return;\n        if (!(await takeLock(symbol))) return;",
    "        if (!(await takeLock(symbol))) return;\n        if (!(await claimRate())) return;"
  );
  check("the lock-before-rate mutation actually applied", m(REFRESH_SRC) !== REFRESH_SRC);
  await withRedis(async (M, redis) => {
    const cap = M.REFRESH_FETCHES_PER_MINUTE;
    for (let i = 0; i < cap + 3; i++) {
      await M.maybeRefreshOnView(setFor(`S${i}`, { stale: true }), async () => {});
      await M.settle();
    }
    // The symbols refused by the budget took a lock and never released it: the
    // refusal returns before the try/finally that owns the del.
    const locks = redis.ops.filter(([op, k]) => op === "set" && k.includes("refresh-lock")).length;
    const dels = redis.ops.filter(([op, k]) => op === "del" && k.includes("refresh-lock")).length;
    check("MUTATION: taking the lock before the budget check strands locks on every refusal",
      locks > dels,
      `${locks} locks taken, ${dels} released — each stranded one blocks its symbol for the full ` +
        `TTL with no work done`);
  }, m);
}

console.log("\n5. the CIK the cold path resolved reaches the manifest");

check("the cold path records the CIK at its single write site",
  /await recordColdCik\(symbol, cik\);/.test(COLD_SRC) &&
    (COLD_SRC.match(/recordColdCik\(/g) ?? []).length === 1,
  "one call, on the write path — not on every render");
check("...and it does NOT read the manifest from the render path",
  !/readManifest/.test(COLD_SRC),
  "417 KB per visitor is the cost the whole cold-path design exists to avoid");
// ANCHORED ON `await …`, NOT ON THE BARE IDENTIFIER. check-assertion-anchors
// caught the first version: `drainColdCiks(manifest)` matches a DECLARATION of
// that name as well as a call to it, so the assertion could have been satisfied
// by source that never calls it. The `await` prefix is context only a call site
// has.
check("the job drains the recorded CIKs BEFORE it builds its queues",
  JOB_SRC.indexOf("await drainColdCiks(manifest)") > 0 &&
    JOB_SRC.indexOf("await drainColdCiks(manifest)") <
      JOB_SRC.indexOf("const q = populationQueues(manifest)"),
  "populationQueues filters on e.cik, so draining after would leave the symbol unqueued for a day");

{
  const redis = makeRedis();
  globalThis.__FAKE_REDIS__ = redis;
  const src = COLDCIK_SRC
    .replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
    .replace(/^const redis =[\s\S]*?: null;$/m, "const redis = globalThis.__FAKE_REDIS__;");
  const CC = await lift(
    [
      "const emptyEntry = (cik) => ({ cik, contentHash: null, needsReverify: false });",
      src.replace(/export (const|async function|function|type)/g, "$1"),
      "export { recordColdCik, drainColdCiks, SEC_COLD_CIK_KEY };",
      `// lift-nonce ${nonce++}`,
    ].join("\n")
  );

  await CC.recordColdCik("ONDS", "0001679788");
  await CC.recordColdCik("AAPL", "0000320193");
  await CC.recordColdCik("NEWSYM", "0000000042");

  const manifest = {
    symbols: {
      // THE ONDS SHAPE: an entry that exists and carries no CIK, so it is in no
      // queue at all.
      ONDS: { cik: null, contentHash: null, needsReverify: false },
      AAPL: { cik: "0000320193", contentHash: "h", needsReverify: false },
      CONFLICT: { cik: "0000000001", contentHash: "h", needsReverify: false },
    },
  };
  await CC.recordColdCik("CONFLICT", "0000000999");
  const drain = await CC.drainColdCiks(manifest);

  check("an entry with a NULL cik is filled — the ONDS case",
    manifest.symbols.ONDS.cik === "0001679788" && drain.filled === 1,
    `ONDS cik ${manifest.symbols.ONDS.cik}, filled ${drain.filled}`);
  check("...and it is now selectable by the queues, which filter on e.cik",
    Boolean(manifest.symbols.ONDS.cik),
    "before this it was in no cron queue at all: not populate, not reverify, not rewindow");
  check("a symbol with NO entry gets one created",
    manifest.symbols.NEWSYM?.cik === "0000000042" && drain.created === 1,
    `created ${drain.created}`);
  check("an entry already carrying the same CIK is left alone",
    drain.already === 1, `already ${drain.already}`);
  check("a DISAGREEMENT is reported and NOT applied",
    drain.conflicts.length === 1 &&
      manifest.symbols.CONFLICT.cik === "0000000001",
    `manifest keeps ${manifest.symbols.CONFLICT.cik}; reconcileCiks owns a CIK change, ` +
      `with its ticker map and its change threshold`);
  check("...and the conflict is NOT drained, so it keeps being reported",
    (redis.hashes.get(CC.SEC_COLD_CIK_KEY) ?? new Map()).has("CONFLICT"),
    "a disagreement that logs once and then vanishes is one nobody acts on");
  check("...while everything applied WAS drained",
    !(redis.hashes.get(CC.SEC_COLD_CIK_KEY) ?? new Map()).has("ONDS"),
    "re-folding the same CIK is a no-op, but leaving it grows the hash forever");

  // MUTATION: apply the conflict instead of reporting it.
  const conflictSrc = src.replace(
    "      out.conflicts.push({ symbol, manifest: entry.cik, cold: cik });",
    "      out.conflicts.push({ symbol, manifest: entry.cik, cold: cik });\n      entry.cik = cik;"
  );
  check("the apply-the-conflict mutation actually applied", conflictSrc !== src);
  const CC2 = await lift(
    [
      "const emptyEntry = (cik) => ({ cik, contentHash: null, needsReverify: false });",
      conflictSrc.replace(/export (const|async function|function|type)/g, "$1"),
      "export { recordColdCik, drainColdCiks, SEC_COLD_CIK_KEY };",
      `// lift-nonce ${nonce++}`,
    ].join("\n")
  );
  const m2 = { symbols: { CONFLICT: { cik: "0000000001", contentHash: "h", needsReverify: false } } };
  await CC2.drainColdCiks(m2);
  check("MUTATION: applying it routes a CIK change around reconcileCiks entirely",
    m2.symbols.CONFLICT.cik === "0000000999",
    `the manifest silently becomes ${m2.symbols.CONFLICT.cik} — no threshold, no shape-change ` +
      `guard, no record that it moved`);
}

console.log(
  failures
    ? `\n${failures} assertion(s) failed.`
    : "\nRefresh-on-view holds: the guards run, and the CIK reaches the manifest."
);
process.exit(failures ? 1 : 0);
