import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe, planFromPriceId } from "@/lib/stripe";
/* planFromPriceId used for subscription item updates */
import { connectDB } from "@/models/db";
import User from "@/models/User";

export const runtime = "nodejs";

export async function POST(request) {
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !whSecret) {
    return NextResponse.json({ error: "Not configured" }, { status: 501 });
  }

  const rawBody = await request.text();
  const hdrs = headers();
  const sig = hdrs.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, whSecret);
  } catch (e) {
    return NextResponse.json({ error: `Webhook: ${e.message}` }, { status: 400 });
  }

  await connectDB();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.userId;
    const subId = session.subscription;
    if (userId) {
      const planMeta = session.metadata?.plan === "elite" ? "elite" : "pro";
      await User.findByIdAndUpdate(userId, {
        subscriptionPlan: planMeta,
        stripeSubscriptionId: subId || "",
      });
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const customerId = sub.customer;
    const user = await User.findOne({ stripeCustomerId: customerId });
    if (user) {
      if (sub.status === "active" && sub.items?.data?.[0]?.price?.id) {
        const priceId = sub.items.data[0].price.id;
        user.subscriptionPlan = planFromPriceId(priceId);
        user.stripeSubscriptionId = sub.id;
      } else {
        user.subscriptionPlan = "free";
        user.stripeSubscriptionId = "";
      }
      await user.save();
    }
  }

  return NextResponse.json({ received: true });
}
