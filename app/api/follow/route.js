import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import Follow from "@/models/Follow";
import User from "@/models/User";
import { followSchema } from "@/lib/validations/schemas";
import { requireAuth } from "@/lib/api-helpers";

export async function GET() {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();
  const rows = await Follow.find({ followerId: session.userId, active: true })
    .populate("traderId", "email stats")
    .lean();
  return NextResponse.json({ follows: rows });
}

export async function POST(request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = followSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.traderId === session.userId) {
    return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
  }

  await connectDB();
  const trader = await User.findById(parsed.data.traderId);
  if (!trader) {
    return NextResponse.json({ error: "Trader not found" }, { status: 404 });
  }

  const f = await Follow.findOneAndUpdate(
    { followerId: session.userId, traderId: parsed.data.traderId },
    { active: true, scalingMode: "proportional" },
    { upsert: true, new: true }
  );
  return NextResponse.json({ follow: f });
}

export async function DELETE(request) {
  const { session, error } = await requireAuth();
  if (error) return error;
  const traderId = request.nextUrl.searchParams.get("traderId");
  if (!traderId) {
    return NextResponse.json({ error: "traderId required" }, { status: 400 });
  }
  await connectDB();
  await Follow.findOneAndUpdate(
    { followerId: session.userId, traderId },
    { active: false }
  );
  return NextResponse.json({ ok: true });
}
