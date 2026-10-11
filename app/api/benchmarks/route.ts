// app/api/benchmarks/route.ts
//
// Core data-building logic lives in lib/server/benchmarksBuilder.ts
// (shared with app/dashboard/page.tsx's in-process SSR read via
// getBenchmarksData(), see that module's header comment). This route
// stays the public HTTP entry point: it still runs the isUnwantedBot()
// guard before returning any data.
import { NextResponse } from "next/server";
import { isUnwantedBot } from "@/lib/botid-guard";
import { getBenchmarksData, type BenchPayload } from "@/lib/server/benchmarksBuilder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { BenchPayload };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");

  if (await isUnwantedBot()) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const { data, headers, status } = await getBenchmarksData(scope);

  return NextResponse.json(data, { status: status ?? 200, headers });
}
