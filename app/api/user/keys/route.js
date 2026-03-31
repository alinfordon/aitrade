import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { encryptSecret } from "@/lib/security/crypto";
import { userKeysSchema } from "@/lib/validations/schemas";
import { requireAuth } from "@/lib/api-helpers";

export async function POST(request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = userKeysSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const encK = encryptSecret(parsed.data.apiKey);
    const encS = encryptSecret(parsed.data.apiSecret);
    await connectDB();
    await User.findByIdAndUpdate(session.userId, {
      apiKeyEncrypted: encK,
      apiSecretEncrypted: encS,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Encryption failed" }, { status: 500 });
  }
}
