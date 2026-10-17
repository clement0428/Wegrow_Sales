import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PREFIXES = [
  "/login", "/api/auth", "/api/farm/availability", "/api/farm/bookings", "/api/farm/checkout",
  "/api/bookings", "/booking", "/my-bookings", "/visit-info", "/contact",
  // 免費參訪資格的nonce交換起點（2026-10-17）：客戶可能根本沒有farm-booking的
  // LINE session（一般訪客想查認養資格），這支路由本身不需要farm-booking端的
  // 登入——真正的身分核對在Orbit那端的真實帳密登入，不是這裡的tc_session cookie。
  "/api/farm/eligibility",
  "/_next", "/brand", "/favicon",
  // Server-to-server job endpoints authenticate themselves via their own
  // JOB_SECRET bearer-token check (timing-safe compare) — they must never
  // require a browser session cookie, since the caller is a cron trigger,
  // not a logged-in user. Without this, every call 307-redirected to
  // /login before the route's own auth ever ran.
  "/api/jobs",
  // Same reasoning, same bug shape as /api/jobs above (2026-10-16): LINE's
  // webhook caller has no browser session — it authenticates via
  // x-line-signature (HMAC against the channel secret), verified inside the
  // route itself. Caught this by actually curling the endpoint locally; it
  // was 307-redirecting to /login before ever reaching the signature check.
  "/api/line/webhook",
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
