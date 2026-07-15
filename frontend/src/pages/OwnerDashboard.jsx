import React, { useEffect, useState } from "react";
import { Plus, Radio, Trash2, Pause, Play, Copy, Check, TrendingUp } from "lucide-react";
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
  const [rooms, setRooms] = useState([]);
  const [stats, setStats] = useState({ total_rooms: 0, active_rooms: 0, total_admins: 0, total_users: 0 });
  const [analytics, setAnalytics] = useState({ daily: [], top_rooms: [], total_sessions: 0, total_minutes: 0 });
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [roomToDelete, setRoomToDelete] = useState(null);

  const [form, setForm] = useState({ room_name: "", admin_name: "", admin_email: "", admin_password: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [r, s, a] = await Promise.all([
        api.get("/platform/rooms"),
        api.get("/platform/stats"),
        api.get("/platform/analytics?days=14"),
      ]);
      setRooms(r.data.rooms);
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
      await api.post("/platform/rooms", form);
      toast.success(`Room "${form.room_name}" provisioned`);
      setDialogOpen(false);
      setForm({ room_name: "", admin_name: "", admin_email: "", admin_password: "" });
      loadAll();
    } catch (err) {
      const msg = formatApiError(err); setError(msg); toast.error(msg);
    } finally { setCreating(false); }
  };

  const toggleStatus = async (r) => {
    const next = r.status === "active" ? "suspended" : "active";
    try {
      await api.patch(`/platform/rooms/${r.id}`, { status: next });
      toast.success(`Room ${next}`);
      loadAll();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const doDelete = async () => {
    if (!roomToDelete) return;
    try {
      await api.delete(`/platform/rooms/${roomToDelete.id}`);
      toast.success("Room deleted");
      setRoomToDelete(null);
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
            <h1 className="text-4xl font-extrabold tracking-tight">Rooms</h1>
            <p className="text-sm text-[#666666] mt-2 max-w-lg">
              Each room is provisioned with one Room Admin. The admin manages that room only. Room admins cannot create or see any other rooms.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid={TID.ownerNewRoomBtn} className="bg-[#3A4F41] hover:bg-[#2f4136] rounded-md h-11 px-5 text-[#FCFCFB]">
                <Plus className="w-4 h-4 mr-1.5" strokeWidth={2} /> Provision Room
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-md bg-white border-[#E8E8E3]">
              <DialogHeader>
                <DialogTitle className="font-extrabold tracking-tight">Provision a new room</DialogTitle>
                <DialogDescription className="text-[#666]">Creates the room and its Room Admin in one step.</DialogDescription>
              </DialogHeader>
              <form onSubmit={submitCreate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Room name</Label>
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
                  <Button type="submit" disabled={creating} data-testid={TID.createRoomSubmit} className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] rounded-md h-10">
                    {creating ? "Provisioning…" : "Provision room"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <Stat label="Total rooms" value={stats.total_rooms} testId={TID.ownerStatTotal} />
          <Stat label="Active" value={stats.active_rooms} testId={TID.ownerStatActive} />
          <Stat label="Room admins" value={stats.total_admins} testId={TID.ownerStatAdmins} />
          <Stat label="End users" value={stats.total_users} testId={TID.ownerStatUsers} />
        </div>

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
          {analytics.top_rooms?.length > 0 && (
            <div className="mt-6 border-t border-[#E8E8E3] pt-4">
              <div className="text-[11px] tracking-widest uppercase text-[#666] mb-3">Top rooms by minutes</div>
              <div className="space-y-2">
                {analytics.top_rooms.map((t) => (
                  <div key={t.room_id} className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{t.room_name}</span>
                    <span className="font-mono text-[#666]">{t.minutes} min · {t.sessions} sessions</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border border-[#E8E8E3] bg-white rounded-md overflow-hidden" data-testid={TID.ownerRoomList}>
          <div className="grid grid-cols-12 px-6 py-3 text-[11px] tracking-widest uppercase text-[#666] border-b border-[#E8E8E3] bg-[#FAFAF7]">
            <div className="col-span-3">Room</div>
            <div className="col-span-3">Room admin</div>
            <div className="col-span-2">Code</div>
            <div className="col-span-2">Users</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-[#666]">Loading rooms…</div>
          ) : rooms.length === 0 ? (
            <div className="p-16 text-center">
              <Radio className="w-8 h-8 mx-auto text-[#3A4F41] mb-3" strokeWidth={1.25} />
              <div className="font-bold text-lg tracking-tight">No rooms yet</div>
              <div className="text-sm text-[#666] mt-1">Provision your first room to get started.</div>
            </div>
          ) : rooms.map((r) => (
            <div key={r.id} data-testid={`${TID.roomRowPrefix}${r.id}`} className="grid grid-cols-12 items-center px-6 py-4 border-b border-[#E8E8E3] last:border-b-0 hover:bg-[#FAFAF7]">
              <div className="col-span-3">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-[#666] mt-0.5">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${r.status === "active" ? "bg-[#4C7D5B]" : "bg-[#C84C4C]"}`} />
                  {r.status}
                </div>
              </div>
              <div className="col-span-3 text-sm">
                <div>{r.admin?.name || <span className="text-[#666] italic">unassigned</span>}</div>
                <div className="text-xs text-[#666] font-mono">{r.admin?.email}</div>
              </div>
              <div className="col-span-2">
                <button onClick={() => copyCode(r.room_code, r.id)} className="inline-flex items-center gap-1.5 text-xs font-mono border border-[#E8E8E3] rounded-sm px-2 py-1 hover:bg-white">
                  {r.room_code}
                  {copiedId === r.id ? <Check className="w-3 h-3 text-[#4C7D5B]" /> : <Copy className="w-3 h-3 text-[#666]" />}
                </button>
              </div>
              <div className="col-span-2 text-sm font-mono">{r.member_count}/15</div>
              <div className="col-span-2 flex justify-end gap-1.5">
                <Button data-testid={`${TID.roomSuspendPrefix}${r.id}`} size="sm" variant="outline" onClick={() => toggleStatus(r)} className="h-8 rounded-md border-[#E8E8E3]">
                  {r.status === "active" ? <><Pause className="w-3 h-3 mr-1" strokeWidth={2} /> Suspend</> : <><Play className="w-3 h-3 mr-1" strokeWidth={2} /> Resume</>}
                </Button>
                <Button data-testid={`${TID.roomDeletePrefix}${r.id}`} size="sm" variant="outline" onClick={() => setRoomToDelete(r)} className="h-8 rounded-md border-[#E8E8E3] hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]">
                  <Trash2 className="w-3 h-3" strokeWidth={2} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <AlertDialog open={!!roomToDelete} onOpenChange={(o) => !o && setRoomToDelete(null)}>
        <AlertDialogContent className="bg-white border-[#E8E8E3] rounded-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-extrabold tracking-tight">Delete "{roomToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#666]">
              This removes the room, its Room Admin, all its users, and all its session history. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid={TID.roomDeleteConfirm} onClick={doDelete} className="rounded-md bg-[#C84C4C] hover:bg-[#a63c3c] text-white">
              Delete room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
