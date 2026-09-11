// The delisting sweep must read bar stamps the SAME morning's producer wrote.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE DIAGNOSIS THIS LOCKS DOWN, AFTER TWO WRONG ONES.
//
// warm-screener-fundamentals logged `barStampsRead 0` on 2026-09-05. That was
// first read as "the stale-bar eviction is inert", then as "a TTL race with a
// twelve-minute margin". Both are wrong, and the second is wrong in a way the
// source states outright: the stamp hash carries NO TTL (historyCache.ts, "The
// fields carry no TTL of their own"). There is no expiry to race.
//
// The 09-05 zero was the deploy-day artifact. #417 merged at 09:38 on 09-04 --
// after that day's 07:02 producer run -- so the first stamps were written at
// 07:02 on 09-05, twelve minutes after the 06:50 sweep that read none. Once, by
// construction.
//
// THE TWELVE MINUTES ARE REAL AND THEY LIVE SOMEWHERE ELSE. The binding
// constraint is EVICTION_BAR_STAMP_MAX_AGE_MS (48h), the observation-age guard.
// At 06:50 the sweep consumed stamps written at 07:02 the PREVIOUS day --
// 23h48m. One missed producer run makes them 47h48m: twelve minutes inside the
// guard. A single failed picker build and the stale-bar signal silently
// vanishes, which is exactly the blindness `barStampsRead` exists to expose and
// which a count of 0 cannot distinguish from "nothing is dead".
//
// SO THE RULE IS A MARGIN, NOT A PAIR OF CRON STRINGS, and it is COMPUTED here
// from vercel.json and the real constant rather than asserted as two times.
// Moving either cron re-runs the arithmetic; nobody has to remember what the
// other one is.
//
//   node scripts/check-bar-stamp-ordering.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const eviction = readCodeOnly("lib/server/symbolEviction.ts");
const historySrc = readCodeOnly("lib/server/historyCache.ts");
const sweep = readCodeOnly("app/api/jobs/warm-screener-fundamentals/route.ts");
const producerRoute = readCodeOnly("app/api/jobs/warm-picker-universe/route.ts");
const jobs = readCodeOnly("lib/server/jobRuns.ts");
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

const PRODUCER = "/api/jobs/warm-picker-universe";
const CONSUMER = "/api/jobs/warm-screener-fundamentals";

const cronFor = (p) => (vercel.crons ?? []).find((c) => c.path === p)?.schedule ?? "";
/** A cron expression is mostly regex metacharacters. Escaped before matching. */
const rx = (literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Minutes past midnight UTC for a DAILY cron, or null for anything else.
 *
 * NULL RATHER THAN A GUESS. The margin arithmetic below is only meaningful for
 * two jobs that each fire once a day at a fixed time; an `*` or a step in
 * either field means the model does not apply and the check must say so rather
 * than quietly computing a number from a field it misread.
 */
const dailyMinutes = (expr) => {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
  return Number(hour) * 60 + Number(min);
};

const maxAgeMs = Number(
  (eviction.match(/EVICTION_BAR_STAMP_MAX_AGE_MS = ([0-9 *]+);/) ?? [])[1]
    ? Function(
        `"use strict"; return (${(eviction.match(/EVICTION_BAR_STAMP_MAX_AGE_MS = ([0-9 *]+);/) ?? [])[1]});`
      )()
    : 0
);
const producerAt = dailyMinutes(cronFor(PRODUCER));
const consumerAt = dailyMinutes(cronFor(CONSUMER));

if (!maxAgeMs || producerAt === null || consumerAt === null) {
  console.error(
    `FAIL: could not read the subject — EVICTION_BAR_STAMP_MAX_AGE_MS ${maxAgeMs}, ` +
      `producer cron "${cronFor(PRODUCER)}" -> ${producerAt}, consumer cron ` +
      `"${cronFor(CONSUMER)}" -> ${consumerAt}. Either a cron stopped being a ` +
      `fixed daily time, in which case this model no longer applies, or a name ` +
      `moved. This script would otherwise pass by measuring nothing.`
  );
  process.exit(1);
}

const DAY_MIN = 24 * 60;
const maxAgeMin = maxAgeMs / 60_000;

/**
 * How old the freshest stamp is when the consumer reads it, after `missed`
 * consecutive producer runs failed.
 *
 * Same-day when the producer fires first; otherwise the consumer is reading
 * yesterday's, which is a whole extra day of age before any run is missed at
 * all. That single branch is the entire content of the fix.
 */
const stampAgeMin = (missed) =>
  (consumerAt > producerAt ? consumerAt - producerAt : consumerAt - producerAt + DAY_MIN) +
  missed * DAY_MIN;

const fmt = (m) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}m`;

// ── 1. The ordering ────────────────────────────────────────────────────────
console.log("\n1. The consumer runs after the producer, on the same morning");

check(
  "warm-picker-universe fires before warm-screener-fundamentals",
  consumerAt > producerAt,
  consumerAt > producerAt
    ? `producer ${fmt(producerAt)} UTC, consumer ${fmt(consumerAt)} UTC`
    : `producer ${fmt(producerAt)} UTC is AFTER consumer ${fmt(consumerAt)} UTC — ` +
      `the sweep reads YESTERDAY's stamps and starts a day behind before anything ` +
      `has gone wrong`
);
check(
  "the producer has time to finish before the consumer starts",
  consumerAt - producerAt >= Math.ceil(Number((producerRoute.match(/maxDuration = (\d+)/) ?? [])[1] ?? 0) / 60),
  `${consumerAt - producerAt} minutes between them against a ` +
    `${(producerRoute.match(/maxDuration = (\d+)/) ?? [])[1]}s maxDuration — a ` +
    `consumer that starts mid-build reads a half-flushed hash`
);
check(
  "the JOBS registry agrees with vercel.json for both",
  new RegExp(`"warm-picker-universe":[^}]*cron: "${rx(cronFor(PRODUCER))}"`).test(jobs) &&
    new RegExp(`"warm-screener-fundamentals":[^}]*cron: "${rx(cronFor(CONSUMER))}"`).test(jobs),
  "the registry drives /cache-health's cadence column; a cron edited in one " +
    "place is a page that describes a schedule nothing runs"
);

// ── 2. The margin, which is the thing that was actually twelve minutes ─────
console.log("\n2. The signal survives a missed producer run");

check(
  "a normal morning reads stamps far inside the observation guard",
  stampAgeMin(0) < maxAgeMin,
  `${fmt(stampAgeMin(0))} old against a ${fmt(maxAgeMin)} guard`
);
check(
  "ONE missed producer run still leaves the signal readable",
  stampAgeMin(1) < maxAgeMin,
  `${fmt(stampAgeMin(1))} old against ${fmt(maxAgeMin)} — margin ` +
    `${fmt(maxAgeMin - stampAgeMin(1))}. At the old 06:50 this was 47h48m against ` +
    `48h: twelve minutes, and one failed picker build blinded the sweep with ` +
    `nothing but a 0 to show for it`
);
check(
  "the margin after one miss is at least a further half day",
  maxAgeMin - stampAgeMin(1) >= DAY_MIN / 2,
  `${fmt(maxAgeMin - stampAgeMin(1))} of slack — a margin measured in minutes is ` +
    `not a margin, it is the same race with a longer fuse`
);
// AND IT STILL GOES BLIND WHEN IT SHOULD. A guard that never fires is not a
// guard; two consecutive missed runs mean the stamps really are too old to
// decide a deletion on.
check(
  "two missed runs correctly blind it rather than evicting on stale evidence",
  stampAgeMin(2) >= maxAgeMin,
  `${fmt(stampAgeMin(2))} old — past the guard, so the sweep records ` +
    `barStampsRead and evicts nothing on this signal, which is the safe direction`
);

// ── 3. The wire is still connected at both ends ────────────────────────────
console.log("\n3. The producer writes what the consumer reads");

check(
  "the producer flushes the stamps and reports how many",
  /const barStampsWritten = await flushNewestBarStamps\(\);/.test(producerRoute) &&
    /barStampsWritten,/.test(producerRoute),
  "the other end of `barStampsRead`; a mismatch between the two is the whole " +
    "diagnostic"
);
check(
  "the consumer reads them and records the denominator",
  /await readNewestBarStamps\(\)/.test(sweep) && /sweep\.barStampsRead = stamps\.size;/.test(sweep),
  "`staleBarred: 0` against a hash nothing has written says nothing at all"
);
check(
  "the stamp hash still carries no TTL of its own",
  /redis\.hset\(NEWEST_BAR_STAMP_HASH, pending\);/.test(historySrc) &&
    !/NEWEST_BAR_STAMP_HASH[^)]*\bex:/.test(historySrc),
  "the second wrong diagnosis was a TTL race. There is no TTL — if one is ever " +
    "added, the margin above is no longer the only constraint and this check " +
    "needs a third term"
);

console.log(
  failures === 0
    ? "\nThe sweep reads this morning's stamps, and survives a morning without them.\n"
    : `\n${failures} assertion(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
