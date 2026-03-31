import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShellAmbient } from "@/components/shell/ShellAmbient";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <ShellAmbient fixed />
      <div className="relative z-[1] mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-10 px-6 py-16">
        <div className="space-y-4 text-center md:text-left">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">Serverless · Binance · AI</p>
          <h1 className="font-display text-4xl font-bold tracking-tight md:text-5xl md:leading-tight">
            AI-assisted crypto bots, copy trading & paper mode — pentru runtime fără worker persistent.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Strategii JSON dinamice, motor de indicatori, throttling Redis, planuri Stripe și execuție la cron —
            același limbaj vizual ca în aplicație.
          </p>
          <div className="flex flex-wrap justify-center gap-3 md:justify-start">
            <Link href="/register">
              <Button size="lg" className="shadow-lg shadow-primary/20">
                Creează cont
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="border-white/15 bg-white/[0.04]">
                Autentificare
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Optimizer AI</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              Variații de strategie, backtest pe lumânări istorice, scoruri profit / win-rate / drawdown (Elite).
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Copy trading</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              Urmărești top traderi; mărimea se scalează proporțional cu soldul în moneda cotei (ex. USDC).
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cron bots</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              <code className="rounded bg-muted/50 px-1">/api/cron/run-bots</code> cu CRON_SECRET — fără proces
              rezident.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
