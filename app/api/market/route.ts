import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { ensureQualifiedHistory } from "../../../lib/server/historyCache";

export const runtime = "nodejs";

const redis = Redis.fromEnv();
const REDIS_KEY = "msh:market:state";

type Quote = {
  symbol: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  previous_close?: string;
  percent_change?: string;
  volume?: string;
  status?: string;
  message?: string;
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

const PAYLOAD_CACHE_MS = 60 * 1000;

const DISCOVERY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const OPEN_MARKET_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLOSED_MARKET_TTL_MS = 16 * 60 * 60 * 1000; // 16 hours
const DYNAMIC_MAX_SIZE = 96; // effectively your natural rolling pool target for now
const DISCOVERY_BATCH_SIZE = 4; // 4 symbols per cycle

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

function getEasternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return { weekday, hour, minute };
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

function isDiscoveryWindowOpen(date = new Date()) {
  const { weekday, hour, minute } = getEasternParts(date);

  if (weekday === "Sat" || weekday === "Sun") return false;

  const totalMinutes = hour * 60 + minute;
  const start = 9 * 60;
  const end = 17 * 60;

  return totalMinutes >= start && totalMinutes <= end;
}

function extractQuotesFromBatch(json: any): Quote[] {
  if (!json || typeof json !== "object") return [];

  if (json.status === "error") return [];
  if (typeof json.code === "number" && json.message) return [];

  if (Array.isArray(json.data)) return json.data as Quote[];
  if (Array.isArray(json)) return json as Quote[];

  const out: Quote[] = [];
  for (const [, v] of Object.entries(json)) {
    if (!v || typeof v !== "object") continue;
    const vv: any = v;

    if (vv.status === "ok" && vv.data && typeof vv.data === "object") {
      if (typeof vv.data.symbol === "string") out.push(vv.data as Quote);
      continue;
    }

    if (typeof vv.symbol === "string") {
      if (vv.status === "error") continue;
      out.push(vv as Quote);
      continue;
    }
  }

  return out;
}

async function fetchQuoteBatch(symbols: string[], apiKey: string) {
  const list = symbols.join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(list)}&apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => null);

  return { ok: res.ok, status: res.status, json, url };
}

function getEasternDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? "0"),
    month: Number(parts.find((p) => p.type === "month")?.value ?? "1"),
    day: Number(parts.find((p) => p.type === "day")?.value ?? "1"),
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? "0"),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? "0"),
  };
}

function getNextTradingCarryExpiryUtcMs(fromMs: number) {
  const fromDate = new Date(fromMs);
  const { year, month, day, weekday, hour, minute } = getEasternDateParts(fromDate);
  const totalMinutes = hour * 60 + minute;
  const closeMinutes = 16 * 60;

  const baseUtc = new Date(Date.UTC(year, month - 1, day));

  let daysToAdd = 1;

  if (weekday === "Fri" && totalMinutes >= closeMinutes) {
    daysToAdd = 3;
  } else if (weekday === "Sat") {
    daysToAdd = 2;
  } else if (weekday === "Sun") {
    daysToAdd = 1;
  } else if (weekday === "Fri") {
    daysToAdd = 3;
  } else {
    daysToAdd = 1;
  }

  baseUtc.setUTCDate(baseUtc.getUTCDate() + daysToAdd);

  const carryYear = baseUtc.getUTCFullYear();
  const carryMonth = String(baseUtc.getUTCMonth() + 1).padStart(2, "0");
  const carryDay = String(baseUtc.getUTCDate()).padStart(2, "0");

  const easternCarryCutoff = `${carryYear}-${carryMonth}-${carryDay}T11:30:00-05:00`;
  return new Date(easternCarryCutoff).getTime();
}

function shouldKeepDynamicRecord(record: DynamicQuoteRecord, now: number) {
  if (!record) return false;

  const ageMs = now - record.discoveredAt;

  if (isDiscoveryWindowOpen(new Date(now))) {
    if (ageMs <= OPEN_MARKET_TTL_MS) return true;
  } else {
    if (ageMs <= CLOSED_MARKET_TTL_MS) return true;
  }

  const carryExpiryUtcMs = getNextTradingCarryExpiryUtcMs(record.discoveredAt);
  return now <= carryExpiryUtcMs;
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
  const master = Array.isArray(state.shuffledMasterList)
    ? state.shuffledMasterList
    : [];

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
      const open = toNum(q.open);
      const high = toNum(q.high);
      const low = toNum(q.low);
      const close = toNum(q.close);
      const pct = toNum(q.percent_change);
      const vol = toNum(q.volume);

      let rangePct: number | null = null;
      const denom = open && open > 0 ? open : close && close > 0 ? close : null;
      if (denom && high != null && low != null) rangePct = ((high - low) / denom) * 100;

      return {
        symbol: String(q.symbol ?? "").toUpperCase(),
        changePct: pct,
        rangePct,
        last: close,
        volume: vol,
      };
    })
    .filter((r) => r.symbol && (r.last != null || r.changePct != null || r.rangePct != null || r.volume != null));
}

/* ----------------------------- GET ----------------------------- */

export async function GET() {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Missing TWELVEDATA_API_KEY env var." }, { status: 500 });
  }

  const now = Date.now();

  let state = await loadDiscoveryState();
  ensureDailyShuffledMasterList(state);

  pruneDynamicCache(state, now);

  const allowDiscoveryNow =
    now - state.lastDiscoveryAt >= DISCOVERY_INTERVAL_MS &&
    (isDiscoveryWindowOpen() || Object.keys(state.dynamic).length === 0);

  const debugErrors: any[] = [];

let discoveryRan = false;
let discoveryReason: string | null = null;
let attemptedSymbols: string[] = [];
let historyChecks = 0;
let historyQualified = 0;
let historyRejected = 0;

if (!allowDiscoveryNow) {
  if (now - state.lastDiscoveryAt < DISCOVERY_INTERVAL_MS) {
    discoveryReason = "interval_not_elapsed";
  } else if (!isDiscoveryWindowOpen() && Object.keys(state.dynamic).length > 0) {
    discoveryReason = "outside_market_hours";
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
            message: msg,
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

  const isRateLimited = debugErrors.some(
    (e) =>
      typeof e?.message === "string" &&
      e.message.toLowerCase().includes("run out of api credits")
  );

  const dynamicSymbols = Object.keys(state.dynamic).sort();

  const payload = {
    updatedAt: new Date().toISOString(),
    scope: "Rolling Dynamic Discovery Universe",
    provider: "twelvedata",
    curatedUniverseSize: uniqUpper(CURATED_UNIVERSE).length,
    masterListSize: uniqUpper(DISCOVERY_MASTER_LIST).length,
    dynamicUniverseSize: Object.keys(state.dynamic).length,
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
      openMarketTtlMinutes: OPEN_MARKET_TTL_MS / 60000,
      closedMarketTtlMinutes: CLOSED_MARKET_TTL_MS / 60000,
      dynamicMaxSize: DYNAMIC_MAX_SIZE,
      discoveryWindowOpen: isDiscoveryWindowOpen(),
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
