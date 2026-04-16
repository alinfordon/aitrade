"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AiPilotPanel } from "@/components/AiPilotPanel";
import { AiModelSettingsCard } from "@/components/AiModelSettingsCard";
import { BinanceConnectionBadge } from "@/components/BinanceConnectionBadge";
import { ManualLiveTpslSettingsPanel } from "@/components/ManualLiveTpslSettingsPanel";
import { RealSpotBalancesTable } from "@/components/RealSpotBalancesTable";
import { useSpotWallet } from "@/components/SpotWalletProvider";
import { PageHeader } from "@/components/shell/PageHeader";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [keysSaving, setKeysSaving] = useState(false);
  const { wallet, loading: walletLoading, loadWallet } = useSpotWallet();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setProfileLoading(true);
      try {
        const r = await fetch("/api/auth/me");
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || !j.user) {
          toast.error(j.error || "Nu s-au putut încărca datele de profil");
          return;
        }
        setProfileName(j.user.displayName || "");
        setProfileEmail(j.user.email || "");
      } catch {
        if (!cancelled) toast.error("Nu s-au putut încărca datele de profil");
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveKeys(e) {
    e.preventDefault();
    setKeysSaving(true);
    try {
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
      void loadWallet();
    } finally {
      setKeysSaving(false);
    }
  }

  async function saveProfile(e) {
    e.preventDefault();
    setProfileSaving(true);
    try {
      const r = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: profileName.trim(),
          email: profileEmail.trim().toLowerCase(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error || "Nu s-a putut salva profilul");
        return;
      }
      setProfileName(j.user?.displayName || "");
      setProfileEmail(j.user?.email || "");
      toast.success("Profil actualizat");
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Setări"
        description="Cheile Binance sunt criptate AES-256-GCM la rest. Aceleași chei alimentează Trading și soldul live."
      />

      <section className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/[0.08] bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Profil utilizator</CardTitle>
            <CardDescription>Actualizează numele afișat și adresa de email a contului.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={saveProfile}>
              <div className="space-y-2">
                <Label htmlFor="profile-display-name">Nume afișat</Label>
                <Input
                  id="profile-display-name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="ex. Andrei Trader"
                  disabled={profileLoading || profileSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-email">Email</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  placeholder="nume@email.com"
                  disabled={profileLoading || profileSaving}
                />
              </div>
              <Button type="submit" disabled={profileLoading || profileSaving}>
                {profileSaving ? "Se salvează…" : "Salvează profil"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-white/[0.08] bg-card/60 backdrop-blur-md">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Conexiune Binance Spot</CardTitle>
              <CardDescription>
                Status verificat prin citirea soldului (chei valide + drepturi Spot). Același flux ca la Trading.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BinanceConnectionBadge wallet={wallet} />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={walletLoading}
                onClick={() => loadWallet().catch(() => {})}
              >
                {walletLoading ? "Se încarcă…" : "Reîmprospătează"}
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
      </section>

      <section>
        <Card className="border-white/[0.08] bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Binance API</CardTitle>
            <CardDescription>Use API key + secret with spot trade permission for live bots.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid max-w-3xl gap-4 md:grid-cols-2" onSubmit={saveKeys}>
              <div className="space-y-2 md:col-span-2">
                <Label>API Key</Label>
                <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>API Secret</Label>
                <Input
                  type="password"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={keysSaving}>
                  {keysSaving ? "Se salvează…" : "Save encrypted keys"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <AiPilotPanel />
          <ManualLiveTpslSettingsPanel />
        </div>
        <div className="space-y-4">
          <AiModelSettingsCard />
        </div>
      </section>
    </div>
  );
}
