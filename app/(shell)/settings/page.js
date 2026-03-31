"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BinanceConnectionBadge } from "@/components/BinanceConnectionBadge";
import { RealSpotBalancesTable } from "@/components/RealSpotBalancesTable";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { PageHeader } from "@/components/shell/PageHeader";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const { wallet, loadWallet } = useSpotWallet();

  async function saveKeys(e) {
    e.preventDefault();
    const r = await fetch("/api/user/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, apiSecret }),
    });
    const j = await r.json();
    if (!r.ok) {
      toast.error(j.error || "Save failed");
      return;
    }
    toast.success("API keys encrypted and stored");
    setApiKey("");
    setApiSecret("");
    loadWallet().catch(() => {});
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Setări"
        description="Cheile Binance sunt criptate AES-256-GCM la rest. Aceleași chei alimentează Trading și soldul live."
      />

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Conexiune Binance Spot</CardTitle>
            <CardDescription>
              Status verificat prin citirea soldului (chei valide + drepturi Spot). Același flux ca la Trading.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BinanceConnectionBadge wallet={wallet} />
            <Button type="button" size="sm" variant="secondary" onClick={() => loadWallet().catch(() => {})}>
              Reîmprospătează
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {wallet?.real?.error && (
            <p className="mb-4 text-sm text-destructive">{wallet.real.error}</p>
          )}
          <RealSpotBalancesTable wallet={wallet} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Binance API</CardTitle>
          <CardDescription>Use API key + secret with spot trade permission for live bots.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="max-w-md space-y-4" onSubmit={saveKeys}>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2">
              <Label>API Secret</Label>
              <Input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                autoComplete="off"
              />
            </div>
            <Button type="submit">Save encrypted keys</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
