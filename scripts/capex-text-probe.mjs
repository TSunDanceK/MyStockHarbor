// READ-ONLY (Relay C, #563 COWORK #5/#7): what a receivers line's own annual
// report calls it, so a sub-label is the filer's verbatim wording, never ours.
// Reads one filing's primary document from SEC and prints every sentence that
// mentions TERM, plus how often candidate phrases occur. No Redis, no store.
//   env CIK, ACCESSION (optional: newest 20-F/10-K/40-F), TERM, PHRASES (a|b|c)
//   relay task: capex-text-probe
const UA = process.env.SEC_USER_AGENT ?? "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; capex text probe)";
const env = Object.fromEntries((process.env.SYMBOLS || "").split(";").map((kv) => kv.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const CIK = Number(env.CIK ?? process.env.CIK);
const TERM = env.TERM ?? process.env.TERM ?? "";
const PHRASES = (env.PHRASES ?? process.env.PHRASES ?? "").split("|").filter(Boolean);
if (!CIK || !TERM) throw new Error("need CIK and TERM (SYMBOLS=\"CIK=937966;TERM=NXE;PHRASES=a|b\")");

async function get(url) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (r?.ok) return r;
    await new Promise((res) => setTimeout(res, 1000 * 2 ** a));
  }
  throw new Error(`fetch failed: ${url}`);
}

const sub = await (await get(`https://data.sec.gov/submissions/CIK${String(CIK).padStart(10, "0")}.json`)).json();
const f = sub.filings.recent;
let i = -1;
for (let k = 0; k < f.form.length; k++) {
  const want = env.ACCESSION ? f.accessionNumber[k] === env.ACCESSION : ["20-F", "10-K", "40-F"].includes(f.form[k]);
  if (want) { i = k; break; }
}
if (i < 0) throw new Error("no annual filing found");
const acc = f.accessionNumber[i];
const url = `https://www.sec.gov/Archives/edgar/data/${CIK}/${acc.replace(/-/g, "")}/${f.primaryDocument[i]}`;
const html = await (await get(url)).text();
const text = html
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#8217;|&rsquo;/g, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
  .replace(/&[a-z#0-9]+;/gi, " ")
  .replace(/\s+/g, " ");
console.log(`${sub.name} ${f.form[i]} ${acc} filed ${f.filingDate[i]} — ${(text.length / 1e6).toFixed(2)}M chars of text`);

const sentences = text.split(/(?<=[.;:])\s+(?=[A-Z(])/);
const hits = sentences.filter((s) => new RegExp(`\\b${TERM}\\b`).test(s));
console.log(`\n${hits.length} sentences mention ${TERM}; first 40 (each up to 400 chars):`);
for (const s of hits.slice(0, 40)) console.log(`  · ${s.slice(0, 400)}`);

const fold = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const folded = fold(text);
console.log(`\nverbatim phrase counts (case- and punctuation-folded, as subLabelVerified matches):`);
for (const p of PHRASES) console.log(`  "${p}": ${folded.split(fold(p)).length - 1}`);
console.log("\nRedis commands: 0 (no store touched).");
