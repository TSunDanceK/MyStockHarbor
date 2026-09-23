// What an article is ABOUT, from its own words. Subjects and motifs, no symbol.
//
// The tagged-library brief of 2026-09-21, mirrored at
// claude/news-art-v2-headlines-2026-09-21.md §4.3. Pure function: no I/O, no
// network, no per-item AI call.
//
// ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
// /headlines has no symbol, so it has no sector, so `bucketFor()` can never
// reach it and the whole sector half of the library is unreachable from this
// page. PR #481 wired the event half in, which left exactly one way for a
// headline to get a picture: eventTypeFromTitle returning earnings, analyst or
// deal. Measured upper bound 7%, and the other 93% of the grid renders nothing.
//
// The v2 library is tagged by SUBJECT (`chips`, `refining`, `banks`) rather
// than bucketed by sector, and a subject is a thing a headline can say on its
// own. This module is what reads it out of the headline. Without it, dropping
// 330 images into public/news-art changes nothing at all: there is not one
// `any-any-*` image in the set, so with no tags nothing scores and nothing is
// picked.
//
// ── THE HOUSE RULES, CARRIED STRAIGHT FROM eventType.ts ────────────────────
// They were learned the hard way in this repo and none of them is restated as
// an opinion here:
//
//   1. WHOLE-WORD, PHRASE-ANCHORED. `chip` must not match `chipotle`; `EV`
//      must not match inside a word. Every pattern below is \b-anchored.
//
//   2. RETURNING NOTHING IS THE CORRECT ANSWER MOST OF THE TIME. A wrong
//      picture asserts something false about the article; a missing one
//      asserts nothing. This is the same reason eventTypeFromTitle is
//      deliberately short and biased towards null.
//
//   3. THE TITLE OUTRANKS THE DESCRIPTION. "Tesla falls as oil rises" is not
//      an oil story. A description match needs TWO independent occurrences
//      before it counts; a title match needs one.
//
//   4. FIRST MATCH WINS, ORDER IS MEANINGFUL, NARROW BEFORE BROAD — the same
//      discipline INDUSTRY_BUCKETS uses in art.ts.
//
// ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
// It does not read a symbol, a sector, an industry or a provider label. The
// provider-map (FMP labels + SIC -> concepts) is a separate change for the
// three symbol-led surfaces and is deliberately not in this one.

/**
 * The tags an article carries, as the picker wants them.
 *
 * BOTH ARE ARRAYS AND BOTH ARE USUALLY EMPTY OR OF LENGTH ONE. Arrays because
 * artTags.ts scores by set intersection and the provider-map will one day
 * supply several subjects for one item; length one because rule 4 stops at the
 * first match, and a second subject would dilute a score whose entire job is to
 * say which ONE picture the article earns.
 */
export type ArticleTopic = {
  subjects: string[];
  motifs: string[];
};

/**
 * Subject patterns, in priority order.
 *
 * ── THIS TABLE IS A DRAFT, AND ITS FIRST NUMBER WAS FITTED ────────────────
 * It was written while looking at the 50 headlines live on /headlines on
 * 2026-09-21 and then measured against those same 50: 58% subject matches.
 * That is an upper bound on any other day's feed, in the same way the earlier
 * 7% was, and claude/news-art-v2-headlines-2026-09-21.md §6 records the
 * held-out re-run beside it. Neither number belongs in a sentence that does not
 * say which sample produced it.
 *
 * ORDER IS THE RULE, not a formatting choice: `refining` sits above
 * `oil-gas-upstream` because "refining margins" is also a crude story and the
 * narrower picture is the truer one, and `biotech` sits below `pharma` for the
 * same reason in reverse — a headline saying both is a pharma headline.
 *
 * Every name on the left must exist in manifest-v2.json. That is asserted by
 * scripts/check-news-art.mjs, not trusted: a pattern that can only ever score 0
 * is dead code that looks alive, which is the same failure shape as the
 * event-deals/deal plural trap art.ts records.
 */
const SUBJECT_PATTERNS: Array<[string, RegExp]> = [
  // ── THE 39 TAGS THAT HELD ART NO PATTERN COULD REACH ───────────────────
  // A census of manifest-v2.json against this table on 2026-09-22 found 156
  // subject images across 39 tags, and 28 motif images across 7 motifs, that
  // NOTHING here could ever return -- 184 of 360, more than half the library,
  // unreachable. `cybersecurity` held four images while "What to Know About
  // Recent A.I. Hacks" rendered nothing.
  //
  // THESE ARE REACHABILITY, NOT MEASURED RECALL, and the distinction matters.
  // Every other pattern in this file was written from a cluster a capture
  // showed at least twice. These were written from the LIBRARY, which is the
  // thing this file's comments warn against, so they are held to a different
  // bar instead: vocabulary so specific that a wrong fire is implausible. Each
  // is pinned by a probe row, and a probe proves a tag CAN fire -- it says
  // nothing about how often the feed asks for it. Expect many of these never to
  // fire, and treat the ones that do as the round-3 evidence.
  ["chip-equipment",   /\b(chip (equipment|tools?)|lithography|euv|wafer fab equipment|semiconductor equipment)\b/i],
  ["reit-datacenter",  /\b(data ?cent(er|re) reits?)\b/i],
  ["chips",            /\b(semiconductors?|semis|chipmakers?|chip[- ]industry|memory[- ]chips?|dram|wafers?|foundry)\b/i],
  // WIDENED TO THE TRADE, NOT ONLY THE BUILDOUT. On the 2026-09-22 general
  // capture FIVE headlines were about AI or chips as a MARKET story -- "Nasdaq
  // posts record close driven by AI trade", "AI and Chip Stocks Race Ahead",
  // "Why Today's Nasdaq Doesn't Look Like 2000, Even With AI Fears Rising" --
  // and every one reached nothing, while `ai-compute` fired twice on the same
  // page for COMPANY stories. The pattern reached the buildout and missed the
  // trade. Five instances in one capture is above the bar the rest of this
  // table was held to; a bare `\bai\b` is not here, because half the feed
  // mentions AI in passing.
  ["ai-compute",       /\b(ai (buildout|infrastructure|capex|compute|chips?|trade|stocks?|boom|bubble)|chip stocks?|semiconductor stocks?|gpus?|data ?cent(er|re)s?)\b/i],
  ["cloud",            /\b(cloud (computing|revenue|infrastructure|providers?|services?|migration)|hyperscalers?|public cloud)\b/i],
  ["cybersecurity",    /\b(cyber ?security|ransomware|data breaches?|cyber ?attacks?|malware)\b/i],
  ["crypto",           /\b(bitcoin|crypto|ethereum|stablecoins?|digital assets?)\b/i],
  // ── MOVED ABOVE THE TWO COMMODITY PATTERNS, AND MEASURED ────────────────
  // `pipelines` sat below `refining` and `oil-gas-upstream` and was shadowed by
  // both on the way a pipeline headline is actually written: "Natural gas
  // pipeline operator lifts its expansion budget" scored `oil-gas-upstream` and
  // "Crude pipeline outage lifts diesel prices" scored `refining`. It could
  // only fire on a headline that named a pipeline and no commodity at all,
  // which is rare enough that the tag was very nearly dead.
  //
  // `\bpipelines?\b` is one word with one meaning in a financial headline,
  // where `crude` and `diesel` appear in stories about many other things. That
  // is what NARROW BEFORE BROAD means, and it is the same shape as the
  // "medical devices before medical" ordering in art.ts's INDUSTRY_BUCKETS.
  // ── AND THEN PHRASE-ANCHORED, BECAUSE THE MOVE INTRODUCED A WORSE BUG ──
  // Above the commodity patterns also means above `pharma`, and `pipeline` is
  // ordinary business English for a queue of work — in drug coverage it is THE
  // standard word. `\bpipelines?\b` therefore took all four of these:
  //
  //   "Novo Nordisk's obesity drug pipeline deepens"   -> pipelines
  //   "Pfizer highlights its oncology pipeline"        -> pipelines
  //   "Salesforce says its sales pipeline is strongest"-> pipelines
  //   "Biotech M&A pipeline builds as rates fall"      -> pipelines
  //
  // An oil pipeline on a Novo story asserts what the article does not say,
  // which is the same failure `banks` was narrowed for one entry below. A TAG
  // THAT FIRES IS NOT A TAG THAT FIRES ON THE RIGHT THING, and every check in
  // section 9 passed while this was live: the proven-to-fire rows only ask that
  // the tag CAN fire.
  //
  // So the word is anchored to a fuel on one side or a piece of infrastructure
  // on the other. Both real rows still match — "Natural gas pipeline operator"
  // on the first alternative and the second, "Crude pipeline outage" on both.
  ["oilfield-services",/\b(oilfield services?|rig counts?|frack\w+|drillers?)\b/i],
  ["pipelines",        /\b(?:oil|gas|crude|natural gas|lng|fuel|energy|midstream)\s+pipelines?\b|\bpipelines?\s+(?:operator|network|shutdown|outage|capacity|rupture|system)\b/i],
  ["refining",         /\b(refiner(y|ies)|diesel|jet fuel|gasoline|refining margins?)\b/i],
  // ── COMPLETED, NOT WIDENED, AND THE REASON IS A WRONG PICTURE ──────────
  // "Oil rises amid worries of growing Iran-U.S. tensions after Bessent issues
  // Iranian airline shutdown warning" rendered an AIRLINER on the live page:
  // `airlines` matched "airline" -- the sanctions instrument, not the story --
  // and NOTHING ELSE MATCHED AT ALL, because `oil (price|export|forecast|
  // market)s?` reaches oil as a noun phrase and misses oil as the SUBJECT OF A
  // PRICE VERB, which is how half of oil coverage is written.
  //
  // THE TIE-BREAK PROPOSED FOR THIS DOES NOT FIX IT. The review suggested
  // preferring the earliest match in the title, on the reading that two
  // patterns both matched truly and table order picked the wrong one. Measured,
  // that is not what happened: `oil-gas-upstream` did not match this title at
  // all, so there was no tie to break. `oil-gas-upstream` already sits ABOVE
  // `airlines`, so making it reach the sentence is the whole fix and firstTag
  // is left alone.
  //
  // FLAGGED AS A DEPARTURE: the table's own rule is that one instance is not a
  // measurement. This is one instance. It is here anyway because the verbs
  // COMPLETE an alternative the table already has rather than adding a new
  // concept -- "Oil Prices Drop" and "Oil Prices Gain" matched on the same
  // capture and "Oil rises" did not -- and because the cost of leaving it is a
  // picture that asserts something the article does not say. Veto-able.
  ["oil-gas-upstream", /\b(crude|opec|barrels?|natural gas|lng|oil (price|export|forecast|market)s?|oil (rises?|rose|falls?|fell|climbs?|slides?|jumps?|gains?|drops?|tumbles?|rallies|surges?|sinks?|steadies))\b/i],
  ["chemicals",        /\b(chemical (makers?|producers?|prices?)|petrochemicals?|specialty chemicals)\b/i],
  ["utilities-grid",   /\b(utilit(y|ies)|power grid|electricity|electrification)\b/i],
  ["nuclear",          /\b(nuclear|reactors?|uranium)\b/i],
  ["solar",            /\bsolar\b/i],
  ["wind",             /\bwind (farms?|turbines?|power)\b/i],
  // FOUR IMAGES AND NO PATTERN AT ALL until now, so "Aerospace suppliers test
  // rare-earth alternatives" -- the word in the first position of the headline
  // -- reached nothing. `defence` is spelled both ways and both are here;
  // the bare word is NOT, because "defensive stocks" is a different story.
  ["rockets-space",    /\b(rocket launch(es)?|space launch(es)?|spacecraft|launch vehicles?)\b/i],
  ["satellites",       /\b(satellites?|satellite (broadband|constellations?))\b/i],
  // ── `drones?` ADDED 2026-09-22: CANDIDATE C, FOLDED INTO THIS ROW ───────
  // It arrived as a second `aerospace-defence` entry and that was wrong: two
  // rows for one tag means first-match-wins decides which pattern is live, and
  // the loser is dead code that reads as if it works — the shape this file
  // already records three times. One tag, one row.
  //
  // Measured on scripts/fixtures/drone-headlines-2026-09-22.jsonl (70 real
  // headlines, five drone/defence symbols): 16 hits, NONE a wrong match. Two
  // wider candidates were rejected, both of which added a bare `defen[cs]e`
  // that matches inside "Kratos Defense & Security Solutions" — the company's
  // NAME, and the shape that made `banks` wrong three times out of three. The
  // existing alternatives already require a following word for that reason.
  //
  // 10% rule: 0 of 192 on the per-symbol fixture.
  ["aerospace-defence",/\b(aerospace|defen[cs]e (contractors?|spending|budget|stocks?)|jet engines?|fighter jets?|drones?|drone (makers?|stocks?))\b/i],
  ["railroads",        /\b(railroads?|rail (freight|traffic|carloads?))\b/i],
  ["trucking-logistics",/\b(trucking|freight (carriers?|brokerages?)|last[- ]mile|logistics (firms?|providers?))\b/i],
  ["shipping",         /\b(tankers?|container ships?|freight rates?|strait of hormuz)\b/i],
  ["airlines",         /\b(airlines?|air travel)\b/i],
  // ── NARROWED FROM THE DRAFT, AND THE MEASUREMENT IS WHY ─────────────────
  // The draft was /\b(banks?|lenders?)\b/i. On the held-out sample
  // (scripts/newsart-topic-sample.mjs, 192 headlines captured 2026-09-13) it
  // fired three times and ALL THREE were a bank appearing in someone else's
  // story: "Bank of America resets Apple stock price target", "Deutsche Bank's
  // 304% Profit Growth Outlook" on NIO, and Costco "Shares Acquired by Saudi
  // Central Bank". A bank-vault illustration on an Apple analyst note asserts
  // something the article does not say, which is exactly the precision failure
  // the 3-vs-2 weighting exists to bound rather than to license.
  //
  // So the bare singular is gone. "Bank of America" now matches nothing here,
  // while "banks", "regional lenders" and "the banking sector" still do. It
  // costs no true positive on that sample — there were none to lose — and the
  // whole read-through is in claude/news-art-v2-headlines-2026-09-21.md §6.
  // THE GROUP CLOSES WITH \b, and it did not: only the last alternative carried
  // one, so `banks` matched inside a longer word and "Banksy artwork sells for
  // record sum at auction" scored a bank vault. The narrowing itself is
  // unaffected — "Bank of America resets Apple stock price target" still
  // reaches nothing here.
  // DELIBERATELY NARROW, AND IT COSTS A ROW ON PURPOSE. `investment-banks` has
  // four images and had no pattern, but "Goldman Sachs Sinks Toward Bear-Market
  // Territory" cannot be told from "Bank of America resets Apple price target"
  // by the NAME alone -- which is exactly what `banks` one line below was
  // narrowed to stop doing. So this reaches the phrase and never the name, and
  // the Goldman row stays a recorded miss rather than a guessed picture.
  ["insurance",        /\b(insurers?|insurance (premiums?|industry|sector|rates?)|reinsur\w+)\b/i],
  ["reit-commercial",  /\b(reits?|commercial real estate|office vacanc\w+|office landlords?)\b/i],
  ["investment-banks", /\b(investment bank(?:s|ing|ers?)?|wall street banks?|bulge bracket)\b/i],
  ["banks",            /\b(?:banks|lenders|banking (?:sector|industry|stocks)|regional bank)\b/i],
  // `asset managers?` DOES NOT MATCH THE COMPANY NAME "Asset Management", which
  // is how the feed writes it, and a sovereign wealth fund is an asset manager
  // by any reading. Both Qatar/JPMorgan headlines in the 2026-09-21 capture
  // reached nothing on this.
  ["asset-management", /\b(etfs?|fund managers?|asset manage(?:rs?|ment)|investment managers?|private equity|sovereign wealth fund|wealth fund|pension funds?)\b/i],
  // `nasdaq composite` matched and the bare index name did not, so "Why Today's
  // Nasdaq Doesn't Look Like 2000" reached nothing. Index names carry one
  // meaning; they are NOT the broad `markets?` catch-all, which is deliberately
  // not here -- see FALLBACK_SUBJECT_PATTERNS at the bottom of this file.
  ["exchanges",        /\b(s&p 500|nasdaq|dow jones|russell 2000|nikkei|hang seng|ftse|dax|stock futures|market breadth|wall street)\b/i],
  // `pharma` ALONE CANNOT MATCH "Pharmaceuticals", which is how the word
  // appears in most headlines — \b after `pharma` needs a non-word character
  // and gets a `c`. "Acme Pharmaceuticals slides" reached nothing at all.
  // `biopharma` stays spelled out because there is no word boundary in front of
  // its `pharma` for the first alternative to anchor to.
  ["fintech-payments", /\b(fintech|payment (networks?|processors?|volumes?)|digital payments?|card networks?)\b/i],
  ["pharma",           /\b(drugs?|pharma(?:ceuticals?)?|biopharma(?:ceuticals?)?|vaccines?)\b/i],
  // THE TRIAL VOCABULARY, from the one recorded miss: "Beacon's gene therapy
  // for vision loss condition meets main trial goal" reached nothing. `pharma`
  // sits ABOVE this, so a headline that says drug or pharma as well is still a
  // pharma headline -- these alternatives only pick up the ones that say
  // neither.
  ["biotech",          /\bbiotech\b|\b(gene therapy|clinical trials?|phase [123ivx]+ trials?|trial (readout|results?|goal)|fda (approval|clearance))\b/i],
  ["medtech-devices",  /\b(medical devices?|medtech|implants?|surgical robots?)\b/i],
  ["lab-diagnostics",  /\b(diagnostics?|clinical labs?|lab testing)\b/i],
  ["hospitals",        /\b(hospitals?|health ?systems?|managed care)\b/i],
  ["autos",            /\b(carmakers?|automakers?|auto industry)\b/i],
  // ── LEFT AS THE DRAFT, ON PURPOSE, AND THE ONE HIT IS RECORDED ─────────
  // `evs?` fired once on the held-out sample, on "China's 'Hottest' Memory-Chip
  // Company Just Won An EV Backer" — where EV describes the investor, not the
  // story. That headline still got the right picture, because `chips` sits
  // higher and won, which is luck rather than design.
  //
  // ONE AMBIGUOUS INSTANCE IS NOT A MEASUREMENT, and narrowing a pattern to fit
  // it is how a table stops describing the feed and starts describing the
  // sample. It is written down in §6 of the doc as the thing to look at on the
  // next capture instead.
  ["ev",               /\b(electric vehicles?|evs?|charging network)\b/i],
  ["ecommerce",        /\b(e-?commerce|online retail(ers?)?|online shopping)\b/i],
  ["grocery",          /\b(grocers?|grocery (chains?|stores?|sales)|supermarkets?)\b/i],
  ["restaurants",      /\b(restaurants?|fast[- ]food|quick[- ]service)\b/i],
  ["apparel",          /\b(apparel|footwear|sneakers?|clothing (brands?|retailers?))\b/i],
  ["luxury",           /\b(luxury (goods?|brands?|sector|market)|handbags?)\b/i],
  ["packaged-food",    /\b(packaged food|food makers?|snack (brands?|makers?))\b/i],
  ["beverages",        /\b(beverages?|soft drinks?|bottlers?|brewers?|distillers?)\b/i],
  ["hotels-resorts",   /\b(hotels?|resorts?|occupancy rates?|hospitality (sector|industry))\b/i],
  ["cruise-lines",     /\b(cruise (lines?|operators?|bookings?|ships?))\b/i],
  ["casinos",          /\b(casinos?|gross gaming revenue)\b/i],
  ["gaming",           /\b(video ?games?|game (studios?|developers?|publishers?)|consoles?)\b/i],
  ["streaming-media",  /\b(streaming (services?|subscribers?|platforms?|wars?)|subscriber (growth|losses))\b/i],
  ["advertising",      /\b((ad|advertising) (spend|revenue|market)|adtech)\b/i],
  ["telecom",          /\b(telecoms?|wireless carriers?|broadband|5g networks?)\b/i],
  ["phones",           /\b(smartphones?|handsets?|mobile phones?)\b/i],  // NOT `iphones?` -- a brand name, and `banks` is the precedent
  ["consumer-electronics",/\b(consumer electronics|wearables?|smart ?watch(es)?|laptops?)\b/i],
  ["internet-platform",/\b(social (media|networks?)|search advertising|online platforms?)\b/i],
  ["education",        /\b(edtech|student loans?|tuition)\b/i],
  ["staffing-services",/\b(staffing (firms?|agencies|industry)|recruiters?)\b/i],
  ["retail-stores",    /\b(retailers?|consumer spending|holiday shopping)\b/i],
  ["software",         /\b(software|saas)\b/i],
  ["construction",     /\b(construction (spending|activity|firms?)|infrastructure spending)\b/i],
  ["machinery",        /\b(heavy machinery|industrial equipment|construction equipment|farm equipment)\b/i],
  ["packaging-paper",  /\b(packaging (firms?|makers?|industry|demand)|containerboard|corrugated)\b/i],
  ["waste-recycling",  /\b(waste (management|haulers?)|recycling|landfills?)\b/i],
  ["homebuilders",     /\b(housing starts|homebuilders?|home sales)\b/i],
  // "rare earth" carries one meaning in a financial headline, and the two
  // captures held three of them. Sits below `aerospace-defence` deliberately:
  // "Aerospace suppliers test rare-earth alternatives" is a story about
  // aerospace suppliers, and the word order says so.
  ["mining-industrial",/\b(rare[-\s]earths?|copper (prices?|miners?)|lithium|iron ore|ore grades?)\b/i],
  ["mining-precious",  /\b(gold|silver|bullion)\b/i],
  ["steel",            /\bsteel\b/i],
  ["agriculture",      /\b(wheat|corn|soybeans?|crops?|farmers?)\b/i],
];

/**
 * Motif patterns, in priority order.
 *
 * A MOTIF IS WHAT HAPPENED, a subject is what it happened to, and they are
 * scored on separate axes precisely so a story can be both. `macro` sits at the
 * top because a Fed headline is a macro headline whatever else it mentions.
 *
 * EIGHT OF THE SIXTEEN MOTIFS THE LIBRARY HOLDS HAVE NO PATTERN HERE — `cash`,
 * `contract`, `filing`, `launch`, `leadership`, `partnership`, `split`,
 * `supply`. That is deliberate and is not a backlog item to clear for its own
 * sake: a motif reachable by a phrase that carries two meanings in a financial
 * headline costs more than a motif that is never reached. Add one only with a
 * phrase that carries one.
 */
const MOTIF_PATTERNS: Array<[string, RegExp]> = [
  // TWO WIDENINGS, BOTH FROM STORIES THAT REACHED NOTHING ON A GENERAL-FEED
  // SAMPLE, and both kept phrase-anchored rather than made generous:
  //
  //   BONDS. `treasury yields` matched and `bond yields` did not, so half the
  //   rates coverage fell through. `(treasury|bond) yields?` plus `bond market`
  //   covers it. A bare `yields?` is NOT here: "the strategy yields returns" is
  //   not a rates story.
  //
  //   TRADE TALKS. `trade (war|truce)` matched the outcome and not the event.
  //   `trade talks` and `trade negotiations` are unambiguous; a bare `summit`
  //   is not, and is deliberately absent — an AI summit and a developer summit
  //   are not macro, and there is no phrase that separates them from a G20 one
  //   without naming it.
  // TWO MORE WIDENINGS, each from a CLUSTER rather than an instance:
  //
  //   SUMMIT / GEOPOLITICS. Five of 42 on the 2026-09-21 capture reached
  //   nothing. A bare `summit` is STILL not here and still for the same reason
  //   -- an AI summit and a developer summit are not macro. What is here is the
  //   pair of names and the pair of countries, which carry one meaning in a
  //   financial headline. `u\.?s\.?` spells out because the feed writes
  //   "U.S-China" as often as "US-China" and \b cannot see through the stops.
  //   NOTE THE DATEDNESS: `trump[\s&-]+xi` is two proper nouns and will age
  //   out. It earns its place on three instances in 42 today and should be
  //   re-read, not renewed by default, on a capture a year from now.
  //
  //   BONDS, THE BARE WORD. `(treasury|bond) yields?` and `bond market`
  //   matched and `bonds` alone did not, and three bond stories in 42 fell
  //   through. This is the one alternative the round-1 brief flagged as
  //   risky in the DESCRIPTION leg -- "bond" appears in passing in market
  //   round-ups constantly -- so it ships under the existing two-occurrence
  //   rule rather than a restructure, and the measurement is what decided it.
  ["macro",      /\b(fed|federal reserve|rate (hike|cut)|interest rates?|inflation|(treasury|bond) yields?|bonds?|bond market|treasury auctions?|borrowing costs|tariffs?|trade (war|truce|talks|negotiations)|trump[\s&-]+(?:and\s+)?xi|u\.?s\.?[-–]china|geopolitic\w+|g7|g20|gdp|central bank)\b/i],
  // `m&a` IS HOW THE FEED WRITES IT and none of the spelled-out alternatives
  // reach it: "Novo CEO on M&A: Let's see where the gaps are" was silent.
  ["deal",       /\b(takeover|mergers?|acquisitions?|m&a|to acquire|funding round|bid for)\b/i],
  // THE NINTH MOTIF. Seven of the sixteen still have no pattern and that is
  // still deliberate; this one is added because the feed kept asking -- two
  // Qatar/JPMorgan headlines in the 2026-09-21 capture, "Versace partners with
  // REVOLVE" live, and "On Holding signs Kylian Mbappe in a 10-year
  // partnership" on the 09-22 one. Every alternative names the arrangement;
  // none of them is a word that means something else in a financial headline.
  ["partnership",/\b(partners? with|partnership|joint ventures?|teams? up with|strategic alliance)\b/i],
  // WIDENED TO REGULATION. `legal` art is a gavel and a courthouse, which fits
  // a regulatory story as well as a courtroom one. The AI-policy cluster is
  // what asked for it; `macro` sits above, so a summit-framed story still gets
  // the globe and only a regulation-framed one gets the gavel.
  ["legal",      /\b(lawsuits?|sues?|court|settlements?|antitrust|regulators?|regulation|oversight|investigation)\b/i],
  ["jobs",       /\b(layoffs?|hiring|labor unions?|workforce)\b/i],
  ["earnings",   /\b(earnings|quarterly results|beats? estimates)\b/i],
  ["guidance",   /\b(forecasts?|outlook|guidance)\b/i],
  ["ipo",        /\b(ipo|public offering|plans? (an? )?listing|listing plans?)\b/i],
  ["analyst",    /\b(price target|initiates coverage|rated buy)\b/i],
  // SIX OF THE SEVEN MOTIFS THAT HELD ART AND HAD NO PATTERN. `filing` is
  // deliberately still absent: eventType.ts keeps it unreachable from a title
  // on purpose and there is no reason for this table to disagree with it.
  ["supply",     /\b(supply chains?|shortages?|bottlenecks?)\b/i],  // NOT `export controls` -- that is trade, and `macro` already reaches it
  ["contract",   /\b(wins? (a |the )?contract|awarded (a |the )?contract|contract worth|order backlog)\b/i],
  ["launch",     /\b(product launch(es)?|rolls? out|(unveils?|launch(es|ed)?) (a |its |the )?new\b)/i],  // NOT bare `unveils?` -- it took "unveils 2030 strategy"
  ["leadership", /\b(new (ceo|cfo)|(names?|appoints?) (a )?(new )?(ceo|cfo)|steps? down|ceo (exits?|resigns?))\b/i],
  ["cash",       /\b(dividends?|buybacks?|share repurchases?|free cash flow)\b/i],
  ["split",      /\b(stock splits?|reverse splits?)\b/i],
];

/**
 * THE LAST LEG, AND THE ONLY ONE THAT CANNOT SHADOW ANYTHING.
 *
 * ── WHY THIS IS NOT A ROW IN THE TABLE ABOVE ──────────────────────────────
 * The largest remaining cluster on the general feed is market commentary with
 * no concrete subject — "Stock Market Today: Tech Rally Fades", "Markets Are
 * Pricing An 'October Surprise'", "Financial conditions are tightening". Ten of
 * the twenty-six silent rows on the 2026-09-22 capture are this shape, and
 * `exchanges` art — a trading floor, a candlestick chart, an opening bell — is
 * exactly what they want and is already eight images deep.
 *
 * It cannot go in SUBJECT_PATTERNS at ANY position. The title leg takes the
 * EARLIEST match, so a broad `markets?` would beat the real subject whenever it
 * happened to appear first:
 *
 *   "Housing market cools as homebuilders pull back"
 *      market at 8, homebuilders at 30  ->  the catch-all wins. Wrong.
 *
 * Putting it last in the table does not help, because last in the table is not
 * last in the sentence. So it is a SEPARATE LIST, consulted only when both legs
 * of firstTag have returned nothing. That is the one arrangement in which a
 * broad pattern cannot cost a precise one.
 *
 * ── AND WHY IT IS NOT `any-any` ───────────────────────────────────────────
 * The fallback set of undirected images is built and deliberately unshipped:
 * filling every card removes the signal that tells you the classifier worked.
 * This is not that. It fires on headlines that SAY a market word, and a page
 * with silent cards on it still says so. On the 09-22 capture it leaves plenty.
 *
 * ── TITLE ONLY, ON PURPOSE ────────────────────────────────────────────────
 * No description leg. A generic market word in a body paragraph is the weakest
 * evidence in this file — every market round-up contains one — and rule 3's
 * two-occurrence bar was calibrated for patterns that mean something specific.
 *
 * ── AND THE BARE WORD `stocks` IS NOT HERE, BECAUSE IT WAS MEASURED ──────
 * The first cut of this list had `stocks?` and `share prices?` in it, and it
 * failed TWENTY-NINE rows — every one of them on the PER-SYMBOL feed, where
 * "Apple stock price target" and "NIO Stock Slides" are the house style. The
 * same word means "the market" on one feed and "this company's shares" on the
 * other. Nothing about the general capture would have shown that, which is the
 * third time the two-population fixture has caught something invisible on one
 * of them.
 *
 * ── AND THE BARE WORD `markets` IS NOT HERE EITHER, FOR A SUBTLER REASON ─
 * It failed three rows, and all three are the SAME SHAPE — a compound noun
 * ending in the word:
 *
 *   "DraftKings Stock Could Pop on Prediction Market Court Decisions"
 *   "...; SMH And Robinhood Markets Are Ready To Run"      <- a company name
 *   "Goldman Sachs Sinks Toward Bear-Market Territory"
 *
 * Nothing in a regex separates "Robinhood Markets" from "Hope Fuels Markets":
 * both are Title Case, both have a word in front. `markets? are` would take the
 * company one too. So the bare word goes and the qualified phrases stay, which
 * costs two real rows on the 09-22 capture and is the trade this table makes
 * everywhere else. `bear market` is spelled with a SPACE on purpose, so
 * "Bear-Market Territory" — a single stock, not the market — stays silent.
 *
 * ── NO DIRECTION, ON PURPOSE ──────────────────────────────────────────────
 * `bull market` and `bear market` are both here and both map to the SAME
 * neutral art, because the tag says "this is a markets story", never "this is
 * a bullish one". Direction is the one thing that inverts: on the 09-22 capture
 * "Beware Of Bull Traps" is bearish, and in "Nikkei Could Rally as Shorts Pile
 * Up" the shorts piling up is the bullish half. A picture that asserts a
 * direction on a stock site is a wrong signal, not a vague one.
 */
const FALLBACK_SUBJECT_PATTERNS: Array<[string, RegExp]> = [
  ["exchanges", /\b(stock markets?|equity markets?|the markets?|equities|sell-?offs?|bear market|bull market|blue chips?|indexes|indices)\b/i],
];

/**
 * SUBJECTS THAT DESCRIBE THE MARKET RATHER THAN AN INDUSTRY.
 *
 * ── WHY A SYMBOL-LED PAGE MUST IGNORE THESE, MEASURED ─────────────────────
 * `exchanges` matches `wall street`, and on the per-symbol feed all four of its
 * hits across 192 real headlines are the metonym for analysts:
 *
 *   "Apple Stock Slips … Fail to Wow Wall Street"
 *   "Meta Stock Scores Wall Street Upgrade"
 *   "A Wall Street Bull Expects 75% Gains"      (MSFT)
 *   "Tesla's stock drops 6% as … 'underwhelms' Wall Street"
 *
 * On /headlines that pattern is usually right — a general feed saying "Wall
 * Street" usually IS the market story — and it is deliberately not narrowed
 * there. On a page about ONE company it is wrong four times out of four, and
 * worse than wrong: layer 1 outranks the industry, so it replaces a correct
 * picture of the company's business with a trading floor.
 *
 * THE RULE IS NOT "exchanges IS BAD". It is that a market-wide subject is never
 * more specific than the company whose page it is, so on a symbol-led surface
 * it loses to the industry. A named set rather than a flag on the tag, so a
 * future market-wide subject joins it deliberately and the reason stays here.
 *
 * IT LIVES BESIDE THE SUBJECT TABLE, not beside the picker that applies it,
 * because it is a statement about what these tags MEAN — a property of the
 * vocabulary, not of one surface's rule. Anything holding a tag can ask.
 * `exchanges` is the only one today: every one of its alternatives (`s&p 500`,
 * `nasdaq composite`, `stock futures`, `market breadth`, `wall street`) is
 * about the market, and no other subject's are.
 */
export const MARKET_WIDE_SUBJECTS = new Set(["exchanges"]);

/** Exposed for scripts/check-news-art.mjs, which asserts every name is real. */
export const SUBJECT_TAGS: string[] = SUBJECT_PATTERNS.map(([tag]) => tag);
export const MOTIF_TAGS: string[] = MOTIF_PATTERNS.map(([tag]) => tag);

/**
 * THE PATTERNS THEMSELVES, exposed for one assertion that cannot be made any
 * other way: no subject pattern may match more than 10% of the per-symbol
 * fixture ON ITS OWN.
 *
 * ── WHY EACH PATTERN IS TESTED ALONE ──────────────────────────────────────
 * articleTopic stops at the first match, so a ruinously broad pattern added
 * BELOW a narrow one is invisible in the output: the narrow one keeps winning
 * on the headlines anyone looks at. Measured on that fixture, `\bstocks?\b`
 * would fire on 146 of 192 headlines (76%) — on a per-symbol feed nearly every
 * headline says "stock" — and a tag that fires on three quarters of a feed is
 * not a subject, it is a background.
 */
export const SUBJECT_PATTERN_ENTRIES: ReadonlyArray<readonly [string, RegExp]> = SUBJECT_PATTERNS;

/**
 * How many times a pattern matches, counted at DISTINCT OFFSETS.
 *
 * Rule 3 needs "two independent matches in the description" to be a number, and
 * the only honest reading of independent is "not the same occurrence twice".
 * Two mentions of oil in a paragraph is an oil story; one is a passing clause.
 *
 * The source pattern is cloned with the `g` flag rather than mutated, because a
 * module-level RegExp carrying `lastIndex` between calls is a stateful bug that
 * only shows up on the second article.
 */
function countMatches(pattern: RegExp, text: string): number {
  if (!text) return 0;
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let count = 0;
  let last = -1;
  for (let m = global.exec(text); m; m = global.exec(text)) {
    if (m.index !== last) {
      count += 1;
      last = m.index;
    }
    // A zero-width match would spin forever. None of the patterns above can
    // produce one, and the guard costs nothing if one is ever added.
    if (m[0].length === 0) global.lastIndex += 1;
    if (count >= 2) return count;
  }
  return count;
}

/**
 * EARLIEST match over the title, then — only if the title said nothing —
 * first match over the description with two occurrences required.
 *
 * THE TWO PASSES ARE WHOLE PASSES, not one pass over both strings. A title
 * match on the fourth pattern must beat a description match on the first, or
 * the weaker evidence quietly wins whenever it happens to sit higher in the
 * table, and rule 3 stops meaning anything.
 */
function firstTag(patterns: Array<[string, RegExp]>, title: string, description: string): string[] {
  // ── THE TITLE LEG IS EARLIEST-MATCH, NOT FIRST-PATTERN ──────────────────
  // Rule 4 (narrow before broad) settles which of two patterns is the more
  // specific DESCRIPTION OF A SUBJECT. It has nothing to say about which of two
  // TRUE matches in one headline is what the story is about, and on the live
  // page that gap produced a wrong picture in both directions:
  //
  //   "Oil rises ... after Bessent issues Iranian airline shutdown warning"
  //      oil at 0, airline at 78          -> the story is oil
  //   "Stock Market Today: Stock Futures Tick Up as Oil Falls"
  //      stock futures at 20, oil at 44   -> the story is the market
  //
  // Table order gives the first one an airliner and the second one an oil rig.
  // A headline names its subject before its qualifier, so the earliest match in
  // the title is the better answer, and it is the same answer table order gives
  // on every other row in both fixtures -- MEASURED, not assumed: this change
  // moves exactly those two and nothing else.
  //
  // TIES GO TO TABLE ORDER, which is what keeps rule 4 intact where it applies.
  // "Crude pipeline outage lifts diesel prices" matches `pipelines` and
  // `oil-gas-upstream` at the SAME offset 0, and `pipelines` must still win.
  let best: { tag: string; at: number } | null = null;
  for (const [tag, pattern] of patterns) {
    const m = pattern.exec(title);
    if (m && (best === null || m.index < best.at)) best = { tag, at: m.index };
  }
  if (best) return [best.tag];
  // THE DESCRIPTION LEG IS UNCHANGED AND STAYS FIRST-PATTERN. Position in a
  // body paragraph carries none of the meaning it carries in a headline, and
  // rule 3's two-occurrence bar is already doing the discriminating there.
  for (const [tag, pattern] of patterns) {
    if (countMatches(pattern, description) >= 2) return [tag];
  }
  return [];
}

/**
 * An article's tags, from its own words.
 *
 * EMPTY IS A RESULT, NOT A FAILURE. artTags.pickTagged turns a score of 0 into
 * null and /headlines turns null into the event-art path it already had, so an
 * article this module says nothing about is exactly as it is today — never a
 * random picture.
 */
export function articleTopic(
  title: string | null | undefined,
  description?: string | null
): ArticleTopic {
  const titleText = String(title ?? "");
  const descriptionText = String(description ?? "");
  if (!titleText && !descriptionText) return { subjects: [], motifs: [] };

  const subjects = firstTag(SUBJECT_PATTERNS, titleText, descriptionText);
  return {
    // The fallback is consulted ONLY when the real table said nothing, and only
    // against the title. See FALLBACK_SUBJECT_PATTERNS for why it cannot be a
    // row in the table itself.
    subjects: subjects.length ? subjects : firstTag(FALLBACK_SUBJECT_PATTERNS, titleText, ""),
    motifs: firstTag(MOTIF_PATTERNS, titleText, descriptionText),
  };
}
