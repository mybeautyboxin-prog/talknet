import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Radio, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TID } from "@/lib/testIds";
import { toast } from "sonner";

const redirectFor = (u) => {
  if (!u) return "/login";
  if (u.role === "platform_owner") return "/platform";
  if (u.role === "room_admin") return "/admin";
  return "/rooms";
};

export default function LoginPage() {
  const { login, user } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (user) {
      navigate(redirectFor(user), { replace: true });
    }
  }, [user, navigate]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const r = await login(identifier.trim(), password);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error);
      toast.error(r.error);
      return;
    }
    toast.success(`Signed in as ${r.user.name}`);
    const next = location.state?.from?.pathname || redirectFor(r.user);
    navigate(next, { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#FCFCFB] grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[#3A4F41] text-[#FCFCFB]">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-md bg-[#FCFCFB]/10 border border-[#FCFCFB]/20 flex items-center justify-center">
            <Radio className="w-4 h-4" strokeWidth={1.75} />
          </div>
          <span className="font-extrabold tracking-tight text-lg">TalkNet</span>
        </Link>
        <div>
          <div className="text-[11px] tracking-widest uppercase opacity-70 mb-6">The Console</div>
          <h2 className="font-extrabold text-4xl leading-tight tracking-tight max-w-md">
            Sign in to manage customers, admins & rooms.
          </h2>
          <p className="mt-6 opacity-70 max-w-md leading-relaxed">
            Everything is provisioned in one click. Suspend a customer and every voice channel goes dark instantly.
          </p>
        </div>
        <div className="text-[11px] tracking-widest uppercase opacity-60">
          Multi-tenant · Push-to-Talk
        </div>
      </div>

      <div className="flex items-center justify-center px-8 py-16">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <div className="lg:hidden mb-10 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-md bg-[#3A4F41] flex items-center justify-center">
              <Radio className="w-4 h-4 text-[#FCFCFB]" strokeWidth={1.75} />
            </div>
            <span className="font-extrabold tracking-tight text-lg">TalkNet</span>
          </div>

          <div className="text-[11px] tracking-widest uppercase text-[#666666] mb-3">Console</div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">Sign in</h1>
          <p className="text-sm text-[#666666] mb-10">Admins use their email. Room users use the username set by their admin.</p>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-[11px] tracking-widest uppercase text-[#666666]">Email or Username</Label>
              <Input id="identifier" type="text" required value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                data-testid={TID.loginIdentifier}
                placeholder="you@example.com or username"
                className="h-11 rounded-md border-[#E8E8E3] bg-white focus:border-[#3A4F41]"
                autoComplete="username" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-[11px] tracking-widest uppercase text-[#666666]">Password</Label>
                <Link to="/forgot-password" data-testid={TID.loginForgotLink} className="text-[11px] tracking-widest uppercase text-[#666] hover:text-[#3A4F41] underline">
                  Forgot?
                </Link>
              </div>
              <Input id="password" type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid={TID.loginPassword}
                className="h-11 rounded-md border-[#E8E8E3] bg-white focus:border-[#3A4F41]"
                autoComplete="current-password" />
            </div>

            {error && (
              <div data-testid={TID.loginError} className="text-sm text-[#C84C4C] border-l-2 border-[#C84C4C] pl-3 py-1">
                {error}
              </div>
            )}

            <Button type="submit" disabled={submitting} data-testid={TID.loginSubmit}
              className="w-full h-11 rounded-md bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] font-semibold">
              {submitting ? "Signing in…" : (<><span>Sign in</span><ArrowRight className="w-4 h-4 ml-1.5" strokeWidth={1.75} /></>)}
            </Button>
          </div>

          <div className="mt-8 text-xs text-[#666666] border-t border-[#E8E8E3] pt-6">
            Only platform-provisioned accounts can sign in. No self-service registration.
          </div>
        </form>
      </div>
    </div>
  );
}
