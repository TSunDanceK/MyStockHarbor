// THE PICKERS/TIINGO UNIVERSE, FOR THE SEC MANIFEST SEED (#552 COWORK #157 §1,
// ruled in COWORK #158: CODE-A #165 option 1).
//
// THE GAP, MEASURED 5 Oct (relay write-sec-coverage-census): of 2,529 eligible
// universe stocks (a CIK, admitted by the seed gate), 1,675 had no stored set,
// and NONE of the 1,675 had a manifest entry. sec-facts' populate queue reads
// only manifest entries with no set, so it sat empty (populateTaken 0) and the
// only thing filling these was a person's cold fill, about 1.5 a day. The
// strength badge reads "no results read yet" on every one of them.
//
// THE FIX IS AN INPUT, NOT A JOB. sec-daily-index unions this list into its
// seed, through the same seed gate (secSeedRefusal: no-cik, etf, non-equity,
// security-kind), and the existing populate queue fills the new entries at
// SEC_POPULATE_PER_RUN (300) a run, two runs a day. No schedule changes.
//
// THE SAME UNION warm-pickers-sec reads (the warm targets, then the Tiingo
// universe), so "covered" means the same set on the stock page, the Pickers
// overlay and here. READ-ONLY: the cached warm-targets key, then its week-long
// fallback, never getWarmTargetSymbols() -- on a cold start that derives the
// list from the pickers payload, and a 04:00 SEC job must not become the thing
// that builds it. A miss on both keys contributes nothing; the Tiingo key
// still does, and every input already in the seed is unaffected.
//
// Redis: 1 GET (warm), +1 only when the cached key is absent, +1 GET (Tiingo).
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { readTiingoUniverseSymbols } from "./tiingoUniverse";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/**
 * warmTargets.ts's WARM_TARGETS_KEY and WARM_TARGETS_FALLBACK_KEY, by value:
 * that module imports the pickers builder, which this job has no reason to
 * load. check-sec-seed-universe asserts both still match.
 */
export const SEED_WARM_TARGETS_KEYS = ["msh:warm-targets:v1", "msh:warm-targets:v1:last-good"] as const;

/** The symbols of a stored warm-targets value, or null when it is not a usable list. Pure. */
export function warmSymbolsOf(raw: unknown): string[] | null {
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  const symbols = (value as { symbols?: unknown } | null)?.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0) return null;
  const clean = symbols.filter((s): s is string => typeof s === "string" && s.length > 0);
  return clean.length ? clean : null;
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

/** Warm targets first, then the Tiingo universe, deduplicated in that order. Pure. */
export function unionSeedUniverse(warm: readonly string[], tiingo: readonly string[]): string[] {
  return [...new Set([...warm, ...tiingo])];
}

export type SecSeedUniverse = {
  symbols: string[];
  warm: number;
  /** Which warm key served the list, or null when neither did. */
  warmFrom: "cached" | "fallback" | null;
  tiingo: number;
  commands: number;
};

/** Fail-open: any read that fails contributes nothing, never an error. */
export async function readSecSeedUniverse(): Promise<SecSeedUniverse> {
  let commands = 0;
  let warm: string[] | null = null;
  let warmFrom: SecSeedUniverse["warmFrom"] = null;
  if (redis) {
    for (const [i, key] of SEED_WARM_TARGETS_KEYS.entries()) {
      commands++;
      try { warm = warmSymbolsOf(await redis.get<unknown>(key)); } catch { warm = null; }
      if (warm) { warmFrom = i === 0 ? "cached" : "fallback"; break; }
    }
  }
  const tiingo = redis ? (commands++, await readTiingoUniverseSymbols()) : [];
  const symbols = unionSeedUniverse(warm ?? [], tiingo);
  return { symbols, warm: warm?.length ?? 0, warmFrom, tiingo: tiingo.length, commands };
}
