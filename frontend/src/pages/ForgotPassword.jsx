import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Radio, ArrowRight, CheckCircle2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TID } from "@/lib/testIds";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
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
        <h1 className="text-4xl font-extrabold tracking-tight mb-2">Forgot password</h1>
        <p className="text-sm text-[#666] mb-8">Enter your email — we'll send you a reset link.</p>

        {sent ? (
          <div data-testid={TID.forgotSuccess} className="border border-[#4C7D5B]/40 bg-[#EFF5F0] rounded-md p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-[#4C7D5B] mt-0.5" strokeWidth={1.5} />
              <div>
                <div className="font-bold text-sm">If that email exists, a link has been sent.</div>
                <p className="text-xs text-[#666] mt-1">Check your inbox. The link expires in 1 hour. Ask your platform admin to check the server console if emails aren't wired up yet.</p>
              </div>
            </div>
            <Link to="/login" className="inline-block mt-4 text-sm underline">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-[11px] tracking-widest uppercase text-[#666]">Email</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid={TID.forgotEmail}
                className="h-11 rounded-md border-[#E8E8E3] bg-white"
              />
            </div>
            {error && <div className="text-sm text-[#C84C4C] border-l-2 border-[#C84C4C] pl-3">{error}</div>}
            <Button
              type="submit"
              disabled={submitting}
              data-testid={TID.forgotSubmit}
              className="w-full h-11 rounded-md bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB]"
            >
              {submitting ? "Sending…" : (<>Send reset link <ArrowRight className="w-4 h-4 ml-1.5" strokeWidth={1.75} /></>)}
            </Button>
            <Link to="/login" className="block text-sm text-[#666] underline text-center">Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
