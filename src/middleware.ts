import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "mervo_session";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/pos",
  "/sales",
  "/products",
  "/inventory",
  "/customers",
  "/suppliers",
  "/finance",
  "/reports",
  "/employees",
  "/restaurant",
  "/ai",
  "/automation",
  "/settings",
  "/onboarding",
  "/admin",
];

/**
 * Edge guard: anything behind the app shell needs a session cookie before we
 * even render. Authorisation itself is always re-checked server-side against
 * the database — this only avoids rendering protected pages to anonymous users.
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const needsSession = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const response = NextResponse.next();

  response.headers.set("X-DNS-Prefetch-Control", "on");
  if (pathname.startsWith("/api/")) response.headers.set("Cache-Control", "no-store");

  if (needsSession && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)"],
};
