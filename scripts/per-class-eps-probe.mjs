// PER-CLASS QUARTERLY EPS, IDENTIFIED FROM THE FILING ITSELF (#552 COWORK #243). Reads only.
//   relay task: per-class-eps-probe   (no credentials; SEC only)
//
// For each symbol: the newest 10-Q/10-K instances (up to MAX_FILINGS), and in
// each one
//   - the cover page's dei:TradingSymbol facts, with the StatementClassOfStockAxis
//     member of their context: ticker -> class member, from the filing;
//   - diluted EPS (EarningsPerShareDiluted, else BasicAndDiluted) on 3-month
//     contexts, undimensioned and per class member.
// Then, per quarter end: the undimensioned figure if filed, else the figure for
// the class whose TradingSymbol is the listed ticker, else why not.
// The shipped secFilingFill.pickInstanceName rule, over an index.json listing.
const pickInstanceFromIndex = (idx) => {
  const names = (idx?.directory?.item ?? []).map((it) => String(it.name ?? ""));
  return names.find((n) => /_htm\.xml$/i.test(n)) ?? names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre)\.xml$/i.test(n)) ?? null;
};

const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; per-class eps probe)";
const SYMBOLS = (process.env.SYMBOLS || "CVNA,AIG,AMBP,BB,BCE,BULL,GSHD,IMTX,MAIN,MKL,PENG,QNME,TRLV").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const MAX_FILINGS = Number(process.env.MAX_FILINGS || 9);
process.env.COVER ??= "1";

let lastAt = 0, requests = 0;
const get = async (url, kind = "json") => {
  for (let a = 0; a < 3; a++) {
    const wait = Math.max(0, lastAt + 130 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now(); requests++;
    try { const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } }); if (res.ok) return kind === "json" ? res.json() : res.text(); if (res.status === 404) return null; } catch {}
    await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return null;
};
const tickers = await get("https://www.sec.gov/files/company_tickers.json");
const cikOf = new Map(Object.values(tickers ?? {}).map((t) => [String(t.ticker).toUpperCase(), String(t.cik_str)]));
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

/** Contexts: id -> {start,end,instant,dims:[[axis,member]]}. */
function contexts(xml) {
  const out = new Map();
  for (const m of xml.matchAll(/<(?:[\w-]+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?context>/g)) {
    const start = m[2].match(/<(?:[\w-]+:)?startDate>\s*([\d-]+)/)?.[1] ?? null;
    const end = m[2].match(/<(?:[\w-]+:)?endDate>\s*([\d-]+)/)?.[1] ?? m[2].match(/<(?:[\w-]+:)?instant>\s*([\d-]+)/)?.[1] ?? null;
    const dims = [...m[2].matchAll(/<(?:[\w-]+:)?explicitMember[^>]*dimension="([^"]+)"[^>]*>\s*([^<\s]*)/g)].map((d) => [d[1].replace(/^.*:/, ""), d[2].replace(/^.*:/, "")]);
    out.set(m[1], { start, end, dims });
  }
  return out;
}
const classMember = (c) => (c && c.dims.length === 1 && c.dims[0][0] === "StatementClassOfStockAxis" ? c.dims[0][1] : c && c.dims.length === 0 ? null : undefined);

function readInstance(xml) {
  const ctx = contexts(xml);
  const symbolToMember = new Map();
  for (const m of xml.matchAll(/<dei:TradingSymbol\b([^>]*)>\s*([^<]+?)\s*<\/dei:TradingSymbol>/g)) {
    const ref = m[1].match(/\bcontextRef="([^"]+)"/)?.[1];
    const mem = classMember(ctx.get(ref));
    if (mem !== undefined) symbolToMember.set(m[2].trim().toUpperCase(), mem);
  }
  const eps = [];
  for (const m of xml.matchAll(/<us-gaap:(EarningsPerShareDiluted|EarningsPerShareBasicAndDiluted)\b([^>]*)>\s*([^<]+?)\s*<\/us-gaap:\1>/g)) {
    const c = ctx.get(m[2].match(/\bcontextRef="([^"]+)"/)?.[1]);
    const mem = classMember(c);
    if (mem === undefined || !c?.start) continue;
    const d = days(c.start, c.end);
    if (d < 80 || d > 120) continue;
    eps.push({ concept: m[1], start: c.start, end: c.end, member: mem, val: Number(m[3]) });
  }
  const titles = [];
  for (const m of xml.matchAll(/<dei:(Security12bTitle|TradingSymbol)\b([^>]*)>\s*([^<]+?)\s*<\/dei:\1>/g)) {
    const c = ctx.get(m[2].match(/\bcontextRef="([^"]+)"/)?.[1]);
    titles.push(`${m[1]}[${c?.dims.map((d) => d.join("=")).join(",") || "-"}]="${m[3].trim()}"`);
  }
  const members = [...new Set([...xml.matchAll(/StatementClassOfStockAxis">\s*([^<\s]+)/g)].map((x) => x[1].replace(/^.*:/, "")))];
  return { symbolToMember, eps, titles, members };
}

for (const sym of SYMBOLS) {
  const cik = cikOf.get(sym);
  console.log(`\n######## ${sym} cik ${cik ?? "none"}`);
  if (!cik) continue;
  const subs = await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`);
  const r = subs?.filings?.recent ?? {};
  const picks = (r.form ?? []).map((f, i) => ({ f, i })).filter((x) => /^(10-Q|10-K)$/.test(x.f)).slice(0, MAX_FILINGS);
  if (!picks.length) { console.log(`  no 10-Q/10-K (forms: ${[...new Set((r.form ?? []).slice(0, 20))].join(",")})`); continue; }
  const byEnd = new Map();
  const mapSeen = new Map();
  for (const { f, i } of picks) {
    const acc = r.accessionNumber[i];
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}`;
    const idx = await get(`${base}/index.json`);
    const name = pickInstanceFromIndex(idx);
    if (!name) { console.log(`  ${f} ${acc}: no instance`); continue; }
    const xml = await get(`${base}/${name}`, "text");
    if (!xml) continue;
    const { symbolToMember, eps, titles, members } = readInstance(xml);
    if (process.env.COVER) console.log(`  cover ${acc}: ${titles.join(" | ")} · class members ${members.join(",")}`);
    for (const [s, m] of symbolToMember) mapSeen.set(s, m);
    const mine = symbolToMember.has(sym) ? symbolToMember.get(sym) : undefined;
    for (const e of eps) {
      const k = e.end;
      const slot = byEnd.get(k) ?? { undim: null, classes: new Map(), listed: undefined };
      if (e.member === null) slot.undim ??= e.val;
      else slot.classes.set(e.member, e.val);
      if (mine !== undefined && slot.listed === undefined) slot.listed = mine;
      byEnd.set(k, slot);
    }
    console.log(`  ${f} ${acc} ${r.reportDate?.[i] ?? ""}: TradingSymbol ${[...symbolToMember].map(([s, m]) => `${s}=${m ?? "(none)"}`).join(" ") || "none"} · 3M EPS facts ${eps.length}`);
  }
  console.log(`  ticker -> class: ${mapSeen.has(sym) ? `${sym} = ${mapSeen.get(sym) ?? "(undimensioned)"}` : "NOT IDENTIFIED from the filing"}`);
  for (const [end, s] of [...byEnd].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10)) {
    const listed = s.listed ?? mapSeen.get(sym);
    const pick = s.undim != null ? `undimensioned ${s.undim}` : listed && s.classes.has(listed) ? `class ${listed} ${s.classes.get(listed)}` : `refused (classes: ${[...s.classes].map(([m, v]) => `${m}=${v}`).join(" ") || "none"})`;
    console.log(`  Q ${end}: ${pick}`);
  }
}
console.log(`\nSEC requests: ${requests}`);
