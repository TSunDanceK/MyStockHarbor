import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const host = request.headers.get("host") ?? "";

  const isLocalhost =
    host.includes("localhost") || host.startsWith("127.0.0.1");

  // Vercel preview deployments run on *.vercel.app hosts, not
  // www.mystockharbor.com. Without this check, the host-redirect rule
  // below would bounce every preview URL straight to production,
  // making PR previews unusable.
  const isVercelPreview = process.env.VERCEL_ENV === "preview";

  if (isLocalhost || isVercelPreview) {
    return NextResponse.next();
  }

  const pathname = url.pathname;
  const search = url.search;

  const oldStocksMatch = pathname.match(/^\/stocks\/([^/?#]+)\/?$/i);

  if (oldStocksMatch) {
    const cleanSymbol = oldStocksMatch[1]
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, "");

    if (cleanSymbol) {
      return NextResponse.redirect(
        `https://www.mystockharbor.com/stock/${encodeURIComponent(cleanSymbol)}${search}`,
        308
      );
    }
  }

  if (host !== "www.mystockharbor.com") {
    return NextResponse.redirect(
      `https://www.mystockharbor.com${pathname}${search}`,
      308
    );
  }

  if (request.headers.get("x-forwarded-proto") === "http") {
    return NextResponse.redirect(
      `https://www.mystockharbor.com${pathname}${search}`,
      308
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|robots.txt|sitemap.xml).*)",
  ],
};
