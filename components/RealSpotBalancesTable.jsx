"use client";

function fmtUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

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
 * Solduri Binance Spot (coloana „real” din `/api/wallet/spot`).
 *
 * @param {object} props
 * @param {object | null | undefined} props.wallet
 * @param {number} [props.minUsdTotal] dacă e setat și există `usdTotal` pe rânduri, afișează doar monedele cu valoare estimată strict mai mare decât pragul (USD).
 */
export function RealSpotBalancesTable({ wallet, minUsdTotal }) {
  const fmt = formatBalanceAmount;
  const hasKeys = wallet?.hasApiKeys;
  const connected = wallet?.real?.connected;
  const error = wallet?.real?.error;
  const rawRows = wallet?.real?.balances || [];
  const hasUsd = rawRows.some((r) => r && typeof r.usdTotal === "number" && Number.isFinite(r.usdTotal));
  const threshold =
    typeof minUsdTotal === "number" && Number.isFinite(minUsdTotal) ? minUsdTotal : null;

  let rows = [...rawRows];
  if (threshold != null && hasUsd) {
    rows = rows.filter((r) => (Number(r.usdTotal) || 0) > threshold);
  }
  rows.sort((a, b) => (Number(b.usdTotal) || 0) - (Number(a.usdTotal) || 0));

  let emptyMsg = "—";
  if (!wallet) emptyMsg = "Se încarcă…";
  else if (!hasKeys) emptyMsg = "Adaugă chei API în Settings pentru a vedea soldul Spot.";
  else if (error) emptyMsg = "Nu s-a putut citi soldul. Verifică eroarea de mai sus.";
  else if (connected && !rawRows.length) {
    emptyMsg = "Conexiune reușită — nu există solduri vizibile (sau toate sub pragul de afișare).";
  } else if (connected && rawRows.length > 0 && !rows.length && threshold != null) {
    emptyMsg = `Nicio monedă peste ${threshold} USD estimat (total sau praf sub prag). Vezi tot soldul în Settings.`;
  }

  const colSpan = hasUsd ? 4 : 3;

  return (
    <div className="max-h-56 overflow-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-muted/80">
          <tr className="text-muted-foreground">
            <th className="px-3 py-2">Monedă</th>
            <th className="px-3 py-2">Disponibil</th>
            <th className="px-3 py-2">În uz</th>
            {hasUsd ? <th className="px-3 py-2 text-right">≈ USD (tot)</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.currency} className="border-t border-border/60">
                <td className="px-3 py-1.5 font-medium">{r.currency}</td>
                <td className="px-3 py-1.5 font-mono">{fmt(r.free)}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{fmt(r.used)}</td>
                {hasUsd ? (
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground tabular-nums">
                    {fmtUsd(r.usdTotal)}
                  </td>
                ) : null}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={colSpan} className="px-3 py-4 text-center text-muted-foreground">
                {emptyMsg}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
