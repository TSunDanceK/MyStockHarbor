// The stored field list, as DATA rather than as knowledge held by the extractor.
//
// WHY `kind` IS ON THE FIELD DEFINITION AND NOT IN THE DIFFERENCING CODE.
//
// US cash-flow statements are filed YEAR-TO-DATE CUMULATIVE: Q1 covers 3 months,
// Q2 six, Q3 nine, the 10-K twelve. Only Q1 is a true three-month period, so
// every other quarter must be derived by differencing (hide-list-verdict §2 --
// a Q3 figure read straight is roughly three times too large and looks entirely
// plausible on the page).
//
// Balance-sheet items are the opposite: INSTANT concepts, a position at a
// date. Differencing them produces a change-in-balance where a balance was
// asked for -- a plausible number, wrong, and wrong in a way no total reveals.
//
// That distinction is PER FIELD, not per statement. Leaving it in the
// differencing path means the code has to know which statement each of 43
// fields came from, and a field added later inherits whatever the surrounding
// branch happened to do. Declaring it here means the differencing walks this
// list and CANNOT reach an instant field: the property is structural rather
// than remembered.
//
// See scripts/check-sec-extract.mjs, which asserts that every balance-sheet
// field is instant and that no instant field is ever differenced.

/**
 * How a period's value relates to the period itself.
 *
 * THREE OF THE FOUR MUST NEVER BE DIFFERENCED, and the reasons differ. The first
 * version of this file had only the cumulative/instant split, which is the split
 * between the income statement and the balance sheet -- and it silently
 * differenced the two share counts and the two EPS figures, because they sit on
 * the income statement and are durations. They are durations that do not ADD.
 */
export type FieldKind =
  /** Filed year-to-date, and additive. Q1 as filed; Q2..Q4 by differencing. */
  | "duration-cumulative"
  /**
   * A WEIGHTED AVERAGE over the period. Never differenced: a nine-month average
   * minus a six-month average is not the third quarter's average, it is noise.
   * Measured, not argued -- differencing these printed a share count of
   * -668,000 for PLAB and -44.4M for AAPL (relay run 34931769452).
   */
  | "duration-average"
  /**
   * A RATIO. Never differenced: a ratio of sums is not the sum of ratios, and
   * the error is proportional to how much the denominator moved within the year.
   * AAPL's differenced Q4 EPS came out 1.84 against a filed 1.85, which is close
   * enough to look right and is luck rather than correctness.
   */
  | "duration-ratio"
  /** A position at an instant. NEVER differenced. */
  | "instant";

export type Statement = "income" | "cash-flow" | "balance-sheet";

export type FieldDef = {
  key: string;
  kind: FieldKind;
  statement: Statement;
  /** XBRL taxonomy. `dei` is the cover page, not us-gaap. */
  taxonomy: "us-gaap" | "dei";
  /**
   * THE SAME LINE UNDER `ifrs-full`, for foreign private issuers.
   *
   * ── WHY THIS IS NOT A TAIL ────────────────────────────────────────────────
   * companyfacts namespaces facts BY TAXONOMY. An IFRS filer's complete
   * financial statements are in the payload; they are simply under `ifrs-full`,
   * which every one of these chains used to ignore. The page then told the
   * reader the COMPANY did not file the data -- a false statement about
   * Ryanair, AstraZeneca, HSBC and everyone like them.
   *
   * 49 of the 55 periodic filers in the measured window were 6-K filers, i.e.
   * foreign private issuers, and 10 of 40 sampled symbols extracted to nothing
   * for exactly this reason. HSBC, AZN, GSK, NVS, BIDU, SAN, LYG, VALE, ZTO and
   * ABEV are all in the universe. ARM files us-gaap, which is precisely why
   * auditing the page on ARM could not have caught it.
   *
   * ── RANKED AFTER THE PRIMARY CHAIN, NOT INSTEAD OF IT ─────────────────────
   * rowsForField appends these BELOW the us-gaap entries in the same rank
   * order, so the existing per-period resolver needs no new rule: a filer that
   * tags both (some dual-listers do) keeps the us-gaap reading, and an IFRS
   * filer falls through to these because the entries above it are empty. Same
   * resolver, same differencing, same identities.
   *
   * ── AND THE FIELD LIST IS UNCHANGED ───────────────────────────────────────
   * No key added, none removed, order identical -- so secFieldsHash does not
   * move and not one stored fact set is invalidated. What DOES need re-reading
   * is the sets that came back EMPTY under the old chains; see
   * secChainsHash and the empty-set retry in secColdFetch.
   */
  ifrsChain?: string[];
  /**
   * Candidate tags, tried IN ORDER, first hit wins, resolved PER PERIOD.
   * Never summed: two entries for one period is an overlap, not a total.
   */
  chain: string[];
  /** companyfacts is keyed by unit; this is the units key to read. */
  unit: "USD" | "shares" | "USD/shares";
  /**
   * Whether ONE period key may carry only ONE value.
   *
   * True for every field but one: a period with two values is a restatement,
   * and the newest accession wins. `sharesOutstandingCover` is the exception --
   * a multi-class filer's classes are genuinely several values for one period
   * and companyfacts gives no way to tell them apart, so they must be reported
   * as ambiguous rather than reduced to one. Default true; see that field.
   */
  singleValued: boolean;
  /**
   * For a `duration-ratio` only: how to COMPUTE the period when the filer did
   * not publish that exact frame. Both operands must be present for the same
   * period or the value stays null -- there is no partial fallback, because a
   * quarter's earnings over a year's share count is a wrong number that looks
   * like a right one.
   */
  ratioSource?: { numerator: string; denominator: string };
  /**
   * ONE CONCEPT PER FILER, CHOSEN ONCE, WITH NO PER-PERIOD FALLBACK.
   *
   * ── WHY THIS IS NOT THE DEFAULT ───────────────────────────────────────────
   * The default policy (CHAIN_RESOLUTION_POLICY, `preferredTag`) picks the
   * concept covering the filer's newest period and lets the chain fill periods
   * where that one is absent. That is right where the entries are the SAME
   * MEASURE under two spellings — AAPL's revenue is `Revenues` before 2018 and
   * `RevenueFromContractWithCustomer...` after, and the column should follow the
   * filer's presentation without losing rows.
   *
   * It is wrong where the entries are DIFFERENT MEASURES. capex's two are:
   * measured over 119 SYMBOLS, three file both for a period still stored and
   * disagree by 78.9% (CRM), 37.6% (GE) and 14.8% (SCHW). A fallback that fills
   * an absent period from the other concept makes one column mean two things
   * down its own length, and the 78.9% is how wrong that can be.
   *
   * So on a field marked here:
   *   - the filer's concept is the HIGHEST-RANKED chain entry it files for any
   *     period inside the retention window, decided once for the whole column;
   *   - every other concept is refused outright, so a period the chosen one does
   *     not cover reads "Not reported" rather than switching.
   *
   * A REFUSAL IS A COST AND IT IS THE POINT. Some cells that had a figure will
   * read "Not reported" instead. "Not reported" is a true statement about the
   * chosen measure; the figure it replaces was a different measure wearing the
   * same column heading.
   */
  oneConceptPerFiler?: boolean;
};

// The per-block literals below carry only what VARIES. `satisfies` on each
// array supplies the contextual type, so `unit: "USD"` stays the literal type
// rather than widening to `string` before the `.map()` re-adds the rest.
type Seed = Pick<FieldDef, "key" | "chain" | "unit"> &
  Partial<Pick<FieldDef, "ifrsChain" | "oneConceptPerFiler">>;
type BalanceSeed = Seed & Pick<FieldDef, "taxonomy"> & Partial<Pick<FieldDef, "singleValued">>;

// THE FOUR INCOME-STATEMENT LINES THAT ARE DURATIONS BUT DO NOT ADD. Held as a
// table beside the list rather than typed onto each line, so the exception is
// visible in one place instead of being four easily-missed words in a long array.
const NON_ADDITIVE_INCOME: Record<string, FieldKind | undefined> = {
  epsBasic: "duration-ratio",
  epsDiluted: "duration-ratio",
  sharesBasic: "duration-average",
  sharesDiluted: "duration-average",
};

// The fallback for a ratio the filer did not publish for that exact frame.
// NOTE the consequence, which is measured and not hypothetical: the denominator
// is a `duration-average`, so it is NULL for Q4 (never filed as a 3-month
// frame), and Q4 EPS therefore comes out null too. That is the honest answer
// under "do not derive the average"; see claude/step3-five-symbol-diff for the
// measured null rate.
const RATIO_SOURCE: Record<string, { numerator: string; denominator: string } | undefined> = {
  epsBasic: { numerator: "netIncome", denominator: "sharesBasic" },
  epsDiluted: { numerator: "netIncome", denominator: "sharesDiluted" },
};


// ── The ifrs-full mapping, as ONE TABLE rather than a word on each line ─────
//
// Held here, beside the lists, for the same reason NON_ADDITIVE_INCOME is: the
// exception is visible in one place instead of being 40 easily-missed clauses
// spread through three arrays, and a correction is a one-line edit against
// evidence rather than a hunt.
//
// A KEY ABSENT FROM THIS TABLE IS A DELIBERATE GAP, not an oversight, and the
// page renders it null rather than approximating. `cashIncludingRestricted` has
// no IFRS equivalent -- restricted cash is not a separate IFRS concept -- and
// `nonOperatingIncomeExpense` has no single tag that means the same thing.
// Inventing a near-match for either is how a plausible wrong number gets in.
//
// CORRECTED AGAINST 20 REAL FILERS (relay 34970388423), not written from
// memory of the taxonomy and left there. Four entries matched nothing in any
// payload and are deleted; `WeightedAverageShares` and the lowercase
// `AdjustmentsForSharebasedPayments` were added because the filers publish
// those and not the spellings the taxonomy documents.
//
// EVERY TAG BELOW WAS CONFIRMED PRESENT IN REAL companyfacts PAYLOADS by
// scripts/sec-ifrs-probe.mjs, which also reports the ifrs-full tags a filer
// publishes that this table does NOT map. Chains are ordered by how many of the
// probed filers used them, so the common spelling is tried first.
const IFRS_CHAIN: Record<string, string[] | undefined> = {
  // Income statement
  revenue: ["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods"],
  costOfRevenue: ["CostOfSales"],
  grossProfit: ["GrossProfit"],
  researchAndDevelopment: ["ResearchAndDevelopmentExpense"],
  // AdministrativeExpense (published by 6 of 20) and DistributionCosts (4 of
  // 20) are KEPT although neither won a cell: both are present in real payloads
  // and simply outranked by SellingGeneralAndAdministrativeExpense (9 of 20).
  // Published-but-outranked is not the same as absent, and only the second is a
  // guess worth deleting. The probe reports both columns for exactly this
  // distinction — the first version reported only "never won" and would have
  // had these two deleted on no evidence.
  sellingGeneralAndAdministrative: [
    "SellingGeneralAndAdministrativeExpense",
    "AdministrativeExpense",
    "DistributionCosts",
  ],
  // OtherOperatingIncomeExpenseNet deleted: it is a us-gaap spelling that was
  // copied into the IFRS column and exists in no probed ifrs-full payload.
  otherOperatingExpense: ["OtherExpenseByFunction"],
  operatingIncome: ["ProfitLossFromOperatingActivities"],
  interestExpense: ["FinanceCosts", "InterestExpense"],
  preTaxIncome: ["ProfitLossBeforeTax"],
  incomeTaxExpense: ["IncomeTaxExpenseContinuingOperations"],
  // ProfitLoss is TOTAL, including minority interest; the parent-only tag is
  // ranked first for the same reason stockholdersEquity prefers the parent tag.
  netIncome: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
  netIncomeToNoncontrollingInterest: ["ProfitLossAttributableToNoncontrollingInterests"],
  epsBasic: ["BasicEarningsLossPerShare"],
  epsDiluted: ["DilutedEarningsLossPerShare"],
  // MEASURED CORRECTION. Both original guesses matched nothing in 20 filers,
  // while `WeightedAverageShares` — which was not in the table — is the most
  // published unmapped tag of all, in 16 of them. The taxonomy has the long
  // spellings; filers use the short one.
  sharesBasic: ["WeightedAverageShares"],
  sharesDiluted: ["AdjustedWeightedAverageShares"],

  // Cash flow
  operatingCashFlow: ["CashFlowsFromUsedInOperatingActivities"],
  // PaymentsToAcquirePropertyPlantAndEquipment deleted: a us-gaap spelling
  // copied into the IFRS column, published by 0 of 20 probed filers. The one
  // that remains is published by 15 of them.
  capex: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
  // LOWERCASE `b`. The camel-case guess matched nothing; the spelling filers
  // actually use is AdjustmentsForSharebasedPayments, in 6 of the 20.
  shareBasedCompensation: ["AdjustmentsForSharebasedPayments"],
  depreciationAndAmortization: [
    "DepreciationAndAmortisationExpense",
    "AdjustmentsForDepreciationAndAmortisationExpense",
  ],
  investingCashFlow: ["CashFlowsFromUsedInInvestingActivities"],
  financingCashFlow: ["CashFlowsFromUsedInFinancingActivities"],
  netChangeInCash: [
    "IncreaseDecreaseInCashAndCashEquivalents",
    "IncreaseDecreaseInCashAndCashEquivalentsBeforeEffectOfExchangeRateChanges",
  ],
  dividendsPaid: ["DividendsPaidClassifiedAsFinancingActivities", "DividendsPaid"],
  buybacks: ["PaymentsToAcquireOrRedeemEntitysShares"],
  // dividendsDeclaredPerShare HAS NO IFRS ENTRY, and the empty line is the
  // point: 0 of 20 probed filers publish a per-share dividend under ifrs-full
  // under this or any spelling. Leaving a guess here would have read as a
  // mapping that works. An IFRS filer's dividend-per-share renders null.
  fxEffectOnCash: ["EffectOfExchangeRateChangesOnCashAndCashEquivalents"],

  // Balance sheet
  cash: ["CashAndCashEquivalents"],
  shortTermInvestments: ["OtherCurrentFinancialAssets", "CurrentInvestments"],
  receivables: ["TradeAndOtherCurrentReceivables", "CurrentTradeReceivables"],
  inventory: ["Inventories"],
  totalCurrentAssets: ["CurrentAssets"],
  totalAssets: ["Assets"],
  payables: ["TradeAndOtherCurrentPayables"],
  totalCurrentLiabilities: ["CurrentLiabilities"],
  shortTermDebt: ["ShorttermBorrowings", "CurrentPortionOfLongtermBorrowings"],
  // `Borrowings` (published by 7 of the 20) is deliberately NOT added: it is
  // TOTAL borrowings, current and non-current together, and putting it in a
  // long-term field would overstate long-term debt by the current portion —
  // a plausible wrong number, which is the one thing this file refuses.
  longTermDebt: ["LongtermBorrowings"],
  totalLiabilities: ["Liabilities"],
  stockholdersEquity: ["EquityAttributableToOwnersOfParent"],
  totalEquity: ["Equity"],
  goodwill: ["Goodwill"],
  intangibleAssets: ["IntangibleAssetsOtherThanGoodwill"],
  deferredRevenueCurrent: ["CurrentContractLiabilities"],
  deferredRevenueNoncurrent: ["NoncurrentContractLiabilities"],
};

// ── Income statement ────────────────────────────────────────────────────────
// Every line is a DURATION and every one is filed cumulatively within the year.
const INCOME: FieldDef[] = ([
  { key: "revenue", chain: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "USD" },
  { key: "costOfRevenue", chain: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"], unit: "USD" },
  // THE FILER'S OWN GROSS PROFIT, not revenue - costOfRevenue. Stored precisely
  // so the identity has something to check: a derived figure cannot disagree
  // with its own derivation, so checking it against itself would be one of the
  // vacuous passes this whole section exists to avoid.
  { key: "grossProfit", chain: ["GrossProfit"], unit: "USD" },
  { key: "researchAndDevelopment", chain: ["ResearchAndDevelopmentExpense"], unit: "USD" },
  { key: "sellingGeneralAndAdministrative", chain: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"], unit: "USD" },
  { key: "otherOperatingExpense", chain: ["OtherOperatingIncomeExpenseNet"], unit: "USD" },
  { key: "operatingIncome", chain: ["OperatingIncomeLoss"], unit: "USD" },
  { key: "interestExpense", chain: ["InterestExpense", "InterestExpenseDebt", "InterestIncomeExpenseNet"], unit: "USD" },
  { key: "nonOperatingIncomeExpense", chain: ["NonoperatingIncomeExpense"], unit: "USD" },
  // THE TWO TAGS DIFFER PRECISELY ON MINORITY INTEREST -- which is why
  // netIncomeToNoncontrollingInterest is stored: without it the two cannot be
  // reconciled and the chain's own ambiguity is unresolvable after the fact.
  { key: "preTaxIncome", chain: [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ], unit: "USD" },
  { key: "incomeTaxExpense", chain: ["IncomeTaxExpenseBenefit"], unit: "USD" },
  { key: "netIncome", chain: ["NetIncomeLoss", "ProfitLoss"], unit: "USD" },
  { key: "netIncomeToNoncontrollingInterest", chain: ["NetIncomeLossAttributableToNoncontrollingInterest"], unit: "USD" },
  // EarningsPerShareBasicAndDiluted IS NOT A TIDY-UP. ASTS publishes only the
  // combined tag and came back with EPS empty on all 8 quarters, which is how it
  // got into both chains.
  { key: "epsBasic", chain: ["EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"], unit: "USD/shares" },
  { key: "epsDiluted", chain: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"], unit: "USD/shares" },
  { key: "sharesBasic", chain: ["WeightedAverageNumberOfSharesOutstandingBasic"], unit: "shares" },
  { key: "sharesDiluted", chain: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
] satisfies Seed[]).map((f) => ({
  ...f,
  singleValued: true as const,
  statement: "income" as const,
  taxonomy: "us-gaap" as const,
  kind: NON_ADDITIVE_INCOME[f.key] ?? ("duration-cumulative" as const),
  ...(RATIO_SOURCE[f.key] ? { ratioSource: RATIO_SOURCE[f.key] } : {}),
  ...(IFRS_CHAIN[f.key] ? { ifrsChain: IFRS_CHAIN[f.key] } : {}),
}));

// ── Cash flow ───────────────────────────────────────────────────────────────
// The three activity totals are here because they make the statement CHECKABLE:
// operating + investing + financing must reconcile to netChangeInCash, which is
// a free arithmetic assertion on the differencing itself.
const CASH_FLOW: FieldDef[] = ([
  { key: "operatingCashFlow", chain: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], unit: "USD" },
  /**
   * ── A ONE-DEEP CHAIN, AND IT WAS EMPTY ON BOTH FILERS TESTED ────────────
   *
   * WHAT WAS MEASURED (relay 35024074183 and 35024136855, GEV / KTOS / AAPL):
   * `PaymentsToAcquirePropertyPlantAndEquipment` is ABSENT FROM THE PAYLOAD on
   * GEV and on KTOS — not thin, not mis-framed, absent — so capex was null on
   * EVERY stored quarter and EVERY stored year for both, and free cash flow
   * read "Can't calculate — capital expenditure not reported" beside an
   * operating cash flow that resolved perfectly. AAPL is the control: it
   * publishes that tag 105 times and its ladders are complete.
   *
   * Both filers publish `PaymentsToAcquireProductiveAssets` instead — GEV
   * 783,000,000 and KTOS 37,100,000, each on the 6M frame of the 10-Q for
   * 2026Q2. It is the same measure: cash paid for productive assets, the line
   * a cash-flow statement calls capital expenditure.
   *
   * SECOND, NOT FIRST. Resolution is rank-first per period, so a filer that
   * publishes both keeps the narrower PP&E reading and nothing about AAPL
   * moves. The fallback only reaches filers that have no first entry at all.
   *
   * ── THE THREE NEAR-MISSES ON THE SAME PRINTED LIST, AND WHY EACH IS OUT ──
   * The probe lists every concept whose name could plausibly be this figure,
   * with its value, precisely so the ones that must NOT be taken are visible:
   *   · PaymentsToAcquireBusinessesNetOfCashAcquired — GEV 4,885,000,000,
   *     KTOS 346,800,000. Buying companies, not building assets. Taking it
   *     would report an acquisition as capital expenditure and put a 6x
   *     overstatement into free cash flow on GEV.
   *   · PaymentsToAcquireEquityMethodInvestments / ...InterestInJointVenture —
   *     investments, the same category error one level down.
   *   · CapitalExpendituresIncurredButNotYetPaid — KTOS 9,100,000. It matches
   *     the name pattern and is the most dangerous of the three: it is a
   *     NON-CASH supplemental disclosure of capex NOT paid this period, so on
   *     a cash-flow line it is both the wrong sign of thing and, at 9.1m
   *     against a real 37.1m, wrong by four times.
   */
  // ONE CONCEPT PER FILER — see FieldDef.oneConceptPerFiler. capex is the field
  // the rule was ruled for: its two entries are different measures, not two
  // spellings of one, and three filers in 119 file both on a still-stored period
  // and disagree by up to 78.9%.
  { key: "capex", chain: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], unit: "USD", oneConceptPerFiler: true },
  { key: "shareBasedCompensation", chain: ["ShareBasedCompensation"], unit: "USD" },
  { key: "depreciationAndAmortization", chain: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"], unit: "USD" },
  { key: "investingCashFlow", chain: ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"], unit: "USD" },
  { key: "financingCashFlow", chain: ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"], unit: "USD" },
  { key: "netChangeInCash", chain: [
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect",
      "CashAndCashEquivalentsPeriodIncreaseDecrease",
    ], unit: "USD" },
  { key: "dividendsPaid", chain: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"], unit: "USD" },
  { key: "buybacks", chain: ["PaymentsForRepurchaseOfCommonStock"], unit: "USD" },
  { key: "dividendsDeclaredPerShare", chain: ["CommonStockDividendsPerShareDeclared"], unit: "USD/shares" },
  // THE FOURTH LEG, AND THE RECONCILIATION IS NOT A CHECK WITHOUT IT. The three
  // activity totals exclude the exchange-rate effect while netChangeInCash's
  // first chain entry (...IncludingExchangeRateEffect) includes it, so the
  // assertion reported breaks on ARM, MU and PLAB that were just FX. Reporting
  // noise as failure is how a check stops being read.
  { key: "fxEffectOnCash", chain: [
      "EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "EffectOfExchangeRateOnCashAndCashEquivalents",
      "EffectOfExchangeRateOnCash",
    ], unit: "USD" },
] satisfies Seed[]).map((f) => ({
  ...f,
  singleValued: true as const,
  kind: "duration-cumulative" as const,
  statement: "cash-flow" as const,
  taxonomy: "us-gaap" as const,
  ...(IFRS_CHAIN[f.key] ? { ifrsChain: IFRS_CHAIN[f.key] } : {}),
}));

// ── Balance sheet ───────────────────────────────────────────────────────────
// ALL INSTANT. A position at a date is never cumulative and must never be
// differenced -- doing so yields a change-in-balance where a balance was asked
// for. Asserted in the check rather than trusted to this comment.
const BALANCE_SHEET: FieldDef[] = ([
  { key: "cash", chain: ["CashAndCashEquivalentsAtCarryingValue"], unit: "USD", taxonomy: "us-gaap" },
  // THE SAME BALANCE, ON THE OTHER DEFINITION. `netChangeInCash` is filed
  // against one of two cash concepts -- with restricted cash or without -- and
  // comparing the change on one against the balance on the other is a
  // definition mismatch, not a discrepancy. It failed MU on 2 quarters and ASTS
  // on 3, once by 27.5%. Stored separately so the identity can pick the
  // matching one by reading which tag won; see checkIdentities.
  { key: "cashIncludingRestricted", chain: [
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations",
    ], unit: "USD", taxonomy: "us-gaap" },
  // DebtSecuritiesHeldToMaturityAmortizedCostAfterAllowanceForCreditLossCurrent
  // is the CARRYING VALUE of current held-to-maturity securities — the figure
  // that sits on the balance sheet. Added on evidence: VRT files it at
  // 300,000,000 for 2026-06-30 and files none of the three above, so the line
  // rendered blank on a filer that plainly holds short-term investments
  // (probe, relay 35017263145).
  //
  // ITS FAIR-VALUE TWIN IS NOT ADDED. DebtSecuritiesHeldToMaturityFairValueCurrent
  // carries the same 300,000,000 here and will not on a filer whose holdings
  // have moved; amortized cost is what the balance sheet reports, and taking
  // whichever appeared first would make the column mean different things on
  // different symbols. Nor is ProceedsFromSaleOfShortTermInvestments, which
  // matched the name pattern and is a CASH-FLOW item, not a balance.
  { key: "shortTermInvestments", chain: [
      "ShortTermInvestments",
      "MarketableSecuritiesCurrent",
      "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
      "DebtSecuritiesHeldToMaturityAmortizedCostAfterAllowanceForCreditLossCurrent",
    ], unit: "USD", taxonomy: "us-gaap" },
  { key: "receivables", chain: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "inventory", chain: ["InventoryNet"], unit: "USD", taxonomy: "us-gaap" },
  { key: "totalCurrentAssets", chain: ["AssetsCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "totalAssets", chain: ["Assets"], unit: "USD", taxonomy: "us-gaap" },
  // AccountsPayableAndAccruedLiabilitiesCurrent IS NOT A SYNONYM -- it bundles
  // accruals in with payables -- but MU publishes only that one and came back
  // empty on all 8 quarters without it. Ranked BELOW the clean tag so a filer
  // that publishes both is unaffected.
  { key: "payables", chain: ["AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "totalCurrentLiabilities", chain: ["LiabilitiesCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "shortTermDebt", chain: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"], unit: "USD", taxonomy: "us-gaap" },
  { key: "longTermDebt", chain: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"], unit: "USD", taxonomy: "us-gaap" },
  { key: "totalLiabilities", chain: ["Liabilities"], unit: "USD", taxonomy: "us-gaap" },
  // PARENT-ONLY, deliberately: this is the figure a reader means by
  // "shareholders' equity", and it is what the per-share book value must use.
  { key: "stockholdersEquity", chain: ["StockholdersEquity"], unit: "USD", taxonomy: "us-gaap" },
  // TOTAL equity, and it is a SEPARATE FIELD rather than a second chain entry
  // because the two answer different questions. assets = liabilities + equity
  // only balances against TOTAL equity, and PLAB -- which carries a large
  // noncontrolling interest -- failed that identity on 8 of 8 quarters by
  // roughly 23% while the chain preferred the parent-only tag. Merging them
  // would have fixed the identity by changing what the page calls equity.
  { key: "totalEquity", chain: [
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      "StockholdersEquity",
    ], unit: "USD", taxonomy: "us-gaap" },
  { key: "goodwill", chain: ["Goodwill"], unit: "USD", taxonomy: "us-gaap" },
  { key: "intangibleAssets", chain: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"], unit: "USD", taxonomy: "us-gaap" },
  { key: "deferredRevenueCurrent", chain: ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "deferredRevenueNoncurrent", chain: ["ContractWithCustomerLiabilityNoncurrent", "DeferredRevenueNoncurrent"], unit: "USD", taxonomy: "us-gaap" },
] satisfies BalanceSeed[]).map((f) => ({
  singleValued: true as const,
  ...f,
  kind: "instant" as const,
  statement: "balance-sheet" as const,
  ...(IFRS_CHAIN[f.key] ? { ifrsChain: IFRS_CHAIN[f.key] } : {}),
}));

/**
 * THE COVER PAGE, LIFTED OUT OF THE PERIOD GRID ENTIRELY.
 *
 * `dei:EntityCommonStockSharesOutstanding` is a FILER-LEVEL fact with its own
 * asOf date -- the cover date, which sits two to four weeks after the period
 * end. While it lived in the instant list those cover dates entered the series
 * as periods of their own carrying nothing but this one field, and an 8-period
 * slice then returned FOUR balance sheets and four near-empty rows for AAPL, MU
 * and PLAB. ARM and ASTS were unaffected only because their cover dates happen
 * to land on the period end, so the damage was per-filer and invisible in any
 * total.
 *
 * Lifting it to a symbol-level field fixes that structurally: the instant series
 * now holds balance-sheet dates and nothing else.
 *
 * AND companyfacts CANNOT NAME THE CLASS. The cover page carries the class on an
 * XBRL segment axis; companyfacts publishes the default-context series only, so
 * a multi-class filer's several rows arrive with the same end, the same accn and
 * nothing to tell them apart. There is no class label to read, so the extractor
 * refuses to pick: such a reading is recorded as ambiguous with both candidates.
 * Picking silently IS the BRK.B share-count bug.
 */
export const COVER_SHARES_FIELD: FieldDef = {
  key: "sharesOutstandingCover",
  kind: "instant",
  statement: "balance-sheet",
  taxonomy: "dei",
  chain: ["EntityCommonStockSharesOutstanding"],
  unit: "shares",
  singleValued: false,
};

/** The ordered field list. ORDER IS LOAD-BEARING: values are stored positionally. */
export const SEC_FIELDS: FieldDef[] = [...INCOME, ...CASH_FLOW, ...BALANCE_SHEET];

export const SEC_FIELD_KEYS: string[] = SEC_FIELDS.map((f) => f.key);

/** Field index by key, for the positional encoding. */
export const SEC_FIELD_INDEX: Record<string, number> = Object.fromEntries(
  SEC_FIELD_KEYS.map((k, i) => [k, i])
);

/**
 * THE FAIL-SAFE FOR POSITIONAL STORAGE.
 *
 * Values are stored as a positional array, which is 48% smaller than a named
 * object (10.2 KB against 19.7 KB for 8 quarters + 5 years, measured) and
 * halves the per-year growth of an append-only series. The cost is that a
 * reader whose field order differs from the writer's would decode 43 values
 * shifted by one -- silently, and plausibly.
 *
 * So the writer stores this hash and a reader whose own hash differs must treat
 * the record as UNREADABLE and re-fetch. An order change becomes a cache miss
 * instead of a wrong number.
 *
 * Deliberately NOT a content hash of the whole definition: a corrected tag
 * chain does not invalidate stored values, only a change to the ORDER or
 * MEMBERSHIP of the key list does.
 */
export function secFieldsHash(keys: string[] = SEC_FIELD_KEYS): string {
  let h = 0x811c9dc5;
  for (const ch of keys.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A CONTENT HASH OF THE CHAINS — the retry key for an EMPTY stored set.
 *
 * secFieldsHash deliberately ignores chain edits: values already stored stay
 * valid when a tag chain is corrected, and re-reading 759 symbols because one
 * chain gained an entry would be a self-inflicted outage.
 *
 * But an EMPTY set is not a value, it is the absence of one, and a chain edit
 * is exactly the thing that can turn it into data. Every IFRS filer holds an
 * empty set written before ifrs-full was read; without a key that moves when
 * the chains move, they stay empty forever while the chains that can read them
 * sit in this file.
 *
 * So: this hash moves on ANY chain change, and secColdFetch retries a stored
 * EMPTY set whose hash differs — once, budgeted and timed out like a cold
 * fetch. A set with values is untouched, and a retry that comes back empty
 * again stores the current hash and stops.
 */
export const CHAIN_RESOLUTION_POLICY =
  "preferred-tag-covers-newest-period+one-concept-per-filer-where-marked";

export function secChainsHash(): string {
  let h = 0x811c9dc5;
  const feed = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const f of [...SEC_FIELDS, COVER_SHARES_FIELD]) {
    // oneConceptPerFiler IS PART OF THE KEY. It changes which concept a cell
    // resolves from and whether an absent one falls back, so a set written
    // without it holds different numbers from one written with it. Left out,
    // every stored set would report itself current and keep the mixed column.
    feed(`${f.key}|${f.taxonomy}|${f.chain.join(",")}|${(f.ifrsChain ?? []).join(",")}|${f.unit}`
      + `|one:${f.oneConceptPerFiler ? 1 : 0}`);
  }
  // ── THE READING OF THE CHAINS, NOT ONLY THEIR CONTENT ───────────────────
  // A change to HOW a chain is resolved moves stored values exactly as a
  // change to WHAT is in it does — the preferred-tag rule flips which of two
  // present concepts a period takes — and a hash over the chain text alone
  // cannot see it. Then `needsReread` reports every set current, the migration
  // completes without doing anything, and the store keeps serving figures the
  // shipped code would no longer write. Bumping this string is what re-reads
  // the universe; leaving it alone is what makes a resolution change invisible.
  feed(`policy|${CHAIN_RESOLUTION_POLICY}`);
  return h.toString(16).padStart(8, "0");
}

/** Fields the differencing may touch. The only way to reach one. */
export function cumulativeFields(): FieldDef[] {
  return SEC_FIELDS.filter((f) => f.kind === "duration-cumulative");
}

/** Fields the differencing must never touch. */
export function instantFields(): FieldDef[] {
  return SEC_FIELDS.filter((f) => f.kind === "instant");
}

/**
 * Durations that do NOT add: read only where the filer published that exact
 * frame, never assembled from two others.
 *
 * The consequence is real and is the point: Q4 is never filed as a three-month
 * frame, so a `duration-average` is null for Q4 and so is any ratio that
 * depends on it. A null says "not filed"; -668,000 shares said nothing true.
 */
export function asFiledOnlyFields(): FieldDef[] {
  return SEC_FIELDS.filter(
    (f) => f.kind === "duration-average" || f.kind === "duration-ratio"
  );
}

/**
 * Every field, partitioned exactly once. Exported so a check can assert the
 * partition rather than recomputing it from the same filter it is testing.
 */
export function fieldPartition() {
  return {
    cumulative: cumulativeFields(),
    asFiledOnly: asFiledOnlyFields(),
    instant: instantFields(),
  };
}
