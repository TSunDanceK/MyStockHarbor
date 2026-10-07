// "Follow the money" for the insight page's measure (#563 COWORK #156 §2): a
// spending record with AMZN first and three receivers' filed lines, so the
// card renders flat with its rows. Illustrative figures; never reads Redis.
export const SPENDING_KEY = "msh:capex:spending:v1";
export const RECEIVERS_KEY = "msh:capex:receivers:v1";
export async function readSpendingRecord() {
  return { v: 1, sectors: [], leaders: [{ symbol: "AMZN", sector: "Consumer Cyclical", capex: 131.8e9 }, { symbol: "MSFT", sector: "Technology", capex: 116e9 }, { symbol: "GOOGL", sector: "Communication Services", capex: 91.4e9 }] };
}
const fig = (current, prior) => ({ fyEnd: "2026-01-25", currency: "USD", current, prior, changePct: ((current - prior) / prior) * 100, subLabelOk: true, staleSince: null, form: "10-K" });
export async function readReceiversRecord() {
  return { v: 1, rows: { nvda: fig(193.7e9, 115.2e9), "hpe-server": fig(17.6e9, 15.8e9), intc: fig(16.9e9, 16.1e9) } };
}
export async function writeSpendingRecord() { return false; }
export async function writeReceiversRecord() { return false; }
import fs from "node:fs";
const receiversFile = JSON.parse(fs.readFileSync("data/capex/receivers.json", "utf8"));
export const RECEIVER_GROUPS = receiversFile.groups;
export const RECEIVER_ENTRIES = receiversFile.rows;
export const secFetchers = {};
