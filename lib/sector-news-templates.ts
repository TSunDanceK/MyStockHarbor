import type { SectorDef } from "@/lib/sectors";

// ---------------------------------------------------------------------------
// Deterministic, server-rendered prose for the sector news pages.
//
// Mirrors lib/stock-news-templates.ts in spirit -- plain-English framing that
// reads as context rather than prediction -- but every sentence here is built
// from values the page already has, so it renders in the initial HTML with no
// AI call and no client round-trip. The per-stock pages layer an AI insight on
// top of their equivalent copy; the sector pages deliberately ship the
// deterministic layer first (see the PR notes) so the pages are complete,
// indexable and free to serve from day one.
//
// Deliberately loose param types so a caller can pass raw data without
// importing the score types.
// ---------------------------------------------------------------------------

type ToneLike = { tone?: string | null; label?: string | null; score?: number | null };

function toneWord(tone: string | null | undefined) {
  if (tone === "green") return "constructive";
  if (tone === "red") return "pressured";
  return "mixed";
}

function moveWord(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 1.5) return "up firmly";
  if (value > 0.15) return "modestly higher";
  if (value <= -1.5) return "down firmly";
  if (value < -0.15) return "modestly lower";
  return "close to flat";
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function buildSectorLead(args: {
  sector: SectorDef;
  newsScore: ToneLike;
  articleCount: number;
  constituentCount: number;
  dayMove: number | null;
  rank: number | null;
}): string {
  const { sector, newsScore, articleCount, constituentCount, dayMove, rank } = args;

  const parts: string[] = [];

  parts.push(
    `${sector.name} headlines are currently reading ${toneWord(newsScore.tone)}, based on the latest coverage across the ${constituentCount || "largest"} biggest ${sector.name.toLowerCase()} names we track.`
  );

  const move = moveWord(dayMove);
  if (move && typeof rank === "number") {
    parts.push(
      `The sector is trading ${move} today and ranks ${ordinal(rank)} of 11 on the day.`
    );
  } else if (move) {
    parts.push(`The sector is trading ${move} today.`);
  }

  if (articleCount) {
    parts.push(
      `This is a read on what the news flow is saying right now, framed as context rather than a forecast -- so you can see quickly whether headlines are helping or hurting the sector story.`
    );
  } else {
    parts.push(
      `There is very little fresh coverage across these names at the moment, so treat the score below as low-conviction until the news flow picks up.`
    );
  }

  return parts.join(" ");
}

export function buildSectorRead(args: {
  sector: SectorDef;
  newsScore: ToneLike;
  earningsLabel: string;
  breadth: { sampled: number; above50: number; above200: number } | null;
  performance: { day: number | null; week: number | null; month: number | null; ytd: number | null } | null;
  topMentions: Array<{ symbol: string; count: number }>;
  earningsCount: number;
}): string[] {
  const { sector, newsScore, earningsLabel, breadth, performance, topMentions, earningsCount } =
    args;

  const out: string[] = [];

  // 1. What the headlines are doing.
  const drivers = topMentions.slice(0, 3).map((m) => m.symbol);
  out.push(
    drivers.length
      ? `The ${sector.name.toLowerCase()} news flow is currently leaning ${toneWord(newsScore.tone)}, and it is being driven mostly by ${drivers.join(", ")}. When a handful of names dominate a sector's coverage, the sector score is really telling you about those names first and the wider group second.`
      : `The ${sector.name.toLowerCase()} news flow is currently leaning ${toneWord(newsScore.tone)}, without any single company dominating the coverage. A broad, unconcentrated news mix usually means the score reflects the sector rather than one company's story.`
  );

  // 2. Whether price agrees with the headlines.
  if (performance && typeof performance.month === "number") {
    const monthDirection = performance.month >= 0 ? "higher" : "lower";
    const agrees =
      (newsScore.tone === "green" && performance.month >= 0) ||
      (newsScore.tone === "red" && performance.month < 0);

    out.push(
      agrees
        ? `Price is telling a similar story: the sector is ${monthDirection} over the past month, which lines up with the tone of the headlines. Agreement between news and price is not a signal on its own, but it does mean there is less of a gap to explain.`
        : `Price is not obviously agreeing: the sector is ${monthDirection} over the past month while headlines read ${toneWord(newsScore.tone)}. A gap like that is worth noticing -- either the news has not been priced in yet, or the market is looking at something the headlines are not.`
    );
  }

  // 3. Breadth -- is it the whole sector, or a few names?
  if (breadth && breadth.sampled >= 5) {
    const pct200 = Math.round((breadth.above200 / breadth.sampled) * 100);
    const pct50 = Math.round((breadth.above50 / breadth.sampled) * 100);

    out.push(
      pct200 >= 60
        ? `Breadth is reasonably healthy -- ${pct200}% of the largest names here are above their 200-day moving average (${pct50}% above their 50-day). A move backed by most of the sector is usually more durable than one carried by two or three index heavyweights.`
        : pct200 <= 35
          ? `Breadth is thin -- only ${pct200}% of the largest names here are above their 200-day moving average (${pct50}% above their 50-day). That means a positive-looking sector print can still be masking widespread weakness underneath.`
          : `Breadth is mixed -- ${pct200}% of the largest names here are above their 200-day moving average and ${pct50}% are above their 50-day, which is the kind of split that usually shows up mid-rotation rather than in a clean trend.`
    );
  }

  // 4. What's next on the calendar.
  if (earningsCount > 0) {
    out.push(
      `There ${earningsCount === 1 ? "is 1 name" : `are ${earningsCount} names`} from this sector reporting in the next week, so the earnings tone here (${earningsLabel.toLowerCase()}) can change quickly. Sector news scores tend to be least stable in the middle of a reporting run.`
    );
  } else {
    out.push(
      `Nothing from this sector is due to report in the next week, so the current earnings read (${earningsLabel.toLowerCase()}) is likely to hold for now rather than being reset by fresh results.`
    );
  }

  return out;
}

export function buildSectorWhyItMatters(args: {
  sector: SectorDef;
  symbol: string | null;
  title: string;
  tone: string | null | undefined;
}): string {
  const { sector, symbol, title, tone } = args;
  const lower = title.toLowerCase();

  const subject = symbol ? `${symbol}` : `a ${sector.name.toLowerCase()} name`;

  if (/earnings|results|revenue|guidance|quarter/.test(lower)) {
    return `This is an earnings-linked update on ${subject}. Results from a large constituent often set expectations for the rest of the ${sector.name.toLowerCase()} group, not just the company itself.`;
  }

  if (/upgrade|downgrade|price target|analyst/.test(lower)) {
    return `This is an analyst call on ${subject}. Ratings changes on a sector heavyweight can pull sentiment across peers with them, especially when the sector is already moving.`;
  }

  if (/deal|merger|acquisition|acquire|stake/.test(lower)) {
    return `This is a deal story involving ${subject}. Consolidation news tends to reprice competitors too, since it re-sets what the market thinks the assets in this sector are worth.`;
  }

  if (/lawsuit|probe|investigation|recall|fine|regulat/.test(lower)) {
    return `This is a risk or regulatory story around ${subject}. Regulatory headlines are one of the few kinds that reliably spill across a whole sector rather than staying with one company.`;
  }

  if (/tariff|fed|rates|inflation|policy|government/.test(lower)) {
    return `This is a macro or policy story touching ${subject}. Sector-level moves are more often driven by this kind of top-down news than by any single company's announcement.`;
  }

  return tone === "red"
    ? `This adds to the softer tone across ${sector.name.toLowerCase()} coverage right now. Worth watching whether it stays a single-company issue or starts showing up in peers.`
    : `This is part of what is shaping the current ${sector.name.toLowerCase()} news picture. The useful question is usually whether peers follow, or whether it stays specific to ${subject}.`;
}
