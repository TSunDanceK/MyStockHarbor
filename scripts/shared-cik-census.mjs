// THE SHARED-CIK CENSUS (#552 COWORK #64). CCZ and SOMN were non-common
// listings (debentures, corporate units) on a common filer's CIK, valued with
// the common stock's EPS. For every company-tickers CIK carrying more than one
// ticker: the newest 10-K/20-F/40-F, its Section 12(b) table, and for each
// ticker the class its row names, classified common / non-common / not on a
// 12(b) row. SEC text only; read-only; no credential; no Redis. ≤8 req/s.
//   SHARD=1 SHARDS=4 node scripts/shared-cik-census.mjs   (relay: shared-cik-census-1..4)
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { symbolSpellings } from "../lib/symbolSpellings.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; shared-cik census)";
const D = await import("../lib/server/secDescription.ts");
const K = Number(process.env.SHARD || 1), N = Number(process.env.SHARDS || 1);
const BUDGET_MS = Number(process.env.BUDGET_MS || 25 * 60 * 1000), started = Date.now();
const rows = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8")).data;
const PL = JSON.parse(fs.readFileSync("data/sec/primary-listings.json", "utf8")).entries;
const mapped = new Set(Object.values(PL).flatMap((e) => [e.primary, ...Object.keys(e.nonEquity ?? {})]));
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const groups = new Map();
for (const [cik, name, tk, ex] of rows) {
  if (!groups.has(cik)) groups.set(cik, { name, tickers: [] });
  groups.get(cik).tickers.push({ tk, ex });
}
let ciks = [...groups.keys()].filter((c) => groups.get(c).tickers.length > 1).sort((a, b) => a - b);
if (only.length) ciks = ciks.filter((c) => groups.get(c).tickers.some((t) => only.includes(t.tk)));
else ciks = ciks.filter((_, i) => i % N === K - 1);

let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return as === "json" ? res.json() : res.text();
}
const EXCH = /(?:The\s+)?(?:New York Stock Exchange(?:\s*\(NYSE\))?(?:\s+(?:LLC|American|Arca))*|NYSE(?:\s+(?:American|Arca|Texas|Chicago))?(?:\s+LLC)?|(?:The\s+)?Nasdaq(?:\s+(?:Global Select|Global|Capital|Stock))?(?:\s+Market)?(?:\s+LLC)?|Cboe\s+BZX[^A-Z]*?(?:Inc\.?)?|Toronto Stock Exchange|London Stock Exchange|Tokyo Stock Exchange)/gi;
const NONCOMMON = /\bnotes?\b|debentures?|\bbonds?\b|preferred|preference|warrants?\b|\brights?\b|corporate units|equity units|tangible equity units|purchase contracts?|capital securities|trust securities|subordinated|depositary shares,?\s+each representing (?:a|one)[-\s]\S+(?:th|ths)? (?:interest|of a share)|\bunits?\b(?!\s+representing)/i;
const COMMONISH = /common|ordinary|class [a-c] shares?|american depositary shares?|limited partnership units|common units|units representing|shares of beneficial interest|limited partner interests|capital stock|subordinate voting shares/i;
const tally = { ciks: 0, noAnnual: 0, no12b: 0, common: 0, nonCommon: 0, notOnRow: 0, error: 0 };
const out = [];
for (const cik of ciks) {
  if (Date.now() - started > BUDGET_MS) break;
  tally.ciks++;
  const g = groups.get(cik);
  try {
    const r = (await get(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`)).filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f) => ["10-K", "20-F", "40-F", "10-KT"].includes(f));
    if (i < 0) { tally.noAnnual++; continue; }
    const text = D.filingText(await get(`https://www.sec.gov/Archives/edgar/data/${cik}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`, "text"));
    const flat = text.replace(/\s+/g, " ");
    const at = flat.search(/pursuant\s+to\s+Section\s*12\s*\(\s*b\s*\)/i);
    if (at < 0) { tally.no12b++; console.log(`NO12B ${g.tickers.map((t) => t.tk).join(",")} ${r.form[i]} ${r.accessionNumber[i]}`); continue; }
    const endG = flat.slice(at).search(/Section\s*12\s*\(\s*g\s*\)/i);
    const sec = flat.slice(at, at + (endG > 0 ? Math.min(endG, 6000) : 4000));
    for (const { tk } of g.tickers) {
      const spells = [...new Set([tk, ...symbolSpellings(tk), tk.replace(/-/g, " "), tk.replace(/-/g, "/")])];
      let hit = null;
      for (const s of spells) {
        const m = new RegExp(`(?<![A-Za-z0-9.])${s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z0-9])`).exec(sec);
        if (m) { hit = m; break; }
      }
      if (!hit) { tally.notOnRow++; continue; }
      // The class: the text between the previous exchange name (or the table
      // header) and the ticker.
      const before = sec.slice(0, hit.index);
      let from = 0;
      for (const m of before.matchAll(EXCH)) from = m.index + m[0].length;
      const hdr = before.search(/Name of each exchange on which registered/i);
      if (hdr >= 0 && from < hdr) from = hdr + "Name of each exchange on which registered".length;
      const cls = before.slice(from).replace(/^[\s:;)(]+/, "").trim().slice(-200);
      const non = NONCOMMON.test(cls) && !/^(?:class [a-c] )?(?:common|ordinary)/i.test(cls);
      if (non) {
        tally.nonCommon++;
        const commons = g.tickers.map((t) => t.tk).filter((t) => t !== tk);
        out.push(`NONCOMMON ${tk.padEnd(8)} | ${cls} | cik ${cik} ${g.name} | others ${commons.join(",")} | ${r.form[i]} ${r.accessionNumber[i]} ${r.filingDate[i]}${mapped.has(tk) ? " | ALREADY MAPPED" : ""}`);
      } else {
        tally.common++;
        if (!COMMONISH.test(cls)) out.push(`UNCLEAR   ${tk.padEnd(8)} | ${cls} | cik ${cik} ${g.name}`);
      }
    }
  } catch (e) { tally.error++; console.log(`ERROR ${g.tickers.map((t) => t.tk).join(",")} ${String(e?.message ?? e).slice(0, 60)}`); }
}
for (const l of out.sort()) console.log(l);
console.log(`\nshard ${K}/${N} ${JSON.stringify(tally)} | ${Math.round((Date.now() - started) / 1000)}s`);
