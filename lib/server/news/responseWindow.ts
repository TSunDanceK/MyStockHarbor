// The free reading taken on every raw news response, before any of our filters.
//
// MOVED VERBATIM out of lib/stock-news-data.ts in step 1 of
// claude/news-adapter-spec-2026-09-13.md, for the cycle reason given in
// ./text.ts. The adapters are what hold a raw upstream response, so this is
// where the measurement has to live; lib/sector-news-data.ts calls the same
// function on its own payload so there stays one implementation of the reading.
//
// scripts/check-news-feed.mjs §7-7d exercises this function directly and asserts
// that the call site takes the reading BEFORE mapping or filtering.

/**
 * How many articles a raw FMP news response holds, and how they are spread
 * across days.
 *
 * WHAT THIS DECIDES. `limit=50` has been an open question all day, argued from
 * arithmetic rather than data: 50 articles fetched to display 15 looks like
 * obvious waste and may not be, because dedup collapses the same story reported
 * by several outlets and a busy ticker can burn 20 of those 50 on one morning.
 * The number that settles it is how many DAYS a 50-article response actually
 * spans. If a response reliably covers a week or more, 50 is buying a complete
 * window and a headline count derived from it is EXACT. If it saturates -- 50
 * articles inside two days -- then the window is truncated and any count derived
 * from it is a FLOOR that must read "50+ in N days", never a total.
 *
 * Free. Every figure here is already in a payload that has been fetched and
 * parsed; this adds no FMP call and no second request.
 *
 * MEASURED ON THE RAW RESPONSE, before any of our filtering. The question is
 * what FMP returns for a given `limit`, not what survives isLowValueNewsItem --
 * filtering first would measure our own rules and attribute the result to FMP
 * (claude/traps/measuring-the-wrong-layer.md).
 *
 * ORDERING IS TESTED, NOT ASSUMED. The whole "truncation happens at the old
 * end, so recent days are complete" argument rests on FMP returning
 * newest-first. Comparing the first and last rows does not establish that: a
 * shuffled array whose extremes happen to fall in order passes that test. Every
 * adjacent pair is checked, and the count of inversions is reported so a
 * partially-ordered response is distinguishable from a sorted one and from a
 * random one. If `monotonic=false` shows up in the logs, the analysis above does
 * not hold and the limit question reopens on different terms.
 */
export function logResponseWindow(label: string, symbol: string, rows: unknown[], limit: number): void {
  const dates: { key: string; t: number }[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const raw = String(r?.publishedDate ?? r?.date ?? "").trim();
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) continue;
    dates.push({ key: new Date(t).toISOString().slice(0, 10), t });
  }

  if (!dates.length) {
    console.log(`[news-window] ${label} ${symbol} rows=${rows.length} dated=0 — no usable dates`);
    return;
  }

  // Per-day counts, in calendar order so the shape is readable at a glance.
  const perDay = new Map<string, number>();
  for (const d of dates) perDay.set(d.key, (perDay.get(d.key) ?? 0) + 1);
  const days = [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  // Every adjacent pair, not the endpoints. See the note above.
  let inversions = 0;
  for (let i = 1; i < dates.length; i++) {
    if (dates[i].t > dates[i - 1].t) inversions += 1;
  }

  const spanDays = days.length;
  const maxDay = Math.max(...days.map(([, n]) => n));
  // Saturated = FMP gave us everything it was asked for, so there is very
  // likely more it did not send. `rows === limit` is the signal; a short
  // response means the ticker simply has no more.
  const saturated = rows.length >= limit;

  console.log(
    `[news-window] ${label} ${symbol} rows=${rows.length}/${limit}` +
      ` saturated=${saturated} distinctDays=${spanDays} maxPerDay=${maxDay}` +
      ` monotonic=${inversions === 0} inversions=${inversions}` +
      ` oldest=${days[days.length - 1][0]} newest=${days[0][0]}` +
      ` perDay=[${days.map(([d, n]) => `${d}:${n}`).join(",")}]`
  );
}
