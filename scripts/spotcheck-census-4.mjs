// #535 COWORK #8 — TWO MEASUREMENTS BEFORE ANY BUILD. Read-only.
//
//   #6-B  THE TARGETED FALLBACK: only in a period the refusal rule flags
//         (operating income > revenue, or pre-tax > revenue where operating is
//         untagged), take `Revenues` — then `RevenuesNetOfInterestExpense` —
//         for the same span. By construction nothing else can change; this
//         measures how many filers/periods it reaches and how many it RESOLVES
//         (the fallback revenue >= operating/pre-tax income).
//   #2    THE FILING'S OWN FISCAL YEAR: for every Jan-Jun year-end filer, the
//         newest 10-K's `dei:DocumentFiscalYearFocus` and `DocumentPeriodEndDate`
//         from its XBRL instance, the offset they imply, and the label that
//         offset gives the newest quarter vs today's label.
// relay task: write-spotcheck-census-4
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; spot-check census 4)";
const strip = (f) => fs.readFileSync(f, "utf8").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const X = await lift([fs.readFileSync("lib/server/secFields.ts", "utf8"), strip("lib/server/secExtract.ts"),
  strip("lib/server/fxRates.ts"), strip("lib/server/secCurrency.ts"), strip("lib/server/secFactCodec.ts")].join("\n"));
const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (n) => (manifestSrc.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const manifest = await redis.get(pick("SEC_MANIFEST_KEY"));
const FACTS = pick("SEC_FACTS_PREFIX");
const all = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
const sets = new Map();
for (let i = 0; i < all.length; i += 50) {
  const b = all.slice(i, i + 50);
  const ss = await Promise.all(b.map((s) => redis.get(`${FACTS}:${s}`)));
  b.forEach((s, k) => { if (ss[k]?.quarters) sets.set(s, ss[k]); });
}
let lastAt = 0;
const get = async (url, as = "json") => {
  const w = Math.max(0, lastAt + 130 - Date.now());
  if (w) await new Promise((r) => setTimeout(r, w));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return null;
  return as === "json" ? res.json() : res.text();
};
const v = (p, k) => X.valueOf(p, k);
const incomplete = (p) => {
  const rev = v(p, "revenue"); if (rev === null || rev <= 0) return false;
  const op = v(p, "operatingIncome"); if (op !== null) return op > rev;
  const pre = v(p, "preTaxIncome"); return pre !== null && pre > rev;
};

// ── #6-B ────────────────────────────────────────────────────────────────────
const flagged = [...sets].filter(([, set]) => [...set.quarters, ...set.years].some(incomplete));
console.log(`${"=".repeat(78)}\n#6-B TARGETED FALLBACK — ${flagged.length} filers have at least one flagged period`);
const FALLBACK = ["Revenues", "RevenuesNetOfInterestExpense"];
let periods = 0, reached = 0, resolved = 0;
const perFiler = [];
for (const [s, set] of flagged) {
  const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${manifest.symbols[s].cik}.json`);
  if (!facts) { perFiler.push(`${s}: companyfacts unreadable`); continue; }
  let fr = 0, fp = 0, fs2 = 0; const tags = new Set();
  for (const p of [...set.quarters, ...set.years]) {
    if (!incomplete(p)) continue;
    fp++; periods++;
    let alt = null, tag = null;
    for (const t of FALLBACK) {
      const rows = facts.facts?.["us-gaap"]?.[t]?.units?.USD ?? [];
      const r = rows.filter((x) => x.end === p.e && x.start === p.s).sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
      if (r && Number.isFinite(r.val)) { alt = r.val; tag = t; break; }
    }
    if (alt === null) continue;
    fr++; reached++; tags.add(tag);
    const op = v(p, "operatingIncome"), pre = v(p, "preTaxIncome");
    const bar = op !== null ? op : pre;
    if (alt >= bar) { fs2++; resolved++; }
  }
  perFiler.push(`${s.padEnd(6)} flagged ${fp} · fallback found ${fr} (${[...tags].join("/") || "—"}) · resolves ${fs2}`);
}
for (const l of perFiler) console.log(`  ${l}`);
console.log(`  TOTAL flagged periods ${periods} · fallback found ${reached} · resolved ${resolved} · periods changed outside flagged: 0 by construction`);

// ── #2 ──────────────────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(78)}\n#2 THE FILING'S OWN DocumentFiscalYearFocus (newest 10-K), Jan-Jun year ends`);
const changes = [], unread = [];
let seen = 0;
for (const [s, set] of sets) {
  const ye = set.years?.[0]?.e;
  if (!ye || Number(ye.slice(5, 7)) > 6 || !set.quarters[0]) continue;
  const cik = manifest.symbols[s].cik;
  const subs = await get(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = subs?.filings?.recent;
  const i = r ? r.form.findIndex((f) => f === "10-K") : -1;
  if (i < 0) { unread.push(`${s}(no 10-K)`); continue; }
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}`;
  const idx = await get(`${base}/index.json`);
  const inst = (idx?.directory?.item ?? []).map((x) => x.name).find((n) => /_htm\.xml$/i.test(n));
  const xml = inst ? await get(`${base}/${inst}`, "text") : null;
  if (!xml) { unread.push(`${s}(no instance)`); continue; }
  const dei = (tag) => xml.match(new RegExp(`<[\\w-]+:${tag}\\b[^>]*>\\s*([^<]+)<`))?.[1]?.trim();
  const fyFocus = Number(dei("DocumentFiscalYearFocus"));
  const pend = dei("DocumentPeriodEndDate");
  if (!fyFocus || !/^\d{4}-\d{2}-\d{2}$/.test(pend ?? "")) { unread.push(`${s}(dei ${fyFocus}/${pend})`); continue; }
  seen++;
  const offset = fyFocus - X.fiscalMidYear(Date.parse(`${pend}T00:00:00Z`));
  const facts = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  const shipped = facts ? X.fiscalYearOffset(facts, ye) : null;
  const q = set.quarters[0];
  const now = { fp: q.fp, fy: q.fy };
  const naming = { offset, basis: "annual", agreeing: 1, disagreeing: 0, yearEnd: pend };
  const dl = (offset === 0 || offset === 1) ? X.fiscalLabel(q.e, pend, naming) : null;
  const line = `${s.padEnd(6)} 10-K ${r.filingDate[i]} DEI FY${fyFocus} ending ${pend} -> offset ${offset} (vote today ${shipped?.offset ?? "?"}) · newest quarter ${now.fp} FY${now.fy} -> ${dl ? `${dl.fp} FY${dl.fy}` : "offset not 0/+1"}`;
  if (!dl || dl.fy !== now.fy || dl.fp !== now.fp) changes.push(line);
}
console.log(`  read ${seen} · CHANGE ${changes.length} · unread ${unread.length}`);
for (const l of changes) console.log(`  ${l}`);
if (unread.length) console.log(`  unread: ${unread.join(" ")}`);
