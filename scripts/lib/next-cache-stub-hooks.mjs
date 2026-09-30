// Resolve "next/cache" to a stub, for checks that load a module which calls
// revalidateTag or unstable_cache. Bare Node cannot resolve "next/cache" (no
// exports map), and the real one needs a Next request context anyway.
// Register it with register("./next-cache-stub-hooks.mjs", import.meta.url).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/cache") return nextResolve(new URL("./next-cache-stub.mjs", import.meta.url).href, context);
  return nextResolve(specifier, context);
}
