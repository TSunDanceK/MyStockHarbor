// "Classification needed" helper (Relay B, #553 COWORK #3).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. THE HELPER WRITES THE OVERRIDES FILE. Approvals land by PR; the runner
//      and workflow must never touch data/sec/classification-overrides.json.
//   2. A LINK OR A HANDLE IN A PUBLIC ISSUE. Descriptions quote filings, which
//      carry URLs; the body must carry none.
//   3. A SUGGESTION FROM OUTSIDE THE LABEL SET, or outside the symbol's known
//      sector -- a guess dressed as a suggestion.
//   4. THE ISSUE NEVER CLOSES, or closes on no data (an unreadable universe must
//      stop the run, not empty the list).
//   5. THE BODY OUTGROWS GITHUB'S 65,536-CHARACTER LIMIT and the update fails.
//
//   node scripts/check-classification-helper.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CORE = "scripts/lib/classification-needed.mjs";

let seq = 0;
async function load(src) {
  const file = path.join(ROOT, "scripts/lib", `.check-cn-${process.pid}-${seq++}.mjs`);
  fs.writeFileSync(file, src);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

const LABELS = { Semiconductors: "Technology", "Software - Application": "Technology", Aluminum: "Basic Materials", "Asset Management": "Financial Services", Banks: "Financial Services" };
const data = {
  overrides: { OVR: { sector: "Technology", industry: "Software - Application" } },
  registrants: { AA: { sic: "3334" }, CHIP: { sic: "3674" }, NONE: {}, MG: { sic: "7389" }, OVR: { sic: "7389" } },
  classification: { labels: LABELS, codes: { 3334: { sector: "Basic Materials", industry: null, sec: "Primary Production of Aluminum" }, 3674: { sector: "Technology", industry: "Semiconductors", sec: "Semiconductors" } }, majorGroups: { 73: null } },
  descriptions: { AA: ["10-K", "", "", "Alcoa (see https://example.com, www.example.com, ir@example.com | x) makes aluminum and runs software application tools. More text."], MG: ["10-K", "", "", "A leading provider of fleet management services."] },
  names: { AA: "Alcoa Corporation Common Stock", CHIP: "Chip Co", MG: "Mystery Group Inc. Class A Common Stock" },
};

async function suite(M, sources) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  const { missing, changed } = M.buildRows(["AA", "CHIP", "NONE", "MG", "OVR"], data, { N1: { symbol: "CHIP", was: "3674", now: "3334", description: "Primary Production of Aluminum", seenOn: "2026-09-24" } });
  const ids = missing.map((r) => r.symbol).sort().join();
  ok("only symbols the resolver cannot FULLY place are listed", ids === "AA,MG,NONE", ids);
  ok("an override counts as placed", !missing.some((r) => r.symbol === "OVR"));
  const aa = missing.find((r) => r.symbol === "AA");
  ok("a known sector narrows the suggestion to its own industries", aa.suggestion?.sector === "Basic Materials" && aa.suggestion?.industry === "Aluminum", JSON.stringify(aa.suggestion));
  const mg = missing.find((r) => r.symbol === "MG");
  ok("with no sector, one shared word is not a suggestion", mg.suggestion === null, JSON.stringify(mg.suggestion));
  ok("every suggestion is a label from the set", missing.every((r) => !r.suggestion?.industry || LABELS[r.suggestion.industry] === r.suggestion.sector));
  ok("company names drop the instrument words", aa.name === "Alcoa Corporation" && mg.name === "Mystery Group Inc.", `${aa.name} | ${mg.name}`);
  ok("SIC-change notices are listed with the new code's classification", changed.length === 1 && changed[0].now === "3334" && changed[0].suggestion?.sector === "Basic Materials");

  const body = M.issueBody({ missing, changed }, "2026-09-24", 5);
  ok("the body has no links, domains or handles", !/https?:|www\.|@/i.test(body), body.match(/https?:\S+|www\.\S+|\S+@\S+/)?.[0] ?? "");
  ok("pipes in quoted text cannot break the table", body.split("\n").filter((l) => l.startsWith("| AA ")).every((l) => l.split("|").length === 8));
  ok("the body says approvals land by PR and the helper never edits the file", /in a PR/.test(body) && /never edits that file/.test(body));
  const many = { missing: Array.from({ length: 900 }, (_, i) => ({ ...aa, symbol: `S${i}`, description: "x".repeat(140) })), changed: [] };
  const big = M.issueBody(many, "2026-09-24", 900);
  ok("a long list stays inside GitHub's issue limit", big.length < 65_536 && /more, listed on the next runs/.test(big), String(big.length));

  ok("an empty list closes the open issue", M.issueAction({ number: 1, body: "x" }, null).kind === "close");
  ok("an empty list with no issue does nothing", M.issueAction(null, null).kind === "none");
  ok("rows and no issue create one; a changed body updates it", M.issueAction(null, "b").kind === "create" && M.issueAction({ body: "a" }, "b").kind === "update" && M.issueAction({ body: "b" }, "b").kind === "none");

  ok("the runner never writes the overrides file", !/writeFile|appendFile|createWriteStream/.test(sources.runner) && !/classification-overrides\.json["'`]?\s*,\s*[^)]*\bw/.test(sources.runner));
  ok("the runner refuses to act on an unreadable universe", /is empty or unreadable -- refusing to close the issue on no data/.test(sources.runner));
  ok("the workflow can only write issues", /permissions:\s*\n\s*contents: read\s*\n\s*issues: write/.test(sources.workflow) && !/contents: write|pull-requests: write/.test(sources.workflow));
  return fails;
}

const src = read(CORE);
const sources = { runner: read("scripts/classification-needed.mjs"), workflow: read(".github/workflows/classification-needed.yml") };
const base = await suite(await load(src), sources);
if (base.length) {
  console.error("FAIL check-classification-helper:\n  " + base.join("\n  "));
  process.exit(1);
}
const mut = (label, s, from, to) => {
  if (!s.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return s.replace(from, () => to);
};
const MUTANTS = [
  ["placed symbols listed too", () => mut("placed", src, "if (t.sector && t.industry) continue;", "")],
  ["URLs kept in cells", () => mut("url", src, '.replace(/https?:\\/\\/\\S+/gi, "")', "")],
  ["suggestions ignore the known sector", () => mut("sector", src, "if (sector && labelSector !== sector) continue;", "")],
  ["one word enough with no sector", () => mut("floor", src, "const floor = sector ? 1 : 2;", "const floor = 1;")],
  ["never closes", () => mut("close", src, 'if (body === null) return existing ? { kind: "close" } : { kind: "none" };', 'if (body === null) return { kind: "none" };')],
  ["no row cap", () => mut("cap", src, "missing.slice(0, MAX_ROWS)", "missing")],
];
let survived = 0;
for (const [label, make] of MUTANTS) {
  if (!(await suite(await load(make()), sources)).length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-classification-helper: all assertions pass; ${MUTANTS.length} mutants caught`);
