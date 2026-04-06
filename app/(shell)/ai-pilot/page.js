"use client";

import { AiPilotPanel } from "@/components/AiPilotPanel";
import { PageHeader } from "@/components/shell/PageHeader";

export default function AiPilotPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="AI Pilot"
        description="Orchestrare automată: analiză piață la interval, activare/pauză boți și închidere poziții la semnal. Detaliile tehnice și cron rămân și în Setări."
      />
      <AiPilotPanel />
    </div>
  );
}
