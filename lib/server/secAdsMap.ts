// THE CITED ADS RATIO MAP (#552 COWORK #22 §1): data/sec/ads-ratios.json.
//
// One row per depositary-share filer whose own 20-F (Item 12.D / cover) or
// F-6 states the ratio, found by scripts/ads-ratio-census.mjs with the
// shipped parser (secAdsRatio) and checked by scripts/check-ads-ratios.mjs.
// Each row carries the ratio, the sentence, the form, accession and date.
// A symbol with no row keeps the depositary-share refusal: the ratio is never
// inferred and never defaulted to 1.
import ratiosFile from "@/data/sec/ads-ratios.json";
import { lookupSpellingIn } from "../symbolSpellings.mjs";

export type AdsRatioEntry = {
  /** "ads": a stated ratio. "ordinary": listed directly (ratio 1, cited from the 12(b) row). */
  kind: "ads" | "ordinary";
  /** Ordinary shares one ADS represents. */
  ordinaryPerAds: number;
  /** The filing's sentence, verbatim. */
  evidence: string;
  form: string;
  /** Accession of the filing the sentence is quoted from. */
  source: string;
  filed: string;
};

const ENTRIES = (ratiosFile as unknown as { entries: Record<string, AdsRatioEntry> }).entries;

export function adsRatioFor(symbol: string): AdsRatioEntry | null {
  return lookupSpellingIn(ENTRIES, String(symbol ?? "").toUpperCase())?.value ?? null;
}
