import { Redis } from "@upstash/redis";

export type DynamicUniverseSource = "market" | "pickers" | "plays" | "search";

export type DynamicUniverseEntry = {
  symbol: string;
  score: number;
  sources: DynamicUniverseSource[];
  lastSeen: number;
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const REDIS_DYNAMIC_UNIVERSE_KEY = "msh:dynamic-universe:v1";
const MAX_DYNAMIC_UNIVERSE_SIZE = 700;
const ENTRY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function normaliseSymbol(symbol: string) {
  return String(symbol).trim().toUpperCase();
}

function cleanSymbols(symbols: string[]) {
  return symbols.map(normaliseSymbol).filter(Boolean);
}

export async function readDynamicUniverse() {
  if (!redis) return [] as DynamicUniverseEntry[];

  try {
    const entries = await redis.get<DynamicUniverseEntry[]>(
      REDIS_DYNAMIC_UNIVERSE_KEY
    );

    if (!Array.isArray(entries)) return [];

    const now = Date.now();

    return entries
      .filter((entry) => {
        return (
          entry &&
          typeof entry.symbol === "string" &&
          Number.isFinite(entry.score) &&
          Number.isFinite(entry.lastSeen) &&
          now - entry.lastSeen <= ENTRY_MAX_AGE_MS
        );
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_DYNAMIC_UNIVERSE_SIZE);
  } catch {
    return [];
  }
}

export async function addToDynamicUniverse(
  symbols: string[],
  source: DynamicUniverseSource,
  scoreBoost = 1
) {
  const cleaned = cleanSymbols(symbols);
  if (!cleaned.length || !redis) return;

  const now = Date.now();
  const existing = await readDynamicUniverse();
  const bySymbol = new Map<string, DynamicUniverseEntry>();

  for (const entry of existing) {
    bySymbol.set(entry.symbol, entry);
  }

  for (const symbol of cleaned) {
    const current = bySymbol.get(symbol);

    if (!current) {
      bySymbol.set(symbol, {
        symbol,
        score: scoreBoost,
        sources: [source],
        lastSeen: now,
      });
      continue;
    }

    bySymbol.set(symbol, {
      ...current,
      score: current.score + scoreBoost,
      sources: Array.from(new Set([...current.sources, source])),
      lastSeen: now,
    });
  }

  const next = Array.from(bySymbol.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DYNAMIC_UNIVERSE_SIZE);

  try {
    await redis.set(REDIS_DYNAMIC_UNIVERSE_KEY, next);
  } catch {
    // fail open
  }
}
