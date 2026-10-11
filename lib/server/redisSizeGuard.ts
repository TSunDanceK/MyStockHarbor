// THE REQUEST-SIZE GUARD AT THE FETCH LAYER (#553 COWORK #84, 2026-10-01).
//
// Upstash's "Max Request Size Limit is Reached" email names a database and a
// 15-minute window, never a command or key, and every write path here is
// fail-open, so a rejected request leaves no trace. The 1 Oct 07:12-07:27 UTC
// hit could not be attributed for exactly that reason.
//
// ONE PLACE FOR EVERY SESSION'S WRITES: @upstash/redis calls the global fetch
// at request time, so wrapping it once (instrumentation.ts register()) sees
// every REST request -- single command, pipeline or multi-exec -- from A's, B's
// and C's code without touching any of their files.
//
//   > REDIS_SIZE_LOG_BYTES (5 MB):     console.warn  [redis-size] <cmd|pipeline:n> <key prefix> <bytes>
//   > REDIS_SIZE_REFUSE_BYTES (9.5 MB): console.error [redis-size] REFUSED ... and THROW,
//                                        so the caller's own catch path runs. Never sent.
//
// The log carries the command name, a KEY PREFIX (the key up to its last ':')
// and a byte count. Never a value, never a full key. Cost: zero Redis commands.

import { REQUEST_BYTE_BUDGET } from "./chunkByBytes";

// THE WARN LINE IS OUR OWN BUDGET (#553 COWORK #92, 2 Oct): at 2 MB it named
// every Pickers build, whose one payload chunk sits at ~4 MB by design under
// the 5 MB REQUEST_BYTE_BUDGET. Now it names only a request over the budget
// our own writers chunk to -- which is the one worth a line.
export const REDIS_SIZE_LOG_BYTES = REQUEST_BYTE_BUDGET;
export const REDIS_SIZE_REFUSE_BYTES = 9.5 * 1024 * 1024;

const GUARD_MARK = "__mshRedisSizeGuard";

type FetchLike = (input: unknown, init?: { body?: unknown } & Record<string, unknown>) => Promise<unknown>;

/** The key up to its last ':' (e.g. "msh:tiingo:eod:v2:"); a key with no ':' shows only its first 3 characters. */
export function keyPrefix(key: unknown): string {
  const k = typeof key === "string" ? key : "";
  if (!k) return "-";
  const i = k.lastIndexOf(":");
  return i > 0 ? k.slice(0, i + 1) : `${k.slice(0, 3)}…`;
}

/** UTF-8 length of a request body, without encoding a body that cannot reach the log threshold. */
export function bodyBytes(body: unknown, floor = REDIS_SIZE_LOG_BYTES): number {
  if (typeof body !== "string") return 0;
  // A UTF-16 code unit is at most 3 UTF-8 bytes, so a short string is skipped cheaply.
  if (body.length * 3 < floor) return body.length;
  return new TextEncoder().encode(body).length;
}

/** "SET msh:foo:" or "pipeline:25 SET msh:tiingo:eod:v2:" from a request body. */
export function describeBody(body: unknown): string {
  try {
    const parsed = JSON.parse(String(body));
    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
      const first = parsed[0] as unknown[];
      return `pipeline:${parsed.length} ${String(first[0] ?? "?").toUpperCase()} ${keyPrefix(first[1])}`;
    }
    if (Array.isArray(parsed)) return `${String(parsed[0] ?? "?").toUpperCase()} ${keyPrefix(parsed[1])}`;
  } catch {
    // not JSON: describe it by size alone
  }
  return "unparsed -";
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "url" in input) return String((input as { url: unknown }).url);
  return String(input ?? "");
}

/**
 * Wrap target.fetch so Upstash requests are measured before they are sent.
 * Idempotent. Properties on the original fetch (Next's patch markers) are
 * carried over, so Next does not see an unpatched fetch and wrap it twice.
 */
export function installRedisSizeGuard(
  target: { fetch: FetchLike } = globalThis as unknown as { fetch: FetchLike },
  upstashUrl: string | undefined = process.env.UPSTASH_REDIS_REST_URL,
  log: Pick<Console, "warn" | "error"> = console
): boolean {
  if (!upstashUrl || typeof target.fetch !== "function") return false;
  const original = target.fetch;
  if ((original as unknown as Record<string, unknown>)[GUARD_MARK]) return false;
  const base = upstashUrl.replace(/\/+$/, "");
  const guarded: FetchLike = async (input, init) => {
    if (urlOf(input).startsWith(base)) {
      const bytes = bodyBytes(init?.body);
      if (bytes > REDIS_SIZE_LOG_BYTES) {
        const what = describeBody(init?.body);
        if (bytes > REDIS_SIZE_REFUSE_BYTES) {
          log.error(`[redis-size] REFUSED ${what} ${bytes} bytes (over ${REDIS_SIZE_REFUSE_BYTES}; Upstash rejects 10 MB)`);
          throw new Error(`[redis-size] request refused: ${what} ${bytes} bytes`);
        }
        log.warn(`[redis-size] ${what} ${bytes} bytes`);
      }
    }
    return original(input, init);
  };
  Object.assign(guarded, original as unknown as Record<string, unknown>);
  (guarded as unknown as Record<string, unknown>)[GUARD_MARK] = true;
  target.fetch = guarded;
  return true;
}
