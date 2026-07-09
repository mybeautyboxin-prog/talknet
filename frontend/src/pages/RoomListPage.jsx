import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Users2, ArrowRight, Loader2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { TID } from "@/lib/testIds";
import { toast } from "sonner";

export default function RoomListPage() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get("/room/available");
        setRooms(res.data.rooms);
      } catch (e) {
        toast.error(formatApiError(e));
      } finally { setLoading(false); }
    };
    load();
  }, []);

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-8 py-10" data-testid={TID.roomListPage}>
        <div className="text-[11px] tracking-widest uppercase text-[#666] mb-2">Your channels</div>
        <h1 className="text-4xl font-extrabold tracking-tight mb-2">Pick a room to join</h1>
        <p className="text-sm text-[#666] mb-10">
          Welcome{user?.name ? `, ${user.name.split(" ")[0]}` : ""}. Click a channel to enter its audio room.
        </p>

        {loading ? (
          <div className="text-sm text-[#666] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading rooms…</div>
        ) : rooms.length === 0 ? (
          <div className="border border-[#E8E8E3] bg-white rounded-md p-16 text-center">
            <Users2 className="w-8 h-8 mx-auto text-[#3A4F41] mb-3" strokeWidth={1.25} />
            <div className="font-bold text-lg tracking-tight">No rooms yet</div>
            <div className="text-sm text-[#666] mt-1">Ask your room admin to set one up for you.</div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {rooms.map((r) => (
              <button
                key={r.id}
                data-testid={`${TID.roomListEnterPrefix}${r.id}`}
                onClick={() => navigate(`/room?id=${r.id}`)}
                className="text-left border border-[#E8E8E3] bg-white rounded-md p-6 hover:border-[#3A4F41] transition-colors group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-9 h-9 rounded-md bg-[#F2F2F0] flex items-center justify-center">
                    <Radio className="w-4 h-4 text-[#3A4F41]" strokeWidth={1.5} />
                  </div>
                  <span className="font-mono text-[11px] tracking-widest uppercase text-[#666] border border-[#E8E8E3] rounded-sm px-1.5 py-0.5">{r.room_code}</span>
                </div>
                <div className="font-bold text-lg tracking-tight">{r.name}</div>
                <div className="text-xs text-[#666] mt-1">Max {r.max_participants} live · Push-to-Talk</div>
                <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#3A4F41] group-hover:translate-x-0.5 transition-transform">
                  Join <ArrowRight className="w-4 h-4" strokeWidth={2} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
