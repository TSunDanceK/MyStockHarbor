// THE DIVIDEND ROW ON /stock/[symbol]'s "About" grid — driven, not read.
//
// ── WHAT IT REPLACED ─────────────────────────────────────────────────────
// `profile.lastDividend` from FMP, rendered "Yes · $0.26" or "No". It now
// comes from CommonStockDividendsPerShareDeclared, already extracted into
// every stored fact set by lib/server/secFields.ts and rendered nowhere until
// now. No new collection.
//
// ── THE THREE PROPERTIES THAT MATTER ─────────────────────────────────────
//   1. An IFRS filer's row is HIDDEN, because ifrs-full publishes no per-share
//      dividend tag under any spelling. Not zero, not "No", not a figure
//      divided out of dividendsPaid.
//   2. A period with cash paid and no declared per-share figure shows the LAST
//      KNOWN declared value LABELLED BY ITS OWN PERIOD. A figure captioned
//      with a quarter it was not declared in is a wrong number, not a stale one.
//   3. No symbol ever renders "No". Absence of a tag is not evidence of
//      non-payment, and the old row asserted it on every symbol FMP left empty.
//
// EVERY PROPERTY IS ASSERTED TWICE — once against the shipped source, once
// against source mutated to break that exact property. A check that cannot
// fail is worse than no check, because it reports PASS.
//
// NO FIXTURE SUPPLIES AN EXPECTED VALUE. data/sec/factset-fixture-*.json come
// from live companyfacts via the shipped extractor. Every number is SEC's.
import fs from "node:fs";
import { loadDividend, loadProfile, html, visibleText, once, React } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fixture = (sym) =>
  JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8"));

const D = await loadDividend();
const P = await loadProfile();

const PROFILE = {
  companyName: "Test Corp", description: "A description long enough to render.",
  sector: "Technology", industry: "Semiconductors", ceo: "A Person",
  website: "https://example.com", employees: 48000, exchange: "NASDAQ",
  country: "US", ipoDate: "1984-01-01", isin: "US0000000001", cusip: "000000001",
  marketCap: 1.2e11, beta: 1.34, price: 100, rangeLow: 60, rangeHigh: 140,
  lastDividend: 0.46, currency: "USD",
};

const renderWith = (mod, dividend) =>
  visibleText(html(React.createElement(mod.default, { profile: PROFILE, symbol: "TEST", dividend })));

console.log("\n1. the row comes from the filings, with its period attached");
{
  // AAPL AND GEV BOTH DECLARE. Their newest declared figures and the periods
  // they belong to come out of the fixtures, not out of this file.
  const aapl = D.buildProfileDividend(fixture("AAPL"));
  const gev = D.buildProfileDividend(fixture("GEV"));
  check("AAPL's row is a declared per-share figure",
    aapl.state === "declared" && aapl.perShare > 0,
    aapl.state === "declared" ? `$${aapl.perShare} for ${aapl.periodLabel}` : aapl.why?.reason);
  check("GEV's too", gev.state === "declared" && gev.perShare > 0,
    gev.state === "declared" ? `$${gev.perShare} for ${gev.periodLabel}` : gev.why?.reason);

  // THE PERIOD REACHES THE READER. Without it a dividend declared two years
  // ago renders identically to last quarter's — the defect FMP's undated
  // `lastDividend` field had.
  const t = renderWith(P, aapl);
  check("the rendered row carries the period, not just the money",
    /Dividend/.test(t) && t.includes(aapl.periodLabel),
    (t.match(/Dividend [^A-Z]*/) ?? [""])[0].trim());

  const noPeriod = await loadProfile(once(
    "`${fmtMoney2(dividendRow.perShare)} · ${dividendRow.periodLabel}`",
    "`${fmtMoney2(dividendRow.perShare)}`"));
  check("MUTATION: dropping the period from the value is caught",
    !renderWith(noPeriod, aapl).includes(aapl.periodLabel),
    "if this still contains the period, the assertion above is reading something else");
}

console.log("\n2. an IFRS filer's row is hidden, by the TAXONOMY and not by luck");
{
  // ── KGC IS AN IFRS FILER, AND THE BRIEF SAID OTHERWISE ────────────────
  // It was described as US-GAAP, annual-only, whose absent tags might be
  // fixture sparseness needing a live re-check. Its own `tx` says
  // ["dei","ifrs-full","srt"]. There was never an ambiguous US-GAAP case to
  // resolve — it lands with AZN, and this asserts that rather than restating it.
  for (const sym of ["AZN", "KGC"]) {
    const set = fixture(sym);
    const d = D.buildProfileDividend(set);
    check(`${sym} is an ifrs-full filer and its row is hidden for that reason`,
      (set.tx ?? []).includes("ifrs-full") && d.state === "hidden" &&
        d.why.reason === "ifrs-no-per-share-tag",
      `tx=${JSON.stringify(set.tx)} reason=${d.state === "hidden" ? d.why.reason : "RENDERED"}`);
  }

  // AZN PAYS. Its row being hidden is not "this company pays no dividend" —
  // its own dividendsPaid is billions. That is exactly why the hide must not
  // be rendered as a "No".
  const t = renderWith(P, D.buildProfileDividend(fixture("AZN")));
  check("nothing renders in its place", !/Dividend/.test(t),
    "no row, no dash, no apology — same as the five registry-hidden rows");

  // THE MUTATION. Remove the taxonomy gate and AZN must change REASON — it
  // falls through to never-declared rather than suddenly showing a figure,
  // which is what proves the gate is what decided and not the absent data.
  const noGate = await loadDividend(once(
    'if (isIfrs && !isUsGaap) return hidden("ifrs-no-per-share-tag");', ""));
  const mutated = noGate.buildProfileDividend(fixture("AZN"));
  check("MUTATION: without the taxonomy gate AZN's reason changes",
    mutated.state === "hidden" && mutated.why.reason === "never-declared",
    `reason without the gate: ${mutated.state === "hidden" ? mutated.why.reason : "RENDERED"}`);
}

console.log("\n3. cash paid with no declared figure carries the last known one forward");
{
  // ── BUILT, BECAUSE NO COMMITTED FIXTURE CURRENTLY HAS THE SHAPE ───────
  // GEV's Q1 FY2025 is the real instance the owner cited: $69M paid, no
  // declared per-share figure, because it was declared the quarter before. But
  // GEV's NEWEST period declares, so the carry-forward path never runs on the
  // fixture as it stands. Nulling the newest period's value reproduces the
  // shape against otherwise real data, which is the only honest way to test a
  // branch no current filer is sitting in.
  const set = structuredClone(fixture("GEV"));
  const idx = D.SEC_FIELD_KEYS.indexOf("dividendsDeclaredPerShare");
  check("the field index resolves", idx >= 0, `index ${idx}`);

  const shipped = D.buildProfileDividend(fixture("GEV"));
  const newest = set.quarters[0];
  const second = set.quarters[1];
  const secondValue = second.v[idx];
  newest.v[idx] = null;

  const carried = D.buildProfileDividend(set);
  check("the newest period really did declare before the edit",
    shipped.state === "declared" && !shipped.carriedForward,
    `so the mutation below changes something: ${shipped.periodLabel}`);
  check("with the newest period blank, the row shows the previous figure",
    carried.state === "declared" && carried.perShare === secondValue,
    `${carried.state === "declared" ? `$${carried.perShare}` : carried.why?.reason} vs previous $${secondValue}`);
  check("...labelled by the period it was DECLARED in, not the current one",
    carried.state === "declared" && carried.periodEnd === second.e &&
      carried.periodLabel !== shipped.periodLabel,
    carried.state === "declared" ? `${carried.periodLabel} (period end ${carried.periodEnd})` : "");
  check("...and flagged as carried forward",
    carried.state === "declared" && carried.carriedForward === true);

  // THE MUTATION: stop at the newest period instead of walking back. The row
  // then goes blank beside a real cash outflow, which is the defect.
  // ANCHORED ON THE DECLARATION ABOVE THE LOOP, not on the loop header. The
  // header alone is `for (const p of periods) {`, which also appears verbatim
  // in secCurrency.ts — concatenated EARLIER in the unit, so the mutation
  // landed there and this assertion passed while proving nothing. `once`
  // refuses that now; the anchor is unique because the declaration is.
  const noWalk = await loadDividend(once(
    "let found: { p: StoredPeriod; val: number } | null = null;\n  for (const p of periods) {",
    "let found: { p: StoredPeriod; val: number } | null = null;\n  for (const p of periods.slice(0, 1)) {"));
  const blank = noWalk.buildProfileDividend(set);
  check("MUTATION: without the walk-back the row disappears",
    blank.state === "hidden",
    "which is the blank-row-beside-an-outflow defect this rule exists for");
}

console.log("\n4. no symbol ever renders \"No\"");
{
  // THE OLD ROW SAID "No" WHENEVER FMP'S FIELD WAS EMPTY — a claim about the
  // company made from a gap in the data. There is no XBRL fact asserting a
  // filer pays nothing, so the absence cannot support it.
  const hits = [];
  for (const sym of ["AAPL", "AZN", "GEV", "KGC", "KTOS", "TSLA"]) {
    const t = renderWith(P, D.buildProfileDividend(fixture(sym)));
    if (/Dividend\s+No\b/i.test(t)) hits.push(sym);
    if (/Dividend\s+Yes/i.test(t)) hits.push(`${sym} (Yes)`);
  }
  check("no fixture renders Yes/No in the Dividend row", hits.length === 0, hits.join(", "));

  // TSLA AND KTOS GENUINELY PAY NOTHING and their row is hidden rather than
  // reading "No". That is the deliberate trade, and it is asserted so that
  // re-adding a "No" is a decision someone has to make here rather than a
  // regression that slips through.
  for (const sym of ["KTOS", "TSLA"]) {
    const d = D.buildProfileDividend(fixture(sym));
    check(`${sym} (a real non-payer) is hidden, not asserted as "No"`,
      d.state === "hidden" && d.why.reason === "never-declared",
      d.state === "hidden" ? d.why.reason : "RENDERED");
  }

  const yesNo = await loadProfile(once(
    "const dividendValue =", 'const dividendValue = dividendRow.state !== "declared" ? "No" :'));
  check("MUTATION: a \"No\" reintroduced is caught",
    /Dividend\s+No\b/i.test(renderWith(yesNo, D.buildProfileDividend(fixture("TSLA")))));
}

console.log("\n5. every hide reason is registered, and the FMP field is kept");
{
  const reasons = Object.keys(D.DIVIDEND_HIDE_REASONS);
  check("every reason carries a sentence explaining it",
    reasons.length >= 3 && reasons.every((r) => D.DIVIDEND_HIDE_REASONS[r].length > 30),
    reasons.join(", "));

  // EVERY REASON THE BUILDER CAN PRODUCE IS IN THE TABLE. A reason returned
  // with no entry would render an empty note and read as "hidden for no stated
  // cause", which is the thing the registries exist to prevent.
  const produced = new Set();
  for (const sym of ["AAPL", "AZN", "GEV", "KGC", "KTOS", "TSLA"]) {
    const d = D.buildProfileDividend(fixture(sym));
    if (d.state === "hidden") produced.add(d.why.reason);
  }
  produced.add(D.buildProfileDividend(null).why.reason);
  const unregistered = [...produced].filter((r) => !reasons.includes(r));
  check("every reason the builder actually produced is registered",
    unregistered.length === 0, unregistered.join(", ") || [...produced].join(", "));

  // HIDDEN, NOT REMOVED, on the FMP side too. `lastDividend` stays on the type
  // and stays parsed: deleting it loses the record that this row ever had
  // another source, and it arrives in a payload the page fetches anyway.
  const comp = fs.readFileSync("app/components/CompanyProfile.tsx", "utf8");
  const page = fs.readFileSync("app/stock/[symbol]/page.tsx", "utf8");
  check("profile.lastDividend is still on the type and still parsed",
    /lastDividend: number \| null;/.test(comp) && /lastDividend: num\(row\.lastDividend\)/.test(page));
  check("...and nothing renders it any more",
    !/fmtMoney2\(profile\.lastDividend\)/.test(comp),
    "the row reads the filings now");
}

console.log("\n6. the component cannot reach the server module at runtime");
{
  // CompanyProfile ships in the client bundle (StockSymbolPageClient is "use
  // client"). A VALUE import from lib/server would drag secColdFetch -> Redis
  // into the browser and fail the build. `import type` erases; this asserts the
  // keyword rather than trusting it.
  const comp = fs.readFileSync("app/components/CompanyProfile.tsx", "utf8");
  const serverImports = [...comp.matchAll(/^import\s+(type\s+)?\{[^}]*\}\s+from\s+"@\/lib\/server\/[^"]+";$/gm)];
  check("every lib/server import in the component is type-only",
    serverImports.length > 0 && serverImports.every((m) => m[1]),
    serverImports.map((m) => m[0].split("\n")[0]).join(" | "));
}

console.log(
  failures === 0
    ? "\nThe Dividend row reads the filings, and says nothing the filings do not."
    : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
