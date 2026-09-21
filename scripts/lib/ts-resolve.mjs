// Let a plain .mjs on the runner import the app's TypeScript modules unchanged.
//
// WHY THIS EXISTS RATHER THAN AN EDIT TO THE APP. Node's ESM loader requires an
// explicit extension on relative specifiers; TypeScript's `bundler` resolution
// does not, so lib/server/*.ts is written as `from "./ipoExclusions"` throughout
// and Node cannot resolve it. The seed script needs those modules because the
// alternative is re-implementing the exclusion rules, which is the failure this
// whole arrangement exists to prevent.
//
// THE TWO ALTERNATIVES WERE BOTH WORSE:
//   - Add `allowImportingTsExtensions` to tsconfig and rewrite the imports as
//     "./ipoExclusions.ts". That is a REPO-WIDE resolution change affecting every
//     Next build, and `next build` CANNOT BE RUN IN THIS SANDBOX (the ISR'd
//     screener pages need Upstash credentials and the export aborts). Shipping an
//     unverifiable build-config change to a production app to make one script
//     work is a bad trade.
//   - Give the seed its own copy of the rules. That is the thing being avoided.
//
// So the shim is scoped to the process that needs it: one resolve hook, no app
// file touched, no tsconfig touched, and nothing about the deployed build
// changes.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[mc]?[jt]s$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through: a genuinely missing module should report itself as such,
      // not as a failure to find a .ts that was never expected to exist.
    }
  }
  return nextResolve(specifier, context);
}
