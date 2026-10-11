// /upcoming-ipos PROFILES (#553 COWORK #159 PR 1), on fixtures. Never SEC,
// never Redis: the job step runs against a stub fetch and a fake store.
//
// What must hold:
//   1. The profile is read from the submissions JSON: industry, HQ,
//      incorporation, fiscal year end, the emerging-growth flag, and only the
//      registration-story forms (S-1/F-1 and amendments, 424B1/4, 8-A12B).
//   2. SPAC = SIC 6770 or a "blank check" name; FOREIGN = an F-1 filer.
//   3. The fee exhibit's maximum is the inline-XBRL ffd:TtlOfferingAmt, scaled;
//      no tag, no figure (a guess from the text is never taken); the exhibit is
//      found by its file name in the filing index, or not at all.
//   4. The timeline: filed -> amended -> terms -> priced -> listed, done only
//      when the filing is on file; a listed IPO completes it.
//   5. The cache refreshes ONLY when the record has a newer filing: an
//      up-to-date filer costs no SEC request and no SET; a new one costs at
//      most 3 requests; a throttle stops the step; filers off the page drop.
//   6. Rendered: every row is a <details> whose body is in the server HTML
//      (closed); badges and the SPAC note; a missing fee exhibit omits the
//      block's line; a missing ticker reads "—".
//   7. Source: the page reads the stored profiles (one GET) and never fetches
//      SEC; the list makes no request.
//   8. "What it does" (PR 2): two or three sentences lifted word for word from
//      the prospectus summary (after "Overview"), tables, footnote markers,
//      the preamble, placeholders and boilerplate left out, cut on sentence
//      boundaries ("U.S." and "Inc." are not boundaries) to about 60 words;
//      when the extract fails or reads badly the block is omitted. The job
//      reads the prospectus as its 4th request; a profile from before PR 2 is
//      rebuilt once; a failed fetch leaves `about` absent (retried), a failed
//      extract records null (not re-read until a newer filing).
// Every rule has a planted mutant.
//
//   node scripts/check-ipo-profiles.mjs
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/source-code.mjs";
register("./lib/tsx-render-hooks.mjs", import.meta.url);

const ROOT = process.cwd();
const VIEW = "lib/ipoProfileView.ts";
const SERVER = "lib/server/ipoProfiles.ts";
const LIST = "app/upcoming-ipos/IpoProfileList.tsx";
const PAGE = "app/upcoming-ipos/page.tsx";
const ROUTE = "app/api/jobs/ipo-refresh/route.ts";
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const tmp = [];
let seq = 0;
async function load(rel, src, swaps = {}) {
  let out = src;
  for (const [from, to] of Object.entries(swaps)) out = out.split(from).join(to);
  const f = path.join(path.dirname(path.join(ROOT, rel)), `.check-ipp-${process.pid}-${seq++}${path.extname(rel)}`);
  fs.writeFileSync(f, out);
  tmp.push(f);
  return import(pathToFileURL(f).href);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const recent = (rows) => ({ form: rows.map((r) => r[0]), filingDate: rows.map((r) => r[1]), accessionNumber: rows.map((r, i) => r[2] ?? `0001234567-26-00000${i}`), primaryDocument: rows.map((r) => r[3] ?? "doc.htm") });
const OPERATING = {
  name: "Acme Robotics Inc", sic: "3569", sicDescription: "GENERAL INDUSTRIAL MACHINERY & EQUIPMENT, NEC",
  category: "Non-accelerated filer<br>Emerging growth company", fiscalYearEnd: "1231",
  stateOfIncorporation: "DE", stateOfIncorporationDescription: "DE",
  addresses: { business: { city: "AUSTIN", stateOrCountry: "TX", stateOrCountryDescription: "TX" } },
  filings: { recent: recent([["8-K", "2026-09-30"], ["S-1/A", "2026-09-20", "0001234567-26-000020", "s1a2.htm"], ["S-1/A", "2026-09-05"], ["S-1", "2026-08-01", null, "s1.htm"], ["10-Q", "2026-07-01"]]) },
};
const LISTED_CO = {
  name: "Beta Health Corp", sic: "8000", sicDescription: "SERVICES-HEALTH SERVICES", category: "Non-accelerated filer", fiscalYearEnd: "0630",
  addresses: { business: { city: "BOSTON", stateOrCountry: "MA", stateOrCountryDescription: "MA" } },
  filings: { recent: recent([["8-A12B", "2026-09-28"], ["424B4", "2026-09-27"], ["S-1/A", "2026-09-15"], ["S-1", "2026-08-10"]]) },
};
const SPAC = {
  name: "Gamma Acquisition Corp", sic: "6770", sicDescription: "BLANK CHECKS", category: "Emerging growth company", fiscalYearEnd: "1231",
  addresses: { business: { city: "NEW YORK", stateOrCountry: "NY", stateOrCountryDescription: "NY" } },
  filings: { recent: recent([["S-1/A", "2026-09-22"], ["S-1", "2026-09-01"]]) },
};
const FOREIGN = {
  name: "Delta Holdings Ltd", sic: "7372", sicDescription: "SERVICES-PREPACKAGED SOFTWARE", category: "", fiscalYearEnd: "1231",
  stateOfIncorporation: "E9", stateOfIncorporationDescription: "CAYMAN ISLANDS",
  addresses: { business: { city: "SINGAPORE", stateOrCountry: "U0", stateOrCountryDescription: "SINGAPORE" } },
  filings: { recent: recent([["F-1/A", "2026-09-25"], ["F-1", "2026-09-02"]]) },
};
const FEE_HTML = `<html><body><table><tr><td>Total Offering Amounts</td><td>$<ix:nonFraction name="ffd:TtlOfferingAmt" contextRef="c1" unitRef="USD" decimals="0" scale="0" format="ixt:num-dot-decimal">172,500,000</ix:nonFraction></td></tr>
<tr><td>Fee</td><td><ix:nonFraction name="ffd:TtlFeeAmt" contextRef="c1" unitRef="USD" decimals="2">25,465.50</ix:nonFraction></td></tr></table></body></html>`;
const FEE_SCALED = `<ix:nonFraction name="ffd:TtlOfferingAmt" unitRef="USD" scale="6" decimals="-6">86.25</ix:nonFraction>`;
const FEE_TEXT_ONLY = `<p>Total Offering Amounts $172,500,000</p>`;
// A registration statement's opening, as EDGAR serves it: a contents table,
// the cover, the summary heading, the preamble, "Overview", then the company
// in its own words, then "The Offering".
const PROSPECTUS = `<html><body>
<table><tr><td>Prospectus Summary</td><td>1</td></tr><tr><td>Risk Factors</td><td>12</td></tr></table>
<p>The date of this prospectus is September 20, 2026.</p>
<div style="text-align:center"><b>PROSPECTUS SUMMARY</b></div>
<p>This summary highlights selected information that is presented in greater detail elsewhere in this prospectus. It does not contain all of the information you should consider before investing.</p>
<p>Unless the context otherwise requires, references in this prospectus to &#8220;Acme,&#8221; &#8220;we,&#8221; &#8220;us&#8221; and &#8220;our&#8221; refer to Acme Robotics Inc. and its subsidiaries.</p>
<p>The following summary is qualified in its entirety by the more detailed information and financial statements appearing elsewhere.</p>
<p><b>Overview</b></p>
<p>Acme Robotics Inc. builds autonomous warehouse robots for U.S. retailers.<sup>(1)</sup> Our robots pick, pack and sort goods without changes to a customer&#8217;s shelving or software. We sold to 40 customers across 12 states in 2025. A fourth sentence that should never be shown because three sentences is the most the block ever takes.</p>
<p><b>The Offering</b></p>
<p>We are offering 10,000,000 shares of common stock in this offering at an assumed price.</p>
</body></html>`;
const PROSPECTUS_TABLE_ONLY = `<p>PROSPECTUS SUMMARY</p><table><tr><td>Acme Robotics Inc. builds autonomous warehouse robots for retailers across the country today. Our robots pick, pack and sort goods without changes to shelving.</td></tr></table><p>The Offering</p>`;
const PROSPECTUS_BOILERPLATE = `<p>Prospectus Summary</p><p>This summary highlights information contained elsewhere in this prospectus and does not contain all of the information you should consider.</p><p>Overview</p><p>We are an emerging growth company as defined in the JOBS Act and may take advantage of reduced reporting requirements. We are offering [&#9679;] shares of our common stock in this offering at a price to be set.</p><p>The Offering</p>`;
const PROSPECTUS_SHORT = `<p>Summary</p><p>Overview</p><p>Acme makes robots for many large warehouses and small depots in the whole world.</p><p>The Offering</p>`;
const PROSPECTUS_SPAC = `<p>SUMMARY</p><p>This summary highlights selected information about us and our business. It may not contain all of the information that is important to investors.</p><p>We are a newly incorporated blank check company incorporated as a Cayman Islands exempted company for the purpose of effecting a merger, share exchange or similar business combination with one or more businesses. We have not selected any business combination target. Our sponsor is Gamma Sponsor LLC, a Delaware limited liability company.</p><p>The Offering</p>`;
const ABOUT_ACME = "Acme Robotics Inc. builds autonomous warehouse robots for U.S. retailers. Our robots pick, pack and sort goods without changes to a customer\u2019s shelving or software. We sold to 40 customers across 12 states in 2025.";

const INDEX_WITH = { directory: { item: [{ name: "s1a2.htm" }, { name: "ex1-1.htm" }, { name: "ex107.htm" }, { name: "R1.htm" }] } };
const INDEX_WITHOUT = { directory: { item: [{ name: "s1a2.htm" }, { name: "ex23-1.htm" }] } };

function viewRules(V, S) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const p = S.profileFromSubmissions("1234567", OPERATING, "2026-09-20");
  want("the company facts are read from the submissions JSON", p.sic === "3569" && /GENERAL INDUSTRIAL/.test(p.sicDescription) && p.city === "AUSTIN" && p.region === "TX" && p.incorporatedIn === "DE" && p.fiscalYearEnd === "1231" && p.emergingGrowth === true);
  want("only the registration story's forms, oldest first", p.filings.map((f) => f.form).join() === "S-1,S-1/A,S-1/A" && p.filings[0].date === "2026-08-01");
  want("emerging growth only when the category names it", S.profileFromSubmissions("2", LISTED_CO, "x").emergingGrowth === false);
  const f = S.profileFromSubmissions("3", FOREIGN, "x");
  want("a country is named, not coded", f.region === "SINGAPORE" && f.incorporatedIn === "CAYMAN ISLANDS");
  want("SPAC: SIC 6770, or a blank-check name", V.isSpac("6770", "Gamma Acquisition Corp") && V.isSpac(null, "Epsilon Blank Check Co") && !V.isSpac("3569", "Acme Acquisition Holdings"));
  want("no SIC yet: the name decides (\"Acquisition Corp\"), and a known SIC wins over the name", V.isSpac(null, "Eaglesky Acquisition Corp") && V.isSpac(undefined, "Live Oak Acquisition Corp. VI") && !V.isSpac(null, "Acme Robotics Inc") && !V.isSpac("3569", "Zeta Acquisition Corp"));
  want("FOREIGN: an F-1 filer; a SPAC badge wins over it", V.ipoKind("7372", "Delta", f.filings) === "foreign" && V.ipoKind("6770", "Gamma", f.filings) === "spac" && V.ipoKind("3569", "Acme", p.filings) === "company");
  want("the fee maximum is ffd:TtlOfferingAmt (not the fee)", S.parseFeeExhibitMax(FEE_HTML) === 172500000);
  want("the tag's scale is applied", S.parseFeeExhibitMax(FEE_SCALED) === 86250000);
  want("no tag, no figure (the text is never read)", S.parseFeeExhibitMax(FEE_TEXT_ONLY) === null);
  want("the exhibit is found by its name, or not at all", S.pickFeeExhibit(INDEX_WITH) === "ex107.htm" && S.pickFeeExhibit(INDEX_WITHOUT) === null);
  const listed = S.profileFromSubmissions("4", LISTED_CO, "x");
  const tl = V.ipoTimeline(listed.filings, null);
  want("a listed IPO completes the timeline", tl.every((s) => s.done) && tl.find((s) => s.key === "listed").date === "2026-09-28");
  const pricedOnly = V.ipoTimeline([{ form: "S-1", date: "2026-08-01", acc: "a", doc: null }, { form: "424B4", date: "2026-09-27", acc: "b", doc: null }], null);
  want("priced but not yet registered on the exchange: listed is next, not done", pricedOnly.find((s) => s.key === "priced").done && !pricedOnly.find((s) => s.key === "listed").done);
  const tu = V.ipoTimeline(p.filings, "2026-09-20");
  want("an upcoming one stops at terms set; priced and listed are next", tu.find((s) => s.key === "terms").done && !tu.find((s) => s.key === "priced").done && !tu.find((s) => s.key === "listed").done && /2 amendments/.test(tu.find((s) => s.key === "amended").detail));
  want("refresh only on a newer filing", S.needsRefresh(undefined, "2026-09-20") && !S.needsRefresh({ v: 1, basedOn: "2026-09-20", about: null }, "2026-09-20") && S.needsRefresh({ v: 1, basedOn: "2026-09-20", about: null }, "2026-09-21"));
  want("a profile from before PR 2 (no `about` key) is rebuilt once", S.needsRefresh({ v: 1, basedOn: "2026-09-20" }, "2026-09-20"));
  return fails;
}

function aboutRules(S) {
  const fails = [];
  const want = (label, ok, got) => { if (!ok) fails.push(`${label}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ""}`); };
  const acme = S.extractAbout(PROSPECTUS);
  want("the company's own words after \"Overview\": three sentences, word for word, no footnote marker", acme === ABOUT_ACME, acme);
  want("...about 60 words at most", acme !== null && acme.split(/\s+/).length <= S.ABOUT_TARGET_WORDS);
  want("\"U.S.\" and \"Inc.\" are not sentence ends", S.splitSentences("Acme Robotics Inc. (\"Acme\") sells to U.S. Department of Defense agencies. It grew.").length === 2);
  want("a summary only inside a table: omitted", S.extractAbout(PROSPECTUS_TABLE_ONLY) === null, S.extractAbout(PROSPECTUS_TABLE_ONLY));
  want("only preamble, boilerplate and a placeholder: omitted", S.extractAbout(PROSPECTUS_BOILERPLATE) === null, S.extractAbout(PROSPECTUS_BOILERPLATE));
  want("too short to say anything: omitted", S.extractAbout(PROSPECTUS_SHORT) === null, S.extractAbout(PROSPECTUS_SHORT));
  const spac = S.extractAbout(PROSPECTUS_SPAC);
  want("a SPAC's summary without an \"Overview\" heading still reads", typeof spac === "string" && spac.startsWith("We are a newly incorporated blank check company") && /Gamma Sponsor LLC, a Delaware limited liability company\.$/.test(spac), spac);
  want("no summary heading at all: omitted", S.extractAbout("<p>Overview</p><p>Acme Robotics Inc. builds autonomous warehouse robots for many retailers in the country. Our robots pick, pack and sort goods without changes.</p>") === null);
  return fails;
}

function fakeRedis(initial) {
  const kv = new Map(initial ? [["msh:ipo:profiles:v1", initial]] : []);
  const calls = [];
  return { kv, calls, async get(k) { calls.push(["get", k]); return kv.get(k) ?? null; }, async set(k, v) { calls.push(["set", k]); kv.set(k, structuredClone(v)); return "OK"; } };
}
function stubFetch(map, status = {}) {
  const urls = [];
  const impl = async (url) => {
    urls.push(url);
    const s = Object.entries(status).find(([frag]) => url.includes(frag))?.[1];
    if (s) return new Response("", { status: s });
    const hit = Object.entries(map).find(([frag]) => url.includes(frag));
    if (!hit) return new Response("", { status: 404 });
    const body = typeof hit[1] === "string" ? hit[1] : JSON.stringify(hit[1]);
    return new Response(body, { status: 200 });
  };
  return { impl, urls };
}
async function stepRules(S) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const opts = (impl) => ({ ua: "check test@example.com", deadlineMs: Date.now() + 60_000, fetchImpl: impl, sleep: async () => {}, now: Date.now });
  // A cold store: one new filer with a fee exhibit -> 3 requests, one SET.
  {
    const r = fakeRedis(null);
    const { impl, urls } = stubFetch({ "CIK0001234567.json": OPERATING, "/index.json": INDEX_WITH, "ex107.htm": FEE_HTML, "s1a2.htm": PROSPECTUS });
    const res = await S.refreshIpoProfiles(r, [{ cik: "1234567", latestFilingDate: "2026-09-20" }], opts(impl));
    const stored = r.kv.get("msh:ipo:profiles:v1")?.profiles?.["1234567"];
    want("a new filer: at most 4 SEC requests (submissions, index, fee exhibit, prospectus)", urls.length === 4 && res.secRequests === 4 && urls[3].endsWith("/000123456726000020/s1a2.htm"));
    want("...and its profile is stored with the fee maximum and its source", stored && stored.maxDealSize === 172500000 && stored.maxDealSizeFrom?.form === "S-1/A" && res.wrote && r.calls.filter(([c]) => c === "set").length === 1);
    want("...and \"What it does\" from the latest registration filing, with that filing named", stored?.about?.text === ABOUT_ACME && stored.about.form === "S-1/A" && stored.about.date === "2026-09-20" && res.aboutFound === 1);
    // The same run again: up to date -> no request, no SET.
    const again = stubFetch({});
    const res2 = await S.refreshIpoProfiles(r, [{ cik: "1234567", latestFilingDate: "2026-09-20" }], opts(again.impl));
    want("an up-to-date filer costs no SEC request and no SET", again.urls.length === 0 && res2.secRequests === 0 && !res2.wrote);
    // A newer filing -> refreshed.
    const third = stubFetch({ "CIK0001234567.json": OPERATING, "/index.json": INDEX_WITHOUT, "s1a2.htm": PROSPECTUS_BOILERPLATE });
    const res3 = await S.refreshIpoProfiles(r, [{ cik: "1234567", latestFilingDate: "2026-09-30" }], opts(third.impl));
    const p3 = r.kv.get("msh:ipo:profiles:v1").profiles["1234567"];
    want("a newer filing refreshes it; no exhibit named, no fee figure, no exhibit request", res3.refreshed === 1 && third.urls.length === 3 && p3.maxDealSize === null);
    want("a prospectus that yields no clean extract records null (the block is omitted, not re-read)", "about" in p3 && p3.about === null && res3.aboutOmitted === 1);
    // The prospectus cannot be fetched: `about` stays absent, so the next run retries.
    const fourth = stubFetch({ "CIK0001234567.json": OPERATING, "/index.json": INDEX_WITHOUT }, { "s1a2.htm": 500 });
    await S.refreshIpoProfiles(r, [{ cik: "1234567", latestFilingDate: "2026-10-01" }], opts(fourth.impl));
    const p4 = r.kv.get("msh:ipo:profiles:v1").profiles["1234567"];
    want("a failed prospectus fetch keeps the profile but leaves `about` absent (retried next run)", p4 && p4.basedOn === "2026-10-01" && !("about" in p4) && S.needsRefresh(p4, "2026-10-01"));
    // A filer that left the page is dropped.
    const res4 = await S.refreshIpoProfiles(r, [], opts(stubFetch({}).impl));
    want("a filer no longer on the page is dropped", res4.wrote && Object.keys(r.kv.get("msh:ipo:profiles:v1").profiles).length === 0);
  }
  // Throttled: the step stops, nothing more is asked.
  {
    const r = fakeRedis(null);
    const { impl, urls } = stubFetch({}, { "data.sec.gov": 429 });
    const res = await S.refreshIpoProfiles(r, [{ cik: "1", latestFilingDate: "2026-09-01" }, { cik: "2", latestFilingDate: "2026-09-01" }], opts(impl));
    want("a 429 stops the step (never retried, the rest deferred)", res.throttled && urls.length === 1 && res.deferred === 2);
  }
  return fails;
}

async function renderRules(V, S, ListMod) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const row = (cik, company, symbol, sub, extra = {}) => ({
    ipo: { table: "upcoming", cik, symbol, company, date: "2026-09-20", exchange: "Nasdaq", priceRangeLow: 14, priceRangeHigh: 16, sharesOffered: 10_000_000, dealSize: 150_000_000, marketCap: null },
    profile: sub ? { ...S.profileFromSubmissions(cik, sub, "2026-09-20"), ...extra } : null,
  });
  const rows = [
    row("1234567", "Acme Robotics Inc", "ACME", OPERATING, { maxDealSize: 172500000, maxDealSizeFrom: { form: "S-1/A", date: "2026-09-20" }, about: { text: ABOUT_ACME, form: "S-1/A", date: "2026-09-20" } }),
    row("7", "Gamma Acquisition Corp", "GAMAU", SPAC, { about: null }),
    row("8", "Delta Holdings Ltd", null, FOREIGN),
  ];
  const html = renderToStaticMarkup(React.createElement(ListMod.default, { rows, table: "upcoming", dateLabel: "Terms set", emptyMessage: "none" }));
  const items = [...html.matchAll(/<details[^>]*class="ipoItem"[^>]*>([\s\S]*?)<\/details>/g)];
  want("every row is a <details>, closed, with its body in the server HTML", items.length === 3 && !/<details[^>]*\bopen\b/.test(html) && items.every((m) => /class="ipoBody"/.test(m[1])));
  const acme = items[0][1], gamma = items[1][1], delta = items[2][1];
  want("the operating company: COMPANY, TERMS SET, industry · HQ, the fee maximum, the timeline, the EDGAR links", />COMPANY</.test(acme) && />TERMS SET</.test(acme) && /General Industrial Machinery[^<]*· Austin, TX/.test(acme) && /\$172\.5 million \(fee exhibit, S-1\/A/.test(acme) && /Where the filing stands/.test(acme) && /sec\.gov\/Archives\/edgar\/data\/1234567\/000123456726000020\/s1a2\.htm/.test(acme));
  want("the SPAC: badge and the boxed note", />SPAC</.test(gamma) && /class="ipoSpacNote"/.test(gamma) && !/class="ipoSpacNote"/.test(acme));
  want("the foreign filer: FOREIGN, a missing ticker reads —", />FOREIGN</.test(delta) && /· <span class="ipoSym">—<\/span>/.test(delta));
  want("no fee exhibit, no maximum-deal line", !/Maximum deal size/.test(gamma) && /Maximum deal size/.test(acme));
  want("\"What it does\" in the server HTML, quoted with its filing named", /What it does/.test(acme) && /From its prospectus:<\/span> Acme Robotics Inc\. builds autonomous warehouse robots/.test(acme) && /Source: S-1\/A filed Sep 20, 2026, prospectus summary/.test(acme));
  want("no extract (null or absent), no \"What it does\" block", !/What it does/.test(gamma) && !/What it does/.test(delta));
  want("the filters count all / operating / SPACs", />All · 3</.test(html) && />Operating companies · 2</.test(html) && />SPACs · 1</.test(html));
  return fails;
}

function sourceRules(srcs) {
  const fails = [];
  const want = (label, ok) => { if (!ok) fails.push(label); };
  const page = stripComments(srcs.page, { file: PAGE });
  const list = stripComments(srcs.list, { file: LIST });
  const route = stripComments(srcs.route, { file: ROUTE });
  want("the page reads the stored profiles, never SEC", /await readIpoProfiles\(\)/.test(page) && !/secFetcher|refreshIpoProfiles|data\.sec\.gov|fetch\(/.test(page));
  want("the list makes no request", !/\bfetch\(|useEffect|data\.sec\.gov/.test(list));
  want("the job runs the step after the write (and on an up-to-date day), never on a dry run", /profileFields\(!dryRun && write\.ok \? await profileStep\(started, dryRun\)/.test(route) && /\.\.\.profileFields\(await profileStep\(started, dryRun\)\)/.test(route) && /if \(dryRun\) return \{ skipped: "dry run" \};/.test(route));
  return fails;
}

try {
  const viewSrc = read(VIEW), serverSrc = read(SERVER), listSrc = read(LIST);
  const V = await load(VIEW, viewSrc);
  const S = await load(SERVER, serverSrc);
  console.log("\n1. The profile, the badges, the fee exhibit, the timeline");
  const v = viewRules(V, S);
  check("submissions facts; SPAC / FOREIGN; ffd:TtlOfferingAmt; timeline; refresh rule", v.length === 0, v.join("; "));
  console.log("\n1b. \"What it does\": the prospectus summary, extracted");
  const ab = aboutRules(S);
  check("Overview's sentences word for word; tables, markers, preamble, boilerplate out; ~60 words; omit on failure", ab.length === 0, ab.join("; "));
  console.log("\n2. The job step (stub fetch, fake store)");
  const st = await stepRules(S);
  check("4 requests at most; none when up to date; refresh on a new filing; extract or null; a failed fetch retried; throttle stops; drop off-page", st.length === 0, st.join("; "));
  console.log("\n3. Rendered on fixtures");
  const rr = await renderRules(V, S, await load(LIST, listSrc));
  check("<details> bodies in the server HTML; badges; SPAC note; fee line and What it does only when on file; — for no ticker", rr.length === 0, rr.join("; "));
  console.log("\n4. Source");
  const srcs = { page: read(PAGE), list: listSrc, route: read(ROUTE) };
  const so = sourceRules(srcs);
  check("no SEC fetch on render; the job step's placement", so.length === 0, so.join("; "));

  console.log("\n5. Planted mutants");
  const VIEW_M = [
    ["SPAC by SIC only (a blank-check name missed)", "  if (/\\bblank[- ]check\\b/i.test(company)) return true;\n", ""],
    ["no name fallback before the SIC is known", "  return SPAC_NAME.test(company);", "  return false;"],
    ["the name overriding a known SIC", "  if (code) return code === \"6770\";", "  if (code && code === \"6770\") return true;"],
    ["FOREIGN before SPAC", "  if (isSpac(sic, company)) return \"spac\";\n  if (isForeignFiler(filings)) return \"foreign\";", "  if (isForeignFiler(filings)) return \"foreign\";\n  if (isSpac(sic, company)) return \"spac\";"],
    ["listed counted from the prospectus alone", "    { key: \"listed\", label: \"Listed (exchange registration)\", date: listed?.date ?? null, detail: null, done: Boolean(listed) },", "    { key: \"listed\", label: \"Listed (exchange registration)\", date: listed?.date ?? null, detail: null, done: Boolean(listed) || Boolean(priced) },"],
  ];
  for (const [label, from, to] of VIEW_M) {
    if (!viewSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try { f = viewRules(await load(VIEW, viewSrc.replace(from, to)), S); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SERVER_M = [
    ["the fee's scale ignored", "  const v = n * 10 ** (Number.isFinite(scale) ? scale : 0);", "  const v = n;"],
    ["the fee read from the text when untagged", "  if (!m) return null;\n  const attrs", "  if (!m) { const t = /Total Offering Amounts\\D*([\\d,]+)/.exec(html); return t ? Number(t[1].replace(/,/g, \"\")) : null; }\n  const attrs"],
    ["the fee amount taken for the offering", "name=\"ffd:TtlOfferingAmt\"", "name=\"ffd:TtlFeeAmt\""],
    ["refreshed on every run", "  return !stored || stored.v !== 1 || latestFilingDate > stored.basedOn || !(\"about\" in stored);", "  return true;"],
    ["a throttle retried as a failure", "      if (err instanceof SecThrottled) { result.throttled = true; result.deferred = due.length - i; break; }", "      if (false) { break; }"],
    ["a SET every run", "  if (changed) {", "  if (true) {"],
    ["tables read as prose", "    .replace(/<table\\b[\\s\\S]*?<\\/table>/gi, \"\\n\\n\")\n", ""],
    ["footnote markers kept", "    .replace(/<sup\\b[\\s\\S]*?<\\/sup>/gi, \"\")\n", ""],
    ["the preamble taken as the description", "      if (!isProse(b) || PREAMBLE.test(b)) continue;", "      if (!isProse(b)) continue;"],
    ["boilerplate sentences kept", "    if (w < 5 || BAD_SENTENCE.test(sentence) || !/[.!?][\"”’)]?$/.test(sentence)) {", "    if (w < 5 || !/[.!?][\"”’)]?$/.test(sentence)) {"],
    ["\"U.S.\" read as a sentence end", "    if (m[0][0] === \".\" && ABBREVIATION.test(upTo)) continue;", ""],
    ["no word or sentence limit", "    if (picked.length >= 3) break;", ""],
    ["a too-short extract shown", "  if (!picked.length || words < ABOUT_MIN_WORDS) return null;", "  if (!picked.length) return null;"],
    ["\"Overview\" not looked for", "      if (OVERVIEW_HEADING.test(strip(blocks[k]))) { from = k + 1; break; }", ""],
    ["no prospectus fetch", "        if (reg.doc && now() <= opts.deadlineMs) {", "        if (false) {"],
    ["a failed fetch recorded as no extract (never retried)", "          } catch (err) {\n            if (err instanceof SecThrottled) throw err;\n          }", "          } catch (err) {\n            if (err instanceof SecThrottled) throw err;\n            profile.about = null;\n          }"],
    ["old profiles never backfilled", " || !(\"about\" in stored);", ";"],
  ];
  for (const [label, from, to] of SERVER_M) {
    if (!serverSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let f;
    try {
      const M = await load(SERVER, serverSrc.replace(from, to));
      f = [...viewRules(V, M), ...aboutRules(M), ...(await stepRules(M))];
    } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const LIST_M = [
    ["the body only after a click", "            <div className=\"ipoBody\">", "            {false && <div className=\"ipoBody\">"],
    ["the SPAC note on every row", "              {kind === \"spac\" ? <p className=\"ipoSpacNote\">{SPAC_NOTE}</p> : null}", "              {<p className=\"ipoSpacNote\">{SPAC_NOTE}</p>}"],
    ["a blank where the ticker is missing", "const SYMBOL_FALLBACK = \"—\";", "const SYMBOL_FALLBACK = \"\";"],
    ["the What it does block shown without an extract", "              {profile?.about ? (", "              {profile ? ("],
  ];
  for (const [label, from, to] of LIST_M) {
    if (!listSrc.includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    let m = listSrc.replace(from, to);
    if (label === "the body only after a click") m = m.replace("            </div>\n          </details>", "            </div>}\n          </details>");
    let f;
    try { f = await renderRules(V, S, await load(LIST, m)); } catch (err) { f = [String(err)]; }
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
  const SRC_M = [
    ["the page fetching SEC on render", "page", "await readIpoProfiles()", "await readIpoProfiles(); await fetch(\"https://data.sec.gov/x\")"],
    ["the step on a dry run", "route", "if (dryRun) return { skipped: \"dry run\" };", ""],
  ];
  for (const [label, which, from, to] of SRC_M) {
    if (!srcs[which].includes(from)) { check(`mutant "${label}" applies`, false, "the anchor matched nothing"); continue; }
    const f = sourceRules({ ...srcs, [which]: srcs[which].replace(from, to) });
    check(`mutant "${label}" is caught`, f.length > 0, f[0] ?? "no rule failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
