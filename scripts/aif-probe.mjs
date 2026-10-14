// CAN THE 40-F FILERS' BUSINESS DESCRIPTION BE READ? (#552 COWORK #228 (1)).
// Scope probe before any build. For each 40-F registrant (or SYMBOLS): the
// latest 40-F, its exhibit index, the exhibit that is the Annual Information
// Form, and in it the "Description of the Business" section (TOC entries
// skipped: the first occurrence followed by a real section). Prints one line
// per symbol, plus a short excerpt for SAMPLE symbols. SEC text only,
// read-only, no credential, ≤8 requests/s. Uses the repo's configured SEC
// User-Agent (the description build's own).
//   relay task: aif-probe   [SYMBOLS="GIB,BN"] [SAMPLE="GIB,BN,CNI,TD,WPM"]
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT
  || fs.readFileSync("scripts/sec-descriptions-build.mjs", "utf8").match(/"(MyStockHarbor\/1\.0 \([^"]+)"/)[1];
const D = await import("../lib/server/secDescription.ts");
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const sample = new Set((process.env.SAMPLE || "").split(/[,\s]+/).filter(Boolean));
const syms = only.length ? only : Object.keys(REG).filter((s) => REG[s].annualForm === "40-F").sort();

let lastAt = 0;
async function get(url, as = "text") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(String(res.status));
  return as === "json" ? res.json() : res.text();
}

const AIF = /annual\s+information\s+form/i;
// Section starts, in order of preference; ends are the AIF's next major headings.
const START = /^(?:(?:item|section|part)?\s*[\dA-Z.]*\s*)?(?:description\s+of\s+(?:the\s+|our\s+)?business|business\s+of\s+the\s+(?:company|corporation|bank|trust)|our\s+business|the\s+business|narrative\s+description\s+of\s+the\s+business)\b/i;
const END = /^(?:(?:item|section|part)?\s*[\dA-Z.]*\s*)?(?:risk\s+factors|dividends|description\s+of\s+(?:the\s+)?capital\s+structure|market\s+for\s+(?:the\s+)?securities|directors\s+and\s+(?:executive\s+)?officers|mineral\s+propert|legal\s+proceedings|transfer\s+agent|interests\s+of\s+experts|material\s+contracts|capital\s+structure|dividends\s+and\s+distributions)\b/i;

function locate(text) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const offs = []; let pos = 0;
  for (const l of lines) { const i = text.indexOf(l, pos); offs.push(i); pos = i + l.length; }
  const isHead = (l) => l.length <= 90;
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!isHead(lines[i]) || !START.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !(isHead(lines[j]) && END.test(lines[j]))) j++;
    const body = text.slice(offs[i] + lines[i].length, j < lines.length ? offs[j] : undefined).trim();
    if (body.length >= 1500) { best = { heading: lines[i], chars: body.length, body }; break; }
  }
  return best;
}

const tally = { OK: 0, NO_40F: 0, NO_AIF: 0, NO_SECTION: 0, ERROR: 0 };
for (const s of syms) {
  try {
    const cik = String(REG[s]?.cik ?? "");
    if (!cik) { console.log(`${s.padEnd(6)} ERROR no cik`); tally.ERROR++; continue; }
    const sub = await get(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, "json");
    const r = sub.filings?.recent ?? {};
    const i = (r.form ?? []).findIndex((f) => f === "40-F");
    if (i < 0) { console.log(`${s.padEnd(6)} NO_40F latest annual: ${(r.form ?? []).find((f) => /^(10-K|20-F|40-F)/.test(f)) ?? "none"}`); tally.NO_40F++; continue; }
    const acc = r.accessionNumber[i], folder = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}`;
    const idx = await get(`${folder}/${acc}-index.htm`);
    // Rows: Seq | Description | Document | Type | Size.
    const rows = [...idx.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()))
      .filter((c) => c.length >= 4 && /\.(htm|html|txt)$/i.test(c[2]));
    const ex = rows.filter((c) => /^EX-99/i.test(c[3]));
    const named = ex.find((c) => AIF.test(c[1]) || /aif/i.test(c[2]));
    const order = named ? [named, ...ex.filter((c) => c !== named)] : ex;
    let hit = null, how = "";
    for (const c of order.slice(0, 5)) {
      const text = D.filingText(await get(`${folder}/${c[2]}`));
      if (!AIF.test(text.slice(0, 6000))) continue;
      hit = { doc: c[2], type: c[3], text }; how = named === c ? "named" : "text"; break;
    }
    const ref = `40-F ${acc} ${r.filingDate[i]}`;
    if (!hit) { console.log(`${s.padEnd(6)} NO_AIF ${ref} | EX-99 docs: ${ex.map((c) => `${c[3]}:${c[1].slice(0, 40)}`).join("; ") || "none"}`); tally.NO_AIF++; continue; }
    const sec = locate(hit.text);
    if (!sec) { console.log(`${s.padEnd(6)} NO_SECTION ${ref} AIF=${hit.type} (${how}) ${hit.text.length} chars`); tally.NO_SECTION++; continue; }
    tally.OK++;
    console.log(`${s.padEnd(6)} OK ${ref} AIF=${hit.type} (${how}) heading="${sec.heading.slice(0, 60)}" ${sec.chars} chars`);
    if (sample.has(s)) console.log(`  EXCERPT ${JSON.stringify(sec.body.replace(/\s+/g, " ").slice(0, 600))}`);
  } catch (e) { tally.ERROR++; console.log(`${s.padEnd(6)} ERROR ${String(e?.message ?? e).slice(0, 60)}`); }
}
console.log(`\n${syms.length} symbols | ${JSON.stringify(tally)}`);
