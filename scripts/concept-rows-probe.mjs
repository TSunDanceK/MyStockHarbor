// EVERY COMPANYFACTS ROW OF THE NAMED CONCEPTS FROM A DATE ON: start, end,
// length, value, form, accession, filed. Shows the 6M/9M frames field-trace
// does not. Read-only, SEC only.
//   SYMBOLS="BAC:70858,FCX:831259|Revenues,NetIncomeLoss|2024-01-01"
//   relay task: sec-concept-rows
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; concept rows probe)";
const get = async (u) => { await new Promise((x) => setTimeout(x, 150)); const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r; };
const [targets, conceptList, from = "2024-01-01"] = String(process.env.SYMBOLS || "").split("|");
const concepts = (conceptList || "").split(",").map((s) => s.trim()).filter(Boolean);
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
for (const t of targets.split(",").map((s) => s.trim()).filter(Boolean)) {
  const [sym, cikRaw] = t.split(":");
  try {
    const cf = await (await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(Number(cikRaw)).padStart(10, "0")}.json`)).json();
    for (const c of concepts) {
      const [ns, tag] = c.includes(":") ? c.split(":") : ["us-gaap", c];
      const units = cf.facts?.[ns]?.[tag]?.units ?? {};
      const rows = Object.entries(units).flatMap(([u, rs]) => rs.map((r) => ({ ...r, u }))).filter((r) => (r.end ?? "") >= from);
      console.log(`== ${sym} ${ns}:${tag} — ${rows.length} row(s) ending on/after ${from}`);
      rows.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.end.localeCompare(b.end) || a.filed.localeCompare(b.filed));
      for (const r of rows) console.log(`  ${r.start ?? "(inst)"}..${r.end} ${r.start ? days(r.start, r.end) + "d" : ""} | ${r.val} ${r.u} | ${r.form} ${r.accn} filed ${r.filed} fp=${r.fp}${r.fy} ${r.frame ?? ""}`);
    }
  } catch (e) { console.log(`== ${sym}: ${e.message}`); }
}
