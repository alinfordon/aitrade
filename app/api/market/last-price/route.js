import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { getPrice } from "@/lib/binance/service";

export const dynamic = "force-dynamic";

/** Preț curent pentru o pereche (auth). Folosit de /live pentru SL/TP când WebSocket-ul lipsește. */
export async function GET(request) {
  const { session, error } = await requireAuth();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("symbol") || "").trim().replace(/-/g, "/");
  if (!raw) {
    return NextResponse.json({ error: "Parametrul symbol e obligatoriu." }, { status: 400 });
  }

  try {
    const price = await getPrice(raw, { futures: searchParams.get("futures") === "1" });
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json({ error: "Preț invalid." }, { status: 502 });
    }
    return NextResponse.json({ symbol: raw, price });
  } catch (e) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 502 }
    );
  }
}
