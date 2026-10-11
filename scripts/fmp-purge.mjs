// Delete the FMP-derived Redis keys AFTER the FMP cancel (#553 COWORK #136).
//
// RUN ONLY AFTER THE CANCEL, ON THE OWNER'S SAY. With FMP_API_KEY still set,
// the warm jobs would write most of these keys straight back.
//
// What it deletes, and what it only reports, is scripts/lib/fmp-purge-plan.mjs
// (B's keys from CODE-B #125 plus A's list from CODE-A #147 on #552). It prints
// counts per group, never a key's value.
//
// DRY RUN unless --apply. Each opt-in group also needs its own flag:
//   --pool-figures --market-state --insight-snapshots --meters
// --opt-ins-only leaves the default groups alone: only the opted-in groups are
// deleted (#553 CODE-B #152). Without it, a later opt-in run also re-deletes
// whatever the "refills" defaults have rebuilt since the first purge -- on
// 2026-10-06 that was 8 of A's live, SEC-built earnings keys, outside the
// owner's OK for the 63 insight snapshots.
// After --apply it scans again and exits 1 if a deleted group that nothing
// refills still has keys (groups marked "refills" are rebuilt from SEC/Tiingo
// by a live writer, so a few keys back there is expected and reported).
//
//   node scripts/fmp-purge.mjs                     # dry run: counts only
//   node scripts/fmp-purge.mjs --apply             # the default groups
//   relay tasks: write-fmp-purge-dry, write-fmp-purge
//   Redis: 1 SCAN per 1,000 keys in the database (one pass, classified here),
//          + 1 MGET per 100 insight snapshots (dry run too, to count FMP-era ones),
//          + 1 HGETALL for --pool-figures, then with --apply 1 DEL per 500 keys,
//          1 HSET per 500 stripped rows, and the confirming SCAN pass.
import { pathToFileURL } from "node:url";
import { DEFAULT_GROUPS, OPT_IN_GROUPS, classify, strippedPoolRow, isFmpEraSnapshot } from "./lib/fmp-purge-plan.mjs";

/**
 * The whole run against a Redis client (a fake one in check-fmp-purge).
 * Returns the exit code; prints through `log`.
 */
export async function purge(redis, argv, log = console.log) {
  const args = new Set(argv);
  const apply = args.has("--apply");
  const optInsOnly = args.has("--opt-ins-only");
  const optedIn = new Set(OPT_IN_GROUPS.filter((g) => args.has(g.flag)).map((g) => g.id));
  const known = new Set(["--apply", "--opt-ins-only", ...OPT_IN_GROUPS.map((g) => g.flag)]);
  const unknown = [...args].filter((a) => !known.has(a));
  if (unknown.length) {
    log(`FATAL: unknown argument(s) ${unknown.join(" ")}. Nothing read or deleted.`);
    return 2;
  }

  let commands = 0;

  /** One SCAN pass over the whole database; each key filed under its group. */
  async function scanGroups() {
    const byGroup = new Map();
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, { count: 1000 });
      commands++;
      cursor = String(next);
      for (const k of batch.map(String)) {
        const g = classify(k);
        if (!g) continue;
        if (!byGroup.has(g.id)) byGroup.set(g.id, new Set());
        byGroup.get(g.id).add(k);
      }
    } while (cursor !== "0");
    return byGroup;
  }

  const ALL = [...DEFAULT_GROUPS, ...OPT_IN_GROUPS];
  const count = (byGroup, id) => byGroup.get(id)?.size ?? 0;

  const found = await scanGroups();
  for (const keys of found.values()) {
    for (const k of keys) {
      if (k.startsWith("msh:tiingo:")) {
        log("FATAL: a msh:tiingo: key was classified. Nothing deleted.");
        return 2;
      }
    }
  }

  // Insight snapshots: only FMP-era records count; Tiingo-path records stay.
  const snapKeys = [...(found.get("insight-snapshots-fmp") ?? [])];
  const fmpSnaps = [];
  for (let i = 0; i < snapKeys.length; i += 100) {
    const slice = snapKeys.slice(i, i + 100);
    const vals = await redis.mget(...slice);
    commands++;
    vals.forEach((v, j) => { if (isFmpEraSnapshot(v)) fmpSnaps.push(slice[j]); });
  }

  // Pool rows still carrying FMP figures (read only when asked: one large HGETALL).
  let poolRows = null;
  if (optedIn.has("pool-figures") && count(found, "pool-figures")) {
    const all = (await redis.hgetall("msh:price-pool:v1")) ?? {};
    commands++;
    poolRows = Object.entries(all).map(([f, row]) => [f, strippedPoolRow(row)]).filter(([, r]) => r);
  }

  log(`FMP purge ${apply ? "(APPLY)" : "(DRY RUN)"}: keys per group\n`);
  for (const g of ALL) {
    const n = g.id === "insight-snapshots-fmp" ? fmpSnaps.length : count(found, g.id);
    const where = g.exact ?? `${g.prefix}*`;
    const extra = g.id === "insight-snapshots-fmp" ? ` (of ${snapKeys.length} snapshots; Tiingo-path ones are kept)` :
      g.id === "pool-figures" ? (poolRows ? ` (${poolRows.length} rows with FMP figures to null; the hash and its fields stay)` : " (the hash stays; rows counted only with --pool-figures)") : "";
    const mode = g.flag ? (optedIn.has(g.id) ? "opted in" : `report only, needs ${g.flag}`) : optInsOnly ? "default, kept (--opt-ins-only)" : "default";
    log(`  ${String(n).padStart(6)}  ${g.owner}  ${where}${g.noTtl ? "  [no TTL]" : ""}${g.refills ? "  [refills]" : ""}  — ${mode}${extra}`);
  }

  const toDelete = [];
  if (!optInsOnly) for (const g of DEFAULT_GROUPS) toDelete.push(...(found.get(g.id) ?? []));
  if (optedIn.has("market-state")) toDelete.push(...(found.get("market-state") ?? []));
  if (optedIn.has("fmp-meters")) toDelete.push(...(found.get("fmp-meters") ?? []));
  if (optedIn.has("insight-snapshots-fmp")) toDelete.push(...fmpSnaps);
  const strips = optedIn.has("pool-figures") ? poolRows?.length ?? 0 : 0;

  if (!apply) {
    log(`\nDRY RUN: would DEL ${toDelete.length} key(s)${strips ? ` and null the figures in ${strips} pool row(s)` : ""}. Redis commands: ${commands}`);
    return 0;
  }

  let removed = 0;
  for (let i = 0; i < toDelete.length; i += 500) {
    removed += await redis.del(...toDelete.slice(i, i + 500));
    commands++;
  }
  let stripped = 0;
  if (strips) {
    for (let i = 0; i < poolRows.length; i += 500) {
      await redis.hset("msh:price-pool:v1", Object.fromEntries(poolRows.slice(i, i + 500)));
      commands++;
      stripped += Math.min(500, poolRows.length - i);
    }
  }

  const after = await scanGroups();
  const deletedIds = [...(optInsOnly ? [] : DEFAULT_GROUPS.map((g) => g.id)), ...["market-state", "fmp-meters"].filter((id) => optedIn.has(id))];
  const left = deletedIds.map((id) => [ALL.find((g) => g.id === id), count(after, id)]).filter(([, n]) => n > 0);
  const bad = left.filter(([g]) => !g.refills);
  log(`\napplied at ${new Date().toISOString()}: DEL removed ${removed}${strips ? `; pool rows stripped ${stripped}` : ""}. Redis commands: ${commands}`);
  for (const [g, n] of left) log(`  left: ${n} under ${g.exact ?? `${g.prefix}*`}${g.refills ? " (refilled by a live writer, expected)" : " (UNEXPECTED: is FMP_API_KEY still set?)"}`);
  return bad.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { Redis } = await import("@upstash/redis");
  process.exit(await purge(Redis.fromEnv(), process.argv.slice(2)));
}
