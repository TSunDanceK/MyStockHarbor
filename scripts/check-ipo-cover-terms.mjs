// Behavioural fixtures for the prospectus cover parser. NO NETWORK.
//
// WHY THIS DID NOT EXIST UNTIL NOW, AND WHY IT HAD TO. These regexes lived
// inside scripts/ipo-seed.mjs, a relay task, so the only way to exercise them
// was to dispatch a run and read 700 filers' output. They now live in
// lib/server/ipoCoverTerms.ts because the daily refresh needs them too -- and a
// parser two jobs share is a parser that has to be pinned, or the next person
// tightening one regex has no way to find out what they broke.
//
// EVERY CASE BELOW IS ONE THE PARSER ACTUALLY GOT WRONG, not an invented one.
// The bugs it has already had all share a shape: it returned a NUMBER, the
// number was plausible, and a price range that is wrong looks exactly like a
// price range that is right (claude/traps/a-filter-that-matches-nothing-looks-
// correct.md, addendum).
//
//   node scripts/check-ipo-cover-terms.mjs
import "./lib/register-ts-here.mjs";

const { parseCoverTerms, stripHtml, TERMS_BEARING_FORM } = await import(
  "../lib/server/ipoCoverTerms.ts"
);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\nipoCoverTerms — null beats a guess\n");

// ── The straightforward range ────────────────────────────────────────────
{
  const t = parseCoverTerms(
    "We are offering 10,000,000 shares of our common stock. It is currently " +
      "estimated that the initial public offering price per share will be between " +
      "$14.00 and $16.00 per share.",
    "7372"
  );
  check(
    "a normal S-1/A range is read",
    t.priceRangeLow === 14 && t.priceRangeHigh === 16,
    `got ${t.priceRangeLow}-${t.priceRangeHigh}`
  );
  check(
    "and the share count with it",
    t.sharesOffered === 10_000_000,
    `got ${t.sharesOffered} — "We are offering 10,000,000 shares of our common stock"`
  );
}

// ── THE APTEVO CASE. The one that produced a $1.42 BILLION deal size. ────
{
  // Both ends inside the $1-$500 plausibility bound, and 36x apart, because the
  // two numbers came from different sentences.
  const t = parseCoverTerms("$11.70 to $428.40 per share", "2836");
  check(
    "a range wider than 3x is REFUSED, not published",
    t.priceRangeLow === null && t.priceRangeHigh === null,
    `got ${t.priceRangeLow}-${t.priceRangeHigh} — the first seed run shipped Aptevo at ` +
      `$11.70-$428.40, every value inside the bound, and a computed deal size of ` +
      `$1.42 BILLION for a microcap follow-on. Underwriters do not market a 36x spread`
  );
  // NEGATIVE CONTROL: a wide-but-real range must survive. 3x is the line.
  const ok = parseCoverTerms("$5.00 to $15.00 per share", "2836");
  check(
    "and a 3x range is still accepted",
    ok.priceRangeLow === 5 && ok.priceRangeHigh === 15,
    "a ratio test tight enough to reject real deals would be the mirror failure"
  );
}

// ── THE PAR VALUE. The bug the plausibility floor exists for. ────────────
//
// THE TEXT HAS TO MATCH A PRICE PHRASE OR THE FLOOR IS NOT WHAT IS BEING
// TESTED. A first version of this fixture used "par value $0.00001 per share",
// which no phrase anchor matches at all -- so it returned null whatever the
// bound was, and passed with the plausibility test deleted. An assertion that
// holds for the wrong reason is the file's own subject, so it is written the
// way that fails when the floor goes.
{
  const t = parseCoverTerms("The public offering price is $0.00001 per share.", "7372");
  check(
    "a sub-$1 figure that DOES match a price phrase is refused",
    t.priceRangeLow === null,
    `got ${t.priceRangeLow} — "$0.00001" is a par value, and it is what the old parser ` +
      `reported as an offer price. A dash in the column is the honest answer`
  );
  const high = parseCoverTerms("The public offering price is $9999.00 per share.", "7372");
  check(
    "and so is a figure above the $500 ceiling",
    high.priceRangeLow === null,
    `got ${high.priceRangeLow} — a share count or a dollar total caught by a price ` +
      `pattern, not a per-share price`
  );
  const real = parseCoverTerms("The public offering price is $16.00 per share.", "7372");
  check(
    "while a price inside the bound is read",
    real.priceRangeLow === 16,
    "a floor tight enough to reject real prices would be the mirror failure"
  );
}

// ── THE SPAC UNIT, and the warrant strike beside it ──────────────────────
{
  const spac = parseCoverTerms(
    "This is an initial public offering of units of our blank check company. " +
      "Each unit has an offering price of $10.00 and consists of one share and " +
      "one-half of one redeemable warrant exercisable at $11.50 per share. The " +
      "proceeds will be held in a trust account pending a business combination.",
    "6770"
  );
  check(
    "a SPAC unit reads $10.00, not the $11.50 warrant strike",
    spac.priceRangeLow === 10 && spac.priceRangeHigh === 10,
    `got ${spac.priceRangeLow}-${spac.priceRangeHigh} — the warrant exercise price was ` +
      `3 of the first parser's 8 wrong answers`
  );
}
{
  // The SIC is authoritative, but a filer whose submissions read failed has
  // none -- so the body phrases have to carry it. TWO of three, not one.
  const noSic = parseCoverTerms(
    "Our blank check company will complete an initial business combination. " +
      "Each unit has a price of $10.00. Funds are held in a trust account.",
    null
  );
  check(
    "a SPAC with no SIC is still recognised from the body",
    noSic.priceRangeLow === 10,
    "a failed submissions read must not turn a SPAC into a priceless row"
  );
  const notSpac = parseCoverTerms(
    "Following this offering we may pursue a business combination with a " +
      "complementary company. Our shares will trade on Nasdaq.",
    "7372"
  );
  check(
    "but one loose phrase does NOT make an operating company a SPAC",
    notSpac.priceRangeLow === null,
    '"business combination" alone appears in plenty of operating-company risk ' +
      "factors; requiring two of three is what keeps that from inventing a $10 price"
  );
}

// ── The final prospectus: one price, not a range ─────────────────────────
{
  const t = parseCoverTerms("The initial public offering price is $16.00 per share.", "7372");
  check(
    "a 424B4's single price fills both ends",
    t.priceRangeLow === 16 && t.priceRangeHigh === 16,
    "the range columns are what the page renders; a priced deal has one number and " +
      "both ends are it"
  );
}

// ── THE SHARE COUNT. Measured over 94 live covers, relay 35583959865. ────
//
// The rule this replaced answered on 38 of those and was WRONG on 27 — it was
// unanchored, so it took the first "<n> shares of common stock" anywhere in
// 80,000 characters, and a cover says that phrase about several different
// facts. Every fixture below is a real sentence from a named filing in that
// run, not an invented one.
console.log("");
{
  // LiPower New Energy F-1/A, 2026-09-03.
  const t = parseCoverTerms(
    "THE OFFERING Issuer LiPower New Energy Holding Limited Shares Offered by " +
      "the Issuer We are offering 5,000,000 shares of our ordinary shares.",
    "3690"
  );
  check("\"We are offering N shares\" is read", t.sharesOffered === 5_000_000, `got ${t.sharesOffered}`);
}
{
  // Lannister Mining F-1/A, 2026-09-17 — the SPAC-style cover header, where the
  // count appears with no verb at all.
  const t = parseCoverTerms(
    "PRELIMINARY PROSPECTUS SUBJECT TO COMPLETION DATED SEPTEMBER 16, 2026 " +
      "$15,000,000 Units 3,000,000 Units Each Unit consists of one share.",
    "6770"
  );
  check("the unit cover header is read", t.sharesOffered === 3_000_000, `got ${t.sharesOffered}`);
}
{
  // Advance JV Group 424B4, 2026-09-01.
  const t = parseCoverTerms(
    "We have determined the offering price of the 2,500,000 shares to be sold.",
    "1540"
  );
  check("\"the offering price of the N shares\" is read", t.sharesOffered === 2_500_000, `got ${t.sharesOffered}`);
}

// ── THE THREE WRONG SENTENCES, each one a live row before this fix ────────
{
  // ADARx Pharmaceuticals S-1/A — the number that reached the live page.
  const t = parseCoverTerms(
    "Immediately following this offering there will be 88,250,216 shares of our " +
      "common stock outstanding.",
    "2836"
  );
  check(
    "a POST-OFFERING total is refused",
    t.sharesOffered === null,
    `got ${t.sharesOffered} — ADARx rendered 88,250,216 as its offering size; it is ` +
      `the share count after the deal, and it feeds dealSize`
  );
}
{
  // CYABRA S-1/A and Aura Consolidated S-1/A — resale registrations.
  const cyabra = parseCoverTerms(
    "This prospectus relates to the offer and sale from time to time by the " +
      "selling shareholders identified in this prospectus of up to an aggregate " +
      "of 21,645,176 shares of our common stock.",
    "7372"
  );
  check(
    "a SELLING-SHAREHOLDER resale count is refused",
    cyabra.sharesOffered === null,
    `got ${cyabra.sharesOffered} — a resale registration is not an offering by the issuer`
  );
  const aura = parseCoverTerms(
    "We are registering the offer and sale from time to time of up to " +
      "143,277,908 shares of common stock.",
    "7372"
  );
  check(
    "and so is \"we are registering ... from time to time\"",
    aura.sharesOffered === null,
    `got ${aura.sharesOffered} — "we are registering" is a resale shelf, not an offering, ` +
      `and it survives an offering-verb anchor`
  );
}
{
  // Aptevo Therapeutics 424B4 — warrant shares.
  const t = parseCoverTerms(
    "common stock purchase warrants to purchase up to 4,308,540 shares issuable " +
      "upon exercise thereof.",
    "2834"
  );
  check(
    "shares ISSUABLE UPON EXERCISE of warrants are refused",
    t.sharesOffered === null,
    `got ${t.sharesOffered} — warrant shares are not the offering`
  );
}
{
  // THE DISQUALIFIER MUST READ BOTH DIRECTIONS. "resale" precedes the number;
  // "outstanding" follows it. A trailing-only window catches half of them and
  // reports a clean result on the rest.
  const before = parseCoverTerms(
    "This prospectus relates to the resale of shares. We are offering 9,000,000 " +
      "shares of common stock.",
    "7372"
  );
  check(
    "a disqualifier BEFORE the number still refuses it",
    before.sharesOffered === null,
    `got ${before.sharesOffered} — "resale" sits ahead of the count on every such cover`
  );
}
{
  // NEGATIVE CONTROL FOR THE WHOLE SECTION. A rule that refuses everything
  // would pass every assertion above.
  const t = parseCoverTerms(
    "We are offering 12,500,000 shares of our common stock. The initial public " +
      "offering price is $18.00 per share.",
    "7372"
  );
  check(
    "a clean offering sentence is still read",
    t.sharesOffered === 12_500_000 && t.priceRangeLow === 18,
    `got ${t.sharesOffered} @ ${t.priceRangeLow} — without this, "return null always" ` +
      `passes every refusal assertion above`
  );
}
{
  // ── THE ANCHOR'S OWN CONTROL, AND IT WAS MISSING ───────────────────────
  // Every refusal above is also caught by the DISQUALIFYING_CONTEXT list, so
  // re-introducing the old unanchored pattern broke NONE of them — verified by
  // doing exactly that and watching the suite stay green. A guard the fixtures
  // cannot fail is a guard nobody has shown to work.
  //
  // This sentence carries no disqualifying word at all. It is ordinary
  // authorised-capital language, it is not an offering, and only the anchor
  // refuses it.
  const t = parseCoverTerms(
    "Our amended certificate of incorporation authorizes the issuance of " +
      "200,000,000 shares of common stock, par value $0.0001 per share.",
    "7372"
  );
  check(
    "authorised capital is refused by the ANCHOR, with no disqualifier to help",
    t.sharesOffered === null,
    `got ${t.sharesOffered} — this is the fixture that fails if the old unanchored ` +
      `"N shares of common stock" pattern is ever put back`
  );
}
{
  // ENTRATA S-1/A: "customers that have 1,000 units or more on our Operating
  // System". Five digits including the comma, and the old rule's second branch
  // was one word away from taking it.
  const t = parseCoverTerms(
    "We sort our customers from highest to lowest ARPU and then only select " +
      "customers that have 1,000 units or more on our Operating System.",
    "7372"
  );
  check(
    "a business metric that happens to say \"units\" is not an offering size",
    t.sharesOffered === null,
    `got ${t.sharesOffered}`
  );
}

// ── Exchange and symbol ──────────────────────────────────────────────────
{
  const t = parseCoverTerms(
    'We have applied to list on the Nasdaq Global Select Market under the symbol "ACME".',
    "7372"
  );
  check(
    "the LONGEST exchange spelling wins",
    t.exchange === "Nasdaq Global Select Market",
    `got ${t.exchange} — the alternation lists "Nasdaq" too, and a shorter match first ` +
      `would report every Nasdaq tier as the bare exchange`
  );
  check("the proposed symbol is read", t.proposedSymbol === "ACME", `got ${t.proposedSymbol}`);
}
{
  const t = parseCoverTerms("We have applied to list on the New York Stock Exchange.", "7372");
  check("NYSE's full name is matched", t.exchange === "New York Stock Exchange", `got ${t.exchange}`);
}

// ── Nothing there ────────────────────────────────────────────────────────
{
  const t = parseCoverTerms("This prospectus contains no pricing information whatsoever.", null);
  check(
    "a cover with no terms returns all nulls rather than zeros",
    t.priceRangeLow === null &&
      t.priceRangeHigh === null &&
      t.sharesOffered === null &&
      t.exchange === null &&
      t.proposedSymbol === null,
    "hasTerms() in ipoSecSource reads these nulls to decide the row is a bare " +
      "registration; a 0 would pass that test and render an empty row"
  );
}

// ── stripHtml ────────────────────────────────────────────────────────────
console.log("");
{
  const html =
    "<html><head><style>.x{content:'$99.00 per share'}</style>" +
    "<script>var p = '$88.00 per share';</script></head><body>" +
    "<table><tr><td>between</td><td>$14.00</td><td>and</td><td>$16.00</td>" +
    "<td>per&nbsp;share</td></tr></table></body></html>";
  const t = parseCoverTerms(stripHtml(html), "7372");
  check(
    "the price is found across table cells",
    t.priceRangeLow === 14 && t.priceRangeHigh === 16,
    `got ${t.priceRangeLow}-${t.priceRangeHigh} — a prospectus cover is a table, so the ` +
      `phrase anchors only work if the tags collapse to single spaces`
  );
  check(
    "script and style contents are NOT read as cover text",
    t.priceRangeLow !== 99 && t.priceRangeLow !== 88,
    "a stylesheet or a script tag is not the prospectus"
  );
}

// ── The form gate ────────────────────────────────────────────────────────
console.log("");
{
  check(
    "the terms-bearing forms are exactly the four that carry a price",
    ["424B4", "424B1", "S-1/A", "F-1/A"].every((f) => TERMS_BEARING_FORM.test(f)),
    "these are the covers worth two requests each"
  );
  check(
    "and 8-A12B, RW, AW and the bare S-1 are not",
    !["8-A12B", "RW", "AW", "S-1", "F-1"].some((f) => TERMS_BEARING_FORM.test(f)),
    "8-A12B/RW/AW decide membership and carry no price; a bare S-1 predates terms, " +
      "which is why the upper table keys off the AMENDMENT"
  );
}

console.log(
  failures === 0
    ? "\nEvery case the parser got wrong before is pinned, and every control holds.\n"
    : `\n${failures} fixture(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
