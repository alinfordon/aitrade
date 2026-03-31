import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { rateLimit } from "@/lib/redis/rate-limit";

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, error: null };
}

/** Verifică `User.role` în DB (nu doar JWT). */
export async function requireAdmin() {
  const { session, error } = await requireAuth();
  if (error) return { session: null, error };
  try {
    await connectDB();
    const user = await User.findById(session.userId).select("role").lean();
    if (!user || user.role !== "admin") {
      return { session: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
  } catch {
    return { session: null, error: NextResponse.json({ error: "Server error" }, { status: 500 }) };
  }
  return { session, error: null };
}

export async function rateLimitOrThrow(ip, prefix = "api") {
  const rl = await rateLimit(`${prefix}:${ip}`, 120, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests", retryAfterSec: rl.retryAfterSec },
      { status: 429 }
    );
  }
  return null;
}

export function verifyCron(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (auth?.startsWith("Bearer ") && auth.slice(7).trim() === secret) return true;

  // EasyCron: unii pun greșit Cheie = CRON_SECRET; în antet HTTP devine de obicei cron_secret (fără „Bearer”)
  const rawHeaderSecret =
    request.headers.get("x-cron-secret") ||
    request.headers.get("cron-secret") ||
    request.headers.get("cron_secret");
  if (rawHeaderSecret === secret) return true;

  return false;
}
