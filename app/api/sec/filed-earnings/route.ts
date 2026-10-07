// The filed-earnings list for client components (#552 COWORK #197): the symbols
// whose /stock/SYM/earnings may be linked. Served from the same cached index
// read as the server helper, and CDN-cached, so a client link costs no store
// command while warm. A failed read is a 503 with no-store, never an empty
// list cached as if nothing were filed.
import { NextResponse } from "next/server";
import { filedEarningsList } from "@/lib/server/filedEarnings";

export const revalidate = 21600;

export async function GET() {
  const symbols = await filedEarningsList();
  if (!symbols) {
    return NextResponse.json({ symbols: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    { symbols },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
