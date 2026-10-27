// EXTRACTION DRY RUN — every cell an extraction change would move, main against
// this branch, over the SEC manifest. Changes nothing.
//
// Per filer, companyfacts through main's shipped extraction and through this
// branch's; every year and quarter cell, every field, compared. Prints one line
// per changed cell (symbol, field, period, old -> new), then counts by field.
//
// CREDENTIALLED, READ-ONLY: one manifest GET (skipped when SYMBOLS names the
// filers). companyfacts at 250ms spacing. SYMBOLS="SHARD i/n" splits the
// manifest; SYMBOLS="SCHW,MET" reads only those (CIKs from the ticker map).
//   relay task: write-extraction-diff
import fs from "node:fs";
import { loadMainAndBranch } from "./lib/earnings-audit-lift.mjs";

const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (+https://www.mystockharbor.com; extraction dry run)";
const { NEW, OLD } = await loadMainAndBranch();
if (!OLD) { console.error("FATAL: main's source is needed for the before column"); process.exit(2); }

// "SHARD 0/4|notes=seasonal": the relay passes SYMBOLS only, so a notes filter
// rides after a bar; the branch's notes matching it print as NOTE lines.
const [argRaw, ...opts] = String(process.env.SYMBOLS || "").split("|");
const arg = argRaw.trim();
const notesRe = (opts.find((o) => o.startsWith("notes=")) ?? "").slice(6);
// "REXR,AD|field=revenue": EVERY cell of that field for those filers, changed
// ("*") or not, each with what the filer files for that exact period under the
// revenue concepts (the "SEC" column).
const showField = (opts.find((o) => o.startsWith("field=")) ?? "").slice(6) || null;
const shardM = arg.match(/SHARD\s+(\d+)\s*\/\s*(\d+)/i);
let targets;
if (!arg || shardM) {
  const { Redis } = await import("@upstash/redis");
  const KEY = (fs.readFileSync("lib/server/secManifest.ts", "utf8").match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
  const manifest = await Redis.fromEnv().get(KEY);
  if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
  const all = Object.entries(manifest.symbols).filter(([, e]) => e?.cik).map(([s, e]) => [s, String(e.cik).padStart(10, "0")]).sort();
  const [shard, shards] = shardM ? [Number(shardM[1]), Number(shardM[2])] : [0, 1];
  targets = all.filter((_, i) => i % shards === shard);
} else {
  const tick = JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8"));
  const ix = Object.fromEntries(tick.fields.map((f, i) => [f, i]));
  targets = arg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).map((s) => {
    const r = tick.data.find((x) => x[ix.ticker] === s);
    return r ? [s, String(r[ix.cik]).padStart(10, "0")] : null;
  }).filter(Boolean);
}
console.log(`filers: ${targets.length}\n`);

const fmt = (v) => (v == null ? "—" : Math.abs(v) >= 1e5 ? `${(v / 1e6).toFixed(1)}M` : String(+v.toFixed(4)));
const label = (p) => `${p.fp ?? ""}${p.fy ?? ""} ${p.start ?? ""}..${p.end}`;
const byField = {};
// What the filer itself files for exactly start..end, newest filing per concept.
const REV_CONCEPTS = [
  "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax",
  "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue", "OperatingLeaseLeaseIncome", "SalesRevenueNet",
];
function filedFor(facts, start, end) {
  const g = facts?.facts?.["us-gaap"] ?? {};
  const out = [];
  for (const c of REV_CONCEPTS) {
    const rows = Object.values(g[c]?.units ?? {}).flat().filter((r) => r.start === start && r.end === end);
    if (!rows.length) continue;
    const r = rows.sort((x, y) => String(y.filed).localeCompare(String(x.filed)))[0];
    out.push(`${c.replace("RevenueFromContractWithCustomer", "Contract").replace("ExcludingAssessedTax", "")}=${fmt(r.val)}`);
  }
  return out.length ? out.join("; ") : "none filed for this period (derived)";
}
let filersChanged = 0, cells = 0, failed = 0;
for (const [sym, cik] of targets) {
  let facts;
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) { failed++; continue; }
    facts = await res.json();
  } catch { failed++; continue; }
  try {
    const a = OLD.extractCompanyFacts(sym, facts), b = NEW.extractCompanyFacts(sym, facts);
    const keys = NEW.SEC_FIELD_KEYS;
    const lines = [];
    for (const kind of ["years", "quarters", "instants"]) {
      const am = new Map(a[kind].map((p) => [`${p.start}|${p.end}`, p]));
      const bm = new Map(b[kind].map((p) => [`${p.start}|${p.end}`, p]));
      for (const k of new Set([...am.keys(), ...bm.keys()])) {
        const pa = am.get(k), pb = bm.get(k), p = pb ?? pa;
        keys.forEach((f, i) => {
          const va = pa?.values?.[i]?.val ?? null, vb = pb?.values?.[i]?.val ?? null;
          if (showField ? f !== showField : va === vb) return;
          const sec = f === "revenue" && showField ? `\tSEC ${filedFor(facts, p.start, p.end)}` : "";
          lines.push(`${sym}\t${f}\t${kind === "years" ? "Y" : kind === "quarters" ? "Q" : "I"} ${kind === "instants" ? p.end : label(p)}\t${fmt(va)} -> ${fmt(vb)}${showField && va !== vb ? " *" : ""}${sec}${kind === "instants" && /Debt$/.test(f) && pb?.values?.[i]?.tag ? `\t[${pb.values[i].tag}${pb.values[i].derived === "computed" ? ", netted" : ""}]` : ""}`);
          byField[f] = (byField[f] ?? 0) + 1;
        });
      }
    }
    // NET CASH OR NET DEBT on the newest balance sheet, before and after:
    // cash (+ short-term investments) - (short-term + long-term debt), the
    // view's own definition; total debt needs a long-term line.
    const net = (ex) => {
      const p = ex.instants[0]; if (!p) return null;
      const v = (f) => p.values[keys.indexOf(f)]?.val ?? null;
      // The view's own cash rule (secEarningsView cashCell): the plain figure,
      // else the one including restricted cash. Reading only `cash` left CVX
      // and TRV at n/a here while the page computes their net position.
      const cash = v("cash") ?? v("cashIncludingRestricted");
      if (cash === null || v("longTermDebt") === null) return null;
      return cash + (v("shortTermInvestments") ?? 0) - ((v("shortTermDebt") ?? 0) + v("longTermDebt"));
    };
    if (lines.some((l) => /\t(shortTermDebt|longTermDebt)\tI /.test(l))) {
      const na = net(a), nb = net(b), side = (n) => (n === null ? "n/a" : n >= 0 ? "net cash" : "net debt");
      lines.push(`NET ${sym}\t${b.instants[0]?.end ?? "—"}\t${side(na)} ${fmt(na)} -> ${side(nb)} ${fmt(nb)}${side(na) !== side(nb) && na !== null ? "\tFLIP" : ""}`);
    }
    // MIX: a debt series that reads a primary concept on some dates and a
    // fallback on others -- the two may not measure the same debt.
    const FB = new Set(["CommercialPaper", "ConvertibleDebtNoncurrent", ...Object.keys(NEW.COMBINED_DEBT ?? {})]);
    for (const f of ["shortTermDebt", "longTermDebt"]) {
      const tags = new Set(b.instants.map((p) => p.values[keys.indexOf(f)]?.tag).filter(Boolean));
      const fb = [...tags].filter((t) => FB.has(t)), pr = [...tags].filter((t) => !FB.has(t));
      if (fb.length && pr.length && lines.length) lines.push(`MIX ${sym}\t${f}\t${pr.join(",")} + ${fb.join(",")}`);
    }
    if (notesRe) for (const n of b.notes ?? []) if (new RegExp(notesRe, "i").test(n)) console.log(`NOTE ${sym}\t${n}`);
    if (lines.length) { filersChanged++; cells += lines.filter((l) => !/^(NET|MIX) /.test(l)).length; for (const l of lines) console.log(l); }
  } catch (e) { failed++; console.log(`ERR ${sym}: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`\nfilers changed: ${filersChanged} of ${targets.length - failed} read (${failed} failed); cells changed: ${cells}`);
for (const [f, n] of Object.entries(byField).sort((x, y) => y[1] - x[1])) console.log(`  ${f}: ${n}`);
