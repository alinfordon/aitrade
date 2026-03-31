"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Loader2, RefreshCw, Save, Search } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PLAN_LABELS = {
  free: "Free",
  pro: "Pro",
  elite: "Elite",
};

const PLAN_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "elite", label: "Elite" },
];

function fmtRoDateOnly(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ro-RO");
  } catch {
    return "—";
  }
}

function toDateInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function planBadgeClass(plan) {
  if (plan === "elite") return "border-violet-400/40 bg-violet-500/15 text-violet-200";
  if (plan === "pro") return "border-amber-400/40 bg-amber-500/15 text-amber-200";
  return "border-sky-400/35 bg-sky-500/10 text-sky-200";
}

function isExpiredPaid(u) {
  if (u.subscriptionPlan === "free") return false;
  if (!u.planExpiresAt) return false;
  return new Date(u.planExpiresAt) < new Date();
}

export function AdminUsersPanel({ variant = "users" }) {
  const header =
    variant === "subscriptions"
      ? {
          title: "Gestionare abonamente",
          description:
            "Gestionează planurile, expirările și drepturile utilizatorilor. Modificările se salvează în baza de date; utilizatorul poate avea nevoie de re-login pentru cookie JWT actualizat la rol.",
        }
      : {
          title: "Utilizatori",
          description:
            "Caută după email sau nume afișat, filtrează după plan, editează rol și abonament.",
        };

  const [summary, setSummary] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 20;

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formRole, setFormRole] = useState("user");
  const [formPlan, setFormPlan] = useState("free");
  const [formExpires, setFormExpires] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 320);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        plan: planFilter,
      });
      if (searchDebounced) q.set("search", searchDebounced);
      const r = await fetch(`/api/admin/users?${q}`);
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Eroare încărcare");
        return;
      }
      setSummary(j.summary);
      setUsers(j.users || []);
      setTotalCount(j.totalCount ?? 0);
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setLoading(false);
    }
  }, [page, planFilter, searchDebounced]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [planFilter, searchDebounced]);

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  function openEdit(u) {
    setEditRow(u);
    setFormDisplayName(u.displayName || "");
    setFormRole(u.role);
    setFormPlan(u.subscriptionPlan);
    setFormExpires(toDateInputValue(u.planExpiresAt));
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editRow) return;
    setEditSaving(true);
    try {
      const body = {
        displayName: formDisplayName.trim(),
        role: formRole,
        subscriptionPlan: formPlan,
        planExpiresAt:
          formPlan === "free" ? null : formExpires.trim() === "" ? null : formExpires.trim(),
      };
      const r = await fetch(`/api/admin/users/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        toast.error(typeof j.error === "string" ? j.error : "Salvare eșuată");
        return;
      }
      toast.success("Utilizator actualizat.");
      setEditOpen(false);
      setEditRow(null);
      await load();
    } catch {
      toast.error("Eroare rețea");
    } finally {
      setEditSaving(false);
    }
  }

  const statTiles = useMemo(() => {
    if (!summary) return null;
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-card/80 to-card/35 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total utilizatori
          </p>
          <p className="mt-1 font-mono text-2xl text-foreground">{summary.total}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-card/80 to-card/35 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Free</p>
          <p className="mt-1 font-mono text-2xl text-sky-300">{summary.free}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-card/80 to-card/35 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pro</p>
          <p className="mt-1 font-mono text-2xl text-amber-200">{summary.pro}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-card/80 to-card/35 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Elite</p>
          <p className="mt-1 font-mono text-2xl text-violet-200">{summary.elite}</p>
        </div>
        <div className="rounded-2xl border border-red-500/20 bg-gradient-to-br from-card/80 to-red-950/10 p-4 backdrop-blur-md">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Expirate (Pro/Elite)
          </p>
          <p className="mt-1 font-mono text-2xl text-red-400">{summary.expiredPaid}</p>
        </div>
      </div>
    );
  }, [summary]);

  return (
    <div className="space-y-6">
      <PageHeader title={header.title} description={header.description}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => load()}
          disabled={loading}
          className="border-white/15"
        >
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
          Reîncarcă
        </Button>
      </PageHeader>

      {statTiles}

      <Card className="border-white/10 bg-card/40 backdrop-blur-md">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Listă</CardTitle>
          <CardDescription>Filtre și căutare</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Caută după email sau nume…"
                className="border-white/10 bg-black/20 pl-9"
              />
            </div>
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className={cn(
                "h-10 rounded-md border border-white/10 bg-black/25 px-3 text-sm text-foreground",
                "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <option value="all">Toate planurile</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="elite">Elite</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-black/20 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Email</th>
                  <th className="px-3 py-2.5 font-medium">Nume</th>
                  <th className="px-3 py-2.5 font-medium">Abonament</th>
                  <th className="px-3 py-2.5 font-medium">Expiră la</th>
                  <th className="px-3 py-2.5 font-medium">Rol</th>
                  <th className="px-3 py-2.5 font-medium text-right">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {loading && users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-12 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin opacity-70" />
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      Niciun utilizator găsit.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-b border-white/[0.06] hover:bg-white/[0.03]">
                      <td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs" title={u.email}>
                        {u.email}
                      </td>
                      <td className="px-3 py-2 text-xs">{u.displayName?.trim() ? u.displayName : "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={cn("text-[10px] font-normal capitalize", planBadgeClass(u.subscriptionPlan))}>
                          {PLAN_LABELS[u.subscriptionPlan] || u.subscriptionPlan}
                        </Badge>
                        {isExpiredPaid(u) ? (
                          <span className="ml-1 text-[10px] text-red-400">expirat</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {u.subscriptionPlan === "free" ? "—" : fmtRoDateOnly(u.planExpiresAt)}
                      </td>
                      <td className="px-3 py-2">
                        {u.role === "admin" ? (
                          <Badge className="text-[10px]">admin</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">user</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="border-violet-400/35 bg-violet-500/10 text-xs text-violet-100 hover:bg-violet-500/20"
                          onClick={() => openEdit(u)}
                        >
                          <Crown className="mr-1 h-3.5 w-3.5" />
                          Editează
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Pagina {page} / {totalPages} · {totalCount} rezultate
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Înapoi
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Înainte
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={(o) => !editSaving && setEditOpen(o)}>
        <DialogContent className="max-w-md border-white/12 sm:max-w-md" onPointerDownOutside={(e) => editSaving && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Editează utilizator</DialogTitle>
            <DialogDescription>Rol, plan și date afișate. Emailul nu poate fi schimbat aici.</DialogDescription>
          </DialogHeader>
          {editRow ? (
            <div className="grid gap-3 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input value={editRow.email} disabled className="border-white/10 bg-black/30 font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nume afișat</Label>
                <Input
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  placeholder="ex. Ion Popescu"
                  className="border-white/10 bg-black/20"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Rol</Label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-sm"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Plan abonament</Label>
                <select
                  value={formPlan}
                  onChange={(e) => setFormPlan(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-sm"
                >
                  {PLAN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Expiră la (opțional)</Label>
                <Input
                  type="date"
                  value={formExpires}
                  onChange={(e) => setFormExpires(e.target.value)}
                  disabled={formPlan === "free"}
                  className="border-white/10 bg-black/20"
                />
                <p className="text-[11px] text-muted-foreground">
                  {formPlan === "free"
                    ? "Planul Free nu folosește expirare în DB."
                    : "Lăsat gol = fără dată stocată (nu înseamnă neapărat „nelimitat” în afaceri)."}
                </p>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" disabled={editSaving} onClick={() => setEditOpen(false)}>
              Anulează
            </Button>
            <Button type="button" disabled={editSaving || !editRow} onClick={saveEdit}>
              {editSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvează
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
