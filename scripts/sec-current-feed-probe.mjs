// CAN THE FILING JOB BE TRIGGERED INTRADAY? (#535 COWORK #10, read-only)
//
// The daily index is final only after EDGAR dissemination closes (22:00 ET,
// secDailyIndex.DISSEMINATION_CLOSE_MINUTES_ET), so a job driven by it alone
// sees a morning filing ~16 hours late. EDGAR's current-filings feed
// (browse-edgar action=getcurrent, Atom) lists filings as they are accepted.
// This reads it for the four periodic forms and reports: entries per page,
// the time span one page covers, whether each entry carries CIK + accession +
// acceptance time, and how many pages today's volume needs.
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; current feed probe)";
let lastAt = 0;
const get = async (url) => {
  const wait = Math.max(0, lastAt + 200 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  const text = res.ok ? await res.text() : "";
  return { status: res.status, ct: res.headers.get("content-type"), text, ms: Date.now() - t0 };
};
for (const form of ["10-Q", "10-K", "20-F", "40-F"]) {
  let start = 0, pages = 0, total = 0, oldest = null, newest = null, sample = null, withAccn = 0;
  while (pages < 5) {
    const r = await get(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${form}&company=&dateb=&owner=include&start=${start}&count=100&output=atom`);
    pages++;
    if (r.status !== 200) { console.log(`${form} page ${pages}: HTTP ${r.status} ${r.ct}`); break; }
    const entries = [...r.text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
    for (const e of entries) {
      const updated = e.match(/<updated>([^<]+)</)?.[1];
      const title = e.match(/<title>([^<]+)</)?.[1] ?? "";
      const accn = e.match(/accession-number=(\d{10}-\d{2}-\d{6})|(\d{10}-\d{2}-\d{6})/)?.[0];
      const cik = title.match(/\((\d{10})\)/)?.[1];
      const cat = e.match(/<category[^>]*term="([^"]+)"/)?.[1];
      if (accn && cik) withAccn++;
      if (cat && cat.replace(/\/A$/, "") !== form) continue;
      total++;
      if (updated) { newest = newest && newest > updated ? newest : updated; oldest = oldest && oldest < updated ? oldest : updated; }
      sample ??= { title, updated, accn, cik, cat };
    }
    console.log(`${form} page ${pages}: HTTP 200 ${r.ct} ${r.ms}ms entries ${entries.length}`);
    if (entries.length < 100) break;
    start += 100;
  }
  console.log(`${form}: pages ${pages}, entries ${total}, with cik+accession ${withAccn}, span ${oldest} .. ${newest}`);
  console.log(`  sample ${JSON.stringify(sample)}`);
}
