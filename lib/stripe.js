import Stripe from "stripe";

let stripe;

export function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return null;
  }
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

export function planFromPriceId(priceId) {
  const pro = process.env.STRIPE_PRICE_PRO;
  const elite = process.env.STRIPE_PRICE_ELITE;
  if (priceId === elite) return "elite";
  if (priceId === pro) return "pro";
  return "free";
}
