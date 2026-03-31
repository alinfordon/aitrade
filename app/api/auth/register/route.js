import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { hashPassword } from "@/lib/security/password";
import { signToken, COOKIE_NAME } from "@/lib/security/jwt";
import { registerSchema } from "@/lib/validations/schemas";
import { rateLimitOrThrow } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";

export async function POST(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const rl = await rateLimitOrThrow(ip, "register");
  if (rl) return rl;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const exists = await User.findOne({ email: parsed.data.email });
  if (exists) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await User.create({
    email: parsed.data.email,
    passwordHash,
    subscriptionPlan: "free",
    role: "user",
  });

  const token = await signToken({
    sub: String(user._id),
    email: user.email,
    role: user.role,
    subscriptionPlan: user.subscriptionPlan,
  });

  const res = NextResponse.json({
    user: {
      id: String(user._id),
      email: user.email,
      subscriptionPlan: user.subscriptionPlan,
      role: user.role,
    },
  });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
