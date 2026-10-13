// A DEADLINE ON EVERY OUTSIDE FETCH THE NEWS BUILD MAKES (#553 COWORK #170/#171).
//
// ── WHY (/dashboard "Task timed out after 300 seconds") ──────────────────
// The page's own reads are bounded (sourceBudget.ts, the Redis deadlines of
// #780). What held the function open was Next's BACKGROUND refresh: when a
// cached entry is stale, Next answers with the stale value and refreshes it
// after the response, handing that refresh to waitUntil -- so the invocation
// lives until the refresh settles. Two kinds of entry do this:
//   - an `unstable_cache` entry (the news base, revalidated hourly), whose
//     rebuild ran outside fetches with no deadline;
//   - a `fetch(url, { next: { revalidate } })` entry, which Next refetches
//     with the caller's `signal` STRIPPED (patch-fetch: "don't pass through
//     signal when revalidating"). A signal on such a fetch does not bound it.
// One outside host that never answers then costs 300 s of function time.
//
// ── SO ───────────────────────────────────────────────────────────────────
// fetchWithDeadline: `cache: "no-store"` (Next's fetch cache never sees it, so
// it never refreshes it unbounded) and a FRESH AbortSignal.timeout per request
// -- the function form, built at call time, never one shared signal. The
// deadline also covers reading the body. An abort throws.
//
// cachedOutsideText: where a fetch was cached across requests, the caching
// moves to our own unstable_cache around the bounded fetch, so Next's
// background refresh runs OUR code, deadline included. Same revalidate as
// the fetch had. A non-2xx answer throws, so it is never cached.
//
// "[fetch-timeout] <host>" is logged once per host per instance, so the next
// hang names itself.
//
// scripts/check-outside-fetch-deadlines.mjs: every fetch reachable from the
// news base build goes through here or carries its own signal, with a stub
// server that never answers.
import { unstable_cache } from "next/cache";

/** Each outside request's deadline, headers and body together. */
export const OUTSIDE_FETCH_TIMEOUT_MS = 8_000;

export class OutsideFetchError extends Error {
  readonly host: string;
  readonly status: number;
  constructor(host: string, status: number) {
    super(`outside fetch ${host} answered ${status}`);
    this.host = host;
    this.status = status;
  }
}

const timedOutHosts = new Set<string>();

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
};

export type OutsideFetchDeps = {
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  ms?: number;
};

/** `fetch`, never cached by Next, aborted after `ms` (headers and body). Throws on abort. */
export async function fetchWithDeadline(
  url: string,
  init: Omit<RequestInit, "signal" | "cache"> = {},
  deps: OutsideFetchDeps = {}
): Promise<Response> {
  const ms = deps.ms ?? OUTSIDE_FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(ms);
  try {
    return await (deps.fetchImpl ?? fetch)(url, { ...init, cache: "no-store", signal });
  } catch (err) {
    if (signal.aborted) noteTimeout(url, ms, deps.log);
    throw err;
  }
}

/** The body as text, inside the same deadline. A non-2xx answer throws. */
export async function outsideText(
  url: string,
  headers: Record<string, string> = {},
  deps: OutsideFetchDeps = {}
): Promise<string> {
  const ms = deps.ms ?? OUTSIDE_FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(ms);
  try {
    const res = await (deps.fetchImpl ?? fetch)(url, { headers, cache: "no-store", signal });
    if (!res.ok) throw new OutsideFetchError(hostOf(url), res.status);
    return await res.text();
  } catch (err) {
    if (signal.aborted) noteTimeout(url, ms, deps.log);
    throw err;
  }
}

function noteTimeout(url: string, ms: number, log: ((line: string) => void) | undefined) {
  const host = hostOf(url);
  if (timedOutHosts.has(host)) return;
  timedOutHosts.add(host);
  (log ?? ((line: string) => console.warn(line)))(`[fetch-timeout] ${host} gave no answer within ${ms}ms -- aborted`);
}

const cachedByRevalidate = new Map<number, (url: string, headersJson: string) => Promise<string>>();

/**
 * outsideText behind our own Data Cache entry, refreshed every `revalidateSeconds`.
 * Keyed by URL and headers. The entry holds the text, so it must stay under
 * Next's 2 MB per-entry limit (an RSS feed, a symbol directory file).
 */
export function cachedOutsideText(revalidateSeconds: number) {
  let cached = cachedByRevalidate.get(revalidateSeconds);
  if (!cached) {
    cached = unstable_cache(
      (url: string, headersJson: string) => outsideText(url, JSON.parse(headersJson) as Record<string, string>),
      ["msh-outside-text-v1", String(revalidateSeconds)],
      { revalidate: revalidateSeconds }
    );
    cachedByRevalidate.set(revalidateSeconds, cached);
  }
  const run = cached;
  return (url: string, headers: Record<string, string> = {}) => run(url, JSON.stringify(headers));
}
