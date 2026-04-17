import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import { requireAuth } from "@/lib/api-helpers";
import { respondIfMongoMissing } from "@/lib/mongo-env";
import { portfolioUpdateSchema } from "@/lib/validations/schemas";
import { decryptSecret } from "@/lib/security/crypto";
import { getBalance } from "@/lib/binance/service";
import { DEFAULT_QUOTE_ASSET } from "@/lib/market-defaults";
import { computePortfolioSnapshot } from "@/lib/portfolio/snapshot";

export const dynamic = "force-dynamic";

function formatRealBalances(balanceResponse) {
  const free = balanceResponse?.free || {};
  const used = balanceResponse?.used || {};
  const total = balanceResponse?.total || {};
  const keys = new Set([
    ...Object.keys(free),
    ...Object.keys(used),
    ...Object.keys(total),
  ]);
  const rows = [];
  for (const currency of keys) {
    const f = Number(free[currency] ?? 0);
    const u = Number(used[currency] ?? 0);
    const t = Number(total[currency] ?? f + u);
    if (t > 1e-12 || f > 1e-12 || u > 1e-12) {
      rows.push({ currency, free: f, used: u, total: t });
    }
  }
  return rows;
}

/**
 * @param {Record<string, unknown> | null | undefined} user
 * @returns {Promise<{ balances: { currency: string, free: number, used: number, total: number }[], connected: boolean, error: string | null }>}
 */
async function fetchRealSpotBalances(user) {
  const hasKeys = Boolean(user?.apiKeyEncrypted && user?.apiSecretEncrypted);
  if (!hasKeys) return { balances: [], connected: false, error: null };
  let apiKey = "";
  let secret = "";
  try {
    apiKey = decryptSecret(user.apiKeyEncrypted);
    secret = decryptSecret(user.apiSecretEncrypted);
  } catch {
    return { balances: [], connected: false, error: "Chei Binance ilizibile" };
  }
  if (!apiKey || !secret) {
    return { balances: [], connected: false, error: "Chei Binance goale" };
  }
  try {
    const raw = await getBalance(apiKey, secret, { futures: false });
    return { balances: formatRealBalances(raw), connected: true, error: null };
  } catch (e) {
    return {
      balances: [],
      connected: false,
      error: e instanceof Error ? e.message : "Binance balance error",
    };
  }
}

function serializePortfolio(user) {
  const p = user?.portfolio && typeof user.portfolio === "object" ? user.portfolio : {};
  return {
    quoteAsset: String(p.quoteAsset || DEFAULT_QUOTE_ASSET),
    tolerancePct: Number(p.tolerancePct ?? 5),
    dustThresholdUsd: Number(p.dustThresholdUsd ?? 1),
    includeRealSpot: p.includeRealSpot !== false,
    includeManual: p.includeManual !== false,
    targets: Array.isArray(p.targets)
      ? p.targets.map((t) => ({
          symbol: String(t?.symbol || "").toUpperCase(),
          targetPct: Number(t?.targetPct ?? 0),
          note: String(t?.note || ""),
        }))
      : [],
    manualHoldings: Array.isArray(p.manualHoldings)
      ? p.manualHoldings.map((h) => ({
          symbol: String(h?.symbol || "").toUpperCase(),
          quantity: Number(h?.quantity ?? 0),
          avgCost: Number(h?.avgCost ?? 0),
          note: String(h?.note || ""),
        }))
      : [],
    updatedAt: p.updatedAt ?? null,
  };
}

export async function GET() {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  await connectDB();
  const user = await User.findById(session.userId).lean();
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const portfolio = serializePortfolio(user);
  const real = await fetchRealSpotBalances(user);
  const snapshot = await computePortfolioSnapshot({
    realBalances: real.balances,
    portfolio,
  });

  return NextResponse.json({
    portfolio,
    snapshot,
    real: { connected: real.connected, error: real.error },
  });
}

export async function PUT(request) {
  const missing = respondIfMongoMissing();
  if (missing) return missing;

  const { session, error } = await requireAuth();
  if (error) return error;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalid" }, { status: 400 });
  }

  const parsed = portfolioUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(" · ") },
      { status: 400 }
    );
  }
  const patch = parsed.data;

  /** Dedupe targets pe simbol (însumat) și normalizare manual holdings. */
  const $set = { "portfolio.updatedAt": new Date() };
  if (patch.tolerancePct != null) $set["portfolio.tolerancePct"] = patch.tolerancePct;
  if (patch.dustThresholdUsd != null) $set["portfolio.dustThresholdUsd"] = patch.dustThresholdUsd;
  if (patch.includeRealSpot != null) $set["portfolio.includeRealSpot"] = patch.includeRealSpot;
  if (patch.includeManual != null) $set["portfolio.includeManual"] = patch.includeManual;

  if (Array.isArray(patch.targets)) {
    const map = new Map();
    for (const t of patch.targets) {
      if (!t.symbol) continue;
      const prev = map.get(t.symbol);
      map.set(t.symbol, {
        symbol: t.symbol,
        targetPct: Number(((prev?.targetPct ?? 0) + t.targetPct).toFixed(4)),
        note: t.note || prev?.note || "",
      });
    }
    const totalPct = [...map.values()].reduce((s, t) => s + t.targetPct, 0);
    if (totalPct > 100 + 0.5) {
      return NextResponse.json(
        { error: `Suma țintelor ${totalPct.toFixed(2)}% depășește 100%.` },
        { status: 400 }
      );
    }
    $set["portfolio.targets"] = [...map.values()];
  }

  if (Array.isArray(patch.manualHoldings)) {
    /** Agregare pe simbol: dacă userul adaugă de două ori BTC, însumăm și recalculăm costul mediu ponderat. */
    const map = new Map();
    for (const h of patch.manualHoldings) {
      if (!h.symbol || !(h.quantity > 0)) continue;
      const prev = map.get(h.symbol);
      const newQty = (prev?.quantity ?? 0) + h.quantity;
      const prevCostTotal = (prev?.avgCost ?? 0) * (prev?.quantity ?? 0);
      const addCostTotal = (h.avgCost ?? 0) * h.quantity;
      const avg = newQty > 0 ? (prevCostTotal + addCostTotal) / newQty : 0;
      map.set(h.symbol, {
        symbol: h.symbol,
        quantity: Number(newQty.toFixed(10)),
        avgCost: Number(avg.toFixed(8)),
        note: h.note || prev?.note || "",
      });
    }
    $set["portfolio.manualHoldings"] = [...map.values()];
  }

  await connectDB();
  const user = await User.findByIdAndUpdate(
    session.userId,
    { $set },
    { new: true }
  ).lean();
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const portfolio = serializePortfolio(user);
  const real = await fetchRealSpotBalances(user);
  const snapshot = await computePortfolioSnapshot({
    realBalances: real.balances,
    portfolio,
  });

  return NextResponse.json({
    ok: true,
    portfolio,
    snapshot,
    real: { connected: real.connected, error: real.error },
  });
}
