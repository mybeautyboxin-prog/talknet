import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus, Copy, Check, Trash2, Radio, Users2 } from "lucide-react";
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
  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [memberForm, setMemberForm] = useState({ name: "", email: "", password: "" });
  const [creatingMember, setCreatingMember] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState(null);

  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const [r, m] = await Promise.all([api.get("/admin/room"), api.get("/admin/members")]);
      setRoom(r.data);
      setMembers(m.data.members);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

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

  const doRemoveMember = async () => {
    if (!memberToRemove) return;
    try {
      await api.delete(`/admin/members/${memberToRemove.id}`);
      toast.success("Member removed");
      setMemberToRemove(null);
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const copyCode = async () => {
    if (!room) return;
    await navigator.clipboard.writeText(room.room_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) return <AppLayout><div className="p-12 text-sm text-[#666]">Loading…</div></AppLayout>;
  if (!room) return <AppLayout><div className="p-12 text-sm text-[#666]">You have no assigned room. Please contact the platform owner.</div></AppLayout>;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <div className="border border-[#E8E8E3] bg-white rounded-md p-8 mb-10">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <div className="text-[11px] tracking-widest uppercase text-[#666] mb-2">Your Room</div>
              <h1 data-testid={TID.adminRoomName} className="text-4xl font-extrabold tracking-tight">{room.name}</h1>
              <div className="mt-4 flex items-center gap-4 text-sm text-[#666]">
                <span className="inline-flex items-center gap-1.5"><Users2 className="w-4 h-4" strokeWidth={1.5} /> {members.length}/15 members</span>
                <span>·</span>
                <span>Max {room.max_participants} concurrent</span>
                <span>·</span>
                <span>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${room.status === "active" ? "bg-[#4C7D5B]" : "bg-[#C84C4C]"}`} />
                  {room.status}
                </span>
              </div>
              <div className="mt-6 flex items-center gap-3">
                <div className="border border-[#E8E8E3] rounded-md px-4 py-3 bg-[#FAFAF7]">
                  <div className="text-[10px] tracking-widest uppercase text-[#666] mb-1">Room Code</div>
                  <div data-testid={TID.adminRoomCode} className="font-mono text-2xl font-bold tracking-widest">{room.room_code}</div>
                </div>
                <Button data-testid={TID.adminCopyRoomCode} variant="outline" onClick={copyCode} className="h-11 rounded-md border-[#E8E8E3]">
                  {copied ? <><Check className="w-4 h-4 mr-1.5 text-[#4C7D5B]" /> Copied</> : <><Copy className="w-4 h-4 mr-1.5" /> Copy</>}
                </Button>
              </div>
            </div>
            <div className="border-l border-[#E8E8E3] pl-10">
              <div className="text-[11px] tracking-widest uppercase text-[#666] mb-3">Enter the audio channel</div>
              <p className="text-sm text-[#666] mb-6 max-w-sm leading-relaxed">
                Join your room to talk with your team. You are the host — you can mute or remove any participant.
              </p>
              <Button
                data-testid={TID.adminEnterRoomBtn}
                onClick={() => navigate(`/room?id=${room.id}`)}
                disabled={room.status !== "active"}
                className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] h-12 px-6 rounded-md disabled:opacity-50"
              >
                <Radio className="w-4 h-4 mr-2" strokeWidth={1.75} /> Enter audio room
              </Button>
              {room.status !== "active" && (
                <p className="text-xs text-[#C84C4C] mt-3">This room has been suspended by the platform owner.</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between mb-5">
          <div>
            <div className="text-[11px] tracking-widest uppercase text-[#666] mb-1">Members</div>
            <h2 className="text-2xl font-extrabold tracking-tight">People in your room</h2>
            <p className="text-xs text-[#666] mt-1">{members.length}/15 members. They can only see this room.</p>
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
                <DialogDescription className="text-[#666]">They'll be able to sign in and join this room.</DialogDescription>
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
              <div className="text-sm text-[#666] mt-1">Add up to 15 people who can join your audio room.</div>
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

      <AlertDialog open={!!memberToRemove} onOpenChange={(o) => !o && setMemberToRemove(null)}>
        <AlertDialogContent className="bg-white border-[#E8E8E3] rounded-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-extrabold tracking-tight">Remove {memberToRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#666]">
              They will lose access to your room. Cannot be undone.
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
