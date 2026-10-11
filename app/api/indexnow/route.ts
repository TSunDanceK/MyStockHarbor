import { NextRequest, NextResponse } from "next/server";
import { submitUrlsToIndexNow } from "../../../lib/indexnow";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const urls = Array.isArray(body?.urls) ? body.urls : [];

    const result = await submitUrlsToIndexNow(urls);

    return NextResponse.json(result, {
      status: result.status || 200,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown IndexNow error";

    return NextResponse.json(
      {
        ok: false,
        status: 500,
        message,
      },
      { status: 500 }
    );
  }
}
