import { NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/security/jwt";

const protectedPrefixes = [
  "/dashboard",
  "/trading",
  "/discover",
  "/bots",
  "/strategies",
  "/trades",
  "/leaderboard",
  "/settings",
];

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminPath) {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    const decoded = await verifyToken(token);
    if (!decoded?.sub) {
      const res = NextResponse.redirect(new URL("/login", request.url));
      res.cookies.delete(COOKIE_NAME);
      return res;
    }
    if (decoded.role !== "admin") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  const needsAuth = protectedPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!needsAuth) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const decoded = await verifyToken(token);
  if (!decoded?.sub) {
    const res = NextResponse.redirect(new URL("/login", request.url));
    res.cookies.delete(COOKIE_NAME);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/dashboard/:path*",
    "/trading",
    "/trading/:path*",
    "/discover",
    "/discover/:path*",
    "/bots/:path*",
    "/strategies/:path*",
    "/trades/:path*",
    "/leaderboard",
    "/leaderboard/:path*",
    "/settings/:path*",
  ],
};
