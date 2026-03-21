/**
 * Invite Management — owner only.
 * Only visible/accessible when logged in as owengidusko@gmail.com.
 * Allows generating per-person invite codes and revoking/deleting them.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, Plus, Trash2, Ban, Check, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const OWNER_EMAIL = "owengidusko@gmail.com";

interface InviteCode {
  id: string;
  code: string;
  label: string | null;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  createdAt: string;
}

export default function InvitePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Guard — shouldn't normally be reachable, but just in case
  if (user?.email !== OWNER_EMAIL) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Access restricted to the app owner.
      </div>
    );
  }

  const { data: codes = [], isLoading } = useQuery<InviteCode[]>({
    queryKey: ["/api/admin/invites"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/invites");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (label.trim()) body.label = label.trim();
      const n = parseInt(maxUses, 10);
      body.maxUses = !isNaN(n) && n > 0 ? n : 1;
      const res = await apiRequest("POST", "/api/admin/invites", body);
      if (!res.ok) throw new Error("Failed to create");
      return res.json() as Promise<InviteCode>;
    },
    onSuccess: (newCode) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invites"] });
      setLabel("");
      setMaxUses("1");
      toast({ title: `Code created: ${newCode.code}` });
    },
    onError: () => toast({ title: "Failed to create code", variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/admin/invites/${id}/revoke`);
      if (!res.ok) throw new Error("Failed to revoke");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invites"] });
      toast({ title: "Code revoked" });
    },
    onError: () => toast({ title: "Failed to revoke", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/invites/${id}`);
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/invites"] });
      toast({ title: "Code deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: `Copied: ${code}` });
    });
  };

  const activeCodes   = codes.filter((c) => c.active);
  const inactiveCodes = codes.filter((c) => !c.active);

  const CodeRow = ({ c }: { c: InviteCode }) => {
    const exhausted = c.maxUses !== null && c.usedCount >= c.maxUses;
    const statusColor = !c.active
      ? "bg-destructive/10 text-destructive"
      : exhausted
      ? "bg-muted text-muted-foreground"
      : "bg-emerald-500/10 text-emerald-400";
    const statusLabel = !c.active ? "Revoked" : exhausted ? "Used up" : "Active";

    return (
      <div
        className="border border-border rounded-xl p-3 space-y-2"
        data-testid={`invite-row-${c.id}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Code + copy */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-bold tracking-widest text-foreground">
                {c.code}
              </span>
              <button
                onClick={() => copyCode(c.code, c.id)}
                className="text-muted-foreground hover:text-primary transition-colors"
                title="Copy code"
                data-testid={`button-copy-${c.id}`}
              >
                {copiedId === c.id
                  ? <Check className="w-3.5 h-3.5 text-primary" />
                  : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            {/* Label */}
            {c.label && (
              <p className="text-xs text-muted-foreground mt-0.5">{c.label}</p>
            )}
          </div>
          {/* Status badge */}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        {/* Uses + actions */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {c.usedCount} / {c.maxUses ?? "∞"} uses
          </p>
          <div className="flex items-center gap-1">
            {c.active && (
              <button
                onClick={() => revokeMutation.mutate(c.id)}
                disabled={revokeMutation.isPending}
                className="text-muted-foreground hover:text-yellow-400 transition-colors p-1"
                title="Revoke code"
                data-testid={`button-revoke-${c.id}`}
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => deleteMutation.mutate(c.id)}
              disabled={deleteMutation.isPending}
              className="text-muted-foreground hover:text-destructive transition-colors p-1"
              title="Delete code"
              data-testid={`button-delete-invite-${c.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-lg space-y-6">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Invite codes</h1>
      </div>

      {/* Create new code */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold">Generate a new code</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Person's name or note (optional)</Label>
            <Input
              placeholder="e.g. John Smith"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              data-testid="input-invite-label"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max uses</Label>
            <Input
              type="number"
              min="1"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              data-testid="input-invite-max-uses"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="w-full"
              data-testid="button-create-invite"
            >
              {createMutation.isPending
                ? <RefreshCw className="w-4 h-4 animate-spin mr-1.5" />
                : <Plus className="w-4 h-4 mr-1.5" />}
              Generate
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Default is 1 use — enough for one person to register. Set higher if sharing the same code with multiple people.
        </p>
      </div>

      {/* Active codes */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : (
        <>
          {activeCodes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Active ({activeCodes.length})
              </p>
              {activeCodes.map((c) => <CodeRow key={c.id} c={c} />)}
            </div>
          )}

          {activeCodes.length === 0 && (
            <div className="bg-card border border-border rounded-xl p-6 text-center text-sm text-muted-foreground">
              No active codes. Generate one above to invite someone.
            </div>
          )}

          {inactiveCodes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Revoked / used up ({inactiveCodes.length})
              </p>
              {inactiveCodes.map((c) => <CodeRow key={c.id} c={c} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
