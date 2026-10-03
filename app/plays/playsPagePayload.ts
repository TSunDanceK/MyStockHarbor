"use server";

// THE PLAYS PAGES' OWN IN-PROCESS READ (#553 COWORK #103, 2026-10-03).
//
// The public routes (/api/plays, /api/bull-flags, /api/descending-triangles)
// no longer carry Tiingo chart bars (lib/playsPublic.ts). When a page's client
// refresh finds a NEWER scan than the one its server props rendered, it reads
// that scan here: a server action, so a POST tied to the page -- never a
// CDN-cached public JSON endpoint -- returning the same payload the page's
// server render reads, bars included.
//
// `cacheOnly: true`, as the pages use: memo then Redis, NEVER a build. The
// route the client has just called is what builds a cold cache (BotID-guarded
// there); this only reads what that left behind.
import { getPlaysData, type PlaysPayload as AscendingPayload } from "@/lib/server/playsBuilder";
import { getBullFlagsData, type PlaysPayload as BullFlagsPayload } from "@/lib/server/bullFlagsBuilder";
import {
  getDescendingTrianglesData,
  type PlaysPayload as DescendingPayload,
} from "@/lib/server/descendingTrianglesBuilder";

// Vestigial for the builders (see app/plays/page.tsx); the same constant.
const SITE_ORIGIN = "https://www.mystockharbor.com";

type Read<T> = { data: T; status?: number };

function usable<T>(r: Read<T>): T | null {
  if (r.status && r.status >= 400) return null;
  if ((r.data as { error?: unknown } | null)?.error) return null;
  return r.data ?? null;
}

export async function readPlaysPagePayload(): Promise<AscendingPayload | null> {
  try {
    return usable(await getPlaysData(SITE_ORIGIN, { cacheOnly: true }));
  } catch {
    return null;
  }
}

export async function readBullFlagsPagePayload(): Promise<BullFlagsPayload | null> {
  try {
    return usable(await getBullFlagsData(SITE_ORIGIN, { cacheOnly: true }));
  } catch {
    return null;
  }
}

export async function readDescendingTrianglesPagePayload(): Promise<DescendingPayload | null> {
  try {
    return usable(await getDescendingTrianglesData(SITE_ORIGIN, { cacheOnly: true }));
  } catch {
    return null;
  }
}
