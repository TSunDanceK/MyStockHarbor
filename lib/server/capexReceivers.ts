// "WHO IS RECEIVING" — the curated receiver lines on the Capex page (#563).
//
// Each entry in data/capex/receivers.json names ONE revenue line a company
// files on its own segment or product/service axis ("Data Center",
// "Intelligent Cloud"), in the filer's own words, with the accession it came
// from. This module reads that line's current and prior fiscal-year revenue out
// of the filing's XBRL instance, and keeps the newest reading in one Redis key.
//
// ── WHAT IT MUST NEVER DO ──────────────────────────────────────────────────
// Sum lines across companies. Each line is shown on its own; a total of
// different companies' segments would be a number no filer published, which is
// the "estimated flow" the page is ruled not to show (#563 COWORK #1, D2).
//
// ── WHY THE INSTANCE AND NOT companyfacts ───────────────────────────────────
// companyfacts carries no dimensional facts, so segment revenue is not in it at
// all (CODE-C #1 §2, measured on 98 filers). The line lives only in the
// filing's own XBRL instance, which averages ~4.5 MB. So the job fetches an
// instance only when a NEWER annual filing exists than the one already read —
// ~45 a year across the list — and otherwise costs one submissions request per
// company.
//
// ── A RENAME IS FLAGGED, NEVER GUESSED ─────────────────────────────────────
// Filers rename members and relabel lines between years. When the curated
// element is missing from a newer filing, or its label differs from the curated
// one, the entry keeps its last good reading and carries a flag that says so.
// Picking "the closest member" would publish a line nobody reviewed.
import { Redis } from "@upstash/redis";
import { PAGE_READ_CACHE } from "./redisCacheMode";

export const CAPEX_RECEIVERS_REDIS_KEY = "msh:capex:receivers:v1";

/** Commands a refresh run spends on the receivers key: one GET, one SET. */
export const CAPEX_RECEIVERS_COMMANDS_PER_RUN = 2;

/**
 * A run stops parsing new instances after this many. The first run after a
 * deploy has nothing to do (the committed baseline is current); this only
 * bounds a run where many filers happened to file at once, so one run cannot
 * outlast the function's time limit.
 */
export const CAPEX_RECEIVERS_MAX_PARSE_PER_RUN = 12;

export type ReceiverGroup =
  | "Chips"
  | "Chip-making equipment"
  | "Memory & storage"
  | "Networking & optics"
  | "Servers & assembly"
  | "Power & cooling"
  | "Cloud & data centres";

/** Our own plain headings, in display order. Category words, not data. */
export const RECEIVER_GROUPS: readonly ReceiverGroup[] = [
  "Chips",
  "Chip-making equipment",
  "Memory & storage",
  "Networking & optics",
  "Servers & assembly",
  "Power & cooling",
  "Cloud & data centres",
];

export type ReceiverAxis = "segment" | "product";

/** One filed reading of a line: what the filing says, and where it says it. */
export type ReceiverReading = {
  accession: string;
  form: string;
  filed: string;
  /** End date of the fiscal year the figure covers (YYYY-MM-DD). */
  fyEnd: string;
  /** ISO currency the filer reports the line in ("USD", "EUR"). */
  currency: string;
  value: number;
  /** The same line for the prior fiscal year, when the filing carries it. */
  prior: number | null;
  /** The label the filer gives the member in this filing's label linkbase. */
  filedLabel: string | null;
};

export type ReceiverEntry = {
  ticker: string;
  cik: string;
  group: ReceiverGroup;
  axis: ReceiverAxis;
  /** Qualified member name, e.g. "nvda:DataCenterMember". */
  element: string;
  /** The filer's own label for the line, as reviewed. */
  label: string;
  /** Verbatim expansion of an acronym label, and where the words came from. */
  subLabel: { text: string; source: "filing text" | "element name" } | null;
  /** The line includes sales that are not data-centre sales (COWORK #2). */
  broad: boolean;
  /** The company is also among the largest spenders (COWORK #2, Q3). */
  alsoSpender: boolean;
  /** The committed reading the list was reviewed against. */
  baseline: ReceiverReading;
};

export type ReceiverFlag = "element-missing" | "label-changed" | "fetch-failed";

export type StoredReceiverLine = {
  ticker: string;
  element: string;
  reading: ReceiverReading;
  flags: ReceiverFlag[];
  checkedAt: string;
};

export type StoredReceivers = {
  version: 1;
  updatedAt: string;
  lines: StoredReceiverLine[];
};

// ── XBRL parsing (pure; lifted into scripts/check-capex-receivers.mjs) ──────

const SEGMENT_AXES = ["us-gaap:StatementBusinessSegmentsAxis", "ifrs-full:SegmentsAxis"];
const PRODUCT_AXES = ["srt:ProductOrServiceAxis", "ifrs-full:ProductsAndServicesAxis"];
// Revenue concepts a segment or product line is filed under. The curated line
// is whichever of these the filer used for that member; it is never summed
// across concepts.
const REVENUE_CONCEPTS = new Set([
  "us-gaap:Revenues",
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "ifrs-full:Revenue",
  "ifrs-full:RevenueFromContractsWithCustomers",
]);

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#160;|&nbsp;/g, " ")
    .replace(/&#8212;/g, "—")
    .replace(/&#8217;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Member local name -> the filer's label, from a label linkbase (or a schema
 * that embeds one). Prefers the terse label, then the standard label, and
 * drops the " [Member]" suffix filing software appends to standard labels.
 */
export function parseLabelLinkbase(xml: string): Map<string, string> {
  const locs = new Map<string, string>();
  const resources = new Map<string, { role: string; text: string }[]>();
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:link:)?loc\b([^>]*)\/?>/g)) {
    const href = (m[1].match(/xlink:href="[^"#]*#([^"]+)"/) ?? [])[1];
    const label = (m[1].match(/xlink:label="([^"]+)"/) ?? [])[1];
    if (href && label) locs.set(label, href);
  }
  for (const m of xml.matchAll(/<(?:link:)?label\b([^>]*)>([^<]*)<\/(?:link:)?label>/g)) {
    const label = (m[1].match(/xlink:label="([^"]+)"/) ?? [])[1];
    const role = (m[1].match(/xlink:role="([^"]+)"/) ?? [])[1] ?? "";
    if (!label) continue;
    const list = resources.get(label) ?? [];
    list.push({ role, text: decodeEntities(m[2]) });
    resources.set(label, list);
  }
  for (const m of xml.matchAll(/<(?:link:)?labelArc\b([^>]*)\/?>/g)) {
    const from = (m[1].match(/xlink:from="([^"]+)"/) ?? [])[1];
    const to = (m[1].match(/xlink:to="([^"]+)"/) ?? [])[1];
    const el = from ? locs.get(from) : undefined;
    const res = to ? resources.get(to) : undefined;
    if (!el || !res) continue;
    const pick = (suffix: string) => res.find((r) => r.role.endsWith(suffix))?.text;
    const text = pick("/terseLabel") ?? pick("/label") ?? res[0].text;
    // Element ids are "<prefix>_<LocalName>"; key by the local name.
    const local = el.replace(/^[^_]+_/, "");
    if (!out.has(local)) out.set(local, text.replace(/\s*\[Member\]$/, ""));
  }
  return out;
}

type Context = { dims: [string, string][]; start: string | null; end: string | null };

function parseContexts(instance: string): Map<string, Context> {
  const out = new Map<string, Context>();
  for (const m of instance.matchAll(/<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[\s\S]*?<\/(?:xbrli:)?context>/g)) {
    const dims = [...m[0].matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>([^<]+)</g)].map(
      (d) => [d[1], d[2].trim()] as [string, string]
    );
    const start = (m[0].match(/<(?:xbrli:)?startDate>([^<]+)</) ?? [])[1] ?? null;
    const end = (m[0].match(/<(?:xbrli:)?endDate>([^<]+)</) ?? [])[1] ?? null;
    out.set(m[1], { dims, start, end });
  }
  return out;
}

function parseUnits(instance: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of instance.matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    const measure = (m[2].match(/iso4217:([A-Z]{3})/) ?? [])[1];
    if (measure) out.set(m[1], measure);
  }
  return out;
}

const DAY_MS = 864e5;

/**
 * The curated member's revenue for the filing's fiscal year and the year
 * before, or null when the filing does not carry the member at all.
 *
 * A FACT QUALIFIES ONLY ON EXACTLY ONE AXIS — the curated one. A segment fact
 * usually also carries srt:ConsolidationItemsAxis=OperatingSegmentsMember,
 * which says "segment total", not a second cut, so that axis alone is set
 * aside; any other extra axis (a region, a customer) makes the fact a slice of
 * the line, not the line.
 */
export function extractMemberRevenue(
  instance: string,
  element: string,
  axis: ReceiverAxis
): { fyEnd: string; value: number; prior: number | null; currency: string } | null {
  const axes = axis === "segment" ? SEGMENT_AXES : PRODUCT_AXES;
  const contexts = parseContexts(instance);
  const units = parseUnits(instance);
  const facts: { end: string; value: number; currency: string }[] = [];
  for (const f of instance.matchAll(/<([A-Za-z-]+:[A-Za-z]+)\b([^>]*)>([^<]*)<\/\1>/g)) {
    if (!REVENUE_CONCEPTS.has(f[1])) continue;
    const ref = (f[2].match(/contextRef="([^"]+)"/) ?? [])[1];
    const ctx = ref ? contexts.get(ref) : undefined;
    if (!ctx?.start || !ctx.end) continue;
    const days = (Date.parse(ctx.end) - Date.parse(ctx.start)) / DAY_MS;
    if (days < 340 || days > 380) continue;
    const dims = ctx.dims.filter(([ax]) => ax !== "srt:ConsolidationItemsAxis");
    if (dims.length !== 1) continue;
    const [ax, member] = dims[0];
    if (!axes.includes(ax) || member !== element) continue;
    const value = Number(f[3].replace(/,/g, "").trim());
    if (!Number.isFinite(value)) continue;
    const unitRef = (f[2].match(/unitRef="([^"]+)"/) ?? [])[1];
    const currency = (unitRef && units.get(unitRef)) || "USD";
    facts.push({ end: ctx.end, value, currency });
  }
  if (!facts.length) return null;
  const fyEnd = facts.map((f) => f.end).sort().pop() as string;
  const current = facts.find((f) => f.end === fyEnd) as (typeof facts)[number];
  const prior =
    facts.find((f) => {
      const gap = (Date.parse(fyEnd) - Date.parse(f.end)) / DAY_MS;
      return gap > 330 && gap < 400;
    }) ?? null;
  return { fyEnd, value: current.value, prior: prior ? prior.value : null, currency: current.currency };
}

/** Change from the prior fiscal year, as a fraction; null when not comparable. */
export function changeFraction(reading: Pick<ReceiverReading, "value" | "prior">): number | null {
  if (reading.prior === null || reading.prior <= 0 || reading.value < 0) return null;
  return (reading.value - reading.prior) / reading.prior;
}

// ── The refresh (server only) ───────────────────────────────────────────────

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv(PAGE_READ_CACHE)
    : null;

/** One GET. null = no store or unreadable ("could not answer"), never "none". */
export async function readStoredReceivers(): Promise<StoredReceivers | null> {
  if (!redis) return null;
  try {
    const stored = await redis.get<StoredReceivers>(CAPEX_RECEIVERS_REDIS_KEY);
    return stored && Array.isArray(stored.lines) ? stored : null;
  } catch (err) {
    console.error("[capex:receivers] redis read failed:", err);
    return null;
  }
}

/** One SET, no TTL: the record is replaced, never left to expire into nothing. */
export async function writeStoredReceivers(doc: StoredReceivers): Promise<{ ok: boolean; reason: string | null }> {
  if (!redis) return { ok: false, reason: "no redis" };
  try {
    await redis.set(CAPEX_RECEIVERS_REDIS_KEY, doc);
    return { ok: true, reason: null };
  } catch (err) {
    console.error("[capex:receivers] redis write failed:", err);
    return { ok: false, reason: String(err) };
  }
}

const SEC_GAP_MS = 130; // ~7.5 requests a second, under SEC's 10/second.
let lastSecRequest = 0;
async function secFetch(url: string, ua: string): Promise<Response> {
  const wait = lastSecRequest + SEC_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSecRequest = Date.now();
  return fetch(url, {
    headers: { "User-Agent": ua, "Accept-Encoding": "gzip, deflate" },
    signal: AbortSignal.timeout(45_000),
  });
}

const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);

async function latestAnnualFiling(
  cik: string,
  ua: string
): Promise<{ accession: string; form: string; filed: string } | null> {
  const res = await secFetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, ua);
  if (!res.ok) throw new Error(`submissions ${res.status}`);
  const sub = (await res.json()) as {
    filings?: { recent?: { form: string[]; accessionNumber: string[]; filingDate: string[] } };
  };
  const r = sub.filings?.recent;
  if (!r) return null;
  const i = r.form.findIndex((f) => ANNUAL_FORMS.has(f));
  return i < 0 ? null : { accession: r.accessionNumber[i], form: r.form[i], filed: r.filingDate[i] };
}

/** Read one curated line from one filing. Throws on a failed fetch. */
export async function readLineFromFiling(
  entry: Pick<ReceiverEntry, "cik" | "element" | "axis">,
  filing: { accession: string; form: string; filed: string },
  ua: string
): Promise<ReceiverReading | null> {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(entry.cik)}/${filing.accession.replace(/-/g, "")}`;
  const idxRes = await secFetch(`${base}/index.json`, ua);
  if (!idxRes.ok) throw new Error(`index ${idxRes.status}`);
  const idx = (await idxRes.json()) as { directory?: { item?: { name: string }[] } };
  const names = idx.directory?.item?.map((x) => x.name) ?? [];
  const instanceName =
    names.find((n) => /_htm\.xml$/i.test(n)) ??
    names.find((n) => /\.xml$/i.test(n) && !/(FilingSummary|_cal|_def|_lab|_pre|MetaLinks)/i.test(n));
  if (!instanceName) return null;
  const labelName = names.find((n) => /_lab\.xml$/i.test(n)) ?? names.find((n) => /\.xsd$/i.test(n));
  const instRes = await secFetch(`${base}/${instanceName}`, ua);
  if (!instRes.ok) throw new Error(`instance ${instRes.status}`);
  const found = extractMemberRevenue(await instRes.text(), entry.element, entry.axis);
  if (!found) return null;
  let filedLabel: string | null = null;
  if (labelName) {
    const labRes = await secFetch(`${base}/${labelName}`, ua);
    if (labRes.ok) filedLabel = parseLabelLinkbase(await labRes.text()).get(entry.element.replace(/^[^:]+:/, "")) ?? null;
  }
  return { ...filing, ...found, filedLabel };
}

/**
 * Bring every line up to its newest annual filing.
 *
 * Per company: one submissions request. Only when that names a newer annual
 * filing than the one already held does the run fetch index.json, the instance
 * and the label linkbase (three more), capped at CAPEX_RECEIVERS_MAX_PARSE_PER_RUN.
 */
export async function refreshReceivers(
  entries: ReceiverEntry[],
  stored: StoredReceivers | null,
  ua: string,
  now: Date = new Date(),
  maxParse: number = CAPEX_RECEIVERS_MAX_PARSE_PER_RUN
): Promise<{ doc: StoredReceivers; parsed: number; newer: number; flagged: number; failed: number; deferred: number }> {
  const held = new Map((stored?.lines ?? []).map((l) => [`${l.ticker}|${l.element}`, l]));
  const lines: StoredReceiverLine[] = [];
  const latestByCik = new Map<string, { accession: string; form: string; filed: string } | null | Error>();
  let parsed = 0, newer = 0, flagged = 0, failed = 0, deferred = 0;
  for (const entry of entries) {
    const key = `${entry.ticker}|${entry.element}`;
    const prev = held.get(key);
    const current: ReceiverReading = prev?.reading ?? entry.baseline;
    let flags: ReceiverFlag[] = prev?.flags ?? [];
    let reading = current;
    try {
      if (!latestByCik.has(entry.cik)) latestByCik.set(entry.cik, await latestAnnualFiling(entry.cik, ua));
      const latest = latestByCik.get(entry.cik);
      if (latest instanceof Error) throw latest;
      // A clean check clears a stale fetch failure; the other flags stand until
      // a newer filing is read.
      flags = flags.filter((f) => f !== "fetch-failed");
      if (latest && latest.accession !== current.accession && latest.filed >= current.filed) {
        newer++;
        if (parsed >= maxParse) {
          deferred++;
        } else {
          parsed++;
          const next = await readLineFromFiling(entry, latest, ua);
          if (!next) {
            // The curated element is not in the newer filing: keep the last
            // good reading and say so. Never substitute a different member.
            flags = ["element-missing"];
            flagged++;
          } else {
            reading = next;
            flags = next.filedLabel !== null && next.filedLabel !== entry.label ? ["label-changed"] : [];
            if (flags.length) flagged++;
          }
        }
      }
    } catch (err) {
      failed++;
      flags = [...flags.filter((f) => f !== "fetch-failed"), "fetch-failed"];
      console.error(`[capex:receivers] ${entry.ticker}:`, err);
      latestByCik.set(entry.cik, err instanceof Error ? err : new Error(String(err)));
    }
    lines.push({ ticker: entry.ticker, element: entry.element, reading, flags, checkedAt: now.toISOString() });
  }
  return { doc: { version: 1, updatedAt: now.toISOString(), lines }, parsed, newer, flagged, failed, deferred };
}

/**
 * What the page shows for each entry: the stored reading when the job has
 * held one, else the committed baseline. Order and grouping follow the file.
 */
export function receiverRows(
  entries: ReceiverEntry[],
  stored: StoredReceivers | null
): (ReceiverEntry & { reading: ReceiverReading; flags: ReceiverFlag[] })[] {
  const held = new Map((stored?.lines ?? []).map((l) => [`${l.ticker}|${l.element}`, l]));
  return entries.map((e) => {
    const s = held.get(`${e.ticker}|${e.element}`);
    return { ...e, reading: s?.reading ?? e.baseline, flags: s?.flags ?? [] };
  });
}
