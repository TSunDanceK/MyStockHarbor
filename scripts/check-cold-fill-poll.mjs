// THE COLD FILL SWAPS ITS DATA IN BY ITSELF (#552 COWORK #46, AXTI).
//
// Runs the SHIPPED controller (app/stock/[symbol]/coldFillPoll.ts) on a
// virtual clock, with the request, the status poll, the refresh and the
// notice as recorders:
//   1. A 45-second fill: "reading", then "still reading" at 20s, then — with
//      no manual refresh — a soft refresh and "SEC data loaded" once the store
//      has the set. MUTATION: the auto-swap removed must fail this.
//   2. The give-up path: nothing lands → "Taking longer than expected" at the
//      ceiling, polls counted (the Redis cost), Refresh (retry) refreshes and
//      polls again.
//   3. A hidden tab does not poll, and resumes when visible.
//   4. A bot refusal and the plain refusals do not poll; a quick fill lands at once.
//   5. The component wires it: the status action is a no-store server action
//      with one EXISTS; the notice lives in the layout; the token is a ref.
//
//   node scripts/check-cold-fill-poll.mjs
import fs from "node:fs";
import { lift } from "./lib/earnings-plan.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const POLL_SRC = fs.readFileSync("app/stock/[symbol]/coldFillPoll.ts", "utf8").replace(/^import type[^;]+;$/gm, "");
const load = (src, name) => lift(src, "", name);
const P = await load(POLL_SRC, "coldFillPoll");

/** A virtual clock: timers fire in order, with the promise queue drained between. */
function harness(M, { requestAt = 12_000, step = { kind: "poll" }, readyAt = Infinity, statusThrows = false } = {}) {
  let t = 0, seq = 0;
  const timers = new Map();
  const log = { views: [], refresh: [], announce: [], status: [], hiddenPolls: 0 };
  let hidden = false, visibleFn = null;
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const d = {
    request: () => new Promise((res) => { timers.set(++seq, { at: requestAt, fn: () => res(step) }); }),
    status: async () => {
      if (hidden) log.hiddenPolls++;
      log.status.push(t);
      if (statusThrows) throw new Error("redis");
      return t >= readyAt;
    },
    refresh: () => log.refresh.push(t),
    announce: () => log.announce.push(t),
    view: (v) => log.views.push([t, v]),
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
    hidden: () => hidden,
    onVisible: (fn) => { visibleFn = fn; return () => { visibleFn = null; }; },
  };
  const run = M.runColdFill(d);
  const advance = async (to) => {
    await flush();
    for (;;) {
      const next = [...timers.entries()].filter(([, x]) => x.at <= to).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
      await flush();
    }
    t = to;
    await flush();
  };
  const viewAt = (at) => { let v = null; for (const [w, x] of log.views) if (w <= at) v = x; return v; };
  return { run, log, advance, viewAt, setHidden: async (h) => { hidden = h; if (!h && visibleFn) visibleFn(); await flush(); } };
}

console.log("1. a 45-second fill swaps itself in");
async function slowFill(M) {
  const h = harness(M, { readyAt: 45_000 });
  await h.advance(10_000);
  const at10 = h.viewAt(10_000);
  await h.advance(25_000);
  const at25 = h.viewAt(25_000);
  await h.advance(70_000);
  return { h, at10, at25 };
}
{
  const { h, at10, at25 } = await slowFill(P);
  check("reading at 10s", at10 === "reading", at10);
  check("still reading at 25s (after 20s)", at25 === "still", at25);
  check("one soft refresh, by itself, once the store has the set (45s ≤ t ≤ 45s + one backoff step)",
    h.log.refresh.length === 1 && h.log.refresh[0] >= 45_000 && h.log.refresh[0] <= 45_000 + P.POLL_BACKOFF_MS.at(-1), JSON.stringify(h.log.refresh));
  check("and 'SEC data loaded' announced with it", h.log.announce.length === 1 && h.log.announce[0] === h.log.refresh[0], JSON.stringify(h.log.announce));
  check("the view says loaded", h.viewAt(h.log.refresh[0]) === "loaded");
  check("polls back off 2s → 4s → 8s (capped) after the 12s reply", JSON.stringify(h.log.status.slice(0, 6)) === JSON.stringify([14_000, 18_000, 26_000, 34_000, 42_000, 50_000]), JSON.stringify(h.log.status));
  check(`Redis cost of this fill: ${h.log.status.length} EXISTS`, h.log.status.length === 6);
  const words = (v) => P.coldFillWords(v, "AXTI", { reading: "x", slow: "x", none: "x", waiting: "x" });
  check("the still-working words name the ticker", words("still") === "Still reading AXTI's SEC filings; this can take up to a minute for a company we haven't loaded before.", words("still"));
  check("the give-up words", words("gave-up") === "Taking longer than expected.");

  // AXTI EXACTLY: the reply lands just after the 12s ceiling; the first poll finds the set.
  const ax = harness(P, { readyAt: 12_100 });
  await ax.advance(30_000);
  check("AXTI's shape (filled at ~12.1s, reply discarded by the ceiling) → refreshed at the first poll, 14s, 1 EXISTS",
    JSON.stringify(ax.log.refresh) === "[14000]" && ax.log.status.length === 1, JSON.stringify([ax.log.refresh, ax.log.status]));

  const M = await load(once(POLL_SRC, "    d.refresh();\n    d.announce();\n", "    d.announce();\n"), "coldFillPoll-no-swap");
  const m = await slowFill(M);
  check("MUTATION: no auto-swap → the 45s fill never refreshes (caught)", m.h.log.refresh.length === 0, JSON.stringify(m.h.log.refresh));
}

console.log("\n2. the give-up path");
{
  const h = harness(P);
  await h.advance(P.POLL_GIVE_UP_MS + 20_000);
  const gaveAt = h.log.views.find(([, v]) => v === "gave-up")?.[0];
  check(`"Taking longer than expected" at the ${P.POLL_GIVE_UP_MS / 1000}s ceiling, not before`, gaveAt >= P.POLL_GIVE_UP_MS && gaveAt <= P.POLL_GIVE_UP_MS + 8_000, String(gaveAt));
  const n = h.log.status.length;
  check(`polling stops there: ${n} EXISTS for a fill that never lands (≤ 20)`, n <= 20 && h.log.status.every((x) => x <= gaveAt), JSON.stringify(h.log.status));
  await h.advance(P.POLL_GIVE_UP_MS + 200_000);
  check("…and no poll after giving up", h.log.status.length === n);
  check("no refresh or notice on the way", h.log.refresh.length === 0 && h.log.announce.length === 0);
  h.run.retry();
  await h.advance(P.POLL_GIVE_UP_MS + 200_000 + 1);
  check("Refresh, not stored yet: says reading and polls again at once", h.log.refresh.length === 0 && h.viewAt(P.POLL_GIVE_UP_MS + 200_001) === "reading" && h.log.status.length === n + 1,
    JSON.stringify([h.log.refresh, h.log.status.length]));
  const s2 = harness(P, { readyAt: P.POLL_GIVE_UP_MS + 100_000 });
  await s2.advance(P.POLL_GIVE_UP_MS + 120_000);
  s2.run.retry();
  await s2.advance(P.POLL_GIVE_UP_MS + 120_001);
  check("Refresh, stored by now: lands at once — soft refresh AND the notice", s2.log.refresh.length === 1 && s2.log.announce.length === 1, JSON.stringify([s2.log.refresh, s2.log.announce]));
  const e = harness(P, { statusThrows: true });
  await e.advance(P.POLL_GIVE_UP_MS + 20_000);
  check("a status check that keeps failing also ends on Refresh, never a silent spinner", e.log.views.some(([, v]) => v === "gave-up"));
}

console.log("\n3. a hidden tab does not poll");
{
  const h = harness(P, { readyAt: 60_000 });
  await h.advance(15_000); // first poll at 14s
  await h.setHidden(true);
  await h.advance(90_000);
  const whileHidden = h.log.status.filter((x) => x > 15_000 && x <= 90_000).length;
  check("no status call while hidden", h.log.hiddenPolls === 0 && whileHidden === 0, JSON.stringify(h.log.status));
  await h.setHidden(false);
  check("visible again → polls at once and lands", h.log.status.includes(90_000) && JSON.stringify(h.log.refresh) === "[90000]", JSON.stringify([h.log.status, h.log.refresh]));
}

console.log("\n4. what does not poll");
for (const [name, step, want] of [
  ["BotID's bot verdict", { kind: "phase", phase: "slow" }, "slow"],
  ["no usable data", { kind: "phase", phase: "none" }, "none"],
  ["a plain refusal", { kind: "phase", phase: "waiting" }, "waiting"],
]) {
  const h = harness(P, { step, requestAt: 3_000 });
  await h.advance(200_000);
  check(`${name} → "${want}", no poll, no refresh`, h.viewAt(200_000) === want && h.log.status.length === 0 && h.log.refresh.length === 0, JSON.stringify(h.log.views));
}
{
  const h = harness(P, { step: { kind: "filled" }, requestAt: 4_000 });
  await h.advance(5_000);
  check("a quick fill lands on its own reply: refresh + notice at 4s, no poll", JSON.stringify(h.log.refresh) === "[4000]" && h.log.announce.length === 1 && h.log.status.length === 0);
  await h.advance(4_000 + P.LANDED_GRACE_MS + 1);
  check("still mounted after the grace (the refresh came back cold) → Refresh offered", h.viewAt(20_000) === "gave-up");
}

console.log("\n5. the wiring");
{
  const ui = readCodeOnly("app/stock/[symbol]/ColdFill.tsx");
  check("the component runs the shipped controller", /runColdFill\(\{/.test(ui));
  check("…the fill request still goes through settleColdFill", /settleColdFill\(\(\) => requestColdFill\(symbol, tokenRef\.current\)\)/.test(ui) && (ui.match(/requestColdFill\(/g) ?? []).length === 1);
  check("…refresh is router.refresh() (soft, scroll kept), never a reload", /refresh: \(\) => router\.refresh\(\)/.test(ui) && !/location\.reload/.test(ui));
  check("…the token is a ref, not an effect dependency (a still-cold refresh must not restart the fill)", /\}, \[symbol, router\]\);/.test(ui));
  check("…visibility drives pause/resume", /document\.visibilityState === "hidden"/.test(ui) && /visibilitychange/.test(ui));
  check("…Refresh is a button calling retry()", /<button type="button"[^>]*onClick=\{\(\) => run\.current\?\.retry\(\)\}>Refresh<\/button>/.test(ui));
  const action = readCodeOnly("app/stock/[symbol]/coldFillAction.ts");
  const status = action.slice(action.indexOf("export async function coldFillStatus"));
  check("the status check is a server action (POST: never a CDN or ISR copy)", /^"use server";/m.test(fs.readFileSync("app/stock/[symbol]/coldFillAction.ts", "utf8")) && status.length > 0);
  check("…ONE EXISTS, behind the free gates, no BotID/counter/lock", (status.match(/await /g) ?? []).length === 1 && /factSetExists\(clean\)/.test(status) &&
    !/checkBotId|countColdFill|takeColdFillLock/.test(status));
  const layout = readCodeOnly("app/stock/[symbol]/layout.tsx");
  check("the notice is mounted in the layout (it outlives the block the refresh replaces)", /<SecLoadedNotice \/>/.test(layout));
  const notice = readCodeOnly("app/components/SecLoadedNotice.tsx");
  check("…a polite live region that is always in the DOM", /role="status" aria-live="polite"/.test(notice) && !/visible \? <div/.test(notice));
}

if (failures) { console.log(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nALL CHECKS PASSED");
