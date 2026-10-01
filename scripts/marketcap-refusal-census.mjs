// WHY PICKERS' MARKET CAP IS REFUSED, AFTER THE ARCHIVE BACKFILL (#552).
// READ-ONLY. No price is read: marketCap()'s refusal never depends on price
// (secValuation.marketCap returns its refusal before the price is consulted),
// so it is called with price null and only refusals are counted. SEC values
// only: cover-page dates, class counts and forms. No FMP data is read.
//
//   relay task: write-marketcap-refusal-census
//   Redis: 1 GET (universe) + 1 HMGET (stored rows) + 1 GET per refused or
//   row-less symbol (its fact set), read-only.
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lookupSpellingIn } from "../lib/symbolSpellings.mjs";

const P = await import("../lib/server/pickersSecFundamentals.ts");
const V = await import("../lib/server/secValuation.ts");
const S = await import("../lib/server/secFactStore.ts");
const L = await import("../lib/server/secPrimaryListing.ts");
const A = await import("../lib/server/secAdsMap.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
const ADSFILE = JSON.parse(fs.readFileSync("data/sec/ads-ratios.json", "utf8")).entries ?? {};
const redis = Redis.fromEnv();
let commands = 0;

const raw = await redis.get("msh:pickers:v10:symbols"); commands++;
const list = Array.isArray(raw) ? raw : Array.isArray(raw?.symbols) ? raw.symbols : [];
const universe = [...new Set(list.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean))];
const rows = await P.readSecPickerRows(universe); commands++;
const today = new Date().toISOString().slice(0, 10);
const days = (a) => Math.round((Date.parse(today) - Date.parse(a)) / 86400000);

const stored = {}, fresh = {}, detail = {};
const add = (t, k, s) => (t[k] ??= []).push(s);
let shown = 0;
for (const s of universe) {
  const row = rows.get(s);
  let why;
  if (row) {
    const fig = V.marketCap({ shares: row.inputs.shares, eps: null, refusals: row.inputs.refusals, debtListing: row.inputs.refusals.includes("ticker-is-a-debt-security") ? { cls: "", primary: "" } : undefined }, null);
    why = fig && !fig.ok ? fig.why : row.inputs.shares ? null : "no-shares-no-reason";
    if (!why) { shown++; continue; }
  } else why = "no-sec-row";
  add(stored, why, s);

  // WHAT TODAY'S CODE WOULD SAY, from the fact set, with every filer fact the
  // stock page passes (incl. the cited cover, which the warm job omits).
  const set = await S.readFactSet(s).catch(() => null); commands++;
  const reg = lookupSpellingIn(REG, s)?.value ?? null;
  const adsEntry = lookupSpellingIn(ADSFILE, s)?.value ?? null;
  if (!set) { add(fresh, "no-fact-set", s); add(detail, `no-fact-set|${reg ? `registrant ${reg.annualForm ?? "?"}` : "not a registrant"}`, s); continue; }
  const filer = { annualForm: reg?.annualForm ?? null, ads: A.adsRatioFor(s), nonEquity: L.nonEquityListingOf(s), citedCover: L.citedCoverFor(s) };
  const inp = V.valuationInputs(set, today, filer);
  const f = V.marketCap(inp, null);
  const now = f && !f.ok ? f.why : inp.shares ? "would-show" : "no-shares-no-reason";
  add(fresh, now, s);
  const c = set.cover ?? null;
  let d;
  if (now === "ads-ratio-makes-shares-incomparable") {
    d = `form ${reg?.annualForm ?? "?"}; ratio entry ${adsEntry ? (adsEntry.withheld ? "withheld" : "present") : "none"}; cover ${c?.asOf ? `${days(c.asOf)}d old` : "none"}`;
  } else if (now === "share-count-is-stale") {
    const age = days(c?.asOf ?? today);
    d = `form ${reg?.annualForm ?? "?"}; cover age ${age < 730 ? "<2y" : age < 1460 ? "2-4y" : ">4y"}; newest period ${[...set.quarters, ...set.years].map((p) => p.e).sort().at(-1)?.slice(0, 4) ?? "-"}`;
  } else if (now === "no-cover-share-count") {
    d = `form ${reg?.annualForm ?? "?"}; cover ${c ? "present-without-value" : "absent"}; periods ${set.quarters.length}q/${set.years.length}y`;
  } else if (now === "multi-class-share-count-is-ambiguous") {
    d = `${c?.candidates?.length ?? 0} classes`;
  } else d = "";
  add(detail, `${now}|${d}`, s);
}

const line = (t) => Object.entries(t).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length}`).join(", ");
console.log(`Pickers universe ${universe.length}; stored rows ${rows.size}; cap shown (given a price) ${shown}`);
console.log(`STORED refusals (what the page reads): ${line(stored)}`);
for (const [k, v] of Object.entries(stored)) console.log(`  ${k}: ${v.join(" ")}`);
console.log(`TODAY'S CODE on the same symbols: ${line(fresh)}`);
for (const [k, v] of Object.entries(fresh)) console.log(`  ${k}: ${v.join(" ")}`);
console.log("DETAIL (today's reason | SEC facts):");
for (const [k, v] of Object.entries(detail).sort((a, b) => b[1].length - a[1].length)) console.log(`  [${v.length}] ${k}: ${v.join(" ")}`);
console.log(`Redis commands: ${commands} (read-only)`);
