// EVERY FILING THE FEED IS MISSING IS READ, NOT ONLY THE NEWEST (audit r6).
//
// NEE: companyfacts stopped at Q1 2026, the job had filled Q2 from the Q2 10-Q,
// then rebuilt from companyfacts + the Q3 10-Q alone and Q2 went blank (a Q3
// 10-Q carries no Q2 three months). EIX: the feed has Q3 2026 and skipped Q2.
// Run through the SHIPPED checkAndFill with fake SEC fetchers:
//   1. filingsToRead, the pure rule: behind the feed, a skipped 10-Q, the cap,
//      10-Ks never hole-checked, the window;
//   2. the NEE shape: a stored set missing Q2 under a Q3 fill gets Q2 back;
//   3. the SO/DUK shape: a Q3 10-Q arriving over a Q2 fill keeps Q2;
//   4. a companyfacts hole (EIX): the skipped Q2 is read from its 10-Q, and a
//      later feed-only sec-facts read does not blank it (dropsFilledQuarter);
//   5. nothing to read: no companyfacts request at all;
//   6. mutations: newest filing only (the old rule), hole check removed.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  if (src.split(from).length !== 2) throw new Error(`mutation anchor not unique: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const silence = () => { const w = process.emitWarning; process.emitWarning = () => {}; return () => { process.emitWarning = w; }; };
const restore = silence();
const Fill = await import("../lib/server/secFilingFill.ts");
const Build = await import("../lib/server/secFactBuild.ts");
const Codec = await import("../lib/server/secFactCodec.ts");
const JOB_SRC = fs.readFileSync("lib/server/secFilingJob.ts", "utf8");
const FILL_SRC = fs.readFileSync("lib/server/secFilingFill.ts", "utf8");
// A mutated copy beside the original, so its relative imports resolve; removed at once.
const loadAt = async (name, src) => {
  const tmp = `lib/server/.check-${name}-${process.pid}-${Math.random().toString(36).slice(2)}.ts`;
  fs.writeFileSync(tmp, src);
  try { return await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
};
const Job = await import("../lib/server/secFilingJob.ts");
restore();

const M = 1e6;
const CIK = "1";
const ref = (form, accn, filed, reportDate) => ({ form, accn, filed, reportDate });
const K25 = ref("10-K", "0000000001-26-000010", "2026-02-13", "2025-12-31");
const Q1 = ref("10-Q", "0000000001-26-000031", "2026-04-23", "2026-03-31");
const Q2 = ref("10-Q", "0000000001-26-000060", "2026-07-23", "2026-06-30");
const Q3 = ref("10-Q", "0000000001-26-000081", "2026-10-21", "2026-09-30");
const subsOf = (...fs_) => ({ filings: { recent: {
  accessionNumber: fs_.map((f) => f.accn), form: fs_.map((f) => f.form),
  filingDate: fs_.map((f) => f.filed), reportDate: fs_.map((f) => f.reportDate),
} } });

// companyfacts rows: revenue and net income, as the feed publishes them.
const row = (start, end, val, f, fp, fy = 2026) => ({ start, end, val, accn: f.accn, form: f.form, filed: f.filed, fy, fp });
const Y25 = ["2025-01-01", "2025-12-31"];
const feed = (spans) => ({ cik: 1, entityName: "Test Utility", facts: { "us-gaap": {
  Revenues: { units: { USD: spans.map(([s, e, f, fp, fy, rev]) => row(s, e, rev * M, f, fp, fy)) } },
  NetIncomeLoss: { units: { USD: spans.map(([s, e, f, fp, fy, , ni]) => row(s, e, ni * M, f, fp, fy)) } },
} } });
const Q25 = ref("10-Q", "0000000001-25-000056", "2025-10-28", "2025-09-30");
const PRIOR_YEAR = [
  ["2025-01-01", "2025-03-31", Q25, "Q1", 2025, 5000, 800],
  ["2025-04-01", "2025-06-30", Q25, "Q2", 2025, 6000, 2000],
  ["2025-01-01", "2025-06-30", Q25, "Q2", 2025, 11000, 2800],
  ["2025-07-01", "2025-09-30", Q25, "Q3", 2025, 7000, 2400],
  ["2025-01-01", "2025-09-30", Q25, "Q3", 2025, 18000, 5200],
  [...Y25, K25, "FY", 2025, 24000, 6800],
];
const FEED_TO_Q1 = feed([...PRIOR_YEAR, ["2026-01-01", "2026-03-31", Q1, "Q1", 2026, 6500, 2182]]);
// EIX's shape: the feed carries Q1 and Q3 (three and nine months) and no Q2.
const FEED_HOLE = feed([...PRIOR_YEAR,
  ["2026-01-01", "2026-03-31", Q1, "Q1", 2026, 6500, 2182],
  ["2026-07-01", "2026-09-30", Q3, "Q3", 2026, 8000, 4775],
  ["2026-01-01", "2026-09-30", Q3, "Q3", 2026, 21500, 10101],
]);

// Each 10-Q's own XBRL instance: its three months and its year to date.
const instance = (f, fp, spans) => `<xbrl xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:dei="http://xbrl.sec.gov/dei/2025" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217">
<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
${spans.map(([s, e], i) => `<xbrli:context id="c${i}"><xbrli:entity><xbrli:identifier>1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${s}</xbrli:startDate><xbrli:endDate>${e}</xbrli:endDate></xbrli:period></xbrli:context>`).join("\n")}
<dei:DocumentFiscalYearFocus contextRef="c0">2026</dei:DocumentFiscalYearFocus>
<dei:DocumentFiscalPeriodFocus contextRef="c0">${fp}</dei:DocumentFiscalPeriodFocus>
${spans.map(([, , rev, ni], i) => `<us-gaap:Revenues contextRef="c${i}" unitRef="usd" decimals="-6">${rev * M}</us-gaap:Revenues>
<us-gaap:NetIncomeLoss contextRef="c${i}" unitRef="usd" decimals="-6">${ni * M}</us-gaap:NetIncomeLoss>`).join("\n")}
</xbrl>`;
const XML = {
  [Q2.accn]: instance(Q2, "Q2", [["2026-04-01", "2026-06-30", 7000, 3144], ["2026-01-01", "2026-06-30", 13500, 5326]]),
  [Q3.accn]: instance(Q3, "Q3", [["2026-07-01", "2026-09-30", 8000, 4775], ["2026-01-01", "2026-09-30", 21500, 10101]]),
};

const fetchersFor = (cf, subs, calls = { cf: 0, inst: [] }) => ({
  calls,
  submissions: async () => subs,
  companyFacts: async () => { calls.cf++; return structuredClone(cf); },
  instance: async (_cik, f) => { calls.inst.push(f.reportDate); return XML[f.accn] ?? null; },
  // An empty filing index: the class-cover and EPS readers find nothing and step aside.
  get: async () => new Response(JSON.stringify({ filings: { recent: { accessionNumber: [], form: [], filingDate: [], reportDate: [], primaryDocument: [] } }, directory: { item: [] } }), { status: 200, headers: { "content-type": "application/json" } }),
});
const NO_FX = new Map();
const ni = (set, end) => Codec.valueOf(set.quarters.find((q) => q.e === end), "netIncome");
// A stored set built the way the job builds one, from a given payload.
const storedFrom = async (cf, extra = {}) => ({ ...(await Build.toStoredSet((await import("../lib/server/secExtractFor.ts")).extractForSymbol("TEST", cf), undefined, NO_FX)), ...extra });
const mergedFeed = (cf, ...accns) => accns.reduce((acc, a) => Fill.mergeFillOnly(acc, Fill.instanceToFacts(XML[a], [Q2, Q3].find((f) => f.accn === a)).facts, "USD").merged, cf);

console.log("1. filingsToRead, the pure rule");
{
  const q = (end, filled = true) => ({ end, filled });
  const all = [K25, Q1, Q2, Q3];
  const names = (xs) => xs.map((f) => f.reportDate).join(",");
  check("feed behind by two filings: both are read, oldest first (NEE's companyfacts at Q1)",
    names(Fill.filingsToRead(all, [q("2026-03-31"), q("2025-09-30")], "2026-03-31")) === "2026-06-30,2026-09-30");
  check("plain lag: the one newer filing", names(Fill.filingsToRead(all, [q("2026-06-30"), q("2026-03-31")], "2026-06-30")) === "2026-09-30");
  check("a stored set missing Q2 under Q3 (the NEE damage): the Q2 10-Q",
    names(Fill.filingsToRead(all, [q("2026-09-30"), q("2026-06-30", false), q("2026-03-31")], "2026-09-30")) === "2026-06-30");
  check("current and complete: nothing", Fill.filingsToRead(all, [q("2026-09-30"), q("2026-06-30"), q("2026-03-31")], "2026-09-30").length === 0);
  check("a 10-K is never hole-checked (its Q4 is derived, not filed)",
    Fill.filingsToRead(all, [q("2026-09-30"), q("2026-06-30"), q("2026-03-31")], "2026-09-30").every((f) => f.form !== "10-K"));
  const old = ref("10-Q", "x", "2024-11-01", "2024-09-30");
  check("a 10-Q older than the window is not looked for", Fill.filingsToRead([old, Q3], [q("2026-09-30")], "2026-09-30").length === 0);
  const many = [1, 2, 3, 4, 5, 6].map((i) => ref("10-Q", `a${i}`, `2026-0${i}-01`, `2026-0${i}-01`));
  check(`capped at ${Fill.FILING_READS_PER_FILER}, keeping the newest`, names(Fill.filingsToRead(many, [], "2025-12-31")) === "2026-03-01,2026-04-01,2026-05-01,2026-06-01");
  check("periodicFilings: one per period, the latest filed, oldest period first",
    names(Fill.periodicFilings(subsOf(Q3, Q1, ref("10-Q", "dup", "2026-05-01", "2026-03-31"), K25))) === "2025-12-31,2026-03-31,2026-09-30"
      && Fill.periodicFilings(subsOf(Q1, ref("10-Q", "dup", "2026-05-01", "2026-03-31"))).find((f) => f.reportDate === "2026-03-31").accn === "dup");
}

console.log("\n2. the NEE shape: Q2 blank under a Q3 fill comes back");
let neeOut;
{
  const damaged = await storedFrom(mergedFeed(FEED_TO_Q1, Q3.accn), { ff: Q3 });
  check("the fixture reproduces the damage (Q2 blank, Q1 and Q3 present)",
    ni(damaged, "2026-06-30") === null && ni(damaged, "2026-03-31") === 2182 * M && ni(damaged, "2026-09-30") === 4775 * M,
    `${ni(damaged, "2026-03-31")} / ${ni(damaged, "2026-06-30")} / ${ni(damaged, "2026-09-30")}`);
  const f = fetchersFor(FEED_TO_Q1, subsOf(K25, Q1, Q2, Q3));
  neeOut = await Job.checkAndFill("TEST", CIK, damaged, { c: 0, lag: { accn: Q3.accn, reportDate: Q3.reportDate, kind: "filled" } }, f, NO_FX);
  check("the job refills it", neeOut.kind === "filled", neeOut.kind);
  check("Q2 net income is the Q2 10-Q's 3,144M", ni(neeOut.set, "2026-06-30") === 3144 * M, String(ni(neeOut.set, "2026-06-30")));
  check("Q1 (feed) and Q3 (Q3 10-Q) are unchanged", ni(neeOut.set, "2026-03-31") === 2182 * M && ni(neeOut.set, "2026-09-30") === 4775 * M);
  check("both 10-Qs were read, Q2 then Q3", f.calls.inst.join(",") === "2026-09-30,2026-06-30" || f.calls.inst.join(",") === "2026-06-30,2026-09-30", f.calls.inst.join(","));
  check("the set is stamped with the Q3 10-Q (the feed is still behind it)", neeOut.set.ff?.accn === Q3.accn && neeOut.lag?.kind === "filled");
}

console.log("\n3. the SO/DUK shape: a Q3 10-Q over a Q2 fill keeps Q2");
{
  const q2Filled = await storedFrom(mergedFeed(FEED_TO_Q1, Q2.accn), { ff: Q2 });
  check("the fixture holds Q2 from its 10-Q", ni(q2Filled, "2026-06-30") === 3144 * M);
  const out = await Job.checkAndFill("TEST", CIK, q2Filled, { c: 0, lag: { accn: Q2.accn, reportDate: Q2.reportDate, kind: "filled" } }, fetchersFor(FEED_TO_Q1, subsOf(K25, Q1, Q2, Q3)), NO_FX);
  check("Q3 is added", ni(out.set, "2026-09-30") === 4775 * M);
  check("Q2 stays 3,144M", ni(out.set, "2026-06-30") === 3144 * M, String(ni(out.set, "2026-06-30")));
}

console.log("\n4. a companyfacts hole (EIX): the skipped quarter is read, and kept");
{
  const holed = await storedFrom(FEED_HOLE);
  check("the fixture has Q1 and Q3 from the feed and no Q2", ni(holed, "2026-06-30") == null && ni(holed, "2026-09-30") === 4775 * M);
  const f = fetchersFor(FEED_HOLE, subsOf(K25, Q1, Q2, Q3));
  const out = await Job.checkAndFill("TEST", CIK, holed, undefined, f, NO_FX);
  check("filled from the Q2 10-Q alone", out.kind === "filled" && f.calls.inst.join(",") === "2026-06-30", `${out.kind} ${f.calls.inst.join(",")}`);
  check("Q2 net income 3,144M; Q3 untouched", ni(out.set, "2026-06-30") === 3144 * M && ni(out.set, "2026-09-30") === 4775 * M);
  check("stamped with the 10-Q that supplied it", out.set.ff?.accn === Q2.accn && out.lag?.reportDate === "2026-06-30");
  const feedOnly = await storedFrom(FEED_HOLE);
  check("sec-facts keeps it: a feed-only read drops a filled quarter",
    Fill.dropsFilledQuarter(Codec.storedQuarterEnds(out.set), Codec.storedQuarterEnds(feedOnly), Fill.newestStoredEnd(out.set)));
  check("...and lets go once the feed carries Q2",
    !Fill.dropsFilledQuarter(Codec.storedQuarterEnds(out.set), Codec.storedQuarterEnds(out.set), Fill.newestStoredEnd(out.set)));
  const FACTS = fs.readFileSync("app/api/jobs/sec-facts/route.ts", "utf8");
  check("wiring: keepFilled covers a dropped filled quarter as well as a feed behind the filing",
    /const keepFilled = Boolean\(prior\?\.ff && \(freshNewest < prior\.ff\.reportDate\s*\|\| dropsFilledQuarter\(storedQuarterEnds\(prior\), storedQuarterEnds\(fresh\), newestStoredEnd\(prior\)\)\)\);/.test(FACTS));
}

console.log("\n5. nothing to read: no companyfacts request");
{
  const f = fetchersFor(FEED_TO_Q1, subsOf(K25, Q1, Q2, Q3));
  const out = await Job.checkAndFill("TEST", CIK, neeOut.set, { c: 0, lag: neeOut.lag }, f, NO_FX);
  check("a complete set is current, from the stored set and the submissions alone", out.kind === "current" && f.calls.cf === 0 && f.calls.inst.length === 0, `${out.kind} cf=${f.calls.cf}`);
  check("...and keeps its recorded lag, as before", out.lag?.accn === Q3.accn);
}

console.log("\n6. mutations");
{
  const restore2 = silence();
  const OneOnly = await loadAt("filing-job", once(JOB_SRC, "for (const m of [...toRead].reverse()) {", "for (const m of [toRead.at(-1)!]) {"));
  restore2();
  const damaged = await storedFrom(mergedFeed(FEED_TO_Q1, Q3.accn), { ff: Q3 });
  const out = await OneOnly.checkAndFill("TEST", CIK, damaged, undefined, fetchersFor(FEED_TO_Q1, subsOf(K25, Q1, Q2, Q3)), NO_FX);
  check("MUTATION: newest filing only (the old rule) → Q2 blank again, caught", ni(out.set, "2026-06-30") == null);
  const NoHole = await loadAt("filing-fill", once(FILL_SRC, `    if (f.form !== "10-Q") return false;`, `    return false;`));
  check("MUTATION: hole check removed → the NEE damage is not seen, caught",
    NoHole.filingsToRead([K25, Q1, Q2, Q3], Codec.storedQuarterEnds(damaged), Fill.newestStoredEnd(damaged)).length === 0
      && Fill.filingsToRead([K25, Q1, Q2, Q3], Codec.storedQuarterEnds(damaged), Fill.newestStoredEnd(damaged)).length === 1);
}

if (failures) {
  console.log(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nEvery missing filing is read; a filled quarter is not lost.");
