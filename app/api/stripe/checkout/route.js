import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { requireAuth } from "@/lib/api-helpers";
import { connectDB } from "@/models/db";
import User from "@/models/User";

/**
 * body: { priceId?: string, plan?: 'pro' | 'elite' }
 * Uses STRIPE_PRICE_PRO / STRIPE_PRICE_ELITE when plan is set.
 */
export async function POST(request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* empty */
  }

  const plan = body.plan === "elite" ? "elite" : "pro";
  const priceId =
    body.priceId ||
    (plan === "elite" ? process.env.STRIPE_PRICE_ELITE : process.env.STRIPE_PRICE_PRO);

  if (!priceId) {
    return NextResponse.json({ error: "Missing price ID env" }, { status: 500 });
  }

  await connectDB();
  const user = await User.findById(session.userId);
  let customerId = user?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: String(user._id) },
    });
    customerId = customer.id;
    user.stripeCustomerId = customerId;
    await user.save();
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/dashboard?checkout=success`,
    cancel_url: `${base}/dashboard?checkout=cancel`,
    client_reference_id: String(user._id),
    metadata: { userId: String(user._id), plan },
  });

  return NextResponse.json({ url: checkout.url });
}
