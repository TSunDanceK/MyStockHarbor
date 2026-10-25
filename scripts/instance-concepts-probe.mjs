// EVERY FACT OF THE NAMED CONCEPTS IN ONE FILING'S XBRL INSTANCE, with its
// context (period, and any dimension members). Read-only, SEC only.
//   SYMBOLS="FOXA:1754301:0001628280-26-053960|NetIncomeLoss,ProfitLoss"
//   relay task: sec-instance-concepts
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; instance concepts probe)";
const get = async (u) => { await new Promise((x) => setTimeout(x, 150)); const r = await fetch(u, { headers: { "User-Agent": UA } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r; };
const [targets, conceptList] = String(process.env.SYMBOLS || "").split("|");
const concepts = (conceptList || "").split(",").map((s) => s.trim()).filter(Boolean);
for (const t of targets.split(",").map((s) => s.trim()).filter(Boolean)) {
  const [sym, cikRaw, accn] = t.split(":");
  const cik = String(Number(cikRaw));
  try {
    const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}`;
    const names = (await (await get(`${base}/index.json`)).json()).directory.item.map((x) => x.name);
    const inst = names.find((n) => /_htm\.xml$/i.test(n)) ?? names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre)\.xml$/i.test(n));
    const xml = await (await get(`${base}/${inst}`)).text();
    const ctx = new Map();
    for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
      const b = m[2];
      const per = b.match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1] ?? `${b.match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/)?.[1]}..${b.match(/<(?:[\w-]+:)?endDate>\s*([\d-]+)/)?.[1]}`;
      const dims = [...b.matchAll(/dimension="([\w-]+:\w+)"[^>]*>\s*([^<\s]+)\s*</g)].map((d) => `${d[1].split(":")[1]}=${d[2].split(":").pop()}`);
      ctx.set(m[1], { per, dims: dims.join(";") || "(no dimensions)" });
    }
    console.log(`== ${sym} ${accn} (${inst})`);
    for (const c of concepts) {
      const hits = [...xml.matchAll(new RegExp(`<([\\w-]+):${c}\\b[^>]*contextRef="([^"]+)"[^>]*>([^<]*)<`, "g"))];
      console.log(`  ${c}: ${hits.length} fact(s)`);
      for (const h of hits) { const x = ctx.get(h[2]); console.log(`    ${h[1]}:${c} | ${x?.per} | ${x?.dims} | ${Number(h[3]).toLocaleString("en-US")}`); }
    }
  } catch (e) { console.log(`== ${sym}: ${e.message}`); }
}
