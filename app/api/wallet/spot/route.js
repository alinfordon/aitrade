import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { decryptSecret } from "@/lib/security/crypto";
import { getBalance } from "@/lib/binance/service";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import Bot from "@/models/Bot";
import { buildSuggestedPairs, paperBalancesList } from "@/lib/wallet/suggest-pairs";
import { attachUsdTotalsToBalances, paperUsdcOverview, realUsdcOverview } from "@/lib/wallet/usdc-overview";
import { formatSpotBalanceRows } from "@/lib/wallet/dust-usdc";
import { DEFAULT_QUOTE_ASSET, getManualPaperQuoteBalance } from "@/lib/market-defaults";
import { mapBinanceUserMessageAsync } from "@/lib/binance/map-exchange-error";

export const dynamic = "force-dynamic";

export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const paperQuote = getManualPaperQuoteBalance(user);
  const book = user.manualSpotBook && typeof user.manualSpotBook === "object" ? user.manualSpotBook : {};
  const paperBalances = paperBalancesList(paperQuote, book, DEFAULT_QUOTE_ASSET);

  const hasKeys = Boolean(user.apiKeyEncrypted && user.apiSecretEncrypted);
  let real = { connected: false, balances: [], error: null };

  if (hasKeys) {
    let apiKey = "";
    let secret = "";
    try {
      apiKey = decryptSecret(user.apiKeyEncrypted);
      secret = decryptSecret(user.apiSecretEncrypted);
    } catch {
      real = {
        connected: false,
        balances: [],
        error:
          "Cheile nu pot fi descifrate. Folosește Settings → salvează API Key și Secret din formular (criptare automată). Fișierele din MongoDB trebuie să fie exact payload-ul produs de app, nu string-ul vizibil din Binance.",
      };
    }

    if (!real.error) {
      if (!apiKey || !secret) {
        real = {
          connected: false,
          balances: [],
          error:
            "După descifrare, cheia sau secretul sunt goale. Verifică ENCRYPTION_KEY (64 caractere hex) în .env.local și salvează din nou cheile din Settings.",
        };
      } else {
        try {
          const raw = await getBalance(apiKey, secret, { futures: false });
          const rows = formatSpotBalanceRows(raw);
          real = {
            connected: true,
            balances: await attachUsdTotalsToBalances(rows),
            error: null,
          };
        } catch (e) {
          real = {
            connected: false,
            balances: [],
            error: await mapBinanceUserMessageAsync(e),
          };
        }
      }
    }
  }

  const suggestedPairs = buildSuggestedPairs(real.balances);

  const userBots = await Bot.find({ userId: session.userId })
    .select("mode paperState")
    .lean();
  const overviewPaper = paperUsdcOverview(paperQuote, book, userBots);
  let overviewReal = null;
  if (real.connected && Array.isArray(real.balances)) {
    try {
      const base = await realUsdcOverview(real.balances);
      const totalUsdEstimate = Number(
        real.balances.reduce((s, r) => s + (Number(r.usdTotal) || 0), 0).toFixed(2)
      );
      overviewReal = { ...base, totalUsdEstimate };
    } catch {
      overviewReal = {
        usdcFree: 0,
        inAssetsUsdcEstimate: 0,
        totalUsdEstimate: null,
        error: "estimate_failed",
      };
    }
  }

  return NextResponse.json({
    hasApiKeys: hasKeys,
    paper: {
      quoteAsset: DEFAULT_QUOTE_ASSET,
      quoteBalance: paperQuote,
      positions: book,
      balances: paperBalances,
    },
    real,
    suggestedPairs,
    overview: {
      paper: overviewPaper,
      real: overviewReal,
    },
  });
}
