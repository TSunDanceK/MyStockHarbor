// WHICH EPS CONCEPTS DOES A FILER USE? (#552 COWORK #33). SEC only, read-only.
// (1) companyfacts: every per-share / per-unit earnings concept, its newest
//     rows (end, days, form, fp) — to see what the extractor misses.
// (2) the newest 10-Q/10-K instance: every EarningsPerShare* / per-unit fact
//     with its dimensions and period — the per-class figures companyfacts drops.
//   node scripts/eps-concepts-probe.mjs "V,BRK.B,C"
import fs from "node:fs";
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; eps concepts)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const syms = (process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
const get = async (u) => { await new Promise((x) => setTimeout(x, 130)); return fetch(u, { headers: { "User-Agent": UA } }); };
const DAY = 864e5;
for (const s of syms) {
  const cik = String(REG[s]?.cik ?? REG[s.replace(".", "-")]?.cik ?? "").padStart(10, "0");
  try {
    const cf = await (await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`)).json();
    console.log(`\n== ${s} (${cf.entityName})`);
    for (const [ns, concepts] of Object.entries(cf.facts ?? {})) {
      for (const [name, c] of Object.entries(concepts)) {
        if (!/PerShare|PerUnit|PerOutstanding/i.test(name) || !/Earning|Income|Loss/i.test(name)) continue;
        const rows = Object.values(c.units ?? {}).flat().filter((r) => r.start).sort((a, b) => b.end.localeCompare(a.end));
        if (!rows.length) continue;
        const show = rows.slice(0, 6).map((r) => `${r.end} ${Math.round((Date.parse(r.end) - Date.parse(r.start)) / DAY)}d ${r.form} ${r.fp} ${r.val}`).join(" | ");
        console.log(`  cf ${ns}:${name} [${rows.length}] ${show}`);
      }
    }
    const subs = await (await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).json();
    const r = subs.filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f) => f === "10-Q" || f === "10-K");
    if (i < 0) { console.log("  no 10-Q/10-K"); continue; }
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}`;
    const idx = await (await get(`${base}/index.json`)).json();
    const name = (idx.directory?.item ?? []).map((it) => it.name).find((n) => /_htm\.xml$/i.test(n));
    if (!name) { console.log("  no instance"); continue; }
    const xml = await (await get(`${base}/${name}`)).text();
    const ctx = new Map();
    for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
      const st = m[2].match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/)?.[1], en = m[2].match(/<(?:[\w-]+:)?endDate>\s*([\d-]+)/)?.[1];
      const dims = [...m[2].matchAll(/dimension="([^"]+)"[^>]*>\s*([^<\s]+)/g)].map((d) => `${d[1].replace(/^.*:/, "")}=${d[2].replace(/^.*:/, "")}`);
      ctx.set(m[1], { per: st && en ? `${st}..${en}` : null, dims: dims.join(",") });
    }
    console.log(`  instance ${r.form[i]} ${r.accessionNumber[i]} filed ${r.filingDate[i]}`);
    const seen = new Set();
    for (const m of xml.matchAll(/<([\w-]+):([\w]*(?:EarningsPerShare|PerOutstanding|PerUnit|PerShare)[\w]*)\b[^>]*\bcontextRef="([^"]+)"[^>]*>\s*([^<]+?)\s*</g)) {
      if (!/Earning|Income|Loss/i.test(m[2])) continue;
      const c = ctx.get(m[3]);
      const line = `  xml ${m[1]}:${m[2]} ${c?.per} [${c?.dims || "-"}] ${m[4]}`;
      if (!seen.has(line)) { seen.add(line); if (seen.size <= 40) console.log(line); }
    }
    const w = new Set();
    for (const m of xml.matchAll(/<([\w-]+):(WeightedAverageNumberOf\w*)\b[^>]*\bcontextRef="([^"]+)"[^>]*>\s*([^<]+?)\s*</g)) {
      const c = ctx.get(m[3]);
      const line = `  shr ${m[2]} ${c?.per} [${c?.dims || "-"}] ${m[4]}`;
      if (!w.has(line)) { w.add(line); if (w.size <= 16) console.log(line); }
    }
  } catch (e) { console.log(`\n== ${s}: error ${String(e?.message ?? e).slice(0, 100)}`); }
}
