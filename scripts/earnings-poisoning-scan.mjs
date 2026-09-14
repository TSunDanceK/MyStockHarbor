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

// ── Report ──────────────────────────────────────────────────────────────────
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

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
${frontierParked ? `
  A parked frontier is the outage signature from F6: the scan walked the whole
  window, found nothing to do, and pushed the pointer past the end. It only ever
  moves forward, and the key carries no TTL, so it does not recover on its own.` : ""}

================================================================
`);
