// The "next/cache" stub (see next-cache-stub-hooks.mjs). Records what a module
// revalidated, and runs unstable_cache's function uncached.
globalThis.__nextCacheStub ??= { revalidated: [], cached: [] };
export function revalidateTag(tag, profile) {
  globalThis.__nextCacheStub.revalidated.push([tag, profile]);
}
export function unstable_cache(fn, keyParts, options) {
  globalThis.__nextCacheStub.cached.push({ keyParts, options });
  return (...args) => fn(...args);
}
