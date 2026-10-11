// The fact-set read for the insight page's measure (#563 COWORK #138 §3): the
// committed AAPL fixture for AAPL only, "pending" (not read yet, like a cold
// POOL) for every other symbol, so the rail's no-facts state renders too.
import fs from "node:fs";
export * from "../../../lib/server/secColdFetch.ts";
const set = JSON.parse(fs.readFileSync(new URL("../../../data/sec/factset-fixture-AAPL.json", import.meta.url), "utf8"));
export const resolveFactSetForRender = async (symbol) =>
  String(symbol).toUpperCase() === "AAPL" ? { status: "ready", set, cold: false } : { status: "pending", reason: "Not read yet." };
export const awaitingSecRead = async () => false;
