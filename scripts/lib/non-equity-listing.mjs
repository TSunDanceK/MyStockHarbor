// A's nonEquityListingOf (lib/server/secPrimaryListing.ts), for scripts that run
// under the relay's loader, which has no "@/" alias. The module is loaded as it
// is, with each `import x from "@/data/....json"` inlined -- the same approach
// A's check-primary-listings uses -- so the answer is A's rule, never a copy.
// A new "@/" import the loader cannot inline fails loudly rather than silently.
// The caller must have registered the TS loader (register-ts-here).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function loadNonEquityListingOf(root = process.cwd()) {
  return (await loadSecPrimaryListing(root)).nonEquityListingOf;
}

// The whole module, for scripts that need more than one of A's exports
// (citedCoverFor, #552 COWORK #86b), loaded the same way.
export async function loadSecPrimaryListing(root = process.cwd()) {
  const src = fs.readFileSync(path.join(root, "lib/server/secPrimaryListing.ts"), "utf8");
  const inlined = src.replace(/^import (\w+) from "@\/(data\/[^"]+\.json)";$/gm,
    (_, name, file) => `const ${name} = ${fs.readFileSync(path.join(root, file), "utf8")};`);
  if (/from "@\//.test(inlined)) throw new Error("secPrimaryListing has an @/ import this loader cannot inline");
  const tmp = path.join(root, `lib/server/.nel-${process.pid}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(tmp, inlined);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
