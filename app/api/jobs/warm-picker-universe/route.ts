import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const auth = req.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

function getOrigin(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    "www.mystockharbor.com";

  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = getOrigin(req);

  const res = await fetch(`${origin}/api/market`, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "x-msh-warm-job": "picker-universe",
    },
  });

  const payload = await res.json().catch(() => null);

  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    job: "warm-picker-universe",
    dynamicUniverseSize:
      payload && typeof payload.dynamicUniverseSize === "number"
        ? payload.dynamicUniverseSize
        : null,
    discovery: payload?.discovery ?? null,
    updatedAt: payload?.updatedAt ?? new Date().toISOString(),
  });
}
