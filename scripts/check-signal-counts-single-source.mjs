// One definition of getBuySignalCount, and a record of why getSellSignalCount
// is still three.
//
// getBuySignalCount shipped as three byte-identical copies -- PickerResultPage,
// PickersClient, DashboardTicker. Identical today, so no live bug; add a tenth
// condition to one and the dashboard ticker and the picker page silently
// disagree about the same stock (claude/traps/two-validators-for-one-value.md).
//
// getSellSignalCount was believed identical too. IT IS NOT, and that is the
// finding this script pins. See section 2.
//
//   node scripts/check-signal-counts-single-source.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const codeOf = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (l.trim().startsWith("//") ? "" : l))
    .join("\n");

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(e.name)) files.push(full);
  }
};
walk(path.join(ROOT, "app"));
walk(path.join(ROOT, "lib"));

const definersOf = (name) =>
  files
    .filter((f) => new RegExp(`function ${name}\\s*\\(`).test(codeOf(fs.readFileSync(f, "utf8"))))
    .map((f) => path.relative(ROOT, f));

console.log("\n=== 1. getBuySignalCount has exactly one definition ===\n");
const buy = definersOf("getBuySignalCount");
check("exactly one definition in the tree", buy.length === 1, buy.join(", ") || "none found");
check("...and it is the shared leaf module", buy[0] === "lib/signalCounts.ts", buy[0]);
// A shared module nothing imports is a fourth copy with extra steps.
for (const consumer of [
  "app/components/PickerResultPage.tsx",
  "app/pickers/PickersClient.tsx",
  "app/components/DashboardTicker.tsx",
]) {
  check(
    `${path.basename(consumer)} imports it rather than redefining it`,
    /import \{ getBuySignalCount \} from "@\/lib\/signalCounts"/.test(fs.readFileSync(path.join(ROOT, consumer), "utf8"))
  );
}

console.log("\n=== 2. The rules were NOT changed ===\n");
// The brief parked the conditions themselves as a product question. This asserts
// the moved arithmetic is the original: nine conditions, the aboveMA200 gate,
// and aboveMA200 counted as one of the nine as well as gating.
const shared = codeOf(fs.readFileSync(path.join(ROOT, "lib/signalCounts.ts"), "utf8"));
const body = (shared.match(/export function getBuySignalCount[\s\S]*?\n\}/) ?? [""])[0];
check("the aboveMA200 gate is intact", /if \(!record\.aboveMA200\) return 0;/.test(body));
check("nine conditions, no more and no fewer", (body.match(/count \+= 1;/g) ?? []).length === 9, `${(body.match(/count \+= 1;/g) ?? []).length}`);
for (const flag of [
  "oversold", "buyTheDip", "breakout", "volumeSpike", "atrSpike",
  "aboveMA50", "aboveMA200", "bullishRsiDivergence", "bullishMacdDivergence",
]) {
  check(`counts ${flag}`, new RegExp(`if \\(record\\.${flag}\\) count \\+= 1;`).test(body));
}

console.log("\n=== 3. getSellSignalCount is deliberately NOT collapsed ===\n");
// THE FINDING. The three copies disagree today, on live data. DashboardTicker
// opens with `if (!r.belowMA200) return 0;` and the other two do not, so a stock
// that is overbought and below its MA50 but NOT below its MA200 scores 2 on the
// picker pages and 0 on the dashboard ticker.
//
// Collapsing that means picking a winner, which is a change to the rules rather
// than a deduplication -- and the rules are parked. So the divergence is pinned
// here instead: if someone unifies them, this fails and they have to say which
// behaviour they chose.
const sell = definersOf("getSellSignalCount");
check("still three definitions, pending the product decision", sell.length === 3, sell.join(", "));
const gated = sell.filter((f) =>
  /function getSellSignalCount[\s\S]{0,120}if \(!\w+\.belowMA200\) return 0;/.test(codeOf(fs.readFileSync(path.join(ROOT, f), "utf8")))
);
check(
  "exactly one of them carries the belowMA200 gate — the live disagreement",
  gated.length === 1 && gated[0] === "app/components/DashboardTicker.tsx",
  `gated: ${gated.join(", ") || "none"}`
);
check(
  "the shared module records why sell is absent",
  /getSellSignalCount is NOT here/.test(fs.readFileSync(path.join(ROOT, "lib/signalCounts.ts"), "utf8")),
  "an omission with no note reads as an oversight"
);

console.log(`\n${failures ? `FAILED (${failures})` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
