// TWELVE MONTHS OF EPS FROM THE 10-K AND 10-Q (#552 COWORK #33).
//
//   1. parseDurationFacts: undimensioned and StatementClassOfStockAxis-only
//      facts; another axis left out; the USD unit read.
//   2. ttmFromInstances on filing-shaped fixtures:
//      - COST-shaped (a 36-week year-to-date): FY + YTD - prior YTD;
//      - NFLX-shaped (a split restated in the 10-Q's comparative): passes;
//      - BKNG-shaped (split after the 10-K): REFUSED, not adjusted;
//      - COF-shaped (share issuance mid-year): REFUSED by the pairwise guard.
//        MUTATION: the guard back to year-only → COF passes;
//      - the chain: a year-to-date not starting the day after the year REFUSES.
//        MUTATION: chain check removed;
//      - BRK-shaped (no diluted figure at all): basic, and labelled basic; a
//        filer stating diluted anywhere never falls to basic. MUTATION: that
//        rule removed → basic used beside a diluted figure.
//   3. pickMember: cited, undimensioned, the only class, several uncited → refused.
//   4. ttmEpsFromSet: the filings' figure only where the set cannot give twelve
//      months, and only if it runs to the newest stored quarter.
//      MUTATION: the newest-quarter test removed.
//   5. Every companyfacts reader applies it (cold fetch, the sec-facts cron,
//      the sec-filings job, both its paths). MUTATION: the cron unwired.
//   6. contentHashOf: a set without `te` hashes as before; `te` moves the hash.
//
//   node scripts/check-sec-instance-eps.mjs
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const once = (src, from, to) => {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor matched ${n} times: ${from.slice(0, 60)}`);
  return src.replace(from, to);
};
const SRC = readCodeOnly("lib/server/secInstanceEps.ts");
const VAL = readCodeOnly("lib/server/secValuation.ts");
const constOf = (src, name) => src.match(new RegExp(`^export const ${name}[^=]*= [\\s\\S]*?;$`, "m"))[0].replace(/^export /, "");
const load = (src = SRC) => lift([
  constOf(VAL, "Q4_SHARE_BASIS_TOLERANCE"),
  constOf(src, "INSTANCE_EPS_CONCEPTS").replace(/: \{[^=]*\}\[\] =/, " ="),
  src.match(/^const SHARE_CONCEPTS = [\s\S]*?^\};$/m)[0],
  src.match(/^const WANTED = .*$/m)[0],
  "const DAY = 86_400_000;",
  src.match(/^const days = .*$/m)[0],
  constOf(src, "CHAIN_SLACK_DAYS"), constOf(src, "COMPARATIVE_SLACK_DAYS"),
  grabFunction(src, "parseDurationFacts"), grabFunction(src, "pickMember"), grabFunction(src, "ttmFromInstances"),
  "export { parseDurationFacts, pickMember, ttmFromInstances };",
].join("\n"));
const M = await load();

// ── 1. parse ───────────────────────────────────────────────────────────────
console.log("1. parseDurationFacts");
const AX = "us-gaap:StatementClassOfStockAxis";
const ctx = (id, s, e, dims = []) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="x">1</xbrli:identifier>${dims.length
  ? `<xbrli:segment>${dims.map(([d, m]) => `<xbrldi:explicitMember dimension="${d}">${m}</xbrldi:explicitMember>`).join("")}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:startDate>${s}</xbrli:startDate><xbrli:endDate>${e}</xbrli:endDate></xbrli:period></xbrli:context>`;
const XML = [
  `<xbrli:unit id="usdPerShare"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>`,
  `<xbrli:unit id="eurPerShare"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>`,
  ctx("u", "2026-01-01", "2026-06-30"), ctx("a", "2026-01-01", "2026-06-30", [[AX, "us-gaap:CommonClassAMember"]]),
  ctx("seg", "2026-01-01", "2026-06-30", [["us-gaap:StatementBusinessSegmentsAxis", "x:CloudMember"]]),
  `<us-gaap:EarningsPerShareDiluted contextRef="u" unitRef="usdPerShare" decimals="2">1.50</us-gaap:EarningsPerShareDiluted>`,
  `<us-gaap:EarningsPerShareDiluted contextRef="a" unitRef="usdPerShare" decimals="2">2.97</us-gaap:EarningsPerShareDiluted>`,
  `<us-gaap:EarningsPerShareDiluted contextRef="seg" unitRef="usdPerShare" decimals="2">9.99</us-gaap:EarningsPerShareDiluted>`,
  `<us-gaap:EarningsPerShareBasic contextRef="u" unitRef="eurPerShare" decimals="2">1.60</us-gaap:EarningsPerShareBasic>`,
].join("\n");
{
  const f = M.parseDurationFacts(XML);
  check("undimensioned and class-axis facts kept, the segment-axis fact left out",
    f.length === 3 && f.some((x) => x.member === null && x.val === 1.5) && f.some((x) => x.member === "CommonClassAMember" && x.val === 2.97) && !f.some((x) => x.val === 9.99), JSON.stringify(f));
  check("the unit is read: USD per share true, EUR false",
    f.find((x) => x.val === 1.5)?.usd === true && f.find((x) => x.val === 1.6)?.usd === false);
}

// ── 2. ttmFromInstances ────────────────────────────────────────────────────
console.log("\n2. ttmFromInstances");
const F = (concept, start, end, val, member = null) => ({ concept, start, end, member, val, usd: true });
const D = "EarningsPerShareDiluted", SD = "WeightedAverageNumberOfDilutedSharesOutstanding";
// period set: FY (10-K), YTD and its comparative (10-Q), each with EPS and shares.
const shaped = ({ fy, ytd, prior, sy, sc, sp, fyS = "2024-09-02", fyE = "2025-08-31", ytdS = "2025-09-01", ytdE = "2026-05-10", priorS = "2024-09-02", priorE = "2025-05-11", concept = D, shares = SD, member = null }) => ({
  k: [F(concept, fyS, fyE, fy, member), F(shares, fyS, fyE, sy, member)],
  q: [F(concept, ytdS, ytdE, ytd, member), F(shares, ytdS, ytdE, sc, member), F(concept, priorS, priorE, prior, member), F(shares, priorS, priorE, sp, member)],
});
const run = (m, x, cited = null) => m.ttmFromInstances(x.k, x.q, cited, { k: "K", q: "Q" });
{
  const cost = run(M, shaped({ fy: 18.21, ytd: 14.01, prior: 12.34, sy: 444.8e6, sc: 444.4e6, sp: 444.9e6 }));
  check("COST-shaped (36-week year-to-date): 18.21 + 14.01 - 12.34 = 19.88, diluted, to the 10-Q's end",
    cost.ok && cost.eps.val === 19.88 && cost.eps.kind === "diluted" && cost.eps.periodEnd === "2026-05-10" && cost.eps.yearEnd === "2025-08-31", JSON.stringify(cost));
  const cal = { fyS: "2025-01-01", fyE: "2025-12-31", ytdS: "2026-01-01", ytdE: "2026-06-30", priorS: "2025-01-01", priorE: "2025-06-30" };
  const nflx = run(M, shaped({ ...cal, fy: 2.53, ytd: 2.03, prior: 1.38, sy: 4343.9e6, sc: 4280e6, sp: 4359e6 }));
  check("NFLX-shaped (the 10-Q restates its comparative after the split): 3.18", nflx.ok && nflx.eps.val === 3.18, JSON.stringify(nflx));
  const bkng = run(M, shaped({ ...cal, fy: 165.57, ytd: 3.89, prior: 1.5, sy: 32.6e6, sc: 782e6, sp: 821e6 }));
  check("BKNG-shaped (split after the 10-K, the year pre-split): REFUSED, not adjusted", !bkng.ok && /share basis/.test(bkng.why), JSON.stringify(bkng));
  const COF = shaped({ ...cal, fy: 4.03, ytd: 8.07, prior: -6.74, sy: 541.3e6, sc: 622e6, sp: 445e6 });
  const cof = run(M, COF);
  check("COF-shaped (share count 384M → 640M inside the window): REFUSED by the pairwise guard", !cof.ok && /share basis/.test(cof.why), JSON.stringify(cof));
  const Mm = await load(once(SRC, "if (Math.max(sy, sc, sp) / Math.min(sy, sc, sp) - 1 > Q4_SHARE_BASIS_TOLERANCE) {",
    "if ([sc, sp].some((s) => Math.abs(s / sy - 1) > Q4_SHARE_BASIS_TOLERANCE)) {"));
  check("MUTATION: the guard back to year-only → COF's 18.84 passes", run(Mm, COF).ok === true);

  // Two plain quarters (Apr-Jun 2026 and its comparative) in place of year-to-dates.
  const gap = shaped({ ...cal, ytdS: "2026-04-01", priorS: "2025-04-01", fy: 2, ytd: 1, prior: 1, sy: 1e9, sc: 1e9, sp: 1e9 });
  check("the chain: a three-month quarter is not a year-to-date (it does not start the day after the year) → REFUSED", !run(M, gap).ok);
  // The chain is guarded TWICE (the year-to-date starts after the year; its
  // comparative starts with it), so the mutation removes both.
  const Mc = await load(once(once(SRC, " && Math.abs(days(fyEnd, f.start) - 1) <= CHAIN_SLACK_DAYS)", ")"),
    "Math.abs(days(fyStart, f.start)) <= CHAIN_SLACK_DAYS\n      && ", ""));
  check("MUTATION: both chain tests removed → a quarter is used as a year-to-date", run(Mc, gap).ok === true);

  const brkX = shaped({ ...cal, concept: "EarningsPerShareBasic", shares: "WeightedAverageNumberOfSharesOutstandingBasic", member: "EquivalentClassBMember",
    fy: 31.04, ytd: 16.59, prior: 7.87, sy: 2.156e9, sc: 2.1559e9, sp: 2.1573e9 });
  const brk = run(M, brkX, "EquivalentClassBMember");
  check("BRK-shaped (no diluted figure anywhere): basic, labelled basic, the cited class", brk.ok && brk.eps.kind === "basic" && brk.eps.val === 39.76 && brk.eps.member === "EquivalentClassBMember", JSON.stringify(brk));
  const mixed = { k: [...brkX.k], q: [...brkX.q, F(D, "2026-04-01", "2026-06-30", 11.9, "EquivalentClassBMember")] };
  check("a filer stating diluted EPS anywhere never falls back to basic", !run(M, mixed, "EquivalentClassBMember").ok);
  const Mb = await load(once(SRC, 'if (c.kind === "basic" && statesDiluted) continue;', ""));
  check("MUTATION: that rule removed → basic used beside a diluted figure", run(Mb, mixed, "EquivalentClassBMember").ok === true);
}

// ── 3. pickMember ──────────────────────────────────────────────────────────
console.log("\n3. pickMember");
{
  const A = F(D, "a", "b", 1, "CommonClassAMember"), B = F(D, "a", "b", 1, "CommonClassBMember"), U = F(D, "a", "b", 1, null);
  check("the cited class, where stated", M.pickMember([A, B], "CommonClassAMember")?.member === "CommonClassAMember");
  check("uncited: the undimensioned figure", M.pickMember([A, U], null)?.member === null && M.pickMember([A, U], null) !== null);
  check("uncited: the only class stated", M.pickMember([A], null)?.member === "CommonClassAMember");
  check("several classes, none cited → refused", M.pickMember([A, B], null) === null);
  check("cited class absent and no undimensioned figure → refused", M.pickMember([A, B], "CommonClassCMember") === null);
}

// ── 4. ttmEpsFromSet ───────────────────────────────────────────────────────
console.log("\n4. ttmEpsFromSet: the filings' figure only where the set cannot give twelve months");
{
  const ttmSrc = grabFunction(VAL, "ttmEpsFromSet");
  const loadT = (src) => lift([
    "const annualOnlyForm = () => null;",
    "const newestFiscalYear = (ys) => ys[0]?.eps != null ? { val: ys[0].eps, basis: 'fiscal-year', periodEnd: ys[0].e } : null;",
    "const fourConsecutiveQuarters = (s) => s.fq ?? null;",
    src, "export { ttmEpsFromSet };",
  ].join("\n"));
  const T = await loadT(ttmSrc);
  const te = { val: 11.75, periodEnd: "2026-06-30", yearEnd: "2025-09-30", ytdStart: "2025-10-01", ytdDays: 272, kind: "diluted", member: "CommonClassAMember", concept: D, k: "K", q: "Q" };
  const set = (over) => ({ quarters: [{ e: "2026-06-30" }], years: [{ e: "2025-09-30", eps: 10.2 }], cur: "USD", te, ...over });
  const v = T.ttmEpsFromSet(set({}), {}, "2026-09-24");
  check("V-shaped: no four quarters, year older than the quarter → the filings' 11.75, 'year-to-date', 9 months",
    v?.basis === "year-to-date" && v.val === 11.75 && v.ytd?.months === 9, JSON.stringify(v));
  const four = T.ttmEpsFromSet(set({ fq: { val: 7, basis: "four-quarters", periodEnd: "2026-06-30" } }), {}, "2026-09-24");
  check("the set's own four quarters win: `te` never replaces a figure that is on the page", four?.basis === "four-quarters" && four.val === 7);
  const stale = set({ quarters: [{ e: "2026-09-30" }] });
  check("a `te` older than the newest stored quarter is not trailing → refused", T.ttmEpsFromSet(stale, {}, "2026-10-30") === null);
  const Tm = await loadT(once(ttmSrc, " || (newestQuarter !== null && te.periodEnd < newestQuarter)", ""));
  check("MUTATION: the newest-quarter test removed → a stale `te` is used", Tm.ttmEpsFromSet(stale, {}, "2026-10-30") !== null);
  check("a converted (non-USD) set never uses it", T.ttmEpsFromSet(set({ cur: "EUR" }), {}, "2026-09-24") === null);
  check("basic is carried to the label", T.ttmEpsFromSet(set({ te: { ...te, kind: "basic" } }), {}, "2026-09-24")?.kind === "basic");
}

// ── 5. wiring ──────────────────────────────────────────────────────────────
console.log("\n5. every companyfacts reader applies it");
const READERS = {
  "lib/server/secColdFetch.ts": [/extracted\.ttmEps = await withInstanceEps\(symbol, cik, extracted, secGet\);\s*const set = await toStoredSet\(extracted\)/],
  "app/api/jobs/sec-facts/route.ts": [/extracted\.ttmEps = await withInstanceEps\(symbol, cik, extracted, secGetGated\);[\s\S]{0,600}?const fresh = await toStoredSet\(extracted,/],
  "lib/server/secFilingJob.ts": [
    /base\.ttmEps = await withInstanceEps\(symbol, cik, base, fetch\.get\);\s*return \{ kind: "caught-up", set: await toStoredSet\(base,/,
    /filled\.ttmEps = await withInstanceEps\(symbol, cik, filled, fetch\.get\);\s*const next = await toStoredSet\(filled,/,
  ],
};
const SRCS = Object.fromEntries(Object.keys(READERS).map((f) => [f, readCodeOnly(f)]));
const wired = (srcs) => Object.entries(READERS).every(([f, res]) => res.every((re) => re.test(srcs[f])));
check("cold fetch, the sec-facts cron and both sec-filings paths apply it before storing", wired(SRCS));
check("MUTATION: the cron unwired → caught", !wired({ ...SRCS,
  "app/api/jobs/sec-facts/route.ts": once(SRCS["app/api/jobs/sec-facts/route.ts"], "extracted.ttmEps = await withInstanceEps(symbol, cik, extracted, secGetGated);", "") }));
check("a set whose periods give twelve months costs no SEC request (the reader asks ttmEpsFromSet first)",
  /if \(ttmEpsFromSet\(probe, \{\}, today\)\) return undefined;/.test(SRC) && SRC.indexOf("if (ttmEpsFromSet(probe, {}, today)) return undefined;") < SRC.indexOf("const subs = (await (await get("));

// ── 6. the content hash ────────────────────────────────────────────────────
console.log("\n6. contentHashOf");
{
  const CODEC = readCodeOnly("lib/server/secFactCodec.ts");
  const H = await lift([grabFunction(CODEC, "contentHashOf"), "export { contentHashOf };"].join("\n"));
  const base = { quarters: [{ e: "2026-06-30", a: "x", v: [1, null], d: "F-" }], years: [], instants: [], cover: { val: 5 } };
  const h0 = H.contentHashOf(base);
  check("a set without `te` hashes exactly as before (no set changes hash for this PR)", H.contentHashOf({ ...base, te: undefined }) === h0);
  check("`te` present moves the hash, so the cron writes it", H.contentHashOf({ ...base, te: { val: 11.75, periodEnd: "2026-06-30" } }) !== h0);
}

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
