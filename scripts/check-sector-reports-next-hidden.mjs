// "WHO REPORTS NEXT" IS HIDDEN ON THE SECTOR PAGES (owner, in chat, 2026-10-05).
//
// Too hard to keep accurate, so the sector news page's Earnings This Week card
// is hidden behind SHOW_WHO_REPORTS_NEXT = false (not deleted): the card is not
// rendered, its list is not fetched (so the read's "N names reporting in the
// next week" sentence, which keys off it, never fires), and no sector copy
// promises "who reports next" or "upcoming earnings". Every rule has a mutant.
//
//   node scripts/check-sector-reports-next-hidden.mjs
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const NEWS = "app/sector/[slug]/news/page.tsx";
const HUB = "app/sector/page.tsx";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

function rules(newsRaw, hubRaw) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const news = stripComments(newsRaw, { file: NEWS });
  const hub = stripComments(hubRaw, { file: HUB });
  want("the switch is off", /const SHOW_WHO_REPORTS_NEXT = false;/.test(news));
  want("the card renders only behind the switch",
    /\{SHOW_WHO_REPORTS_NEXT \? \(\s*<SectorEarningsCard /.test(news) && (news.match(/<SectorEarningsCard /g) ?? []).length === 1);
  want("the list is fetched only behind the switch (the read's sentence keys off it)",
    /SHOW_WHO_REPORTS_NEXT \? getSectorEarningsThisWeek\(sector\.slug\) : Promise\.resolve\(\[\]/.test(news) &&
      (news.match(/getSectorEarningsThisWeek\(/g) ?? []).length === 1);
  for (const [f, src] of [[NEWS, news], [HUB, hub]]) {
    want(`${f}: no copy promises who reports next or upcoming earnings`, !/reports next|upcoming earnings/i.test(src));
  }
  return fails;
}

const newsSrc = read(NEWS);
const hubSrc = read(HUB);
console.log("\n1. The real pages");
const f = rules(newsSrc, hubSrc);
check("who reports next is hidden on the sector pages", f.length === 0, f.join("; "));

console.log("\n2. Planted mutants");
const MUTANTS = [
  ["the switch back on", "news", "const SHOW_WHO_REPORTS_NEXT = false;", "const SHOW_WHO_REPORTS_NEXT = true;"],
  ["the card rendered ungated", "news", "              {SHOW_WHO_REPORTS_NEXT ? (\n                <SectorEarningsCard", "              {true ? (\n                <SectorEarningsCard"],
  ["the list fetched ungated", "news", "SHOW_WHO_REPORTS_NEXT ? getSectorEarningsThisWeek(sector.slug) : Promise.resolve([] as SectorEarningsEntry[]),", "getSectorEarningsThisWeek(sector.slug),"],
  ["the hub promises it again", "hub", "shows who is driving it and how broad the move is.", "shows who is driving it, how broad the move is, and who reports next."],
];
for (const [label, which, from, to] of MUTANTS) {
  const src = which === "news" ? newsSrc : hubSrc;
  if (!src.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
  const m = src.replace(from, to);
  const fl = which === "news" ? rules(m, hubSrc) : rules(newsSrc, m);
  check(`mutant "${label}" is caught`, fl.length > 0, fl[0] ?? "no rule failed");
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
