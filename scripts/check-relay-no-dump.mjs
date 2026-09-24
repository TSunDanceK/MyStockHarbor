// NO RELAY TASK DEPENDS ON THE STEP 0 FMP DUMP (#552 COWORK #23).
//
// relay.yml's default run_id pointed at the Step 0 dump artifact. That
// artifact was FMP data and is deleted, so any dispatch without a run_id
// failed at the download step, and a dump download is the one way FMP data
// could re-enter a relay run.
//
//   1. relay.yml references no step0 artifact, downloads no artifact, and
//      takes no run_id / artifact_name input. MUTATION: the old download step
//      put back is caught.
//   2. relay-run.mjs refuses every task marked needsDump, unconditionally.
//      MUTATION: the old "only when DUMP_DIR is empty" guard is caught.
//
//   node scripts/check-relay-no-dump.mjs
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const dumpFree = (yml) => ({
  noStep0: !/step0/i.test(yml),
  noDownload: !/actions\/download-artifact/.test(yml),
  noInputs: !/^\s{6}(run_id|artifact_name):/m.test(yml) && !/inputs\.(run_id|artifact_name)/.test(yml),
  noDumpEnv: !/\bDUMP_(DIR|RUN_ID|ARTIFACT)\b/.test(yml),
});

console.log("1. relay.yml");
const YML = fs.readFileSync(".github/workflows/relay.yml", "utf8");
const r = dumpFree(YML);
check("no step0 reference", r.noStep0);
check("no artifact download step", r.noDownload);
check("no run_id / artifact_name input", r.noInputs);
check("no DUMP_* env passed to the task", r.noDumpEnv);
{
  const mutated = YML.replace("      - name: Run the task",
    "      - name: Download the frozen dump\n        uses: actions/download-artifact@v4\n        with:\n          name: step0-dump\n\n      - name: Run the task");
  const m = dumpFree(mutated);
  check("MUTATION: the download step put back is caught", mutated !== YML && !m.noStep0 && !m.noDownload);
}

console.log("\n2. relay-run.mjs refuses dump tasks outright");
const RUN = readCodeOnly("scripts/relay-run.mjs");
const refuses = (code) => /if \(spec\.needsDump\) \{[\s\S]{0,400}?process\.exit\(2\);/.test(code);
check("any needsDump task exits 2, whatever DUMP_DIR holds", refuses(RUN));
check("MUTATION: the old DUMP_DIR-only guard is caught",
  !refuses(RUN.replace("if (spec.needsDump) {", "if (spec.needsDump && !process.env.DUMP_DIR) {")));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
