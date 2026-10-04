// DELETE THE STORED SEC SETS THAT FAIL THE SEED GATE (#552 COWORK #150, owner
// ruling 4 Oct). ONE-OFF, run from a branch through the relay; never a cron.
//
// For each member of the fact-set index that fails secSeedRefusal AT RUN TIME
// (not a list typed in), except any symbol named in hold=:
//   - DEL its msh:sec:facts:v1:<spelling> key and SREM it from the index;
//   - in the manifest, set its entry's contentHash to null and needsReverify to
//     false, so populate's gate keeps it out and neither reverify nor rewindow
//     reads it back (sec-filings skips a symbol with no stored set).
// Nothing else is touched: other entries, other keys.
//
// ── INPUTS, via the relay's SYMBOLS field ──────────────────────────────────
//   mode=dry|delete          dry (default) lists and counts, writes nothing
//   confirm=sec-gate-stored  required with mode=delete
//   hold=SYM,SYM             symbols to leave in place (listed, not deleted)
//
// SAFETY: a delete refuses to start inside a scheduled SEC job's window or
// within 10 minutes of one, because the manifest is one key the jobs rewrite —
// a job mid-run would write its copy back over this edit. The manifest is read
// fresh immediately before its write.
//
//   relay task: write-sec-gate-delete
import "./lib/register-ts-app.mjs";
import { Redis } from "@upstash/redis";
import { inSecJobWindow } from "../lib/secJobWindow.mjs";

const redis = Redis.fromEnv();
const { SEC_FACTS_INDEX_KEY, SEC_MANIFEST_KEY, dotDashSpellings } = await import("../lib/server/secManifest.ts");
const { factKey } = await import("../lib/server/secFactStore.ts");
const { secSeedRefusal } = await import("../lib/server/secSeedGate.ts");
const { cikForSymbol } = await import("../lib/server/secColdFetch.ts");

const tokens = Object.fromEntries(String(process.env.SYMBOLS ?? "").split(/\s+/).filter(Boolean).map((t) => t.split("=")));
const mode = tokens.mode === "delete" ? "delete" : "dry";
const hold = new Set(String(tokens.hold ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
let commands = 0;

if (mode === "delete") {
  if (tokens.confirm !== "sec-gate-stored") { console.error("REFUSED: mode=delete needs confirm=sec-gate-stored"); process.exit(1); }
  const now = Date.now();
  if (inSecJobWindow(now) || inSecJobWindow(now + 10 * 60 * 1000)) {
    console.error(`REFUSED: inside or within 10 min of an SEC job window (${new Date(now).toISOString()}). Nothing written.`);
    process.exit(1);
  }
}

const members = (await redis.smembers(SEC_FACTS_INDEX_KEY)).map(String); commands++;
const targets = [], held = [];
for (const m of members) {
  const sym = m.toUpperCase();
  const cik = cikForSymbol(sym);
  const why = cik ? secSeedRefusal(sym, cik) : null;
  if (!why) continue;
  (dotDashSpellings(sym).some((s) => hold.has(s)) ? held : targets).push({ member: m, sym, why, key: factKey(m) });
}
const existsP = redis.pipeline();
targets.forEach((t) => existsP.exists(t.key));
const exists = targets.length ? await existsP.exec() : []; commands += targets.length;
targets.forEach((t, i) => { t.exists = Number(exists[i]) > 0; });

const manifest = await redis.get(SEC_MANIFEST_KEY); commands++;
const entryKey = (sym) => dotDashSpellings(sym).find((k) => manifest?.symbols && Object.prototype.hasOwnProperty.call(manifest.symbols, k)) ?? null;

const byReason = (list) => list.reduce((m, t) => ((m[t.why] ??= []).push(t.sym), m), {});
console.log(`mode ${mode} · index ${members.length} · failing the gate ${targets.length + held.length} · to delete ${targets.length} · held ${held.length}`);
for (const [why, syms] of Object.entries(byReason(targets))) console.log(`  delete ${why}: ${syms.length} — ${syms.sort().join(", ")}`);
for (const [why, syms] of Object.entries(byReason(held))) console.log(`  HELD   ${why}: ${syms.length} — ${syms.sort().join(", ")}`);
console.log(`  keys present: ${targets.filter((t) => t.exists).length} of ${targets.length}`);
const withEntry = targets.filter((t) => entryKey(t.sym));
console.log(`  manifest entries to clear (contentHash→null, needsReverify→false): ${withEntry.length}` +
  ` (already null: ${withEntry.filter((t) => manifest.symbols[entryKey(t.sym)].contentHash === null).length})`);

if (mode === "delete" && targets.length) {
  const keys = targets.filter((t) => t.exists).map((t) => t.key);
  const deleted = keys.length ? await redis.del(...keys) : 0; if (keys.length) commands++;
  const removed = await redis.srem(SEC_FACTS_INDEX_KEY, ...targets.map((t) => t.member)); commands++;
  // FRESH, immediately before the write: a minimal window for a lost update.
  const fresh = await redis.get(SEC_MANIFEST_KEY); commands++;
  let cleared = 0;
  for (const t of targets) {
    const k = dotDashSpellings(t.sym).find((s) => fresh?.symbols && Object.prototype.hasOwnProperty.call(fresh.symbols, s));
    if (!k) continue;
    fresh.symbols[k].contentHash = null;
    fresh.symbols[k].needsReverify = false;
    cleared++;
  }
  if (cleared) { await redis.set(SEC_MANIFEST_KEY, { ...fresh, updatedAt: Date.now() }); commands++; }
  console.log(`\nDELETED: ${deleted} fact-set keys · ${removed} index members · ${cleared} manifest entries cleared`);
}
console.log(`\nRedis commands: ${commands}${mode === "dry" ? " (read-only; nothing written)" : ""}`);
