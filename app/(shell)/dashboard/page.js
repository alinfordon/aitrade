"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Cpu,
  DollarSign,
  Percent,
  Radio,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { maxBotsForPlan } from "@/lib/plans";
import { BinanceConnectionBadge } from "@/components/BinanceConnectionBadge";
import { RealSpotBalancesTable } from "@/components/RealSpotBalancesTable";
import { UsdcEquityCharts } from "@/components/dashboard/UsdcEquityCharts";
import { TradeWinLossCharts } from "@/components/dashboard/TradeWinLossCharts";
import { AiPilotDashboardRunPanel } from "@/components/dashboard/AiPilotDashboardRunPanel";
import { ManualLiveTpslDashboardPanel } from "@/components/dashboard/ManualLiveTpslDashboardPanel";
import { BotCronStatsPanel } from "@/components/dashboard/BotCronStatsPanel";
import { AiPilotTradesColumn } from "@/components/AiPilotTradesColumn";
import { BotsTradesColumn } from "@/components/BotsTradesColumn";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { cn } from "@/lib/utils";
import "@/components/dashboard/fleet-dashboard.css";

function StatTile({ icon: Icon, label, children, hint, accentClass, className }) {
  return (
    <div
      className={cn(
        "fleet-stat-tile group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-card/90 via-card/55 to-card/30 p-px shadow-lg shadow-black/30",
        "backdrop-blur-xl transition-all duration-500 hover:border-amber-500/25 hover:shadow-[0_0_50px_-12px_rgba(251,191,36,0.18)]",
        className
      )}
    >
      <div className="relative rounded-[calc(1rem-1px)] bg-gradient-to-br from-background/25 via-transparent to-accent/[0.03] p-4 sm:p-5">
        <div
          className={cn(
            "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100",
            accentClass ?? "bg-primary/30"
          )}
        />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-primary shadow-inner">
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </div>
        </div>
        <p className="relative mt-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {label}
        </p>
        <div className="relative mt-1 font-mono text-xl tabular-nums tracking-tight text-foreground sm:text-2xl md:text-3xl">
          {children}
        </div>
        {hint ? (
          <p className="relative mt-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

const QUICK_LINKS = [
  { href: "/trading", label: "Trading", desc: "Ordine spot paper / real", icon: TrendingUp },
  { href: "/live", label: "Live", desc: "Grafic, SL/TP, analiză AI", icon: Radio },
  { href: "/bots", label: "Bots", desc: "Strategii automatizate", icon: Bot },
  { href: "/discover", label: "Piață", desc: "Discover & context", icon: Activity },
];

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const [bots, setBots] = useState([]);
  const [liveStats, setLiveStats] = useState(null);
  const { wallet, loading: walletLoading, loadWallet } = useSpotWallet();

  useEffect(() => {
    (async () => {
      try {
        const [me, botsRes, live] = await Promise.all([
          fetch("/api/auth/me").then((r) => r.json()),
          fetch("/api/bots").then((r) => r.json()),
          fetch("/api/dashboard/live-stats").then((r) => r.json()),
        ]);
        if (me.user) setUser(me.user);
        if (botsRes.bots) setBots(botsRes.bots);
        if (live.live) setLiveStats(live.live);
      } catch {
        toast.error("Nu s-a putut încărca dashboard-ul");
      }
    })();
  }, []);

  const activeBots = bots.filter((b) => b.status === "active").length;
  const maxB = user ? maxBotsForPlan(user.subscriptionPlan) : 1;

  const winRate = liveStats?.winRate ?? 0;
  const todayProfit = liveStats?.todayPnl ?? 0;
  const todayLabel = liveStats?.todayUtc || new Date().toISOString().slice(0, 10);
  const totalProfit = liveStats?.totalProfit;
  const plan = user?.subscriptionPlan || "free";

  async function checkout(p) {
    const r = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: p }),
    });
    const j = await r.json();
    if (j.url) window.location.href = j.url;
    else toast.error(j.error || "Checkout eșuat");
  }

  return (
    <div className="fleet-dashboard w-full min-w-0 space-y-8 pb-4">
      <header className="fleet-hero fleet-hero--animated">
        <div className="fleet-hero-inner space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="fleet-live-strip">
                  <span className="fleet-live-dot" aria-hidden />
                  Live
                  <span className="font-normal tracking-normal text-emerald-200/80">· sisteme</span>
                </span>
                <Badge
                  variant="outline"
                  className="border-amber-500/35 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200"
                >
                  <Sparkles className="mr-1 inline h-3 w-3" />
                  War room
                </Badge>
                <Badge variant="secondary" className="text-[10px] font-normal uppercase tracking-wider">
                  Binance Spot
                </Badge>
              </div>
              <h1 className="fleet-title font-display text-3xl sm:text-4xl md:text-[2.65rem]">
                Command fleet
              </h1>
              <p className="fleet-subtitle">
                Panou unic: pilot AI, tranzacții pilot și boți, performanță live, solduri și plan — inspirat de
                experiențele tip „fleet trading”, adaptat pentru fluxul tău aitrade.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
              <Button type="button" size="sm" variant="outline" className="border-white/15 bg-white/[0.04]" asChild>
                <Link href="/strategies">
                  <Cpu className="mr-2 h-4 w-4" />
                  Strategii
                </Link>
              </Button>
              <Button
                type="button"
                size="sm"
                className="border border-amber-500/30 bg-amber-500/15 text-amber-50 shadow-lg shadow-amber-900/20 hover:bg-amber-500/25"
                asChild
              >
                <Link href="/trading">
                  Tranzacționează
                  <ArrowUpRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map(({ href, label, desc, icon: Icon }) => (
              <Link key={href} href={href} className="fleet-quick-link group flex items-center gap-3 px-3 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-amber-200/90 transition-colors group-hover:text-amber-100">
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 font-medium text-foreground">
                    {label}
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </header>

      {/* Rândul de sus: Sold Binance + Activitate AI Pilot — pe același rând */}
      <section className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card className="fleet-wallet-panel h-full overflow-hidden border-white/[0.08] bg-gradient-to-br from-card/80 via-card/50 to-card/30 shadow-xl shadow-black/20 backdrop-blur-xl">
          <CardHeader className="flex flex-col gap-3 border-b border-white/[0.06] bg-white/[0.02] pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <CardTitle className="font-display text-base">Binance Spot — sold live</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Monede cu val. estimată &gt; 1 USD. Tot soldul în Settings.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BinanceConnectionBadge wallet={wallet} />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="border border-white/10 bg-white/5"
                disabled={walletLoading}
                onClick={() => loadWallet().catch(() => {})}
              >
                {walletLoading ? "Se încarcă…" : "Reîmprospătează"}
              </Button>
              {!wallet?.hasApiKeys && (
                <Button type="button" size="sm" variant="outline" className="border-primary/30" asChild>
                  <Link href="/settings">Chei API</Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {wallet?.real?.connected &&
            wallet?.overview?.real &&
            typeof wallet.overview.real.totalUsdEstimate === "number" ? (
              <div className="mb-4 flex items-center gap-3 overflow-hidden rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.12] via-card/40 to-sky-500/[0.06] px-4 py-3 shadow-md shadow-black/20">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-emerald-400">
                  <DollarSign className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Sold total estimat
                  </p>
                  <p className="font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl">
                    {wallet.overview.real.totalUsdEstimate.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    <span className="text-base font-medium text-muted-foreground">USD</span>
                  </p>
                </div>
              </div>
            ) : wallet?.hasApiKeys && !wallet?.real?.connected ? (
              <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[11px] text-muted-foreground">
                Conectează cheile Binance și apasă Reîmprospătează.
              </div>
            ) : null}
            {wallet?.real?.error ? <p className="mb-3 text-sm text-destructive">{wallet.real.error}</p> : null}
            <RealSpotBalancesTable wallet={wallet} minUsdTotal={1} />
          </CardContent>
        </Card>

        <AiPilotDashboardRunPanel />
      </section>

      <section className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ManualLiveTpslDashboardPanel />
        <BotCronStatsPanel />
      </section>

      {/* Flux live — poziții deschise pilot & boți */}
      <section className="fleet-dash-flux space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="fleet-section-intro">
            <div className="fleet-section-intro-icon" aria-hidden>
              <Bot className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="fleet-section-intro-stack min-w-0">
              <p className="fleet-section-label">Flux live</p>
              <p className="fleet-section-subkicker">
                Pilot și boți — doar poziții deschise acum (real). Vezi istoric complet pe paginile dedicate.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            <Link href="/ai-pilot" className="font-medium text-primary underline-offset-2 hover:underline">
              Pagina AI Pilot
            </Link>
            <span aria-hidden>·</span>
            <Link href="/bots" className="font-medium text-primary underline-offset-2 hover:underline">
              Pagina Boți
            </Link>
          </div>
        </div>
        <div className="fleet-live-deck grid gap-4 xl:grid-cols-2">
          <AiPilotTradesColumn variant="dashboard" className="fleet-trade-card min-h-[240px]" />
          <BotsTradesColumn variant="dashboard" className="fleet-trade-card min-h-[240px]" />
        </div>
      </section>

      {/* Performanță live — KPI tiles */}
      <section className="fleet-dash-stats space-y-3">
        <div className="fleet-section-intro fleet-section-intro--dense">
          <div className="fleet-section-intro-icon" aria-hidden>
            <Activity className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <p className="fleet-section-label">Performanță live</p>
        </div>
        <div className="fleet-stat-grid grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            icon={TrendingUp}
            label="Profit total live"
            accentClass="bg-emerald-500/25"
            hint="Însumat din tranzacții reale (nu paper)"
          >
            <span className={totalProfit != null && totalProfit >= 0 ? "text-emerald-400" : "text-rose-400"}>
              {liveStats != null ? Number(totalProfit).toFixed(4) : "—"}
            </span>
            <span className="text-lg font-normal text-muted-foreground sm:text-xl"> USDC</span>
          </StatTile>
          <StatTile
            icon={Zap}
            label="PnL azi (live)"
            accentClass="bg-amber-400/20"
            hint={`Tranzacții reale · zi UTC ${todayLabel}`}
          >
            <span className={todayProfit >= 0 ? "text-emerald-400" : "text-rose-400"}>
              {todayProfit >= 0 ? "+" : ""}
              {todayProfit.toFixed(4)}
            </span>
            <span className="text-lg font-normal text-muted-foreground sm:text-xl"> USDC</span>
          </StatTile>
          <StatTile
            icon={Percent}
            label="Win rate live"
            accentClass="bg-cyan-500/20"
            hint="Pe tranzacții reale cu PnL înregistrat"
          >
            <span className="text-cyan-300">{(winRate * 100).toFixed(1)}%</span>
          </StatTile>
          <StatTile
            icon={Bot}
            label="Bots activi"
            accentClass="bg-violet-500/20"
            hint={Number.isFinite(maxB) ? `Limită plan: ${maxB}` : "Nelimitat (Elite)"}
          >
            {activeBots}
            <span className="text-lg font-normal text-muted-foreground sm:text-xl">
              {" "}
              / {Number.isFinite(maxB) ? maxB : "∞"}
            </span>
          </StatTile>
        </div>
      </section>

      <section className="relative mt-10 space-y-3">
        <div className="fleet-section-intro">
          <div className="fleet-section-intro-icon fleet-section-intro-icon--accent" aria-hidden>
            <Activity className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="fleet-section-intro-stack">
            <h2 className="fleet-section-heading">Evoluție USDC (live)</h2>
          </div>
        </div>
        <p className="fleet-section-desc">
          Grafice cumulative din PnL-ul tranzacțiilor reale (nu paper) — reflectă creșterea sau scăderea
          rezultatului realizat în timp, nu soldul brut din cont Binance.
        </p>
        <UsdcEquityCharts />
      </section>

      <section className="relative mt-10 space-y-3">
        <div className="fleet-section-intro">
          <div className="fleet-section-intro-icon fleet-section-intro-icon--accent" aria-hidden>
            <Activity className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="fleet-section-intro-stack">
            <h2 className="fleet-section-heading">Tranzacții câștig / pierdere (live)</h2>
          </div>
        </div>
        <p className="fleet-section-desc">
          Distribuție zilnică și lunară după rezultat: doar tranzacții reale cu PnL înregistrat (nu paper).
        </p>
        <TradeWinLossCharts />
      </section>

      <section className="relative mt-8">
        <div className="mb-4 fleet-section-intro fleet-section-intro--dense">
          <div className="fleet-section-intro-icon fleet-section-intro-icon--accent" aria-hidden>
            <Cpu className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <h2 className="fleet-section-heading">Plan &amp; limite</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              id: "free",
              name: "Free",
              blurb: "Început rapid · 1 bot",
              current: plan === "free",
            },
            {
              id: "pro",
              name: "Pro",
              blurb: "Până la 5 boturi · marketplace · AI Live SL/TP",
              current: plan === "pro",
            },
            {
              id: "elite",
              name: "Elite",
              blurb: "Bots nelimitat · AI optimizer · tot din Pro",
              current: plan === "elite",
            },
          ].map((tier) => (
            <Card
              key={tier.id}
              className={cn(
                "relative overflow-hidden border-white/[0.08] bg-card/50 backdrop-blur-md transition-all",
                tier.current &&
                  "border-primary/45 bg-gradient-to-br from-primary/10 via-card/60 to-card/40 shadow-[0_0_40px_-12px_hsl(160_84%_39%_/_0.35)]"
              )}
            >
              {tier.current ? (
                <div className="absolute right-3 top-3">
                  <Badge className="bg-primary text-primary-foreground">Activ</Badge>
                </div>
              ) : null}
              <CardHeader>
                <CardTitle className="font-display text-base">{tier.name}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">{tier.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {tier.current && plan === "free" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => checkout("pro")}>
                      Upgrade Pro
                    </Button>
                    <Button type="button" size="sm" onClick={() => checkout("elite")}>
                      Upgrade Elite
                    </Button>
                  </div>
                ) : null}
                {tier.current && plan === "pro" ? (
                  <Button type="button" size="sm" className="w-full sm:w-auto" onClick={() => checkout("elite")}>
                    Upgrade Elite · AI optimizer
                  </Button>
                ) : null}
                {tier.current && plan === "elite" ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Bots nelimitați, AI optimizer pentru strategii și acces la toate funcțiile Pro.
                  </p>
                ) : null}
                {!tier.current && plan === "elite" && tier.id !== "elite" ? (
                  <p className="text-[11px] text-muted-foreground/80">Acoperit de planul tău Elite.</p>
                ) : null}
                {!tier.current && plan === "pro" && tier.id === "free" ? (
                  <p className="text-[11px] text-muted-foreground/80">Nivel inițial — ai deja Pro activ.</p>
                ) : null}
                {!tier.current && plan === "free" && tier.id !== "free" ? (
                  <p className="text-[11px] text-muted-foreground/80">Disponibil prin upgrade din coloana Free.</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>

        {plan === "free" && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Plata securizată prin Stripe · poți schimba planul oricând din{" "}
            <Link href="/settings" className="font-medium text-primary underline underline-offset-2">
              Settings
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}
