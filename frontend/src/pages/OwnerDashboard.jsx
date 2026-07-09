import React, { useEffect, useState } from "react";
import { Plus, Building2, Trash2, Pause, Play, Copy, Check, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api, formatApiError } from "@/lib/api";
import { TID } from "@/lib/testIds";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const Stat = ({ label, value, testId }) => (
  <div className="border border-[#E8E8E3] bg-white rounded-md p-6">
    <div className="text-[11px] tracking-widest uppercase text-[#666666]">{label}</div>
    <div data-testid={testId} className="mt-2 font-extrabold text-3xl tracking-tight">{value}</div>
  </div>
);

export default function OwnerDashboard() {
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState({ total_customers: 0, active_customers: 0, total_users: 0, total_admins: 0, total_rooms: 0 });
  const [analytics, setAnalytics] = useState({ daily: [], top_customers: [], total_sessions: 0, total_minutes: 0 });
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [customerToDelete, setCustomerToDelete] = useState(null);

  const [form, setForm] = useState({ customer_name: "", admin_name: "", admin_email: "", admin_password: "", room_name: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [c, s, a] = await Promise.all([
        api.get("/platform/customers"),
        api.get("/platform/stats"),
        api.get("/platform/analytics?days=14"),
      ]);
      setCustomers(c.data.customers);
      setStats(s.data);
      setAnalytics(a.data);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  const submitCreate = async (e) => {
    e.preventDefault();
    setError(""); setCreating(true);
    try {
      await api.post("/platform/customers", form);
      toast.success(`Customer "${form.customer_name}" created`);
      setDialogOpen(false);
      setForm({ customer_name: "", admin_name: "", admin_email: "", admin_password: "", room_name: "" });
      loadAll();
    } catch (err) {
      const msg = formatApiError(err); setError(msg); toast.error(msg);
    } finally { setCreating(false); }
  };

  const toggleStatus = async (c) => {
    const next = c.status === "active" ? "suspended" : "active";
    try {
      await api.patch(`/platform/customers/${c.id}`, { status: next });
      toast.success(`Customer ${next}`);
      loadAll();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const doDelete = async () => {
    if (!customerToDelete) return;
    try {
      await api.delete(`/platform/customers/${customerToDelete.id}`);
      toast.success("Customer deleted");
      setCustomerToDelete(null);
      loadAll();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const copyCode = async (code, id) => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-8 py-10">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <div>
            <div className="text-[11px] tracking-widest uppercase text-[#666666] mb-2">Platform Console</div>
            <h1 className="text-4xl font-extrabold tracking-tight">Customers</h1>
            <p className="text-sm text-[#666666] mt-2 max-w-lg">
              Each customer is provisioned with one room admin and one default room. Admins can add more channels.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid={TID.ownerNewCustomerBtn} className="bg-[#3A4F41] hover:bg-[#2f4136] rounded-md h-11 px-5 text-[#FCFCFB]">
                <Plus className="w-4 h-4 mr-1.5" strokeWidth={2} /> New Customer
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-md bg-white border-[#E8E8E3]">
              <DialogHeader>
                <DialogTitle className="font-extrabold tracking-tight">Provision a new customer</DialogTitle>
                <DialogDescription className="text-[#666]">Creates the customer, a room admin, and a default room.</DialogDescription>
              </DialogHeader>
              <form onSubmit={submitCreate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Customer name</Label>
                  <Input required data-testid={TID.customerNameInput} value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} className="h-10 rounded-md border-[#E8E8E3]" />
                </div>
                <div className="space-y-1.5">
                  <Label>Default room name</Label>
                  <Input required data-testid={TID.roomNameInput} value={form.room_name} onChange={(e) => setForm({ ...form, room_name: e.target.value })} className="h-10 rounded-md border-[#E8E8E3]" />
                </div>
                <div className="border-t border-[#E8E8E3] pt-4 space-y-4">
                  <div className="text-[11px] tracking-widest uppercase text-[#666]">Room admin</div>
                  <div className="space-y-1.5">
                    <Label>Full name</Label>
                    <Input required data-testid={TID.adminNameInput} value={form.admin_name} onChange={(e) => setForm({ ...form, admin_name: e.target.value })} className="h-10 rounded-md border-[#E8E8E3]" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input type="email" required data-testid={TID.adminEmailInput} value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} className="h-10 rounded-md border-[#E8E8E3]" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Temporary password</Label>
                    <Input type="text" required minLength={6} data-testid={TID.adminPasswordInput} value={form.admin_password} onChange={(e) => setForm({ ...form, admin_password: e.target.value })} className="h-10 rounded-md border-[#E8E8E3] font-mono" />
                  </div>
                </div>
                {error && <div className="text-sm text-[#C84C4C] border-l-2 border-[#C84C4C] pl-3">{error}</div>}
                <DialogFooter>
                  <Button type="submit" disabled={creating} data-testid={TID.createCustomerSubmit} className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] rounded-md h-10">
                    {creating ? "Creating…" : "Create customer"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
          <Stat label="Customers" value={stats.total_customers} testId={TID.ownerStatTotal} />
          <Stat label="Active" value={stats.active_customers} testId={TID.ownerStatActive} />
          <Stat label="Rooms" value={stats.total_rooms} testId={TID.ownerStatRooms} />
          <Stat label="Admins" value={stats.total_admins} />
          <Stat label="End users" value={stats.total_users} testId={TID.ownerStatUsers} />
        </div>

        {/* Analytics */}
        <div className="border border-[#E8E8E3] bg-white rounded-md p-6 mb-10" data-testid={TID.ownerAnalyticsSection}>
          <div className="flex items-end justify-between mb-6">
            <div>
              <div className="text-[11px] tracking-widest uppercase text-[#666] mb-1">Last 14 days</div>
              <h2 className="text-xl font-extrabold tracking-tight flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#3A4F41]" strokeWidth={1.75} /> Usage
              </h2>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-[11px] tracking-widest uppercase text-[#666]">Sessions</div>
                <div className="font-extrabold text-2xl tracking-tight">{analytics.total_sessions}</div>
              </div>
              <div>
                <div className="text-[11px] tracking-widest uppercase text-[#666]">Minutes</div>
                <div className="font-extrabold text-2xl tracking-tight">{analytics.total_minutes}</div>
              </div>
            </div>
          </div>
          <div className="h-48">
            {analytics.daily.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[#666] border border-dashed border-[#E8E8E3] rounded-md">
                No sessions yet — analytics will fill once people start using rooms.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={analytics.daily}>
                  <CartesianGrid stroke="#E8E8E3" strokeDasharray="0" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#666" }} axisLine={{ stroke: "#E8E8E3" }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#666" }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={{ background: "#fff", border: "1px solid #E8E8E3", borderRadius: 6, fontSize: 12 }} />
                  <Line type="monotone" dataKey="minutes" stroke="#3A4F41" strokeWidth={2} dot={{ fill: "#3A4F41", r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          {analytics.top_customers.length > 0 && (
            <div className="mt-6 border-t border-[#E8E8E3] pt-4">
              <div className="text-[11px] tracking-widest uppercase text-[#666] mb-3">Top customers by minutes</div>
              <div className="space-y-2">
                {analytics.top_customers.map((t) => (
                  <div key={t.customer_id} className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{t.customer_name}</span>
                    <span className="font-mono text-[#666]">{t.minutes} min · {t.sessions} sessions</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Customer list */}
        <div className="border border-[#E8E8E3] bg-white rounded-md overflow-hidden" data-testid={TID.ownerCustomerList}>
          <div className="grid grid-cols-12 px-6 py-3 text-[11px] tracking-widest uppercase text-[#666] border-b border-[#E8E8E3] bg-[#FAFAF7]">
            <div className="col-span-4">Customer</div>
            <div className="col-span-3">Room admin</div>
            <div className="col-span-2">Default code</div>
            <div className="col-span-1">Rooms</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[#666]">Loading customers…</div>
          ) : customers.length === 0 ? (
            <div className="p-16 text-center">
              <Building2 className="w-8 h-8 mx-auto text-[#3A4F41] mb-3" strokeWidth={1.25} />
              <div className="font-bold text-lg tracking-tight">No customers yet</div>
              <div className="text-sm text-[#666] mt-1">Create your first customer to get started.</div>
            </div>
          ) : customers.map((c) => (
            <div key={c.id} data-testid={`${TID.customerRowPrefix}${c.id}`} className="grid grid-cols-12 items-center px-6 py-4 border-b border-[#E8E8E3] last:border-b-0 hover:bg-[#FAFAF7]">
              <div className="col-span-4">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-[#666] mt-0.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${c.status === "active" ? "bg-[#4C7D5B]" : "bg-[#C84C4C]"}`} />
                  {c.status} · {c.member_count}/15 users
                </div>
              </div>
              <div className="col-span-3 text-sm">
                <div>{c.admin?.name}</div>
                <div className="text-xs text-[#666] font-mono">{c.admin?.email}</div>
              </div>
              <div className="col-span-2">
                {c.default_room && (
                  <button onClick={() => copyCode(c.default_room.room_code, c.id)} className="inline-flex items-center gap-1.5 text-xs font-mono border border-[#E8E8E3] rounded-sm px-2 py-1 hover:bg-white">
                    {c.default_room.room_code}
                    {copiedId === c.id ? <Check className="w-3 h-3 text-[#4C7D5B]" /> : <Copy className="w-3 h-3 text-[#666]" />}
                  </button>
                )}
              </div>
              <div className="col-span-1 text-sm font-mono">{c.room_count}</div>
              <div className="col-span-2 flex justify-end gap-1.5">
                <Button data-testid={`${TID.customerSuspendPrefix}${c.id}`} size="sm" variant="outline" onClick={() => toggleStatus(c)} className="h-8 rounded-md border-[#E8E8E3]">
                  {c.status === "active" ? <><Pause className="w-3 h-3 mr-1" strokeWidth={2} /> Suspend</> : <><Play className="w-3 h-3 mr-1" strokeWidth={2} /> Resume</>}
                </Button>
                <Button data-testid={`${TID.customerDeletePrefix}${c.id}`} size="sm" variant="outline" onClick={() => setCustomerToDelete(c)} className="h-8 rounded-md border-[#E8E8E3] hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]">
                  <Trash2 className="w-3 h-3" strokeWidth={2} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AlertDialog open={!!customerToDelete} onOpenChange={(o) => !o && setCustomerToDelete(null)}>
        <AlertDialogContent className="bg-white border-[#E8E8E3] rounded-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-extrabold tracking-tight">Delete "{customerToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#666]">
              This removes the customer, its room admin, all end users, all rooms, and all session history. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid={TID.customerDeleteConfirm} onClick={doDelete} className="rounded-md bg-[#C84C4C] hover:bg-[#a63c3c] text-white">
              Delete customer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
