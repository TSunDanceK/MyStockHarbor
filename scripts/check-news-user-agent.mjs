// The News User-Agent — the header that is the difference between 183ms and a
// five-second hole in every cold render.
//
//   node scripts/check-news-user-agent.mjs
//
// ── WHAT IS AT RISK, AND WHY IT IS WORTH ITS OWN SUITE ─────────────────────
// GlobeNewswire TARPITS a request that arrives without a User-Agent. Measured
// from a Vercel function, 2026-09-14 (claude/wire-egress-verdict-2026-09-14.md):
// no UA -> 20,003ms, aborted, ZERO bytes, `cause` EMPTY. With a UA, same cache
// mode -> 183ms, HTTP 200. The header is the only variable that moves it.
//
// Every failure this file guards is INVISIBLE, and invisible in the strongest
// sense available: a promise that never settles never reaches a catch, never
// logs, never throws, and the per-feed `finally` never runs. The 70-second
// render that started this took two days to attribute BECAUSE the failing leg
// produced no output whatsoever. Re-introducing it would produce no output
// either — the page would still render, the tests would still pass, and the
// wire leg would simply go quiet again.
//
//   1. THE VALUE GOES EMPTY. If the wire UA ever becomes an env read, an unset
//      or blank variable in one environment sends the request bare. Silent, and
//      in the one place nobody would look, because the fix "is already shipped".
//      This is the single most important assertion in the file.
//   2. THE HEADER STOPS BEING SENT. A refactor of the fetch init drops it.
//      Nothing breaks. The feed just stops answering.
//   3. GNEWS ACQUIRES ONE. Google News works UA-less today and NOTHING measured
//      says what it does with a UA attached. Adding one "for consistency" would
//      be an unmeasured edit to the only leg currently carrying the page.
//   4. THE STRING DRIFTS FROM THE MEASURED ONE. A measurement is evidence only
//      for the thing measured.
import assert from "node:assert";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const loadTs = async (source, tag) => {
  const file = path.join(ROOT, `.check-${tag}.mjs`);
  fs.writeFileSync(file, ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText);
  try { return await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
  finally { fs.unlinkSync(file); }
};

// THE REAL MODULE, not a transcription of it. It has no imports, so there is
// nothing to inline and nothing to get wrong in the inlining.
const uaSrc = read("lib/server/news/userAgent.ts");
assert(!/^import /m.test(uaSrc), "userAgent.ts grew an import; this harness assumes it has none");
const ua = await loadTs(uaSrc, "news-ua");

/** Run fn with the named env vars forced to `value` (or deleted), then restore. */
function withEnv(pairs, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(pairs)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

console.log("\n=== 1. THE VALUE CAN NEVER BE EMPTY — the assertion this file exists for ===\n");

// BEHAVIOURAL, NOT TEXTUAL. A regex saying "there is a fallback" passes against
// a fallback that is itself an env read. These call the real functions under the
// environments that actually occur: unset, empty, and the whitespace a cleared
// dashboard field leaves behind.
const EMPTY_ENVS = [
  ["unset", undefined],
  ["empty string", ""],
  ["whitespace", "   "],
];

for (const [label, value] of EMPTY_ENVS) {
  const got = withEnv({ NEWS_USER_AGENT: value, SEC_USER_AGENT: value }, () => ua.newsUserAgent());
  check(
    `newsUserAgent() is non-empty when every env var is ${label}`,
    typeof got === "string" && got.trim().length > 0,
    "an empty UA is a 20-second tarpit with no error and no log line"
  );
}
for (const [label, value] of EMPTY_ENVS) {
  const got = withEnv({ SEC_USER_AGENT: value, NEWS_USER_AGENT: value }, () => ua.secUserAgent());
  check(
    `secUserAgent() is non-empty when SEC_USER_AGENT is ${label}`,
    typeof got === "string" && got.trim().length > 0,
    "sec.gov's fair-access policy asks for identification; whitespace is not identification"
  );
}

// STRUCTURAL, so the guarantee does not rest on today's happening-to-be-true.
// The wire UA reads no environment at all: that is the design, and it is the
// design precisely because an env read is the mechanism that can go missing.
const uaCode = readCodeOnly("lib/server/news/userAgent.ts");
const newsFnBody = uaCode.split("export function newsUserAgent")[1]?.split("export function")[0] ?? "";
check(
  "newsUserAgent() reads no environment variable at all",
  newsFnBody.length > 0 && !/process\.env/.test(newsFnBody),
  "configurability here buys nothing and costs a silent outage when it is blank"
);
check(
  "the constant itself is a literal, not derived from process.env",
  /export const NEWS_USER_AGENT\s*=\s*\n?\s*"/.test(uaCode) &&
    !/export const NEWS_USER_AGENT[^;]*process\.env/.test(uaCode),
  "a constant that reads the environment is an env read wearing a constant's name"
);
check(
  "secUserAgent() trims before falling through",
  /process\.env\.SEC_USER_AGENT\?\.trim\(\)\s*\|\|/.test(uaCode),
  'a variable set to " " is truthy; without the trim it would be sent as the identification'
);

console.log("\n=== 2. THE STRING IS THE ONE THAT WAS MEASURED ===\n");

// Cell D of the 2x2: revalidate:3600 + this exact string -> 183ms, HTTP 200,
// 33,031 bytes. Pinned verbatim, because a measurement is evidence only for the
// thing that was measured.
const MEASURED = "MyStockHarbor/1.0 (+https://www.mystockharbor.com; contact sonnybrindle@mystockharbor.com)";
check(
  "NEWS_USER_AGENT is byte-identical to the string measured at 183ms/200",
  ua.NEWS_USER_AGENT === MEASURED,
  "shipping a tidied variant ships something nobody measured"
);
check(
  "...and it identifies honestly rather than impersonating a browser",
  /^MyStockHarbor\//.test(ua.NEWS_USER_AGENT) && !/Mozilla|Chrome|Safari|AppleWebKit/i.test(ua.NEWS_USER_AGENT),
  "the fix is to declare who we are, not to pretend to be someone else"
);

console.log("\n=== 3. THE HEADER IS ACTUALLY SENT ON THE WIRE FETCH ===\n");

// Anchored on the fetch CALL, not on the file: a `newsUserAgent` mentioned
// anywhere in wireProvider.ts would satisfy a whole-file regex while the fetch
// went out bare. The init object is read from the call site outwards.
const wireCode = readCodeOnly("lib/server/news/wireProvider.ts");
const atFetch = wireCode.slice(wireCode.indexOf("fetch(source.url"));
const fetchInit = atFetch.slice(0, 260);
check(
  "the wire fetch exists and is the only one in the adapter",
  wireCode.indexOf("fetch(source.url") >= 0 &&
    (wireCode.match(/\bfetch\(/g) || []).length === 1,
  "a second fetch would need its own header and this assertion would not see it"
);
check(
  "the wire fetch sends a user-agent header",
  /"user-agent":\s*newsUserAgent\(\)/.test(fetchInit),
  "without it globenewswire returns zero bytes for the full adapter budget"
);
check(
  "...and it still uses the render's cache mode",
  /next:\s*\{\s*revalidate:\s*3600\s*\}/.test(fetchInit),
  "cell D measured the header against revalidate:3600 specifically"
);
check(
  "the adapter imports the shared constant rather than inlining a second literal",
  /import \{ newsUserAgent \} from "\.\/userAgent"/.test(wireCode) &&
    !/MyStockHarbor\/1\.0/.test(wireCode),
  "two copies of a UA string is two strings that drift"
);

console.log("\n=== 4. GNEWS IS LEFT ALONE — the leg currently carrying the page ===\n");

// NOT tidiness. Google News answers UA-less today and nothing measured says what
// it does with one attached. Adding a header there would be an unmeasured edit
// to the only source the page currently depends on, which is how a working leg
// becomes the next two-day diagnosis.
const gnewsCode = readCodeOnly("lib/server/news/gnewsProvider.ts");
check(
  "the gnews harness is reading real code, not an over-stripped file",
  /fetch\(/.test(gnewsCode) && gnewsCode.length > 500,
  "a negative assertion against an empty string passes for the wrong reason"
);
check(
  "the gnews fetch sends NO user-agent",
  !/user-agent/i.test(gnewsCode),
  "untested change to the one leg the page currently depends on — measure before touching it"
);

console.log("\n=== 5. SEC KEEPS ITS VARIABLE, LOSES ITS DUPLICATE LITERAL ===\n");

const secCode = readCodeOnly("lib/server/news/secProvider.ts");
check(
  "secProvider no longer carries its own default UA literal",
  !/MyStockHarbor\/1\.0/.test(secCode),
  "one string to keep truthful, not two that drift"
);
check(
  "...and its fetch sends the derived value",
  /"user-agent":\s*secUserAgent\(\)/.test(secCode),
  "sec.gov's fair-access policy asks for identification"
);
check(
  "SEC_USER_AGENT still wins where it is set",
  withEnv({ SEC_USER_AGENT: "Operator/9.9 (ops@example.com)" }, () => ua.secUserAgent()) ===
    "Operator/9.9 (ops@example.com)",
  "the address sec.gov publishes must be changeable without a deploy — that is why this one variable stays"
);
check(
  "the wire UA is NOT overridable by the same variable",
  withEnv({ SEC_USER_AGENT: "Operator/9.9 (ops@example.com)" }, () => ua.newsUserAgent()) === MEASURED,
  "coupling the wires to sec.gov's contact variable would let one requirement break the other"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
