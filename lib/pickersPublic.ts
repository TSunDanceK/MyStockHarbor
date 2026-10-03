/**
 * NO PRICE BARS IN THE PUBLIC /api/pickers ANSWER (#553 COWORK #105).
 *
 * Contract ruling: Tiingo-derived bars don't go out through public JSON; pages
 * read them in-process. /api/pickers is public and CDN-cached
 * (`public, s-maxage=3600`), and its payload carried 72 daily bars per signal
 * record (`signalRecords[].chartPoints`) plus the weekly sections' own
 * `items[].chartPoints`. Every payload answer of handlePickersRequest now goes
 * through pickersWithoutBars, which removes EVERY `chartPoints` key at any
 * depth -- not a list of known places, so a future section that carries its
 * own series is covered without anyone remembering this file.
 *
 * ALWAYS, NOT PER PROVIDER. The payload does not say per record which provider
 * its bars came from, FMP goes off on 14 Oct, and no browser reader of the
 * route draws a chart from them (PickersClient and DashboardTicker read
 * sections, records' flags and tickerFeed only). The pages that draw charts
 * (PickerResultPage and the preset pages) read getPickersData in-process,
 * which this does not touch.
 *
 * NEVER MUTATES ITS INPUT: the handler's argument is the builder's shared
 * in-process memo, which the pages read with bars. Objects and arrays on the
 * path to a `chartPoints` are shallow-copied; untouched branches are shared.
 * The result is remembered per input object, so the memo path (one object,
 * many requests) walks it once.
 *
 * Imports nothing. Checked by scripts/check-pickers-api-no-bars.mjs.
 */

const BAR_KEY = "chartPoints";

const stripped = new WeakMap<object, unknown>();

function strip(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < value.length; i++) {
      const v = strip(value[i]);
      if (v !== value[i]) {
        if (!out) out = value.slice();
        out[i] = v;
      }
    }
    return out ?? value;
  }
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === BAR_KEY) {
      if (!out) out = { ...(value as Record<string, unknown>) };
      delete out[k];
      continue;
    }
    const s = strip(v);
    if (s !== v) {
      if (!out) out = { ...(value as Record<string, unknown>) };
      out[k] = s;
    }
  }
  return out ?? value;
}

/** The payload as /api/pickers may serve it: no `chartPoints` anywhere. */
export function pickersWithoutBars<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  const hit = stripped.get(data as object);
  if (hit !== undefined) return hit as T;
  const out = strip(data) as T;
  stripped.set(data as object, out);
  return out;
}
