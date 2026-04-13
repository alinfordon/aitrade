import { LiveTradingPanel } from "@/components/LiveTradingPanel";
import { PageHeader } from "@/components/shell/PageHeader";
import "@/app/(shell)/live/live-dashboard.css";

export default function LiveTradingPage() {
  return (
    <div className="live-dashboard space-y-6 w-full">
      <header className="live-hero">
        <div className="live-hero-inner">
          <PageHeader
            title="Live Trading"
            description="Poziții deschise, grafic live Binance (istoric REST, lumânări și ticker WebSocket), linii de intrare / SL / TP — plasează SL sau TP din butoane apoi click pe grafic sau trage liniile. Monitorizare opțională și închidere market pentru pozițiile manuale. Pozițiile deschise de bots se văd aici, dar se închid prin strategie sau din pagina Bots."
          />
        </div>
      </header>
      <div className="live-panel-shell">
        <LiveTradingPanel />
      </div>
    </div>
  );
}
