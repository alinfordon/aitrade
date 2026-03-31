import { NextResponse } from "next/server";
import {
  fetchBinanceUsdcGainers,
  fetchCoinGeckoTrending,
  enrichTrendingWithBinanceSpotUsdc,
  discoverDisclaimer,
} from "@/lib/market/discover-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const disclaimer = discoverDisclaimer();
  const out = {
    gainers: [],
    trending: [],
    errors: [],
    disclaimer,
  };

  try {
    out.gainers = await fetchBinanceUsdcGainers();
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e));
  }

  try {
    const rawTrending = await fetchCoinGeckoTrending();
    try {
      out.trending = await enrichTrendingWithBinanceSpotUsdc(rawTrending);
    } catch (e) {
      out.trending = rawTrending;
      out.errors.push(
        `Perechi spot trending: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json(out, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
    },
  });
}
