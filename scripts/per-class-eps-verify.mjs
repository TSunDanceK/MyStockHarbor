// VERIFY ONE FILER'S PER-CLASS EPS AGAINST THE FILING ITSELF (#552 COWORK #244). Reads only.
//   relay task: per-class-eps-verify  (SYMBOLS = ticker; ACCS = accessions, comma-separated)
// Prints every EPS / net income / weighted-share fact in each instance with its
// period and dimensions, and the rendered income-statement page's EPS rows (R*.htm).
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; per-class eps verify)";
const sym = (process.env.SYMBOLS || "CVNA").split(",")[0].trim().toUpperCase();
const ACCS = (process.env.PAYERS || "0001690820-26-000055,0001690820-26-000035").split(",").map((s) => s.trim()).filter(Boolean);
let lastAt = 0;
const get = async (url, kind = "json") => {
  const wait = Math.max(0, lastAt + 150 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  return res.ok ? (kind === "json" ? res.json() : res.text()) : null;
};
const t = await get("https://www.sec.gov/files/company_tickers.json");
const cik = Object.values(t).find((x) => x.ticker === sym)?.cik_str;
const RX = /^(EarningsPerShare\w*|NetIncomeLoss\w*|ProfitLoss|WeightedAverageNumber\w*|NetIncomeLossAttributableToNoncontrollingInterest)$/;
for (const acc of ACCS) {
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, "")}`;
  const idx = await get(`${base}/index.json`);
  const names = (idx?.directory?.item ?? []).map((i) => i.name);
  const inst = names.find((n) => /_htm\.xml$/i.test(n));
  console.log(`\n######## ${sym} ${acc} instance ${inst}`);
  const xml = await get(`${base}/${inst}`, "text");
  const ctx = new Map();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const s = m[2].match(/startDate>\s*([\d-]+)/)?.[1], e = m[2].match(/endDate>\s*([\d-]+)/)?.[1];
    const d = [...m[2].matchAll(/explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]*)/g)].map((x) => `${x[1].replace(/^.*:/, "")}=${x[2].replace(/^.*:/, "")}`);
    ctx.set(m[1], `${s}..${e}${d.length ? " [" + d.join(",") + "]" : ""}`);
  }
  const rows = [];
  for (const m of xml.matchAll(/<us-gaap:(\w+)\b([^>]*)>\s*([^<]+?)\s*<\/us-gaap:\1>/g)) {
    if (!RX.test(m[1])) continue;
    const c = ctx.get(m[2].match(/contextRef="([^"]+)"/)?.[1]);
    if (!c || !c.startsWith("2026") && !c.startsWith("2025")) continue;
    rows.push(`${m[1]} ${c} = ${m[3]}`);
  }
  [...new Set(rows)].sort().forEach((r) => console.log("  " + r));
  // The rendered statements: find the R page that carries "per share" rows.
  for (const n of names.filter((n) => /^R\d+\.htm$/i.test(n)).slice(0, 8)) {
    const html = await get(`${base}/${n}`, "text");
    if (!html || !/Diluted/i.test(html) || !/per share/i.test(html)) continue;
    const title = html.match(/<th[^>]*class="tl"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/i)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const heads = [...html.matchAll(/<th[^>]*class="th"[^>]*>([\s\S]*?)<\/th>/gi)].map((h) => h[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    console.log(`  RENDERED ${n}: ${title} · columns: ${heads.join(" | ")}`);
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1].replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/\s+/g, " ").trim());
      if (cells.length && /per share|diluted|basic|attributable to|net income/i.test(cells[0])) console.log(`    ${cells.join(" | ")}`);
    }
    break;
  }
}
