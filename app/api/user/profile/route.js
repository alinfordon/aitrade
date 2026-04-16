import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";

const patchSchema = z.object({
  displayName: z.string().max(160).optional(),
  email: z.string().email().optional(),
});

export async function PATCH(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  await connectDB();
  const user = await User.findById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (patch.displayName !== undefined) {
    user.displayName = String(patch.displayName || "").trim();
  }
  if (patch.email !== undefined) {
    const nextEmail = String(patch.email).trim().toLowerCase();
    if (!nextEmail) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }
    if (nextEmail !== user.email) {
      const exists = await User.findOne({ email: nextEmail }).select("_id").lean();
      if (exists) {
        return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      }
    }
    user.email = nextEmail;
  }

  await user.save();

  return NextResponse.json({
    user: {
      id: String(user._id),
      email: user.email,
      displayName: user.displayName || "",
    },
  });
}

