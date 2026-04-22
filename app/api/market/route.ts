import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  ensureQualifiedHistory,
  hasFmpCapacity,
  reserveFmpCallSlot,
} from "../../../lib/server/historyCache";

export const runtime = "nodejs";

const redis = Redis.fromEnv();
const REDIS_KEY = "msh:market:state";

type Quote = {
  symbol: string;
  price?: number | string;
  change?: number | string;
  changesPercentage?: number | string;
  volume?: number | string;
  name?: string;
};

type Row = {
  symbol: string;
  changePct: number | null;
  rangePct: number | null;
  last: number | null;
  volume: number | null;
};

type DynamicQuoteRecord = {
  quote: Quote;
  discoveredAt: number;
};

const PAYLOAD_CACHE_MS = 6 * 60 * 1000;

const DISCOVERY_INTERVAL_MS = 6 * 60 * 1000; // 5 minutes
const DYNAMIC_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DYNAMIC_MAX_SIZE = 500;
const DISCOVERY_BATCH_SIZE = 25;
const DISCOVERY_ESTIMATED_MAX_CALLS = 26; // 1 batch quote + up to 25 history fills
const DISCOVERY_MIN_HEADROOM_CALLS = 100;

let payloadCache: { at: number; payload: any } | null = null;

type RedisDiscoveryState = {
  pointer: number;
  lastDiscoveryAt: number;
  dynamic: Record<string, DynamicQuoteRecord>;
  shuffledMasterList: string[];
  shuffleDayKey: string | null;
};

function emptyDiscoveryState(): RedisDiscoveryState {
  return {
    pointer: 0,
    lastDiscoveryAt: 0,
    dynamic: {},
    shuffledMasterList: [],
    shuffleDayKey: null,
  };
}

async function loadDiscoveryState(): Promise<RedisDiscoveryState> {
  const state = await redis.get<RedisDiscoveryState>(REDIS_KEY);

  if (
    !state ||
    typeof state !== "object" ||
    typeof state.pointer !== "number" ||
    typeof state.lastDiscoveryAt !== "number" ||
    !state.dynamic ||
    typeof state.dynamic !== "object"
  ) {
    return emptyDiscoveryState();
  }

  return {
    pointer: state.pointer,
    lastDiscoveryAt: state.lastDiscoveryAt,
    dynamic: state.dynamic,
    shuffledMasterList: Array.isArray(state.shuffledMasterList)
      ? state.shuffledMasterList.map((x) => String(x).trim().toUpperCase()).filter(Boolean)
      : [],
    shuffleDayKey:
      typeof state.shuffleDayKey === "string" ? state.shuffleDayKey : null,
  };
}

async function saveDiscoveryState(state: RedisDiscoveryState) {
  await redis.set(REDIS_KEY, state);
}

const CURATED_UNIVERSE: string[] = [
  "AAPL","ABBV","ABT","ADBE","AMZN","AVGO","BAC","BRK.B","COST","CRM","CSCO","CVX","DIS","GOOGL","HD",
  "INTC","JNJ","JPM","KO","LLY","MA","MCD","META","MRK","MSFT","NFLX","NVDA","ORCL","PEP","PG","PYPL",
  "QCOM","SBUX","T","TGT","TSLA","TXN","UNH","V","VZ","WFC","WMT","XOM",
  "AMD","GE","AMAT","CAT","LOW","IBM","NOW","PM","NKE","DHR","LIN",
].filter(Boolean);

const DISCOVERY_MASTER_LIST: string[] = [
  "A","AAL","AAP","ABC","ABNB","ADI","ADM","AEE","AEP","AES","AFL","AIG","AKAM","ALB","ALLE","AMCR",
  "AME","ANET","AON","APA","APD","APH","APTV","ARE","ATO","AXP","AZO","BALL","BAX","BBY","BDX","BEN",
  "BIIB","BK","BKNG","BKR","BLK","BMY","BSX","BWA","C","CAG","CAH","CCI","CDNS","CE","CHD","CHRW",
  "CI","CL","CLX","CMCSA","CME","CMG","CMI","CMS","CNC","CNP","COF","COO","COP","CPB","CPRT","CRL",
  "CSGP","CTAS","CTRA","CTSH","CVS","DAL","DAY","DD","DE","DG","DGX","DLR","DLTR","DOC","DOV","DOW",
  "DPZ","DRI","DUK","DVN","DXCM","EA","EBAY","ECL","ED","EFX","EIX","EL","EMN","EMR","EOG","EPAM",
  "EQIX","EQR","EQT","ES","ESS","ETN","ETR","EVRG","EXC","EXPD","F","FANG","FAST","FCX","FDX","FI",
  "FITB","FMC","FOX","FOXA","FRT","GD","GILD","GIS","GL","GLW","GM","GNRC","GPC","GPN","GRMN","GS",
  "GWW","HAL","HAS","HCA","HES","HIG","HPE","HPQ","HRL","HSIC","HST","HSY","HUM","HWM","IDXX","IEX",
  "IFF","ILMN","INCY","IP","IPG","IRM","ISRG","IT","ITW","IVZ","J","JBHT","JBL","JKHY","K","KDP",
  "KEY","KHC","KIM","KKR","KLAC","KMB","KMI","KR","L","LDOS","LEN","LH","LHX","LKQ","LMT","LNT",
  "LRCX","LULU","LVS","LYB","MCHP","MCK","MDLZ","MDT","MET","MGM","MKC","MKTX","MLM","MMC","MMM","MO",
  "MOS","MPC","MPWR","MRNA","MS","MSI","MTB","MU","NDAQ","NEE","NEM","NI","NOC","NRG","NSC","NTAP",
  "NTRS","ODFL","OKE","OMC","ON","OTIS","OXY","PANW","PAYX","PCAR","PEG","PFE","PH","PHM","PKG","PLD",
  "PNC","PNR","PPG","PPL","PRU","PSA","PSX","PTC","PXD","RCL","REG","REGN","RF","RHI","RJF","RL","RMD",
  "ROK","ROL","ROP","ROST","RSG","RTX","SBAC","SCHW","SHW","SJM","SLB","SNA","SNPS","SO","SPG","SPGI",
  "STE","STT","STX","STZ","SWK","SWKS","SYF","SYK","SYY","TEL","TER","TFC","TFX","TJX","TMO","TMUS",
  "TPR","TRMB","TROW","TRV","TT","TTWO","TXT","TYL","UAL","UDR","UHS","ULTA","UPS","URI","USB","VFC",
  "VICI","VLO","VMC","VRSK","VRSN","VRTX","WAB","WBA","WDAY","WEC","WELL","WY","YUM","ZBH","ZBRA","ZS",
].filter(Boolean);

/* ------------------------- small helpers ------------------------- */

function toNum(x: unknown): number | null {
  const n = typeof x === "string" ? Number(x) : typeof x === "number" ? x : NaN;
  return Number.isFinite(n) ? n : null;
}

function uniqUpper(arr: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const s of arr) {
    const u = String(s).trim().toUpperCase();
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }

  return out;
}

function getEasternDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";

  return `${year}-${month}-${day}`;
}

function shuffleArray<T>(arr: T[]) {
  const out = [...arr];

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

function ensureDailyShuffledMasterList(state: RedisDiscoveryState) {
  const todayKey = getEasternDayKey();
  const cleanMaster = uniqUpper(DISCOVERY_MASTER_LIST);

  if (
    state.shuffleDayKey === todayKey &&
    Array.isArray(state.shuffledMasterList) &&
    state.shuffledMasterList.length > 0
  ) {
    return;
  }

  state.shuffledMasterList = shuffleArray(cleanMaster);
  state.shuffleDayKey = todayKey;
  state.pointer = 0;
}

function extractQuotesFromBatch(json: any): Quote[] {
  if (!Array.isArray(json)) return [];

  return json
    .filter((item) => item && typeof item === "object" && typeof item.symbol === "string")
    .map((item) => item as Quote);
}

async function fetchQuoteBatch(symbols: string[], apiKey: string) {
  const list = symbols.join(",");
const url = `https://financialmodelingprep.com/stable/batch-quote-short?symbols=${encodeURIComponent(
  list
)}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });

  const text = await res.text();
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { ok: res.ok, status: res.status, json, text, url };
}

function shouldKeepDynamicRecord(record: DynamicQuoteRecord, now: number) {
  if (!record) return false;
  return now - record.discoveredAt <= DYNAMIC_TTL_MS;
}

function pruneDynamicCache(state: RedisDiscoveryState, now: number) {
  for (const [symbol, record] of Object.entries(state.dynamic)) {
    if (!shouldKeepDynamicRecord(record, now)) {
      delete state.dynamic[symbol];
    }
  }

  const entries = Object.entries(state.dynamic);
  if (entries.length <= DYNAMIC_MAX_SIZE) return;

  const sorted = entries.sort((a, b) => a[1].discoveredAt - b[1].discoveredAt);
  const toRemove = sorted.slice(0, Math.max(0, sorted.length - DYNAMIC_MAX_SIZE));

  for (const [symbol] of toRemove) {
    delete state.dynamic[symbol];
  }
}

function getNextDiscoveryBatch(state: RedisDiscoveryState) {
  const curatedSet = new Set(uniqUpper(CURATED_UNIVERSE));
  const master = Array.isArray(state.shuffledMasterList) ? state.shuffledMasterList : [];

  if (!master.length) return [];

  const picked: string[] = [];
  let checked = 0;

  while (picked.length < DISCOVERY_BATCH_SIZE && checked < master.length) {
    const idx = state.pointer % master.length;
    const symbol = master[idx];

    state.pointer = (idx + 1) % master.length;
    checked++;

    if (!symbol) continue;
    if (curatedSet.has(symbol)) continue;
    if (state.dynamic[symbol]) continue;

    picked.push(symbol);
  }

  return picked;
}

function buildRowsFromQuotes(quotes: Quote[]): Row[] {
  return quotes
    .map((q) => {
      const last = toNum(q.price);
      const pct = toNum(q.changesPercentage);
      const vol = toNum(q.volume);

      return {
        symbol: String(q.symbol ?? "").trim().toUpperCase(),
        changePct: pct,
        rangePct: null,
        last,
        volume: vol,
      };
    })
    .filter(
      (r) =>
        r.symbol &&
        (r.last != null || r.changePct != null || r.rangePct != null || r.volume != null)
    );
}

/* ----------------------------- GET ----------------------------- */

export async function GET() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing FMP_API_KEY env var." }, { status: 500 });
  }

  const now = Date.now();

  let state = await loadDiscoveryState();
  ensureDailyShuffledMasterList(state);

  pruneDynamicCache(state, now);

  const intervalElapsed = now - state.lastDiscoveryAt >= DISCOVERY_INTERVAL_MS;
  const hasCapacity = await hasFmpCapacity(
    DISCOVERY_ESTIMATED_MAX_CALLS,
    DISCOVERY_MIN_HEADROOM_CALLS
  );
  const allowDiscoveryNow = intervalElapsed && hasCapacity;

  const debugErrors: any[] = [];

  let discoveryRan = false;
  let discoveryReason: string | null = null;
  let attemptedSymbols: string[] = [];
  let historyChecks = 0;
  let historyQualified = 0;
  let historyRejected = 0;

  if (!allowDiscoveryNow) {
    if (!intervalElapsed) {
      discoveryReason = "interval_not_elapsed";
    } else if (!hasCapacity) {
      discoveryReason = "insufficient_fmp_headroom";
    } else {
      discoveryReason = "unknown_block";
    }
  }

  if (allowDiscoveryNow) {
    const nextSymbols = getNextDiscoveryBatch(state);
    attemptedSymbols = nextSymbols;
    discoveryRan = true;

    if (nextSymbols.length > 0) {
      try {
        await reserveFmpCallSlot();
        const r = await fetchQuoteBatch(nextSymbols, apiKey);
        const quotes = extractQuotesFromBatch(r.json);

        for (const q of quotes) {
          const symbol = String(q.symbol ?? "").trim().toUpperCase();
          if (!symbol) continue;

          historyChecks++;

          const hasQualifiedHistory = await ensureQualifiedHistory(symbol);

          if (hasQualifiedHistory) {
            historyQualified++;
          } else {
            historyRejected++;
            continue;
          }

          state.dynamic[symbol] = {
            quote: q,
            discoveredAt: now,
          };
        }

        if (!quotes.length) {
          const msg =
            (r.json && (r.json.message || r.json.error)) ||
            (r.json && r.json.status === "error" ? "status:error" : null) ||
            null;

          debugErrors.push({
            httpOk: r.ok,
            httpStatus: r.status,
            message: msg ?? (typeof r.text === "string" ? r.text.slice(0, 300) : null),
            sampleKeys:
              r.json && typeof r.json === "object" ? Object.keys(r.json).slice(0, 8) : null,
            attemptedSymbols: nextSymbols,
          });
        }
      } catch (e: any) {
        debugErrors.push({
          httpOk: false,
          httpStatus: null,
          message: e?.message ? String(e.message) : "fetch failed",
          sampleKeys: null,
          attemptedSymbols: nextSymbols,
        });
      }
    }

    state.lastDiscoveryAt = now;

    pruneDynamicCache(state, now);

    await saveDiscoveryState(state);

    payloadCache = null;
  }

  if (payloadCache && now - payloadCache.at < PAYLOAD_CACHE_MS) {
    return NextResponse.json(payloadCache.payload);
  }

  const quotes = Object.values(state.dynamic).map((r) => r.quote);
  const rows = buildRowsFromQuotes(quotes);

  const topTraded = [...rows]
    .filter((r) => r.volume != null)
    .sort((a, b) => b.volume! - a.volume!)
    .slice(0, 30);

  const topMovers = [...rows]
    .filter((r) => r.changePct != null)
    .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
    .slice(0, 20);

  const topRanges = [...rows]
    .filter((r) => r.rangePct != null)
    .sort((a, b) => b.rangePct! - a.rangePct!)
    .slice(0, 30);

  const isRateLimited = debugErrors.some((e) => {
    const message = typeof e?.message === "string" ? e.message.toLowerCase() : "";
    return (
      message.includes("run out of api credits") ||
      message.includes("rate limit") ||
      message.includes("too many requests")
    );
  });

  const dynamicSymbols = Object.keys(state.dynamic).sort();

  const payload = {
    updatedAt: new Date().toISOString(),
    scope: "Rolling Dynamic Discovery Universe",
    provider: "fmp",
    curatedUniverseSize: uniqUpper(CURATED_UNIVERSE).length,
    masterListSize: uniqUpper(DISCOVERY_MASTER_LIST).length,
    dynamicUniverseSize: dynamicSymbols.length,
    dynamicSymbols,
    quotesReturned: quotes.length,
    rowsBuilt: rows.length,
    rateLimited: isRateLimited,

    topTraded,
    topMovers,
    topRanges,

    debug: {
      historyChecks,
      historyQualified,
      historyRejected,
      discoveryRan,
      discoveryReason,
      attemptedSymbols,
      discoveryIntervalMinutes: DISCOVERY_INTERVAL_MS / 60000,
      discoveryBatchSize: DISCOVERY_BATCH_SIZE,
      dynamicTtlMinutes: DYNAMIC_TTL_MS / 60000,
      dynamicMaxSize: DYNAMIC_MAX_SIZE,
      estimatedDiscoveryMaxCalls: DISCOVERY_ESTIMATED_MAX_CALLS,
      requiredHeadroomCalls: DISCOVERY_MIN_HEADROOM_CALLS,
      fmpCapacityAvailable: hasCapacity,
      pointer: state.pointer,
      lastDiscoveryAt:
        state.lastDiscoveryAt > 0
          ? new Date(state.lastDiscoveryAt).toISOString()
          : null,
      errors: debugErrors,
    },
  };

  payloadCache = { at: now, payload };
  return NextResponse.json(payload);
}
