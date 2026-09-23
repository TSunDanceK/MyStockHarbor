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
  "\nexport { reportDatesQueue, carryEventQueued, STALE_CUT_DAYS };");
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

console.log("\n3. earnings season: tier 1 over the cap");
{
  // 150 tier-1 symbols against a cap of 100. Names are chosen so that
  // alphabetical order would put the cut members and MU LAST: "A…" fillers
  // sort first, the cut is late-alphabet.
  const CUT = ["MU", "NVDA", "TSLA", "XOM", "ZTS"];
  const big = {};
  const eventQueued = new Set();
  for (let i = 0; i < 145; i++) {
    const s = `A${String(i).padStart(3, "0")}`;
    // Half with a recent record, half never written; 20 are event-queued re-reads.
    big[s] = { cik: "1", reportDatesAt: i % 2 ? NOW - 2 * day : undefined, lastEventFiled: i < 125 ? "20260923" : null };
    if (i >= 125) eventQueued.add(s);
  }
  for (const s of CUT) big[s] = { cik: "1", reportDatesAt: NOW - 3 * day, lastEventFiled: "20260923" };
  const args = { entries: big, eventQueued, cut: CUT, changedThisRun: [], limit: 100, now: NOW };
  const r1 = Q.reportDatesQueue(args);
  check("tier 1 is 150 before the cap", r1.tier1 === 150, String(r1.tier1));
  check("every due-strip member is in the 100", CUT.every((s) => r1.queue.includes(s)), JSON.stringify(r1.queue.slice(0, 8)));
  check("...and they lead it", JSON.stringify(r1.queue.slice(0, 5).sort()) === JSON.stringify([...CUT].sort()));
  check("MU is present", r1.queue.includes("MU"));
  check("never-written records come before recently written ones",
    (() => { const rest = r1.queue.slice(5); const firstWritten = rest.findIndex((s) => big[s].reportDatesAt);
      return firstWritten > 0 && rest.slice(firstWritten).every((s) => big[s].reportDatesAt); })());
  check("no alphabetical order: the queue is not sorted by name",
    JSON.stringify(r1.queue) !== JSON.stringify([...r1.queue].sort()));

  // Run 1 writes its 100 and carries the event-queued symbols it left out.
  const leftOut = [...eventQueued].filter((s) => !r1.queue.includes(s));
  check("the cap left some event-queued symbols out (the case under test)", leftOut.length > 0, String(leftOut.length));
  for (const s of r1.queue) big[s].reportDatesAt = NOW;
  const carried = Q.carryEventQueued(big, eventQueued, new Set(r1.queue), "20260924");
  check("carryEventQueued stamps exactly the left-out ones", JSON.stringify(carried.sort()) === JSON.stringify(leftOut.sort()));
  // Run 2, next day: the needsReverify flag is gone, so eventQueued is empty.
  const r2 = Q.reportDatesQueue({ ...args, eventQueued: new Set(), now: NOW + day });
  check("run 2: every left-out event-queued symbol is still in tier 1",
    leftOut.every((s) => r2.queue.includes(s)), `${leftOut.filter((s) => !r2.queue.includes(s)).length} missing`);
  check("...and nothing written in run 1 comes back", !r1.queue.some((s) => r2.queue.includes(s)));

  // MUTATIONS OF THE ORDER
  const alpha = await load((s) => s.replace(".map(({ s }) => s);\n  const tier2", ".map(({ s }) => s).sort();\n  const tier2"));
  const ra = alpha.reportDatesQueue(args);
  check("MUTATION: alphabetical tier 1 cuts the late-alphabet due strip (MU)",
    !ra.queue.includes("MU") && CUT.some((s) => !ra.queue.includes(s)));
  const noCutFirst = await load((s) => s.replace("Number(onCut.has(b.s)) - Number(onCut.has(a.s)) || ", ""));
  check("MUTATION: dropping cut-first lets never-written fillers push the strip out",
    !CUT.every((s) => noCutFirst.reportDatesQueue(args).queue.slice(0, 5).includes(s)));
  const noCarry = await load((s) => s.replace("if (!e.lastEventFiled || e.lastEventFiled < todayYmd) e.lastEventFiled = todayYmd;", ""));
  const big2 = JSON.parse(JSON.stringify(big));
  for (const s of leftOut) big2[s].lastEventFiled = null;
  noCarry.carryEventQueued(big2, eventQueued, new Set(r1.queue), "20260924");
  check("MUTATION: without the carry the left-out re-reads vanish on run 2",
    !leftOut.some((s) => noCarry.reportDatesQueue({ ...args, entries: big2, eventQueued: new Set(), now: NOW + day }).queue.includes(s)));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failures ? 1 : 0);
