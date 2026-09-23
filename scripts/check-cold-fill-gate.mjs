// THE HUMAN-GATED COLD FILL (#535 COWORK #13).
//
// A cold symbol's page makes zero SEC calls (check-sec-cold-path,
// check-sec-cold-cik). SEC is reached only through the server action in
// app/stock/[symbol]/coldFillAction.ts, and only past these gates. Pinned here:
//   1. every refusal, RUN: a missing/invalid token, an unknown symbol, a symbol
//      with no CIK, an over-limit IP, the daily attempt cap, a bot verdict
//      (verified bots and an unanswerable verdict included), the day's fills —
//      and a MUTATION for each showing the assertion would notice it gone;
//   2. the action's ORDER: free gates, then counters, then the paid BotID
//      check, then the fill ceiling, then the lock, then the fill;
//   3. it returns no figures; BotID is asked for deep analysis and the page
//      paths are in the protect list; the page's server-rendered state is
//      "not yet read"; both pages carry noindex while no set exists.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const GATE = "lib/server/secColdFill.ts";
const ACTION = "app/stock/[symbol]/coldFillAction.ts";
const gateRaw = fs.readFileSync(GATE, "utf8");
const constant = (name) => gateRaw.match(new RegExp(`export const ${name} = [^;]+;`))?.[0];

const load = async (src) => lift([
  constant("COLD_FILL_PER_IP_PER_HOUR"),
  constant("COLD_FILL_PER_DAY"),
  constant("COLD_FILL_ATTEMPTS_PER_DAY"),
  grabFunction(src, "coldFillPreGate"),
  grabFunction(src, "coldFillBotGate"),
  grabFunction(src, "coldFillDayGate"),
].join("\n").replace(/export const/g, "const") +
  "\nexport { coldFillPreGate, coldFillBotGate, coldFillDayGate, COLD_FILL_PER_IP_PER_HOUR, COLD_FILL_PER_DAY, COLD_FILL_ATTEMPTS_PER_DAY };");

const G = await load(gateRaw);
const OK = { tokenOk: true, symbolOk: true, hasCik: true, ipCount: 1, attemptCount: 1 };
const HUMAN = { isBot: false, isVerifiedBot: false };

console.log("1. every refusal, run — and each one's mutation");
check("a clean request from a person passes every gate",
  G.coldFillPreGate(OK) === null && G.coldFillBotGate(HUMAN) === null && G.coldFillDayGate(1) === null);
const CASES = [
  ["a missing or invalid token", () => G.coldFillPreGate({ ...OK, tokenOk: false }), "token", "if (!i.tokenOk) return \"token\";"],
  ["an unknown symbol", () => G.coldFillPreGate({ ...OK, symbolOk: false }), "symbol", "if (!i.symbolOk) return \"symbol\";"],
  ["a symbol with no CIK", () => G.coldFillPreGate({ ...OK, hasCik: false }), "not-eligible", "if (!i.hasCik) return \"not-eligible\";"],
  ["an address over its hourly limit", () => G.coldFillPreGate({ ...OK, ipCount: G.COLD_FILL_PER_IP_PER_HOUR + 1 }), "ip-limit",
    "if (i.ipCount > COLD_FILL_PER_IP_PER_HOUR) return \"ip-limit\";"],
  ["the site over its daily BotID attempts", () => G.coldFillPreGate({ ...OK, attemptCount: G.COLD_FILL_ATTEMPTS_PER_DAY + 1 }), "attempt-limit",
    "if (i.attemptCount > COLD_FILL_ATTEMPTS_PER_DAY) return \"attempt-limit\";"],
  ["a bot verdict", () => G.coldFillBotGate({ isBot: true, isVerifiedBot: false }), "bot",
    "if (bot.isBot || bot.isVerifiedBot) return \"bot\";"],
  ["a VERIFIED good bot (Googlebot) — it gets the jobs' data, never a live fetch", () => G.coldFillBotGate({ isBot: true, isVerifiedBot: true }), "bot",
    "if (bot.isBot || bot.isVerifiedBot) return \"bot\";"],
  ["an unanswerable BotID verdict (fails closed)", () => G.coldFillBotGate(null), "bot", "if (!bot) return \"bot\";"],
  ["the site over its daily fills", () => G.coldFillDayGate(G.COLD_FILL_PER_DAY + 1), "day-limit",
    "return dayCount > COLD_FILL_PER_DAY ? \"day-limit\" : null;"],
];
for (const [name, run, want, line] of CASES) {
  check(`refuses ${name}`, run() === want, String(run()));
  const mutated = gateRaw.replace(line, line.startsWith("return ") ? "return null;" : "");
  if (mutated === gateRaw) { check(`MUTATION for "${name}" applied`, false, line); continue; }
  const M = await load(mutated);
  const again = run.toString().includes("coldFillBotGate") ? M.coldFillBotGate
    : run.toString().includes("coldFillDayGate") ? M.coldFillDayGate : M.coldFillPreGate;
  const arg = name.includes("VERIFIED") ? [{ isBot: true, isVerifiedBot: true }]
    : name.includes("unanswerable") ? [null]
    : name.includes("bot verdict") ? [{ isBot: true, isVerifiedBot: false }]
    : name.includes("daily fills") ? [G.COLD_FILL_PER_DAY + 1]
    : [{
        ...OK,
        ...(name.includes("token") ? { tokenOk: false } : {}),
        ...(name.includes("unknown symbol") ? { symbolOk: false } : {}),
        ...(name.includes("no CIK") ? { hasCik: false } : {}),
        ...(name.includes("hourly") ? { ipCount: G.COLD_FILL_PER_IP_PER_HOUR + 1 } : {}),
        ...(name.includes("attempts") ? { attemptCount: G.COLD_FILL_ATTEMPTS_PER_DAY + 1 } : {}),
      }];
  let got;
  try { got = again(...arg); } catch (e) { got = `threw ${e.constructor.name}`; }
  check(`MUTATION: dropping that line and "${name}" is no longer refused`, got !== want, String(got));
}
check("limits are the ruled ones: 5 per IP per hour, 300 fills a day",
  G.COLD_FILL_PER_IP_PER_HOUR === 5 && G.COLD_FILL_PER_DAY === 300);
check("the site-wide 20/min SEC budget still applies inside the fill",
  /SEC_COLD_FETCHES_PER_MINUTE = 20;/.test(readCodeOnly("lib/server/secColdFetch.ts")));
check("counters fail CLOSED on a Redis error",
  /ipCount: ipCount \?\? COLD_FILL_PER_IP_PER_HOUR \+ 1/.test(gateRaw) &&
    /\?\? COLD_FILL_PER_DAY \+ 1/.test(gateRaw) && /attemptCount: attemptCount \?\? COLD_FILL_ATTEMPTS_PER_DAY \+ 1/.test(gateRaw));

console.log("\n2. the action's order");
const action = readCodeOnly(ACTION);
const pos = (needle) => action.indexOf(needle);
const order = [
  ["token verified", "verifyQuoteToken(token)"],
  ["symbol pattern", "COLD_FILL_SYMBOL.test(clean)"],
  ["CIK gate", "cikForSymbol(clean)"],
  ["per-IP + attempt counters", "await countColdFillAttempt(ip)"],
  ["BotID deep analysis", "await checkBotId("],
  ["bot gate", "coldFillBotGate(bot)"],
  ["day's fills, after the human verdict", "await countColdFillDay()"],
  ["per-symbol lock", "await takeColdFillLock(clean)"],
  ["the fill", "await fillColdSymbol(clean)"],
];
const at = order.map(([, n]) => pos(n));
check("every step is present", at.every((i) => i > -1), order.map(([l], i) => `${l}@${at[i]}`).join(" "));
check("...in order: free gates, counters, the paid check, the fill ceiling, the lock, the fill",
  at.every((i, k) => k === 0 || i > at[k - 1]));
check("the action is a server action", /^"use server";/.test(fs.readFileSync(ACTION, "utf8")));
check("BotID is asked for DEEP ANALYSIS", /checkBotId\(\{ advancedOptions: \{ checkLevel: "deepAnalysis" \} \}\)/.test(action));
check("the lock is released whatever happens", /finally \{\s*await releaseColdFillLock\(clean\);/.test(action));
check("it returns an outcome word, never figures",
  (action.match(/return \{[^}]*\}/g) ?? []).every((r) => /^return \{ ok: (true, outcome \}|false, refused: ("[a-z-]+"|\w+) \})$/.test(r.replace(/\s+/g, " "))),
  (action.match(/return \{[^}]*\}/g) ?? []).join(" | "));
const instr = readCodeOnly("instrumentation-client.ts");
check("BotID protects the page POSTs the action rides on",
  ["/stock/*", "/stock/*/earnings", "/stock/*/news"].every((p) =>
    new RegExp(`path: "${p.replace(/[*/]/g, (c) => `\\${c}`)}", method: "POST", advancedOptions: \\{ checkLevel: "deepAnalysis" \\}`).test(instr)));

console.log("\n3. what a crawler sees");
const cf = fs.readFileSync("app/stock/[symbol]/ColdFill.tsx", "utf8");
check("the server-rendered state is 'not yet read'; only a hydrated page moves to 'reading'",
  /useSyncExternalStore\(noSubscribe, \(\) => true, \(\) => false\)/.test(cf) &&
    /const phase: Phase = settled \?\? \(hydrated \? "reading" : "waiting"\);/.test(cf));
check("the reading words are the ruled ones",
  cf.includes("Reading this company's SEC filings — this can take a few seconds.") &&
    cf.includes("This is taking longer than usual; figures will appear shortly"));
check("the stock page is noindex while a cold symbol is not yet read",
  /index: hasData && !\(await awaitingSecRead\(upper\)\)/.test(readCodeOnly("app/stock/[symbol]/page.tsx")));
check("the earnings page likewise",
  /index: cikForSymbol\(clean\) !== null && !\(await awaitingSecRead\(clean\)\)/.test(readCodeOnly("app/stock/[symbol]/earnings/page.tsx")));
{
  const cold = readCodeOnly("lib/server/secColdFetch.ts");
  const fn = cold.slice(cold.indexOf("export async function awaitingSecRead"));
  check("awaitingSecRead is exactly 'a CIK, admitted, and nothing stored' — and a Redis blip is NOT noindex",
    /if \(!cik \|\| !admitSymbolForExtraction\(clean, cik\)\.admit\) return false;/.test(fn) &&
      /return \(await factSetExists\(clean\)\) === false;/.test(fn));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nThe cold fill is human-gated.");
