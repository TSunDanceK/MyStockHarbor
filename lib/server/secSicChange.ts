// SIC-CHANGE NOTICES (#552, COWORK #3). Flag only: nothing is reclassified.
//
// The sector/industry resolver reads each filer's SIC code from the committed
// data/sec/registrants.json. SEC can move a filer to a new code (a pivot, a
// merger), and nothing would notice. The sec-filings job already fetches each
// checked filer's submissions, which carry `sic`, so the comparison costs no
// extra request and no extra read: the registrant row is bundled JSON.
//
// COST: 0 commands when nothing changed. When something did, ONE HSET per run
// for all of that run's changes, into a small hash the helper reads. SIC
// changes are rare (a handful a year across the universe), so ~0/day.
import { Redis } from "@upstash/redis";
import registrantsFile from "@/data/sec/registrants.json";
import { lookupSpellingIn } from "@/lib/symbolSpellings.mjs";
import { canWriteSecState, noteSecWriteBlocked } from "./secWriteGate";

export const SEC_SIC_CHANGES_KEY = "msh:sec:sic-changes:v1";

export type SicChange = { symbol: string; was: string; now: string; description: string | null };

type RegistrantRow = { sic?: string | null };
const REGISTRANTS = (registrantsFile as unknown as { rows: Record<string, RegistrantRow> }).rows ?? {};

const code = (v: unknown): string | null => {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^\d{3,4}$/.test(s) ? s : null;
};

/**
 * The change between the committed SIC and the one SEC files now, or null.
 * PURE. Null when either side is missing: an absent code is a gap, not a move.
 */
export function sicChangeOf(
  symbol: string,
  submissions: { sic?: unknown; sicDescription?: unknown } | null | undefined,
  rows: Record<string, RegistrantRow> = REGISTRANTS,
): SicChange | null {
  const was = code(lookupSpellingIn(rows, String(symbol ?? "").trim().toUpperCase())?.value?.sic);
  const now = code(submissions?.sic);
  if (!was || !now || was === now) return null;
  const d = submissions?.sicDescription;
  return { symbol: String(symbol).toUpperCase(), was, now, description: typeof d === "string" && d.trim() ? d.trim() : null };
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

/** One HSET for all of a run's changes; nothing at all when there are none. */
export async function recordSicChanges(changes: SicChange[], seenOn: string): Promise<number> {
  if (!redis || changes.length === 0) return 0;
  if (!canWriteSecState()) { noteSecWriteBlocked("recordSicChanges"); return 0; }
  await redis.hset(SEC_SIC_CHANGES_KEY, Object.fromEntries(changes.map((c) => [c.symbol, { ...c, seenOn }])));
  return changes.length;
}
