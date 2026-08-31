// The dynamic-universe score bump, and the two things that make it correct.
//
// WHAT CHANGED. addToDynamicUniverse issued one ZINCRBY per symbol behind a
// pipeline -- ~700 commands per call, from five builders plus the market route,
// so ~3,500 per build cycle. The pipeline made that one round-trip, which is
// what the old comment measured, but Upstash bills commands. It is now one EVAL
// per chunk running the same ZINCRBYs server-side.
//
// THE PROPERTY THAT MUST SURVIVE. The score is a CUMULATIVE COUNT, read by the
// ZRANGE that picks the top MAX_DYNAMIC_UNIVERSE_SIZE and by the overflow prune.
// For a count, last-writer-wins is the v1 read-modify-write defect that ZINCRBY
// was introduced to fix -- so any "optimisation" that replaces the increments
// with a bulk ZADD reintroduces it. That is asserted here, because the seen-set
// ZADD sitting a few lines below makes it an inviting change to make.
//
// THE FAILURE THIS IS REALLY GUARDING. The boost is passed as ARGV[1] from
// JavaScript and read as ARGV[1] by Lua, with members from index 2. Those are
// two files' worth of apart -- one string, one template literal -- and nothing
// type-checks the join. Reorder either side and every symbol is incremented by
// its own name (or the first symbol silently becomes the increment), which
// throws nothing and merely produces a wrong ranking. Both halves are pinned
// below so they cannot drift independently.
//
// NOT COVERED HERE: executing the Lua. There is no Lua interpreter or fengari in
// this sandbox, so the script body's runtime behaviour is first exercised on a
// preview deploy. Said plainly rather than implied by silence.
//
//   node scripts/check-zincrby-eval.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import fs from "node:fs";
import path from "node:path";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const code = readCodeOnly("lib/server/dynamicUniverseCache.ts");
// The Lua lives in a template literal, which readCodeOnly blanks along with
// other string content, so the script body is read from the raw file.
const raw = fs.readFileSync(
  path.join(process.cwd(), "lib/server/dynamicUniverseCache.ts"),
  "utf8"
);
const lua = raw.match(/const ZINCRBY_MANY_LUA = `([\s\S]*?)`;/)?.[1] ?? "";

console.log("\n=== 1. The command count actually dropped ===\n");

check(
  "no per-symbol zincrby remains",
  !/pipeline\.zincrby\(/.test(code),
  "one command per symbol behind a pipeline is one round-trip and still ~700 billed commands"
);
check(
  "the bump goes through EVAL",
  /redis\.eval\(/.test(code) && /ZINCRBY_MANY_LUA/.test(code),
  "the script runs the same increments server-side, which bills as one command"
);
check(
  "the members are chunked",
  /ZINCRBY_EVAL_CHUNK/.test(code),
  "not for billing — it bounds the request body, since one ARGV carrying the whole universe is a large POST for nothing"
);

console.log("\n=== 2. Atomicity is preserved, not traded away ===\n");

check(
  "the script still uses ZINCRBY, not ZADD",
  /ZINCRBY/.test(lua) && !/ZADD/.test(lua),
  "a bulk ZADD here is last-writer-wins, which is exactly the v1 defect ZINCRBY was introduced to fix"
);
check(
  "the seen-set ZADD is still separate from the score",
  /redis\.zadd\(SEEN_KEY/.test(code),
  "lastSeen is an absolute overwrite so last-writer-wins is correct for it — that is why it can be a ZADD and the score cannot"
);
check(
  "the bump still fails open",
  /catch \(error\)[\s\S]{0,400}dynamic-universe\] add failed/.test(code),
  "a missed bump costs ranking accuracy, not correctness, and must not fail a build"
);

console.log("\n=== 3. The JS and Lua halves agree on argument order ===\n");

check(
  "Lua reads the boost from ARGV[1]",
  /local boost = ARGV\[1\]/.test(lua),
  "if JS ever sends members first, every symbol is incremented by its own name and nothing throws"
);
check(
  "Lua iterates members from index 2",
  /for i = 2, #ARGV do/.test(lua),
  "starting at 1 would increment the set by the boost value treated as a member name"
);
check(
  "Lua increments against KEYS[1]",
  /redis\.call\('ZINCRBY', KEYS\[1\], boost, ARGV\[i\]\)/.test(lua),
  "the key must come through KEYS, not be baked into the script"
);
check(
  "JS passes the key as the only KEYS entry",
  /redis\.eval\(ZINCRBY_MANY_LUA, \[SCORE_KEY\],/.test(code),
  "the score key is the one key this script touches"
);
check(
  "JS passes the boost first, then the members",
  /\[String\(scoreBoost\), \.\.\.group\]/.test(code),
  "this is the other half of the ARGV[1] contract above, and the two are in different syntaxes with nothing checking the join"
);

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\nFAILED (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
