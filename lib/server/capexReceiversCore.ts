// "Who is receiving": refresh the curated lines from their filings (Relay C,
// #563 COWORK #2). The job, the relay seed and the checks all run THIS code;
// fetchers and the entry list are passed in, so nothing here reads the network,
// Redis or a JSON import on its own, and it loads in bare Node.
//
// COST MODEL. SEC is asked for each company's submissions once a day (~44
// requests, ~6 s at 8/s). The filing itself -- index, instance (~4.5 MB),
// labels, and the document only when a sub-label must be checked against its
// text -- is fetched ONLY when the latest annual accession differs from the one
// stored, which is ~44 times a year across the list. Redis is not touched here.
//
// RENAMES ARE FLAGGED, NEVER GUESSED. If a new filing no longer carries the
// committed element, the previous row is kept, marked stale, and flagged. If the
// element is there but its filed label changed, the new figures are used, the
// committed label keeps being shown, and the change is flagged for a human.
import {
  documentPeriodEnd,
  latestAnnual,
  listMembers,
  localName,
  parseLabels,
  percentChange,
  pickFilingFiles,
  readMemberLine,
  subLabelVerified,
  type ReceiverAxis,
} from "./capexXbrl";

export type ReceiverEntry = {
  id: string;
  ticker: string;
  cik: number;
  group: string;
  axis: ReceiverAxis;
  /** null until measured (a line Cowork added before its element was read). */
  element: string | null;
  filedLabel: string;
  subLabel: { text: string; source: "element" | "filing-text" } | null;
  broad: boolean;
  hyperscaler: boolean;
  probeAccession: string | null;
};

export type ReceiverRow = {
  id: string;
  accession: string;
  form: string;
  filingDate: string;
  fyStart: string;
  fyEnd: string;
  /** The revenue concept both years were read from (for audit). */
  concept: string;
  currency: string;
  current: number;
  prior: number | null;
  changePct: number | null;
  /** The label in THIS filing's linkbase (null if the filing carries none). */
  labelInFiling: string | null;
  /** Sub-label shown only when true. */
  subLabelOk: boolean;
  /** Set when a newer filing dropped the element: these are the older figures. */
  staleSince: string | null;
};

export type ReceiverFlag = { id: string; kind: string; detail: string };

export type ReceiversRecord = {
  v: 1;
  checkedAt: number;
  rows: Record<string, ReceiverRow>;
  flags: ReceiverFlag[];
};

export type Fetchers = {
  json: (url: string) => Promise<unknown | null>;
  text: (url: string) => Promise<string | null>;
};

export const secSubmissionsUrl = (cik: number) => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`;
export const secDocUrl = (cik: number, accession: string, doc: string) =>
  `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${doc}`;

export type RefreshOptions = {
  now: number;
  /** Filings (not companies) fetched in full per run; the rest wait a day. */
  maxFilings: number;
  /** Stop starting new filings after this many ms. */
  budgetMs: number;
  force?: boolean;
  /** Discovery output for entries with no element yet. */
  onDiscover?: (id: string, members: string[]) => void;
};

export async function refreshReceivers(
  entries: ReceiverEntry[],
  prev: ReceiversRecord | null,
  fetchers: Fetchers,
  opts: RefreshOptions
): Promise<{ record: ReceiversRecord; changed: boolean; stats: { companies: number; filingsRead: number; deferred: number; secRequests: number } }> {
  const t0 = Date.now();
  let secRequests = 0;
  const json = async (u: string) => { secRequests++; return fetchers.json(u); };
  const text = async (u: string) => { secRequests++; return fetchers.text(u); };

  const rows: Record<string, ReceiverRow> = { ...(prev?.rows ?? {}) };
  // Flags describe the CURRENT state, so they are rebuilt each run; a company
  // not re-read this run keeps its previous flags.
  const flags: ReceiverFlag[] = [];
  const prevFlags = prev?.flags ?? [];
  let filingsRead = 0;
  let deferred = 0;
  let changed = false;

  const byCik = new Map<number, ReceiverEntry[]>();
  for (const e of entries) byCik.set(e.cik, [...(byCik.get(e.cik) ?? []), e]);
  // Keep rows only for entries still on the list.
  for (const id of Object.keys(rows)) if (!entries.some((e) => e.id === id)) { delete rows[id]; changed = true; }

  for (const [cik, group] of byCik) {
    const keepFlags = () => flags.push(...prevFlags.filter((f) => group.some((e) => e.id === f.id)));
    const sub = await json(secSubmissionsUrl(cik));
    const filing = latestAnnual(sub);
    if (!filing) {
      keepFlags();
      for (const e of group) flags.push({ id: e.id, kind: "no-annual-filing", detail: `no 10-K/20-F/40-F in submissions for CIK ${cik}` });
      continue;
    }
    const current = group.every((e) => rows[e.id]?.accession === filing.accession || (rows[e.id]?.staleSince === filing.accession));
    if (current && !opts.force) { keepFlags(); continue; }
    if (filingsRead >= opts.maxFilings || Date.now() - t0 > opts.budgetMs) { deferred++; keepFlags(); continue; }
    filingsRead++;

    const index = (await json(secDocUrl(cik, filing.accession, "index.json"))) as { directory?: { item?: Array<{ name: string }> } } | null;
    const names = index?.directory?.item?.map((x) => x.name) ?? [];
    const files = pickFilingFiles(names);
    if (!files.instance) {
      for (const e of group) flags.push({ id: e.id, kind: "no-xbrl-instance", detail: `${filing.form} ${filing.accession}` });
      continue;
    }
    const instance = (await text(secDocUrl(cik, filing.accession, files.instance))) ?? "";
    const labelXml =
      (files.labels ? await text(secDocUrl(cik, filing.accession, files.labels)) : null) ??
      (files.schema ? await text(secDocUrl(cik, filing.accession, files.schema)) : null) ??
      "";
    const labels = parseLabels(labelXml);
    const needsDoc = group.some((e) => e.subLabel?.source === "filing-text");
    const doc = needsDoc && filing.primaryDocument ? await text(secDocUrl(cik, filing.accession, filing.primaryDocument)) : null;
    const periodEnd = documentPeriodEnd(instance) ?? filing.reportDate;

    for (const e of group) {
      if (!e.element) {
        opts.onDiscover?.(e.id, listMembers(instance, e.axis, periodEnd));
        flags.push({ id: e.id, kind: "element-not-set", detail: "curated entry has no element yet" });
        continue;
      }
      const line = readMemberLine(instance, e.element, e.axis, periodEnd);
      if (!line) {
        const old = rows[e.id];
        if (old) {
          rows[e.id] = { ...old, staleSince: filing.accession };
          changed = true;
        }
        flags.push({ id: e.id, kind: "element-missing", detail: `${e.element} has no fiscal-year revenue on the ${e.axis} axis in ${filing.form} ${filing.accession}; ${old ? "previous figures kept, marked stale" : "no figures yet"}` });
        continue;
      }
      const labelInFiling = labels.get(localName(e.element)) ?? null;
      if (labelInFiling !== null && labelInFiling !== e.filedLabel) {
        flags.push({ id: e.id, kind: "label-changed", detail: `filed label is "${labelInFiling}", committed "${e.filedLabel}"` });
      } else if (labelInFiling === null) {
        flags.push({ id: e.id, kind: "label-not-found", detail: `no label for ${e.element} in ${files.labels ?? files.schema ?? "the filing"}` });
      }
      const subLabelOk = e.subLabel ? subLabelVerified(e.subLabel, e.element, doc) : false;
      if (e.subLabel && !subLabelOk) {
        flags.push({ id: e.id, kind: "sub-label-unverified", detail: `"${e.subLabel.text}" not found in the ${e.subLabel.source === "element" ? "element name" : "filing text"}; not shown` });
      }
      const row: ReceiverRow = {
        id: e.id,
        accession: filing.accession,
        form: filing.form,
        filingDate: filing.filingDate,
        fyStart: line.fyStart,
        fyEnd: line.fyEnd,
        concept: line.concept,
        currency: line.currency,
        current: line.current,
        prior: line.prior,
        changePct: percentChange(line.current, line.prior),
        labelInFiling,
        subLabelOk,
        staleSince: null,
      };
      if (JSON.stringify(rows[e.id]) !== JSON.stringify(row)) changed = true;
      rows[e.id] = row;
    }
  }

  if (JSON.stringify(flags) !== JSON.stringify(prevFlags)) changed = true;
  return {
    record: { v: 1, checkedAt: opts.now, rows, flags },
    changed,
    stats: { companies: byCik.size, filingsRead, deferred, secRequests },
  };
}
