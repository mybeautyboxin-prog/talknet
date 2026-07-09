import React from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Radio, Mic, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TID } from "@/lib/testIds";

const Feature = ({ icon: Icon, title, children }) => (
  <div className="border-t border-[#E8E8E3] pt-6">
    <Icon className="w-5 h-5 text-[#3A4F41] mb-3" strokeWidth={1.5} />
    <h3 className="font-bold text-base mb-1.5 tracking-tight">{title}</h3>
    <p className="text-sm text-[#666666] leading-relaxed">{children}</p>
  </div>
);

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#FCFCFB] text-[#111111]">
      <nav className="border-b border-[#E8E8E3]">
        <div className="max-w-7xl mx-auto px-8 py-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5" data-testid={TID.navBrand}>
            <div className="w-8 h-8 rounded-md bg-[#3A4F41] flex items-center justify-center">
              <Radio className="w-4 h-4 text-[#FCFCFB]" strokeWidth={1.75} />
            </div>
            <span className="font-extrabold tracking-tight">TalkNet</span>
          </Link>
          <Link to="/login">
            <Button
              data-testid={TID.landingCtaLogin}
              className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] rounded-md h-10 px-5"
            >
              Sign in <ArrowUpRight className="w-4 h-4 ml-1" strokeWidth={1.75} />
            </Button>
          </Link>
        </div>
      </nav>

      <section data-testid={TID.landingHero} className="max-w-7xl mx-auto px-8 pt-24 pb-32 grid lg:grid-cols-12 gap-12 items-end">
        <div className="lg:col-span-8">
          <div className="inline-flex items-center gap-2 border border-[#E8E8E3] bg-white rounded-full px-3 py-1 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4C7D5B] animate-pulse" />
            <span className="text-[11px] tracking-widest uppercase text-[#666666]">Push · Talk · Ship</span>
          </div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.02]">
            Radio-simple<br />
            <span className="text-[#3A4F41]">team audio.</span><br />
            Built for teams<br /> that just want to talk.
          </h1>
          <p className="mt-8 max-w-xl text-lg text-[#666666] leading-relaxed">
            A multi-tenant push-to-talk platform. Onboard customers, assign a room admin,
            drop 10–15 people into a channel — no meetings, no calendars, just voice.
          </p>
          <div className="mt-10 flex gap-4">
            <Link to="/login">
              <Button className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] rounded-md h-12 px-7 text-[15px]">
                Enter Console
              </Button>
            </Link>
            <a
              href="#how"
              className="inline-flex items-center h-12 px-5 rounded-md border border-[#E8E8E3] hover:bg-white text-[15px] font-medium"
            >
              How it works
            </a>
          </div>
        </div>
        <div className="lg:col-span-4">
          <div className="border border-[#E8E8E3] rounded-md bg-white p-6">
            <div className="text-[11px] tracking-widest uppercase text-[#666666] mb-4">Live · Simulated</div>
            <div className="space-y-3">
              {[
                { n: "Alex M.", s: true },
                { n: "Priya K.", s: false },
                { n: "Sam W.", s: false },
                { n: "Jordan R.", s: true },
              ].map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-md ${p.s ? "bg-[#3A4F41] text-white" : "bg-[#F2F2F0] text-[#111]"} flex items-center justify-center text-xs font-semibold`}>
                    {p.n.split(" ").map(x=>x[0]).join("")}
                  </div>
                  <div className="flex-1 text-sm">{p.n}</div>
                  {p.s && <span className="text-[10px] tracking-widest uppercase text-[#4C7D5B]">Speaking</span>}
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-[#E8E8E3] pt-4 flex items-center justify-between">
              <span className="text-xs text-[#666]">Hold to talk</span>
              <button className="rounded-full bg-[#3A4F41] text-[#FCFCFB] px-4 py-2 text-xs font-bold tracking-widest uppercase">
                <Mic className="w-3.5 h-3.5 inline mr-1.5" strokeWidth={2} />Talk
              </button>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-[#E8E8E3] bg-white">
        <div className="max-w-7xl mx-auto px-8 py-20 grid md:grid-cols-3 gap-10">
          <Feature icon={Users} title="One click onboarding">
            Platform owners spin up a new customer — a room admin and a private room are
            provisioned automatically with a shareable code.
          </Feature>
          <Feature icon={Mic} title="Push-to-Talk audio">
            Hold the spacebar or the on-screen button. Release to listen. Zero-friction
            walkie-talkie built on LiveKit's low-latency SFU.
          </Feature>
          <Feature icon={ShieldCheck} title="Host controls">
            Room admins can mute or remove any participant. Suspend a customer and every
            channel goes dark instantly. Multi-tenant by design.
          </Feature>
        </div>
      </section>

      <footer className="border-t border-[#E8E8E3]">
        <div className="max-w-7xl mx-auto px-8 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="text-xs text-[#666666] tracking-wide">© TalkNet — Audio conferencing for teams that skip meetings.</div>
          <div className="text-[11px] tracking-widest uppercase text-[#666666]">v0.1 · Phase 1</div>
        </div>
      </footer>
    </div>
  );
}
