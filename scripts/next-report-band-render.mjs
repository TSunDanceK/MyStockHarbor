// The next-report wording on /stock/[symbol] and /stock/[symbol]/earnings,
// BEFORE and AFTER the 30-day-band change, for real symbols against the LIVE
// filing record.
//
// check-next-report-band.mjs proves the rule on fixtures. This answers the
// production question: what do the tile and the card actually say for TSLA,
// ABBV, NVDA, AVAV, MU and ORCL today. It renders the SHIPPED components
// (LatestEarningsCard, NextReportCard) through the shipped module graph, and
// the removed render paths (scripts/lib/next-report-legacy.mjs) for the
// "before" column, from records read straight out of Upstash.
//
// Read-only. Issues GETs against Redis; writes nothing.
//   relay task: write-next-report-band   (credentialled for the READ; no writes)
//   SYMBOLS=TSLA,ABBV  to override the default six
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { loadOutlookGraph } from "./lib/outlook-module.mjs";
import {
  loadSnapshot, loadCard, loadOldCard, tileText, tileNextCell, cardText, oldCardText,
} from "./lib/next-report-render.mjs";
import { oldTileNext, oldTileMutation, oldCardView } from "./lib/next-report-legacy.mjs";

const redis = Redis.fromEnv();
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const PREFIX = "msh:sec:reportdates:v1";
const DEFAULT = ["TSLA", "ABBV", "NVDA", "AVAV", "MU", "ORCL"];
const asked = (process.env.SYMBOLS ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const symbols = asked.length ? asked : DEFAULT;

const g = await loadOutlookGraph();
const S = await loadSnapshot();
const S0 = await loadSnapshot(oldTileMutation);
const C = await loadCard();
const Old = await loadOldCard();
// The tile's FIGURES are not what this measures, only its next-report cell,
// which depends on nothing but `nextReport`. A committed SEC fixture fills the
// rest of the card so the component renders as it does on the page.
const factset = JSON.parse(fs.readFileSync("data/sec/factset-fixture-TSLA.json", "utf8"));

const gb = (d) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  .format(new Date(`${d}T00:00:00Z`));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

console.log(`\nTODAY=${TODAY}  symbols=${symbols.join(",")}\n`);
const problems = [];
let readable = 0;

for (const symbol of symbols) {
  const raw = await redis.get(`${PREFIX}:${symbol}`);
  const rec = raw && typeof raw === "object" && Array.isArray(raw.events) ? raw : null;
  if (rec) readable++;
  const read = { ok: true, rec };

  const outlook = g.mod.outlookFromRead(symbol, read, TODAY);
  // hasCalendarEntry=false: this runner has no FMP call, and it only matters
  // when there is no record at all (then the card is the no-record refusal).
  const card = g.mod.outlookForEarningsCard(symbol, read, false, TODAY);

  const after = tileText(S, symbol, g.mod.compactOutlook(outlook), factset);
  const before = tileText(S0, symbol, oldTileNext(rec), factset);

  console.log(`══ ${symbol} ═══════════════════════════════════════════════════`);
  console.log(`  record: next=${JSON.stringify(rec?.next ?? null)}  nextPeriodEnd=${rec?.nextPeriodEnd ?? null}  events=${rec?.events?.length ?? 0}`);
  console.log(`  outlook: kind=${outlook.kind}${outlook.reason ? ` reason=${outlook.reason}` : ""}${outlook.band ? ` band=${outlook.band}` : ""}`);
  console.log(`\n  /stock/${symbol}  TILE`);
  console.log(`    BEFORE  ${tileNextCell(before.text, before.periodLabel)}`);
  console.log(`    AFTER   ${tileNextCell(after.text, after.periodLabel)}`);
  console.log(`\n  /stock/${symbol}/earnings  CARD`);
  console.log(`    BEFORE  ${oldCardText(Old, oldCardView(rec, null), symbol) || "(no card)"}`);
  console.log(`    AFTER   ${cardText(C, card) || "(no card)"}`);
  console.log("");

  // ── THE CANARY: the estimate must not appear in either AFTER. ──────────
  const est = rec?.next?.kind === "date" ? [rec.next.date, gb(rec.next.date)]
    : rec?.next?.kind === "month" ? [rec.next.month, `${MONTHS[Number(rec.next.month.slice(5, 7)) - 1]} ${rec.next.month.slice(0, 4)}`]
      : [];
  for (const s of est) {
    if (tileNextCell(after.text, after.periodLabel)?.includes(s)) problems.push(`${symbol}: tile AFTER prints the estimate "${s}"`);
    if (cardText(C, card).includes(s)) problems.push(`${symbol}: card AFTER prints the estimate "${s}"`);
  }
}

console.log("── CANARY ────────────────────────────────────────────────────");
if (!readable) problems.push("EVERY record read back empty — this measured the store being unreachable.");
if (problems.length) for (const p of problems) console.log(`  PROBLEM  ${p}`);
else console.log(`  clean: ${readable}/${symbols.length} records read, no estimated date or month in any AFTER.`);
g.cleanup();
process.exit(problems.length ? 1 : 0);
