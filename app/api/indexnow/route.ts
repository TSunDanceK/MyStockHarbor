import { NextRequest, NextResponse } from "next/server";
import { submitUrlsToIndexNow } from "../../../lib/indexnow";

export async function GET() {
  const testUrls = [
    "https://www.mystockharbor.com/insights",
    "https://www.mystockharbor.com/pickers",
   "https://www.mystockharbor.com/news",
  ];

  const result = await submitUrlsToIndexNow(testUrls);

  return NextResponse.json(result, {
    status: result.status || 200,
  });
}
