import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { decryptSecret } from "@/lib/security/crypto";
import { requireAuth, rateLimitOrThrow } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { mapBinanceUserMessageAsync } from "@/lib/binance/map-exchange-error";
import { runConvertDustToUsdc } from "@/server/wallet/convert-dust-usdc";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const tooMany = await rateLimitOrThrow(ip, "convert-dust");
  if (tooMany) return tooMany;

  const { session, error } = await requireAuth();
  if (error) return error;

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const maxUsdRaw = body?.maxUsd;
  const maxUsd = Math.min(100, Math.max(0.1, Number(maxUsdRaw) || 1));
  const skipBnb = body?.includeBnb !== true;
  const currencyRaw = body?.currency;
  const currency =
    typeof currencyRaw === "string" && currencyRaw.trim()
      ? String(currencyRaw)
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 32)
      : "";

  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.apiKeyEncrypted || !user.apiSecretEncrypted) {
    return NextResponse.json({ error: "Chei API lipsă. Configurează Binance în Settings." }, { status: 400 });
  }

  let apiKey = "";
  let secret = "";
  try {
    apiKey = decryptSecret(user.apiKeyEncrypted);
    secret = decryptSecret(user.apiSecretEncrypted);
  } catch {
    return NextResponse.json(
      { error: "Nu pot descifra cheile API. Resalvează din Settings." },
      { status: 500 }
    );
  }
  if (!apiKey || !secret) {
    return NextResponse.json({ error: "Cheie sau secret gol după descifrare." }, { status: 400 });
  }

  try {
    const out = await runConvertDustToUsdc({
      apiKey,
      secret,
      maxUsd,
      skipBnb,
      ...(currency ? { currency } : {}),
    });
    if (!out.ok && out.error === "not_eligible") {
      return NextResponse.json(
        { ok: false, error: typeof out.message === "string" ? out.message : "Moneda nu e eligibilă pentru conversie." },
        { status: 400 }
      );
    }
    if (!out.ok && out.error === "no_api_keys") {
      return NextResponse.json({ ok: false, error: "Chei API lipsă." }, { status: 400 });
    }
    return NextResponse.json(out);
  } catch (e) {
    const msg = await mapBinanceUserMessageAsync(e);
    return NextResponse.json({ error: msg, ok: false }, { status: 502 });
  }
}
