import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import Strategy from "@/models/Strategy";
import Bot from "@/models/Bot";
import { createStrategySchema } from "@/lib/validations/schemas";
import { requireAuth } from "@/lib/api-helpers";

export async function GET(_, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();
  const s = await Strategy.findOne({ _id: params.id, userId: session.userId }).lean();
  if (!s) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ strategy: s });
}

export async function PATCH(request, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createStrategySchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const s = await Strategy.findOne({ _id: params.id, userId: session.userId });
  if (!s) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (parsed.data.name != null) s.name = parsed.data.name;
  if (parsed.data.definition != null) s.definition = parsed.data.definition;
  if (parsed.data.safeMode != null) s.safeMode = parsed.data.safeMode;
  await s.save();
  return NextResponse.json({ strategy: s });
}

export async function DELETE(_, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;
  await connectDB();
  const exists = await Strategy.exists({ _id: params.id, userId: session.userId });
  if (!exists) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const inUse = await Bot.exists({ userId: session.userId, strategyId: params.id });
  if (inUse) {
    return NextResponse.json(
      { error: "Strategia e folosită de cel puțin un bot. Oprește sau șterge botul mai întâi." },
      { status: 409 }
    );
  }
  await Strategy.deleteOne({ _id: params.id, userId: session.userId });
  return NextResponse.json({ ok: true });
}
