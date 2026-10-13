// WRITE EACH DEPENDENCY'S GRADE INTO ITS DATA FILE (#563 COWORK #158).
//
// For every content/bottlenecks/*.md, adds `grade: hard|some|spread` under each
// supplyChain / customers row's `pct:` line, from lib/bottleneckPage.ts's
// defaultGrade. A row that already has a grade keeps it. Idempotent. Prints the
// full list (page → side → row → grade) for the PR.
//
//   node scripts/bottleneck-grades.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import matter from "gray-matter";

register("./lib/tsx-render-hooks.mjs", import.meta.url);
const { defaultGrade, isGrade } = await import("../lib/bottleneckPage.ts");
const DRY = process.argv.includes("--dry");
const DIR = "content/bottlenecks";
const out = [];
let changed = 0;
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith(".md")).sort()) {
  const file = path.join(DIR, f), src = fs.readFileSync(file, "utf8");
  const { data } = matter(src);
  const grades = { supplyChain: [], customers: [] };
  for (const [key, side] of [["supplyChain", "supplier"], ["customers", "customer"]]) {
    for (const r of data[key] ?? []) {
      const g = isGrade(r.grade) ? r.grade : defaultGrade(side, Number(r.pct), String(r.blurb ?? ""));
      grades[key].push({ g, had: isGrade(r.grade) });
      out.push(`${f.replace(/\.md$/, "")}\t${side}\t${r.name}\t${r.pct}%\t${g}${isGrade(r.grade) ? " (filed)" : ""}`);
    }
  }
  // Insert after each row's `pct:` line, in order, per section.
  const lines = src.split("\n");
  let section = null, idx = -1, inFront = 0;
  const res = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === "---") inFront++;
    if (inFront === 1) {
      if (/^supplyChain:/.test(l)) { section = "supplyChain"; idx = -1; }
      else if (/^customers:/.test(l)) { section = "customers"; idx = -1; }
      else if (/^[A-Za-z]/.test(l)) section = null;
      if (section && /^\s*-\s+name:/.test(l)) idx++;
    }
    res.push(l);
    const m = inFront === 1 && section ? l.match(/^(\s*)pct:\s*/) : null;
    if (m) {
      const row = grades[section][idx];
      const hasGrade = lines.slice(i + 1, i + 6).some((x) => new RegExp(`^${m[1]}grade:`).test(x) ) && lines.slice(i + 1).findIndex((x) => /^\s*-\s+name:/.test(x) || /^[A-Za-z-]/.test(x)) > lines.slice(i + 1).findIndex((x) => new RegExp(`^${m[1]}grade:`).test(x));
      if (row && !row.had && !hasGrade) res.push(`${m[1]}grade: ${row.g}`);
    }
  }
  const next = res.join("\n");
  if (next !== src) { changed++; if (!DRY) fs.writeFileSync(file, next); }
}
console.log(out.join("\n"));
console.error(`${changed} files ${DRY ? "would change" : "changed"}; ${out.length} rows`);
