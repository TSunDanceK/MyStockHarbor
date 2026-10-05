// B2: WOULD ONE PROPOSED CONCEPT UNDERSTATE A DEBT LINE? (#552 COWORK #163 §B2.1). Reads only.
//
// Proposed chain additions, at the END of each chain (rank order):
//   shortTermDebt: LongTermDebtAndCapitalLeaseObligationsCurrent, CommercialPaper, OtherShortTermBorrowings
//   longTermDebt:  ConvertibleDebtNoncurrent, SeniorNotes
// A chain takes ONE concept per period. A filer that files two or more debt
// COMPONENTS for the same line at the same date would get one of them, not the
// sum: that understates. For each Pickers US-GAAP set missing a line, at its
// stored balance-sheet date:
//   GAIN        at least one proposed concept is filed there (the line fills);
//   UNDERSTATE  a gain where another component of the same line is also filed
//               there (proposed or not), and the chosen value is below the sum;
//   by how much (chosen ÷ sum), and the EV error that follows at the pool price.
// COWORK #163: build only if UNDERSTATE ≤ 10% of GAIN.
//
//   relay task: write-sec-ev-debt-components (READ-ONLY). One companyfacts per gap set, ≤ 8/s.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const { balanceSheetInstant, valueOf } = await import("../lib/server/secFactCodec.ts");
const { dotDashSpellings } = await import("../lib/server/secManifest.ts");
const { factKey } = await import("../lib/server/secFactStore.ts");
const { buildSecPickerRow, applySecPickerRow } = await import("../lib/server/pickersSecFundamentals.ts");
const { readPricePoolBulk } = await import("../lib/server/pricePool.ts");
const { registrantFor } = await import("../lib/server/stockProfile.ts");
const { adsRatioFor } = await import("../lib/server/secAdsMap.ts");
const { citedCoverFor, nonEquityListingOf } = await import("../lib/server/secPrimaryListing.ts");
const { secUserAgent } = await import("../lib/server/news/userAgent.ts");
const TODAY = new Date().toISOString().slice(0, 10);
const filerOf = (s) => ({ annualForm: registrantFor(s)?.annualForm ?? null, ads: adsRatioFor(s), nonEquity: nonEquityListingOf(s), sic: registrantFor(s)?.sic ?? null, citedCover: citedCoverFor(s) });

const PROPOSED = {
  shortTermDebt: ["LongTermDebtAndCapitalLeaseObligationsCurrent", "CommercialPaper", "OtherShortTermBorrowings"],
  longTermDebt: ["ConvertibleDebtNoncurrent", "SeniorNotes"],
};
// Other COMPONENTS of the same line (not totals): their presence beside the chosen concept means a sum was due.
const OTHER = {
  shortTermDebt: ["LinesOfCreditCurrent", "NotesPayableCurrent", "BankOverdrafts", "ConvertibleNotesPayableCurrent", "SecuredDebtCurrent", "UnsecuredDebtCurrent"],
  longTermDebt: ["SecuredDebt", "UnsecuredDebt", "LongTermNotesPayable", "ConvertibleNotesPayable", "OtherLongTermDebtNoncurrent", "LongTermLineOfCredit", "SecuredLongTermDebt", "UnsecuredLongTermDebt", "SeniorLongTermNotes", "JuniorSubordinatedNotes"],
};
let commands = 0;
const KEY = fs.readFileSync("lib/server/pickersBuilder.ts", "utf8").match(/export const PICKERS_SYMBOLS_KEY = "([^"]+)";/)[1];
commands++;
const pickers = ((await redis.get(KEY)) ?? []).map(String);
const keys = [...new Set(pickers.flatMap((s) => dotDashSpellings(s).map(factKey)))];
const got = new Map();
for (let i = 0; i < keys.length; i += 40) { commands++; const b = keys.slice(i, i + 40); const v = await redis.mget(...b); b.forEach((k, j) => v[j] && got.set(k, v[j])); }
commands++;
const pool = await readPricePoolBulk(pickers);

const at = (f, c, end) => {
  const rows = Object.entries(f?.facts?.["us-gaap"]?.[c]?.units ?? {}).filter(([u]) => u === "USD").flatMap(([, a]) => a).filter((x) => x.end === end && !x.start);
  rows.sort((a, z) => (a.filed < z.filed ? 1 : -1));
  return rows[0]?.val ?? null;
};
let last = 0, sec = 0;
const res = { shortTermDebt: { gaps: 0, gain: [], under: [] }, longTermDebt: { gaps: 0, gain: [], under: [] } };
const evErr = [];
for (const s of pickers) {
  const raw = dotDashSpellings(s).map((sp) => got.get(factKey(sp))).find(Boolean);
  if (!raw) continue;
  const set = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (set.h !== secFieldsHash() || !(set.tx ?? []).includes("us-gaap")) continue;
  const b = balanceSheetInstant(set);
  if (!b) continue;
  const missing = Object.keys(PROPOSED).filter((k) => valueOf(b, k) === null);
  if (!missing.length) continue;
  const wait = last + 125 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); sec++;
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(set.cik).padStart(10, "0")}.json`, { headers: { "user-agent": secUserAgent(), accept: "application/json" } });
  if (!r.ok) continue;
  const f = await r.json();
  const filled = {};
  for (const k of missing) {
    res[k].gaps++;
    const prop = PROPOSED[k].map((c) => [c, at(f, c, b.e)]).filter(([, v]) => v !== null);
    if (!prop.length) continue;
    const [chosenC, chosen] = prop[0];
    const others = [...prop.slice(1), ...OTHER[k].map((c) => [c, at(f, c, b.e)]).filter(([, v]) => v !== null)];
    // A component equal to the chosen figure is a restatement of it, not an addend.
    const addends = others.filter(([, v]) => Math.abs(v - chosen) > Math.max(1, Math.abs(chosen) * 0.005));
    const sum = chosen + addends.reduce((a, [, v]) => a + v, 0);
    res[k].gain.push(s);
    filled[k] = { chosen, sum };
    if (addends.length && sum > chosen) res[k].under.push(`${s} ${chosenC} ${(chosen / 1e6).toFixed(0)}M + ${addends.map(([c, v]) => `${c} ${(v / 1e6).toFixed(0)}M`).join(" + ")} (chosen is ${((chosen / sum) * 100).toFixed(0)}% of the sum)`);
  }
  // EV error from the understatement, where the line's fill makes EV computable.
  const price = pool.get(s)?.price ?? null;
  if (price === null || !Object.keys(filled).length) continue;
  const cap = applySecPickerRow(buildSecPickerRow(set, TODAY, filerOf(s), Date.now()), price).marketCap;
  const bsv = (k) => filled[k]?.chosen ?? valueOf(b, k);
  const bss = (k) => filled[k]?.sum ?? valueOf(b, k);
  const cash = valueOf(b, "cash") ?? valueOf(b, "cashIncludingRestricted");
  if (cap == null || cash === null || bsv("shortTermDebt") === null || bsv("longTermDebt") === null) continue;
  const evChosen = cap + bsv("shortTermDebt") + bsv("longTermDebt") - cash, evSum = cap + bss("shortTermDebt") + bss("longTermDebt") - cash;
  if (evSum > 0) evErr.push([s, Math.abs(evSum - evChosen) / evSum]);
}
for (const [k, r] of Object.entries(res)) {
  console.log(`\n## ${k}: gaps ${r.gaps} · GAIN (a proposed concept fills it) ${r.gain.length} · UNDERSTATE ${r.under.length} (${r.gain.length ? ((r.under.length / r.gain.length) * 100).toFixed(1) : "—"}% of the gain)`);
  for (const u of r.under) console.log(`  ${u}`);
}
const tot = res.shortTermDebt.gain.length + res.longTermDebt.gain.length, und = res.shortTermDebt.under.length + res.longTermDebt.under.length;
console.log(`\nBOTH LINES: gain ${tot} · understate ${und} (${tot ? ((und / tot) * 100).toFixed(1) : "—"}%) · COWORK #163 line: ≤ 10%`);
const e = evErr.map(([, x]) => x).sort((a, b) => a - b);
console.log(`EV on filled sets (priced, all lines on file): ${e.length} · EV off by > 5% from the understatement: ${evErr.filter(([, x]) => x > 0.05).map(([s, x]) => `${s} ${(x * 100).toFixed(1)}%`).join(" · ") || "none"} · median ${e.length ? (e[Math.floor(e.length / 2)] * 100).toFixed(2) : "—"}%`);
console.log(`\nRedis commands: ${commands} (GET/MGET/HMGET), read-only · SEC requests: ${sec} at ≤ 8/s · nothing written`);
