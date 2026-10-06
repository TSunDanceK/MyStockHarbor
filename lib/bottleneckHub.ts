// THE /bottlenecks HUB, COMPUTED FROM THE CONTENT FILES (#125 COWORK).
//
// Pure functions over the parsed posts: no fs, no fetch, nothing at request
// time. lib/bottlenecks.ts reads content/bottlenecks/*.md and hands the posts
// here, so every daily content PR flows into the leaderboard, the dependency
// web and the theme cards on the next build without anything else changing.
// scripts/check-bottlenecks-hub.mjs drives these functions directly.
//
// ── WHO IS "ONE COMPANY" ────────────────────────────────────────────────────
// The leaderboard used to key by the raw name string, so the same company
// written two ways counted twice: "Amazon.com, Inc. (AWS)" ×14 and
// "Amazon (AWS)" ×12 sat as two rows when they are one company at ×26. The key
// is now, in order:
//   1. the ticker, when the entry has one (GOOG folds into GOOGL);
//   2. otherwise the normalised name -- lower case, accents dropped, anything
//      in brackets dropped, "&" read as "and", punctuation and corporate
//      suffixes (Inc, Corp, Ltd, plc, N.V., S.A., AG, Group, Holdings...)
//      removed -- passed through NAME_ALIASES for the unlisted companies that
//      are written in genuinely different words (Samsung Foundry, AB Volvo...);
//   3. and if that normalised name is exactly the normalised name of an entry
//      that DOES carry a ticker, it joins that ticker's key.
// Generic buckets ("Other cloud customers", "Diversified retail base",
// "Largest distributor") are not companies: two pages' "Largest distributor"
// are different firms, so they are keyed per page and never merge or rank.
//
// ── WHAT IS COUNTED ─────────────────────────────────────────────────────────
// Distinct stock pages naming the company, not raw entries: a page that lists
// "Amazon (AWS)" as a supplier and "Amazon.com, Inc." as a customer counts
// once. The supplier / key-customer split counts pages per chart (supplyChain
// is the supplier chart, customers the key-customer chart), so a page naming a
// company on both charts counts once in each.

import type { BottleneckCompany, BottleneckPost } from "./bottlenecks";

// Share classes of one company that the content may write either way.
export const TICKER_ALIASES: Record<string, string> = {
  GOOG: "GOOGL",
};

// Normalised name → normalised name, for the unlisted companies that the
// content names in different words. Keys and values are AFTER normName(), so
// "Samsung Electronics (Foundry)" and "Adyen N.V." need no entry (brackets and
// suffixes are already dropped). Each entry is one company, checked by hand;
// the merge census on every build lists what this map joined.
export const NAME_ALIASES: Record<string, string> = {
  "samsung foundry": "samsung electronics",
  "ab volvo": "volvo",
  "sk siltron css": "sk siltron",
  "renesas electronics america": "renesas electronics",
  "compagnie generale des etablissements michelin": "michelin",
  "volkswagen group powerco": "volkswagen",
  "walgreens specialty pharmacy": "walgreens boots alliance",
  "us government": "us federal government",
};

// Corporate suffixes dropped from the end of a name (repeatedly, so
// "Murata Manufacturing Co., Ltd." loses both).
const SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd",
  "limited", "plc", "nv", "sa", "ag", "se", "spa", "gmbh", "llc", "holdings",
  "holding", "group",
]);

/** The name half of a company key: see the header. */
export function normName(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/\bu\.s\.?(?=\s|$)/g, "us")
    .replace(/[.,'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  s = s.replace(/^the /, "");
  const words = s.split(" ").filter(Boolean);
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

// A generic bucket rather than a named company. Deliberately conservative: a
// miss leaves a bucket on the board at ×1, which is harmless; a false hit
// would hide a company, so names only match on wording no company carries.
const GROUP_START = /^(other|all other|diversified|third[- ]party|single|sole|rest of|largest|second[- ]largest|third[- ]largest|broader|remaining|undisclosed|confidential|four undisclosed|direct diversified|independent|outsourced|specialty|specialized|limited-source|major|large|mid-market|small)\b/i;
const GROUP_WORD = /\b(customers?|suppliers?|vendors?|end[- ]markets?|end market|segment|channels?|network|operations|manufacturers|producers|partners|clients|consumers|base|cohort|agencies|subcontractors|growers|distributors|retailers|carriers|operators|makers|fabs|foundries|chains|platforms|brands|publishers|syndicate|pipeline|ecosystem|inputs|market|markets|products|ingredients|supply chain|hospitals|governments|authorities|investors|insiders|funds|firms|clusters|feedstock|sweeteners|revenue)\b/i;
// Regions and sector or department labels the content uses as a slice name.
const NOT_A_COMPANY = new Set([
  "argentina", "brazil", "mexico", "north america", "latin america", "asia pacific",
  "europe middle east and africa", "automotive", "chemicals", "coal", "construction",
  "energy", "fertilizers", "intermodal", "minerals", "highways", "ladies", "mens",
  "childrens", "shoes", "metals and equipment", "non residential construction",
]);

export function isGroupEntry(company: Pick<BottleneckCompany, "name" | "ticker">): boolean {
  if (company.ticker) return false;
  return GROUP_START.test(company.name.trim()) || GROUP_WORD.test(company.name) || NOT_A_COMPANY.has(normName(company.name));
}

export type CompanyPage = { slug: string; symbol: string; companyName: string };

export type HubCompany = {
  key: string;
  name: string;
  ticker: string | null;
  /** Distinct stock pages naming the company. */
  count: number;
  /** Distinct pages naming it on the supplier chart / the key-customer chart. */
  supplierPages: number;
  customerPages: number;
  pages: CompanyPage[];
};

export type CensusRow = {
  key: string;
  name: string;
  count: number;
  from: { name: string; ticker: string | null; entries: number }[];
};

type Acc = {
  key: string;
  ticker: string | null;
  pages: Map<string, CompanyPage>;
  supplier: Set<string>;
  customer: Set<string>;
  // raw name → { entries, pages naming it under that spelling }
  names: Map<string, { ticker: string | null; entries: number; pages: Set<string> }>;
};

/** The company key for one entry; `tickerByName` is the normalised name → ticker index of the ticker'd entries. */
export function companyKey(company: Pick<BottleneckCompany, "name" | "ticker">, tickerByName: Map<string, string>, slug = ""): string {
  const raw = (company.ticker ?? "").trim().toUpperCase();
  if (raw) return TICKER_ALIASES[raw] ?? raw;
  if (isGroupEntry(company)) return `group:${slug}:${normName(company.name)}`;
  const n = normName(company.name);
  const aliased = NAME_ALIASES[n] ?? n;
  return tickerByName.get(aliased) ?? `name:${aliased}`;
}

/** Normalised name → ticker, from every entry that carries one (a name claimed by two tickers is left out). */
export function tickerIndex(posts: BottleneckPost[]): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const post of posts) {
    for (const c of [...post.supplyChain, ...post.customers]) {
      if (!c.ticker) continue;
      const t = TICKER_ALIASES[c.ticker.toUpperCase()] ?? c.ticker.toUpperCase();
      const n = normName(c.name);
      if (!seen.has(n)) seen.set(n, new Set());
      seen.get(n)!.add(t);
    }
  }
  const out = new Map<string, string>();
  for (const [n, ts] of seen) if (ts.size === 1) out.set(n, [...ts][0]);
  return out;
}

// Only the legal-form suffixes: "Company", "Group" and "Holdings" stay in a
// shown name ("Abu Dhabi National Oil Company", not "...National Oil").
const DISPLAY_SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "ltd", "limited", "plc", "nv", "sa", "ag", "se", "spa", "gmbh", "llc"]);

// A spelling as shown: brackets, a leading "The" and trailing corporate
// suffixes dropped, case kept ("Alphabet Inc. (Google)" → "Alphabet").
export function displayBase(name: string): string {
  const words = name.replace(/\s*\([^)]*\)/g, "").replace(/^the\s+/i, "").trim().split(/\s+/);
  while (words.length > 1 && DISPLAY_SUFFIXES.has(words[words.length - 1].toLowerCase().replace(/[.,]/g, ""))) words.pop();
  return words.join(" ").replace(/,$/, "") || name;
}

// The display name: the spelling (brackets dropped) that the most pages use,
// shortest on a tie -- "Amazon" rather than "Amazon.com, Inc. (AWS)".
function displayName(acc: Acc): string {
  const tally = new Map<string, Set<string>>();
  for (const [name, v] of acc.names) {
    const base = displayBase(name);
    if (!tally.has(base)) tally.set(base, new Set());
    for (const p of v.pages) tally.get(base)!.add(p);
  }
  return [...tally.entries()].sort((a, b) => b[1].size - a[1].size || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0][0];
}

/** Every named company, keyed as in the header, most-shared first (name on ties). */
export function buildHubCompanies(posts: BottleneckPost[]): HubCompany[] {
  return [...accumulate(posts).values()].filter((a) => !a.key.startsWith("group:")).map(toCompany).sort(byCount);
}

function accumulate(posts: BottleneckPost[]): Map<string, Acc> {
  const index = tickerIndex(posts);
  const accs = new Map<string, Acc>();
  for (const post of posts) {
    const page = { slug: post.slug, symbol: post.symbol, companyName: post.companyName };
    for (const [chart, list] of [["supplier", post.supplyChain], ["customer", post.customers]] as const) {
      for (const c of list) {
        if (!c.name.trim()) continue;
        const key = companyKey(c, index, post.slug);
        let acc = accs.get(key);
        if (!acc) {
          acc = { key, ticker: null, pages: new Map(), supplier: new Set(), customer: new Set(), names: new Map() };
          accs.set(key, acc);
        }
        if (!key.startsWith("name:") && !key.startsWith("group:")) acc.ticker = key;
        acc.pages.set(post.slug, page);
        (chart === "supplier" ? acc.supplier : acc.customer).add(post.slug);
        const v = acc.names.get(c.name) ?? { ticker: c.ticker, entries: 0, pages: new Set<string>() };
        v.entries += 1;
        v.pages.add(post.slug);
        acc.names.set(c.name, v);
      }
    }
  }
  return accs;
}

function toCompany(acc: Acc): HubCompany {
  return {
    key: acc.key,
    name: displayName(acc),
    ticker: acc.ticker,
    count: acc.pages.size,
    supplierPages: acc.supplier.size,
    customerPages: acc.customer.size,
    pages: [...acc.pages.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
}

function byCount(a: { count: number; name: string }, b: { count: number; name: string }) {
  return b.count - a.count || a.name.localeCompare(b.name);
}

/** Every key the keying rule joined from more than one spelling, largest first: the report's check that nothing wrong merged. */
export function buildMergeCensus(posts: BottleneckPost[]): CensusRow[] {
  return [...accumulate(posts).values()]
    .filter((a) => !a.key.startsWith("group:") && a.names.size > 1)
    .map((a) => ({
      key: a.key,
      name: displayName(a),
      count: a.pages.size,
      from: [...a.names.entries()].map(([name, v]) => ({ name, ticker: v.ticker, entries: v.entries })).sort((x, y) => y.entries - x.entries || x.name.localeCompare(y.name)),
    }))
    .sort(byCount);
}

// ── THEMES ──────────────────────────────────────────────────────────────────
// An editorial map, company key → theme. One theme per company. A key with no
// pages today simply contributes nothing, so a company can be listed ahead of
// its first mention.
export type ThemeId = "foundry" | "memory" | "accelerators" | "cloud" | "payments" | "customers";

export const THEMES: { id: ThemeId; title: string; line: string }[] = [
  { id: "foundry", title: "Chip foundry", line: "The few plants that make other companies' chip designs." },
  { id: "memory", title: "Memory", line: "DRAM, high-bandwidth memory and storage chips." },
  { id: "accelerators", title: "AI accelerators", line: "The processors that train and run AI models." },
  { id: "cloud", title: "Cloud hosting", line: "Where software companies rent their computing." },
  { id: "payments", title: "Payment networks", line: "The rails card and online payments run on." },
  { id: "customers", title: "Big customers", line: "Large buyers that make up an outsized share of a supplier's sales." },
];

export const THEME_MAP: Record<string, ThemeId> = {
  TSM: "foundry", GFS: "foundry", UMC: "foundry", INTC: "foundry", "name:smic": "foundry",
  "name:samsung electronics": "memory", MU: "memory", SKHY: "memory", WDC: "memory", STX: "memory", SNDK: "memory", "name:kioxia": "memory",
  NVDA: "accelerators", AMD: "accelerators", AVGO: "accelerators", MRVL: "accelerators",
  AMZN: "cloud", MSFT: "cloud", GOOGL: "cloud", ORCL: "cloud", CRWV: "cloud", EQIX: "cloud", DLR: "cloud",
  V: "payments", MA: "payments", PYPL: "payments", AXP: "payments", "name:adyen": "payments", "name:stripe": "payments",
  AAPL: "customers", META: "customers", WMT: "customers", COST: "customers", DELL: "customers", TGT: "customers", HPQ: "customers", HPE: "customers",
};

export type HubTheme = {
  id: ThemeId;
  title: string;
  line: string;
  /** Distinct mapped stock pages naming at least one company in the theme. */
  pageCount: number;
  /** The theme's most-named companies, for the logos. */
  top: HubCompany[];
};

export function buildThemes(companies: HubCompany[], map: Record<string, ThemeId> = THEME_MAP): HubTheme[] {
  return THEMES.map((t) => {
    const members = companies.filter((c) => map[c.key] === t.id);
    const pages = new Set(members.flatMap((c) => c.pages.map((p) => p.slug)));
    return { ...t, pageCount: pages.size, top: members.slice(0, 3) };
  });
}

// ── THE DEPENDENCY WEB ──────────────────────────────────────────────────────
// Geometry in SVG user units, computed here so the page draws a plain
// server-rendered <svg> with no chart library and no client code.
export const WEB = { width: 560, height: 520, cx: 280, cy: 260, ring: 116, edge: 236, hubs: 8 };

export type WebHub = { key: string; label: string; name: string; count: number; x: number; y: number; r: number };
export type WebStock = { slug: string; symbol: string; companyName: string; x: number; y: number; hubs: string[] };
export type DependencyWeb = { hubs: WebHub[]; stocks: WebStock[] };

const round = (v: number) => Math.round(v * 10) / 10;

export function buildDependencyWeb(posts: BottleneckPost[], companies: HubCompany[], hubCount = WEB.hubs): DependencyWeb {
  const top = companies.slice(0, hubCount);
  const max = top[0]?.count ?? 1;
  const hubs: WebHub[] = top.map((c, i) => {
    // Clockwise from twelve o'clock, so the largest hub sits on top.
    const a = -Math.PI / 2 + (i / Math.max(1, top.length)) * Math.PI * 2;
    return {
      key: c.key,
      label: c.ticker ?? c.name.split(" ")[0],
      name: c.name,
      count: c.count,
      x: round(WEB.cx + WEB.ring * Math.cos(a)),
      y: round(WEB.cy + WEB.ring * Math.sin(a)),
      r: round(24 + 13 * Math.sqrt(c.count / max)),
    };
  });
  const pagesOf = new Map(top.map((c) => [c.key, new Set(c.pages.map((p) => p.slug))]));
  // Each stock sits on the edge at the angle of the hubs it names, so its
  // lines stay short and the clusters read; stocks naming none of the hubs
  // fill the gaps in alphabetical order.
  const placed = [...posts].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((p, i, all) => {
    const linked = hubs.filter((h) => pagesOf.get(h.key)!.has(p.slug));
    let vx = 0, vy = 0;
    for (const h of linked) { vx += h.x - WEB.cx; vy += h.y - WEB.cy; }
    const want = linked.length && (Math.abs(vx) > 0.01 || Math.abs(vy) > 0.01) ? Math.atan2(vy, vx) : -Math.PI / 2 + (i / all.length) * Math.PI * 2;
    return { p, linked: linked.map((h) => h.key), want: (want + Math.PI * 2.5) % (Math.PI * 2) };
  }).sort((a, b) => a.want - b.want || a.p.symbol.localeCompare(b.p.symbol));
  const stocks: WebStock[] = placed.map(({ p, linked }, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, placed.length)) * Math.PI * 2;
    return { slug: p.slug, symbol: p.symbol, companyName: p.companyName, x: round(WEB.cx + WEB.edge * Math.cos(a)), y: round(WEB.cy + WEB.edge * Math.sin(a)), hubs: linked };
  });
  return { hubs, stocks };
}

// ── EVERYTHING THE PAGE NEEDS ───────────────────────────────────────────────
export const TOP_ROWS = 10;

export type BottleneckHub = {
  companies: HubCompany[];
  themes: HubTheme[];
  web: DependencyWeb;
  stats: { stocksMapped: number; companiesNamed: number; mostShared: HubCompany | null };
};

export function buildBottleneckHub(posts: BottleneckPost[]): BottleneckHub {
  const companies = buildHubCompanies(posts);
  return {
    companies,
    themes: buildThemes(companies),
    web: buildDependencyWeb(posts, companies),
    stats: { stocksMapped: posts.length, companiesNamed: companies.length, mostShared: companies[0] ?? null },
  };
}
