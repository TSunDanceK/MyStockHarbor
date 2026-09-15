// Merging a day's filings into the rolling 90-day window, and pruning it.
//
// ── NO REDIS IMPORT HERE, AND THAT IS THE POINT ────────────────────────────
// The seed (a plain .mjs on a runner, where `npm ci` deliberately does not run)
// and the daily ingest (in the app, with @upstash/redis) MUST WRITE THE SAME
// SHAPE. Two writers producing subtly different rows would both look plausible
// and disagree only in the details nobody checks -- the same argument that made
// buildSecIpoTables pure. So the merge lives here, with no dependencies, and
// both callers import it. ipoSecStore.ts wraps it with the Redis I/O.
import type { IpoFilerRecord } from "./ipoSecSource";

/** The stored document. One key holds the whole window. */
export type StoredIpoFilings = {
  /** When the write that produced this ran. */
  fetchedAt: number;
  /** Days of history the window is meant to hold. */
  windowDays: number;
  /** Oldest filing date retained, ISO. Everything older has been pruned. */
  windowStart: string;
  records: IpoFilerRecord[];
};

/**
 * PRUNING IS PART OF THE WRITE, NOT A CLEANUP JOB ADDED LATER.
 *
 * A rolling window that only appends grows without bound. Upstash rejects a
 * value over its size ceiling, so an append-only design does not degrade -- it
 * works every day until the day the write fails outright, and the failure lands
 * on whatever unlucky commit is deploying that week. Pruning inside the same
 * read-modify-write makes the window's size a property of the code rather than
 * of how long it has been running.
 */
export const IPO_WINDOW_DAYS = 90;

/** Defensive ceiling. Reaching it means the prune is not working. */
export const MAX_STORED_RECORDS = 4000;

const dedupeFilings = (filings: IpoFilerRecord["filings"]) => {
  const seen = new Set<string>();
  const out: IpoFilerRecord["filings"] = [];
  for (const f of filings) {
    const key = `${f.form}|${f.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.form.localeCompare(b.form));
};

/**
 * Merge incoming filer records into the stored window and prune.
 *
 * PURE. Given the same inputs it returns the same document, which is what lets a
 * fixture hold it to a case rather than a runner having to prove it.
 */
export function mergeIpoRecords(
  existing: IpoFilerRecord[],
  incoming: IpoFilerRecord[],
  windowStart: string,
  now = Date.now()
): StoredIpoFilings {
  const byCik = new Map<string, IpoFilerRecord>();

  for (const record of [...existing, ...incoming]) {
    const prior = byCik.get(record.cik);
    if (!prior) {
      byCik.set(record.cik, { ...record, filings: [...record.filings] });
      continue;
    }
    byCik.set(record.cik, {
      cik: record.cik,
      // Prefer the longer company name: EDGAR's index truncates some, and the
      // longer spelling is the one a reader recognises.
      company: record.company.length > prior.company.length ? record.company : prior.company,
      // A later run's SIC wins only if it HAS one. A failed submissions read
      // returns null, and null must never overwrite a value already known --
      // that would quietly disable the entity filter for that filer.
      sic: record.sic ?? prior.sic,
      filings: dedupeFilings([...prior.filings, ...record.filings]),
      // Same rule for terms: a run that could not parse a cover must not erase
      // terms an earlier run did parse.
      terms: record.terms ?? prior.terms,
    });
  }

  const records: IpoFilerRecord[] = [];
  for (const record of byCik.values()) {
    // PRUNE the filings first...
    const filings = record.filings.filter((f) => f.date >= windowStart);
    // ...then drop the filer entirely if nothing of it remains in the window.
    // Keeping an empty shell would grow the document forever while rendering
    // nothing, which is the append-only failure wearing a different hat.
    if (filings.length === 0) continue;
    records.push({ ...record, filings });
  }

  records.sort((a, b) => Number(a.cik) - Number(b.cik));

  return {
    fetchedAt: now,
    windowDays: IPO_WINDOW_DAYS,
    windowStart,
    records,
  };
}

/** The window start for a given day. Exported so both writers agree on it. */
export function windowStartFor(now = new Date(), windowDays = IPO_WINDOW_DAYS): string {
  return new Date(now.getTime() - windowDays * 86400000).toISOString().slice(0, 10);
}

/**
 * Is this document safe to write?
 *
 * Checked BEFORE the SET, because the alternative to catching it here is an
 * Upstash error on a value that is already too large, at which point the window
 * has no way back to a good state without a manual delete.
 */
export function validateStored(doc: StoredIpoFilings): { ok: boolean; reason: string | null } {
  if (doc.records.length > MAX_STORED_RECORDS) {
    return {
      ok: false,
      reason: `${doc.records.length} records exceeds the ${MAX_STORED_RECORDS} ceiling — the prune is not working`,
    };
  }
  const stale = doc.records.filter((r) => r.filings.some((f) => f.date < doc.windowStart));
  if (stale.length) {
    return {
      ok: false,
      reason: `${stale.length} record(s) carry filings older than windowStart ${doc.windowStart} — prune bug`,
    };
  }
  return { ok: true, reason: null };
}
