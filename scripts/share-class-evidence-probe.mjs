// ARE A FILER'S SHARE CLASSES ECONOMICALLY EQUAL? (#552 COWORK #31)
// For each symbol: the latest 10-K's primary document, as text, and the
// sentences that say how its classes relate -- conversion ("convertible ...
// one-for-one", "conversion rate"), dividend/economic rights ("identical
// rights", "no economic rights", "not entitled to ... dividends"). Printed
// verbatim so each class weight is cited from the filing. SEC text only;
// read-only, no credential.
//   node scripts/share-class-evidence-probe.mjs "META,V,BRK-B"
import fs from "node:fs";
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; share class evidence)";
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const syms = (process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
const get = async (u) => { const r = await fetch(u, { headers: { "User-Agent": UA } }); await new Promise((x) => setTimeout(x, 130)); return r; };
const PATTERNS = [
  /convert(?:ible|ed|s)?[^.]{0,160}\b(?:one-for-one|share-for-share|one share of class|on a one[- ]for[- ]one basis|1:1|1-for-1)[^.]{0,160}\./gi,
  /\bconversion (?:rate|ratio)[^.]{0,220}\./gi,
  /\b(?:identical|the same|equal|equivalent)\s+(?:economic\s+)?rights[^.]{0,220}\./gi,
  /[^.]{0,160}\b(?:no economic rights|non-economic|not entitled to (?:receive |share in )?(?:any )?(?:dividends|distributions))[^.]{0,160}\./gi,
  /[^.]{0,120}\bequivalent (?:to|of) (?:1,500|one-(?:thirtieth|fifteen-hundredth))[^.]{0,160}\./gi,
  /[^.]{0,120}\bas-converted\b[^.]{0,160}\./gi,
];
for (const s of syms) {
  const cik = String(REG[s]?.cik ?? REG[s.replace(".", "-")]?.cik ?? "").padStart(10, "0");
  try {
    const subs = await (await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).json();
    const r = subs.filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f) => f === "10-K");
    if (i < 0) { console.log(`\n== ${s}: no 10-K`); continue; }
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${r.accessionNumber[i].replace(/-/g, "")}/${r.primaryDocument[i]}`;
    const html = await (await get(url)).text();
    const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ")
      .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
    const hits = [];
    for (const re of PATTERNS) for (const m of text.matchAll(re)) { const t = m[0].trim(); if (!hits.some((h) => h === t)) hits.push(t); }
    console.log(`\n== ${s} | 10-K ${r.filingDate[i]} ${r.accessionNumber[i]} | ${hits.length} hit(s)`);
    for (const h of hits.slice(0, 5)) console.log(`   > ${h.slice(0, 380)}`);
  } catch (e) { console.log(`\n== ${s}: error ${String(e?.message ?? e).slice(0, 80)}`); }
}
