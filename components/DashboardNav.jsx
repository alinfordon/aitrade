"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChartCandlestick, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BinanceConnectionBadge } from "@/components/BinanceConnectionBadge";
import { formatBalanceAmount } from "@/components/RealSpotBalancesTable";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { clearLivePositionsCache } from "@/lib/client/live-positions-store";

const baseLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trading", label: "Trading" },
  { href: "/live", label: "Live" },
  { href: "/discover", label: "Piață" },
  { href: "/bots", label: "Bots" },
  { href: "/ai-pilot", label: "AI Pilot" },
  { href: "/strategies", label: "Strategies" },
  { href: "/trades", label: "Trades" },
  { href: "/portfolio", label: "Portofoliu" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/settings", label: "Settings" },
];

function NavLinks({ className, links }) {
  const pathname = usePathname();
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium transition-all sm:px-3 sm:text-sm",
              active
                ? "border border-primary/40 bg-primary/15 text-primary shadow-[0_0_24px_-8px_hsl(160_84%_39%_/_0.5)]"
                : "border border-transparent text-muted-foreground hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-foreground"
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}

function NavBrand() {
  return (
    <Link
      href="/dashboard"
      className={cn(
        "group flex shrink-0 items-center gap-2.5 rounded-2xl outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      )}
    >
      <span
        className={cn(
          "nav-logo-mark relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/35",
          "bg-gradient-to-br from-primary/30 via-background/90 to-accent/20 text-primary",
          "transition-transform duration-300 group-hover:scale-[1.06] group-active:scale-[0.97]"
        )}
      >
        <ChartCandlestick className="relative z-[1] h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
        <span
          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-md border border-accent/45 bg-accent/25 text-accent shadow-md backdrop-blur-sm"
          aria-hidden
        >
          <Sparkles className="h-3 w-3" strokeWidth={2} />
        </span>
      </span>
      <span className="font-display text-base font-bold tracking-tight sm:text-lg">
        <span className="bg-gradient-to-r from-primary via-emerald-200/95 to-accent bg-clip-text text-transparent transition-opacity group-hover:opacity-95">
          AI Trading
        </span>
      </span>
    </Link>
  );
}

export function DashboardNav() {
  const { wallet } = useSpotWallet();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/me");
        const j = await r.json();
        if (!cancelled && r.ok && j.user?.role === "admin") setIsAdmin(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const links = useMemo(() => {
    if (!isAdmin) return baseLinks;
    const withoutSettings = baseLinks.filter((l) => l.href !== "/settings");
    return [
      ...withoutSettings,
      { href: "/admin", label: "Admin" },
      { href: "/settings", label: "Settings" },
    ];
  }, [isAdmin]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    clearLivePositionsCache();
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-50 flex justify-center bg-transparent px-2 pt-2 sm:px-3 sm:pt-3">
      <div
        className={cn(
          "relative w-[min(90%,90vw)] max-w-[1920px] min-w-0 overflow-hidden rounded-2xl border border-white/[0.09]",
          "bg-background/78 shadow-[0_12px_48px_-16px_rgba(0,0,0,0.7)] backdrop-blur-xl supports-[backdrop-filter]:bg-background/62"
        )}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            background:
              "radial-gradient(ellipse 120% 80% at 50% -40%, hsl(160 84% 39% / 0.12), transparent 55%), radial-gradient(ellipse 90% 60% at 100% 50%, hsl(186 100% 42% / 0.06), transparent 50%)",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent"
          aria-hidden
        />
        <div className="relative px-2 py-2 sm:px-4 sm:py-2.5">
          <div className="flex items-center justify-between gap-3">
            <NavBrand />

            <div className="flex min-w-0 flex-1 justify-center px-1 max-md:hidden">
              <NavLinks links={links} />
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <div className="hidden flex-col items-end gap-0.5 text-xs md:flex">
                <BinanceConnectionBadge wallet={wallet} />
                {wallet?.real?.connected && (wallet.real.balances?.length ?? 0) > 0 ? (
                  <span
                    className="max-w-[220px] truncate font-mono text-[10px] text-muted-foreground"
                    title={wallet.real.balances.map((b) => `${b.currency} ${formatBalanceAmount(b.free)}`).join(", ")}
                  >
                    {wallet.real.balances
                      .slice(0, 4)
                      .map((b) => `${b.currency} ${formatBalanceAmount(b.free)}`)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                type="button"
                className="border-white/15 bg-white/[0.04] text-xs hover:border-primary/35 hover:bg-primary/10 sm:text-sm"
                onClick={logout}
              >
                Log out
              </Button>
            </div>
          </div>

          <div className="border-t border-white/[0.06] pb-2 pt-1.5 md:hidden">
            <NavLinks
              links={links}
              className="gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
