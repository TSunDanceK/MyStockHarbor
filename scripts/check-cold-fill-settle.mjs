// THE COLD-FILL CLIENT ALWAYS SETTLES, AND GOOGLE ONLY SEES INDEXABLE PAGES
// (#535 COWORK #19 §1, #20, #21).
//
//   1. THE SETTLE RULE, RUN: a hung call (BotID's challenge never answering,
//      the production defect), a rejected call, a synchronous throw, a bot
//      refusal and a malformed reply all end on the fallback sentence within
//      the ceiling — plus a MUTATION that removes the timer and must hang.
//   2. THE COMPONENT goes through settleColdFill and never awaits the action
//      bare; the wording is the ruled sentence.
//   3. THE COUNTERS: every refusal past the attempt counter and every fill
//      outcome is counted by word; the free refusals are not.
//   4. INDEXING: the sitemap drops what renders "not yet read", dates
//      /earnings from when the figures changed (writeFactSet's stamp), regenerates
//      daily; a companyfacts 404 (and only a 404) is the stored empty answer
//      in both fetchers; sec-facts flushes both pages; the daily index seeds
//      every curated symbol; a no-CIK earnings page is noindex.
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const SETTLE = "app/stock/[symbol]/coldFillSettle.ts";
const settleSrc = fs.readFileSync(SETTLE, "utf8").replace(/^import type[^;]+;$/gm, "");
const S = await lift(settleSrc, "", "coldFillSettle");

const TIMEOUT = 60;
const hung = () => new Promise(() => {});
// Resolves to "hung" if the settle did not answer within 4× its own ceiling.
const within = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r("hung"), TIMEOUT * 4))]);
const phase = (step) => (step === "hung" ? "hung" : step.kind === "phase" ? step.phase : `refresh+${step.afterMs}`);

console.log("1. the client always settles");
{
  const cases = [
    ["a hung call (BotID's challenge never answers)", hung, "slow"],
    ["a rejected call", () => Promise.reject(new Error("botid")), "slow"],
    ["a synchronous throw", () => { throw new Error("sync"); }, "slow"],
    ["a bot refusal", async () => ({ ok: false, refused: "bot" }), "slow"],
    ["a malformed reply", async () => null, "slow"],
    ["filled", async () => ({ ok: true, outcome: "filled" }), "refresh+0"],
    ["another visitor's fill in flight", async () => ({ ok: false, refused: "in-flight" }), `refresh+${S.IN_FLIGHT_RETRY_MS}`],
    ["no usable data", async () => ({ ok: true, outcome: "no-data" }), "none"],
    ["queued for the job", async () => ({ ok: true, outcome: "queued" }), "slow"],
    ["an over-limit address", async () => ({ ok: false, refused: "ip-limit" }), "waiting"],
  ];
  for (const [name, call, want] of cases) {
    const got = phase(await within(S.settleColdFill(call, TIMEOUT)));
    check(`${name} → ${want}`, got === want, got);
  }
  check("the ceiling is about 12 s", S.COLD_FILL_SETTLE_MS === 12_000, String(S.COLD_FILL_SETTLE_MS));
  check("the fallback is the ruled sentence",
    S.COLD_FILL_WORDS.slow === "This is taking longer than usual; figures will appear once the company's filings are read.");

  // MUTATION: the timer removed. The hung case must then NOT settle, or the
  // assertion above is not what is guarding it.
  const noTimer = settleSrc.replace("const timer = setTimeout(() => finish(FALLBACK), timeoutMs);", "const timer = undefined;");
  check("the no-timer mutation applied", noTimer !== settleSrc);
  const M = await lift(noTimer, "", "coldFillSettle-mutant");
  check("MUTATION: without the timer a hung BotID call hangs (so the timer is what settles it)",
    (await within(M.settleColdFill(hung, TIMEOUT))) === "hung");
}

console.log("\n2. the component goes through the settle rule");
{
  const ui = readCodeOnly("app/stock/[symbol]/ColdFill.tsx");
  check("the action is called only inside settleColdFill", /settleColdFill\(\(\) => requestColdFill\(symbol, token\)\)/.test(ui) &&
    (ui.match(/requestColdFill\(/g) ?? []).length === 1);
  check("no bare await of the action", !/await requestColdFill/.test(ui));
  check("a still-cold page after a refresh settles on the fallback", /REFRESH_GRACE_MS/.test(ui) && /setPhase\("slow"\)/.test(ui));
  check("the words come from the settle module, not a second copy", !/taking longer than usual/.test(ui));
}

console.log("\n3. the day counters");
{
  const action = readCodeOnly("app/stock/[symbol]/coldFillAction.ts");
  const attemptAt = action.indexOf("await countColdFillAttempt(");
  const firstRefuse = action.indexOf("return refuse(");
  check("every refusal after the attempt counter is counted by word", attemptAt > 0 && firstRefuse > attemptAt &&
    !/return \{ ok: false, refused: (limited|botRefusal|dayRefusal|"in-flight") \}/.test(action));
  check("the free refusals are not counted (they return before any counter)",
    /if \(early\) return \{ ok: false, refused: early \};/.test(action) && action.indexOf("if (early)") < attemptAt);
  check("every fill outcome is counted", /await countColdFillOutcome\(outcome\);/.test(action));
  const gate = readCodeOnly("lib/server/secColdFill.ts");
  check("one HINCRBY on a day hash, behind the preview prefix",
    /redis\.hincrby\(coldFillOutcomeKey\(\), word, 1\)/.test(gate) && /secCounterPrefix\("msh:sec:cold-fill-outcome:v1"\)/.test(gate));
}

console.log("\n4. what Google is sent");
{
  const sm = readCodeOnly("app/sitemap.ts");
  check("the sitemap asks the pages' own rule for every curated symbol", /sitemapSecState\(stockSymbols\)/.test(sm));
  check("/stock/X and /stock/X/earnings both drop an awaiting symbol",
    /stockSymbols\.filter\(renderable\)/.test(sm) && /!etfSymbols\.has\(symbol\) && renderable\(symbol\)/.test(sm));
  check("an unanswerable read keeps everything (null → nothing dropped)", /!sec\?\.awaiting\.has\(symbol\)/.test(sm));
  check("/earnings lastmod is when the figures changed, never a re-read time", /sec\?\.changedAt\.get\(symbol\)/.test(sm) && !/verifiedAt|manifest/i.test(sm));
  const store = readCodeOnly("lib/server/secFactStore.ts");
  const w = store.slice(store.indexOf("export async function writeFactSet"));
  check("…stamped by writeFactSet, after the set is stored", w.indexOf("redis.hset(SEC_FIGURES_CHANGED_KEY") > w.indexOf("await redis.set(factKey(set.symbol), set)") &&
    w.indexOf("await redis.set(factKey(set.symbol), set)") > 0);
  check("…read with the EXISTS in one pipeline", /p\.hmget\(SEC_FIGURES_CHANGED_KEY, \.\.\.syms\)/.test(store));
  check("regenerated at most daily", /export const revalidate = 86400;/.test(sm));

  const E = await lift(fs.readFileSync("lib/server/secExtract.ts", "utf8").match(/export const companyFactsAbsent = [^;]+;/)[0]);
  check("a 404 is 'no company facts'; 403/429/5xx are not", E.companyFactsAbsent(404) && ![200, 403, 429, 500, 503].some(E.companyFactsAbsent));
  const cold = readCodeOnly("lib/server/secColdFetch.ts");
  const job = readCodeOnly("app/api/jobs/sec-facts/route.ts");
  check("the cold fill stores a 404 as the empty payload", /const absent = companyFactsAbsent\(res\.status\);/.test(cold) && /absent \? \{ cik: Number\(cik\), facts: \{\} \}/.test(cold));
  check("…and so does the job's fetch", /if \(companyFactsAbsent\(res\.status\)\) return \{ cik: Number\(cik\), facts: \{\} \};/.test(job));
  check("sec-facts flushes both pages after a write", /for \(const path of \[`\/stock\/\$\{symbol\}\/earnings`, `\/stock\/\$\{symbol\}`\]\) revalidatePath\(path\);/.test(job));
  const idx = readCodeOnly("app/api/jobs/sec-daily-index/route.ts");
  check("the daily index seeds every curated symbol", /\.\.\.PRESET_UNIVERSE, \.\.\.priorityStocks, \.\.\.uniqueEtfs,/.test(idx));
  const earn = readCodeOnly("app/stock/[symbol]/earnings/page.tsx");
  check("a no-CIK earnings page (LAZR) is noindex", /index: cikForSymbol\(clean\) !== null && !\(await awaitingSecRead\(clean\)\)/.test(earn));
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nThe cold fill always settles, and the sitemap submits only pages that render with data and index.");
