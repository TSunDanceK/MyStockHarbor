// THE SPLIT ADJUSTMENT, AS SOURCE FOR A LIFTED UNIT (#552 COWORK #187 §1).
//
// secEarningsView, secValuation and secDividend call splitAdjusted at entry, so
// every harness that concatenates one of them needs it declared too. ONE home
// for that list: secSplitAdjust stripped of its imports, plus the three
// secShareHistory names it reads (the module whole would collide in a
// concatenated unit). It needs `cell` and SEC_FIELD_KEYS, which every such
// unit already carries (secFactCodec, secFields).
import fs from "node:fs";
import { grabConst } from "./source-code.mjs";
import { grabFunction } from "./earnings-plan.mjs";

/** `withHistory: false` for a unit that already carries secShareHistory's split names. */
export function splitAdjustSource({ withHistory = true } = {}) {
  const history = fs.readFileSync("lib/server/secShareHistory.ts", "utf8");
  const own = fs.readFileSync("lib/server/secSplitAdjust.ts", "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
  if (!withHistory) return own;
  return [
    grabConst("lib/server/secShareHistory.ts", "SHARE_SPLIT_RATIOS"),
    grabConst("lib/server/secShareHistory.ts", "SHARE_SPLIT_TOLERANCE"),
    grabConst("lib/server/secShareHistory.ts", "SHARE_PROVEN_SPLIT_YEARS"),
    grabFunction(history, "splitRatioOf").replace(/^export /, ""),
    own,
  ].join("\n");
}
