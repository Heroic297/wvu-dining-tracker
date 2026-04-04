/**
 * Invite Management — owner only.
 * Only visible/accessible when logged in as owengidusko@gmail.com.
 * Allows generating per-person invite codes and revoking/deleting them.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, Plus, Trash2, Ban, Check, RefreshCw, Key } from "lucide-react";

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

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-sm text-slate-500">Access restricted to the app owner.</p>
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

  const getStatus = (c: InviteCode) => {
    if (!c.active) return "revoked" as const;
    const exhausted = c.maxUses !== null && c.usedCount >= c.maxUses;
    if (exhausted) return "used" as const;
    return "unused" as const;
  };

  const CodeCard = ({ c }: { c: InviteCode }) => {
    const status = getStatus(c);
    const isUsable = status === "unused";

    return (
      <div
        className={`rounded-2xl bg-slate-900 border border-slate-800/60 p-5 transition-all duration-200 hover:border-slate-700 ${
          !isUsable ? "opacity-60" : ""
        }`}
        data-testid={`invite-row-${c.id}`}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-lg text-slate-100 tracking-wider">{c.code}</span>
          <div className="flex items-center gap-2">
            {/* Status badge */}
            {status === "unused" && (
              <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Unused
              </span>
            )}
            {status === "used" && (
              <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-700 text-slate-500 border border-slate-700">
                Used
              </span>
            )}
            {status === "revoked" && (
              <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                Revoked
              </span>
            )}
            {/* Copy button — only for usable codes */}
            {isUsable && (
              <button
                onClick={() => copyCode(c.code, c.id)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all duration-200"
                title="Copy code"
                data-testid={`button-copy-${c.id}`}
              >
                {copiedId === c.id ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Label */}
        {c.label && (
          <p className="text-xs text-slate-400 mb-2">{c.label}</p>
        )}

        {/* Footer: date, uses, actions */}
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">
            <span>Created {formatDate(c.createdAt)}</span>
            <span className="mx-1.5">·</span>
            <span>{c.usedCount} / {c.maxUses ?? "∞"} uses</span>
          </div>
          <div className="flex items-center gap-1">
            {c.active && (
              <button
                onClick={() => revokeMutation.mutate(c.id)}
                disabled={revokeMutation.isPending}
                className="p-1.5 rounded-lg text-slate-600 hover:text-yellow-400 hover:bg-slate-800 transition-all duration-200"
                title="Revoke code"
                data-testid={`button-revoke-${c.id}`}
              >
                <Ban className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => deleteMutation.mutate(c.id)}
              disabled={deleteMutation.isPending}
              className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-slate-800 transition-all duration-200"
              title="Delete code"
              data-testid={`button-delete-invite-${c.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-24">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">
        <h1 className="text-xl font-semibold text-slate-100">Invite Codes</h1>

        {/* Generate New Code — primary action */}
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold py-3.5 w-full transition-colors duration-200 flex items-center justify-center gap-2 disabled:opacity-60"
          data-testid="button-create-invite"
        >
          {createMutation.isPending ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          Generate New Code
        </button>

        {/* Optional label and max uses inputs */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800/60 p-4 space-y-3">
          <p className="text-sm font-medium text-slate-300">Code options</p>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Person's name or note (optional)</Label>
              <Input
                placeholder="e.g. John Smith"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-600"
                data-testid="input-invite-label"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">Max uses</Label>
              <Input
                type="number"
                min="1"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="bg-slate-800 border-slate-700 text-slate-100 w-24"
                data-testid="input-invite-max-uses"
              />
            </div>
          </div>
          <p className="text-xs text-slate-600">
            Default is 1 use — enough for one person to register.
          </p>
        </div>

        {/* Code list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 text-slate-600 animate-spin" />
          </div>
        ) : codes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Key className="w-10 h-10 text-slate-700 mb-3" />
            <p className="text-slate-400 font-medium">No invite codes yet</p>
            <p className="text-xs text-slate-600 mt-1">Generate a code to invite someone</p>
          </div>
        ) : (
          <>
            {activeCodes.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Active ({activeCodes.length})
                </p>
                {activeCodes.map((c) => <CodeCard key={c.id} c={c} />)}
              </div>
            )}

            {inactiveCodes.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Revoked / used up ({inactiveCodes.length})
                </p>
                {inactiveCodes.map((c) => <CodeCard key={c.id} c={c} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
