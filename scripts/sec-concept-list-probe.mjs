// WHICH us-gaap CONCEPTS A FILER ACTUALLY PUBLISHES FOR ITS RECENT PERIODS —
// listed, with values, so a chain edit is made against the payload and not
// against a memory of the taxonomy.
//
// Earnings page round 2 (items c/d): AVAV's balance sheet read "Not reported"
// for total liabilities and shareholders' equity, and its income statement for
// interest expense and other income, while pre-tax and operating income
// differed. This prints, for the newest few period ends, every concept whose
// name matches a balance-sheet total or a non-operating line, so the gap is
// classified as "chain gap" or "not tagged" on evidence.
//
// Read-only: no credential, no store, no writes. Needs the network.
//
//   SYMBOLS="AVAV:0001368622" node scripts/sec-concept-list-probe.mjs
//   PATTERN="Liabilit|Equity|Interest|Nonoperating" to override the filter
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; concept list)";
const TARGETS = (process.env.SYMBOLS || "AVAV:0001368622")
  .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  .map((s) => { const [sym, cik] = s.split(":"); return { sym: sym.toUpperCase(), cik: String(cik ?? "").padStart(10, "0") }; });
const PATTERN = new RegExp(process.env.PATTERN ||
  "Liabilit|Equity|Interest|Nonoperating|OtherIncome|OtherExpense|OtherNonoperating|IncomeLossFromContinuingOperationsBefore|OperatingIncomeLoss|InvestmentIncome", "i");
const PERIODS = Number(process.env.PERIODS || 4);

for (const { sym, cik } of TARGETS) {
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
  });
  if (!res.ok) { console.log(`${sym}: HTTP ${res.status}`); continue; }
  const facts = await res.json();
  const gaap = facts?.facts?.["us-gaap"] ?? {};
  console.log(`\n══ ${sym} (CIK ${cik}) ${facts.entityName} — ${Object.keys(gaap).length} us-gaap concepts`);

  // The newest period ends, read off Assets (every 10-Q/10-K balance sheet).
  const ends = [...new Set((gaap.Assets?.units?.USD ?? [])
    .filter((r) => /^10-[QK]/.test(r.form ?? "")).map((r) => r.end))].sort().reverse().slice(0, PERIODS);
  console.log(`newest balance-sheet ends: ${ends.join(", ")}`);
  const newest = ends[0];

  const lines = [];
  for (const [concept, body] of Object.entries(gaap)) {
    if (!PATTERN.test(concept)) continue;
    const rows = (body.units?.USD ?? []).filter((r) => /^10-[QK]/.test(r.form ?? ""));
    const recent = rows.filter((r) => ends.includes(r.end));
    if (!recent.length) continue;
    // One reading per (start,end), newest filing wins; durations show their length.
    const by = new Map();
    for (const r of recent) {
      const k = `${r.start ?? ""}..${r.end}`;
      const prev = by.get(k);
      if (!prev || String(r.filed) > String(prev.filed)) by.set(k, r);
    }
    const cells = [...by.values()].sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0))
      .map((r) => {
        const days = r.start ? Math.round((Date.parse(r.end) - Date.parse(r.start)) / 864e5) + "d" : "inst";
        return `${r.end}/${days}=${r.val}`;
      });
    lines.push(`${concept.padEnd(88)} ${newest && recent.some((r) => r.end === newest) ? "NEWEST" : "      "} ${cells.slice(0, 6).join("  ")}`);
  }
  lines.sort();
  for (const l of lines) console.log(`  ${l}`);
}
