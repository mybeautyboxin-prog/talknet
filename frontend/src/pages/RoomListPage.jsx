import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import AppLayout from "@/components/AppLayout";
import { toast } from "sonner";

/**
 * Users have exactly one assigned room in the new 3-role model.
 * This page just fetches that one room and forwards immediately to /room?id=…
 * (no picker UI needed; kept as a route so protected routing is centralised).
 */
export default function RoomListPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/room/available");
        const rooms = res.data.rooms || [];
        if (cancelled) return;
        if (rooms.length === 0) {
          toast.error("No room assigned yet. Please ask your room admin.");
          return;
        }
        navigate(`/room?id=${rooms[0].id}`, { replace: true });
      } catch (e) {
        toast.error(formatApiError(e));
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  return (
    <AppLayout>
      <div className="max-w-lg mx-auto px-8 py-16 text-center">
        <Loader2 className="w-6 h-6 mx-auto text-[#3A4F41] animate-spin mb-4" />
        <div className="text-sm text-[#666]">Finding your room…</div>
      </div>
    </AppLayout>
  );
}
