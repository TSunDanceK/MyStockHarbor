// hasFiledEarnings -- THE SERVER SIDE OF THE EARNINGS-LINK RULE (#552 COWORK #197).
//
// Backed by fact-set index membership: msh:sec:facts:index:v1 names every
// stored msh:sec:facts:v1:* set (SADDed by writeFactSet, SREMed on discard and
// eviction). Index membership alone is not "at least one filed period" -- the
// empty answer is stored and indexed too (26 of 1,732 on 2026-10-07, SKHY on
// 13 bottleneck pages) -- so writeFactSet also keeps the
// indexed sets with no filed quarter or year (secManifest.SEC_FACTS_EMPTY_KEY),
// and filed = index less empty.
//
// COST: ONE CACHED READ, NEVER A GET PER LINK. Both sets are read in one
// pipeline inside unstable_cache (six hours), and React's cache() shares that one
// promise across every call in a render. Warm: 0 store commands per render.
// Cold: 2 (SMEMBERS index, SMEMBERS empty), once per six hours.
//
// A FAILED READ IS NOT CACHED (it throws inside unstable_cache) and returns
// null; links then stay out for that render, per "only when".
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { SEC_FACTS_EMPTY_KEY, SEC_FACTS_INDEX_KEY } from "./secManifest";
import { filedFromIndex, hasFiledEarningsIn } from "@/lib/filedEarningsLinks";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** Store commands spent reading the filed list in this process (the cost probe reads it). */
export const filedEarningsReads = { commands: 0 };

const readFiledList = unstable_cache(
  async (): Promise<string[]> => {
    if (!redis) throw new Error("no store");
    const p = redis.pipeline();
    p.smembers(SEC_FACTS_INDEX_KEY);
    p.smembers(SEC_FACTS_EMPTY_KEY);
    filedEarningsReads.commands += 2;
    const [indexed, empty] = (await p.exec()) as [string[] | null, string[] | null];
    if (!Array.isArray(indexed)) throw new Error("index unreadable");
    return filedFromIndex(indexed, empty ?? []);
  },
  ["filed-earnings-v1"],
  // SIX HOURS, deliberately long: unstable_cache lowers a static page's ISR
  // period to this (bottleneck and insight pages are otherwise static), so a
  // short window would multiply their regenerations. A cold-filled symbol
  // gains its links within six hours.
  { revalidate: 21600, tags: ["filed-earnings"] },
);

/** The filed set for this render, or null when it cannot be read. One promise per request. */
export const filedEarningsSet = cache(async (): Promise<ReadonlySet<string> | null> => {
  try {
    return new Set(await readFiledList());
  } catch {
    return null;
  }
});

/** The filed list as an array, for the client endpoint. Null when unreadable. */
export async function filedEarningsList(): Promise<string[] | null> {
  const set = await filedEarningsSet();
  return set ? [...set] : null;
}

/** Whether /stock/SYM/earnings should be linked: a filed fact set, and not a fund. */
export async function hasFiledEarnings(symbol: string | null | undefined): Promise<boolean> {
  return hasFiledEarningsIn(await filedEarningsSet(), symbol);
}

/**
 * For a server render that links many symbols: one read, then a synchronous
 * predicate named like the async one, so every gated href reads
 * `hasFiledEarnings(sym) ? <Link …/earnings> : null`.
 */
export async function filedEarningsGate(): Promise<(symbol: string | null | undefined) => boolean> {
  const set = await filedEarningsSet();
  return (symbol) => hasFiledEarningsIn(set, symbol);
}

/**
 * The earnings page's robots input: false only when the list was READ and the
 * symbol is not on it; null when the list is unknown (a store blip must not
 * noindex every earnings page).
 */
export async function filedEarningsKnown(symbol: string): Promise<boolean | null> {
  const set = await filedEarningsSet();
  return set ? hasFiledEarningsIn(set, symbol) : null;
}
