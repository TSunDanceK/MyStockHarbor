// THE 17 FRESH-…CashPaid FILERS STILL EMPTY AFTER #774 (#552 COWORK #163 §4). Reads only.
//
// For each: which per-share concept covers the filer's NEWEST period (the one
// the one-concept-per-filer rule anchors on), which concepts its quarters and
// its fiscal years carry, and what an "FY-only fallback when the FY has no
// …Declared" rule would give: the FY …CashPaid value, and whether that value
// equals the sum of the year's Declared quarters (same measure) or not.
// Extraction is the shipped one on main (post-#774). One companyfacts each, ≤ 8/s.
//
//   relay task: write-sec-dividend-17 (READ-ONLY).
import "./lib/register-ts-app.mjs";
const { extractForSymbol } = await import("../lib/server/secExtractFor.ts");
const { SEC_FIELD_INDEX } = await import("../lib/server/secFields.ts");
const { cikForSymbol } = await import("../lib/server/secColdFetch.ts");
const { secUserAgent } = await import("../lib/server/news/userAgent.ts");
const SYMS = "TEL SHW ADM IP CMI HUM NEM BDX PNR LNT ATO ZTS LPLA ENB CF GLPI TPL".split(" ");
const D = "CommonStockDividendsPerShareDeclared", P = "CommonStockDividendsPerShareCashPaid";
const days = (x) => (Date.parse(x.end) - Date.parse(x.start)) / 86400000;
let sec = 0, last = 0;
const tally = {};
for (const s of SYMS) {
  const wait = last + 125 - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now(); sec++;
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cikForSymbol(s)).padStart(10, "0")}.json`, { headers: { "user-agent": secUserAgent(), accept: "application/json" } });
  if (!r.ok) { console.log(`${s}: http ${r.status}`); continue; }
  const f = await r.json();
  const rows = (c) => Object.values(f.facts?.["us-gaap"]?.[c]?.units ?? {}).flat().filter((x) => x.start);
  const d = rows(D), p = rows(P);
  const newest = [...d.map((x) => ({ ...x, c: "Declared" })), ...p.map((x) => ({ ...x, c: "CashPaid" }))].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  const kinds = (arr) => ({ q: arr.filter((x) => days(x) < 100).length, ytd: arr.filter((x) => days(x) >= 100 && days(x) < 350).length, fy: arr.filter((x) => days(x) >= 350).length, newestEnd: arr.map((x) => x.end).sort().pop() ?? "—" });
  const kd = kinds(d), kp = kinds(p);
  const ex = extractForSymbol(s, f);
  const i = SEC_FIELD_INDEX.dividendsDeclaredPerShare;
  const choice = ex.conceptChoice?.dividendsDeclaredPerShare ?? null;
  const q = ex.quarters.slice(0, 4).map((x) => x.values[i]?.val ?? null);
  const y0 = ex.years[0];
  // The proposed fallback: the newest FY's CashPaid, where that FY has no Declared fact.
  const fyEnd = y0?.end;
  const fyP = p.filter((x) => days(x) >= 350 && x.end === fyEnd).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0]?.val ?? null;
  const fyD = d.some((x) => days(x) >= 350 && x.end === fyEnd);
  const qSumD = d.filter((x) => days(x) < 100 && x.end <= fyEnd && Date.parse(x.end) > Date.parse(fyEnd) - 370 * 86400000).reduce((a, x) => a + x.val, 0);
  const shape = `newest=${newest?.c} · Declared q${kd.q}/ytd${kd.ytd}/fy${kd.fy} (to ${kd.newestEnd}) · CashPaid q${kp.q}/ytd${kp.ytd}/fy${kp.fy} (to ${kp.newestEnd})`;
  const why = !choice ? "no concept chosen" : choice.endsWith(D) && kd.fy === 0 ? "anchored on Declared; Declared never filed for a full year" : choice.endsWith(D) ? "anchored on Declared" : "anchored on CashPaid";
  tally[why] = (tally[why] ?? 0) + 1;
  console.log(`${s}: ${shape}\n   chosen ${choice?.split("|")[1] ?? "none"} · newest 4 quarters ${q.map((v) => v ?? "–").join(", ")} · FY ${fyEnd ?? "—"} value ${y0?.values[i]?.val ?? "–"}` +
    `\n   fallback (FY CashPaid where the FY has no Declared): ${fyD ? "n/a, FY has Declared" : fyP ?? "none"}${!fyD && fyP && qSumD ? ` · vs the year's Declared quarters summed ${qSumD.toFixed(3)} (${(((fyP - qSumD) / qSumD) * 100).toFixed(1)}%)` : ""} — ${why}`);
}
console.log(`\n${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(" · ")}\nSEC requests: ${sec} at ≤ 8/s · no Redis · nothing written`);
