"use client";

import { AiPilotPanel } from "@/components/AiPilotPanel";
import { AiPilotTradesColumn } from "@/components/AiPilotTradesColumn";
import { PageHeader } from "@/components/shell/PageHeader";
import "@/app/(shell)/ai-pilot/ai-pilot-dashboard.css";

export default function AiPilotPage() {
  return (
    <div className="ai-pilot-dashboard space-y-8">
      <header className="ai-pilot-hero">
        <div className="ai-pilot-hero-inner">
          <PageHeader
            title="AI Pilot"
            description="Orchestrare automată: analiză piață la interval, activare/pauză boți și închidere poziții la semnal. În dreapta: istoricul acțiunilor manuale orchestrate de pilot."
          />
        </div>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] xl:gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <AiPilotPanel className="ai-pilot-card-shell" />
        </div>
        <aside className="min-w-0">
          <AiPilotTradesColumn className="ai-pilot-card-shell" />
        </aside>
      </div>
    </div>
  );
}
