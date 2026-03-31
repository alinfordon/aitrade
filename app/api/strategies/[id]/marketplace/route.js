import { NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/models/db";
import Strategy from "@/models/Strategy";
import { requireAuth } from "@/lib/api-helpers";
import { canListOnMarketplace } from "@/lib/plans";

const bodySchema = z.object({
  listed: z.boolean(),
  priceUsd: z.number().min(0).optional(),
  description: z.string().max(2000).optional(),
});

/**
 * Marketplace structure (listing metadata on a strategy document).
 */
export async function PATCH(request, { params }) {
  const { session, error } = await requireAuth();
  if (error) return error;

  if (!canListOnMarketplace(session.subscriptionPlan) && session.role !== "admin") {
    return NextResponse.json({ error: "Plan does not allow marketplace listing" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await connectDB();
  const s = await Strategy.findOne({ _id: params.id, userId: session.userId });
  if (!s) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  s.marketplace = s.marketplace || {};
  s.marketplace.listed = parsed.data.listed;
  if (parsed.data.priceUsd != null) s.marketplace.priceUsd = parsed.data.priceUsd;
  if (parsed.data.description != null) s.marketplace.description = parsed.data.description;
  if (parsed.data.listed) {
    s.source = "marketplace";
  }
  await s.save();
  return NextResponse.json({ strategy: s });
}
