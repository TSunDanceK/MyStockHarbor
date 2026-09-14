// P0 — has the empty-day poisoning already fired in production?
//
// THE SIGNATURE, all three parts required:
//   1. the date is flagged complete in msh:earnings-day-complete:v2
//   2. its msh:earnings-day-items:v1 blob is []
//   3. the month feed lists >= 1 candidate for that date
//
// Part 3 is the discriminator and the whole reason this is not a one-line grep.
// A date with an empty blob and NO candidates is a legitimate empty -- a weekend,
// a holiday, a day nobody reports. Only a date whose own month feed says
// companies report, while its stored rows say none do, is poisoned. Counting
// empty blobs alone would report every weekend in the window as a defect.
//
// READ-ONLY, AND NOT MERELY BY INTENT: this reads a frozen dump off disk and
// opens no connection to anything. The live read happened in the step 0 job,
// under Upstash's read-only token, where a write is refused by the server.
//
// ZERO IS A RESULT. If nothing matches, that is reported as a measured zero with
// the denominators that make it meaningful, never as silence.
import fs from "node:fs";
import path from "node:path";

const DUMP = process.argv[2] || process.env.DUMP_DIR || "";
if (!DUMP) {
  console.error("FATAL: no dump directory. Dispatch the relay with a run_id so the dump is downloaded.");
  process.exit(2);
}

const readJson = (name) => {
  const file = path.join(DUMP, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`FATAL: ${name} is present but unparseable: ${e.message}`);
    process.exit(1);
  }
};

// A MISSING FILE IS A FAILED MEASUREMENT, NOT AN EMPTY ONE. An older dump predates
// the date-keyed fix and carries `entries: 0` files that look like a clean result.
// Refuse rather than report a false all-clear.
const REQUIRED = ["earnings-day-items.json", "earnings-day-complete.json", "earnings-month-feed.json"];
const missing = REQUIRED.filter((f) => !fs.existsSync(path.join(DUMP, f)));
if (missing.length) {
  console.error(`FATAL: the dump is missing ${missing.join(", ")}.`);
  console.error(
    "This dump predates the date-keyed capture fix in scripts/step0-dump-ground-truth.mjs. " +
      "Its earnings files record present:false because the dump asked for a hash at a prefix " +
      "that is not a key -- an absence produced by the reader, not by the database. " +
      "Re-run Step 0 against a ref that carries the fix."
  );
  process.exit(1);
}

const items = readJson("earnings-day-items.json");
const complete = readJson("earnings-day-complete.json");
const feed = readJson("earnings-month-feed.json");
const frontier = readJson("earnings-fill-frontier.json");
const jobRuns = readJson("job-runs.json");

const itemsByDate = items?.values ?? {};
const itemTtls = items?.ttlSeconds ?? {};
const completeByDate = complete?.values ?? {};
const completeTtls = complete?.ttlSeconds ?? {};

// ── Candidates per date, from the month feed ────────────────────────────────
// Counted the way getMonthCandidates counts them: one entry per SYMBOL per month,
// not one per feed row. FMP repeats a symbol across nearby dates and the calendar
// collapses those, so counting rows would overstate a date's candidate count.
const candidatesByDate = new Map();
const monthsSeen = [];
for (const [month, raw] of Object.entries(feed?.values ?? {})) {
  monthsSeen.push(month);
  let rows = raw;
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { rows = null; }
  }
  if (!Array.isArray(rows)) {
    console.log(`[p0] WARN month feed ${month} is not an array (${typeof rows}) — skipped`);
    continue;
  }
  const seen = new Set();
  for (const r of rows) {
    const symbol = String(r?.symbol ?? "").trim().toUpperCase();
    const date = String(r?.date ?? "").slice(0, 10);
    if (!symbol || !date || seen.has(symbol)) continue;
    seen.add(symbol);
    candidatesByDate.set(date, (candidatesByDate.get(date) ?? 0) + 1);
  }
}

const isEmptyBlob = (v) => {
  let parsed = v;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return false; }
  }
  return Array.isArray(parsed) && parsed.length === 0;
};

const completeDates = Object.keys(completeByDate).sort();
const emptyBlobDates = Object.keys(itemsByDate).filter((d) => isEmptyBlob(itemsByDate[d])).sort();

const poisoned = [];
const emptyButLegitimate = [];
for (const date of emptyBlobDates) {
  const flagged = completeByDate[date] != null;
  const cands = candidatesByDate.get(date) ?? 0;
  if (flagged && cands > 0) {
    poisoned.push({
      date,
      candidates: cands,
      itemsTtl: itemTtls[date] ?? null,
      completeTtl: completeTtls[date] ?? null,
    });
  } else {
    emptyButLegitimate.push({ date, flagged, candidates: cands });
  }
}

// ── The frontier ────────────────────────────────────────────────────────────
// Recomputed here rather than read from the app: the dump is a snapshot and the
// window moves, so "past the end" has to be judged against the window as it was
// when the dump was taken.
const DUMPED_AT = items?.dumpedAt ?? complete?.dumpedAt ?? new Date().toISOString();
const pad2 = (n) => String(n).padStart(2, "0");
const toDateStr = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
const at = new Date(DUMPED_AT);
const t = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
const WINDOW_PAST_DAYS = 3;
const WINDOW_FUTURE_MONTHS = 3;
const windowStart = toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - WINDOW_PAST_DAYS)));
const windowEnd = toDateStr(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + WINDOW_FUTURE_MONTHS + 1, 0)));
const frontierValue = frontier?.value ?? null;
const frontierParked = typeof frontierValue === "string" && frontierValue > windowEnd;

// IS THE PARKING LEGITIMATE? Parked-past-the-end is the NORMAL steady state once
// the window is genuinely full -- findNextIncompleteDate parks deliberately so
// later scans short-circuit. So "parked" on its own proves nothing, and reporting
// it as a defect would be the same absence-versus-failure confusion again.
//
// The discriminator is whether the window actually IS full. A date inside the
// window that has candidates but no stored rows is work the background fill
// should have picked up. If any exist while the pointer sits past the end, the
// pointer is stranded: the scan starts beyond the window, the loop never runs,
// and it re-parks itself every time.
const inWindowWithCandidatesNoBlob = [...candidatesByDate.entries()]
  .filter(([date, n]) => n > 0 && date >= windowStart && date <= windowEnd && itemsByDate[date] == null)
  .map(([date, n]) => ({ date, candidates: n }))
  .sort((a, b) => (a.date < b.date ? -1 : 1));

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`
================================================================
P0 — EMPTY-DAY POISONING IN PRODUCTION
dump taken ${DUMPED_AT}
================================================================

DENOMINATORS (so the verdict below is readable either way)
  dates with a stored items blob      ${Object.keys(itemsByDate).length}
  of those, blob is []                ${emptyBlobDates.length}
  dates flagged complete              ${completeDates.length}
  month feeds present                 ${monthsSeen.length}  ${monthsSeen.sort().join(", ") || "(none)"}
  dates the feed gives candidates for  ${candidatesByDate.size}
  window at dump time                 ${windowStart} .. ${windowEnd}

VERDICT
  poisoned dates (complete + [] + candidates > 0):  ${poisoned.length}
`);

if (poisoned.length === 0) {
  console.log(`  ZERO. Measured, not assumed: ${emptyBlobDates.length} empty blob(s) were examined
  against ${candidatesByDate.size} dates of candidate data and none met all three
  parts of the signature.

  This is a real result. It says the defect has not fired in production YET --
  it does not say the defect is absent, and the reproduction stands.
`);
} else {
  console.log("| date | candidates it should have had | items TTL (s) | items TTL (d) | complete TTL (s) | complete TTL (d) |");
  console.log("|---|---|---|---|---|---|");
  for (const p of poisoned) {
    const d = (x) => (typeof x === "number" && x > 0 ? (x / 86400).toFixed(1) : "—");
    console.log(`| ${p.date} | ${p.candidates} | ${p.itemsTtl ?? "—"} | ${d(p.itemsTtl)} | ${p.completeTtl ?? "—"} | ${d(p.completeTtl)} |`);
  }
  const totalLost = poisoned.reduce((s, p) => s + p.candidates, 0);
  console.log(`
  ${poisoned.length} date(s), ${totalLost} company rows suppressed in total.
  Each stays suppressed until its items TTL lapses, and stays unreachable to the
  auto-populate loop AND to Backfill until its complete TTL lapses.`);
}

// ── scheduleCovered, asked for alongside P0 ────────────────────────────────
// Reported here rather than inferred: §5 of the findings doc says a failing month
// read degrades a symbol to the 120-day floor, and scheduleCovered is the only
// number that says whether that is happening to the slice actually being warmed.
{
  const warm = jobRuns?.values?.["warm-stock-data"] ?? null;
  console.log("\nSCHEDULE COVERAGE (warm-stock-data, last recorded run)");
  if (!warm) {
    console.log("  NOT RECORDED — no msh:job-run:v1:warm-stock-data in the dump.");
    console.log("  That is a failed read, not a zero: the job may not have run since the");
    console.log("  record's TTL, or the dump predates the job-run capture.");
  } else {
    const parsed = typeof warm === "string" ? JSON.parse(warm) : warm;
    const sm = parsed?.summary ?? {};
    const cov = sm.scheduleCovered;
    const slice = sm.sliceSize;
    console.log(`  recorded at        ${parsed?.at ? new Date(parsed.at).toISOString() : "?"}  ok=${parsed?.ok}`);
    console.log(`  scheduleCovered    ${cov ?? "(null)"}`);
    console.log(`  sliceSize          ${slice ?? "(null)"}`);
    console.log(`  scheduleSize       ${sm.scheduleSize ?? "(null)"}   (global index size)`);
    console.log(`  quarterlyRefreshes ${sm.quarterlyRefreshes ?? "(null)"}`);
    console.log(`  quarterlyStamped   ${sm.quarterlyStamped ?? "(null)"}`);
    if (typeof cov === "number" && typeof slice === "number" && slice > 0) {
      const p = ((cov / slice) * 100).toFixed(1);
      console.log(`\n  ${cov} of ${slice} symbols in the slice (${p}%) had an earnings date the index knew.`);
      console.log(
        cov === 0
          ? "  ZERO COVERAGE. Every symbol in that slice rode the 120-day floor, and the\n  run still reported success. That is the inert-trigger state §5 describes."
          : "  The remainder rode the 120-day floor for that run."
      );
    }
  }
}

console.log(`
EMPTY BUT LEGITIMATE (empty blob that is NOT the signature) — ${emptyButLegitimate.length}
  These are weekends, holidays and days nobody reports. Listed so the zero above
  cannot be mistaken for "nothing was examined".
${emptyButLegitimate.slice(0, 40).map((e) => `    ${e.date}  flagged=${e.flagged}  candidates=${e.candidates}`).join("\n") || "    (none)"}${emptyButLegitimate.length > 40 ? `\n    …+${emptyButLegitimate.length - 40} more` : ""}

FILL FRONTIER
  msh:earnings-fill-frontier:v2 = ${JSON.stringify(frontierValue)}
  ttl                           = ${frontier?.ttlSeconds ?? "(not captured)"}  ${frontier?.ttlSeconds === -1 ? "(-1 = no expiry, as written)" : ""}
  window end at dump time       = ${windowEnd}
  parked past the window end?   = ${frontierParked ? "YES — the background fill is short-circuiting" : "no"}
  in-window dates with candidates but NO stored rows = ${inWindowWithCandidatesNoBlob.length}
${inWindowWithCandidatesNoBlob.slice(0, 12).map((d) => `      ${d.date}  ${d.candidates} candidates`).join("\n")}${inWindowWithCandidatesNoBlob.length > 12 ? `\n      …+${inWindowWithCandidatesNoBlob.length - 12} more` : ""}

  VERDICT ON THE FRONTIER
${
  !frontierParked
    ? "    Not parked. Nothing to say."
    : inWindowWithCandidatesNoBlob.length === 0
      ? `    Parked and LEGITIMATE. The window is genuinely full, which is the state
    findNextIncompleteDate parks for so later scans cost one read.`
      : `    Parked and STRANDED. ${inWindowWithCandidatesNoBlob.length} date(s) inside the window still have
    candidates and no stored rows, so there was work to do and the scan did not
    find it. The pointer sits past the window end, so the walk starts beyond the
    range, the loop body never executes, and it re-parks itself on every pass --
    self-perpetuating. setFillFrontier only moves forward and the key carries no
    TTL (-1 above), so this does not clear on its own.

    This is F6's failure mode, already live. F6 stops it recurring; it does not
    unstick the pointer that is stuck now. That needs the key deleted by hand.`
}

================================================================
`);
