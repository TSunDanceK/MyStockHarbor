import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const host = request.headers.get("host") ?? "";

  const isLocalhost =
    host.includes("localhost") || host.startsWith("127.0.0.1");

  if (isLocalhost) {
    return NextResponse.next();
  }

  const pathname = url.pathname;
  const search = url.search;

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
