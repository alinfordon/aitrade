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
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { cn } from "@/lib/utils";

function StatTile({ icon: Icon, label, children, hint, accentClass }) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-card/90 via-card/55 to-card/30 p-px shadow-lg shadow-black/30",
        "backdrop-blur-xl transition-all duration-500 hover:border-primary/35 hover:shadow-[0_0_50px_-12px_hsl(160_84%_39%_/_0.28)]"
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
  const { wallet, loadWallet } = useSpotWallet();

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
    <div className="space-y-8 pb-4">
      <header className="relative space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary"
              >
                <Sparkles className="mr-1 inline h-3 w-3" />
                AI · 2026
              </Badge>
              <Badge variant="secondary" className="text-[10px] font-normal uppercase tracking-wider">
                Binance Spot
              </Badge>
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-[2.75rem] md:leading-tight">
              Command center
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Vedere de ansamblu: performanță, roboți activi, solduri și upgrade — într-un singur ecran conceput
              pentru fluxul de trading și automatizare.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button type="button" size="sm" variant="outline" className="border-white/15 bg-white/[0.03]" asChild>
              <Link href="/strategies">
                <Cpu className="mr-2 h-4 w-4" />
                Strategii
              </Link>
            </Button>
            <Button type="button" size="sm" className="shadow-lg shadow-primary/15" asChild>
              <Link href="/trading">
                Tranzacționează
                <ArrowUpRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map(({ href, label, desc, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-card/40 px-3 py-3 backdrop-blur-md transition-all",
                "hover:border-primary/35 hover:bg-card/60 hover:shadow-md hover:shadow-primary/5"
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-accent transition-colors group-hover:text-primary">
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
      </header>

      <section className="relative mt-8">
        <Card className="overflow-hidden border-white/[0.08] bg-gradient-to-br from-card/80 via-card/50 to-card/30 shadow-xl shadow-black/20 backdrop-blur-xl">
          <CardHeader className="flex flex-col gap-4 border-b border-white/[0.06] bg-white/[0.02] pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <CardTitle className="font-display text-lg sm:text-xl">Binance Spot — sold live</CardTitle>
              </div>
              <CardDescription className="text-xs sm:text-sm">
                Conectat = citire sold cu cheile tale. Detalii și editare în Settings.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BinanceConnectionBadge wallet={wallet} />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="border border-white/10 bg-white/5"
                onClick={() => loadWallet().catch(() => {})}
              >
                Reîmprospătează
              </Button>
              {!wallet?.hasApiKeys && (
                <Button type="button" size="sm" variant="outline" className="border-primary/30" asChild>
                  <Link href="/settings">Chei API</Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {wallet?.real?.connected &&
            wallet?.overview?.real &&
            typeof wallet.overview.real.totalUsdEstimate === "number" ? (
              <div className="mb-6 overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.12] via-card/40 to-sky-500/[0.06] p-4 shadow-lg shadow-black/20 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-emerald-400/95">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
                      <DollarSign className="h-5 w-5" strokeWidth={1.75} />
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                        Sold total estimat
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">Binance Spot · în USD (≈ USDC)</p>
                    </div>
                  </div>
                </div>
                <p className="mt-4 font-mono text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl">
                  {wallet.overview.real.totalUsdEstimate.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  <span className="text-xl font-medium text-muted-foreground sm:text-2xl">USD</span>
                </p>
                <p className="mt-3 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
                  Sumă <span className="text-foreground/90">total</span> (disponibil + blocat în ordine) pentru
                  fiecare activ, evaluată la preț spot USDC. Stabile majore (USDC, USDT, FDUSD…) sunt luate ca
                  1:1 cu USD.
                </p>
              </div>
            ) : wallet?.hasApiKeys && !wallet?.real?.connected ? (
              <div className="mb-6 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[11px] text-muted-foreground">
                Conectează cheile Binance și apasă Reîmprospătează pentru sold total în USD.
              </div>
            ) : null}
            {wallet?.real?.error ? <p className="mb-4 text-sm text-destructive">{wallet.real.error}</p> : null}
            <RealSpotBalancesTable wallet={wallet} />
          </CardContent>
        </Card>
      </section>

      <section className="relative mt-10 grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
      </section>

      <section className="relative mt-10 space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="font-display text-lg font-semibold tracking-tight">Evoluție USDC (live)</h2>
        </div>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Grafice cumulative din PnL-ul tranzacțiilor reale (nu paper) — reflectă creșterea sau scăderea
          rezultatului realizat în timp, nu soldul brut din cont Binance.
        </p>
        <UsdcEquityCharts />
      </section>      

      <section className="relative mt-8">
        <div className="mb-4 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-accent" />
          <h2 className="font-display text-lg font-semibold tracking-tight">Plan &amp; limite</h2>
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
