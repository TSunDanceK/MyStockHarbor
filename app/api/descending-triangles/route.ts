// app/api/descending-triangles/route.ts
//
// Core scan/build logic lives in lib/server/descendingTrianglesBuilder.ts
// (shared with app/plays/descending-triangles/page.tsx's in-process SSR
// read via getDescendingTrianglesData(), see that module's header
// comment). This route stays the public HTTP entry point: it still runs
// the isUnwantedBot() guard before returning any data.
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import { getDescendingTrianglesData } from "../../../lib/server/descendingTrianglesBuilder";

function originFromReq(req: NextRequest) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const origin = originFromReq(req);
  const forceRefresh = req.nextUrl.searchParams.get("force") === "1";
  const debugSymbol = req.nextUrl.searchParams.get("debugSymbol");

  const { data, headers, status } = await getDescendingTrianglesData(origin, {
    forceRefresh,
    debugSymbol,
  });

  return NextResponse.json(data, { status: status ?? 200, headers });
}
