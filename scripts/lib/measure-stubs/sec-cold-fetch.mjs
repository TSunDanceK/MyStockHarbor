// The earnings page's store read, fed from the committed AAPL fact-set fixture
// (#552 COWORK #153): the measure sizes the page a reader sees, not "not yet read".
import fs from "node:fs";
export * from "../../../lib/server/secColdFetch.ts";
const set = JSON.parse(fs.readFileSync(new URL("../../../data/sec/factset-fixture-AAPL.json", import.meta.url), "utf8"));
export const resolveFactSetForRender = async () => ({ status: "ready", set, cold: false });
export const awaitingSecRead = async () => false;
