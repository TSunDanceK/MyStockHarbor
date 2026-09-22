// THE DESCRIPTION LOCATOR AND CLEANER — the owner's rules, asserted by running them.
//
// PR 3 (#518). lib/server/secDescription.ts turns an annual report into the
// About block's paragraph; data/sec/descriptions.json is its output over every
// profiled symbol. Each rule below is exercised on text shaped like the filing
// that motivated it, and paired with a mutation that removes it (a check that
// cannot fail reports PASS and proves nothing):
//
//   1. 10-K: the Item 1 heading before a real Item 1A, not the TOC's, and not a
//      cautionary-note line that begins "Item 1A …" (ONDS).
//   2. 20-F: Item 4 first, then its Business Overview, split or unlettered
//      (ABEV); none inside Item 4 means no description (RYAAY).
//   3. Name lists in brackets are stripped; a single abbreviation stays.
//   4. A second paragraph must start like a sentence — capital, or a camel-case
//      brand ("iPhone") — and not continue a paragraph cut mid-sentence (KTOS).
//   5. After a name list or definition is stripped, a later paragraph opening
//      with a bare fragment of the company name is dropped (GS "Group Inc.").
//   6. A leading one-line slogan is dropped (RKLB); no space before ®/™.
//   6e. Owner review of the full file: pointer sentences (See Note, Item 7,
//      on page 9…), running page headers, "referred to herein as" name lists,
//      par-value / ticker-symbol sentences, and words split by a stray space.
//   7. Cross-references and MD&A are rejected, not rendered.
//   8. The committed file: every row within the length rules, no FMP text.
import fs from "node:fs";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";
import { once } from "./lib/render-snapshot.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const SRC = readCodeOnly("lib/server/secDescription.ts");
const load = (mutate = (s) => s) => lift(mutate(SRC));
const D = await load();
/** The rendered text, or "" when the cleaner refused — so a mutation can be read either way. */
const txt = (r) => (r.ok ? r.text : "");

const filler = (w) => `${w} designs and sells products to industrial and government customers through a large distribution network. `.repeat(20);

console.log("\n1. 10-K Item 1: the section, not the TOC or a cautionary-note line");
{
  const doc = [
    "Part I", "Item 1.", "Business", "1", "Item 1B.", "Unresolved Staff Comments", "41",
    "CAUTIONARY NOTE",
    // ONDS: ~1,900 characters of forward-looking-statement text, then a
    // WRAPPED line that happens to begin "Item 1A".
    "Forward-looking statements appear throughout this report, including under Management's Discussion. ".repeat(20),
    "Item 1A “Risk Factors,” and Item 7 “Management’s Discussion and Analysis of Financial Condition and Results of",
    "Operations.” Forward-looking statements generally can be identified by words such as anticipate.",
    "PART I", "Item 1. Business", "Ondas Holdings is a leading provider of autonomous systems. " + filler("Ondas"),
    "Item 1A. Risk Factors", "risky",
  ].join("\n");
  const loc = D.locateSection(doc, "10-K");
  check("the Item 1 before the real Item 1A is taken", loc.found && loc.body.startsWith("Ondas Holdings is a leading provider"));
  // The old matcher: a line that merely BEGINS "Item 1A" ends Item 1.
  const prefix = await load(once(
    "(i) => L[i].key.length <= HEADING_KEY_MAX && ITEM1_END.test(L[i].key)",
    "(i) => /^item(1a|1b|2)/.test(L[i].key)"
  ));
  const bad = prefix.locateSection(doc, "10-K");
  check("...and CATCHES a prefix match that pairs the TOC with the cautionary note",
    !bad.found || !bad.body.startsWith("Ondas Holdings"));
  // DAL: "Item 1. Business" is a running header on every page of Item 1.
  const pages = ["Item 1. Business", "Item 1A. Risk Factors", "PART I", "Item 1. Business", "Delta Air Lines is a major airline serving customers worldwide. " + filler("Delta"),
    "Item 1. Business", "More about routes and alliances. " + filler("Routes"), "Item 1. Business", "Executive officers: Snell, Age 49. " + filler("Officers"),
    "Item 1A. Risk Factors", "As described below, these risks could materially affect our business.", "Item 1A. Risk Factors", "x"].join("\n");
  const dal = D.locateSection(pages, "10-K");
  check("running page headers: the section starts at its first page (DAL)", dal.found && dal.body.startsWith("Delta Air Lines is a major airline"));
  const lastOnly = await load(once("const [, from] = repeated ? between[0] : before[before.length - 1];", "const [, from] = before[before.length - 1];"));
  const bad2 = lastOnly.locateSection(pages, "10-K");
  check("...and CATCHES the last page taken as the section", !bad2.found || !bad2.body.startsWith("Delta Air Lines"));
  const split = ["Item 1. Busines s Description", "Berkshire Hathaway Inc. is a holding company. " + filler("Berkshire"), "Item 1A. Ris k Factors", "x"].join("\n");
  check("a heading with words split mid-way is read letters-only (BRK.B)", D.locateSection(split, "10-K").found);
}

console.log("\n2. 20-F: Item 4, then its Business Overview");
{
  const toc = ["ITEM 4 Information on the Company", "44", "Item 4A. UNRESOLVED STAFF COMMENTS", "69", "ITEM 5. Operating and Financial Review and Prospects", "70"];
  const abev = [...toc, "ITEM 4. Information on the Company", "A.", "History and Development of the Company", filler("Ambev"),
    "B.", "Business Overview", "Ambev is the largest brewer in Latin America. " + filler("Ambev"), "C.", "Organizational Structure", filler("Ambev"),
    "Item 4A. UNRESOLVED STAFF COMMENTS", "none", "ITEM 5. Operating and Financial Review and Prospects", "Business Overview", "wrong " + filler("Item5")].join("\n");
  const a = D.locateSection(abev, "20-F");
  check("a split 'B.' / 'Business Overview' inside Item 4 is found (ABEV)", a.found && a.body.startsWith("Ambev is the largest brewer"));
  const ryaay = [...toc, "Item 4. Information on the Company", "INTRODUCTION", filler("Ryanair"), "Item 4A. Unresolved Staff Comments", "none",
    "Item 5. Operating and Financial Review and Prospects", "Business Overview", "wrong " + filler("Item5")].join("\n");
  const r = D.locateSection(ryaay, "20-F");
  check("no Business Overview inside Item 4 → no description, not Item 5's (RYAAY)", !r.found);
  const unbounded = await load((src) => once("const ITEM4B_LETTERED = /^(item4)?bbusinessoverview$/;", "const ITEM4B_LETTERED = /^(item4)?b?businessoverview$/;")(
    once("if (item4.span) {", "if (false) {")(src)));
  const leaked = unbounded.locateSection(ryaay, "20-F");
  check("...and CATCHES a search outside Item 4 that takes Item 5's Business Overview", leaked.found && /^wrong/.test(leaked.body));
  check("40-F has no description", !D.locateSection("x", "40-F").found);
}

console.log("\n3–6. the cleaner");
const long = " It sells these products to industrial customers and government agencies around the world every year.";
{
  const onds = D.cleanDescription(["Ondas, Inc. (together with its subsidiaries, the “Company,” “Ondas,” “we,” “us,” or “our”) is a defense company organized around business units: Ondas Autonomous Systems Inc. (“OAS”)." + long, "● OAS focuses on autonomous systems and integrated mission solutions for defense and public safety."].join("\n"));
  check("a bracketed name list is stripped; a single abbreviation stays",
    onds.ok && onds.text.startsWith("Ondas, Inc. is a defense company") && onds.text.includes("(“OAS”)"));
  check("a bullet second paragraph is dropped", onds.ok && !onds.text.includes("●"));
  const keepList = await load(once("if (!isNameList(inner)) return m;", "return m;"));
  check("...and CATCHES the name list left in", txt(keepList.cleanDescription(["Ondas, Inc. (together with its subsidiaries, the “Company,” “Ondas,” “we,” “us,” or “our”) is a defense company." + long + long].join("\n"))).includes("together with"));

  const aapl = D.cleanDescription(["The Company designs, manufactures and markets smartphones, personal computers and tablets." + long, "Products", "Products iPhone iPhone ® is the Company’s line of smartphones based on its iOS operating system."].join("\n"));
  check("a camel-case second paragraph is kept, heading stripped, no space before ®",
    aapl.ok && aapl.text.includes("\n\niPhone® is the Company’s line"));
  const capsOnly = await load(once("const STARTS_LIKE_A_SENTENCE = /^([“\"‘']?[A-Z0-9]|[a-z]+[A-Z])/;", "const STARTS_LIKE_A_SENTENCE = /^[“\"‘']?[A-Z]/;"));
  check("...and CATCHES the capital-only rule that would drop iPhone",
    !txt(capsOnly.cleanDescription(["The Company designs, manufactures and markets smartphones, personal computers and tablets." + long, "iPhone® is the Company’s line of smartphones based on its iOS operating system."].join("\n"))).includes("iPhone"));

  const ktos = D.cleanDescription(["Overview", "Kratos is a technology company addressing the defense, national security, and commercial markets." + long + long + " We believe that Kratos is known as the", "3", "United States and its allies, to address individual threats including Russia and China. The Company has record backlog."].join("\n"));
  check("a paragraph continuing one cut mid-sentence is dropped (KTOS)", ktos.ok && !ktos.text.includes("United States and its allies"));
  const noFollows = await load(once("!(STARTS_LIKE_A_SENTENCE.test(out[1].t) && !out[1].follows)", "!STARTS_LIKE_A_SENTENCE.test(out[1].t)"));
  check("...and CATCHES the fragment kept", txt(noFollows.cleanDescription(["Kratos is a technology company addressing the defense, national security, and commercial markets." + long + long + " We believe that Kratos is known as the", "3", "United States and its allies, to address individual threats including Russia and China. The Company has record backlog."].join("\n"))).includes("United States and its allies"));

  const gsBody = ["Goldman Sachs is a leading global financial institution that delivers a broad range of financial services to a large and diversified client base." + long,
    "When we use the terms “Goldman Sachs,” “we,” “us,” “our” and “the firm,” we mean The Goldman Sachs Group, Inc. (Group Inc. or parent company) and its consolidated subsidiaries.",
    "Group Inc. is a bank holding company and a financial holding company regulated by the Board of Governors of the Federal Reserve System."].join("\n");
  const gs = D.cleanDescription(gsBody, { companyName: "GOLDMAN SACHS GROUP INC" });
  check("a paragraph opening with a bare name fragment is dropped after a definition (GS)", gs.ok && !gs.text.includes("Group Inc. is"));
  const bac = D.cleanDescription(["Bank of America Corporation is a Delaware corporation, a bank holding company and a financial holding company." + long,
    "Bank of America is one of the world’s largest financial institutions, serving consumers and businesses."].join("\n"), { companyName: "BANK OF AMERICA CORP /DE/" });
  check("...but the name's leading words are not a fragment (BAC keeps paragraph 2)", bac.ok && bac.text.includes("\n\nBank of America is one of"));
  const noFragmentRule = await load(once("if (nameDefinitionStripped && opts.companyName) {", "if (false) {"));
  check("...and CATCHES the fragment rule removed", txt(noFragmentRule.cleanDescription(gsBody, { companyName: "GOLDMAN SACHS GROUP INC" })).includes("Group Inc. is"));

  const rklb = D.cleanDescription(["Who We Are", "Our Mission: We Open Access to Space to Improve Life on Earth.", "Rocket Lab is an end-to-end space company with an established track record of mission success." + long + long].join("\n"));
  check("a leading one-line slogan is dropped (RKLB)", rklb.ok && rklb.text.startsWith("Rocket Lab is"));
}

console.log("\n6b. full-build rules: rosters, tables, run-ons, name-on-its-own-line");
{
  const dal = D.cleanDescription(["Delta Air Lines is a major United States airline providing scheduled air transportation for passengers and cargo." + long,
    "Snell, Age 49: Executive Vice President - Chief Customer Experience Officer of Delta since January 2025; Senior Vice President since 2019."].join("\n"));
  check("an officer roster line is dropped (DAL)", dal.ok && !/Age 49/.test(dal.text));
  const flng = D.cleanDescription(["FLEX LNG owns a fleet of modern LNG carriers chartered to energy majors and trading houses around the world today." + long,
    "Flex Endeavour 2018 HO 173,400 MEGI+PRS Q1 2032 Q1 2033 Flex Enterprise 2018 HO 173,400 MEGI+PRS Q2 2029 NA Flex Ranger 2018 173,400."].join("\n"));
  check("a table read as a sentence is dropped (FLNG)", flng.ok && !/173,400/.test(flng.text));
  const noTab = await load(once("&& s.length <= MAX_SENTENCE_CHARS && !isTabular(s));", "&& s.length <= MAX_SENTENCE_CHARS);"));
  check("...and CATCHES the table kept", /173,400/.test(txt(noTab.cleanDescription(["FLEX LNG owns a fleet of modern LNG carriers chartered to energy majors and trading houses around the world today." + long,
    "Flex Endeavour 2018 HO 173,400 MEGI+PRS Q1 2032 Q1 2033 Flex Enterprise 2018 HO 173,400 MEGI+PRS Q2 2029 NA Flex Ranger 2018 173,400."].join("\n")))));
  const axs = D.cleanDescription("In this Form 10-K, references to “AXIS Capital” refer to AXIS Capital Holdings Limited. AXIS Capital is a global specialty underwriter and provider of insurance and reinsurance solutions with operations in Bermuda, the United States and Europe." + long);
  check("'In this Form 10-K, references to …' is a definition (AXS)", axs.ok && axs.text.startsWith("AXIS Capital is a global"));
  const bhc = D.cleanDescription(["Bausch Health Companies Inc.", "is a global, diversified specialty pharmaceutical and medical device company that develops and markets products." + long].join("\n"));
  check("a company name on its own line joins the sentence it opens (BHC)", bhc.ok && bhc.text.startsWith("Bausch Health Companies Inc. is a global"));
  const frag = D.cleanDescription(["is a global company that nobody named here, which is a fragment of something longer than this line.", "The Company makes products for industrial and government customers around the world." + long + long].join("\n"));
  check("a first paragraph that opens mid-sentence is dropped", frag.ok && frag.text.startsWith("The Company makes"));
  const threeD = D.cleanDescription("3D Systems Corporation is a leading provider of additive manufacturing solutions for industrial and healthcare customers." + long);
  check("...but a name starting with a digit leads (3D Systems)", threeD.ok && threeD.text.startsWith("3D Systems"));
  const psa = D.cleanDescription("Forward-looking statements include statements relating to our guidance and all underlying assumptions, our expected acquisitions and developments over the coming year." + long);
  check("forward-looking-statement boilerplate is rejected (PSA)", !psa.ok);
}

console.log("\n6c. sentences about the report, and a pointer hidden in a run-on");
{
  const dal = D.cleanDescription(["Delta Air Lines is a major United States airline providing scheduled air transportation for passengers and cargo worldwide." + long,
    "We make available free of charge on our investor relations website our Annual Report on Form 10-K and other reports."].join("\n"));
  check("website / SEC-availability text is dropped (DAL)", dal.ok && !/free of charge/.test(dal.text));
  const acgl = D.cleanDescription("All amounts are in millions, except per share amounts, unless otherwise noted. Arch Capital Group Ltd. is a publicly listed Bermuda exempted company providing insurance, reinsurance and mortgage insurance on a worldwide basis." + long);
  check("'amounts are in millions' is dropped (ACGL)", acgl.ok && acgl.text.startsWith("Arch Capital Group"));
  const noMeta = await load(once("!META.some((re) => re.test(s)) && ", ""));
  check("...and CATCHES the report-about-the-report rule removed", /in millions/.test(txt(noMeta.cleanDescription("All amounts are in millions, except per share amounts, unless otherwise noted. Arch Capital Group Ltd. is a publicly listed Bermuda exempted company providing insurance, reinsurance and mortgage insurance on a worldwide basis." + long))));
  const cldx = D.cleanDescription("Celldex Therapeutics, Inc., which we refer to as “Celldex,” “we,” “us,” “our” or the “Company,” is a biopharmaceutical company dedicated to the development of therapeutic monoclonal and bispecific antibodies." + long);
  check("an embedded 'which we refer to as' clause is cut, the lede kept (CLDX)", cldx.ok && /^Celldex Therapeutics, Inc\., is a biopharmaceutical/.test(cldx.text));
  // AZN on the full build: the cross-reference is one 1,000+ character sentence.
  const runOn = "The information set forth under the headings " + Array.from({ length: 30 }, (_, i) => `“Strategic Report—Section ${i}” on page ${i + 2}`).join(", ") + " is incorporated herein by reference.";
  const azn = D.cleanDescription([runOn, "For the avoidance of doubt, the assurance report is not included. AstraZeneca is a global, science-led biopharmaceutical company focused on medicines." + long].join("\n"));
  check("a cross-reference dropped as a run-on still rejects the section (AZN)", !azn.ok && /incorporated by reference/.test(azn.why), azn.why ?? "");
  const noRunOnReject = await load(once("if (x.length <= MAX_SENTENCE_CHARS && !isTabular(x) && !META.some((re) => re.test(x))) continue;", "continue;"));
  check("...and CATCHES the pointer let through", noRunOnReject.cleanDescription([runOn, "For the avoidance of doubt, the assurance report is not included. AstraZeneca is a global, science-led biopharmaceutical company focused on medicines." + long].join("\n")).ok);
}

console.log("\n6d. the opening or nothing");
{
  const deep = [
    ...Array.from({ length: 9 }, (_, i) => `We make available free of charge on our website our reports, item number ${i} of many.`),
    "As described below, these risks could materially affect our business, financial condition or results of operations in the future." + long,
  ].join("\n");
  const r = D.cleanDescription(deep);
  check("text past the section's opening paragraphs is not used (DAL)", !r.ok, r.ok ? r.text.slice(0, 60) : r.why);
  const noWindow = await load(once("for (const p of paras.slice(0, LEAD_PARAS)) {", "for (const p of paras) {"));
  check("...and CATCHES a cleaner that reads on into the section", noWindow.cleanDescription(deep).ok);
}

console.log("\n6e. owner review of the full file (round 5): pointers, page headers, name lists, listings, split words");
{
  const lede = "Marriott International, Inc. is a worldwide operator, franchisor and licensor of hotel, residential, timeshare and other lodging properties.";
  const pointers = [
    ["See Note 14 for more information on our segments.", "MAR/HIG"],
    ["See “Part II—Item 8. Financial Statements” for segment details.", "COF"],
    ["More information on our reportable segments can be found below in our discussion of each business.", "PCG"],
    ["Our structure is shown in the graphic below.", "PCG"],
    ["Item 1.—Business is an outline of our strategic business units.", "AES"],
    ["Our marketplace metrics are described on page 9 of this report.", "ETSY"],
    ["Reference is made to the section on risk management in this report.", "NVO"],
    ["Our common stock, par value $0.01 per share, is traded on the NYSE under the symbol “VTOL”.", "VTOL"],
  ];
  for (const [s, who] of pointers) {
    const r = D.cleanDescription(lede + " " + s + long);
    check(`"${s.slice(0, 32)}…" is dropped (${who})`, r.ok && !r.text.includes(s.slice(0, 20)), r.ok ? "" : r.why);
  }
  const noPointer = await load(once("  /\\bsee\\s+note\\b/i,\n", ""));
  // Mid-sentence, so the older leading "see" rule cannot mask the removal.
  const midNote = lede + " For more information on our segments, see Note 14 of the notes to our statements." + long;
  check("a mid-sentence 'see Note' is dropped (HIG)", !/Note 14/.test(txt(D.cleanDescription(midNote))));
  check("...and CATCHES the See Note rule removed", /Note 14/.test(txt(noPointer.cleanDescription(midNote))));
  const noPar = await load(once("  /\\bpar\\s+value\\b/i,\n  /\\bunder\\s+the\\s+(ticker\\s+)?symbol\\b/i,\n", ""));
  check("...and CATCHES the listing rules removed", /par value/.test(txt(noPar.cleanDescription(lede + " " + pointers[7][0] + long))));

  const pfe = D.cleanDescription("Pfizer Inc. is a research-based, global biopharmaceutical company engaged in the discovery, development, manufacturing, marketing, sale and distribution of Pfizer Inc. 2025 Form 10-K 3 biopharmaceutical products worldwide." + long);
  check("a running page header is stripped from the prose (PFE)", pfe.ok && /distribution of biopharmaceutical products/.test(pfe.text), pfe.ok ? pfe.text.slice(150, 260) : pfe.why);
  const noHeader = await load(once('for (const p of paras) p.t = p.t.replace(RUNNING_HEADER, " ").replace(/\\s{2,}/g, " ");', ""));
  check("...and CATCHES the header rule removed", /Form 10-K 3/.test(txt(noHeader.cleanDescription("Pfizer Inc. is a research-based, global biopharmaceutical company engaged in the discovery, development, manufacturing, marketing, sale and distribution of Pfizer Inc. 2025 Form 10-K 3 biopharmaceutical products worldwide." + long))));

  const air = D.cleanDescription("AAR CORP. and its subsidiaries are referred to herein collectively as “AAR,” “Company,” “we,” “us,” and “our” unless the context indicates otherwise. AAR is a diversified provider of products and services to the worldwide aviation and defense markets." + long);
  check("'referred to herein collectively as' is a definition (AIR)", air.ok && air.text.startsWith("AAR is a diversified"), air.ok ? air.text.slice(0, 60) : air.why);
  const bdx = D.cleanDescription("Becton, Dickinson and Company (also referred to herein as “BD”) is a global medical technology company engaged in the development, manufacture and sale of medical supplies, devices and laboratory equipment." + long);
  check("a bracketed 'referred to herein as' is stripped, even with one name (BDX)", bdx.ok && bdx.text.startsWith("Becton, Dickinson and Company is a global"), bdx.ok ? bdx.text.slice(0, 60) : bdx.why);
  const noHerein = await load(once("if (/\\breferred\\s+to\\s+herein\\b|\\bcollectively\\s+as\\b/i.test(inner)) return true;", ""));
  // Without the bracket rule the whole lede goes as a definition sentence.
  check("...and CATCHES the bracket rule removed", !/^Becton, Dickinson and Company is a global/.test(txt(noHerein.cleanDescription("Becton, Dickinson and Company (also referred to herein as “BD”) is a global medical technology company engaged in the development, manufacture and sale of medical supplies, devices and laboratory equipment." + long))));
  const ajg = D.cleanDescription("Arthur J. Gallagher & Co. and its subsidiaries, collectively referred to herein as we, our, us or Gallagher, are engaged in providing insurance brokerage and consulting services, and third-party claims settlement and administration services." + long);
  check("an embedded 'collectively referred to herein as' clause is cut, the lede kept (AJG)", ajg.ok && /^Arthur J\. Gallagher & Co\. and its subsidiaries are engaged in/.test(ajg.text), ajg.ok ? ajg.text.slice(0, 80) : ajg.why);

  const W = new Set(["am", "mu", "u", "kappa", "agonist", "receptor", "operates", "page", "see", "management", "insights", "countries", "we", "a", "way", "in", "to", "and", "cafés", "into", "away"]);
  const isWord = (w) => W.has(w);
  const j = D.joinSplitWords("Etsy op erates marketplaces, on pag e 9. S ee our managemen t team.", isWord);
  check("split words are joined when the join is a word and the right fragment is not", j.text === "Etsy operates marketplaces, on page 9. See our management team." && j.joined === 4, `${j.joined}: ${j.text}`);
  const keep = D.joinSplitWords("a way in to cafés and O&R and R and s and", isWord);
  check("a real word is never absorbed ('a way', 'in to', 'cafés and', 'O&R and')", keep.joined === 0 && keep.text === "a way in to cafés and O&R and R and s and", keep.text);
  const greedy = await load(once("if (!joinsNext && isWord(j.toLowerCase()) && !isWord(r[1].toLowerCase())) {", "if (isWord(j.toLowerCase())) {"));
  check("...and CATCHES a join that absorbs a real word", greedy.joinSplitWords("a way in to", isWord).joined > 0);
  // A consumed pair: what a global regex does to "Etsy op" before "op erates".
  const regexWalk = await load(once("    out.push(tokens[i]);\n  }", "    out.push(tokens[i]);\n    if (l && r) out.push(tokens[++i]);\n  }"));
  check("...and CATCHES a walk that skips the fragment after a failed pair ('Etsy op erates')", !/Etsy operates/.test(regexWalk.joinSplitWords("Etsy op erates", isWord).text));
  const trvi = D.joinSplitWords("a k appa receptor a gonist and a m u receptor", isWord);
  check("an ambiguous run is left as written (TRVI 'a m u' is not made 'am u'); its clear splits still join", /and a m u receptor/.test(trvi.text) && /a kappa receptor agonist/.test(trvi.text), trvi.text);
  const noNext = await load(once("if (!joinsNext && isWord(j.toLowerCase()) && !isWord(r[1].toLowerCase())) {", "if (isWord(j.toLowerCase()) && !isWord(r[1].toLowerCase())) {"));
  check("...and CATCHES the look-ahead removed", /am u receptor/.test(noNext.joinSplitWords("a m u receptor", isWord).text));
  const inClean = D.cleanDescription(lede + " S ee Note 3 for our segments." + long, { isWord });
  check("joined BEFORE the sentence filters, so 'S ee Note' is dropped as a pointer", inClean.ok && !/Note 3/.test(inClean.text) && inClean.joined >= 1, inClean.ok ? String(inClean.joined) : inClean.why);
  const noDict = D.cleanDescription("Etsy op erates two-sided online marketplaces that connect millions of passionate and creative buyers and sellers around the world." + long);
  check("without a dictionary nothing is joined (the page never runs this)", noDict.ok && /op erates/.test(noDict.text));
}

console.log("\n7. cross-references and MD&A are rejected");
{
  // ONDS's real wording (round-3 full build rejected it: the sentence also names "this Annual Report").
  const onds = D.cleanDescription(["This business description should be read in conjunction with our audited Consolidated Financial Statements and accompanying notes thereto appearing elsewhere in this Annual Report on Form 10-K for the year ended December 31, 2025 (the “Form 10-K”), which are incorporated herein by this reference.",
    "Ondas, Inc. is a defense, security, and critical infrastructure technology company organized around three business units." + long].join("\n"));
  check("ONDS's leading reading instruction is dropped, not a rejection (owner, #518)", onds.ok && onds.text.startsWith("Ondas, Inc. is"));
  const azn = D.cleanDescription("The information set forth under the headings “Strategic Report—AstraZeneca at a Glance” on page 2 and “Business Review” on pages 26 to 46 is incorporated herein by reference into this annual report as a whole.");
  check("AZN's cross-reference is rejected", !azn.ok && /rejected/.test(azn.why));
  const mdna = D.cleanDescription("You should read this in the context of Management’s Discussion and Analysis of Financial Condition and Results of Operations, which explains our results for the year in detail and much more.");
  check("an MD&A opening is rejected", !mdna.ok);
}

console.log("\n8. the committed descriptions");
{
  const f = JSON.parse(fs.readFileSync("data/sec/descriptions.json", "utf8"));
  const rows = Object.entries(f.rows ?? {});
  if (f.asOf === "pending") {
    check("the committed file is the placeholder until descriptions-commit.yml lands", rows.length === 0);
  } else {
    const bad = rows.filter(([, r]) => r[3].length < 200 || r[3].length > 1000 || /Financial Modeling Prep/.test(r[3]));
    check("every row is within the length rules and carries no FMP text", bad.length === 0, `${rows.length} rows, ${bad.length} outside`);
    check("rows name their form and filing date", rows.every(([, r]) => /^(10-K|10-K405|10-KT|20-F)$/.test(r[0]) && /^\d{4}-\d{2}-\d{2}$/.test(r[1])));
    check("no 40-F filer has a row", Object.entries(f.misses ?? {}).filter(([, w]) => /40-F/.test(w)).every(([s]) => !f.rows[s]));
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nThe owner's description rules hold.");
process.exit(failures ? 1 : 0);
