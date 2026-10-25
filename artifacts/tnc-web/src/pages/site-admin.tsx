import { useEffect, useState } from "react";
import { Check, Clock3, LogOut, RefreshCw, Shield, ShieldOff, X } from "lucide-react";
import { useSiteAuth, type SiteAccessStatus } from "@/components/SiteAuthProvider";
import { customFetch } from "@/lib/api-client/custom-fetch";

type AdminAccessUser = SiteAccessStatus & {
  reviewedAt: string | null;
  reviewedBy: string | null;
  statusBeforeBlock: "pending" | "approved" | "denied";
};

const FILTERS = ["pending", "approved", "denied", "blocked", "all"] as const;
type Filter = (typeof FILTERS)[number];

export default function SiteAdminPage() {
  const { access, signOut } = useSiteAuth();
  const [filter, setFilter] = useState<Filter>("pending");
  const [users, setUsers] = useState<AdminAccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [durationHours, setDurationHours] = useState("24");
  const [permanent, setPermanent] = useState(false);
  const [busyId, setBusyId] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await customFetch<{ users: AdminAccessUser[] }>(`/api/admin/site-access?status=${filter}`);
      setUsers(response.users);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load access requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [filter]);

  async function updateUser(userId: string, action: "approve" | "deny" | "block" | "unblock") {
    setBusyId(userId);
    setError("");
    try {
      if (action === "approve" || action === "deny") {
        await customFetch(`/api/admin/site-access/${encodeURIComponent(userId)}/decision`, {
          method: "POST",
          body: JSON.stringify({ status: action === "approve" ? "approved" : "denied", reason }),
        });
      } else if (action === "block") {
        if (!reason.trim()) throw new Error("Add a reason before blocking this user.");
        await customFetch(`/api/admin/site-access/${encodeURIComponent(userId)}/block`, {
          method: "POST",
          body: JSON.stringify({ reason, durationHours: permanent ? null : Number(durationHours) }),
        });
      } else {
        await customFetch(`/api/admin/site-access/${encodeURIComponent(userId)}/unblock`, { method: "POST" });
      }
      setReason("");
      setSelectedId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "User access could not be updated.");
    } finally {
      setBusyId("");
    }
  }

  if (!access?.isAdmin) {
    return <main className="min-h-screen bg-slate-950 px-4 py-20 text-center text-white"><h1 className="text-xl font-black">Admin access required</h1><p className="mt-2 text-sm text-white/70">Sign in with the authorized Google account to manage site access.</p></main>;
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center bg-emerald-800 text-white"><Shield size={18} /></div><div><h1 className="font-black">Site access</h1><p className="text-xs text-slate-500">{access.email}</p></div></div>
        <div className="flex items-center gap-3"><button onClick={() => void refresh()} title="Refresh requests" aria-label="Refresh requests" className="p-2 text-slate-600 hover:bg-slate-100"><RefreshCw size={17} /></button><button onClick={() => void signOut()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><LogOut size={16} /> Sign out</button></div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-300 pb-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">Access management</p><h2 className="mt-1 text-2xl font-black">Google account requests</h2></div>
          <nav className="flex flex-wrap gap-1" aria-label="Filter users by access status">{FILTERS.map((status) => <button key={status} onClick={() => setFilter(status)} className={`border-b-2 px-3 py-2 text-sm font-semibold capitalize ${filter === status ? "border-emerald-800 text-emerald-900" : "border-transparent text-slate-500 hover:text-slate-900"}`}>{status}</button>)}</nav>
        </div>
        {error && <p className="mt-4 border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {loading ? <p className="py-12 text-center text-sm text-slate-500">Loading access requests...</p> : users.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">No {filter === "all" ? "users" : `${filter} requests`} found.</p> : (
          <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200 bg-white">
            {users.map((user) => <article key={user.userId} className="px-4 py-5 sm:px-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all font-bold">{user.email}</h3><span className={`px-2 py-1 text-xs font-bold uppercase ${user.status === "approved" ? "bg-emerald-100 text-emerald-800" : user.status === "denied" || user.status === "blocked" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{user.status}</span></div><p className="mt-1 text-xs text-slate-500">Requested {new Date(user.requestedAt).toLocaleString()}</p>{user.denialReason && <p className="mt-2 text-sm text-red-800">Denied: {user.denialReason}</p>}{user.blockedReason && <p className="mt-2 text-sm text-red-800">Block reason: {user.blockedReason}{user.blockedUntil ? ` · Until ${new Date(user.blockedUntil).toLocaleString()}` : " · Permanent"}</p>}</div>
                <div className="flex flex-wrap gap-2">{user.status !== "approved" && <button disabled={!!busyId} onClick={() => void updateUser(user.userId, "approve")} className="inline-flex items-center gap-1.5 bg-emerald-800 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-900 disabled:opacity-50"><Check size={14} /> Approve</button>}{user.status === "pending" && <button disabled={!!busyId} onClick={() => void updateUser(user.userId, "deny")} className="inline-flex items-center gap-1.5 border border-red-200 px-3 py-2 text-xs font-bold text-red-800 hover:bg-red-50 disabled:opacity-50"><X size={14} /> Deny</button>}{user.status === "blocked" ? <button disabled={!!busyId} onClick={() => void updateUser(user.userId, "unblock")} className="inline-flex items-center gap-1.5 border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"><ShieldOff size={14} /> Unblock</button> : <button disabled={!!busyId} onClick={() => { setSelectedId(selectedId === user.userId ? null : user.userId); setReason(""); }} className="inline-flex items-center gap-1.5 border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Clock3 size={14} /> Block</button>}</div>
              </div>
              {selectedId === user.userId && <form onSubmit={(event) => { event.preventDefault(); void updateUser(user.userId, "block"); }} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto_auto] sm:items-end">
                <label className="text-xs font-semibold text-slate-600">Reason<input required value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="mt-1 block w-full border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-700" /></label>
                <label className="text-xs font-semibold text-slate-600">Duration (hours)<input type="number" min="1" max="8760" disabled={permanent} value={durationHours} onChange={(event) => setDurationHours(event.target.value)} className="mt-1 block w-full border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-700 disabled:bg-slate-100" /></label>
                <label className="flex items-center gap-2 py-2 text-sm text-slate-700"><input type="checkbox" checked={permanent} onChange={(event) => setPermanent(event.target.checked)} /> Permanent</label>
                <button type="submit" disabled={!!busyId} className="bg-red-800 px-4 py-2 text-sm font-bold text-white hover:bg-red-900 disabled:opacity-50">Confirm block</button>
              </form>}
            </article>)}
          </div>
        )}
      </div>
    </main>
  );
}