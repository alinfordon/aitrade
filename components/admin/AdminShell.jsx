"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Gauge,
  LayoutDashboard,
  Shield,
  SlidersHorizontal,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  {
    href: "/admin",
    label: "Panou de control",
    sub: "Vedere generală",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/admin/users",
    label: "Utilizatori",
    sub: "Gestionare conturi",
    icon: Users,
  },
  {
    href: "/admin/subscriptions",
    label: "Abonamente",
    sub: "Planuri și expirări",
    icon: Wallet,
  },
  {
    href: "/admin/limits",
    label: "Limite Free",
    sub: "Configurare plan gratuit",
    icon: SlidersHorizontal,
  },
  {
    href: "/admin/analytics",
    label: "Analytics",
    sub: "Statistici și rapoarte",
    icon: Activity,
  },
  {
    href: "/admin/activity",
    label: "Activitate",
    sub: "Log-uri și evenimente",
    icon: Gauge,
  },
  {
    href: "/admin/alerts",
    label: "Alertări",
    sub: "Notificări sistem",
    icon: Bell,
  },
];

function NavItem({ item, pathname }) {
  const Icon = item.icon;
  const active = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
        active
          ? "border border-primary/45 bg-primary/[0.12] text-primary shadow-[0_0_28px_-10px_hsl(160_84%_39%_/_0.5)]"
          : "border border-transparent text-muted-foreground hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background/50",
          active ? "border-primary/35 text-primary" : "border-white/10 text-muted-foreground group-hover:text-foreground"
        )}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{item.label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground group-hover:text-muted-foreground/90">
          {item.sub}
        </span>
      </span>
    </Link>
  );
}

export function AdminShell({ children }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col gap-6 lg:flex-row lg:gap-8">
      <aside
        className={cn(
          "shrink-0 rounded-2xl border border-white/[0.09] bg-background/55 p-3 shadow-lg shadow-black/25 backdrop-blur-xl",
          "lg:w-64 xl:w-72"
        )}
      >
        <div className="mb-3 flex items-center gap-2 border-b border-white/[0.07] px-2 pb-3 pt-1">
          <Shield className="h-5 w-5 text-primary" strokeWidth={1.75} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Zonă admin</p>
            <p className="text-sm font-medium text-foreground">AI Trading</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavItem key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
