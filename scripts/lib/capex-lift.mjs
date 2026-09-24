// The pure XBRL parsers from lib/server/capexReceivers.ts, lifted without the
// module (which imports the Redis client). Shared by the baseline build and
// the check, so both run exactly the code the refresh job runs.
import fs from "node:fs";
import { lift } from "./earnings-plan.mjs";

export async function liftCapexParsers() {
  const src = fs.readFileSync("lib/server/capexReceivers.ts", "utf8");
  const start = src.indexOf("// ── XBRL parsing");
  const end = src.indexOf("// ── The refresh");
  if (start < 0 || end < 0) throw new Error("capex-lift: section markers not found in lib/server/capexReceivers.ts");
  const types = src.slice(src.indexOf("export type ReceiverGroup"), start);
  return lift(`${types}\n${src.slice(start, end)}`, "", "capexReceivers parsers");
}
