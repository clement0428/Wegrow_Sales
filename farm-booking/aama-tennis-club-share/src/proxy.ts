import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login", "/api/auth", "/api/farm/availability", "/api/farm/bookings", "/api/farm/checkout",
  "/api/bookings", "/booking", "/my-bookings", "/visit-info", "/contact",
  "/_next", "/brand", "/favicon",
  // Server-to-server job endpoints authenticate themselves via their own
  // JOB_SECRET bearer-token check (timing-safe compare) — they must never
  // require a browser session cookie, since the caller is a cron trigger,
  // not a logged-in user. Without this, every call 307-redirected to
  // /login before the route's own auth ever ran.
  "/api/jobs",
];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/" || PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.next();
  }
  if (process.env.DEV_FAKE_LOGIN === "1" && pathname === "/admin") {
    return NextResponse.next();
  }
  const hasSession = req.cookies.get("tc_session")?.value;
  if (hasSession) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("returnTo", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand).*)"],
};
