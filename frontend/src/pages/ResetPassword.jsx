import React, { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Radio, CheckCircle2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TID } from "@/lib/testIds";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      setOk(true);
      setTimeout(() => navigate("/login"), 1800);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FCFCFB] flex items-center justify-center px-8">
      <div className="max-w-sm w-full">
        <Link to="/" className="flex items-center gap-2.5 mb-10">
          <div className="w-9 h-9 rounded-md bg-[#3A4F41] flex items-center justify-center">
            <Radio className="w-4 h-4 text-[#FCFCFB]" strokeWidth={1.75} />
          </div>
          <span className="font-extrabold tracking-tight text-lg">TalkNet</span>
        </Link>
        <div className="text-[11px] tracking-widest uppercase text-[#666] mb-3">Recovery</div>
        <h1 className="text-4xl font-extrabold tracking-tight mb-2">New password</h1>
        <p className="text-sm text-[#666] mb-8">Choose a strong password. Minimum 6 characters.</p>

        {!token ? (
          <div data-testid={TID.resetError} className="border border-[#C84C4C]/40 bg-[#FBEDED] rounded-md p-4 text-sm">
            This reset link is missing a token. Request a new one from the <Link to="/forgot-password" className="underline">forgot-password page</Link>.
          </div>
        ) : ok ? (
          <div data-testid={TID.resetSuccess} className="border border-[#4C7D5B]/40 bg-[#EFF5F0] rounded-md p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#4C7D5B] mt-0.5" strokeWidth={1.5} />
              <div>
                <div className="font-bold text-sm">Password reset.</div>
                <p className="text-xs text-[#666] mt-1">Redirecting you to sign in…</p>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-[11px] tracking-widest uppercase text-[#666]">New password</Label>
              <Input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid={TID.resetPassword}
                className="h-11 rounded-md border-[#E8E8E3] bg-white"
              />
            </div>
            {error && <div data-testid={TID.resetError} className="text-sm text-[#C84C4C] border-l-2 border-[#C84C4C] pl-3">{error}</div>}
            <Button
              type="submit"
              disabled={submitting}
              data-testid={TID.resetSubmit}
              className="w-full h-11 rounded-md bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB]"
            >
              {submitting ? "Saving…" : "Reset password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
