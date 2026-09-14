// Is a symbol's registrant still filing? Asked of data.sec.gov/submissions, by CIK.
//
// WHY THIS EXISTS. Four universe symbols -- BK, EA, EQR, WBS -- have no row in
// SEC's ticker file. Two are explained: CIK 1390777 now lists as BNY and CIK
// 906107 as VMRK, so those are RETICKERS and the pipeline classifies them as
// such from the map's own CIK index. EA and WBS have no row under any ticker.
//
// ABSENCE FROM THE TICKER FILE IS NOT PROOF OF DEREGISTRATION. That file is a
// convenience index, not the filing record; a registrant can be mid-rename,
// newly private, or simply missing a row. Retiring a symbol on that evidence
// alone would discard its filing history on the strength of a lookup miss --
// the same failure-versus-absence trap this pipeline has been built against
// throughout. submissions/ is the filing record and settles it.
//
// RUNS ON A RUNNER, not in the agent sandbox, which is refused data.sec.gov with
// 403 CONNECT. Dispatch .github/workflows/relay.yml with task `sec-symbol-status`
// and SYMBOLS set to entries of either form:
//
//     SYMBOLS="EA:0000712515,WBS:0000801337,BK,AAPL"
//
// A bare ticker is resolved against the committed data/sec/company-tickers.json;
// a TICKER:CIK pair skips that lookup, which is the point for symbols the file
// no longer carries.
import fs from "node:fs";
import path from "node:path";

const UA =
  process.env.SEC_USER_AGENT ||
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; symbol status check)";
const INPUT = (process.env.SYMBOLS || process.argv[2] || "").trim();
if (!INPUT) {
  console.error('FATAL: no SYMBOLS. e.g. SYMBOLS="EA:0000712515,WBS:0000801337"');
  process.exit(2);
}

const padCik = (v) => String(v).replace(/\D/g, "").padStart(10, "0");

// ── The committed ticker file, for bare tickers ─────────────────────────────
const byTicker = new Map();
{
  const p = path.join(process.cwd(), "data/sec/company-tickers.json");
  if (fs.existsSync(p)) {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if (Array.isArray(j.fields) && Array.isArray(j.data)) {
      const iT = j.fields.indexOf("ticker");
      const iC = j.fields.indexOf("cik");
      for (const r of j.data) if (r?.[iT]) byTicker.set(String(r[iT]).toUpperCase(), padCik(r[iC]));
    } else {
      for (const r of Object.values(j)) if (r?.ticker) byTicker.set(String(r.ticker).toUpperCase(), padCik(r.cik_str));
    }
    console.log(`ticker file: ${byTicker.size} tickers`);
  } else {
    console.log("ticker file: ABSENT — bare tickers cannot be resolved, pass TICKER:CIK");
  }
}

const targets = INPUT.split(",").map((s) => s.trim()).filter(Boolean).map((entry) => {
  const [sym, cik] = entry.split(":");
  const symbol = sym.trim().toUpperCase();
  return { symbol, cik: cik ? padCik(cik) : byTicker.get(symbol) ?? null };
});

// SEC's fair-access policy: 10 requests/second. One at a time with a gap is far
// under it and costs seconds on a run that happens by hand.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n${"symbol".padEnd(8)} ${"cik".padEnd(12)} status`);
const out = [];
for (const t of targets) {
  if (!t.cik) {
    console.log(`${t.symbol.padEnd(8)} ${"—".padEnd(12)} NO CIK — absent from the ticker file; pass ${t.symbol}:<cik> to check it`);
    out.push({ symbol: t.symbol, cik: null, resolved: false });
    continue;
  }
  const url = `https://data.sec.gov/submissions/CIK${t.cik}.json`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (res.status !== 200) {
      console.log(`${t.symbol.padEnd(8)} ${t.cik.padEnd(12)} HTTP ${res.status} — ${res.status === 404 ? "no such CIK" : "unexpected"}`);
      out.push({ symbol: t.symbol, cik: t.cik, status: res.status });
      await sleep(150);
      continue;
    }
    const j = await res.json();
    const recent = j?.filings?.recent ?? {};
    const forms = recent.form ?? [];
    const dates = recent.filingDate ?? [];
    // THE QUESTION IS "STILL FILING", so the newest PERIODIC filing is the
    // answer, not the newest filing of any kind -- a Form 25 or 15 is precisely
    // what a deregistering company files last, and counting it as activity
    // would invert the verdict.
    const PERIODIC = /^(10-Q|10-K|20-F|6-K)/;
    let latestPeriodic = null;
    let latestAny = null;
    const formCounts = {};
    for (let i = 0; i < forms.length; i++) {
      const f = String(forms[i]);
      formCounts[f] = (formCounts[f] ?? 0) + 1;
      const d = String(dates[i] ?? "");
      if (!latestAny || d > latestAny.date) latestAny = { form: f, date: d };
      if (PERIODIC.test(f) && (!latestPeriodic || d > latestPeriodic.date)) latestPeriodic = { form: f, date: d };
    }
    // Form 25 (delisting) and Form 15 (deregistration) are the explicit signals.
    const exit = Object.keys(formCounts).filter((f) => /^(25|25-NSE|15|15-12B|15-12G|15-15D)$/.test(f));
    const row = {
      symbol: t.symbol,
      cik: t.cik,
      name: j?.name ?? null,
      tickersOnFile: j?.tickers ?? [],
      exchanges: j?.exchanges ?? [],
      formerNames: (j?.formerNames ?? []).map((f) => f?.name).filter(Boolean),
      latestPeriodic,
      latestAny,
      exitForms: exit,
    };
    out.push(row);
    console.log(
      `${t.symbol.padEnd(8)} ${t.cik.padEnd(12)} ${row.name ?? "?"}` +
        `\n${" ".repeat(22)}tickers on file: ${row.tickersOnFile.join(", ") || "(none)"}   exchanges: ${row.exchanges.join(", ") || "(none)"}` +
        `\n${" ".repeat(22)}latest periodic: ${latestPeriodic ? `${latestPeriodic.form} ${latestPeriodic.date}` : "NONE"}` +
        `   latest any: ${latestAny ? `${latestAny.form} ${latestAny.date}` : "none"}` +
        (row.formerNames.length ? `\n${" ".repeat(22)}former names: ${row.formerNames.join(" | ")}` : "") +
        (exit.length ? `\n${" ".repeat(22)}*** EXIT FORMS PRESENT: ${exit.join(", ")} — deregistration/delisting filed` : "")
    );
  } catch (err) {
    console.log(`${t.symbol.padEnd(8)} ${t.cik.padEnd(12)} ERROR ${err?.message ?? err}`);
    out.push({ symbol: t.symbol, cik: t.cik, error: String(err?.message ?? err) });
  }
  await sleep(150);
}

console.log(`\nREAD IT LIKE THIS`);
console.log(`  a recent periodic filing        -> still a filer; the ticker row is what is missing, not the company`);
console.log(`  no periodic for several quarters -> candidate for retirement, and the exit forms say whether it is confirmed`);
console.log(`  tickers on file differing from the symbol -> a RETICKER; the pipeline already handles these from the CIK index`);
fs.writeFileSync("sec-symbol-status.json", JSON.stringify({ checkedAt: new Date().toISOString(), results: out }, null, 2));
console.log(`\nwrote sec-symbol-status.json`);
