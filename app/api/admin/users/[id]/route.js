import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAdmin } from "@/lib/api-helpers";

const patchSchema = z.object({
  displayName: z.string().max(160).optional(),
  subscriptionPlan: z.enum(["free", "pro", "elite"]).optional(),
  role: z.enum(["user", "admin"]).optional(),
  /** ISO date string (yyyy-mm-dd) sau null / "" pentru a șterge */
  planExpiresAt: z.union([z.string(), z.null()]).optional(),
});

export async function PATCH(request, { params }) {
  const { error } = await requireAdmin();
  if (error) return error;

  const id = params?.id;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

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
  const user = await User.findById(id);
  if (!user) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (patch.displayName !== undefined) {
    user.displayName = patch.displayName.trim();
  }
  if (patch.subscriptionPlan !== undefined) {
    user.subscriptionPlan = patch.subscriptionPlan;
    if (patch.subscriptionPlan === "free") {
      user.planExpiresAt = null;
    }
  }
  if (patch.role !== undefined) {
    user.role = patch.role;
  }
  if (patch.planExpiresAt !== undefined) {
    if (patch.planExpiresAt === null || patch.planExpiresAt === "") {
      user.planExpiresAt = null;
    } else {
      const d = new Date(patch.planExpiresAt);
      if (!Number.isFinite(d.getTime())) {
        return NextResponse.json({ error: "planExpiresAt invalid" }, { status: 400 });
      }
      user.planExpiresAt = d;
    }
  }

  await user.save();

  return NextResponse.json({
    user: {
      id: String(user._id),
      email: user.email,
      displayName: user.displayName || "",
      subscriptionPlan: user.subscriptionPlan,
      role: user.role,
      planExpiresAt: user.planExpiresAt ? user.planExpiresAt.toISOString() : null,
    },
  });
}
