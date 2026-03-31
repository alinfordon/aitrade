import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { rateLimit } from "@/lib/redis/rate-limit";
import { fetchBinanceUsdcGainers, fetchCoinGeckoTrending } from "@/lib/market/discover-data";
import { runMarketAiAnalysis } from "@/lib/ai/market-analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const { session, error } = await requireAuth();
  if (error) return error;

  const rl = await rateLimit(`gemini-market:${session.userId}`, 8, 3600);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Limită analize AI atinsă pentru această oră. Încearcă din nou mai târziu.",
        retryAfterSec: rl.retryAfterSec,
      },
      { status: 429 }
    );
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "AI neconfigurat: setează GEMINI_API_KEY în .env.local." },
      { status: 503 }
    );
  }

  let gainers = [];
  let trending = [];
  try {
    [gainers, trending] = await Promise.all([
      fetchBinanceUsdcGainers({ limit: 20, minQuoteVolume: 80_000 }),
      fetchCoinGeckoTrending().then((t) => t.slice(0, 12)),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Nu s-au putut încărca datele de piață." },
      { status: 502 }
    );
  }

  try {
    const analysis = await runMarketAiAnalysis({ gainers, trending });
    return NextResponse.json({
      analysis,
      meta: {
        generatedAt: new Date().toISOString(),
        gainersCount: gainers.length,
        trendingCount: trending.length,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
