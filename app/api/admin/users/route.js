import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAdmin } from "@/lib/api-helpers";

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const search = (searchParams.get("search") || "").trim();
  const planFilter = searchParams.get("plan") || "all";
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 25)));
  const skip = (page - 1) * limit;

  await connectDB();
  const now = new Date();

  const match = {};
  if (planFilter !== "all" && ["free", "pro", "elite"].includes(planFilter)) {
    match.subscriptionPlan = planFilter;
  }
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    match.$or = [{ email: rx }, { displayName: rx }];
  }

  const [
    totalCount,
    free,
    pro,
    elite,
    usersRaw,
    expiredPaidAgg,
  ] = await Promise.all([
    User.countDocuments(match),
    User.countDocuments({ subscriptionPlan: "free" }),
    User.countDocuments({ subscriptionPlan: "pro" }),
    User.countDocuments({ subscriptionPlan: "elite" }),
    User.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "email displayName subscriptionPlan role planExpiresAt createdAt stripeSubscriptionId"
      )
      .lean(),
    User.countDocuments({
      subscriptionPlan: { $in: ["pro", "elite"] },
      planExpiresAt: { $lt: now },
    }),
  ]);

  const users = (usersRaw || []).map((u) => ({
    id: String(u._id),
    email: u.email,
    displayName: u.displayName || "",
    subscriptionPlan: u.subscriptionPlan,
    role: u.role,
    planExpiresAt: u.planExpiresAt ? u.planExpiresAt.toISOString() : null,
    createdAt: u.createdAt,
    hasStripeSubscription: Boolean(u.stripeSubscriptionId),
  }));

  return NextResponse.json({
    summary: {
      total: await User.countDocuments(),
      free,
      pro,
      elite,
      expiredPaid: expiredPaidAgg,
    },
    users,
    page,
    limit,
    totalCount,
  });
}
