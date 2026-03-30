import { Redis } from "@upstash/redis";

export type Point = {
  date: string;
  close: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type HistoryCacheEntry = {
  symbol: string;
  status: "qualified" | "non_qualified";
  checkedAt: number;
  source: "fmp";
  daily?: Point[];
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null;

const REDIS_HISTORY_PREFIX = "msh:history:v3";
const REDIS_HISTORY_TTL_SECONDS = 6 * 60 * 60;
const MIN_QUALIFIED_POINTS = 30;

type FmpHistoricalRow = {
  date?: string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
};

type FmpHistoricalResponse = {
  symbol?: string;
  historical?: FmpHistoricalRow[];
};

function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return { weekday, year, month, day, hour, minute };
}

function getNextMondayOpenUtcMsFromEastern(date = new Date()) {
  const { weekday, year, month, day } = getEasternParts(date);

  const weekdayIndex =
    weekday === "Sun"
      ? 0
      : weekday === "Mon"
        ? 1
        : weekday === "Tue"
          ? 2
          : weekday === "Wed"
            ? 3
            : weekday === "Thu"
              ? 4
              : weekday === "Fri"
                ? 5
                : weekday === "Sat"
                  ? 6
                  : 0;

  const jsDate = new Date(Date.UTC(year, month - 1, day));
  const daysUntilMonday =
    weekdayIndex === 0 ? 1 : weekdayIndex === 6 ? 2 : weekdayIndex === 5 ? 3 : 0;

  jsDate.setUTCDate(jsDate.getUTCDate() + daysUntilMonday);

  const mondayYear = jsDate.getUTCFullYear();
  const mondayMonth = String(jsDate.getUTCMonth() + 1).padStart(2, "0");
  const mondayDay = String(jsDate.getUTCDate()).padStart(2, "0");

  const easternOpen = `${mondayYear}-${mondayMonth}-${mondayDay}T09:30:00-05:00`;
  return new Date(easternOpen).getTime();
}

function getRedisHistoryTtlSeconds(now = new Date()) {
  const { weekday, hour, minute } = getEasternParts(now);
  const totalMinutes = hour * 60 + minute;
  const fridayCloseMinutes = 16 * 60;

  const isFridayAfterClose = weekday === "Fri" && totalMinutes >= fridayCloseMinutes;
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  if (isFridayAfterClose || isWeekend) {
    const mondayOpenUtcMs = getNextMondayOpenUtcMsFromEastern(now);
    const diffSeconds = Math.ceil((mondayOpenUtcMs - now.getTime()) / 1000);
    return Math.max(60, diffSeconds);
  }

  return REDIS_HISTORY_TTL_SECONDS;
}

function getHistoryRedisKey(symbol: string) {
  return `${REDIS_HISTORY_PREFIX}:${String(symbol).trim().toUpperCase()}`;
}

function normalizeSymbol(symbol: string) {
  return String(symbol).trim().toUpperCase();
}

function buildFmpSymbol(symbol: string) {
  return normalizeSymbol(symbol).replace(/\./g, "-");
}

function toFiniteNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseFmpHistoricalRows(rows: FmpHistoricalRow[] | undefined) {
  if (!Array.isArray(rows) || rows.length === 0) return [] as Point[];

  const daily: Point[] = [];

  for (const row of rows) {
    const date = typeof row.date === "string" ? row.date.trim() : "";
    const close = toFiniteNumber(row.close);
    const high = toFiniteNumber(row.high);
    const low = toFiniteNumber(row.low);
    const volume = toFiniteNumber(row.volume);

    if (!date || close === null) continue;

    daily.push({
      date,
      close,
      high: high ?? undefined,
      low: low ?? undefined,
      volume: volume ?? undefined,
    });
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));

  return daily;
}

export async function readHistoryEntry(symbol: string) {
  const normalized = normalizeSymbol(symbol);

  if (!redis) return null;

  try {
    const entry = await redis.get<HistoryCacheEntry>(getHistoryRedisKey(normalized));

    if (!entry || typeof entry !== "object") return null;
    if (entry.symbol !== normalized) return null;
    if (entry.status !== "qualified" && entry.status !== "non_qualified") return null;
    if (entry.source !== "fmp") return null;

    return entry;
  } catch {
    return null;
  }
}

export async function writeHistoryEntry(symbol: string, entry: HistoryCacheEntry) {
  const normalized = normalizeSymbol(symbol);

  if (!redis) return;

  try {
    await redis.set(getHistoryRedisKey(normalized), entry, {
      ex: getRedisHistoryTtlSeconds(),
    });
  } catch {
    // fail open
  }
}

export async function fetchAndCacheDailyHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const fmpSymbol = buildFmpSymbol(normalized);
  const apiKey = process.env.FMP_API_KEY;

  if (!apiKey) {
    throw new Error("Missing FMP_API_KEY environment variable");
  }

  const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(
    fmpSymbol
  )}?serietype=line&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`FMP history request failed with status ${res.status} for ${normalized}`);
  }

  const payload = (await res.json()) as FmpHistoricalResponse | { Error?: string };

  if (
    payload &&
    typeof payload === "object" &&
    "Error" in payload &&
    typeof payload.Error === "string" &&
    payload.Error.trim()
  ) {
    throw new Error(`FMP history error for ${normalized}: ${payload.Error}`);
  }

  const daily = parseFmpHistoricalRows(
    payload && typeof payload === "object" && "historical" in payload
      ? payload.historical
      : undefined
  );

  if (daily.length >= MIN_QUALIFIED_POINTS) {
    const entry: HistoryCacheEntry = {
      symbol: normalized,
      status: "qualified",
      checkedAt: Date.now(),
      source: "fmp",
      daily,
    };

    await writeHistoryEntry(normalized, entry);
    return entry;
  }

  const entry: HistoryCacheEntry = {
    symbol: normalized,
    status: "non_qualified",
    checkedAt: Date.now(),
    source: "fmp",
  };

  await writeHistoryEntry(normalized, entry);
  return entry;
}

export async function getDailyHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = await readHistoryEntry(normalized);

  if (cached) {
    if (cached.status === "qualified" && Array.isArray(cached.daily)) {
      return cached.daily;
    }

    return [] as Point[];
  }

  const fresh = await fetchAndCacheDailyHistory(normalized);

  if (fresh.status === "qualified" && Array.isArray(fresh.daily)) {
    return fresh.daily;
  }

  return [] as Point[];
}

export async function ensureQualifiedHistory(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const cached = await readHistoryEntry(normalized);

  if (cached) {
    return cached.status === "qualified";
  }

  const fresh = await fetchAndCacheDailyHistory(normalized);
  return fresh.status === "qualified";
}
