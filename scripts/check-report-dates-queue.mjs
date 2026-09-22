// The report-dates phase's queue is TIERED: filed since the record, then the
// stale due-strip cut, then everything else (review of #519, 2026-09-22).
//
//   node scripts/check-report-dates-queue.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const SRC = readCodeOnly("lib/server/secReportDatesWrite.ts");
const body = SRC.slice(SRC.indexOf("export const STALE_CUT_DAYS"));
const load = (mutate = (s) => s) => lift(mutate(body).replace(/export (const|function)/g, "$1") +
  "\nexport { reportDatesQueue, STALE_CUT_DAYS };");
const Q = await load();

const NOW = Date.parse("2026-09-24T04:20:00Z");
const day = 86_400_000;
const entries = {
  MU: { cik: "1", reportDatesAt: Date.parse("2026-09-20T04:20:00Z"), lastEventFiled: "20260923" },
  ZZZ: { cik: "1", reportDatesAt: Date.parse("2026-09-20T04:20:00Z"), lastEventFiled: "20260919" },
  ARM: { cik: "1", reportDatesAt: Date.parse("2026-09-24T04:21:00Z"), lastEventFiled: "20260924" },
  TSLA: { cik: "1", reportDatesAt: NOW - 10 * day },
  NVDA: { cik: "1", reportDatesAt: NOW - 1 * day },
  CHG: { cik: "1", reportDatesAt: NOW - 1 * day },
  NEW1: { cik: "1" },
  NOCIK: { cik: null, lastEventFiled: "20260923" },
  REV: { cik: "1", reportDatesAt: NOW - 1 * day },
};
const run = (mod, over = {}) => mod.reportDatesQueue({
  entries, eventQueued: new Set(["REV"]), cut: ["TSLA", "NVDA", "MU"], changedThisRun: ["CHG"], limit: 100, now: NOW, ...over,
});
const got = run(Q);
console.log("\n1. the order");
check("tier 1: filed since the record (MU), plus a symbol re-read for an 8-K/6-K (REV)",
  JSON.stringify(got.queue.slice(0, 2)) === JSON.stringify(["MU", "REV"]), JSON.stringify(got.queue));
check("...not a filing older than the record (ZZZ), nor one already written today (ARM)",
  !got.queue.slice(0, got.tier1).includes("ZZZ") && !got.queue.includes("ARM"));
check("tier 2: a due-strip record older than STALE_CUT_DAYS (TSLA), not a fresh one (NVDA)",
  got.queue[2] === "TSLA" && !got.queue.includes("NVDA"), JSON.stringify(got.queue));
check("tier 3: changed this run, then the never-written backfill",
  JSON.stringify(got.queue.slice(3)) === JSON.stringify(["CHG", "NEW1"]), JSON.stringify(got.queue.slice(3)));
check("no CIK, never queued", !got.queue.includes("NOCIK"));
check("a symbol in two tiers appears once (MU is filed-since AND on the cut)",
  got.queue.filter((s) => s === "MU").length === 1);
check("the cap applies after the tiers", JSON.stringify(run(Q, { limit: 2 }).queue) === JSON.stringify(["MU", "REV"]));

console.log("\n2. mutations are seen");
const flat = await load((s) => s.replace("[...new Set([...tier1, ...tier2, ...tier3])]", "[...new Set([...tier3, ...tier1, ...tier2])]"));
check("MUTATION: FIFO order (changed sets first) pushes MU off a 2-slot run",
  !run(flat, { limit: 2 }).queue.includes("MU"));
const noEvent = await load((s) => s.replace("if (eventQueued.has(s)) return true;", ""));
check("MUTATION: ignoring the pre-loop re-read capture drops REV out of tier 1",
  run(noEvent).queue.indexOf("REV") !== 1, JSON.stringify(run(noEvent).queue));
const everyCut = await load((s) => s.replace("(!at || now - at > STALE_CUT_DAYS * 86_400_000)", "true"));
check("MUTATION: rewriting the whole cut every run spends a slot on fresh NVDA",
  run(everyCut).queue.includes("NVDA"));

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
