// ONE LINE PER TIMED-OUT UPSTASH REQUEST, NAMED BY KEY PREFIX (#553 CODE-B #144).
//
// Every client now carries a request deadline (lib/server/redisCacheMode.ts),
// and every caller turns the resulting throw into its own "absent" path -- so
// without this, a timeout would be as silent as the hang it replaced. The
// request's own signal cannot say which key it was for, so this sits at the
// fetch layer beside the size guard (lib/server/redisSizeGuard.ts, whose body
// parser it reuses): when an Upstash request fails with a TimeoutError it logs
//
//   [redis-timeout] <CMD|pipeline:n CMD> <key prefix>
//
// ONCE per command and key prefix per server instance (a bad minute is one line per key
// family, not one per request), then rethrows unchanged. Never a value, never
// a full key. Cost: zero Redis commands.
import { describeBody } from "./redisSizeGuard";

const MARK = "__mshRedisTimeoutLog";
type FetchLike = (input: unknown, init?: { body?: unknown; signal?: unknown } & Record<string, unknown>) => Promise<unknown>;

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "url" in input) return String((input as { url: unknown }).url);
  return String(input ?? "");
}

/** True for the abort AbortSignal.timeout raises, however the runtime surfaces it. */
export function isTimeoutAbort(err: unknown, signal?: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  const reason = (signal as { reason?: { name?: unknown } } | null | undefined)?.reason?.name;
  return name === "TimeoutError" || reason === "TimeoutError";
}

export function installRedisTimeoutLog(
  target: { fetch: FetchLike } = globalThis as unknown as { fetch: FetchLike },
  upstashUrl: string | undefined = process.env.UPSTASH_REDIS_REST_URL,
  log: Pick<Console, "warn"> = console
): boolean {
  if (!upstashUrl || typeof target.fetch !== "function") return false;
  const original = target.fetch;
  if ((original as unknown as Record<string, unknown>)[MARK]) return false;
  const base = upstashUrl.replace(/\/+$/, "");
  const seen = new Set<string>();
  const logged: FetchLike = async (input, init) => {
    try {
      return await original(input, init);
    } catch (err) {
      if (urlOf(input).startsWith(base) && isTimeoutAbort(err, init?.signal)) {
        const what = describeBody(init?.body);
        // Keyed without the pipeline's size: the client auto-pipelines, so the
        // same read arrives as "pipeline:1 GET x:" or "pipeline:3 GET x:".
        const family = what.replace(/^pipeline:\d+ /, "pipeline ");
        if (!seen.has(family)) {
          seen.add(family);
          log.warn(`[redis-timeout] ${what}`);
        }
      }
      throw err;
    }
  };
  Object.assign(logged, original as unknown as Record<string, unknown>);
  (logged as unknown as Record<string, unknown>)[MARK] = true;
  target.fetch = logged;
  return true;
}
