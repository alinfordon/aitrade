import { PageHeader } from "@/components/shell/PageHeader";

export default function AdminLimitsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Limite Free"
        description="Configurare limite pentru planul gratuit — în curând. Până atunci, regulile sunt în cod (ex. maxBotsForPlan în lib/plans)."
      />
      <p className="text-sm text-muted-foreground">Această secțiune va permite editarea limitelor fără deploy.</p>
    </div>
  );
}
