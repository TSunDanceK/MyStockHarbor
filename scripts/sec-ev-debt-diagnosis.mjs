// WHY CHAIN DEBT CONCEPTS RESOLVE TO NULL (#552 COWORK #162 §4, B2). Reads only.
//
// The CODE-A #169 follow-up found LongTermDebt (41), LongTermDebtNoncurrent
// (30), ShortTermBorrowings (29) and LongTermDebtCurrent (23) FILED at the
// stored balance-sheet date of Pickers sets whose EV still lacks that line,
// although all four are in our chains. For each such missing line this asks,
// on the filer's companyfacts:
//   1. does a FRESH run of the shipped extraction (extractForSymbol) fill it?
//      yes → the stored set is older than the data or the chain (a re-read fixes it);
//   2. if not, what the chain's facts at that date look like: forms, how many
//      distinct values (ambiguous), units, and what the cell's derivation code is;
//   3. which non-chain debt concepts sit at that date, for the chain proposal,
//      with a double-count test: does the candidate equal the sum of lines we
//      already read (it would then be a total, not a missing piece).
// One companyfacts per set, ≤ 8/s. Nothing written.
//
//   relay task: write-sec-ev-debt-diagnosis (READ-ONLY despite the prefix).
import "./lib/register-ts-app.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { SEC_FIELDS, SEC_FIELD_INDEX, secFieldsHash } = await import("../lib/server/secFields.ts");
const { balanceSheetInstant, valueOf } = await import("../lib/server/secFactCodec.ts");
const { dotDashSpellings } = await import("../lib/server/secManifest.ts");
const { factKey } = await import("../lib/server/secFactStore.ts");
const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { toStoredSet } = await import("../lib/server/secFactBuild.ts");
const { secUserAgent } = await import("../lib/server/news/userAgent.ts");

const FIELDS = ["shortTermDebt", "longTermDebt"];
const chainOf = (k) => SEC_FIELDS.find((f) => f.key === k).chain;
const EXTRA = {
  shortTermDebt: ["CommercialPaper", "LinesOfCreditCurrent", "NotesPayableCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "FinanceLeaseLiabilityCurrent", "OtherShortTermBorrowings", "BankOverdrafts"],
  longTermDebt: ["DebtLongtermAndShorttermCombinedAmount", "DebtInstrumentCarryingAmount", "SeniorNotes", "LongTermNotesPayable", "ConvertibleDebtNoncurrent", "ConvertibleNotesPayable", "SecuredDebt", "UnsecuredDebt", "OtherLongTermDebtNoncurrent", "LongTermLineOfCredit", "FinanceLeaseLiabilityNoncurrent"],
};
let commands = 0;
const src = fs.readFileSync("lib/server/pickersBuilder.ts", "utf8");
const KEY = src.match(/export const PICKERS_SYMBOLS_KEY = "([^"]+)";/)[1];
commands++;
const pickers = ((await redis.get(KEY)) ?? []).map(String);
const keys = [...new Set(pickers.flatMap((s) => dotDashSpellings(s).map(factKey)))];
const got = new Map();
for (let i = 0; i < keys.length; i += 40) { commands++; const b = keys.slice(i, i + 40); const v = await redis.mget(...b); b.forEach((k, j) => v[j] && got.set(k, v[j])); }

const atDate = (f, concept, end) => {
  const units = f?.facts?.["us-gaap"]?.[concept]?.units ?? {};
  const rows = Object.entries(units).flatMap(([u, arr]) => arr.filter((x) => x.end === end && !x.start).map((x) => ({ ...x, unit: u })));
  return rows;
};
let last = 0, sec = 0;
const out = { shortTermDebt: [], longTermDebt: [] };
const extraAt = { shortTermDebt: {}, longTermDebt: {} };
for (const s of pickers) {
  const raw = dotDashSpellings(s).map((sp) => got.get(factKey(sp))).find(Boolean);
  if (!raw) continue;
  const set = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (set.h !== secFieldsHash() || !(set.tx ?? []).includes("us-gaap")) continue;
  const b = balanceSheetInstant(set);
  if (!b) continue;
  const missing = FIELDS.filter((k) => valueOf(b, k) === null);
  if (!missing.length) continue;
  const wait = last + 125 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); sec++;
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(set.cik).padStart(10, "0")}.json`, { headers: { "user-agent": secUserAgent(), accept: "application/json" } });
  if (!res.ok) continue;
  const f = await res.json();
  let freshSet = null;
  try { freshSet = await toStoredSet(extractForSymbol(s, f)); } catch {}
  const freshB = freshSet?.instants.find((i) => i.e === b.e) ?? null;
  for (const k of missing) {
    const chainHits = chainOf(k).map((c) => [c, atDate(f, c, b.e)]).filter(([, r]) => r.length);
    const code = b.d[SEC_FIELD_INDEX[k]] ?? "-";
    const fresh = freshB ? valueOf(freshB, k) : null;
    const freshCode = freshB ? (freshB.d[SEC_FIELD_INDEX[k]] ?? "-") : "no-instant";
    let why;
    if (!chainHits.length) why = "no chain concept at the date";
    else if (fresh !== null) why = "a fresh extraction fills it (stored set stale)";
    else {
      const vals = new Set(chainHits.flatMap(([, r]) => r.map((x) => x.val)));
      const forms = [...new Set(chainHits.flatMap(([, r]) => r.map((x) => x.form)))];
      const units = [...new Set(chainHits.flatMap(([, r]) => r.map((x) => x.unit)))];
      why = `fresh extraction also null (code ${freshCode}; ${vals.size} distinct value(s); forms ${forms.join("/")}; units ${units.join("/")})`;
    }
    out[k].push({ s, end: b.e, storedCode: code, chain: chainHits.map(([c, r]) => `${c}×${r.length}`).join(","), why, setAt: new Date(set.at).toISOString().slice(0, 10), chainsHash: set.c ?? null });
    if (!chainHits.length) {
      const have = FIELDS.filter((x) => x !== k).map((x) => valueOf(b, x)).filter((v) => v !== null);
      for (const c of EXTRA[k]) {
        const r = atDate(f, c, b.e);
        if (!r.length) continue;
        const v = r.sort((a, z) => (a.filed < z.filed ? 1 : -1))[0].val;
        const e = extraAt[k][c] ??= { n: 0, equalsOtherLine: 0 };
        e.n++;
        if (have.some((h) => Math.abs(h - v) <= Math.max(1, Math.abs(h) * 0.005))) e.equalsOtherLine++;
      }
    }
  }
}
const { secChainsHash } = await import("../lib/server/secFields.ts");
console.log(`current secChainsHash: ${secChainsHash()}`);
for (const k of FIELDS) {
  const rows = out[k];
  const by = {};
  for (const r of rows) { const w = r.why.replace(/\(.*\)/, "(…)"); by[w] = (by[w] ?? 0) + 1; }
  console.log(`\n## ${k}: missing on ${rows.length} Pickers US-GAAP sets`);
  for (const [w, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${w}`);
  console.log(`  stored chains hash current on ${rows.filter((r) => r.chainsHash === secChainsHash()).length} of ${rows.length}`);
  for (const r of rows.filter((r) => r.chain)) console.log(`    ${r.s} ${r.end} stored code ${r.storedCode} (set ${r.setAt}) chain at date: ${r.chain} — ${r.why}`);
  console.log(`  where NO chain concept sits at the date, other concepts filed there (n · equal to the other debt line we already read):`);
  for (const [c, e] of Object.entries(extraAt[k]).sort((a, b) => b[1].n - a[1].n)) console.log(`    ${c} ${e.n} · ${e.equalsOtherLine}`);
}
console.log(`\nRedis commands: ${commands} (GET/MGET), read-only · SEC requests: ${sec} at ≤ 8/s · nothing written`);
