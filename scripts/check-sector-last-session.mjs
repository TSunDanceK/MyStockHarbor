// "Sector today" outside market hours (Relay B, #553 COWORK #12, 2026-09-24).
//
// WHAT IS AT RISK, none of which breaks a build:
//   1. "--" ALL EVENING AGAIN. After the close no quote is under 30 minutes
//      old, so every sector's move was null from 16:00 until the next open.
//   2. A STALE MOVE COUNTS. A quote last refreshed at 15:20 is not the close.
//   3. THE LABEL LIES. A last-session number shown as "today", or the wrong
//      session named (Friday on a Monday morning; the prior day after a close).
//   4. WINTER. New York is UTC-5 from November: a close computed as 20:00 UTC
//      is an hour early for four months a year (marketHours.ts's warning).
//
// Runs the real modules, then every assertion again on mutated copies; each
// mutant must be caught.
//
//   node scripts/check-sector-last-session.mjs
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCodeOnly } from "./lib/source-code.mjs";

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LAST = "lib/server/lastSession.ts";
const TEMPLATES = "lib/sector-news-templates.ts";
const MAX_AGE = 30 * 60 * 1000;
const at = (iso) => Date.parse(iso);

let seq = 0;
async function loadSibling(relFile, source) {
  const file = path.join(path.dirname(path.join(ROOT, relFile)), `.check-sls-${process.pid}-${seq++}.ts`);
  fs.writeFileSync(file, source);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.unlinkSync(file);
  }
}

async function suite(L, T, code) {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? ` — ${detail}` : ""}`); };

  // In the session (Wed 23 Sep 2026, 10:00 EDT): unchanged 30-minute rule.
  const open = at("2026-09-23T14:00:00Z");
  const w0 = L.dayWindow(open, MAX_AGE);
  ok("in the session the basis is live", w0.basis === "live" && w0.sessionDate === null, JSON.stringify(w0));
  ok("in the session a 29-minute-old quote counts, a 31-minute-old one does not",
    w0.counts(open - 29 * 60_000) && !w0.counts(open - 31 * 60_000));

  // After the close (18:58 EDT, when the owner's screenshot showed "--").
  const eve = at("2026-09-23T22:58:00Z");
  const w1 = L.dayWindow(eve, MAX_AGE);
  ok("after the close the basis is the last session, dated today", w1.basis === "last-session" && w1.sessionDate === "2026-09-23", JSON.stringify(w1));
  ok("a quote from the final half hour counts (15:58 EDT, 178 min old)", w1.counts(at("2026-09-23T19:58:00Z")));
  ok("a quote from after the close counts (16:58 EDT)", w1.counts(at("2026-09-23T20:58:00Z")));
  ok("a quote last refreshed at 15:20 EDT does not", !w1.counts(at("2026-09-23T19:20:00Z")));
  ok("a quote from the future does not", !w1.counts(eve + 60_000));

  // Pre-market next day: still Wednesday's session, and the 08:05 re-fetch counts.
  const pre = at("2026-09-24T12:30:00Z");
  const w2 = L.dayWindow(pre, MAX_AGE);
  ok("pre-market names the previous session", w2.basis === "last-session" && w2.sessionDate === "2026-09-23", JSON.stringify(w2));
  ok("a pre-market re-fetch counts", w2.counts(at("2026-09-24T12:05:00Z")));

  // Weekend and Monday morning name Friday.
  ok("Saturday names Friday", L.lastSessionDate(at("2026-09-26T15:00:00Z")) === "2026-09-25");
  ok("Monday 08:00 EDT names Friday", L.lastSessionDate(at("2026-09-28T12:00:00Z")) === "2026-09-25");
  ok("Monday 16:30 EDT names Monday", L.lastSessionDate(at("2026-09-28T20:30:00Z")) === "2026-09-28");

  // Both seasons.
  ok("the close is 20:00 UTC in September (EDT)", L.easternCloseMs("2026-09-23") === at("2026-09-23T20:00:00Z"));
  ok("the close is 21:00 UTC in December (EST)", L.easternCloseMs("2026-12-02") === at("2026-12-02T21:00:00Z"));
  const winter = L.dayWindow(at("2026-12-02T20:30:00Z"), MAX_AGE);
  ok("15:30 EST is still the live session", winter.basis === "live", JSON.stringify(winter));
  const winterEve = L.dayWindow(at("2026-12-02T23:00:00Z"), MAX_AGE);
  ok("in winter a 20:40 UTC quote (15:40 EST) is inside the final half hour",
    winterEve.sessionDate === "2026-12-02" && winterEve.counts(at("2026-12-02T20:40:00Z")) && !winterEve.counts(at("2026-12-02T20:20:00Z")));

  ok("the label reads like a date a beginner can parse", L.sessionDateLabel("2026-09-23") === "Wed 23 Sep", String(L.sessionDateLabel("2026-09-23")));
  ok("a malformed date gives no label rather than a wrong one", L.sessionDateLabel("23/09/2026") === null);

  // The sentence never says "today" for a last-session number.
  const sector = { name: "Industrials", slug: "industrials" };
  const lead = T.buildSectorLead({ sector, newsScore: { tone: "mixed" }, articleCount: 3, constituentCount: 40, dayMove: -0.8, rank: 7, lastSession: "Wed 23 Sep" });
  ok("the lead names the session and drops 'today'", /last session \(Wed 23 Sep\)/.test(lead) && !/today/i.test(lead.split(". ").find((x) => /session/.test(x)) ?? "today"), lead);
  const live = T.buildSectorLead({ sector, newsScore: { tone: "mixed" }, articleCount: 3, constituentCount: 40, dayMove: -0.8, rank: 7 });
  ok("in the session the lead still says today", /trading modestly lower today/.test(live), live);

  // Wiring.
  ok("the performance builder counts quotes through the rule", /const counts = quote && dayRule\.counts\(quote\.ts\)/.test(code.panels));
  ok("the movers count quotes through the same rule", /if \(!dayRule\.counts\(quote\.ts\)\) continue;/.test(code.panels));
  ok("rows and movers carry the basis and date", (code.panels.match(/dayBasis: dayRule\.basis/g) ?? []).length >= 2);
  ok("the cached table's key moved to v2 (old rows have no basis)", /"msh:sector-performance:v2"/.test(code.panels));
  ok("the card's title and rank line follow the basis",
    /const dayTitle = lastSession \? "Last Session" : "Sector Today";/.test(code.news) && /\{dayTitle\}/.test(code.news) && /\{rankLine\}/.test(code.news));
  ok("the lead is told when the move is the last session's", /lastSession: lastSession \? sessionDateLabel\(performance\?\.sessionDate\) : null/.test(code.news));
  ok("the overview labels the column from the basis", /row\?\.dayBasis === "last-session"/.test(code.overview));
  return fails;
}

const lastSrc = read(LAST);
const tplSrc = read(TEMPLATES);
const code = {
  panels: readCodeOnly("lib/server/sectorPanels.ts"),
  news: readCodeOnly("app/sector/[slug]/news/page.tsx"),
  overview: readCodeOnly("app/sector/page.tsx"),
};
// Siblings, so their relative imports (./marketHours, @/lib/sectors types) resolve.
const tplLoadable = (src) => src.replace(`import type { SectorDef } from "@/lib/sectors";`, "type SectorDef = { name: string; slug: string };");

const base = await suite(await loadSibling(LAST, lastSrc), await loadSibling(TEMPLATES, tplLoadable(tplSrc)), code);
if (base.length) {
  console.error("FAIL check-sector-last-session:\n  " + base.join("\n  "));
  process.exit(1);
}

const mut = (label, src, from, to) => {
  if (!src.includes(from)) throw new Error(`mutant "${label}": anchor not found`);
  return src.replace(from, () => to);
};
const MUTANTS = [
  ["after the close still names the previous day", () => [mut("close", lastSrc, `if (!isWeekendEastern(weekday) && minutesOfDay >= REGULAR_CLOSE_MINUTES_ET) return date;`, ""), tplSrc, code]],
  ["the close hard-coded at 20:00 UTC", () => [mut("utc", lastSrc, `return guess + (REGULAR_CLOSE_MINUTES_ET - minutesOfDay) * 60_000;`, "return guess;"), tplSrc, code]],
  ["any old quote counts after hours", () => [mut("from", lastSrc, `counts: (ts) => ts >= from && ts <= nowMs`, `counts: (ts) => ts <= nowMs`), tplSrc, code]],
  ["the session test inverted", () => [mut("open", lastSrc, `if (isRegularSessionOpen(new Date(nowMs))) {`, `if (!isRegularSessionOpen(new Date(nowMs))) {`), tplSrc, code]],
  ["the lead ignores lastSession", () => [lastSrc, mut("lead", tplSrc, `if (move && lastSession) {`, `if (false) {`), code]],
  ["the movers keep the 30-minute gate", () => [lastSrc, tplSrc, { ...code, panels: mut("movers", code.panels, `if (!dayRule.counts(quote.ts)) continue;`, `if (Date.now() - quote.ts > MAX_QUOTE_AGE_MS) continue;`) }]],
  ["the card always says Sector Today", () => [lastSrc, tplSrc, { ...code, news: mut("title", code.news, `{dayTitle}`, `Sector Today`) }]],
];

let survived = 0;
for (const [label, make] of MUTANTS) {
  const [l, t, c] = make();
  const fails = await suite(await loadSibling(LAST, l), await loadSibling(TEMPLATES, tplLoadable(t)), c);
  if (!fails.length) {
    survived++;
    console.error(`MUTANT SURVIVED: ${label}`);
  }
}
if (survived) process.exit(1);
console.log(`check-sector-last-session: all assertions pass; ${MUTANTS.length} mutants caught`);
