// Shapes shared by the adapter, the jobs and the readers. Kept apart from
// tiingo.ts so a reader never imports the file that holds the key.

/** [date, open, high, low, close, volume], split- and dividend-adjusted. */
export type EodBar = [string, number, number, number, number, number];

/** One symbol's stored history (the value at tiingoEodKey). */
export type StoredEod = { asOf: string; fetchedAt: number; bars: EodBar[] };

/** One quote row in the Tiingo pool hash. */
export type StoredQuote = {
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  /** Epoch ms of the last IEX sale. */
  at: number;
};
