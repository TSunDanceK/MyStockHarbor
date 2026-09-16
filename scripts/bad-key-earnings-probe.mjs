// DOES /stock/[symbol]/earnings STILL SERVE WITH FMP UNAVAILABLE? — run, not read.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
// The audit claimed the page degrades rather than fails when FMP is down,
// because `fetchFmpJson` returns null on `!res.ok` and on throw and every
// consumer handles null. THAT IS READING, NOT PROVING. The owner's instruction
// was explicit: prove by running with a bad key, not by reading.
//
// ── WHAT IT ACTUALLY DOES ─────────────────────────────────────────────────
//   1. next build with the runner's env (Upstash present, no FMP key)
//   2. next start, twice, with a DIFFERENT FMP condition each time
//   3. GET /stock/AAPL/earnings and assert the same three things both times
//
// TWO CONDITIONS, BECAUSE THEY ARE DIFFERENT BRANCHES. `fetchFmpJson` returns
// null at `if (!apiKey)` when the key is ABSENT and at `if (!response.ok)` when
// the key is present and REJECTED. A probe testing only the first would pass
// while the second 500s, and the second is the one that happens in production.
//
// THE BUILD IS NOT THE SUBJECT. It runs with whatever env the runner has; a
// build failure is reported as a build failure and never as "the page is
// broken" — claude/CLAUDE.md records why that distinction matters here.
//
// Credentialled (Upstash) because the build needs it. Performs NO writes: it
// starts the app and issues GETs. The `write-` prefix in this repo means "has
// credentials", which check-relay-isolation asserts, not "mutates".
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const PORT = Number(process.env.PROBE_PORT || 3123);
const SYMBOL = (process.env.SYMBOLS || "AAPL").split(/[,\s]+/).filter(Boolean)[0] ?? "AAPL";
const PATHNAME = `/stock/${SYMBOL}/earnings`;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── WHAT THE PAGE MUST STILL SAY ──────────────────────────────────────────
// Read from the shipped source rather than retyped, so a copy edit moves this
// probe with it instead of turning it red. A hardcoded sentence here would be a
// second copy that goes stale the first time the wording is improved.
const PAGE_SRC = fs.readFileSync("app/stock/[symbol]/earnings/page.tsx", "utf8");
const pick = (re, label) => {
  const m = PAGE_SRC.match(re);
  if (!m) { console.error(`FATAL: could not read ${label} from the page source`); process.exit(2); }
  return m[1];
};
// The price-reaction card's no-history branch — what an FMP outage produces.
const FALLBACK = pick(/<p>(Not enough price history[^<]*?)<\/p>/, "the price-reaction fallback")
  .replace(/&apos;/g, "'").replace(/&mdash;/g, "—").trim();
// ── AND SOMETHING SEC-DERIVED, WHICH MUST STILL BE THERE ─────────────────
// A page that 200s with the fallback and nothing else is not degrading
// gracefully, it is empty.
//
// STATIC STRINGS ONLY, and that is not fussiness. The obvious marker was the
// "Recent reported quarters" heading — but its source is
// `<h2>Recent reported {w.many}</h2>`, and React's SSR output puts a `<!-- -->`
// marker between the literal and the interpolation. `includes("Recent reported
// quarters")` would have failed on a page that rendered it perfectly. Every
// string below is a whole text node in the source with no interpolation in it.
const SEC_MARKERS = ["Quality of earnings", "Balance sheet", "Income statement"];

console.log(`probing ${PATHNAME} on :${PORT}`);
console.log(`fallback string: ${JSON.stringify(FALLBACK)}`);
console.log(`SEC markers: ${SEC_MARKERS.join(" | ")}\n`);
// THE MARKERS MUST BE LITERAL IN THE SOURCE, or the probe is asserting strings
// no render can produce. Checked here rather than trusted, because that is
// exactly the mistake the comment above records.
for (const m of SEC_MARKERS) {
  const inCards = fs.readFileSync("app/stock/[symbol]/earnings/SecEarningsCards.tsx", "utf8");
  if (!inCards.includes(`>${m}</`)) {
    console.error(`FATAL: "${m}" is not a whole text node in SecEarningsCards.tsx`);
    process.exit(2);
  }
}

console.log("0. build");
const build = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
if (build.status !== 0) {
  // NOT A PAGE FAILURE, and saying so is the point. A build that cannot finish
  // on this runner says nothing about whether the page degrades.
  console.error(
    `\nFATAL: next build exited ${build.status}. This probe cannot run, and this is ` +
      `NOT evidence that the earnings page is broken — see claude/CLAUDE.md on ` +
      `local build failures.`
  );
  process.exit(2);
}
console.log("  build OK\n");

/**
 * Start the server, wait for it to answer, run `fn`, always kill it.
 *
 * ── THE ISR CACHE IS CLEARED FIRST, AND THAT IS THE WHOLE POINT ──────────
 *
 * /stock/[symbol]/earnings inherits `revalidate = 3600`. `next start` reads and
 * writes that cache under .next/cache, and the directory SURVIVES a restart —
 * so the second condition would be served the FIRST condition's HTML without
 * rendering anything, and would pass while testing nothing.
 *
 * The first run of this probe returned 210409 bytes under both conditions.
 * Identical sizes are what you would expect either way — both conditions make
 * fetchFmpJson return null, so a genuine render produces the same page — which
 * is precisely why byte-equality could not settle it and why the cache is now
 * removed rather than reasoned about.
 */
async function withServer(label, env, fn) {
  fs.rmSync(".next/cache", { recursive: true, force: true });
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: { ...process.env, ...env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += String(d); });
  child.stderr.on("data", (d) => { log += String(d); });
  try {
    // POLL, don't sleep: a fixed wait is either flaky or slow, and this has to
    // run twice.
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (Date.now() > deadline) throw new Error(`server did not start in 90s\n${log.slice(-2000)}`);
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/health`).catch(() => null);
        if (r) break;
        const root = await fetch(`http://127.0.0.1:${PORT}/`).catch(() => null);
        if (root) break;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    return await fn(() => log);
  } finally {
    child.kill("SIGTERM");
    // Give it a moment to release the port before the next condition binds it.
    await new Promise((r) => setTimeout(r, 1500));
    child.kill("SIGKILL");
  }
}

const CONDITIONS = [
  // The key is present and the upstream rejects it — an expired or revoked key,
  // which is what actually happens in production.
  { label: "FMP_API_KEY present but invalid", env: { FMP_API_KEY: "deliberately-invalid-key-for-this-probe" } },
  // The key is absent entirely — a missing env var on a new deployment.
  { label: "FMP_API_KEY absent", env: { FMP_API_KEY: "" } },
];

for (const cond of CONDITIONS) {
  console.log(`\n${cond.label}`);
  await withServer(cond.label, cond.env, async (getLog) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${PATHNAME}`, { redirect: "manual" });
    const body = await res.text();
    // A MISS PROVES THIS CONDITION RENDERED. Next sets x-nextjs-cache on an
    // ISR route; MISS means the HTML was produced by THIS server under THIS
    // env, not read from a cache the previous condition warmed.
    const cacheState = res.headers.get("x-nextjs-cache") ?? "(absent)";
    check("the response was rendered, not served from the previous condition",
      cacheState !== "HIT",
      `x-nextjs-cache: ${cacheState}`);
    check("the page returns 200", res.status === 200,
      `HTTP ${res.status}${res.status !== 200 ? `\n${getLog().slice(-1500)}` : ""}`);
    check("...and it is not Next's error page",
      !/Application error: a server-side exception|Internal Server Error/i.test(body),
      `${body.length} bytes`);
    const present = SEC_MARKERS.filter((m) => body.includes(m));
    check("the SEC-derived cards are still there",
      present.length === SEC_MARKERS.length,
      present.length === SEC_MARKERS.length
        ? present.join(", ")
        : `missing ${SEC_MARKERS.filter((m) => !present.includes(m)).join(", ")} — ` +
          `a 200 with no content is not graceful degradation`);
    check("the price-reaction card shows its no-history fallback",
      body.includes(FALLBACK),
      body.includes(FALLBACK) ? "present" : "MISSING — the card rendered as if it had data");
  });
}

console.log(
  failures
    ? `\n${failures} assertion(s) failed.`
    : `\nThe earnings page serves ${PATHNAME} with FMP unavailable, both ways.\n`
);
process.exit(failures ? 1 : 0);
