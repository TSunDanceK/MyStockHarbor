// Builds the "Federal contracts" record from USAspending (Relay C, #563
// COWORK #1 D5): the committed alias list, our universe's SEC names, and the
// top recipient pages. Used by the weekly job only (see ./capexContracts for
// the store the page reads).
import aliasFile from "@/data/capex/contract-aliases.json";
import registrants from "@/data/sec/registrants.json";
import companyTickers from "@/data/sec/company-tickers.json";
import { newsUserAgent } from "./news/userAgent";
import {
  CONTRACT_AWARD_TYPES,
  aggregateContracts,
  buildMapper,
  contractWindow,
  type ContractAlias,
  type ContractExclusion,
  type ContractsRecord,
  type Recipient,
  type UniverseName,
} from "./capexContractsCore";

const API = "https://api.usaspending.gov/api/v2";
/** Top recipients read: 10 pages of 100 (the probe's 1,000; ~78% of dollars). */
export const RECIPIENT_PAGES = 10;
const CONCURRENCY = 3;
/** Rows kept for the panel. */
export const CONTRACT_ROWS_KEPT = 25;

export const CONTRACT_ALIASES = aliasFile.aliases as ContractAlias[];
export const CONTRACT_EXCLUSIONS = aliasFile.exclusions as ContractExclusion[];

/** Our universe (registrants.json CIKs) with their SEC names. */
export function universeNames(): UniverseName[] {
  const rows = (registrants as { rows: Record<string, { cik: string }> }).rows;
  const symByCik = new Map<number, string>();
  for (const [sym, r] of Object.entries(rows)) if (r?.cik) symByCik.set(Number(r.cik), sym);
  const t = companyTickers as { fields: string[]; data: Array<Array<string | number>> };
  const ci = t.fields.indexOf("cik");
  const ni = t.fields.indexOf("name");
  const out: UniverseName[] = [];
  for (const row of t.data) {
    const sym = symByCik.get(Number(row[ci]));
    if (sym) out.push({ ticker: sym, secName: String(row[ni]) });
  }
  return out;
}

async function post(path: string, body: unknown): Promise<unknown | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": newsUserAgent() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) return null;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  return null;
}

/**
 * Build the record from USAspending. Null when any recipient page failed: a
 * partial list would under-state companies silently, so the old record stays.
 */
export async function buildContractsRecord(nowMs: number): Promise<{ record: ContractsRecord | null; pagesFailed: number }> {
  const window = contractWindow(nowMs);
  const filters = { time_period: [{ start_date: window.start, end_date: window.end }], award_type_codes: CONTRACT_AWARD_TYPES };
  const pages: Array<Recipient[] | null> = [];
  for (let p = 1; p <= RECIPIENT_PAGES; p += CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, RECIPIENT_PAGES - p + 1) }, (_, i) =>
        post("/search/spending_by_category/recipient/", { filters, category: "recipient", limit: 100, page: p + i })
      )
    );
    for (const b of batch) {
      const results = (b as { results?: Array<{ name?: string; amount?: number }> } | null)?.results;
      pages.push(Array.isArray(results) ? results.map((r) => ({ name: String(r.name ?? ""), amount: Number(r.amount) })) : null);
    }
  }
  const pagesFailed = pages.filter((p) => p === null).length;
  if (pagesFailed) return { record: null, pagesFailed };

  const over = (await post("/search/spending_over_time/", { group: "fiscal_year", filters })) as { results?: Array<{ aggregated_amount?: number }> } | null;
  const totalAmount = Array.isArray(over?.results) ? over!.results.reduce((a, r) => a + (Number(r.aggregated_amount) || 0), 0) : null;

  const recipients = pages.flat() as Recipient[];
  const mapper = buildMapper(CONTRACT_ALIASES, CONTRACT_EXCLUSIONS, universeNames());
  const { rows, mappedAmount, readAmount } = aggregateContracts(recipients, mapper, CONTRACT_ROWS_KEPT);
  return {
    record: { v: 1, window, builtAt: nowMs, recipientsRead: recipients.length, readAmount, totalAmount, mappedAmount, rows },
    pagesFailed: 0,
  };
}
