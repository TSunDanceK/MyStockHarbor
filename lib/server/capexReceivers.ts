// App glue for "Who is receiving" (Relay C, #563 COWORK #2): the committed
// list, the one Redis key, and a polite SEC fetcher. The logic lives in
// ./capexReceiversCore (shared with the relay seed and the checks).
//
// REDIS: the record is ONE key. The daily job does 1 GET + at most 1 SET (only
// when something changed) + the job-run stamp; the page does 1 GET per ISR
// render (hourly). About 27 commands a day. ~15 KB stored.
import { Redis } from "@upstash/redis";
import receiversFile from "@/data/capex/receivers.json";
import { PAGE_READ_CACHE } from "./redisCacheMode";
import { secUserAgent } from "./news/userAgent";
import type { Fetchers, ReceiverEntry, ReceiversRecord } from "./capexReceiversCore";

export const RECEIVERS_KEY = "msh:capex:receivers:v1";

export type ReceiverGroup = { id: string; heading: string };

export const RECEIVER_GROUPS: ReceiverGroup[] = receiversFile.groups;
export const RECEIVER_ENTRIES: ReceiverEntry[] = receiversFile.rows as ReceiverEntry[];

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

export async function readReceiversRecord(): Promise<ReceiversRecord | null> {
  if (!redis) return null;
  try {
    const r = await redis.get<ReceiversRecord>(RECEIVERS_KEY);
    return r && r.v === 1 && r.rows ? r : null;
  } catch {
    return null;
  }
}

export async function writeReceiversRecord(record: ReceiversRecord): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.set(RECEIVERS_KEY, record);
    return true;
  } catch {
    return false;
  }
}

// SEC's fair-access limit is 10 requests/s PER REQUESTER; 8/s leaves room for
// nothing else to be running (the job's slot is clear of the other SEC jobs).
const GAP_MS = 125;
let last = 0;
async function secGet(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": secUserAgent(), "Accept-Encoding": "gzip, deflate" },
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
        continue;
      }
      return res.ok ? res : null;
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  return null;
}

export const secFetchers: Fetchers = {
  json: async (url) => {
    const res = await secGet(url);
    return res ? res.json().catch(() => null) : null;
  },
  text: async (url) => {
    const res = await secGet(url);
    return res ? res.text().catch(() => null) : null;
  },
};
