// A PREVIEW DOES NOT COUNT AS A READER — asserted per write site.
//
// ── WHAT THIS GUARDS, MEASURED ───────────────────────────────────────────
// One eye-check session on 2026-09-16 put 18 POSTs through
// /api/internal/track-view in forty minutes, every one an increment against
// production's per-IP daily page-view counters from an unmerged branch. Ticker
// interest is the worse case: it is a DEMAND RANKING that decides which symbols
// the site treats as wanted, and a reviewer clicking through AAPL and ABT is
// not demand.
//
// ── WHY IT ENUMERATES ────────────────────────────────────────────────────
// The same reason check-sec-write-gate does. "The endpoint returns 204 early"
// is one layer; the module functions are another, and a future caller reaching
// the module directly would bypass a check that only knew about the route.
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// The functions that write a DEMAND fact, and the file each lives in.
// Deliberately NOT here: the price/news/history/fundamentals caches (they
// cache third-party data, not this site's traffic) and dailyPageLimit's BotID
// day markers (middleware per-IP caches, not counters) — see demandWriteGate.
const SITES = [
  ["lib/server/searchDemand.ts", "recordTickerInterest"],
  ["lib/server/dailyPageLimit.ts", "recordDailyPageView"],
];
const MUTATION = /\bredis\.(set|zadd|zincrby|incr|expire|hset|lpush|sadd)\b/;

const bodyOf = (src, name) => {
  const re = new RegExp(`(?:export\\s+)?async function ${name}\\b`);
  const at = src.search(re);
  if (at < 0) return null;
  const rest = src.slice(at);
  const next = rest.slice(1).search(/^(?:export\s+)?(?:async\s+)?function /m);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

console.log("\n1. every demand write sits behind the gate");
for (const [file, fn] of SITES) {
  const body = bodyOf(readCodeOnly(file), fn);
  check(`${file} exports ${fn}`, Boolean(body));
  if (!body) continue;
  check(`  ...it writes, so it is worth gating`, MUTATION.test(body),
    (body.match(MUTATION) ?? ["none"])[0]);
  check(`  ...and it consults canWriteDemandState()`,
    /canWriteDemandState\(\)/.test(body),
    /canWriteDemandState\(\)/.test(body) ? "gated" : "NOT GATED");
  // THE GATE MUST COME FIRST. A gate after the first write counts once and
  // then refuses, which reads as working and is not.
  const gateAt = body.search(/canWriteDemandState\(\)/);
  const writeAt = body.search(MUTATION);
  check(`  ...before its first write, not after`, gateAt >= 0 && gateAt < writeAt,
    `gate at ${gateAt}, first write at ${writeAt}`);
}

console.log("\n2. the endpoints answer 204 without doing the work");
for (const route of [
  "app/api/track/ticker-interest/route.ts",
  "app/api/internal/track-view/route.ts",
]) {
  const src = readCodeOnly(route);
  check(`${route} returns early on a preview`,
    /if \(!canWriteDemandState\(\)\) return new NextResponse\(null, \{ status: 204 \}\);/.test(src));
  // THE STATUS MUST MATCH THE COUNTED CASE. A different one would let a beacon
  // work out which deployment it is talking to.
  check(`  ...with the SAME 204 a counted request gets`,
    (src.match(/status: 204/g) ?? []).length >= 2,
    "a distinguishable response is a way to probe the deployment");
}

console.log("\n3. the predicate is the shared one, not a third copy");
{
  const gate = readCodeOnly("lib/server/demandWriteGate.ts");
  check("it delegates to isProductionDeployment",
    /return isProductionDeployment\(\);/.test(gate) &&
      !/process\.env\.VERCEL_ENV/.test(gate),
    "a third copy of the comparison is a third thing to get wrong");
  check("it is not the SEC-named gate",
    !/canWriteSecState/.test(gate),
    "importing a SEC predicate into a view counter reads as a mistake and invites a copy");
  check("a refusal is announced rather than silent",
    /noteWriteBlocked\("demand", site\)/.test(gate));
}

console.log("\n4. the mutation: one gate removed");
{
  const src = readCodeOnly("lib/server/searchDemand.ts");
  const broken = src.replace(
    /  if \(!canWriteDemandState\(\)\) \{\n    noteDemandWriteBlocked\("recordTickerInterest"\);\n    return \{ counted: false \};\n  \}\n/,
    ""
  );
  check("the mutation applies", broken !== src);
  const body = bodyOf(broken, "recordTickerInterest");
  check("MUTATION: recordTickerInterest without its gate is not gated",
    body && MUTATION.test(body) && !/canWriteDemandState\(\)/.test(body),
    "which is the state that let an eye-check rank tickers");
}

console.log("\n5. the caches this deliberately leaves alone stay alone");
{
  // A GATE THAT SPREAD would be as wrong as one that never shipped: these
  // cache third-party data keyed by symbol, and a preview filling one costs a
  // fetch production would have made anyway.
  const untouched = [
    "lib/server/historyCache.ts", "lib/server/quoteData.ts",
    "lib/server/newsStore.ts", "lib/server/fundamentalsCache.ts",
    "lib/server/referenceCache.ts",
  ];
  for (const f of untouched) {
    check(`${f} is untouched by the demand gate`,
      !/canWriteDemandState/.test(readCodeOnly(f)));
  }
}

console.log(
  failures ? `\n${failures} assertion(s) failed.` : "\nA preview counts as nobody.\n"
);
process.exit(failures ? 1 : 0);
