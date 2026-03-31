"use client";

export function formatBalanceAmount(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 0.0001)) return v.toExponential(2);
    return v.toFixed(v % 1 === 0 ? 0 : Math.abs(v) >= 1 ? 4 : 8);
  }
  return String(v);
}

/**
 * Tabel solduri Binance Spot (coloana „real” din răspunsul /api/wallet/spot).
 */
export function RealSpotBalancesTable({ wallet }) {
  const fmt = formatBalanceAmount;
  const hasKeys = wallet?.hasApiKeys;
  const connected = wallet?.real?.connected;
  const error = wallet?.real?.error;
  const rows = wallet?.real?.balances || [];

  let emptyMsg = "—";
  if (!wallet) emptyMsg = "Se încarcă…";
  else if (!hasKeys) emptyMsg = "Adaugă chei API în Settings pentru a vedea soldul Spot.";
  else if (error) emptyMsg = "Nu s-a putut citi soldul. Verifică eroarea de mai sus.";
  else if (connected && !rows.length) {
    emptyMsg = "Conexiune reușită — nu există solduri vizibile (sau toate sub pragul de afișare).";
  }

  return (
    <div className="max-h-56 overflow-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-muted/80">
          <tr className="text-muted-foreground">
            <th className="px-3 py-2">Monedă</th>
            <th className="px-3 py-2">Disponibil</th>
            <th className="px-3 py-2">În uz</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.currency} className="border-t border-border/60">
                <td className="px-3 py-1.5 font-medium">{r.currency}</td>
                <td className="px-3 py-1.5 font-mono">{fmt(r.free)}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{fmt(r.used)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">
                {emptyMsg}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
