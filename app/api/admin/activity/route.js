import { NextResponse } from "next/server";
import { connectDB } from "@/models/db";
import User from "@/models/User";
import Trade from "@/models/Trade";
import Bot from "@/models/Bot";
import Strategy from "@/models/Strategy";
import Follow from "@/models/Follow";
import CronRunLog from "@/models/CronRunLog";
import { requireAdmin } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

async function emailByIds(ids) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniq.length) return new Map();
  const users = await User.find({ _id: { $in: uniq } })
    .select("email")
    .lean();
  return new Map(users.map((u) => [String(u._id), u.email]));
}

/**
 * Flux unificat: înregistrări, tranzacții, boți noi, strategii, copy-follow, cron HTTP.
 */
export async function GET(request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 80), 10), 200);

  await connectDB();

  const [users, trades, bots, strategies, follows, crons] = await Promise.all([
    User.find()
      .sort({ createdAt: -1 })
      .limit(28)
      .select("email subscriptionPlan role createdAt")
      .lean(),
    Trade.find()
      .sort({ createdAt: -1 })
      .limit(42)
      .select(
        "userId botId pair side quantity price status isPaper pnl tradeSource createdAt errorMessage meta"
      )
      .lean(),
    Bot.find()
      .sort({ createdAt: -1 })
      .limit(22)
      .select("userId pair status mode createdAt")
      .lean(),
    Strategy.find()
      .sort({ createdAt: -1 })
      .limit(18)
      .select("userId name source createdAt")
      .lean(),
    Follow.find()
      .sort({ createdAt: -1 })
      .limit(18)
      .select("followerId traderId active createdAt")
      .lean(),
    CronRunLog.find().sort({ createdAt: -1 }).limit(18).lean(),
  ]);

  const userIds = new Set();
  for (const t of trades) userIds.add(String(t.userId));
  for (const b of bots) userIds.add(String(b.userId));
  for (const s of strategies) userIds.add(String(s.userId));
  for (const f of follows) {
    userIds.add(String(f.followerId));
    userIds.add(String(f.traderId));
  }

  const emailMap = await emailByIds([...userIds]);

  /** @type {Array<{ id: string, kind: string, at: Date, title: string, detail: string, meta: Record<string, unknown> }>} */
  const events = [];

  for (const u of users) {
    events.push({
      id: `user-${u._id}`,
      kind: "registration",
      at: u.createdAt,
      title: "Înregistrare utilizator",
      detail: `${u.email} · plan ${u.subscriptionPlan}`,
      meta: {
        userId: String(u._id),
        email: u.email,
        subscriptionPlan: u.subscriptionPlan,
        role: u.role,
      },
    });
  }

  for (const t of trades) {
    const em = emailMap.get(String(t.userId)) || "?";
    const pilotTag =
      t.meta && typeof t.meta === "object" && t.meta.aiPilotControl ? " · pilot" : "";
    events.push({
      id: `trade-${t._id}`,
      kind: "trade",
      at: t.createdAt,
      title: "Tranzacție",
      detail: `${t.pair} ${t.side} · ${t.status} · ${t.isPaper ? "paper" : "live"} · ${t.tradeSource}${pilotTag} · ${em}`,
      meta: {
        tradeId: String(t._id),
        userId: String(t.userId),
        userEmail: em,
        pair: t.pair,
        side: t.side,
        quantity: t.quantity,
        price: t.price,
        status: t.status,
        isPaper: t.isPaper,
        tradeSource: t.tradeSource,
        pnl: t.pnl,
        botId: t.botId ? String(t.botId) : null,
        errorMessage: t.errorMessage || undefined,
        aiPilotControl: Boolean(t.meta && typeof t.meta === "object" && t.meta.aiPilotControl),
      },
    });
  }

  for (const b of bots) {
    const em = emailMap.get(String(b.userId)) || "?";
    events.push({
      id: `bot-${b._id}`,
      kind: "bot",
      at: b.createdAt,
      title: "Bot creat",
      detail: `${b.pair} · ${b.status} · ${b.mode} · ${em}`,
      meta: {
        botId: String(b._id),
        userId: String(b.userId),
        userEmail: em,
        pair: b.pair,
        status: b.status,
        mode: b.mode,
      },
    });
  }

  for (const s of strategies) {
    const em = emailMap.get(String(s.userId)) || "?";
    events.push({
      id: `strategy-${s._id}`,
      kind: "strategy",
      at: s.createdAt,
      title: "Strategie nouă",
      detail: `${s.name} · sursă ${s.source} · ${em}`,
      meta: {
        strategyId: String(s._id),
        userId: String(s.userId),
        userEmail: em,
        name: s.name,
        source: s.source,
      },
    });
  }

  for (const f of follows) {
    const fe = emailMap.get(String(f.followerId)) || "?";
    const te = emailMap.get(String(f.traderId)) || "?";
    events.push({
      id: `follow-${f._id}`,
      kind: "follow",
      at: f.createdAt,
      title: f.active ? "Copy trading activ" : "Relație copy (inactivă)",
      detail: `${fe} urmărește pe ${te}`,
      meta: {
        followId: String(f._id),
        followerId: String(f.followerId),
        traderId: String(f.traderId),
        followerEmail: fe,
        traderEmail: te,
        active: f.active,
      },
    });
  }

  for (const c of crons) {
    events.push({
      id: `cron-${c._id}`,
      kind: "cron",
      at: c.createdAt,
      title: `Cron ${c.job}`,
      detail: c.ok
        ? `OK · ${typeof c.durationMs === "number" ? `${c.durationMs} ms` : "—"}`
        : `Eșuat · ${(c.error || "").slice(0, 160) || "fără mesaj"}`,
      meta: {
        job: c.job,
        ok: c.ok,
        durationMs: c.durationMs,
        statusCode: c.statusCode,
        summary: c.summary ?? {},
        error: c.error || undefined,
      },
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const sliced = events.slice(0, limit);

  return NextResponse.json({
    events: sliced.map((e) => ({
      ...e,
      at: e.at instanceof Date ? e.at.toISOString() : e.at,
    })),
    generatedAt: new Date().toISOString(),
    limits: { registration: 28, trade: 42, bot: 22, strategy: 18, follow: 18, cron: 18, mergedCap: limit },
  });
}
