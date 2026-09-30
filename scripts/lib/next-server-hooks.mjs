// Resolve "next/server" (and its siblings) to their .js files, for scripts that
// load a module importing them. Bare Node cannot: next has no exports map.
// Register with register("./next-server-hooks.mjs", import.meta.url).
const BARE = new Set(["next/server", "next/headers", "next/navigation"]);
export async function resolve(specifier, context, nextResolve) {
  if (BARE.has(specifier)) return nextResolve(`${specifier}.js`, context);
  return nextResolve(specifier, context);
}
