import { LiveTradingPanel } from "@/components/LiveTradingPanel";
import { PageHeader } from "@/components/shell/PageHeader";

export default function LiveTradingPage() {
  return (
    <div className="space-y-5 w-full">
      <PageHeader
        title="Live Trading"
        description="Poziții deschise, grafic live Binance (istoric REST, lumânări și ticker WebSocket), linii de intrare / SL / TP — plasează SL sau TP din butoane apoi click pe grafic sau trage liniile. Monitorizare opțională și închidere market pentru pozițiile manuale. Pozițiile deschise de bots se văd aici, dar se închid prin strategie sau din pagina Bots."
      />
      <LiveTradingPanel />
    </div>
  );
}
