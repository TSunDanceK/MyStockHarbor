import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import {
  ensureQualifiedHistory,
  hasFmpCapacity,
  reserveFmpCallSlot,
} from "../../../lib/server/historyCache";
import {
  addToDynamicUniverse,
  removeFromDynamicUniverse,
} from "../../../lib/server/dynamicUniverseCache";
import { cacheScreenerFundamentals } from "../../../lib/server/fundamentalsCache";
import { seedColdPricePoolRows } from "../../../lib/server/pricePool";

export const runtime = "nodejs";

const redis = Redis.fromEnv();
const REDIS_KEY = "msh:market:state";

type Quote = {
  symbol: string;
  price?: number | string;
  open?: number | string;
  dayHigh?: number | string;
  dayLow?: number | string;
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

const DISCOVERY_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DYNAMIC_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DYNAMIC_MAX_SIZE = 700;
const DISCOVERY_BATCH_SIZE = 50;
const DISCOVERY_ESTIMATED_MAX_CALLS = 100; // up to 50 quote calls + up to 50 history fills
const DISCOVERY_MIN_HEADROOM_CALLS = 150;
// Floor for accepting a shuffled master list, i.e. "is this list plausibly
// complete, or did the sources fail?"
//
// WAS 500, WHICH THE LIST CAN NEVER REACH. buildExpandedDiscoveryMasterList
// unions three FMP constituent endpoints with the static lists, but those
// endpoints answer 402 on the Starter plan and fetchFmpConstituentSymbols
// swallows that into []. So the master list is ALWAYS the static fallback:
// 407 names (confirmed live -- masterListSize: 407).
//
// 407 < 500 meant the early-return in ensureDailyShuffledMasterList never fired,
// so on EVERY request it rebuilt the list, reshuffled it, and -- the damaging
// part -- reset state.pointer to 0. Discovery therefore never walked the master
// list systematically; it re-sampled from a freshly shuffled list each time and
// could only ever pick names it had not already admitted. Live debug showed
// exactly this: pointer 0 and masterListChanged true on a request 8s after the
// last discovery run. It also burned 3 FMP calls per request on endpoints that
// always fail.
//
// 350 sits below the 407 static fallback (so the normal case is accepted and
// the pointer persists) and above a curated-only degenerate list, which is what
// this guard actually exists to reject.
const MIN_DYNAMIC_MASTER_SIZE = 350;

let payloadCache: { at: number; payload: any } | null = null;

type RedisDiscoveryState = {
  pointer: number;
  lastDiscoveryAt: number;
  dynamic: Record<string, DynamicQuoteRecord>;
  shuffledMasterList: string[];
  shuffleDayKey: string | null;
  // Bumped whenever the SOURCE of the master list changes, so a stored list
  // built by older code is discarded rather than served until the next daily
  // rollover. See MASTER_LIST_SOURCE_VERSION.
  masterListVersion?: number;
};

function emptyDiscoveryState(): RedisDiscoveryState {
  return {
    pointer: 0,
    lastDiscoveryAt: 0,
    dynamic: {},
    shuffledMasterList: [],
    shuffleDayKey: null,
    masterListVersion: 0,
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
      ? state.shuffledMasterList
          .map((x) => String(x).trim().toUpperCase())
          .filter(Boolean)
      : [],
    shuffleDayKey:
      typeof state.shuffleDayKey === "string" ? state.shuffleDayKey : null,
    masterListVersion:
      typeof state.masterListVersion === "number" ? state.masterListVersion : 0,
  };
}

async function saveDiscoveryState(state: RedisDiscoveryState) {
  await redis.set(REDIS_KEY, state);
}

const CURATED_UNIVERSE: string[] = [
  "AAPL",
  "ABBV",
  "ABT",
  "ADBE",
  "AMZN",
  "AVGO",
  "BAC",
  "BRK.B",
  "COST",
  "CRM",
  "CSCO",
  "CVX",
  "DIS",
  "GOOGL",
  "HD",
  "INTC",
  "JNJ",
  "JPM",
  "KO",
  "LLY",
  "MA",
  "MCD",
  "META",
  "MRK",
  "MSFT",
  "NFLX",
  "NVDA",
  "ORCL",
  "PEP",
  "PG",
  "PYPL",
  "QCOM",
  "SBUX",
  "T",
  "TGT",
  "TSLA",
  "TXN",
  "UNH",
  "V",
  "VZ",
  "WFC",
  "WMT",
  "XOM",
  "AMD",
  "GE",
  "AMAT",
  "CAT",
  "LOW",
  "IBM",
  "NOW",
  "PM",
  "NKE",
  "DHR",
  "LIN",
].filter(Boolean);

const DISCOVERY_MASTER_LIST: string[] = [
  "A",
  "AAL",
  "AAP",
  "ABC",
  "ABNB",
  "ADI",
  "ADM",
  "AEE",
  "AEP",
  "AES",
  "AFL",
  "AIG",
  "AKAM",
  "ALB",
  "ALLE",
  "AMCR",
  "AME",
  "ANET",
  "AON",
  "APA",
  "APD",
  "APH",
  "APTV",
  "ARE",
  "ATO",
  "AXP",
  "AZO",
  "BALL",
  "BAX",
  "BBY",
  "BDX",
  "BEN",
  "BIIB",
  "BK",
  "BKNG",
  "BKR",
  "BLK",
  "BMY",
  "BSX",
  "BWA",
  "C",
  "CAG",
  "CAH",
  "CCI",
  "CDNS",
  "CE",
  "CHD",
  "CHRW",
  "CI",
  "CL",
  "CLX",
  "CMCSA",
  "CME",
  "CMG",
  "CMI",
  "CMS",
  "CNC",
  "CNP",
  "COF",
  "COO",
  "COP",
  "CPB",
  "CPRT",
  "CRL",
  "CSGP",
  "CTAS",
  "CTRA",
  "CTSH",
  "CVS",
  "DAL",
  "DAY",
  "DD",
  "DE",
  "DG",
  "DGX",
  "DLR",
  "DLTR",
  "DOC",
  "DOV",
  "DOW",
  "DPZ",
  "DRI",
  "DUK",
  "DVN",
  "DXCM",
  "EA",
  "EBAY",
  "ECL",
  "ED",
  "EFX",
  "EIX",
  "EL",
  "EMN",
  "EMR",
  "EOG",
  "EPAM",
  "EQIX",
  "EQR",
  "EQT",
  "ES",
  "ESS",
  "ETN",
  "ETR",
  "EVRG",
  "EXC",
  "EXPD",
  "F",
  "FANG",
  "FAST",
  "FCX",
  "FDX",
  "FI",
  "FITB",
  "FMC",
  "FOX",
  "FOXA",
  "FRT",
  "GD",
  "GILD",
  "GIS",
  "GL",
  "GLW",
  "GM",
  "GNRC",
  "GPC",
  "GPN",
  "GRMN",
  "GS",
  "GWW",
  "HAL",
  "HAS",
  "HCA",
  "HES",
  "HIG",
  "HPE",
  "HPQ",
  "HRL",
  "HSIC",
  "HST",
  "HSY",
  "HUM",
  "HWM",
  "IDXX",
  "IEX",
  "IFF",
  "ILMN",
  "INCY",
  "IP",
  "IPG",
  "IRM",
  "ISRG",
  "IT",
  "ITW",
  "IVZ",
  "J",
  "JBHT",
  "JBL",
  "JKHY",
  "K",
  "KDP",
  "KEY",
  "KHC",
  "KIM",
  "KKR",
  "KLAC",
  "KMB",
  "KMI",
  "KR",
  "L",
  "LDOS",
  "LEN",
  "LH",
  "LHX",
  "LKQ",
  "LMT",
  "LNT",
  "LRCX",
  "LULU",
  "LVS",
  "LYB",
  "MCHP",
  "MCK",
  "MDLZ",
  "MDT",
  "MET",
  "MGM",
  "MKC",
  "MKTX",
  "MLM",
  "MMC",
  "MMM",
  "MO",
  "MOS",
  "MPC",
  "MPWR",
  "MRNA",
  "MS",
  "MSI",
  "MTB",
  "MU",
  "NDAQ",
  "NEE",
  "NEM",
  "NI",
  "NOC",
  "NRG",
  "NSC",
  "NTAP",
  "NTRS",
  "ODFL",
  "OKE",
  "OMC",
  "ON",
  "OTIS",
  "OXY",
  "PANW",
  "PAYX",
  "PCAR",
  "PEG",
  "PFE",
  "PH",
  "PHM",
  "PKG",
  "PLD",
  "PNC",
  "PNR",
  "PPG",
  "PPL",
  "PRU",
  "PSA",
  "PSX",
  "PTC",
  "PXD",
  "RCL",
  "REG",
  "REGN",
  "RF",
  "RHI",
  "RJF",
  "RL",
  "RMD",
  "ROK",
  "ROL",
  "ROP",
  "ROST",
  "RSG",
  "RTX",
  "SBAC",
  "SCHW",
  "SHW",
  "SJM",
  "SLB",
  "SNA",
  "SNPS",
  "SO",
  "SPG",
  "SPGI",
  "STE",
  "STT",
  "STX",
  "STZ",
  "SWK",
  "SWKS",
  "SYF",
  "SYK",
  "SYY",
  "TEL",
  "TER",
  "TFC",
  "TFX",
  "TJX",
  "TMO",
  "TMUS",
  "TPR",
  "TRMB",
  "TROW",
  "TRV",
  "TT",
  "TTWO",
  "TXT",
  "TYL",
  "UAL",
  "UDR",
  "UHS",
  "ULTA",
  "UPS",
  "URI",
  "USB",
  "VFC",
  "VICI",
  "VLO",
  "VMC",
  "VRSK",
  "VRSN",
  "VRTX",
  "WAB",
  "WBA",
  "WDAY",
  "WEC",
  "WELL",
  "WY",
  "YUM",
  "ZBH",
  "ZBRA",
  "ZS",
].filter(Boolean);

const EXTRA_LIQUID_GROWTH_LIST: string[] = [
  "ARM",
  "ASML",
  "TSM",
  "SHOP",
  "COIN",
  "HOOD",
  "RBLX",
  "MSTR",
  "BABA",
  "NIO",
  "LI",
  "XPEV",
  "RIVN",
  "LCID",
  "SOFI",
  "AFRM",
  "UPST",
  "ROKU",
  "U",
  "PATH",
  "AI",
  "IONQ",
  "RKLB",
  "ASTS",
  "SOUN",
  "IREN",
  "MARA",
  "RIOT",
  "CLSK",
  "HIMS",
  "CELH",
  "ELF",
  "CAVA",
  "APP",
  "TOST",
  "GTLB",
  "BILL",
  "ESTC",
  "DOCN",
  "FSLY",
  "WOLF",
  "QS",
  "CHPT",
  "PLUG",
  "RUN",
  "ENPH",
  "SEDG",
  "FSLR",
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

function isCleanStockSymbol(symbol: string) {
  const value = String(symbol ?? "").trim().toUpperCase();

  if (!value) return false;
  if (value.length > 10) return false;
  if (value.includes("^")) return false;
  if (value.includes("/")) return false;
  if (value.includes("=")) return false;
  if (value.includes("#")) return false;

  return true;
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

// HISTORY, kept because it is easy to re-derive the wrong conclusion here.
//
// Discovery candidates used to come from FMP's index-constituent endpoints.
// The legacy v3 paths (api/v3/sp500_constituent, api/v3/nasdaq_constituent)
// were retired by FMP -- live 403 "Legacy Endpoint ... no longer supported
// ... prior August 31, 2025", regardless of plan tier. They were replaced with
// the stable paths (stable/sp500-constituent etc), which are valid endpoint
// names but answer 402 "Restricted Endpoint: not available under your current
// subscription" on this plan.
//
// The previous comment here claimed that was harmless because the call would
// "auto-recover the moment the FMP plan includes them". It was not harmless.
// The 402 resolved to an empty array silently, so the master list was ALWAYS
// the ~407-name static fallback, and since pool 353 + CURATED_UNIVERSE 54 = 407
// exactly, discovery had nothing left to find and the universe could not grow
// at all. That went unnoticed for as long as it did precisely because the
// failure was invisible and the comment said not to worry about it.
//
// Those calls are now gone, replaced by fetchFmpScreenerSymbols below. If the
// plan is ever upgraded to serve constituent lists, adding them back to the
// union in buildExpandedDiscoveryMasterList is a few lines -- but check
// /api/debug/fmp-endpoints first rather than assuming, which is what that
// route exists for.

// Minimum market cap for a symbol to enter the discovery candidate pool.
// $1B keeps the universe to liquid, screenable names -- the same character as
// the hand-built DISCOVERY_MASTER_LIST. Lower it to widen the net; probing
// showed 300000000 also returns a full page, so there is room either way.
// Bump this whenever the master list's SOURCE changes.
//
// Without it, a source change is latent: ensureDailyShuffledMasterList only
// rebuilds when the Eastern day rolls over, so the stored list from the old
// source keeps being served until the next morning. That bit immediately --
// swapping the constituent endpoints for the screener had no effect at all,
// because the same commit lowered MIN_DYNAMIC_MASTER_SIZE to 350, which made
// the early-return accept the stale 407-name list and skip the rebuild.
//
// v2 = FMP company-screener (was: sp500/nasdaq/dowjones constituent endpoints).
// v3 = same screener with isEtf=false&isFund=false. v2 was returning 42.5%
//      mutual funds (425 of 1000 -- VTSAX, VFIAX, VFINX and friends), which
//      were being admitted into a STOCK screener. Measured via
//      /api/debug/fmp-endpoints; the excluded variant returns a full 1000 names
//      with zero fund-like symbols, so this costs no coverage.
const MASTER_LIST_SOURCE_VERSION = 3;

const SCREENER_MIN_MARKET_CAP = 1_000_000_000;
const SCREENER_LIMIT = 1000;

/**
 * Candidate symbols from FMP's company screener.
 *
 * This REPLACED three constituent-endpoint calls (sp500/nasdaq/dowjones) that
 * answered 402 "Restricted Endpoint: This endpoint is not available under your
 * current subscription" on this plan -- confirmed by probing them live via
 * /api/debug/fmp-endpoints on 2026-08-06. fetchFmpConstituentSymbols swallowed
 * that into [], so all three failed silently on every master-list rebuild and
 * the list was always the ~407-name static fallback.
 *
 * That mattered: pool 353 + CURATED_UNIVERSE 54 = 407 exactly, so discovery had
 * literally nothing left to find and the universe could never grow no matter
 * what UNIVERSE_CAP said.
 *
 * The screener IS available on this plan and returned 1000 symbols in the same
 * probe. One call instead of three, and it actually works.
 *
 * STEP 2 (2026-08-06 follow-up session): this response also carries
 * marketCap/sector/industry/beta/lastAnnualDividend per row, which used to be
 * discarded entirely here. Now handed to cacheScreenerFundamentals so
 * warmFundamentals (lib/server/fundamentalsCache.ts) can use it instead of a
 * per-symbol `profile` fetch for any symbol this screener call covers -- zero
 * extra FMP calls, since this fetch already happens.
 */
async function fetchFmpScreenerSymbols(apiKey: string) {
  await reserveFmpCallSlot();

  const url =
    `https://financialmodelingprep.com/stable/company-screener` +
    `?marketCapMoreThan=${SCREENER_MIN_MARKET_CAP}` +
    `&exchange=NASDAQ,NYSE` +
    `&isActivelyTrading=true` +
    // Equities only. Without these the screener returns ~42% mutual funds --
    // market cap and exchange filters do not exclude them.
    `&isEtf=false` +
    `&isFund=false` +
    `&limit=${SCREENER_LIMIT}` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });

    if (!res.ok) return [];

    const json = await res.json().catch(() => null);
    if (!Array.isArray(json)) return [];

    // Fire this before mapping down to symbols below -- cacheScreenerFundamentals
    // wants the full rows (marketCap/sector/industry/...), not just `symbol`.
    // Awaited rather than fire-and-forget: Vercel does not guarantee unawaited
    // work continues after this function's caller returns, and a Redis
    // pipeline write here is cheap relative to the master-list rebuild this
    // sits inside.
    try {
      const cached = await cacheScreenerFundamentals(json);
      if (cached > 0) {
        console.log(`[market] cached screener fundamentals for ${cached} symbols`);
      }
    } catch {
      // fail open -- discovery must not break because caching fundamentals did
    }

    return json
      .map((item) => String(item?.symbol ?? "").trim().toUpperCase())
      .filter(isCleanStockSymbol);
  } catch {
    // fail open -- the static lists below still provide a working master list
    return [];
  }
}

async function buildExpandedDiscoveryMasterList(apiKey: string) {
  const screenerSymbols = await fetchFmpScreenerSymbols(apiKey);

  // Static lists stay in the union: they carry the curated names and a set of
  // known-good tickers that must be candidates regardless of what the screener
  // returns on any given day.
  return uniqUpper([
    ...screenerSymbols,
    ...EXTRA_LIQUID_GROWTH_LIST,
    ...CURATED_UNIVERSE,
    ...DISCOVERY_MASTER_LIST,
  ]);
}

async function ensureDailyShuffledMasterList(
  state: RedisDiscoveryState,
  apiKey: string
) {
  const todayKey = getEasternDayKey();

  if (
    state.masterListVersion === MASTER_LIST_SOURCE_VERSION &&
    state.shuffleDayKey === todayKey &&
    Array.isArray(state.shuffledMasterList) &&
    state.shuffledMasterList.length >= MIN_DYNAMIC_MASTER_SIZE
  ) {
    return false;
  }

  const expandedMaster = await buildExpandedDiscoveryMasterList(apiKey);

  const cleanMaster = expandedMaster.length
    ? expandedMaster
    : uniqUpper([
        ...EXTRA_LIQUID_GROWTH_LIST,
        ...CURATED_UNIVERSE,
        ...DISCOVERY_MASTER_LIST,
      ]);

  state.shuffledMasterList = shuffleArray(cleanMaster);
  state.shuffleDayKey = todayKey;
  state.masterListVersion = MASTER_LIST_SOURCE_VERSION;
  state.pointer = 0;

  return true;
}

function extractSingleQuote(json: any, fallbackSymbol: string): Quote | null {
  if (!json || typeof json !== "object") return null;

  const symbol =
    typeof json.symbol === "string" && json.symbol.trim()
      ? json.symbol.trim().toUpperCase()
      : fallbackSymbol.trim().toUpperCase();

  if (!symbol) return null;

  return {
    symbol,
    price: json.price,
    open: json.open,
    dayHigh: json.dayHigh,
    dayLow: json.dayLow,
    changesPercentage: json.changesPercentage,
    volume: json.volume,
    name: json.name,
  };
}

async function fetchSingleQuote(symbol: string, apiKey: string) {
  const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(
    symbol
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
  const toRemove = sorted.slice(
    0,
    Math.max(0, sorted.length - DYNAMIC_MAX_SIZE)
  );

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
    if (!isCleanStockSymbol(symbol)) continue;
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
        (r.last != null ||
          r.changePct != null ||
          r.rangePct != null ||
          r.volume != null)
    );
}

/* ----------------------------- GET ----------------------------- */

export async function GET() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Missing FMP_API_KEY env var." },
      { status: 500 }
    );
  }

  const now = Date.now();

  let state = await loadDiscoveryState();

  const masterListChanged = await ensureDailyShuffledMasterList(state, apiKey);

  pruneDynamicCache(state, now);

  if (masterListChanged) {
    // RECONCILE. The candidate list just changed, so anything sitting in the
    // pool that is no longer a candidate should not stay in the universe.
    //
    // This exists because of a real incident: the v2 screener filter returned
    // 42.5% mutual funds (VTSAX, VFIAX, ...) and they were admitted into a
    // stock screener. Fixing the filter stops NEW ones arriving but does
    // nothing about those already admitted, and the 14-day age window is far
    // too slow to lean on.
    //
    // Curated names are exempt (they are deliberately never discovery
    // candidates -- getNextDiscoveryBatch skips them -- so they would otherwise
    // be evicted every single rebuild).
    //
    // Guarded on the master list being healthy: the acceptance check above
    // already refuses a list below MIN_DYNAMIC_MASTER_SIZE, so by here the list
    // is known good and a mass eviction cannot be triggered by one bad fetch.
    const candidateSet = new Set(state.shuffledMasterList);
    const curatedSet = new Set(uniqUpper(CURATED_UNIVERSE));
    const orphaned = Object.keys(state.dynamic).filter(
      (symbol) => !candidateSet.has(symbol) && !curatedSet.has(symbol)
    );

    if (orphaned.length) {
      for (const symbol of orphaned) delete state.dynamic[symbol];
      const removed = await removeFromDynamicUniverse(orphaned);
      console.log(
        `[market] reconciled pool against rebuilt master list: evicted ${orphaned.length} ` +
          `no-longer-candidate symbols (${removed} removed from the shared universe), ` +
          `pool now ${Object.keys(state.dynamic).length}`
      );
    }

    await saveDiscoveryState(state);
    payloadCache = null;
  }

  const intervalElapsed = now - state.lastDiscoveryAt >= DISCOVERY_INTERVAL_MS;
  const dynamicUniverseFull = Object.keys(state.dynamic).length >= DYNAMIC_MAX_SIZE;
  const hasCapacity = await hasFmpCapacity(
    DISCOVERY_ESTIMATED_MAX_CALLS,
    DISCOVERY_MIN_HEADROOM_CALLS
  );
  const allowDiscoveryNow = !dynamicUniverseFull && intervalElapsed && hasCapacity;

  const debugErrors: any[] = [];

  let discoveryRan = false;
  let discoveryReason: string | null = null;
  let attemptedSymbols: string[] = [];
  const admittedSymbols: string[] = [];
  // STEP 3 (2026-08-06 follow-up session): the quote already fetched below to
  // qualify each admitted symbol also carries price/%change/volume/marketCap --
  // enough to seed a cold-start row in the price pool at zero extra FMP cost.
  // See lib/server/pricePool.ts's seedColdPricePoolRows for why this matters
  // (a discovery batch that admits more symbols than a single warm-price-pool
  // run's priceCap otherwise queues the overflow behind other stale symbols).
  const priceSeedRows: {
    symbol: string;
    price: number | null;
    changePct: number | null;
    volume: number | null;
    marketCap: number | null;
  }[] = [];
  let historyChecks = 0;
  let historyQualified = 0;
  let historyRejected = 0;

  if (!allowDiscoveryNow) {
    if (dynamicUniverseFull) {
      discoveryReason = "dynamic_universe_full";
    } else if (!intervalElapsed) {
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
        for (const attemptedSymbol of nextSymbols) {
          await reserveFmpCallSlot();
          const r = await fetchSingleQuote(attemptedSymbol, apiKey);

          const rawJson = Array.isArray(r.json) ? r.json[0] : r.json;
          const q = extractSingleQuote(rawJson, attemptedSymbol);

          if (!r.ok || !q) {
            const msg =
              (rawJson && (rawJson.message || rawJson.error)) ||
              (typeof r.text === "string" ? r.text.slice(0, 300) : null) ||
              null;

            debugErrors.push({
              httpOk: r.ok,
              httpStatus: r.status,
              message: msg,
              sampleKeys:
                rawJson && typeof rawJson === "object"
                  ? Object.keys(rawJson).slice(0, 8)
                  : null,
              attemptedSymbols: [attemptedSymbol],
            });
            continue;
          }

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

          // Job A: remember what we admitted so it can go straight into the
          // shared dynamic universe below, rather than waiting for a page build
          // to copy it across.
          admittedSymbols.push(symbol);

          // STEP 3: reuse this same quote (already fetched above) to seed the
          // price pool's cold-start row -- see seedColdPricePoolRows.
          priceSeedRows.push({
            symbol,
            price: toNum(q.price),
            changePct: toNum(q.changesPercentage),
            volume: toNum(q.volume),
            marketCap: toNum(rawJson?.marketCap),
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

    // JOB A -- the shared dynamic universe (msh:dynamic-universe:v2) is now
    // written HERE, at discovery time, rather than only as a side effect of a
    // page build. pickersBuilder still copies market.dynamicSymbols across, so
    // this is additive and safe to revert; what it changes is WHEN membership
    // lands, which stops the universe depending on a builder having run.
    //
    // Batched deliberately: addToDynamicUniverse pipelines the ZINCRBYs into one
    // round-trip, does a single ZADD for lastSeen and prunes once. Calling it
    // per symbol would prune up to DISCOVERY_BATCH_SIZE times per run.
    //
    // Only symbols that passed ensureQualifiedHistory reach here, so this can
    // never admit a name the discovery gate itself rejected.
    if (admittedSymbols.length) {
      await addToDynamicUniverse(admittedSymbols, "market");
    }

    // STEP 3: seed price-pool cold-start rows for whatever was just admitted.
    // Pure Redis (no FMP call) and never overwrites an existing pool row -- see
    // seedColdPricePoolRows. Fail-open: a seeding problem must not break
    // discovery itself.
    if (priceSeedRows.length) {
      try {
        const seeded = await seedColdPricePoolRows(priceSeedRows, now);
        if (seeded > 0) {
          console.log(`[market] seeded price pool for ${seeded} newly discovered symbols`);
        }
      } catch {
        // fail open
      }
    }

    // Logged unconditionally, including the zero case. A run that admits nothing
    // is the interesting one -- it is what a saturated master list looks like,
    // and it is indistinguishable from "the write never fired" without this.
    console.log(
      `[market] discovery admitted ${admittedSymbols.length} symbols -> dynamic universe ` +
        `(attempted ${attemptedSymbols.length}, qualified ${historyQualified}, ` +
        `rejected ${historyRejected}, pool ${Object.keys(state.dynamic).length})`
    );

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

  const nextDiscoveryAt =
    state.lastDiscoveryAt > 0
      ? state.lastDiscoveryAt + DISCOVERY_INTERVAL_MS
      : now;

  const payload = {
    updatedAt: new Date().toISOString(),
    scope: "Rolling Dynamic Discovery Universe",
    provider: "fmp",
    curatedUniverseSize: uniqUpper(CURATED_UNIVERSE).length,
    masterListSize: Array.isArray(state.shuffledMasterList)
      ? state.shuffledMasterList.length
      : uniqUpper(DISCOVERY_MASTER_LIST).length,
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
      shuffleDayKey: state.shuffleDayKey,
      masterListVersion: state.masterListVersion,
      lastDiscoveryAt:
        state.lastDiscoveryAt > 0
          ? new Date(state.lastDiscoveryAt).toISOString()
          : null,
      nextDiscoveryAt: new Date(nextDiscoveryAt).toISOString(),
      secondsUntilNextDiscovery: Math.max(
        0,
        Math.ceil((nextDiscoveryAt - now) / 1000)
      ),
      masterListChanged,
      errors: debugErrors,
    },
  };

  payloadCache = { at: now, payload };
  return NextResponse.json(payload);
}
