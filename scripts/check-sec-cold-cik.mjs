// THE COLD-PATH CIK — and the render path that must never fetch what it already has.
//
// ── WHY THE FUNCTIONS ARE LIFTED AND CALLED ───────────────────────────────
// The properties here are about ARITHMETIC over a manifest — what a drain
// fills, creates, leaves alone and refuses. A regex over the source can see
// that a drain exists and cannot see any of that.
//
// So the module is lifted with a FAKE REDIS whose behaviour is real — HSET
// actually stores, HDEL actually removes — and the assertions are what the
// function does when called.
//
// THE FAKE IS NOT AN ORACLE. It implements the Redis primitives, not the
// module's rules; it does not know what a conflict is. Every expected value
// below comes from calling the shipped code.
//
// ── AND ONE PROPERTY OF THE RENDER PATH, WHICH IS WHY THIS FILE EXISTS ────
// §1 asserts that a POPULATED stored set is returned without a SEC fetch. A
// refresh-on-view once sat exactly there and was removed: `revalidatePath` is
// refused from a page render's after(), so it corrected a set it could not
// flush, and the ISR cache meant the visitor who triggered it was also the only
// one who could. The mutation re-adds it, and §1 fails — which is the only way
// to keep a removal removed.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const COLDCIK_SRC = readCodeOnly("lib/server/secColdCik.ts");
const COLD_SRC = readCodeOnly("lib/server/secColdFetch.ts");
const JOB_SRC = readCodeOnly("app/api/jobs/sec-facts/route.ts");

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

let nonce = 0;

console.log("\n1. a populated stored set is returned without a SEC fetch");

// ── THE PROPERTY, STATED AS SOURCE BECAUSE IT IS A PROPERTY OF SOURCE ────
//
// resolveFactSetForRender's populated branch must RETURN, and nothing between
// the store read and that return may reach SEC. Read as text rather than run
// because running it would need a render scope, a network and a store — and
// the thing being asserted is that a particular line is NOT there, which a
// successful run can never demonstrate.
// ── 2026-09-23 (#535 COWORK #13): THE WHOLE RENDER FUNCTION, NOT A BRANCH ──
// The render no longer fetches at all: the empty-set retry and the cold fetch
// moved to fillColdSymbol, which only the human-gated action calls. So the
// property is now the stronger one — nothing in resolveFactSetForRender reaches
// SEC or queues work, on any branch.
const RENDER_END = "export type ColdFillOutcome";
const populated = COLD_SRC.slice(
  COLD_SRC.indexOf("export async function resolveFactSetForRender"),
  COLD_SRC.indexOf(RENDER_END)
);
check("resolveFactSetForRender was found and sliced",
  populated.length > 200 && populated.includes("hasUsableData(stored)") && COLD_SRC.indexOf(RENDER_END) > 0,
  `${populated.length} chars — a slice that missed would pass every assertion below`);

// EVERYTHING THAT REACHES SEC OR QUEUES WORK FROM THIS MODULE, by name.
const FETCHERS = ["fetchAndStore", "fetchCompanyFacts", "retryEmpty", "fillColdSymbol", "enqueue", "claimColdFetch"];
const usableBranch = populated;
check("the populated branch is a bare return",
  /if \(hasUsableData\(stored\)\) return \{ status: "ready", set: stored, cold: false \};/.test(usableBranch),
  usableBranch.split("\n").map((l) => l.trim()).filter(Boolean).join(" ⏎ ").slice(0, 200));
check("...and NOTHING in the render function reaches SEC or queues work",
  FETCHERS.every((f) => !usableBranch.includes(`${f}(`)),
  FETCHERS.filter((f) => usableBranch.includes(`${f}(`)).join(", ") || "none");
check("the render path schedules no background work at all",
  !/\bafter\s*\(/.test(populated) && !COLD_SRC.includes('from "next/server"'),
  "after() from a render is where the removed refresh lived");
check("...and the render path never calls revalidatePath",
  !COLD_SRC.includes("revalidatePath"),
  "production refuses it from a render scope: Dynamic server usage");
check("a cold symbol with no set renders 'not yet read', not a fetch",
  /return \{ status: "pending", reason: NOT_YET_READ \};/.test(populated));

{
  // MUTATION: the refresh put back the way it was — the populated branch
  // schedules a re-read before returning. Every assertion above that matters
  // must move.
  const readded = COLD_SRC.replace(
    'if (hasUsableData(stored)) return { status: "ready", set: stored, cold: false };',
    'if (hasUsableData(stored)) {\n' +
      '      await maybeRefreshOnView(stored, (sym) => fetchAndStore(sym, cik));\n' +
      '      return { status: "ready", set: stored, cold: false };\n' +
      '    }'
  );
  check("the re-add mutation actually applied", readded !== COLD_SRC);
  const mutBranch = readded.slice(
    readded.indexOf("export async function resolveFactSetForRender"),
    readded.indexOf(RENDER_END)
  );
  check("MUTATION: re-adding the refresh breaks the bare-return assertion",
    !/if \(hasUsableData\(stored\)\) return \{ status: "ready", set: stored, cold: false \};/.test(mutBranch),
    "an assertion that survived the re-add would not be keeping the removal");
  check("MUTATION: ...and the branch now reaches a fetcher",
    FETCHERS.some((f) => mutBranch.includes(`${f}(`)),
    FETCHERS.filter((f) => mutBranch.includes(`${f}(`)).join(", ") || "(none — the mutation is inert)");
}

check("the removed module is gone, not merely unreferenced",
  !fs.existsSync("lib/server/secRefreshOnView.ts"),
  "a file nothing imports is a file the next session re-imports");
check("...and its per-symbol keys left the eviction list with it",
  !readCodeOnly("lib/server/symbolEviction.ts").includes("msh:sec:refresh-"),
  "a key list naming a prefix nothing writes is a claim the scan cannot check");

console.log("\n2. the CIK the cold path resolved reaches the manifest");

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
      // THE WRITE GATE, STUBBED TO PRODUCTION. This section is about the CIK
      // logic, and every assertion below assumes the writes happen; leaving the
      // gate unresolved would make them pass for the wrong reason. That the
      // gate is present at all is check-sec-write-gate's job, per call site.
      "const canWriteSecState = () => true;",
      "const noteSecWriteBlocked = () => {};",
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
      // THE WRITE GATE, STUBBED TO PRODUCTION. This section is about the CIK
      // logic, and every assertion below assumes the writes happen; leaving the
      // gate unresolved would make them pass for the wrong reason. That the
      // gate is present at all is check-sec-write-gate's job, per call site.
      "const canWriteSecState = () => true;",
      "const noteSecWriteBlocked = () => {};",
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
    : "\nThe render path fetches nothing it already has, and the CIK reaches the manifest."
);
process.exit(failures ? 1 : 0);
