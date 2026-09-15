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

/** How a period's value relates to the period itself. */
export type FieldKind =
  /** Filed year-to-date. Q1 is as filed; Q2..Q4 are derived by differencing. */
  | "duration-cumulative"
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
};

// The per-block literals below carry only what VARIES. `satisfies` on each
// array supplies the contextual type, so `unit: "USD"` stays the literal type
// rather than widening to `string` before the `.map()` re-adds the rest.
type Seed = Pick<FieldDef, "key" | "chain" | "unit">;
type BalanceSeed = Seed & Pick<FieldDef, "taxonomy"> & Partial<Pick<FieldDef, "singleValued">>;

// ── Income statement ────────────────────────────────────────────────────────
// Every line is a DURATION and every one is filed cumulatively within the year.
const INCOME: FieldDef[] = ([
  { key: "revenue", chain: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], unit: "USD" },
  { key: "costOfRevenue", chain: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"], unit: "USD" },
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
  { key: "epsBasic", chain: ["EarningsPerShareBasic"], unit: "USD/shares" },
  { key: "epsDiluted", chain: ["EarningsPerShareDiluted"], unit: "USD/shares" },
  { key: "sharesBasic", chain: ["WeightedAverageNumberOfSharesOutstandingBasic"], unit: "shares" },
  { key: "sharesDiluted", chain: ["WeightedAverageNumberOfDilutedSharesOutstanding"], unit: "shares" },
] satisfies Seed[]).map((f) => ({ ...f, singleValued: true as const, kind: "duration-cumulative" as const, statement: "income" as const, taxonomy: "us-gaap" as const }));

// ── Cash flow ───────────────────────────────────────────────────────────────
// The three activity totals are here because they make the statement CHECKABLE:
// operating + investing + financing must reconcile to netChangeInCash, which is
// a free arithmetic assertion on the differencing itself.
const CASH_FLOW: FieldDef[] = ([
  { key: "operatingCashFlow", chain: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], unit: "USD" },
  { key: "capex", chain: ["PaymentsToAcquirePropertyPlantAndEquipment"], unit: "USD" },
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
] satisfies Seed[]).map((f) => ({ ...f, singleValued: true as const, kind: "duration-cumulative" as const, statement: "cash-flow" as const, taxonomy: "us-gaap" as const }));

// ── Balance sheet ───────────────────────────────────────────────────────────
// ALL INSTANT. A position at a date is never cumulative and must never be
// differenced -- doing so yields a change-in-balance where a balance was asked
// for. Asserted in the check rather than trusted to this comment.
const BALANCE_SHEET: FieldDef[] = ([
  { key: "cash", chain: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], unit: "USD", taxonomy: "us-gaap" },
  { key: "shortTermInvestments", chain: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "receivables", chain: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "inventory", chain: ["InventoryNet"], unit: "USD", taxonomy: "us-gaap" },
  { key: "totalCurrentAssets", chain: ["AssetsCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "totalAssets", chain: ["Assets"], unit: "USD", taxonomy: "us-gaap" },
  { key: "payables", chain: ["AccountsPayableCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "totalCurrentLiabilities", chain: ["LiabilitiesCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "shortTermDebt", chain: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"], unit: "USD", taxonomy: "us-gaap" },
  { key: "longTermDebt", chain: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"], unit: "USD", taxonomy: "us-gaap" },
  { key: "totalLiabilities", chain: ["Liabilities"], unit: "USD", taxonomy: "us-gaap" },
  { key: "stockholdersEquity", chain: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], unit: "USD", taxonomy: "us-gaap" },
  { key: "goodwill", chain: ["Goodwill"], unit: "USD", taxonomy: "us-gaap" },
  { key: "intangibleAssets", chain: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"], unit: "USD", taxonomy: "us-gaap" },
  { key: "deferredRevenueCurrent", chain: ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"], unit: "USD", taxonomy: "us-gaap" },
  { key: "deferredRevenueNoncurrent", chain: ["ContractWithCustomerLiabilityNoncurrent", "DeferredRevenueNoncurrent"], unit: "USD", taxonomy: "us-gaap" },
  // THE COVER PAGE, AND THE KNOWN HAZARD. dei:EntityCommonStockSharesOutstanding
  // is FILER-level: a multi-class filer reports it once PER CLASS, and a stored
  // number that does not say WHICH CLASS renders GOOG and GOOGL with the same
  // market cap. This is where the BRK.B share-count error lives.
  //
  // AND companyfacts CANNOT NAME THE CLASS. The cover page carries the class on
  // an XBRL segment axis (dei:LegalEntityAxis / us-gaap:StatementClassOfStock-
  // Axis); companyfacts publishes the DEFAULT-context series only, so a
  // multi-class filer's several rows arrive with the same `end`, the same
  // `accn`, and nothing distinguishing them. There is no class label to read.
  //
  // So `singleValued: false` marks this as a field where several rows may
  // legitimately share one period key, and the extractor refuses to pick:
  // ambiguous periods are recorded as ambiguous, never resolved by taking the
  // first, the largest, or the last. Picking silently IS the BRK.B bug.
  { key: "sharesOutstandingCover", chain: ["EntityCommonStockSharesOutstanding"], unit: "shares", taxonomy: "dei", singleValued: false },
] satisfies BalanceSeed[]).map((f) => ({ singleValued: true as const, ...f, kind: "instant" as const, statement: "balance-sheet" as const }));

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

/** Fields the differencing may touch. The only way to reach one. */
export function cumulativeFields(): FieldDef[] {
  return SEC_FIELDS.filter((f) => f.kind === "duration-cumulative");
}

/** Fields the differencing must never touch. */
export function instantFields(): FieldDef[] {
  return SEC_FIELDS.filter((f) => f.kind === "instant");
}
