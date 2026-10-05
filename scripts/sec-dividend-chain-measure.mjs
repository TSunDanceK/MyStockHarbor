// A1, MEASURED ON THE NEW CHAIN (#552 COWORK #162 §1). Reads only; not to merge.
//
// The Pickers payers (US-GAAP, money in USD, a dividend tag > 0) whose STORED
// set gives no Div ($) cell, cold-read from companyfacts and rebuilt with the
// shipped extractForSymbol + toStoredSet ON THIS BRANCH (…CashPaid in the
// chain), then measured with B's shipped buildSecPickerRow / applySecPickerRow.
// Grouped by what companyfacts carries: a fresh FY …CashPaid; …CashPaid only
// stale or not as a full year (COWORK #162: how many give a four-quarter TTM);
// no per-share concept.
//
//   relay task: write-sec-dividend-chain-measure. Redis GET/MGET; SEC ≤ 8/s.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const TODAY = new Date().toISOString().slice(0, 10);
const fresh = (iso) => Boolean(iso) && (Date.parse(TODAY) - Date.parse(iso)) / 86400000 <= 456;
const { buildSecPickerRow, applySecPickerRow, unitOf, moneyIsUsd } = await import("../lib/server/pickersSecFundamentals.ts");
const { twelveMonthsOf } = await import("../lib/server/secValuation.ts");
const { valueOf } = await import("../lib/server/secFactCodec.ts");
const { secFieldsHash } = await import("../lib/server/secFields.ts");
const { dotDashSpellings } = await import("../lib/server/secManifest.ts");
const { factKey } = await import("../lib/server/secFactStore.ts");
const { registrantFor } = await import("../lib/server/stockProfile.ts");
const { adsRatioFor } = await import("../lib/server/secAdsMap.ts");
const { citedCoverFor, nonEquityListingOf } = await import("../lib/server/secPrimaryListing.ts");
const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { toStoredSet } = await import("../lib/server/secFactBuild.ts");
const { secUserAgent } = await import("../lib/server/news/userAgent.ts");
const filerOf = (s) => ({ annualForm: registrantFor(s)?.annualForm ?? null, ads: adsRatioFor(s), nonEquity: nonEquityListingOf(s), sic: registrantFor(s)?.sic ?? null, citedCover: citedCoverFor(s) });
const cells = (set, s) => {
  const row = buildSecPickerRow(set, TODAY, filerOf(s), Date.now());
  const fig = applySecPickerRow(row, 100);
  const dps = twelveMonthsOf(set, ["dividendsDeclaredPerShare"]);
  return { div: fig.divPerShare != null && fresh(dps?.periodEnd), q4: dps?.basis === "four-quarters", growth: fig.divGrowth != null, payout: row.payout != null, dps: dps?.vals.dividendsDeclaredPerShare ?? null, end: dps?.periodEnd ?? null };
};

let commands = 0;
const src = fs.readFileSync("lib/server/pickersBuilder.ts", "utf8");
const KEY = src.match(/export const PICKERS_SYMBOLS_KEY = "([^"]+)";/)[1];
commands++;
const pickers = ((await redis.get(KEY)) ?? []).map(String);
const keys = [...new Set(pickers.flatMap((s) => dotDashSpellings(s).map(factKey)))];
const got = new Map();
for (let i = 0; i < keys.length; i += 40) { commands++; const b = keys.slice(i, i + 40); const v = await redis.mget(...b); b.forEach((k, j) => v[j] && got.set(k, v[j])); }
const gap = [];
for (const s of pickers) {
  const raw = dotDashSpellings(s).map((sp) => got.get(factKey(sp))).find(Boolean);
  if (!raw) continue;
  const set = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (set.h !== secFieldsHash()) continue;
  const tx = set.tx ?? [];
  if (!(tx.includes("us-gaap") && !(tx.includes("ifrs-full") && !tx.includes("us-gaap")))) continue;
  if (!moneyIsUsd(unitOf(set))) continue;
  const payer = [...set.quarters, ...set.years].some((p) => (valueOf(p, "dividendsDeclaredPerShare") ?? 0) > 0 || Math.abs(valueOf(p, "dividendsPaid") ?? 0) > 0);
  if (!payer) continue;
  if (cells(set, s).div) continue;
  gap.push([s, set]);
}
let last = 0, sec = 0;
const groups = { "fresh FY …CashPaid": [], "…CashPaid stale or not a full year": [], "no per-share concept": [] };
for (const [s, set] of gap) {
  const wait = last + 125 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); sec++;
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(set.cik).padStart(10, "0")}.json`, { headers: { "user-agent": secUserAgent(), accept: "application/json" } });
  if (!res.ok) continue;
  const f = await res.json();
  const cp = Object.values(f.facts?.["us-gaap"]?.CommonStockDividendsPerShareCashPaid?.units ?? {}).flat();
  const fyFresh = cp.some((x) => x.start && (Date.parse(x.end) - Date.parse(x.start)) / 86400000 > 350 && fresh(x.end));
  const g = fyFresh ? "fresh FY …CashPaid" : cp.length ? "…CashPaid stale or not a full year" : "no per-share concept";
  const built = await toStoredSet(extractForSymbol(s, f));
  groups[g].push({ s, ...cells({ ...built, symbol: s }, s) });
}
console.log(`Pickers US-GAAP payers with no Div ($) cell on the STORED set: ${gap.length}`);
for (const [g, rows] of Object.entries(groups)) {
  const n = (k) => rows.filter((r) => r[k]).length;
  console.log(`\n${g}: ${rows.length} · Div ($) cell on the new chain ${n("div")} (four quarters ${rows.filter((r) => r.div && r.q4).length}, fiscal year ${rows.filter((r) => r.div && !r.q4).length}) · Div Growth ${n("growth")} · Payout ${n("payout")}`);
  const filled = rows.filter((r) => r.div).map((r) => `${r.s} ${r.dps.toFixed(3)}${r.q4 ? " TTM" : " FY"} to ${r.end}`);
  if (filled.length) console.log(`  filled: ${filled.join(" · ")}`);
  const not = rows.filter((r) => !r.div).map((r) => r.s);
  if (not.length) console.log(`  still none: ${not.join(" ")}`);
}
console.log(`\nRedis commands: ${commands} (GET/MGET), read-only · SEC requests: ${sec} at ≤ 8/s · nothing written`);
