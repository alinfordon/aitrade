import { cookies } from "next/headers";
import { COOKIE_NAME, verifyToken } from "@/lib/security/jwt";
import { connectDB } from "@/models/db";
import User from "@/models/User";

/**
 * Planul din cookie (JWT) poate fi în urmă după Stripe; citim mereu `User.subscriptionPlan` din Mongo.
 */
export async function getSession() {
  const jar = cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const decoded = await verifyToken(raw);
  if (!decoded || !decoded.sub) return null;

  let subscriptionPlan = decoded.subscriptionPlan || "free";
  try {
    await connectDB();
    const u = await User.findById(decoded.sub).select("subscriptionPlan").lean();
    if (u?.subscriptionPlan) {
      subscriptionPlan = u.subscriptionPlan;
    }
  } catch {
    /* Mongo indisponibil: folosim valoarea din token */
  }

  return {
    userId: String(decoded.sub),
    email: decoded.email,
    role: decoded.role || "user",
    subscriptionPlan,
  };
}
