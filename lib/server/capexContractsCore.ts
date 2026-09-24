// "Federal contracts" panel: USAspending recipients mapped to listed companies
// (Relay C, #563 COWORK #1 D5). Pure and import-free: the weekly job, the relay
// scripts and the checks all run this.
//
// WHAT THE NUMBER IS: federal contract obligations (award types A-D) over the
// last 12 full months, as USAspending reports them per recipient entity, summed
// per listed company over ITS OWN entities (a parent's subsidiaries are the
// parent's contracts). Never summed across companies, never a flow between them.
//
// HOW A RECIPIENT BECOMES A TICKER, in this order, and nothing else:
//   1. an EXCLUSION (a mapping seen to be wrong) -> not mapped, ever;
//   2. an ALIAS committed with its basis (data/capex/contract-aliases.json);
//   3. an EXACT normalised name match to a company in OUR universe.
// No fuzzy matching: a near-miss is a wrong company with a real dollar figure.

const SUFFIX =
  /\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|LLC|L ?P|PLC|N ?V|S ?A|AG|SE|HOLDINGS?|GROUP|THE|CLASS [A-C]|NEW|DE|ADR|SA DE CV)\b/g;

/** Upper case, "&" as AND, punctuation and legal-form words dropped. */
export function normName(s: string): string {
  return ` ${String(s ?? "").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ")} `
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ContractAlias = { recipient: string; ticker: string; basis: string };
export type ContractExclusion = { recipient: string; reason: string };
export type UniverseName = { ticker: string; secName: string };

export type Mapper = (recipientName: string) => { ticker: string; how: "alias" | "name" } | null;

export function buildMapper(aliases: ContractAlias[], exclusions: ContractExclusion[], universe: UniverseName[]): Mapper {
  const excluded = new Set(exclusions.map((e) => normName(e.recipient)));
  const alias = new Map(aliases.map((a) => [normName(a.recipient), a.ticker]));
  const byName = new Map<string, string>();
  for (const u of universe) {
    const n = normName(u.secName);
    // Three characters or more: "AT" or "BP" alone would match far too much.
    if (n.length >= 3 && !byName.has(n)) byName.set(n, u.ticker);
  }
  return (recipientName) => {
    const n = normName(recipientName);
    if (!n || excluded.has(n)) return null;
    const a = alias.get(n);
    if (a) return { ticker: a, how: "alias" };
    const t = byName.get(n);
    return t ? { ticker: t, how: "name" } : null;
  };
}

export type Recipient = { name: string; amount: number };

export type ContractRow = {
  ticker: string;
  amount: number;
  /** USAspending entities that mapped to this company, largest first. */
  entities: Array<{ name: string; amount: number; how: "alias" | "name" }>;
};

export type ContractsRecord = {
  v: 1;
  window: { start: string; end: string };
  builtAt: number;
  /** Recipients read (the top N by obligations). */
  recipientsRead: number;
  /** Obligations across those recipients, and across all contracts. */
  readAmount: number;
  totalAmount: number | null;
  mappedAmount: number;
  rows: ContractRow[];
};

export function aggregateContracts(recipients: Recipient[], mapper: Mapper, keep: number): { rows: ContractRow[]; mappedAmount: number; readAmount: number } {
  const byTicker = new Map<string, ContractRow>();
  let mappedAmount = 0;
  let readAmount = 0;
  for (const r of recipients) {
    const amount = Number(r.amount);
    if (!Number.isFinite(amount)) continue;
    readAmount += amount;
    const hit = mapper(r.name);
    if (!hit) continue;
    mappedAmount += amount;
    const row = byTicker.get(hit.ticker) ?? { ticker: hit.ticker, amount: 0, entities: [] };
    row.amount += amount;
    row.entities.push({ name: r.name, amount, how: hit.how });
    byTicker.set(hit.ticker, row);
  }
  const rows = [...byTicker.values()]
    .map((r) => ({ ...r, entities: r.entities.sort((a, b) => b.amount - a.amount) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, keep);
  return { rows, mappedAmount, readAmount };
}

/** The last 12 full calendar months before `nowMs`, as yyyy-mm-dd. */
export function contractWindow(nowMs: number): { start: string; end: string } {
  const now = new Date(nowMs);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export const CONTRACT_AWARD_TYPES = ["A", "B", "C", "D"];
