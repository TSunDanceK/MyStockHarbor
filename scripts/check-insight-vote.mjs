// THE INSIGHT READER VOTE (#563 COWORK #132/#133, PR 2): rules, then mutants.
//
//   1. windows: the newest announcement on or before today opens the current
//      window; future dates are ignored; none on file is "open"; the previous
//      window runs from the one before to the newest;
//   2. shares add up to 100 and the total is the sum;
//   3. "how readers called it": a move within ±2% is sideways; fewer than
//      MIN_VOTES_SHOWN votes say nothing; the words never advise;
//   4. the cookie: "{window}:{choice}" parses, anything else doesn't;
//   5. the route: BotID on GET and POST, both listed in instrumentation-client;
//      the window is the server's (from the symbol's report dates), never the
//      body's; a second vote in a window is refused (409); slugs are checked;
//   6. the store: production and previews write different keys; nothing but
//      the three counters is written (no IP, no id); one pipelined round trip;
//   7. the page: no tally is read at render (the card gets a slug and a window
//      only); one report-dates read feeds the next-report line and the windows;
//      the fine print says it is a poll, not advice.
// A mutant each.
//
//   node scripts/check-insight-vote.mjs
import fs from "node:fs";
import ts from "typescript";
import { stripComments } from "./lib/source-code.mjs";

const VOTE = "lib/insightVote.ts", STORE = "lib/server/insightVoteWrite.ts", KEYS = "lib/server/insightVoteStore.ts", ROUTE = "app/api/insights/vote/route.ts";
const CLIENT = "app/insights/[slug]/InsightVote.tsx", PAGE = "app/insights/[slug]/InsightPage.tsx", LOADER = "lib/server/insightPage.ts";
const BOT = "instrumentation-client.ts";
const read = (f) => fs.readFileSync(f, "utf8");

let n = 0;
async function load(src) {
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const tmp = `scripts/.check-insight-vote-${process.pid}-${n++}.mjs`;
  fs.writeFileSync(tmp, js);
  try { return await import(`${process.cwd()}/${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
}
const code = (f, src = read(f)) => stripComments(src, { file: f });

const ADVICE = /\b(buy|sell|should|must|recommend)\b/i;
const RULES = {
  "windows: the newest announcement on or before today opens the window": ({ V }) => {
    const w = V.voteWindows(["2026-07-30", "2026-04-30", "2026-10-29", "2026-01-29"], "2026-10-07");
    const none = V.voteWindows([], "2026-10-07"), one = V.voteWindows(["2026-07-30"], "2026-10-07");
    return w.current.id === "2026-07-30" && w.previous.id === "2026-04-30" && w.previous.from === "2026-04-30" && w.previous.to === "2026-07-30" &&
      none.current.id === "open" && none.previous === null && one.previous.id === "open" && one.previous.from === null &&
      V.voteWindows(["2026-10-07"], "2026-10-07").current.id === "2026-10-07";
  },
  "shares add up to 100": ({ V }) => {
    const cases = [{ higher: 1, sideways: 1, lower: 1 }, { higher: 2, sideways: 1, lower: 0 }, { higher: 7, sideways: 5, lower: 9 }, { higher: 0, sideways: 0, lower: 0 }];
    return cases.every((t) => { const s = V.tallyShares(t); const sum = s.pct.higher + s.pct.sideways + s.pct.lower; return s.total === t.higher + t.sideways + t.lower && (s.total ? sum === 100 : sum === 0); });
  },
  "how readers called it: ±2% is sideways, too few votes say nothing, no advice": ({ V }) => {
    const t = { higher: 6, sideways: 2, lower: 2 };
    const up = V.calledWords("AMZN", t, 4.2, "30 Jul 2026"), flat = V.calledWords("AMZN", t, 1.9, "30 Jul 2026");
    return V.calledAs(2) === "higher" && V.calledAs(-2) === "lower" && V.calledAs(1.99) === "sideways" &&
      /60% of 10 readers said higher/.test(up) && /counts as higher/.test(up) && /counts as sideways/.test(flat) &&
      V.calledWords("AMZN", { higher: 2, sideways: 1, lower: 1 }, 4, "30 Jul 2026") === null &&
      ![up, flat, ...V.VOTE_CHOICES.map((c) => c.label)].some((s) => ADVICE.test(s));
  },
  "the cookie is {window}:{choice}": ({ V }) =>
    JSON.stringify(V.parseVoteCookie("2026-07-30:higher")) === '{"window":"2026-07-30","choice":"higher"}' &&
    V.parseVoteCookie("open:lower")?.window === "open" && V.parseVoteCookie("2026-07-30:up") === null && V.parseVoteCookie("x:higher") === null &&
    V.parseVoteCookie(undefined) === null && V.VOTE_SLUG_RE.test("amzn-daily-ma200-buy-zone-july-2026") && !V.VOTE_SLUG_RE.test("../etc"),
  "the route: BotID both ways, the server's window, one vote per window": ({ route, bot }) =>
    (route.match(/if \(await isUnwantedBot\(\)\) return deny\(\);/g) ?? []).length === 2 &&
    /\{ path: "\/api\/insights\/vote", method: "POST" \}/.test(bot) && /\{ path: "\/api\/insights\/vote", method: "GET" \}/.test(bot) &&
    /const dates = await readReportDatesChecked\(sym\);/.test(route) && /const windowId = voteWindows\(announcedDates\(dates\.rec\), new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\)\.current\.id;/.test(route) &&
    !/body\.window/.test(route) && /if \(prior\?\.window === windowId\) \{[\s\S]{0,200}status: 409/.test(route) &&
    /if \(!VOTE_SLUG_RE\.test\(slug\)\) return null;/.test(route),
  "the store: previews write their own keys; only the three counters, one round trip": ({ store, keys }) =>
    /`\$\{production \? VOTE_PREFIX : VOTE_PREVIEW_PREFIX\}\$\{slug\}:\$\{windowId\}`/.test(keys) && /production = isProductionDeployment\(\)/.test(keys) &&
    /VOTE_PREFIX = "msh:insights:vote:v1:"/.test(keys) && /VOTE_PREVIEW_PREFIX = "msh:insights:vote:preview:v1:"/.test(keys) &&
    !/PAGE_TIMEOUT_OPTS/.test(keys) && !/\.(?:hincrby|pipeline)\(/.test(keys) &&
    /p\.hincrby\(key, choice, 1\);\s*p\.expire\(key, VOTE_TTL_SECONDS\);\s*p\.hgetall\(key\);/.test(store) &&
    (store.match(/\.(?:set|hset|hincrby|incr|lpush|sadd|zadd)\(/g) ?? []).length === 1,
  "the page: no tally at render, one report-dates read, the poll's fine print": ({ page, loader, client }) =>
    /<InsightVote slug=\{n\.slug\} window=\{d\.vote\.window\} \/>/.test(page) && !/tally/.test(page) &&
    /A poll of readers, not a forecast or advice\./.test(page) &&
    (loader.match(/readReportDatesChecked\(/g) ?? []).length === 1 && /const outlook = outlookFromRead\(sym, dates, today\);/.test(loader) && !/getSymbolOutlook/.test(loader) &&
    /if \(!prior \|\| prior\.window !== windowId\) return;/.test(client),
};

const MUTANTS = [
  ["windows:", VOTE, (s) => s.replace('d <= today))]', 'true))]')],
  ["windows:", VOTE, (s) => s.replace('previous: { id: past[1] ?? "open", from: past[1] ?? null, to: past[0] },', 'previous: null,')],
  ["shares add up", VOTE, (s) => s.replace("for (const [, i] of order) { if (left <= 0) break; floor[i]++; left--; }", "")],
  ["how readers called it", VOTE, (s) => s.replace("export const CALLED_BAND_PCT = 2;", "export const CALLED_BAND_PCT = 5;")],
  ["how readers called it", VOTE, (s) => s.replace("if (total < MIN_VOTES_SHOWN) return null;", "")],
  ["how readers called it", VOTE, (s) => s.replace("which counts as ${LABEL[went]} here", "so readers should buy ${LABEL[went]}")],
  ["the cookie", VOTE, (s) => s.replace("/^((?:\\d{4}-\\d{2}-\\d{2})|open):(higher|sideways|lower)$/", "/^(.+):(.+)$/")],
  ["the route:", ROUTE, (s) => s.replace("export async function GET(request: Request) {\n  if (await isUnwantedBot()) return deny();", "export async function GET(request: Request) {")],
  ["the route:", ROUTE, (s) => s.replace("if (prior?.window === windowId) {", "if (false) {")],
  ["the route:", ROUTE, (s) => s.replace("const windowId = voteWindows(", "const windowId = String(body.window) || voteWindows(")],
  ["the route:", BOT, (s) => s.replace('    { path: "/api/insights/vote", method: "POST" },\n', "")],
  ["the store:", KEYS, (s) => s.replace("`${production ? VOTE_PREFIX : VOTE_PREVIEW_PREFIX}${slug}:${windowId}`", "`${VOTE_PREFIX}${slug}:${windowId}`")],
  ["the store:", STORE, (s) => s.replace("p.hgetall(key);", "p.hgetall(key);\n    p.hset(`${key}:ip`, { ip: 1 });")],
  ["the page:", PAGE, (s) => s.replace("<InsightVote slug={n.slug} window={d.vote.window} />", "<InsightVote slug={n.slug} window={d.vote.window} tally={d.vote.tally} />")],
  ["the page:", LOADER, (s) => s.replace("const outlook = outlookFromRead(sym, dates, today);", "const outlook = await getSymbolOutlook(sym, today);")],
];

const srcs = (over = {}) => ({
  route: code(ROUTE, over[ROUTE]), store: code(STORE, over[STORE]), keys: code(KEYS, over[KEYS]), page: code(PAGE, over[PAGE]),
  loader: code(LOADER, over[LOADER]), client: code(CLIENT, over[CLIENT]), bot: code(BOT, over[BOT]),
});
const run = (rule, m) => { try { return !!rule(m); } catch (e) { if (process.env.DEBUG) console.log(e); return false; } };

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
const base = { V: await load(read(VOTE)), ...srcs() };
console.log("=== Rules ===");
for (const [label, rule] of Object.entries(RULES)) check(label, run(rule, base));
console.log("=== Mutants: each must FAIL its rule ===");
for (const [start, file, mutate] of MUTANTS) {
  const label = Object.keys(RULES).find((k) => k.startsWith(start));
  const src = read(file), mut = mutate(src);
  if (!label) { check(`mutant: no rule starts "${start}"`, false); continue; }
  if (mut === src) { check(`mutant bites: ${label} — the mutation did not apply`, false); continue; }
  const m = file === VOTE ? { ...base, V: await load(mut) } : { ...base, ...srcs({ [file]: mut }) };
  check(`mutant bites: ${label}`, !run(RULES[label], m));
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
