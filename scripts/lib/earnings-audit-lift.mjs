// The SEC earnings pipeline lifted twice — this branch's source and main's,
// fetched on the runner — for the earnings audit round 1 scripts. Both sides go
// through one module list, so "before" is what production runs and "after" is
// the same code with this branch's edits.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { stripComments, grabConst, readCodeOnly } from "./source-code.mjs";
import { lift, grabFunction } from "./earnings-plan.mjs";

export const MODULES = [
  "lib/server/secFields.ts", "lib/server/secExtract.ts", "lib/server/fxRates.ts",
  "lib/server/secCurrency.ts", "lib/server/secFactCodec.ts", "lib/server/secFactBuild.ts",
  "lib/server/secStaleness.ts", "lib/server/secShareHistory.ts", "lib/server/secSplitAdjust.ts",
  "lib/server/secEarningsView.ts", "lib/server/secPresentation.ts", "lib/server/secEarningsScore.ts",
];
const stripImports = (src) => src.replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/^export \* from "\.\/[^"]+";$/gm, "");

async function load(read, label) {
  const parts = MODULES.map((f) => stripImports(stripComments(read(f), { file: f })));
  // secFactBuild's keptWithNewer closes over these; read from the source.
  const extra = [grabConst("lib/server/secReportDates.ts", "DEADLINE_FALLBACK"),
    grabConst("lib/server/secValuation.ts", "COVER_SHARES_MAX_AGE_DAYS"),
    grabFunction(readCodeOnly("lib/server/secCoverAuto.ts"), "coverIsUsable").replace(/^export /, "")].join("\n");
  return lift(parts.join("\n"), extra, label);
}

/** { NEW, OLD }: OLD is null when main cannot be fetched (printed, never silent). */
export async function loadMainAndBranch() {
  let mainRead = null;
  try {
    execSync("git fetch --depth=1 origin main", { stdio: "ignore" });
    mainRead = (f) => execSync(`git show FETCH_HEAD:${f}`, { encoding: "utf8", maxBuffer: 64 << 20 });
  } catch (e) {
    console.log(`main could not be fetched (${e.message}); BRANCH ONLY`);
  }
  const NEW = await load((f) => fs.readFileSync(f, "utf8"), "branch");
  const OLD = mainRead ? await load(mainRead, "main") : null;
  return { NEW, OLD };
}
