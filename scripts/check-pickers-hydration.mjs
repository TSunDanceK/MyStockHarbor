// /pickers RENDERS THE SAME TEXT ON THE SERVER AND IN EVERY BROWSER (#553 COWORK #143).
//
// React #418 (a text mismatch) fired on every /pickers load. The server renders
// in UTC with its own locale; the browser re-renders in the viewer's zone and
// locale. Two texts differed: the footer's `new Date(updatedAt).toLocaleString()`
// and the Insights panel's date (toLocaleDateString with no timeZone, the day
// before for a viewer west of UTC). Both now go through lib/utcDate.
//
// The check renders PickersClient (scripts/lib/tsx-render-hooks.mjs) in child
// processes under different TZ / locale settings and requires byte-identical
// HTML: what the server sends is what hydration re-renders. A mutant puts the
// old toLocaleString back and must be caught.
//
//   node scripts/check-pickers-hydration.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const SRC = "app/pickers/PickersClient.tsx";
const ENVS = [
  { TZ: "UTC", LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" },
  { TZ: "Europe/London", LC_ALL: "en_GB.UTF-8", LANG: "en_GB.UTF-8" },
  { TZ: "America/Los_Angeles", LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" },
  { TZ: "Asia/Tokyo", LC_ALL: "de_DE.UTF-8", LANG: "de_DE.UTF-8" },
];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// The child: render PickersClient from `file` with a fixed payload, print the HTML.
const CHILD = `
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register(pathToFileURL(process.env.ROOT + "/scripts/lib/tsx-render-hooks.mjs"));
const React = (await import("react")).default;
const { renderToString } = await import("react-dom/server");
// The browser's default locale: what toLocaleString() with no locale reads.
if (process.env.FAKE_LOCALE) {
  const L = process.env.FAKE_LOCALE;
  const ds = Date.prototype.toLocaleString, dd = Date.prototype.toLocaleDateString;
  Date.prototype.toLocaleString = function (loc, o) { return ds.call(this, loc ?? L, o); };
  Date.prototype.toLocaleDateString = function (loc, o) { return dd.call(this, loc ?? L, o); };
}
const C = await import(pathToFileURL(process.env.FILE).href);
process.stdout.write(renderToString(React.createElement(C.default, {
  latestInsights: [{ slug: "a", title: "A post", date: "2026-10-02", symbol: "ABC" }],
  initialPickersPayload: { sections: [{ title: "Oversold", items: [] }], signalRecords: [], updatedAt: "2026-10-04T14:05:00.000Z", universeSize: 10 },
})));
`;
const childFile = path.join(ROOT, "scripts", `.check-pickers-hydration-child-${process.pid}.mjs`);
const tmp = [childFile];
fs.writeFileSync(childFile, CHILD);

function renders(file) {
  return ENVS.map((e) => execFileSync(process.execPath, [childFile], {
    cwd: ROOT,
    env: { ...process.env, ...e, FAKE_LOCALE: e.LC_ALL.slice(0, 5).replace("_", "-"), ROOT, FILE: file },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }));
}

function rules(htmls) {
  const fails = [];
  if (!htmls.every((h) => h === htmls[0])) fails.push("the HTML differs between server zones/locales (a hydration mismatch)");
  if (!htmls[0].includes("4 Oct 2026, 14:05 UTC")) fails.push("the footer stamp reads \"4 Oct 2026, 14:05 UTC\"");
  if (!/insight-meta">2 Oct</.test(htmls[0])) fails.push("the Insights date is the post's own UTC day, \"2 Oct\"");
  return fails;
}

try {
  console.log("\n=== /pickers: one text for every zone and locale ===\n");
  const f = rules(renders(path.join(ROOT, SRC)));
  check(`PickersClient renders identically under ${ENVS.map((e) => `${e.TZ}/${e.LC_ALL.slice(0, 5)}`).join(", ")}`, f.length === 0, f.join("; "));

  console.log("\n=== Mutants ===\n");
  const src = fs.readFileSync(path.join(ROOT, SRC), "utf8");
  const MUTANTS = [
    ["the footer back on toLocaleString()", /\{utcStamp\(updatedAt\) \?\? updatedAt\}/, "{new Date(updatedAt).toLocaleString()}"],
    ["the Insights date back on local fields", /\{utcDay\(post\.date\)\?\.replace\(\/ \\d\{4\}\$\/, ""\) \?\? post\.date\}/, '{new Date(post.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}'],
  ];
  for (const [label, from, to] of MUTANTS) {
    const m = src.replace(from, to);
    if (m === src) { check(`mutant "${label}" applies`, false, "the replacement matched nothing"); continue; }
    const file = path.join(ROOT, "app", "pickers", `.check-hydration-${process.pid}-${tmp.length}.tsx`);
    fs.writeFileSync(file, m);
    tmp.push(file);
    let fails;
    try { fails = rules(renders(file)); } catch (e) { fails = [`threw: ${String(e.message).split("\n")[0]}`]; }
    check(`mutant "${label}" is caught`, fails.length > 0, fails[0] ?? "no assertion failed");
  }
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
