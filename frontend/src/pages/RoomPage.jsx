import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Room, RoomEvent, Track, ConnectionState } from "livekit-client";
import { Mic, MicOff, PhoneOff, Radio, Volume2, VolumeX, UserX, Loader2, Zap } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TID } from "@/lib/testIds";
import { toast } from "sonner";

export default function RoomPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roomId = params.get("id");

  const [state, setState] = useState("idle"); // idle | connecting | connected | error
  const [errorMsg, setErrorMsg] = useState("");
  const [participants, setParticipants] = useState([]);
  const [isTalking, setIsTalking] = useState(false);
  const [continuousMic, setContinuousMic] = useState(false);
  const [roomMeta, setRoomMeta] = useState(null);
  const [participantToKick, setParticipantToKick] = useState(null);

  const roomRef = useRef(null);
  const micTrackRef = useRef(null);
  const talkingRef = useRef(false);
  const continuousRef = useRef(false);
  const sessionIdRef = useRef(null);
  const audioContainerRef = useRef(null);

  const isHost = user?.role === "room_admin";

  useEffect(() => {
    if (!roomId) {
      // No room selected — send to picker
      navigate(user?.role === "room_admin" ? "/admin" : "/rooms", { replace: true });
    }
  }, [roomId, navigate, user]);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      try {
        const res = await api.get(`/room/info/${roomId}`);
        setRoomMeta(res.data.room);
      } catch (e) {
        setErrorMsg(formatApiError(e));
      }
    })();
  }, [roomId]);

  const refreshParticipants = useCallback(() => {
    const r = roomRef.current;
    if (!r) return;
    const build = (p, isLocal) => {
      let meta = {};
      try { meta = p.metadata ? JSON.parse(p.metadata) : {}; } catch (_) {}
      const pubs = Array.from((p.audioTrackPublications?.values?.() || p.trackPublications?.values?.() || []));
      const audioPub = pubs.find((x) => x.kind === Track.Kind.Audio || x.source === Track.Source.Microphone) || pubs[0];
      return {
        identity: p.identity,
        name: meta.name || p.name || p.identity,
        role: meta.role || (isLocal ? user?.role : "user"),
        isLocal,
        isSpeaking: p.isSpeaking,
        isMuted: audioPub ? audioPub.isMuted : true,
        trackSid: audioPub?.trackSid,
      };
    };
    const list = [build(r.localParticipant, true)];
    r.remoteParticipants.forEach((p) => list.push(build(p, false)));
    setParticipants(list);
  }, [user]);

  const connect = useCallback(async () => {
    if (!roomId) return;
    setState("connecting"); setErrorMsg("");
    try {
      const tokenRes = await api.post("/room/token", { room_id: roomId });
      const { token, livekit_url } = tokenRes.data;

      if (!livekit_url || livekit_url.includes("placeholder")) {
        throw new Error("LiveKit isn't configured yet. Ask the platform owner to set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET in the backend .env.");
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const attachAudio = (track, participant) => {
        if (track.kind !== "audio") return;
        try {
          const el = track.attach();
          el.setAttribute("data-lk-participant", participant?.identity || "");
          el.autoplay = true;
          el.setAttribute("playsinline", "");
          audioContainerRef.current?.appendChild(el);
        } catch (_) {}
      };
      const detachAudio = (track) => {
        if (track.kind !== "audio") return;
        try { track.detach().forEach((el) => el.remove()); } catch (_) {}
      };

      room
        .on(RoomEvent.ParticipantConnected, refreshParticipants)
        .on(RoomEvent.ParticipantDisconnected, refreshParticipants)
        .on(RoomEvent.TrackMuted, refreshParticipants)
        .on(RoomEvent.TrackUnmuted, refreshParticipants)
        .on(RoomEvent.TrackPublished, refreshParticipants)
        .on(RoomEvent.TrackUnpublished, refreshParticipants)
        .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          attachAudio(track, participant);
          refreshParticipants();
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => {
          detachAudio(track);
          refreshParticipants();
        })
        .on(RoomEvent.ActiveSpeakersChanged, refreshParticipants)
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (!room.canPlaybackAudio) {
            toast.warning("Browser blocked audio autoplay — click anywhere to enable.");
          }
        })
        .on(RoomEvent.Disconnected, () => {
          setState("idle"); setParticipants([]);
        })
        .on(RoomEvent.ConnectionStateChanged, (cs) => {
          if (cs === ConnectionState.Connected) setState("connected");
        });

      await room.connect(livekit_url, token);

      // Unlock autoplay after the user's Join click (a real gesture)
      try { await room.startAudio(); } catch (_) {}

      // Attach any tracks that were already subscribed at connect time
      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => {
          if (pub.track && pub.kind === Track.Kind.Audio) {
            attachAudio(pub.track, p);
          }
        });
      });

      await room.localParticipant.setMicrophoneEnabled(true);
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (pub?.track) {
        await pub.mute();
        micTrackRef.current = pub.track;
      }
      setState("connected"); refreshParticipants();

      // Start session tracking (best-effort)
      try {
        const s = await api.post("/room/session/start", { room_id: roomId });
        sessionIdRef.current = s.data.session_id;
      } catch (_) {}
    } catch (e) {
      const msg = e?.message || formatApiError(e);
      setErrorMsg(msg); toast.error(msg); setState("error");
    }
  }, [roomId, refreshParticipants]);

  const disconnect = useCallback(async () => {
    if (sessionIdRef.current) {
      try { await api.post("/room/session/end", { session_id: sessionIdRef.current }); } catch (_) {}
      sessionIdRef.current = null;
    }
    // Detach and remove any remote audio elements
    try {
      const c = audioContainerRef.current;
      if (c) while (c.firstChild) c.removeChild(c.firstChild);
    } catch (_) {}
    try { await roomRef.current?.disconnect(); } catch (_) {}
    roomRef.current = null; micTrackRef.current = null;
    talkingRef.current = false; continuousRef.current = false;
    setIsTalking(false); setContinuousMic(false);
    setState("idle"); setParticipants([]);
  }, []);

  const startTalking = useCallback(async () => {
    if (continuousRef.current) return; // already open mic
    if (talkingRef.current) return;
    const t = micTrackRef.current; if (!t) return;
    talkingRef.current = true; setIsTalking(true);
    try { await t.unmute(); } catch (_) {}
  }, []);

  const stopTalking = useCallback(async () => {
    if (continuousRef.current) return; // keep open
    if (!talkingRef.current) return;
    talkingRef.current = false; setIsTalking(false);
    const t = micTrackRef.current; if (!t) return;
    try { await t.mute(); } catch (_) {}
  }, []);

  const toggleContinuous = useCallback(async (next) => {
    if (!isHost) return;
    continuousRef.current = next;
    setContinuousMic(next);
    const t = micTrackRef.current;
    if (!t) return;
    try {
      if (next) {
        await t.unmute();
        // Reset PTT state — user isn't holding anything anymore
        talkingRef.current = false;
        setIsTalking(false);
      } else {
        await t.mute();
      }
    } catch (_) {}
  }, [isHost]);

  useEffect(() => {
    if (state !== "connected") return;
    const onDown = (e) => {
      if (e.code === "Space" && !e.repeat && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault(); startTalking();
      }
    };
    const onUp = (e) => { if (e.code === "Space") { e.preventDefault(); stopTalking(); } };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [state, startTalking, stopTalking]);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  const handleMuteRemote = async (p) => {
    if (!p.trackSid) { toast.error("No mic track to mute yet"); return; }
    try {
      await api.post("/room/mute", { room_id: roomId, identity: p.identity, track_sid: p.trackSid });
      toast.success(`Muted ${p.name}`);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const doKick = async () => {
    if (!participantToKick) return;
    try {
      await api.post("/room/kick", { room_id: roomId, identity: participantToKick.identity });
      toast.success(`Kicked ${participantToKick.name}`);
    } catch (e) { toast.error(formatApiError(e)); }
    finally { setParticipantToKick(null); }
  };

  // Idle view
  if (state !== "connected") {
    return (
      <div className="min-h-screen bg-[#FCFCFB] flex flex-col">
        <header className="border-b border-[#E8E8E3] bg-white">
          <div className="max-w-4xl mx-auto px-8 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-[#3A4F41] flex items-center justify-center">
                <Radio className="w-4 h-4 text-[#FCFCFB]" strokeWidth={1.75} />
              </div>
              <span className="font-extrabold tracking-tight">TalkNet Room</span>
            </div>
            <Button variant="outline" onClick={() => navigate(user?.role === "room_admin" ? "/admin" : "/rooms")} className="rounded-md border-[#E8E8E3]">
              Back
            </Button>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="max-w-md w-full text-center">
            <div className="text-[11px] tracking-widest uppercase text-[#666] mb-3" data-testid={TID.roomStatusIndicator}>
              {roomMeta ? `Ready · ${roomMeta.name}` : "Ready to join"}
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-3">
              {isHost ? "Enter as host" : "Join the channel"}
            </h1>
            <p className="text-sm text-[#666] mb-8 leading-relaxed">
              Your browser will ask for microphone access. Hold the{" "}
              <kbd className="font-mono bg-[#F2F2F0] border border-[#E8E8E3] rounded px-1.5 py-0.5 text-xs">Space</kbd>{" "}
              bar (or the on-screen button) to speak. Release to listen.
            </p>
            {state === "error" && (
              <div className="text-sm text-[#C84C4C] border border-[#C84C4C]/30 bg-[#FBEDED] rounded-md p-4 mb-6 text-left">
                <div className="font-semibold mb-1">Couldn't connect</div>
                <div className="text-[#111]">{errorMsg}</div>
              </div>
            )}
            <Button data-testid={TID.roomEnter} onClick={connect} disabled={state === "connecting" || !roomId} className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] h-12 px-8 rounded-md text-[15px]">
              {state === "connecting" ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting…</>) : "Join audio room"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const remoteCount = Math.max(participants.length - 1, 0);

  return (
    <div className="min-h-screen bg-[#FCFCFB] flex flex-col">
      <header className="border-b border-[#E8E8E3] bg-white">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#3A4F41] flex items-center justify-center">
              <Radio className="w-4 h-4 text-[#FCFCFB]" strokeWidth={1.75} />
            </div>
            <div>
              <div className="font-extrabold tracking-tight leading-tight">{roomMeta?.name}</div>
              <div className="text-[11px] tracking-widest uppercase text-[#666]" data-testid={TID.roomStatusIndicator}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#4C7D5B] mr-1.5 align-middle animate-pulse" />
                Live · {participants.length} {participants.length === 1 ? "person" : "people"}
              </div>
            </div>
          </div>
          <Button data-testid={TID.roomLeave} variant="outline" onClick={disconnect} className="rounded-md border-[#C84C4C]/40 text-[#C84C4C] hover:bg-[#FBEDED]">
            <PhoneOff className="w-4 h-4 mr-1.5" /> Leave
          </Button>
        </div>
      </header>

      {/* Hidden container that holds remote audio <audio> elements attached by LiveKit */}
      <div ref={audioContainerRef} data-lk-audio-sink aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} />

      <div className="flex-1 max-w-6xl mx-auto w-full px-8 py-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" data-testid={TID.roomParticipantList}>
          {participants.map((p) => (
            <div key={p.identity}
              className={`bg-white border rounded-md p-5 flex flex-col items-start gap-3 transition-colors duration-200 ${p.isSpeaking && !p.isMuted ? "border-[#4C7D5B] speaking-ring" : "border-[#E8E8E3]"}`}
            >
              <div className="w-full flex items-center justify-between">
                <div className="w-11 h-11 rounded-md bg-[#F2F2F0] flex items-center justify-center font-bold text-[#111]">
                  {p.name.split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase()}
                </div>
                {p.role === "room_admin" && <span className="text-[10px] tracking-widest uppercase text-[#3A4F41] border border-[#3A4F41]/40 rounded-sm px-1.5 py-0.5">Host</span>}
              </div>
              <div>
                <div className="font-semibold text-sm leading-tight">
                  {p.name} {p.isLocal && <span className="text-[#666] font-normal">(you)</span>}
                </div>
                <div className="text-xs mt-1">
                  {p.isMuted ? (
                    <span className="text-[#666] inline-flex items-center gap-1"><MicOff className="w-3 h-3" strokeWidth={1.75} /> Silent</span>
                  ) : p.isSpeaking ? (
                    <span className="text-[#4C7D5B] inline-flex items-center gap-1"><Volume2 className="w-3 h-3" strokeWidth={2} /> Speaking</span>
                  ) : (
                    <span className="text-[#666] inline-flex items-center gap-1"><Mic className="w-3 h-3" strokeWidth={1.75} /> Live</span>
                  )}
                </div>
              </div>
              {isHost && !p.isLocal && (
                <div className="mt-2 flex gap-1.5">
                  <Button data-testid={`${TID.participantMutePrefix}${p.identity}`} size="sm" variant="outline" onClick={() => handleMuteRemote(p)} className="h-7 text-[11px] rounded-md border-[#E8E8E3]">
                    <VolumeX className="w-3 h-3 mr-1" strokeWidth={2} /> Mute
                  </Button>
                  <Button data-testid={`${TID.participantKickPrefix}${p.identity}`} size="sm" variant="outline" onClick={() => setParticipantToKick(p)} className="h-7 text-[11px] rounded-md border-[#E8E8E3] hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]">
                    <UserX className="w-3 h-3 mr-1" strokeWidth={2} /> Kick
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="sticky bottom-0 left-0 right-0 px-8 pb-8 pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          {isHost && (
            <div className="mb-3 flex items-center justify-end gap-3 text-[11px] tracking-widest uppercase text-[#666]">
              <Zap className={`w-3.5 h-3.5 ${continuousMic ? "text-[#4C7D5B]" : "text-[#666]"}`} strokeWidth={2} />
              <span>Open mic</span>
              <Switch
                data-testid={TID.roomContinuousToggle}
                checked={continuousMic}
                onCheckedChange={toggleContinuous}
                className="data-[state=checked]:bg-[#4C7D5B]"
              />
            </div>
          )}
          <div className="bg-[#111] text-[#FCFCFB] rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.18)] px-2 py-2 flex items-center justify-between gap-3">
            <div className="pl-4 pr-2 text-[11px] tracking-widest uppercase opacity-70 hidden sm:block">
              {continuousMic ? "Mic open" : (<>Hold <kbd className="font-mono bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-[10px] ml-1">Space</kbd></>)}
            </div>
            <button
              data-testid={TID.roomPttButton}
              onMouseDown={startTalking}
              onMouseUp={stopTalking}
              onMouseLeave={stopTalking}
              onTouchStart={(e) => { e.preventDefault(); startTalking(); }}
              onTouchEnd={(e) => { e.preventDefault(); stopTalking(); }}
              disabled={continuousMic}
              className={`flex-1 rounded-full py-4 font-extrabold tracking-widest uppercase text-sm select-none transition-colors ${
                continuousMic
                  ? "bg-[#4C7D5B] text-white cursor-default"
                  : isTalking
                    ? "bg-[#4C7D5B] text-white"
                    : "bg-white/10 text-white hover:bg-white/15"
              }`}
              style={{ WebkitUserSelect: "none", touchAction: "none" }}
            >
              {continuousMic
                ? (<><Mic className="w-4 h-4 inline mr-2" strokeWidth={2.25} /> Broadcasting…</>)
                : isTalking
                  ? (<><Mic className="w-4 h-4 inline mr-2" strokeWidth={2.25} /> Talking…</>)
                  : (<><Mic className="w-4 h-4 inline mr-2" strokeWidth={2.25} /> Hold to talk</>)}
            </button>
            <div className="pl-2 pr-4 text-[11px] tracking-widest uppercase opacity-70 hidden sm:block">{remoteCount} listening</div>
          </div>
        </div>
      </div>

      <AlertDialog open={!!participantToKick} onOpenChange={(o) => !o && setParticipantToKick(null)}>
        <AlertDialogContent className="bg-white border-[#E8E8E3] rounded-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-extrabold tracking-tight">Kick {participantToKick?.name} from the room?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#666]">
              They will be disconnected immediately. They can rejoin later unless removed from members.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid={TID.participantKickConfirm} onClick={doKick} className="rounded-md bg-[#C84C4C] hover:bg-[#a63c3c] text-white">
              Kick
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
