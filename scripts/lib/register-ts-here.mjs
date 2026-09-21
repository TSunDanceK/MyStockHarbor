// Register the .ts resolve hook from INSIDE a script, for harnesses that must
// run bare.
//
// WHY THIS EXISTS. scripts/lib/register-ts.mjs is meant for
// `node --import ./scripts/lib/register-ts.mjs <script>` -- which works for the
// relay, where relay-run.mjs passes the flag. It does NOT work for
// scripts/check-all.mjs, which runs every check-*.mjs with a bare
// `execFileSync(process.execPath, [script])` and has no way to know a script
// wants a loader flag.
//
// THE CONSEQUENCE WAS A CHECK THAT COULD NOT PASS. check-ipo-split-fixtures.mjs
// imports lib/server/ipoSecSource.ts, whose own `from "./ipoExclusions"` has no
// extension, so bare Node cannot resolve it: ERR_MODULE_NOT_FOUND. In the
// suite that reads as a red line next to 98 green ones -- and the fixtures it
// was written to run (every exclusion rule, each with its negative control)
// were not running at all. A harness nobody can run is a harness that cannot
// fail, which is the same shape as the bugs it exists to catch.
//
// THE CALLER MUST USE A DYNAMIC import() AFTER AWAITING THIS. A static `import`
// declaration is hoisted and resolved before any statement in the module body
// runs, so registering the hook beside one is too late by construction.
//
// Node >= 22.18 strips types with no flag, so nothing else is needed.
import { register } from "node:module";

register("./ts-resolve.mjs", import.meta.url);
