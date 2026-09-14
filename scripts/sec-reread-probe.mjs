// What does it cost to find out whether a filer's numbers have actually changed?
//
// THE QUESTION, AND WHY IT IS THE EXPENSIVE ONE. Measured over 2026-09-08..11:
// of 55 periodic filers, 49 filed a 6-K. HSBC, GSK, SNN and BIDU each filed one
// on all four days. 6-K is the foreign-private-issuer catch-all -- press
// releases, director dealings, AGM notices, buyback announcements -- so treating
// every 6-K as "the numbers moved" means re-downloading companyfacts (AAPL
// 271.8 KB, PLAB 224.7 KB wire) for filings that overwhelmingly carry no
// financial data at all.
//
// AND NARROWING THE FORM SET IS NOT THE FIX. ARM is an FPI and reports its
// quarter THROUGH a 6-K. Dropping 6-K would silently lose the quarterly numbers
// for the page this project was audited against, while appearing to work.
//
// So the re-read has to become conditional, and this measures which mechanism
// SEC actually honours. THREE CANDIDATES, none assumed:
//
//   A  companyfacts conditional request (Last-Modified / ETag)
//   B  submissions conditional request -- 25 KB against companyfacts' 272 KB,
//      so even an unconditional re-read of it is ~10x cheaper
//   C  submissions' per-accession isXBRL / isInlineXBRL flags -- if a 6-K that
//      carries a quarter is XBRL-tagged and a press-release 6-K is not, that is
//      the discriminator, and it costs one 25 KB fetch rather than 272 KB
//
// §3.7 of the build brief already measured that companyfacts offers NEITHER
// Last-Modified NOR ETag. That is re-tested here rather than trusted, because
// it is the assumption the whole design rests on and it is one header away from
// changing.
//
// EVERY CONDITIONAL TEST CARRIES A NEGATIVE CONTROL. A server that answers 304
// to any validator produces exactly the result that looks like the best possible
// news while meaning a corrections failsafe would never fire.
//
// Runs on a runner: the agent sandbox is refused data.sec.gov with 403 CONNECT.
//   dispatch relay.yml, task `sec-reread`, SYMBOLS="ARM:0001973239,AAPL:0000320193"
import fs from "node:fs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; re-read probe)";
const INPUT = (process.env.SYMBOLS || process.argv[2] || "ARM:0001973239,AAPL:0000320193,HSBC:0001089113").trim();
const pad = (v) => String(v).replace(/\D/g, "").padStart(10, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = INPUT.split(",").map((e) => {
  const [sym, cik] = e.split(":");
  return { symbol: sym.trim().toUpperCase(), cik: cik ? pad(cik) : null };
}).filter((t) => t.cik);

if (!targets.length) {
  console.error('FATAL: need TICKER:CIK pairs, e.g. SYMBOLS="ARM:0001973239"');
  process.exit(2);
}

async function get(url, extra = {}) {
  const started = Date.now();
  const res = await fetch(url, { headers: { "user-agent": UA, "accept-encoding": "gzip, deflate", accept: "application/json", ...extra } });
  const body = res.status === 304 ? "" : await res.text();
  return {
    status: res.status,
    ms: Date.now() - started,
    bytes: body.length,
    wire: res.headers.get("content-length"),
    lastModified: res.headers.get("last-modified"),
    etag: res.headers.get("etag"),
    body,
  };
}

const out = { checkedAt: new Date().toISOString(), endpoints: {}, sixKDiscrimination: [] };

for (const t of targets) {
  console.log(`\n${"=".repeat(70)}\n${t.symbol}  CIK ${t.cik}`);

  for (const [label, url] of [
    ["companyfacts", `https://data.sec.gov/api/xbrl/companyfacts/CIK${t.cik}.json`],
    ["submissions", `https://data.sec.gov/submissions/CIK${t.cik}.json`],
  ]) {
    try {
      const base = await get(url);
      console.log(`\n  ${label}: HTTP ${base.status}  ${base.ms}ms  wire ${base.wire ?? "?"}  decoded ${base.bytes.toLocaleString()}`);
      console.log(`    Last-Modified: ${base.lastModified ?? "ABSENT"}`);
      console.log(`    ETag:          ${base.etag ?? "ABSENT"}`);
      if (base.status !== 200) { await sleep(150); continue; }

      const steps = [];
      const run = async (name, header, mustBe) => {
        await sleep(150);
        const r = await get(url, header);
        const verdict = mustBe && r.status !== mustBe ? `  <-- EXPECTED ${mustBe}` : "";
        console.log(`    ${name.padEnd(38)} ${r.status}  body ${r.bytes.toLocaleString().padStart(9)}${verdict}`);
        steps.push({ name, status: r.status, bytes: r.bytes });
        return r;
      };

      let imsWorks = false;
      let inmWorks = false;
      if (base.lastModified) {
        const real = await run("If-Modified-Since = Last-Modified", { "if-modified-since": base.lastModified });
        const ctl = await run("CONTROL If-Modified-Since = 1990", { "if-modified-since": "Mon, 01 Jan 1990 00:00:00 GMT" }, 200);
        imsWorks = real.status === 304 && ctl.status === 200;
      }
      if (base.etag) {
        const real = await run("If-None-Match = ETag", { "if-none-match": base.etag });
        const ctl = await run("CONTROL If-None-Match = bogus", { "if-none-match": '"not-the-etag"' }, 200);
        inmWorks = real.status === 304 && ctl.status === 200;
      }

      const verdict = !base.lastModified && !base.etag
        ? "NO VALIDATOR OFFERED — conditional requests are impossible here"
        : imsWorks || inmWorks
          ? `CONDITIONAL SUPPORTED via ${[imsWorks && "If-Modified-Since", inmWorks && "If-None-Match"].filter(Boolean).join(" and ")}`
          : "validator offered but NOT honoured — a conditional request still returns the full body";
      console.log(`    => ${verdict}`);
      out.endpoints[`${t.symbol}:${label}`] = {
        status: base.status, decodedBytes: base.bytes, wire: base.wire,
        lastModified: base.lastModified, etag: base.etag, imsWorks, inmWorks, verdict, steps,
      };

      // ── C. Does submissions discriminate a 6-K that carries a quarter? ──
      if (label === "submissions") {
        const j = JSON.parse(base.body);
        const r = j?.filings?.recent ?? {};
        const n = (r.accessionNumber ?? []).length;
        const rows = [];
        for (let i = 0; i < n; i++) {
          const form = String(r.form?.[i] ?? "");
          if (!/^(6-K|10-Q|10-K|20-F)/.test(form)) continue;
          rows.push({
            form,
            filed: String(r.filingDate?.[i] ?? ""),
            report: String(r.reportDate?.[i] ?? ""),
            isXBRL: r.isXBRL?.[i] ?? null,
            isInlineXBRL: r.isInlineXBRL?.[i] ?? null,
            primaryDocDescription: String(r.primaryDocDescription?.[i] ?? ""),
            items: String(r.items?.[i] ?? ""),
          });
          if (rows.length >= 25) break;
        }
        console.log(`\n    periodic-ish filings in submissions.recent: ${rows.length} (newest first)`);
        console.log(`    ${"form".padEnd(8)} ${"filed".padEnd(11)} ${"report".padEnd(11)} xbrl inline  primaryDocDescription`);
        for (const row of rows) {
          console.log(`    ${row.form.padEnd(8)} ${row.filed.padEnd(11)} ${(row.report || "—").padEnd(11)} ${String(row.isXBRL).padEnd(4)} ${String(row.isInlineXBRL).padEnd(6)} ${row.primaryDocDescription.slice(0, 40)}`);
        }
        const sixK = rows.filter((x) => x.form.startsWith("6-K"));
        const tagged = sixK.filter((x) => x.isXBRL === 1 || x.isInlineXBRL === 1);
        if (sixK.length) {
          console.log(`\n    6-K: ${sixK.length} seen, ${tagged.length} XBRL-tagged`);
          console.log(
            tagged.length === 0
              ? `    => NO 6-K is tagged. The flag cannot discriminate for this filer — a quarter reported via 6-K would look identical to a press release.`
              : tagged.length === sixK.length
                ? `    => EVERY 6-K is tagged. The flag cannot discriminate either — it would trigger a full re-read every time.`
                : `    => THE FLAG DISCRIMINATES: ${tagged.length} of ${sixK.length} tagged. A 25 KB submissions fetch can gate the 272 KB companyfacts fetch.`
          );
        }
        out.sixKDiscrimination.push({ symbol: t.symbol, sixKSeen: sixK.length, sixKTagged: tagged.length, rows });
      }
    } catch (err) {
      console.log(`  ${label}: ERROR ${err?.message ?? err}`);
    }
    await sleep(200);
  }
}

console.log(`\n${"=".repeat(70)}\nWHAT THIS DECIDES`);
console.log(`  conditional works on companyfacts -> cheapest: ask, re-read only on 200`);
console.log(`  conditional works on submissions only -> gate the 272 KB read behind a 25 KB one`);
console.log(`  neither, but isXBRL discriminates -> same gate, using the flag instead of a validator`);
console.log(`  neither and the flag does not discriminate -> a 6-K must cost a full re-read, and`);
console.log(`    the only remaining lever is the drain rate. Say so rather than inventing a heuristic.`);
fs.writeFileSync("sec-reread-probe.json", JSON.stringify(out, null, 2));
console.log(`\nwrote sec-reread-probe.json`);
