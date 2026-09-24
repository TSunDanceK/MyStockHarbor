// WHAT A LOCATOR CHANGE MOVES, BEFORE IT SHIPS (#552 COWORK #38).
// For every 10-K registrant in the shard: the latest 10-K, located and cleaned
// by this branch's lib/server/secDescription.ts and by main's, and a line for each symbol
// whose description or excerpt CHANGES (the first 160 characters of each).
// SEC text only; read-only, no credential. ≤8 requests/s.
//   SHARD=1/6 node scripts/sec-description-locator-census.mjs
import fs from "node:fs";
import { execSync } from "node:child_process";
import { readCodeOnly, stripComments } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; locator census)";
const [K, N] = (process.env.SHARD || "1/1").split("/").map(Number);
const BUDGET_MS = Number(process.env.BUDGET_MS || 26 * 60 * 1000);
const started = Date.now();
const SRC = readCodeOnly("lib/server/secDescription.ts");
// THE BASELINE IS MAIN'S OWN FILE, fetched on the runner (the repo is public),
// so the census measures exactly this branch's change to the locator.
execSync("git fetch --quiet --depth=1 origin main", { stdio: "inherit" });
const BASE = execSync("git show FETCH_HEAD:lib/server/secDescription.ts", { encoding: "utf8", maxBuffer: 16 << 20 });
if (BASE === fs.readFileSync("lib/server/secDescription.ts", "utf8")) throw new Error("the branch's locator is main's: nothing to compare");
const NEW = await lift(SRC);
const OLD = await lift(stripComments(BASE));
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const mine = only.length ? only : Object.keys(REG).sort().filter((s, i) => i % N === K - 1 && REG[s]?.cik && /^10-K/.test(REG[s]?.annualForm ?? ""));
let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(String(res.status));
  return as === "json" ? res.json() : res.text();
}
const describe = (M, text, form, name) => {
  const loc = M.locateSection(text, form);
  if (!loc.found) return { d: `MISS ${loc.why}`, x: "" };
  const c = M.cleanDescription(loc.body, { companyName: name });
  return { d: c.ok ? c.text : `MISS ${c.why}`, x: M.itemExcerpt(loc.body).slice(0, 400) };
};
let reached = 0, changed = 0, errors = 0;
for (const s of mine) {
  if (Date.now() - started > BUDGET_MS) break;
  reached++;
  try {
    const sub = await get(`https://data.sec.gov/submissions/CIK${REG[s].cik}.json`);
    const r = sub.filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f) => /^10-K/.test(f));
    if (i < 0) continue;
    const html = await get(`https://www.sec.gov/Archives/edgar/data/${Number(REG[s].cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`, "text");
    const text = NEW.filingText(html);
    const a = describe(OLD, text, r.form[i], sub.name ?? null), b = describe(NEW, text, r.form[i], sub.name ?? null);
    if (a.d !== b.d || a.x !== b.x) {
      changed++;
      console.log(`CHANGED ${s}${a.d === b.d ? " (excerpt only)" : ""}\n  old: ${a.d.slice(0, 160)}\n  new: ${b.d.slice(0, 160)}`);
    }
  } catch (e) { errors++; console.log(`ERROR ${s}: ${String(e?.message ?? e).slice(0, 80)}`); }
}
console.log(`\nshard ${K}/${N}: ${mine.length} 10-K symbols, reached ${reached}, changed ${changed}, errors ${errors}, ${Math.round((Date.now() - started) / 1000)}s`);
