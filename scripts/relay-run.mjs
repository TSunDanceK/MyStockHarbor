// Task router for .github/workflows/relay.yml.
//
// WHY THE ROUTING LIVES HERE AND NOT IN THE WORKFLOW. workflow_dispatch only
// registers for workflow files on the DEFAULT BRANCH, so anything encoded in
// relay.yml costs a merge-and-wait round trip to change. That toll was paid twice
// in one day (#436 gated Step 0, #444 gated Phase 0). A `case` statement inside
// the workflow would have kept paying it: every new phase would still need an
// edit to main before it could run once.
//
// A workflow can be dispatched with `ref` pointed at a FEATURE BRANCH, and it
// checks that branch out. So everything that varies per phase belongs in
// scripts/, where a branch can add it and dispatch it the same minute. relay.yml
// now holds only what cannot move: the input declarations and the credential
// split.
//
// THE WRITE PREFIX IS A SECURITY BOUNDARY, NOT A NAMING STYLE. Tasks whose name
// begins with "write-" are routed by relay.yml to a separate job that holds the
// Upstash credentials; everything else runs in a job that references no secrets
// at all and does not even install the Redis client. This file enforces the same
// rule independently, from the other side: invoked without --allow-writes it
// REFUSES to run a write- task, so a mis-edited `if:` in the workflow cannot
// cause a credentialled task to execute in the read-only job. Two mechanisms,
// one rule -- because a single `if:` expression is one typo from silently
// inverting.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// task name -> script, plus the args it takes from the environment. Adding a
// phase is an edit HERE, on a branch, with no workflow change and no merge.
const TASKS = {
  "stooq-access": { script: "scripts/stooq-access-probe.mjs", args: () => [] },
  // WHAT FED H.10 AND THE ECB ACTUALLY SERVE. Read-only and UNCREDENTIALLED on
  // purpose: it touches no store, so it belongs in the job that cannot reach
  // one. Both hosts are 403 CONNECT from the agent sandbox, so this is the only
  // place the rate sources can be measured at all.
  "fx-sources": { script: "scripts/fx-source-probe.mjs", args: () => [] },
  // THE SAME FOUR QUESTIONS asked of FRED's clean-CSV endpoint for the H.10
  // series, because fx-sources guessed a DDP hash and cannot distinguish a bad
  // URL from an unavailable source. Read-only and uncredentialled likewise.
  "fred-fx": { script: "scripts/fred-fx-probe.mjs", args: () => [] },
  // WHY TWO OF THE THREE EYE-CHECK FILERS DID NOT CONVERT. Reads companyfacts
  // and every FRED series the adapter names; touches no store, so read-only.
  "fx-filer-diagnosis": {
    script: "scripts/fx-filer-diagnosis.mjs",
    args: () => [],
    // It LIFTS the shipped reportingCurrency and extractCompanyFacts out of
    // .ts modules, so it needs the compiler to erase types. The router
    // installs it in isolation; this stays in the read-only job because it
    // touches no store.
    needsTypescript: true,
  },
  // Added on a branch and dispatched the same minute, with no workflow edit and
  // no merge -- which is the whole reason routing lives here instead of in a
  // case statement inside relay.yml.
  "bars-providers": { script: "scripts/bars-provider-probe.mjs", args: () => [] },
  // DOES YAHOO WANT BRK.B OR BRK-B? The sandbox answers 403 CONNECT for
  // query1.finance.yahoo.com and stooq.com both, so this is the only place the
  // question can be asked -- and it has to be asked before the quote path
  // converts anything on the Yahoo leg, because the dot is what the app sends
  // today and converting the one vendor that already accepts it would break it.
  // Re-asks Stooq at the same time, since the proposal to delete that leg rests
  // on a measurement from 2026-09-12. Read-only and uncredentialled: public
  // endpoints, no store.
  "share-class-spelling": { script: "scripts/share-class-spelling-probe.mjs", args: () => [] },
  "nasdaq-refill": {
    script: "scripts/nasdaq-refill-analysis.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  "listing-split": {
    script: "scripts/listing-split.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  "phase0-adjustment": {
    script: "scripts/phase0-adjustment-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  coverage: {
    script: "scripts/stooq-coverage.mjs",
    args: (env) => [env.DUMP_DIR ?? "", env.SYMBOLS ?? ""],
    needsDump: true,
  },
  // Name-matching, NOT ticker-matching -- the ticker key is what failed.
  //
  // needsDump WAS true AND IS NOW FALSE, because run 48 proved the dump has
  // nothing this task wants: its FMP cache rows carry sector and industry and
  // no company name at all, so the run came back void. Names now come from the
  // Nasdaq Trader directory, fetched on the runner. The dump is still READ if
  // one is attached -- it contributes the pickers half of the universe -- but
  // requiring it would make the task wait on an artifact it does not need.
  "sec-titles": {
    script: "scripts/sec-title-candidates.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: false,
  },
  "sec-fundamentals": {
    script: "scripts/sec-fundamentals-ingest.mjs",
    args: (env) => [env.DUMP_DIR ?? "", env.SYMBOLS ?? ""],
    needsDump: true,
  },
  // Read-only: fetches two public pipe-delimited text files and prints them.
  // Needed because the sandbox is refused www.nasdaqtrader.com by policy, and
  // that directory is where the news path's company name actually comes from.
  "company-name-sample": { script: "scripts/company-name-sample.mjs", args: () => [] },
  // Read-only: fetches a public RSS feed and prints it. Needed because the
  // sandbox is refused news.google.com by policy, and the adapter's parser must
  // be tested against the feed's real shape.
  "gnews-sample": { script: "scripts/gnews-sample.mjs", args: () => [] },
  // SYMBOLS comes from the workflow's `symbols` input and the script defaults
  // to the five drone/defence names when it is blank, so a dispatch that
  // forgets it still captures the thing it was added for.
  "drone-sample": { script: "scripts/drone-headline-sample.mjs", args: () => [] },
  // How much of a symbol's real pool its anchored short-name needle admits, and
  // how much of that is the company rather than the index, the month or the
  // noun. news.google.com is refused from the sandbox; a runner reaches it.
  "anchor-collisions": { script: "scripts/anchor-collision-sample.mjs", args: () => [] },
  // Does a fund-or-note verdict EVER produce a usable query? assessCompanyName
  // says such a name should never reach a per-symbol query; gnewsProvider warns
  // and queries anyway. 90 committed names carry the verdict, and the marker
  // fires on real MLPs and BDCs as well as on genuine instruments, so a skip
  // cannot be made safe by reading either file. news.google.com is refused from
  // the sandbox; a runner reaches it.
  "fund-or-note": { script: "scripts/fund-or-note-sample.mjs", args: () => [] },
  // Read-only, but needs the frozen universe to compute the match ratio: the
  // question "how many wire items are about a stock we cover" cannot be answered
  // without the symbol set.
  "wire-feeds": {
    script: "scripts/wire-feeds-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only. Needs the dump for the universe: both the CIK map and the
  // sicDescription comparison are scoped to the symbols the site covers.
  "sec": {
    script: "scripts/sec-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only. One poll of all three free news sources, digested to the raw
  // inputs §7's cascade reads — no judgement made on the runner, so the
  // measurement describes the shipped derivation and not a copy of it.
  "eventtype-sample": { script: "scripts/eventtype-sample.mjs", args: () => [] },
  // Read-only: the FULL Google News feed per symbol, digested to publisher,
  // link host and title. Asked after the preview showed 13 of 15 MU cards were
  // institutional-holding churn that every precision probe had scored 96-100%,
  // because "is it about MU" and "is it worth reading" are different questions
  // and only the first had ever been measured.
  "churn-sample": { script: "scripts/churn-sample.mjs", args: () => [] },
  // Read-only: asks a deployment for pages so their renders emit [timing] lines
  // into the Vercel runtime log. Prints no response body -- the measurement is
  // in the log, not in the HTML, and the sandbox is refused *.vercel.app anyway.
  "render": {
    script: "scripts/render-probe.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
  },
  // Read-only: how long each free news adapter actually takes, cold, against
  // the real hosts. Asked before choosing a per-adapter timeout budget, because
  // the sandbox cannot reach any of the three and a guessed budget is a guess.
  "news-timing": { script: "scripts/news-timing-probe.mjs", args: () => [] },
  // Read-only, NO NETWORK AT ALL: inventories the frozen dump already on the
  // runner. Asked before building the static-profile snapshot, because if the
  // dump carries the taxonomy the snapshot costs no FMP calls whatsoever.
  "dump-inventory": {
    script: "scripts/dump-inventory.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only, NO NETWORK: builds the static profile snapshot from the taxonomy
  // already in the frozen dump, captured while the FMP licence was live. See the
  // script header for why there are no FMP calls in it.
  "static-profile": {
    script: "scripts/static-profile-build.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Fetches SEC's ticker file on a runner, because the agent sandbox is refused
  // www.sec.gov with 403 CONNECT. Read-only by name and by nature: it writes a
  // file into the workspace, which the workflow uploads as an artifact, and
  // touches no credential.
  "company-tickers": { script: "scripts/fetch-company-tickers.mjs", args: () => [] },
  // PR 3 step 1: can the company's own 10-K Item 1 / 20-F Item 4.B replace
  // FMP's description? Reads submissions and the latest annual primary
  // document for ~30 symbols. Read-only, no credentials; renders nothing.
  "sec-description-probe": { script: "scripts/sec-description-probe.mjs", args: () => [], needsTypescript: true },
  // The same probe with DIAGNOSE=1: prints every Item-heading line per filing.
  "sec-description-diagnose": { script: "scripts/sec-description-probe.mjs", args: () => [], needsTypescript: true, env: { DIAGNOSE: "1" } },
  // Points and bytes of the fiscal-year share series (StoredFactSet.as) per
  // symbol, from the shipped extractor on the live payload. Read-only.
  // XOM (#518): which CIK — predecessor 34088 or holding company 2115436 —
  // carries the recent quarters, and whether 2115436 has filed an annual yet.
  // Read-only, no credentials.
  "sec-cik-periods": { script: "scripts/sec-cik-periods-probe.mjs", args: () => [], needsTypescript: true },
  // PR 3 render (#518): the company's own description for every profiled
  // symbol, in six shards so each fits the read-only job's 30 minutes. Each
  // writes data/sec/descriptions-part-k.json; descriptions-commit.yml merges
  // them into data/sec/descriptions.json. Read-only, no credentials.
  "sec-descriptions-1": { script: "scripts/sec-descriptions-build.mjs", args: () => [], needsTypescript: true, env: { SHARD: "1/6" } },
  "sec-descriptions-2": { script: "scripts/sec-descriptions-build.mjs", args: () => [], needsTypescript: true, env: { SHARD: "2/6" } },
  "sec-descriptions-3": { script: "scripts/sec-descriptions-build.mjs", args: () => [], needsTypescript: true, env: { SHARD: "3/6" } },
  "sec-descriptions-4": { script: "scripts/sec-descriptions-build.mjs", args: () => [], needsTypescript: true, env: { SHARD: "4/6" } },
  "sec-descriptions-5": { script: "scripts/sec-descriptions-build.mjs", args: () => [], needsTypescript: true, env: { SHARD: "5/6" } },
  "sec-descriptions-6": { script: "scripts/sec-descriptions-build.mjs", args: () => [], needsTypescript: true, env: { SHARD: "6/6" } },
  // NOT A TASK: preview screenshots run in .github/workflows/preview-screenshots.yml,
  // which reads its Vercel bypass credential from a masked repo secret. A relay
  // input is printed in the log, and the read-only job holds no secrets by
  // design, so a credentialled screenshot cannot be a relay task (owner, #518).
  "sec-share-series": { script: "scripts/sec-share-series-probe.mjs", args: () => [], needsTypescript: true },
  // Registrant facts (SIC, business address, incorporation, website, fiscal
  // year end, entity type, latest annual form) for every profiled symbol, from
  // SEC submissions. Read-only, no credentials. Prints the file into its log
  // for the session to reassemble — see the script header.
  "sec-registrants": { script: "scripts/sec-registrants.mjs", args: () => [], needsTypescript: true },
  // EDGAR's own state/country code list, with ISO-3166 codes attached by name
  // match, for the /stock page's Country row. Read-only, no credentials.
  "sec-country-codes": { script: "scripts/sec-country-codes.mjs", args: () => [] },
  // NOT A TASK, DELIBERATELY: scripts/window-fixture-diff.mjs reads the committed
  // fixture and a live symbol list and touches no network, so it runs locally.
  // Adding it here would imply it needs a runner, which is the kind of drift
  // this table exists to avoid.
  //
  // Read-only: captures the REAL filing rows for a date window so a check can
  // replay them through applyFilings. §17 previously built its own 281 synthetic
  // symbols and handed them forms from a modulo-5 round robin, which cannot be
  // evidence about what the route does with a real week of EDGAR.
  "sec-window-fixture": {
    script: "scripts/sec-window-fixture.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
    // It LIFTS the shipped parsers, and type erasure needs the TypeScript
    // compiler. See needsTypescript below for why that is one package and not
    // `npm ci`.
    needsTypescript: true,
  },
  // Read-only: the two venue reference files disagree about this universe, and
  // the totals alone cannot say which is wrong. Emits the per-symbol diff plus
  // what the 62.5%-by-dollar-volume figure becomes under each source. Needs the
  // dump for the universe AND for the bars that weight the swing.
  "listing-venue-diff": {
    script: "scripts/listing-venue-diff.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only: asks data.sec.gov/submissions whether a registrant is still
  // filing. Absence from the ticker file is not proof of deregistration, and
  // retiring a symbol on a lookup miss would discard its filing history.
  "sec-symbol-status": { script: "scripts/sec-symbol-status.mjs", args: (env) => [env.SYMBOLS ?? ""] },
  // Read-only: measures what it COSTS to find out whether a filer's numbers
  // changed -- conditional requests on companyfacts and submissions, both with
  // negative controls, plus whether submissions' isXBRL flag can tell a
  // quarter-carrying 6-K from a press release.
  "sec-reread": { script: "scripts/sec-reread-probe.mjs", args: (env) => [env.SYMBOLS ?? ""] },
  // Read-only, no dump: it fetches public endpoints only. The runner is a
  // DATACENTRE IP, so its Nasdaq result stands in for NEITHER the owner's
  // residential path NOR Vercel -- the script says so itself rather than
  // leaving the reader to remember it.
  "ipo-sources": { script: "scripts/ipo-source-probe.mjs", args: () => [] },
  // Run 2. Run 1's S-1/A sample turned out to be already-listed issuers filing
  // resale registrations, so its "price range 0/5" measured the sampling frame
  // rather than the filings. This one defines the cohort from 8-A12B -- the form
  // that means a class is being registered on an exchange -- and reports the hit
  // rate within it.
  "ipo-sec-cohort": { script: "scripts/ipo-sec-cohort-probe.mjs", args: () => [] },
  // Phase 0 of the IPO build brief. Measure and stop: the S-1/A extraction rate
  // with SPACs separated (a SPAC unit is fixed at $10 and has no range, which is
  // what made the earlier 1/4 meaningless), the price parser against a negative
  // control, and the age histogram the withdrawal cap needs.
  "ipo-phase0": { script: "scripts/ipo-phase0-probe.mjs", args: () => [] },
  // §4.10's three exclusion classes, measured before any is built. Checks the
  // ticker map for OTC coverage first, because if it carries OTC issuers then
  // class (a) already catches uplistings and class (c) costs nothing.
  "ipo-exclusions": { script: "scripts/ipo-exclusions-probe.mjs", args: () => [] },
  // Build order step 2: seed the 90-day window. Imports the SAME TypeScript
  // classifier the render calls -- Node 24 strips the types, so no build step
  // and no npm ci. If this re-implemented the rules, seeded and daily rows would
  // disagree about what an IPO is and both would look plausible.
  "ipo-seed": {
    script: "scripts/ipo-seed.mjs",
    args: () => [],
    // Imports the app's TypeScript classifier directly. Node's ESM loader needs
    // explicit extensions and lib/server/*.ts does not carry them, so a resolve
    // hook bridges the gap WITHOUT editing any app file or tsconfig. Node 24 on
    // the runner strips the types itself.
    nodeArgs: ["--import", "./scripts/lib/register-ts.mjs"],
  },
  // WHAT A SPAC COVER ACTUALLY SAYS. The share-count fix took correctness from
  // 29% to ~100% and its cost landed on the SPAC rows that dominate this page:
  // the one unit-shaped anchor matched 1 of 94 covers, so Deal Size is blank on
  // almost everything live. This prints the masthead and every dollar amount,
  // unit count and trust sentence — and deliberately carries NO candidate
  // patterns, so the output cannot be read as confirmation of a guess.
  "ipo-spac": {
    script: "scripts/ipo-spac-probe.mjs",
    args: () => [],
    nodeArgs: ["--import", "./scripts/lib/register-ts.mjs"],
  },
  // MEASURE THE SHARE COUNT, which Phase 0 never did -- it gated the PRICE
  // parser at 5/5 and left sharesOffered untested. The first live ingest run
  // produced ADARx at 88,250,216 shares (shares outstanding, not an offering)
  // and Alopexx at a $2.1M NYSE American IPO. Prints every "<n> shares" on each
  // cover with its sentence, so the rule is chosen by reading the filings
  // rather than by guessing a tighter regex.
  "ipo-shares": {
    script: "scripts/ipo-shares-probe.mjs",
    args: () => [],
    nodeArgs: ["--import", "./scripts/lib/register-ts.mjs"],
  },
  // THE FIRST LIVE RUN OF THE DAILY INGEST. Steps 3-5 have only ever been
  // fixture-proven; this calls ingestIpoWindow(), mergeIpoRecords() and
  // buildSecIpoTables() -- the shipped functions, not copies -- against real
  // EDGAR and prints both tables. Read-only by construction: the write is
  // app-side (app/api/jobs/ipo-refresh) because that is where the write token
  // is, and this job holds none.
  "ipo-ingest": {
    script: "scripts/ipo-ingest-probe.mjs",
    args: () => [],
    // Same reason as ipo-seed: it imports the app's .ts modules directly, and
    // Node's ESM loader needs the resolve hook to find their extensionless
    // relative specifiers.
    nodeArgs: ["--import", "./scripts/lib/register-ts.mjs"],
  },
  // Read-only: runs the SHIPPED extraction over five real filers' companyfacts
  // and diffs every extracted number against the frozen FMP ground truth in the
  // dump. Needs the dump for the FMP side and the network for the SEC side, and
  // the sandbox is refused data.sec.gov with 403 CONNECT. Lifts secFields.ts and
  // secExtract.ts, so type erasure needs the TypeScript compiler.
  "sec-extract": {
    script: "scripts/sec-extract-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
    needsTypescript: true,
  },
  // THE SAME PROBE AS ITS OWN "BEFORE". Removes the concepts this branch added
  // to the field chains, then reports exactly as sec-extract does — so the null
  // rate per field, both canaries and the identities table are comparable
  // line for line against the sec-extract run from the SAME commit.
  //
  // NOT `ref=main`, which was the first attempt and is the wrong instrument
  // twice over: it compares two runs of DIFFERENT CODE, so a difference is the
  // chains plus whatever else moved between the refs — and the probe crashes
  // on main anyway, on a loss-making filer's crossing string.
  "sec-extract-before": {
    script: "scripts/sec-extract-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
    needsTypescript: true,
    env: { REVERT_CHAINS: "1" },
  },
  // Read-only, NO CREDENTIAL: Phase 0 of the logo-harvest brief. Asks FMP's
  // image CDN whether it actually holds a logo for each symbol in the union
  // universe. The CDN needs no API key, so this belongs in the uncredentialled
  // job -- the FMP key stays out of Actions, per the static-profile README.
  // Fetches the Nasdaq symdir live for the Exchange and ETF columns, because
  // `exchange` is in static-profile.json's absentFields.blocked.
  "logo-coverage": { script: "scripts/logo-coverage-probe.mjs", args: () => [] },
  // Read-only: what one symbol COSTS to populate — fetch, parse, extract,
  // encode — measured sequentially and paced exactly as the route paces it, so
  // SEC_POPULATE_PER_RUN is sized against a number rather than an estimate.
  // Needs the dump for the universe and the network for companyfacts.
  "sec-populate-cost": {
    script: "scripts/sec-populate-cost.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
    needsTypescript: true,
  },
  // Read-only: does the page read IFRS filings now, and what is left when it
  // does. Runs the SHIPPED extractor over the ten FPIs that measured as empty
  // plus the universe FPIs the brief named plus a us-gaap control, and reports
  // which mapped ifrs-full tags never hit and which published tags nothing
  // maps. No dump, no credential; needs the network and the TypeScript
  // compiler for the lift.
  "sec-ifrs": {
    script: "scripts/sec-ifrs-probe.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
  },
  // Read-only: runs the SHIPPED view builder and the SHIPPED scorer over real
  // companyfacts and prints what a reader would see — the snapshot card's
  // strings, the growth table row by row with its base disclosed, and the
  // score with the components it could not read. Prints the OLD q[i+4] base
  // beside the new one so "unchanged for a dense filer" is checked rather than
  // asserted. Also diagnoses an empty cash-flow chain against the payload.
  // No dump, no credential; needs the network and the TypeScript compiler.
  "sec-period-match": {
    script: "scripts/sec-period-match-probe.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
  },
  // Read-only: what twelve stored quarters COST, measured against real
  // payloads before the window is changed. Reports the stored record size at
  // four window variants, whether the reader's hash gate moves (it cannot),
  // and how many of the eight RENDERED rows can reach a prior-year period at
  // each. No dump, no credential; needs the network and the TypeScript
  // compiler for the lift.
  "sec-window-size": {
    script: "scripts/sec-window-size-probe.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
  },
  // Read-only: captures a REAL StoredFactSet for a symbol and prints it
  // gzip+base64 with a SHA-256 of the plaintext, so a fixture can be committed
  // and proven byte-identical to what the runner produced. Actions artifacts
  // download via a blob host the sandbox cannot reach, which is why it goes
  // through the log.
  "sec-fixture": {
    script: "scripts/sec-fixture-capture.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
  },
  // Read-only: WHY a field renders "—" on a given filer. Lists every concept
  // the filer actually tagged in the period whose name could plausibly be the
  // figure, with values, and says whether our chain lists it. Answers "chain
  // gap or not tagged" with evidence instead of a guess.
  "sec-missing-fields": {
    script: "scripts/sec-missing-field-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  // Read-only: every balance-sheet-total and non-operating concept a filer
  // publishes for its newest periods, with values (earnings page round 2).
  "sec-concept-list": {
    script: "scripts/sec-concept-list-probe.mjs",
    args: () => [],
  },
  // Read-only: the NEXT question after sec-missing-fields. That probe says
  // whether the filer tagged the concept; this one says why a concept it DID
  // tag, and our chain DOES list, still renders blank — extraction, period
  // selection, or render. Prints the frame ladder, the stored periods and the
  // view's own numbers together.
  "sec-blank-cell": {
    script: "scripts/sec-blank-cell-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  // Read-only: the blast radius of a chain ADDITION, measured by running the
  // shipped extractor twice over one payload — once with the chain minus the
  // entries the edit added, once as it ships. Separates "cells that were null
  // now carry a figure" (the intent) from "cells that had a figure now have a
  // different one" (the risk).
  "sec-capex-blast": {
    script: "scripts/sec-capex-blast-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  // Read-only: the two questions a two-concept chain owes an answer to —
  // how many derived quarters the same-concept differencing rule NULLS, and,
  // where a filer publishes both concepts for one period, how far apart they
  // are. The first is measured twice (the extractor's own refusal notes, and a
  // run with the same-concept test mutated out) and the probe says so if the
  // two routes disagree.
  "sec-capex-concepts": {
    script: "scripts/sec-capex-concept-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  // THE SAME PROBE, AIMED AT THE OTHER UNMEASURED CHAIN EDIT — and it is a
  // SEPARATE TASK rather than an input because relay.yml's inputs live on the
  // DEFAULT BRANCH, so adding FIELD/DROP to the dispatch form would cost the
  // merge-and-wait this whole relay exists to remove. The task name carries
  // the parameters instead, which also makes "what was measured" answerable
  // from the run's title rather than from its form values.
  //
  // DROP names the ONE concept the VRT ruling added. Not "everything after the
  // first": this chain already had four entries, so the default would measure
  // what the other three contribute — a real question, and not this one.
  // WHAT THE ONE-CONCEPT-PER-FILER RULING COSTS, PER CELL. Sibling of the blast
  // probes: same two-runs-one-payload shape, but the switch is the FIELD FLAG
  // rather than the chain, because the chain is identical on both sides of this
  // question and a chain comparison would measure the wrong edit.
  // DOES EVERY QUARTER CELL COME FROM A QUARTER-LENGTH FRAME. Written for the
  // NVDA Q2 FY2027 report: net income $59.69B beside a derived operating cash
  // flow of $24.08B, which is the shape of a six-month figure in a quarter row.
  "sec-frame-lengths": {
    script: "scripts/sec-frame-length-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  // WHERE THE CASH CARD'S NET INCOME COMES FROM. sec-frame-lengths cleared the
  // AS-FILED half of the NVDA Q2 FY2027 report (0 offenders); this prints the
  // DIFFERENCED half — each cell's own span and operands — beside the filer's
  // raw ladder, which is the only way to check the arithmetic against what was
  // actually filed.
  "sec-cash-card": {
    script: "scripts/sec-cash-card-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  "sec-sticky-concepts": {
    script: "scripts/sec-sticky-concept-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  // THE REVENUE CHAIN'S FOURTH ENTRY, measured over the whole frozen universe
  // rather than the default 120: IncludingAssessedTax was added for AVAV's
  // FY2022/FY2023 years (earnings-page cleanup brief, A5).
  "sec-revenue-blast": {
    script: "scripts/sec-capex-blast-probe.mjs",
    args: () => [],
    needsTypescript: true,
    env: {
      FIELD: "revenue",
      DROP: "RevenueFromContractWithCustomerIncludingAssessedTax",
      LIMIT: "5000",
    },
  },
  "sec-sti-blast": {
    script: "scripts/sec-capex-blast-probe.mjs",
    args: () => [],
    needsTypescript: true,
    env: {
      FIELD: "shortTermInvestments",
      DROP: "DebtSecuritiesHeldToMaturityAmortizedCostAfterAllowanceForCreditLossCurrent",
    },
  },
  // Credentialled because Upstash lives in that job; performs NO writes.
  // Counts, from the STORED universe, how many SYMBOLS render the annual-filer
  // card and how many sets are still on the old quarter window.
  // Credentialled because Upstash lives in that job; performs NO writes.
  // Counts manifest entries with no CIK — the ones populationQueues cannot
  // select — split into those the ticker map can resolve and those only a cold
  // write can.
  "write-cik-gaps": {
    script: "scripts/cik-gap-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // THE ONE-OFF BACKFILL for stored sets no queue can select. DRY RUN unless
  // the `symbols` input is the word APPLY.
  //
  // THE FLAG RIDES `symbols` BECAUSE A NEW INPUT COSTS A MERGE. workflow_dispatch
  // only registers inputs declared on the DEFAULT BRANCH, so an `apply:` input
  // could not be dispatched from this branch at all until relay.yml reached main
  // -- the exact toll the task router exists to remove. Routing it here keeps
  // the whole thing dispatchable from a branch the same minute.
  "write-cold-cik-backfill": {
    script: "scripts/cold-cik-backfill.mjs",
    args: (env) => (String(env.SYMBOLS ?? "").trim().toUpperCase() === "APPLY" ? ["--apply"] : []),
    needsTypescript: true,
    writes: true,
  },
  // END-TO-END, NOT A READ OF THE SOURCE: builds the app, starts it twice with
  // FMP broken two different ways, and asserts the earnings page still 200s
  // with its SEC content and its no-history fallback. Credentialled because the
  // BUILD needs Upstash; it performs no writes.
  "write-bad-key-earnings": {
    script: "scripts/bad-key-earnings-probe.mjs",
    args: () => [],
    writes: true,
  },
  // WHY THE POPULATE BACKLOG MOVED AND HOW LONG REWINDOW TAKES, simulated with
  // the shipped populationQueues rather than divided. Credentialled, read-only.
  // WHETHER A CHAIN EDIT ENLARGES THE RE-READ QUEUE: stored sets already
  // chain-stale vs current under main's chains (which the edit re-queues).
  // Credentialled, read-only: one manifest GET.
  "write-chain-bump-census": {
    script: "scripts/sec-chain-bump-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READ-ONLY DESPITE THE PREFIX: earnings page round 2's four gaps counted
  // over the manifest with the shipped extraction, before/after the chain
  // edits, plus the re-read backlog the edit causes. GETs only.
  // SYMBOLS="SHARD i/n" splits the manifest across parallel runners.
  "write-round2-gap-census": {
    script: "scripts/sec-round2-gap-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-queue-projection": {
    script: "scripts/sec-queue-projection.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // REPORT DATES AND TIMING FROM EDGAR, measured against the stored FMP dates.
  // Credentialled to read the store; fetches EDGAR itself. No writes.
  // SEEDS THE REPORT-DATES STORE for a preview, using the shipped functions.
  // A real write, to a key nothing on main reads; the cron overwrites it once
  // the branch merges.
  // HOW MANY SYMBOLS THE FISCAL-YEAR CALIBRATION RELABELS, and which.
  // Credentialled to read the store; fetches companyfacts only for the filers
  // a relabel is arithmetically possible for. No writes.
  // RE-EXTRACT AND REWRITE NAMED FACT SETS with the shipped extraction, so a
  // labelling change can be eye-checked before the rewindow queue reaches it.
  // Refuses an empty symbol list; it is not a backfill.
  "write-refresh-sets": {
    script: "scripts/sec-refresh-sets.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    needsTypescript: true,
    writes: true,
  },
  // WHY A STORED SET'S NEWEST PERIOD IS OLDER THAN THE FILER'S NEWEST FILING.
  // Credentialled to read the store and the report-date records; fetches
  // submissions. No writes.
  // CAN THE DUE STRIP RENDER A ROW AT ALL? Measured before the DueInput
  // producer is written, because three of DueInput's five fields cannot be
  // read from the store as it stands and whether that matters is a question
  // about production data. Also prices the filerCategory decision by running
  // the SHIPPED selectDue twice, one field apart, rather than arguing it.
  //
  // READ-ONLY DESPITE THE PREFIX -- same as write-beta-mu and
  // write-queue-projection. `write-` is the CREDENTIAL boundary, not a claim
  // that the task mutates anything; the report-dates store lives in Upstash and
  // the credentials live in that job.
  "write-due-input-census": {
    script: "scripts/due-input-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READ-ONLY DESPITE THE PREFIX: the early-2.02 mispick measured across the
  // universe (review of #512/#513 items A, B, E). Reads the stored records,
  // the fact sets, SEC submissions and the production pages; writes nothing.
  "write-early-202-census": {
    script: "scripts/early-202-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READS ONLY: the pairing rewrite's per-run counters and the drained count.
  "write-report-dates-rewrite-progress": {
    script: "scripts/report-dates-rewrite-progress.mjs",
    args: () => [],
    writes: true,
  },
  // READS ONLY: the same-day tie-break flips, a general current-period rule
  // scored on history, and why the thin FPIs are thin (review of #515).
  "write-pairing-followups": {
    script: "scripts/pairing-followups-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READS ONLY: which fact sets sec-facts failed on, reproduced with the
  // shipped fetch rule and extraction over the queues failures stay in.
  "write-sec-facts-failures": {
    script: "scripts/sec-facts-failures.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READS ONLY: why sec-facts times out -- last runs, next queues, fetch cost.
  "write-sec-facts-timeout-diagnosis": {
    script: "scripts/sec-facts-timeout-diagnosis.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READS ONLY: every stored fact set's h against secFieldsHash (readFactSet's gate).
  "write-sec-factset-readability": {
    script: "scripts/sec-factset-readability.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READ-ONLY DESPITE THE PREFIX, same as write-due-input-census above:
  // `write-` is the CREDENTIAL boundary, and the report-dates store lives in
  // Upstash behind credentials that only the write- half of relay.yml carries.
  // Renders the ticker search's answer for the cut plus a handful of names a
  // reader would actually type, against the live record.
  "write-symbol-outlook": {
    script: "scripts/symbol-outlook-render.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READ-ONLY IN PRACTICE, credentialled for the READ, same as
  // write-symbol-outlook. The next-report tile and card, BEFORE and AFTER the
  // 30-day-band change (owner decision 2026-09-23), rendered against the live
  // record. SYMBOLS overrides the default six.
  "write-next-report-band": {
    script: "scripts/next-report-band-render.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-stale-period-census": {
    script: "scripts/sec-stale-period-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // Every symbol, not only those >100 days old: a quarter-behind page is 30-90
  // days stale, under the default threshold (#535 COWORK #2 defect #1).
  "write-stale-period-census-all": {
    script: "scripts/sec-stale-period-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
    env: { STALE_DAYS: "0" },
  },
  "write-fy-naming-census": {
    script: "scripts/fiscal-year-naming-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-report-dates-seed": {
    script: "scripts/sec-report-dates-seed.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-report-dates": {
    script: "scripts/sec-report-dates-probe.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // MANIFEST ENTRIES WHOSE STAMP IS BEHIND THEIR OWN STORED SET, counted.
  // Credentialled to read the manifest and the fact sets; writes nothing.
  // WHY ONE REPORT VANISHES FROM THE PRICE-REACTION CARDS. Runs the shipped
  // reaction calculation over the full series AND the bounded window and
  // prints both, so the window is convicted or exonerated by the same data.
  // Credentialled to read the bar cache and the report dates; writes nothing.
  "write-reaction-window": {
    script: "scripts/reaction-window-diagnosis.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READS ONLY, but the bars and the report dates both live in Upstash and the
  // credentials live in the write- job. The prefix is the CREDENTIAL boundary,
  // not a claim about what the script does.
  // READS ONLY (Upstash + data.sec.gov for concept names). Counts the two
  // blast radii the ABVX diagnosis raised before either change is made.
  // READS ONLY. Counts how many symbols in the SITE's universe have no CIK in
  // the committed registrant file, which is exactly the set the earnings route
  // 404s on. Credentialled because the universe lives in Upstash.
  // READS ONLY, NO CREDENTIALS NEEDED — it compares the committed registrant
  // file against SEC's live one and the curated universe, all of which are
  // either in the repo or on data.sec.gov. Hence no write- prefix.
  "ticker-snapshot-scope": {
    script: "scripts/ticker-snapshot-scope-probe.mjs",
    args: () => [],
    needsTypescript: true,
  },
  "write-no-cik-scope": {
    script: "scripts/no-cik-scope-probe.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // WHICH STANDARD A SET IS READ UNDER, and how many sets carry both us-gaap
  // and ifrs-full. READ-ONLY despite the prefix: credentials for the store,
  // companyfacts for the mixed sets only. Owner question on #514.
  "write-accounting-census": {
    script: "scripts/sec-accounting-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-tie-ifrs-census": {
    script: "scripts/sec-tie-and-ifrs-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READS ONLY. The stored SEC fact set lives in Upstash and the credentials
  // live in this job, so the write- prefix is the CREDENTIAL boundary again,
  // not a claim about what the script does. It reaches data.sec.gov for
  // CONCEPT NAMES only — never to re-extract, because the whole point is to
  // read the object the page reads.
  "write-stored-set": {
    script: "scripts/sec-stored-set-probe.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // BETA FROM BARS ALREADY IN REDIS — the worked example the read-only probe
  // could not produce, because the sandbox has no Upstash credentials and every
  // bars provider is refused at the gateway.
  //
  // READ-ONLY DESPITE THE PREFIX. It issues GETs for two history keys and
  // nothing else. `write-` here means "needs the credentials", which is the
  // boundary this file and relay.yml both enforce; it does not mean the task
  // mutates anything. See the routing docblock at the top of this file.
  "write-beta-mu": {
    script: "scripts/beta-worked-example.mjs",
    args: () => [],
    // PINNED ON THE TASK, so the task NAME is the record of what was measured.
    // relay.yml's inputs live on the default branch and have no symbol field;
    // pinning here is what lets a branch measure a named symbol without a merge.
    // THE PIN IS THE CANDIDATE LIST, not one symbol. Run 35597733409 scanned
    // ^GSPC alone and nothing else, because this env PIN WINS over the ambient
    // environment by design (see the note where `env` is applied below) — so
    // the script's own multi-candidate default never applied. The router was
    // right and the pin was wrong.
    env: { BETA_SYMBOL: "MU", BETA_BENCH: "^GSPC,SPY,VOO,IVV,QQQ,DIA" },
    // scripts/lib/source-code.mjs imports typescript to strip comments before
    // the prefix regexes run, and the credentialled job installs only
    // @upstash/redis. Same flag as every other task that lifts from source.
    needsTypescript: true,
    // NEEDS THE CREDENTIALS; PERFORMS NO WRITES. Same declaration and the same
    // reason as "write-bad-key-earnings" above. The flag is what the router
    // checks against the name — the two must agree or it fails closed, which is
    // how this task failed its first dispatch (run 35597058149) rather than
    // running uncredentialled and reporting "no cached bars".
    writes: true,
  },
  // READ-ONLY DESPITE THE PREFIX. The /earnings-calendar grid's three FMP calls
  // (candidates, names, quote exchange) measured against the SEC record and the
  // price pool. The FMP side is read out of what production already cached in
  // Redis -- no FMP key exists in this environment -- and the SEC side from the
  // report-dates store plus live submissions. GETs only; `write-` is the
  // CREDENTIAL boundary. claude/grid-fmp-measurement-2026-09-23.md
  "write-grid-fmp-measurement": {
    script: "scripts/grid-fmp-measurement.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  // READ-ONLY DESPITE THE PREFIX. What closes the grid's in-universe SEC gaps
  // (6-K results, missing records, stale records), projected coverage, job-time
  // cost, and SEC-only market-cap floor counts. GETs only; `write-` is the
  // CREDENTIAL boundary. claude/grid-sec-gaps-measured-2026-09-23.md
  "write-grid-sec-gaps": {
    script: "scripts/grid-sec-gaps.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-valuation-price": {
    script: "scripts/valuation-price-probe.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-manifest-stamp-census": {
    script: "scripts/manifest-stamp-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-annual-filer-census": {
    script: "scripts/annual-filer-census.mjs",
    args: () => [],
    needsTypescript: true,
    writes: true,
  },
  "write-stooq-ingest": {
    script: "scripts/stooq-ingest.mjs",
    args: (env) => [env.SYMBOLS ?? ""],
    writes: true,
  },
  // Read-only, NO credential and NO FMP: measures how well a filer's next
  // results date can be predicted from its own filing history alone. Asked
  // before deciding whether the earnings calendar's FORWARD half can come off
  // FMP at all -- §4 of the off-FMP brief proposes filing cadence as the
  // fallback and nothing had measured it.
  "sec-results-dates": { script: "scripts/sec-results-date-predictability.mjs", args: () => [] },
  // Read-only, no credential: does a filer ANNOUNCE its next results date in an
  // 8-K (item 7.01/8.01) ahead of time? The last input to the forward-calendar
  // decision -- predicting the date from cadence was measured and is weak, so
  // the question is whether it can be READ instead of predicted. Needs the dump
  // for the universe and for market caps: "do companies do this" and "do the
  // companies a calendar is searched for do this" are different questions.
  "sec-scheduling": {
    script: "scripts/sec-scheduling-announcements.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only, no credential, submissions ONLY (no document fetching): simulates
  // a "due to report" list over the past 12 months across the FULL analysis
  // universe and sweeps k. List size scales with the universe, so a sample
  // cannot answer it. Needs the dump for the analysis universe.
  // DOES A 30-DAY WINDOW SURVIVE WHAT AN EXACT DATE DID NOT? The day-level
  // forward calendar was measured and killed (2 of 48 filers inside their own
  // p90 band; 0 of 276 8-K scheduling announcements in the needed band). The
  // coarser claim -- "expected to report in the next 30 days" -- is a different
  // claim and had never been measured. Same pairing and walk-forward as
  // sec-results-date-predictability, scored on a ROLLING window, over the FULL
  // universe rather than a hand-picked sample, and against a computed
  // list-everyone-every-day baseline.
  //
  // Read-only, no credential; needs the dump for the universe and the network
  // for submissions.
  "window30": {
    script: "scripts/sec-window30-predictability.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // THE SAME PROBE WITH THE PAGING CAP LIFTED. 81 filers were excluded for
  // thin history and 5 of them hit this script's own 2-page budget, so their
  // thinness is OUR limit or THEIRS and the first run could not say which.
  // A separate task rather than an input, because relay.yml's inputs live on
  // the default branch -- the task name is the record of what was measured.
  "window30-recheck": {
    script: "scripts/sec-window30-predictability.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
    env: { RECHECK_THIN: "1" },
  },
  "sec-due-sweep": {
    script: "scripts/sec-due-to-report-sweep.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // NO NETWORK AT ALL. Re-slices the due-to-report simulation from the fact set
  // the sweep persists (data/sec/due-sweep-facts.json), which the relay's own
  // artifact carries. Dispatch it with run_id/artifact_name pointing at a
  // sec-due-sweep run: that artifact holds both the fact set and the step 0
  // dump's universe.json, so the locate step resolves.
  "sec-due-reslice": {
    script: "scripts/sec-due-reslice.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // STAGE 0, BLOCKING. No network, no Redis: distils the analyst-consensus series
  // out of the frozen Step 0 dump into a compact permanent archive. The estimates
  // are the only thing on the earnings page that cannot be re-derived from public
  // filings, and they sit on a 24-hour TTL, so they die within a day of the FMP
  // key lapsing rather than decaying slowly.
  "consensus-freeze": {
    script: "scripts/consensus-freeze.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only, NO credential and NO network: ranks the analysis universe by the
  // frozen pool's market cap and emits the due strip's static top-50 membership.
  // The strip is a CUT, and this generates the cut. Membership only -- no cap
  // figure is carried out of the run.
  // WHICH UNIT A FOREIGN PRIVATE ISSUER'S EPS IS FILED IN. #489 suppressed the
  // market cap for five ADS filers and recorded the P/E beside it as an OPEN
  // question, explicitly not to be settled by assuming symmetry. This settles
  // it from the filers' own arithmetic. Read-only, uncredentialled, no dump.
  "ads-eps-unit": { script: "scripts/ads-eps-unit-probe.mjs", args: () => [] },
  // CAN A MULTI-CLASS FILER'S SHARES BE SPLIT BY CLASS AT ALL? BUILD-BRIEF §5
  // prescribes summing each class's shares x that class's close; secFields.ts
  // records from measurement that companyfacts carries no class label. Both
  // cannot be acted on, and guessing produces a plausible wrong market cap.
  "multiclass-shares": { script: "scripts/multiclass-shares-probe.mjs", args: () => [] },
  "due-strip-universe": {
    script: "scripts/due-strip-universe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  // Read-only, NO credential and NO network: reads the frozen Step 0 dump and
  // reports whether the empty-day poisoning has already fired in production.
  // The live read happens in the Step 0 job under Upstash's read-only token;
  // this half only does arithmetic on the result.
  // MEASUREMENT ONLY, no fix: separates the three states due-strip-universe's
  // single "source: none" verdict cannot tell apart -- the symbol is ABSENT
  // from a source, present with a NULL cap, present under a key capOf does not
  // read, or present under a different SPELLING. Different owners, one verdict
  // today. Lifts CAP_SOURCES and capOf out of due-strip-universe.mjs so the
  // probe cannot measure a set the consumer does not use. Read-only, no
  // credential, NO NETWORK; needs a step 0 dump.
  "pricepool-cap-gap": {
    script: "scripts/pricepool-cap-gap-probe.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
  "earnings-poisoning": {
    script: "scripts/earnings-poisoning-scan.mjs",
    args: (env) => [env.DUMP_DIR ?? ""],
    needsDump: true,
  },
};

const argv = process.argv.slice(2);
const allowWrites = argv.includes("--allow-writes");
const task = argv.find((a) => !a.startsWith("--"));

if (!task) {
  console.error("FATAL: no task given. Usage: relay-run.mjs <task> [--allow-writes]");
  console.error(`Known tasks: ${Object.keys(TASKS).join(", ")}`);
  process.exit(2);
}

const spec = TASKS[task];
if (!spec) {
  // A CLEAR FAILURE, WITH THE LIST. An unknown task is most often a typo in the
  // dispatch form, and discovering it as "module not found" three minutes into a
  // runner is the round trip this whole design exists to avoid.
  console.error(`FATAL: unknown task "${task}".`);
  console.error(`Known tasks: ${Object.keys(TASKS).join(", ")}`);
  console.error(
    "Add it to TASKS in scripts/relay-run.mjs — on a branch, and dispatch the " +
      "relay with ref pointed at that branch. No workflow edit is needed."
  );
  process.exit(2);
}

// THE SECOND HALF OF THE BOUNDARY. relay.yml routes by the write- prefix; this
// refuses to act on a write task unless the caller says it is the credentialled
// job. The two must agree, and disagreeing fails closed.
const named = task.startsWith("write-");
if (named !== Boolean(spec.writes)) {
  console.error(
    `FATAL: naming/permission mismatch for "${task}". A task that writes MUST be ` +
      `named with the write- prefix, and a task named write- MUST declare ` +
      `writes: true. The prefix is what routes it to the credentialled job, so a ` +
      `disagreement here means the routing is wrong.`
  );
  process.exit(2);
}
if (spec.writes && !allowWrites) {
  console.error(
    `FATAL: "${task}" writes, and this invocation was not granted writes. It is ` +
      `running in the read-only relay job, which holds no credentials. Refusing ` +
      `rather than failing later with an authentication error that would read as ` +
      `a bad secret.`
  );
  process.exit(2);
}
if (!spec.writes && allowWrites) {
  console.error(
    `FATAL: "${task}" does not write, but was invoked from the credentialled job. ` +
      `Read-only work must not run where the write token is present — that is the ` +
      `whole point of the split.`
  );
  process.exit(2);
}

if (!fs.existsSync(spec.script)) {
  console.error(
    `FATAL: "${task}" routes to ${spec.script}, which does not exist on this ref.`
  );
  console.error(
    "Either the script has not been written yet, or the relay was dispatched " +
      "against a ref that predates it. Dispatch with ref pointed at the branch " +
      "that carries the script."
  );
  process.exit(2);
}
// TYPESCRIPT, ON DEMAND, AND GENUINELY ONLY TYPESCRIPT.
//
// The read-only job deliberately runs no `npm ci` -- relay.yml states the
// property plainly: not installing the Upstash client is what keeps this job
// unable to reach the database even if a future edit tried to. A task that LIFTS
// a shipped function needs ts.transpileModule to erase types, so it needs the
// compiler.
//
// THE OBVIOUS FIX DOES NOT WORK, AND IT FAILS SILENTLY. `npm install --no-save
// typescript` run in the repo root resolves the WHOLE of package.json first:
// measured on run 34830229705, "added 438 packages in 10s" -- @upstash/redis
// among them. It looked like a one-package install and was a full tree, which
// would have quietly voided the property the workflow comment describes.
//
// So the install happens in an EMPTY temporary directory, where typescript has
// no dependencies of its own and npm adds exactly one package, and only that
// package is copied into ./node_modules. Verified: `npm install --no-save
// --no-package-lock typescript@^5` in an empty dir reports "added 1 package".
//
// AND IT LIVES HERE, NOT IN relay.yml, for the reason in this file's header: a
// workflow edit costs a merge-and-wait before it can run once.
if (spec.needsTypescript) {
  let present = false;
  try {
    await import("typescript");
    present = true;
  } catch {
    present = false;
  }
  if (!present) {
    // Pinned to the same range the repo builds with, so erase() behaves here
    // exactly as it does in check-all. A floating install could change what a
    // lifted function's body looks like, which is the one thing this must not do.
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const range = pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript;
    if (!range) {
      console.error("FATAL: package.json declares no typescript, but this task lifts TS source.");
      process.exit(2);
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relay-ts-"));
    console.log(`relay: installing typescript@${range} in isolation (NOT npm ci, NOT the repo tree)`);
    const r = spawnSync(
      "npm",
      ["install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", `typescript@${range}`],
      { cwd: tmp, stdio: "inherit" }
    );
    const from = path.join(tmp, "node_modules", "typescript");
    if (r.status !== 0 || !fs.existsSync(from)) {
      console.error(
        `FATAL: could not install typescript (exit ${r.status}). This task lifts functions ` +
          `from .ts sources and cannot erase types without it. Reimplementing the parsers ` +
          `instead is not the fallback -- a capture that parses with its own code is not ` +
          `evidence about the shipped parser.`
      );
      process.exit(2);
    }
    // ONE DIRECTORY, COPIED BY NAME. Anything else npm happened to leave in the
    // temp tree stays there.
    fs.mkdirSync("node_modules", { recursive: true });
    fs.cpSync(from, path.join("node_modules", "typescript"), { recursive: true });
    const installed = fs.readdirSync(path.join(tmp, "node_modules")).filter((d) => !d.startsWith("."));
    console.log(`relay: typescript in place (isolated install held ${installed.length}: ${installed.join(", ")})`);
  }
}

if (spec.needsDump && !process.env.DUMP_DIR) {
  console.error(
    `FATAL: "${task}" reads the frozen dump but DUMP_DIR is empty — the download ` +
      `or locate step did not run. Dispatch with a run_id.`
  );
  process.exit(2);
}

const args = spec.args(process.env).filter((a) => a !== "");
// ── A TASK MAY PIN ITS OWN PARAMETERS, AND THEY WIN ──────────────────────
// relay.yml's inputs are fixed on the default branch, so a task needing a knob
// the form does not have would otherwise cost a merge. `env` puts the knob on
// the TASK instead, and the task name becomes the record of what was measured.
//
// SPEC WINS OVER THE AMBIENT ENVIRONMENT, deliberately. If the surrounding env
// could override it, a stray variable on a runner would silently change what a
// named task measures while the run still reported the task's name — a report
// that says one thing and did another.
const env = { ...process.env, ...(spec.env ?? {}) };
if (spec.env) {
  console.log(`relay: ${task} pins ${Object.entries(spec.env).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}
console.log(`relay: ${task} -> node ${spec.script} ${args.join(" ")}`);
// nodeArgs are flags for the node PROCESS, not arguments to the task. Only a
// task that declares them gets them, so nothing else changes behaviour.
const nodeArgs = spec.nodeArgs ?? [];
if (nodeArgs.length) console.log(`relay: node flags ${nodeArgs.join(" ")}`);
const res = spawnSync("node", [...nodeArgs, spec.script, ...args], { stdio: "inherit", env });
process.exit(res.status ?? 1);
