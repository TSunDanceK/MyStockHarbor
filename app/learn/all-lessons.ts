// app/learn/all-lessons.ts
// Single merged view of every lesson: the shared course in lessons.ts plus the
// "How to Read Financial Data" (Fundamentals) module. Navigation and grouping
// read from here so the Fundamentals lessons chain on straight after the last
// Divergences lesson (MACD Divergence) without editing lessons.ts.

import { LESSONS, type Lesson } from "./lessons";
import { FUNDAMENTALS_LESSONS } from "./fundamentals-lessons";

export const ALL_LESSONS: Lesson[] = [...LESSONS, ...FUNDAMENTALS_LESSONS];

export function getLesson(slug: string) {
  const s = String(slug || "")
    .trim()
    .toLowerCase();

  return ALL_LESSONS.find((l) => l.slug.toLowerCase() === s) ?? null;
}

export function getNextLesson(slug: string) {
  const idx = ALL_LESSONS.findIndex(
    (l) => l.slug.toLowerCase() === String(slug || "").trim().toLowerCase()
  );
  if (idx === -1) return null;
  return ALL_LESSONS[idx + 1] ?? null;
}

export function lessonsByCategory(cat: string) {
  return ALL_LESSONS.filter((l) => (l.category as string) === cat);
}
