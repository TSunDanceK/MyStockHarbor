// Point "next/server" at after-timing-stub.mjs (everything else unchanged).
export async function resolve(specifier, context, nextResolve) {
  if ((specifier === "next/server" || specifier === "next/server.js") && !String(context.parentURL ?? "").endsWith("after-timing-stub.mjs")) {
    return { url: new URL("./after-timing-stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
