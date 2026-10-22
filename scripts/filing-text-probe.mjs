// WHAT A FILER'S LATEST 10-K SAYS, AROUND THE WORDS ASKED FOR — read from the
// filing's own primary document, so a ruling quotes the filing rather than a
// reading of its tags (audit r3: NJR's and SRE's revenue outside ASC 606).
//
// Read-only: no credential, no store, no writes. Needs the network.
//   SYMBOLS="NJR:356309,SRE:1032208|not within the scope|ASC 815|Other revenues"
//   relay task: sec-filing-text
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; filing text)";
const [SYM_ARG, ...WORDS] = String(process.env.SYMBOLS || "NJR:356309|not within the scope").split("|");
// SYM:CIK reads the latest 10-K; SYM:CIK:FORM:PERIOD (e.g. IDA:1057877:10-Q:2025-09-30)
// reads the filing of that form whose report date is that period.
const TARGETS = SYM_ARG.split(/[,\s]+/).filter(Boolean).map((s) => {
  const [sym, cik, form, period] = s.split(":");
  return { sym: sym.toUpperCase(), cik: String(cik ?? "").padStart(10, "0"), form: form || "10-K", period: period || null };
});
const WINDOW = Number(process.env.WINDOW || 700);
const MAX_HITS = Number(process.env.MAX_HITS || 6);
const get = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
};
const text = (html) => html
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#8212;|&mdash;/g, "—").replace(/&#[0-9]+;/g, " ")
  .replace(/\s+/g, " ");

for (const { sym, cik, form, period } of TARGETS) {
  try {
    const sub = await (await get(`https://data.sec.gov/submissions/CIK${cik}.json`)).json();
    const r = sub.filings.recent;
    const i = r.form.findIndex((f, k) => f === form && (!period || r.reportDate[k] === period));
    if (i < 0) { console.log(`${sym}: no ${form}${period ? ` for ${period}` : ""} in recent filings`); continue; }
    const acc = r.accessionNumber[i], doc = r.primaryDocument[i];
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${doc}`;
    const body = text(await (await get(url)).text());
    console.log(`\n══ ${sym} ${form} ${acc} filed ${r.filingDate[i]} (period ${r.reportDate[i]}) — ${url} — ${body.length} chars`);
    for (const w of WORDS) {
      const re = new RegExp(w.replace(/[.*+?^${}()[\]\\]/g, "\\$&"), "gi");
      const hits = [...body.matchAll(re)].slice(0, MAX_HITS);
      console.log(`\n── "${w}": ${[...body.matchAll(re)].length} hit(s)`);
      for (const h of hits) {
        const a = Math.max(0, h.index - WINDOW / 2), b = Math.min(body.length, h.index + WINDOW / 2);
        console.log(`  @${h.index}: …${body.slice(a, b).trim()}…`);
      }
    }
  } catch (e) { console.log(`${sym}: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 300));
}
