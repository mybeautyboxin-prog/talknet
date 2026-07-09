import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, Copy, Check, Trash2, Radio, Users2, Plus } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { TID } from "@/lib/testIds";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function AdminDashboard() {
  const [rooms, setRooms] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState(null);

  // Add room dialog
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);

  // Add member dialog
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [memberForm, setMemberForm] = useState({ name: "", email: "", password: "" });
  const [creatingMember, setCreatingMember] = useState(false);

  // Confirm-delete dialogs
  const [roomToDelete, setRoomToDelete] = useState(null);
  const [memberToRemove, setMemberToRemove] = useState(null);

  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const [r, m] = await Promise.all([api.get("/admin/rooms"), api.get("/admin/members")]);
      setRooms(r.data.rooms);
      setMembers(m.data.members);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const submitCreateRoom = async (e) => {
    e.preventDefault();
    setCreatingRoom(true);
    try {
      await api.post("/admin/rooms", { name: newRoomName });
      toast.success(`Room "${newRoomName}" created`);
      setRoomDialogOpen(false); setNewRoomName("");
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setCreatingRoom(false); }
  };

  const submitAddMember = async (e) => {
    e.preventDefault();
    setCreatingMember(true);
    try {
      await api.post("/admin/members", memberForm);
      toast.success(`${memberForm.name} added`);
      setMemberDialogOpen(false);
      setMemberForm({ name: "", email: "", password: "" });
      load();
    } catch (err) { toast.error(formatApiError(err)); }
    finally { setCreatingMember(false); }
  };

  const doDeleteRoom = async () => {
    if (!roomToDelete) return;
    try {
      await api.delete(`/admin/rooms/${roomToDelete.id}`);
      toast.success("Room deleted");
      setRoomToDelete(null);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const doRemoveMember = async () => {
    if (!memberToRemove) return;
    try {
      await api.delete(`/admin/members/${memberToRemove.id}`);
      toast.success("Member removed");
      setMemberToRemove(null);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const copyCode = async (code, id) => {
    await navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (loading) return <AppLayout><div className="p-12 text-sm text-[#666]">Loading…</div></AppLayout>;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-8 py-10">
        {/* Rooms */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <div className="text-[11px] tracking-widest uppercase text-[#666] mb-2">Your Rooms</div>
            <h1 className="text-4xl font-extrabold tracking-tight">Channels</h1>
            <p className="text-sm text-[#666] mt-2">Create multiple audio channels. Each has its own shareable code.</p>
          </div>
          <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid={TID.adminAddRoomBtn} className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] h-11 px-5 rounded-md">
                <Plus className="w-4 h-4 mr-1.5" strokeWidth={2} /> New room
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-md bg-white border-[#E8E8E3]">
              <DialogHeader>
                <DialogTitle className="font-extrabold tracking-tight">Create a room</DialogTitle>
                <DialogDescription className="text-[#666]">A new audio channel with its own room code.</DialogDescription>
              </DialogHeader>
              <form onSubmit={submitCreateRoom} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Room name</Label>
                  <Input required minLength={2} data-testid={TID.newRoomNameInput} value={newRoomName} onChange={(e) => setNewRoomName(e.target.value)} className="h-10 rounded-md border-[#E8E8E3]" />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={creatingRoom} data-testid={TID.newRoomSubmit} className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] rounded-md h-10">
                    {creatingRoom ? "Creating…" : "Create room"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12" data-testid={TID.adminRoomList}>
          {rooms.map((r) => (
            <div key={r.id} data-testid={`${TID.adminRoomCardPrefix}${r.id}`} className="border border-[#E8E8E3] bg-white rounded-md p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div className="w-9 h-9 rounded-md bg-[#F2F2F0] flex items-center justify-center">
                  <Radio className="w-4 h-4 text-[#3A4F41]" strokeWidth={1.5} />
                </div>
                <button
                  data-testid={`${TID.adminRoomCopyPrefix}${r.id}`}
                  onClick={() => copyCode(r.room_code, r.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-mono border border-[#E8E8E3] rounded-sm px-2 py-1 hover:bg-[#FAFAF7]"
                >
                  {r.room_code}
                  {copiedId === r.id ? <Check className="w-3 h-3 text-[#4C7D5B]" /> : <Copy className="w-3 h-3 text-[#666]" />}
                </button>
              </div>
              <div>
                <div className="font-bold text-lg tracking-tight">{r.name}</div>
                <div className="text-xs text-[#666] mt-1">Max {r.max_participants} live</div>
              </div>
              <div className="mt-auto flex gap-2">
                <Button
                  data-testid={`${TID.adminRoomEnterPrefix}${r.id}`}
                  onClick={() => navigate(`/room?id=${r.id}`)}
                  className="flex-1 bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] rounded-md h-9"
                >
                  Enter
                </Button>
                <Button
                  data-testid={`${TID.adminRoomDeletePrefix}${r.id}`}
                  variant="outline"
                  onClick={() => setRoomToDelete(r)}
                  className="rounded-md border-[#E8E8E3] hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C] h-9"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Members */}
        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="text-[11px] tracking-widest uppercase text-[#666] mb-1">Members</div>
            <h2 className="text-2xl font-extrabold tracking-tight">People with access</h2>
            <p className="text-xs text-[#666] mt-1">{members.length}/15 members. Anyone here can join any of your rooms.</p>
          </div>
          <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid={TID.adminAddMemberBtn} className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] h-11 px-5 rounded-md">
                <UserPlus className="w-4 h-4 mr-1.5" /> Add member
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-md bg-white border-[#E8E8E3]">
              <DialogHeader>
                <DialogTitle className="font-extrabold tracking-tight">Add a member</DialogTitle>
                <DialogDescription className="text-[#666]">They'll be able to sign in and join any of your rooms.</DialogDescription>
              </DialogHeader>
              <form onSubmit={submitAddMember} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Full name</Label>
                  <Input required data-testid={TID.memberNameInput} value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} className="h-10 rounded-md border-[#E8E8E3]" />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" required data-testid={TID.memberEmailInput} value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} className="h-10 rounded-md border-[#E8E8E3]" />
                </div>
                <div className="space-y-1.5">
                  <Label>Temporary password</Label>
                  <Input type="text" required minLength={6} data-testid={TID.memberPasswordInput} value={memberForm.password} onChange={(e) => setMemberForm({ ...memberForm, password: e.target.value })} className="h-10 rounded-md border-[#E8E8E3] font-mono" />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={creatingMember} data-testid={TID.memberCreateSubmit} className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] rounded-md h-10">
                    {creatingMember ? "Adding…" : "Add member"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="border border-[#E8E8E3] bg-white rounded-md overflow-hidden" data-testid={TID.adminMemberList}>
          {members.length === 0 ? (
            <div className="p-16 text-center">
              <Users2 className="w-8 h-8 mx-auto text-[#3A4F41] mb-3" strokeWidth={1.25} />
              <div className="font-bold text-lg tracking-tight">No members yet</div>
              <div className="text-sm text-[#666] mt-1">Add up to 15 people who can join your rooms.</div>
            </div>
          ) : members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-6 py-4 border-b border-[#E8E8E3] last:border-b-0 hover:bg-[#FAFAF7]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-[#F2F2F0] flex items-center justify-center text-sm font-bold text-[#111]">
                  {m.name.split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase()}
                </div>
                <div>
                  <div className="font-semibold text-sm">{m.name}</div>
                  <div className="text-xs text-[#666] font-mono">{m.email}</div>
                </div>
              </div>
              <Button
                data-testid={`${TID.memberRemovePrefix}${m.id}`}
                variant="outline"
                size="sm"
                onClick={() => setMemberToRemove(m)}
                className="h-8 rounded-md border-[#E8E8E3] hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]"
              >
                <Trash2 className="w-3 h-3 mr-1" strokeWidth={2} /> Remove
              </Button>
            </div>
          ))}
        </div>
      </div>

      {/* Confirm dialogs */}
      <AlertDialog open={!!roomToDelete} onOpenChange={(o) => !o && setRoomToDelete(null)}>
        <AlertDialogContent className="bg-white border-[#E8E8E3] rounded-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-extrabold tracking-tight">Delete room "{roomToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#666]">
              This channel will be permanently removed. Members cannot join it after this. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid={TID.adminRoomDeleteConfirm}
              onClick={doDeleteRoom}
              className="rounded-md bg-[#C84C4C] hover:bg-[#a63c3c] text-white"
            >
              Delete room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!memberToRemove} onOpenChange={(o) => !o && setMemberToRemove(null)}>
        <AlertDialogContent className="bg-white border-[#E8E8E3] rounded-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-extrabold tracking-tight">Remove {memberToRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#666]">
              They will lose access to all your rooms. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid={TID.memberRemoveConfirm}
              onClick={doRemoveMember}
              className="rounded-md bg-[#C84C4C] hover:bg-[#a63c3c] text-white"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
