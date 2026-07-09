import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Radio } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { TID } from "@/lib/testIds";
import { Button } from "@/components/ui/button";

const ROLE_LABEL = {
  platform_owner: "Platform Owner",
  room_admin: "Room Admin",
  user: "User",
};

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#FCFCFB] text-[#111111]">
      <header className="border-b border-[#E8E8E3] bg-white/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <Link to="/" data-testid={TID.navBrand} className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-md bg-[#3A4F41] flex items-center justify-center">
              <Radio className="w-4 h-4 text-[#FCFCFB]" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-extrabold tracking-tight text-[15px]">TalkNet</span>
              <span className="text-[10px] text-[#666666] tracking-widest uppercase mt-0.5">Audio · PTT</span>
            </div>
          </Link>

          {user && (
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex flex-col items-end leading-tight" data-testid={TID.navUserBadge}>
                <span className="text-sm font-medium">{user.name}</span>
                <span className="text-[11px] text-[#666666] tracking-wide uppercase">
                  {ROLE_LABEL[user.role]}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                data-testid={TID.navLogout}
                onClick={() => { logout(); navigate("/login"); }}
                className="border-[#E8E8E3] hover:bg-[#F4F4F0] rounded-md h-9"
              >
                <LogOut className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.75} />
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
