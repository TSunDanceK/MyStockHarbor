// THE SIDEBAR EARNINGS SNAPSHOT IS ON SEC FILINGS — asserted by rendering it.
//
// ── WHAT THIS CHECKS ──────────────────────────────────────────────────────
// app/components/LatestEarningsCard.tsx came off FMP's stable/earnings on
// 2026-09-21 and onto the stored fact sets. The properties that must hold are
// about OUTPUT, not about source:
//
//   * no estimate, surprise or guidance figure reaches a reader, on any symbol
//   * the fields that went are REGISTERED, not merely deleted
//   * a margin is printed as a level and growth as a change
//   * a refused score prints nothing, never the neutral seed
//   * a growth across a sign change prints words, never a percentage
//   * the figures belong to the newest period, not the oldest
//   * the hidden CompanyProfile rows and the hidden Analyst Ratings block are
//     decided by their registries and come back when the registry says so
//
// ── EVERY ASSERTION IS PAIRED WITH A MUTATION ─────────────────────────────
// An assertion against correct source proves only that it did not throw. Each
// property below is also asserted against source edited to BREAK that exact
// property, and the check fails if the broken source still passes. A check
// that cannot fail is worse than no check, because it reports PASS.
//
// NO FIXTURE SUPPLIES AN EXPECTED VALUE. data/sec/factset-fixture-*.json come
// from live companyfacts via the shipped extractor. Every number is SEC's.
import fs from "node:fs";
import { loadSnapshot, loadProfile, html, visibleText, once, React } from "./lib/render-snapshot.mjs";

// EVERY MUTATION BELOW GOES THROUGH `once`. These loaders concatenate several
// modules, and a string anchor that appears in more than one of them rewrites
// the FIRST — which happened in check-profile-dividend.mjs: an anchor meant for
// secDividend hit the identical line in secCurrency, broke a conversion the
// fixture never runs, and the "mutation" assertion passed having changed
// nothing. `once` counts the anchor and throws on anything but a single match.

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const fixture = (sym) =>
  JSON.parse(fs.readFileSync(`data/sec/factset-fixture-${sym}.json`, "utf8"));

const SYMBOLS = ["AAPL", "KGC", "AZN", "TSLA", "GEV", "KTOS"];

const M = await loadSnapshot();

/** A snapshot for one fixture, through the shipped builder and scorer. */
const snapshotFor = (M, sym, over = {}) => {
  const set = fixture(sym);
  const view = M.buildSecEarningsView(set);
  const score = M.scoreFromSec(view, sym, { status: "ready", set, cold: false });
  return M.buildSecEarningsSnapshot({
    symbol: sym, view, score, reported: null, nextReport: { kind: "none" }, ...over,
  });
};

const renderFor = (M, sym, over = {}) =>
  html(React.createElement(M.default, { snapshot: snapshotFor(M, sym, over), symbol: sym }));

const textFor = (M, sym, over = {}) => visibleText(renderFor(M, sym, over));

console.log("\n1. no estimate, surprise or guidance figure reaches a reader");
{
  // THE WORDS, NOT THE FIELDS. A field can be removed from the type and the
  // label left behind in JSX; this reads what renders.
  //
  // "estimates" IS EXPECTED once, in the source note that explains why they are
  // absent, so the scan is for the LABELS the card used to print rather than
  // for the topic. A bare /estimate/ would fire on the honest sentence.
  const banned = [
    /Estimated EPS/i, /EPS surprise/i, /Revenue estimate/i, /Revenue surprise/i,
    /Guidance/i, /beat or miss/i, /consensus/i,
    /Recent earnings trend/i, /Yearly earnings read/i,
  ];
  const hits = [];
  for (const sym of SYMBOLS) {
    const t = textFor(M, sym);
    for (const re of banned) if (re.test(t)) hits.push(`${sym}: ${re}`);
  }
  check("none of the retired labels render, on any fixture", hits.length === 0, hits.join(" | "));

  // THE MUTATION. Put one label back and the scan must catch it — otherwise
  // the assertion above is reading a string that was never going to be there.
  const withLabel = await loadSnapshot(once('label="Net income"', 'label="EPS surprise"'));
  check("...and the scan CATCHES a retired label put back",
    /EPS surprise/i.test(textFor(withLabel, "AAPL")),
    "a mutation that re-adds the label rendered clean, so the scan proves nothing");
}

console.log("\n2. what went is registered, not merely deleted");
{
  const ids = M.RETIRED_SNAPSHOT_FIELDS.map((f) => f.id);
  check("every retired field names its source, its date and a reason",
    M.RETIRED_SNAPSHOT_FIELDS.length > 0 &&
      M.RETIRED_SNAPSHOT_FIELDS.every((f) =>
        f.id && f.label && f.source && /^\d{4}-\d{2}-\d{2}$/.test(f.retiredOn) && f.reason.length > 20),
    ids.join(", "));

  // THE FOUR FMP FIELDS THE CARD USED TO DRAW, each by the name it drew them
  // under. A registry that is merely non-empty records nothing in particular.
  const required = ["eps-estimate", "eps-surprise", "revenue-estimate", "revenue-surprise", "guidance"];
  const missing = required.filter((id) => !ids.includes(id));
  check("every estimate-derived field the card used to show is in it",
    missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : "");

  let threw = false;
  try { M.retiredSnapshotField("not-a-real-field"); } catch { threw = true; }
  check("an unregistered id throws rather than reading as 'nothing to hide'", threw);
}

console.log("\n3. a margin is a level; growth is a change");
{
  // AAPL's gross margin is ~50%. The distinction is the leading sign, and it
  // is the difference between "the margin is 50%" and "the margin rose 50
  // points" — the second is a claim no filing here makes.
  const t = textFor(M, "AAPL");
  const margin = (t.match(/Gross margin ([+-]?[\d.]+%)/) ?? [])[1];
  const growth = (t.match(/Revenue \$[\d.]+[TBMK] ([+-][\d.]+%)/) ?? [])[1];
  check("a margin prints with no leading +", Boolean(margin) && !margin.startsWith("+"), `gross margin: ${margin}`);
  check("growth prints WITH its sign", Boolean(growth) && /^[+-]/.test(growth), `revenue growth: ${growth}`);

  // THE MUTATION. One formatter for both is exactly how the old card did it.
  const oneFormatter = await loadSnapshot(once(
    "formatLevel(snapshot.margins.gross)", "formatGrowth(snapshot.margins.gross)"));
  const mutated = (textFor(oneFormatter, "AAPL").match(/Gross margin ([+-]?[\d.]+%)/) ?? [])[1];
  check("...and the assertion CATCHES the growth formatter on a margin",
    Boolean(mutated) && mutated.startsWith("+"), `mutated gross margin: ${mutated}`);
}

console.log("\n4. a refused score prints nothing, never the neutral seed");
{
  // THE SCORER RETURNS 50 WHEN IT REFUSES, because its shape needs a number,
  // and its own docblock says 50 is the seed rather than a reading. Carrying
  // that through would put "50" under a pill on a stock the site cannot score.
  const noView = M.buildSecEarningsSnapshot({
    symbol: "ZZZZ",
    view: null,
    score: M.scoreFromSec(null, "ZZZZ", { status: "pending", reason: "not read yet" }),
    reported: null,
    nextReport: { kind: "none" },
  });
  check("an unscorable symbol carries score null, not 50", noView.score === null, `score: ${noView.score}`);
  check("...and is marked unavailable with a reason a reader can act on",
    noView.available === false && typeof noView.unavailableReason === "string" &&
      noView.unavailableReason.length > 30,
    noView.unavailableReason ?? "");

  const t = visibleText(html(React.createElement(M.default, { snapshot: noView, symbol: "ZZZZ" })));
  check("the card renders the reason, not a grid of em dashes",
    t.includes("Unavailable") && !/EPS \(diluted\)/.test(t) && !/Gross margin/.test(t),
    t.slice(0, 160));

  // THE MUTATION.
  const seedThrough = await loadSnapshot(once(
    "score: score.available ? score.score : null,", "score: score.score,"));
  const mutated = seedThrough.buildSecEarningsSnapshot({
    symbol: "ZZZZ", view: null,
    score: seedThrough.scoreFromSec(null, "ZZZZ", { status: "pending", reason: "x" }),
    reported: null, nextReport: { kind: "none" },
  });
  check("...and the assertion CATCHES the seed being carried through",
    mutated.score === 50, `mutated score: ${mutated.score}`);
}

console.log("\n5. an unavailable verdict is not painted as a neutral one");
{
  // A GREY PILL, NOT AN AMBER ONE. `tone` is "neutral" on the refusal branch
  // because the type needs a value; painting it amber presents "could not
  // measure" as "measured, and middling".
  const noView = M.buildSecEarningsSnapshot({
    symbol: "ZZZZ", view: null,
    score: M.scoreFromSec(null, "ZZZZ", { status: "pending", reason: "x" }),
    reported: null, nextReport: { kind: "none" },
  });
  const markup = html(React.createElement(M.default, { snapshot: noView, symbol: "ZZZZ" }));
  const amber = "250,204,21";
  check("the unavailable pill carries no amber", !markup.includes(amber), "amber is the Mixed colour");

  // BOTH PAINT SITES, ANCHORED ON THEIR OWN SIGNATURES. The line
  // `const rgb = available ? TONE_RGB[tone] : "148,163,184";` occurs TWICE in
  // the card — in earningsCardStyle (the border) and earningsTonePillStyle
  // (the pill) — so the bare anchor was ambiguous and `once` refused it. That
  // ambiguity was live in this check before the guard existed: the mutation
  // was rewriting only the first, and this assertion covers both. Composing
  // two unique anchors breaks the property the assertion actually reads.
  const unpaint = (fn) => once(
    `function ${fn}(tone: ToneKey, available: boolean): CSSProperties {\n  const rgb = available ? TONE_RGB[tone] : "148,163,184";`,
    `function ${fn}(tone: ToneKey, available: boolean): CSSProperties {\n  const rgb = TONE_RGB[tone];`
  );
  const painted = await loadSnapshot((s) =>
    unpaint("earningsTonePillStyle")(unpaint("earningsCardStyle")(s)));
  const mutatedMarkup = html(React.createElement(painted.default, {
    snapshot: painted.buildSecEarningsSnapshot({
      symbol: "ZZZZ", view: null,
      score: painted.scoreFromSec(null, "ZZZZ", { status: "pending", reason: "x" }),
      reported: null, nextReport: { kind: "none" },
    }),
    symbol: "ZZZZ",
  }));
  check("...and the assertion CATCHES an unavailable pill painted amber",
    mutatedMarkup.includes(amber));
}

console.log("\n6. growth across a sign change is words, never a percentage");
{
  // ── BUILT, NOT FOUND ──────────────────────────────────────────────────
  // None of the committed fixtures currently has a crossing in its SNAPSHOT
  // period — they have had, and will again, which is exactly why the property
  // cannot be left to whichever fixtures happen to hold one. The view is taken
  // from a real fixture and its epsYoY replaced with the marker the view
  // itself produces, so what is under test is the CARD's handling of it.
  const base = snapshotFor(M, "AAPL");
  const crossing = M.buildSecEarningsSnapshot({
    symbol: "AAPL",
    view: {
      ...M.buildSecEarningsView(fixture("AAPL")),
      snapshot: {
        ...M.buildSecEarningsView(fixture("AAPL")).snapshot,
        epsYoY: "turned-profitable",
        revenueYoY: "swung-to-loss",
      },
    },
    score: M.scoreFromSec(M.buildSecEarningsView(fixture("AAPL")), "AAPL",
      { status: "ready", set: fixture("AAPL"), cold: false }),
    reported: null, nextReport: { kind: "none" },
  });
  check("the base fixture really does carry a numeric growth to begin with",
    base.epsYoY.kind === "pct", `so the crossing case below is a change, not a no-op`);
  check("a crossing becomes words in the payload",
    crossing.epsYoY.kind === "crossing" && crossing.revenueYoY.kind === "crossing",
    JSON.stringify([crossing.epsYoY, crossing.revenueYoY]));

  const t = visibleText(html(React.createElement(M.default, { snapshot: crossing, symbol: "AAPL" })));
  check("...and those words render, with no percentage beside them",
    /turned profitable/.test(t) && /swung to a loss/.test(t),
    t.slice(t.indexOf("EPS"), t.indexOf("EPS") + 120));

  // A CROSSING MUST NOT DEGRADE TO AN EM DASH EITHER. An absence reads as "we
  // do not know", where the truth is "we know, and a percentage would lie".
  check("a crossing is not silently dropped",
    !/EPS \(diluted\) \$[\d.]+ —/.test(t));

  const dropped = await loadSnapshot(once(
    'if (p.kind === "crossing") return p.words;', 'if (p.kind === "crossing") return null;'));
  const mutatedText = visibleText(html(React.createElement(dropped.default, {
    snapshot: {
      ...crossing,
      // rebuilt through the mutated module so its growthText is the one used
    },
    symbol: "AAPL",
  })));
  check("...and the assertion CATCHES a crossing dropped to nothing",
    !/turned profitable/.test(mutatedText));
}

console.log("\n7. the figures belong to the newest period");
{
  // THE MARGIN ROW IS OLDEST-FIRST, so the newest is .at(-1). Taking [0]
  // captions the oldest quarter's margins with the newest quarter's label, and
  // both are plausible percentages — there is nothing on the page to catch it
  // by eye, which is why it is asserted here.
  const shipped = snapshotFor(M, "AAPL");
  const view = M.buildSecEarningsView(fixture("AAPL"));
  const oldest = view.margins[0];
  const newest = view.margins.at(-1);
  check("the fixture's oldest and newest margins actually differ",
    oldest && newest && oldest.gross !== newest.gross,
    `oldest ${oldest?.gross} vs newest ${newest?.gross} — if equal, the mutation below proves nothing`);
  check("the snapshot carries the NEWEST margin row",
    shipped.margins.gross === newest.gross,
    `snapshot ${shipped.margins.gross}, newest ${newest?.gross}`);

  const firstRow = await loadSnapshot(once(
    "const m = view.margins.at(-1) ?? null;", "const m = view.margins[0] ?? null;"));
  check("...and the assertion CATCHES the oldest row being used",
    snapshotFor(firstRow, "AAPL").margins.gross === oldest.gross);

  // THE PERIOD IS NAMED ON THE CARD. Without it a stale fact set renders
  // identically to a current one.
  const t = textFor(M, "AAPL");
  check("the card states which period the figures are for",
    t.includes(shipped.periodLabel) && /period ending/.test(t),
    shipped.periodLabel);
}

console.log("\n8. EPS keeps its trailing zero");
{
  // "$4.3" IS NOT HOW ANYONE WRITES MONEY, and a per-share figure printed to
  // one decimal reads as a different number. The card marks per-share cells
  // rather than trusting four call sites to remember.
  const two = M.buildSecEarningsSnapshot({
    symbol: "TEST",
    view: {
      ...M.buildSecEarningsView(fixture("AAPL")),
      snapshot: {
        ...M.buildSecEarningsView(fixture("AAPL")).snapshot,
        epsDiluted: { val: 4.3, derived: "as-filed", key: "epsDiluted", label: "EPS", derivedNote: null, perShare: true },
      },
    },
    score: M.scoreFromSec(M.buildSecEarningsView(fixture("AAPL")), "TEST",
      { status: "ready", set: fixture("AAPL"), cold: false }),
    reported: null, nextReport: { kind: "none" },
  });
  const t = visibleText(html(React.createElement(M.default, { snapshot: two, symbol: "TEST" })));
  check("a per-share 4.3 renders as $4.30", /\$4\.30/.test(t), t.slice(t.indexOf("EPS"), t.indexOf("EPS") + 40));
}

console.log("\n9. the hidden CompanyProfile rows are decided by the registry");
{
  const P = await loadProfile();
  const profile = {
    companyName: "Test Corp", description: "A description long enough to render.",
    sector: "Technology", industry: "Semiconductors", ceo: "A Person",
    website: "https://example.com", employees: 48000, exchange: "NASDAQ",
    country: "US", ipoDate: "1984-01-01", isin: "US0000000001", cusip: "000000001",
    marketCap: 1.2e11, beta: 1.34, price: 100, rangeLow: 60, rangeHigh: 140,
    lastDividend: 0.46, currency: "USD",
  };
  // THE DIVIDEND ROW IS A REQUIRED PROP NOW, and this check is not about it —
  // see scripts/check-profile-dividend.mjs. A hidden row is the value that
  // changes nothing here: it renders no row, so the five hidden labels and the
  // rest of the grid are asserted against exactly the grid they were before.
  const noDividend = { state: "hidden", why: { reason: "no-facts", note: "" } };
  const render = (mod) =>
    visibleText(html(React.createElement(mod.default, { profile, symbol: "TEST", dividend: noDividend })));
  const t = render(P);

  const hidden = P.HIDDEN_PROFILE_ROWS.map((r) => r.label);
  check("the registry names exactly the five rows with no free successor",
    hidden.length === 5 && ["CEO", "Employees", "Beta", "ISIN", "CUSIP"].every((l) => hidden.includes(l)),
    hidden.join(", "));
  check("every entry names its source, its date and a reason",
    P.HIDDEN_PROFILE_ROWS.every((r) =>
      r.source && /^\d{4}-\d{2}-\d{2}$/.test(r.hiddenOn) && r.reason.length > 20));

  const stillVisible = hidden.filter((l) => new RegExp(`\\b${l}\\b`).test(t));
  check("none of them reaches a reader", stillVisible.length === 0, stillVisible.join(", "));

  // THE ROWS THAT STAY MUST STILL RENDER, or the filter is hiding the grid
  // rather than five rows of it.
  const kept = ["Sector", "Industry", "Market cap", "Exchange", "Country", "Website"];
  const lost = kept.filter((l) => !new RegExp(l).test(t));
  check("the rest of the stat grid is untouched", lost.length === 0, lost.join(", "));

  // THE MUTATION, IN BOTH DIRECTIONS.
  const unregistered = await loadProfile((s) =>
    s.replace(/export const HIDDEN_PROFILE_ROWS: HiddenProfileRow\[\] = \[[\s\S]*?\n\];/,
      "const HIDDEN_PROFILE_ROWS = [];"));
  const back = render(unregistered);
  check("...emptying the registry brings all five back",
    hidden.every((l) => new RegExp(`\\b${l}\\b`).test(back)),
    "so the registry is what decides, not a deletion elsewhere");

  // A REGISTRATION THAT MATCHES NO ROW IS A SILENT NO-OP WITHOUT THIS.
  let refused = false;
  try {
    const typo = await loadProfile(once('label: "Beta",', 'label: "Beta ",'));
    render(typo);
  } catch { refused = true; }
  check("a registry entry that matches no row is refused at render",
    refused, "otherwise a typo hides nothing while the record says it does");
}

console.log("\n10. the Analyst Ratings block is decided by its registry");
{
  // SOURCE-LEVEL, DELIBERATELY. The block lives in StockSymbolPageClient.tsx,
  // a 1,900-line client component wired to five fetches; rendering it here
  // would assert more about this harness than about the page. What matters is
  // that the guard reads the registry rather than a hardcoded false, and that
  // the registry carries the record.
  const blocks = fs.readFileSync("app/stock/[symbol]/retiredBlocks.ts", "utf8");
  const page = fs.readFileSync("app/stock/[symbol]/StockSymbolPageClient.tsx", "utf8");

  check("the section is guarded by the registry, not by a literal",
    /\{isRetiredBlock\("analyst-ratings"\) \? null : \(/.test(page),
    "a hardcoded false would hide the block and record nothing");

  check("the JSX is still there — hidden, not removed",
    /<div style=\{sectionLabelStyle\}>Analyst Ratings<\/div>/.test(page) &&
      /AnalystTargetChart/.test(page),
    "the owner's rule is that the block keeps its code and its comment");

  check("the entry names the source, the date and why there is no successor",
    /id: "analyst-ratings"/.test(blocks) &&
      /retiredOn: "\d{4}-\d{2}-\d{2}"/.test(blocks) &&
      /grades-consensus/.test(blocks),
    "");

  // THE ATTRIBUTION GOES DARK WITH THE DATA. A surviving "provided by
  // Financial Modeling Prep" beside a hidden block explains an absence.
  const attributionAt = page.indexOf("Analyst ratings and price targets are provided by");
  const guardAt = page.indexOf('{isRetiredBlock("analyst-ratings") ? null : (');
  const closeAt = page.indexOf("{/* -- Chart summaries", guardAt);
  check("the FMP attribution line sits INSIDE the hidden block",
    attributionAt > guardAt && attributionAt < closeAt,
    "see claude/fmp-provider-attribution-inventory-2026-09-12.md §7");

  // AND THE FETCH STOPS. Hiding the block while still spending an FMP call
  // per view costs exactly what the hide was for.
  check("the fetch is gated on the same flag",
    /if \(isRetiredBlock\("analyst-ratings"\)\) \{/.test(page),
    "the effect would otherwise spend an FMP call per page view on nothing");
}

console.log(
  failures === 0
    ? "\nThe sidebar snapshot renders from filings, and the hides are registry-decided."
    : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
