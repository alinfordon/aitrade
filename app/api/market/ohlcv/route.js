import { NextResponse } from "next/server";
import { fetchOHLCV, httpStatusForOhlcvError } from "@/lib/binance/service";
import { rateLimitOrThrow } from "@/lib/api-helpers";
import { DEFAULT_SPOT_PAIR } from "@/lib/market-defaults";

export const dynamic = "force-dynamic";

/** Public candles for chart (lightweight). Rate-limited by IP. */
export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  const rl = await rateLimitOrThrow(ip, "ohlcv");
  if (rl) return rl;

  const { searchParams } = new URL(request.url);
  const requested = (searchParams.get("symbol") || DEFAULT_SPOT_PAIR).replace(/-/g, "/");
  const timeframe = searchParams.get("timeframe") || "1h";
  const limit = Math.min(Number(searchParams.get("limit") || 500), 1000);
  const spotOnly =
    searchParams.get("spotOnly") === "1" || searchParams.get("spotOnly") === "true";

  try {
    const { rows, resolvedSymbol, dataSource } = await fetchOHLCV(requested, timeframe, limit, {
      returnResolvedSymbol: true,
      /** Din discover: doar spot USDC; altfel poate cădea pe perpetual USDT-M dacă nu există spot. */
      allowLinearPerpFallback: !spotOnly,
    });
    const candles = rows.map((r) => ({
      time: Math.floor(r[0] / 1000),
      open: r[1],
      high: r[2],
      low: r[3],
      close: r[4],
      volume: r[5],
    }));
    const payload = { symbol: resolvedSymbol, timeframe, candles };
    if (dataSource && dataSource !== "spot") {
      payload.dataSource = dataSource;
    }
    if (resolvedSymbol !== requested) {
      payload.requestedSymbol = requested;
    }
    return NextResponse.json(payload);
  } catch (e) {
    const status = httpStatusForOhlcvError(e);
    return NextResponse.json(
      { error: String(e?.message || e), requestedSymbol: requested },
      { status }
    );
  }
}
