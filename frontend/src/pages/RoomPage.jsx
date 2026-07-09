import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Room, RoomEvent, Track, ConnectionState, RemoteParticipant } from "livekit-client";
import { Mic, MicOff, PhoneOff, Radio, Volume2, VolumeX, UserX, Loader2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { TID } from "@/lib/testIds";
import { toast } from "sonner";

/**
 * Push-to-Talk audio room. We connect to LiveKit but PUBLISH the mic track as MUTED,
 * then unmute only while the PTT button/spacebar is held down.
 */
export default function RoomPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [state, setState] = useState("idle"); // idle | connecting | connected | error
  const [errorMsg, setErrorMsg] = useState("");
  const [participants, setParticipants] = useState([]); // { identity, name, role, isSpeaking, isMuted, trackSid }
  const [isTalking, setIsTalking] = useState(false);
  const [roomMeta, setRoomMeta] = useState(null);

  const roomRef = useRef(null);
  const micTrackRef = useRef(null);
  const talkingRef = useRef(false);

  const isHost = user?.role === "room_admin";

  // Refresh participant snapshot
  const refreshParticipants = useCallback(() => {
    const r = roomRef.current;
    if (!r) return;
    const list = [];
    const buildEntry = (p, isLocal) => {
      let meta = {};
      try { meta = p.metadata ? JSON.parse(p.metadata) : {}; } catch (_) {}
      const audioPub = p.getTrackPublication?.(Track.Source.Microphone) || Array.from(p.audioTrackPublications?.values?.() || [])[0];
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
    list.push(buildEntry(r.localParticipant, true));
    r.remoteParticipants.forEach((p) => list.push(buildEntry(p, false)));
    setParticipants(list);
  }, [user]);

  const connect = useCallback(async () => {
    setState("connecting");
    setErrorMsg("");
    try {
      const info = await api.get("/room/info");
      setRoomMeta(info.data.room);

      const tokenRes = await api.post("/room/token");
      const { token, livekit_url } = tokenRes.data;

      if (!livekit_url || livekit_url.includes("placeholder")) {
        throw new Error("LiveKit is not configured yet. Ask the platform owner to set LIVEKIT_URL / API_KEY / API_SECRET in the backend .env.");
      }

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: { audioPreset: { maxBitrate: 32000 } },
      });
      roomRef.current = room;

      room
        .on(RoomEvent.ParticipantConnected, refreshParticipants)
        .on(RoomEvent.ParticipantDisconnected, refreshParticipants)
        .on(RoomEvent.TrackMuted, refreshParticipants)
        .on(RoomEvent.TrackUnmuted, refreshParticipants)
        .on(RoomEvent.TrackPublished, refreshParticipants)
        .on(RoomEvent.TrackUnpublished, refreshParticipants)
        .on(RoomEvent.ActiveSpeakersChanged, refreshParticipants)
        .on(RoomEvent.Disconnected, () => {
          setState("idle");
          setParticipants([]);
        })
        .on(RoomEvent.ConnectionStateChanged, (cs) => {
          if (cs === ConnectionState.Connected) setState("connected");
        });

      await room.connect(livekit_url, token);

      // Enable microphone but immediately mute — PTT will unmute on demand
      await room.localParticipant.setMicrophoneEnabled(true);
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (pub?.track) {
        await pub.mute();
        micTrackRef.current = pub.track;
      }
      setState("connected");
      refreshParticipants();
    } catch (e) {
      const msg = e?.message || formatApiError(e);
      setErrorMsg(msg);
      toast.error(msg);
      setState("error");
    }
  }, [refreshParticipants]);

  const disconnect = useCallback(async () => {
    try { await roomRef.current?.disconnect(); } catch (_) {}
    roomRef.current = null;
    micTrackRef.current = null;
    setState("idle");
    setParticipants([]);
  }, []);

  // PTT press / release
  const startTalking = useCallback(async () => {
    if (talkingRef.current) return;
    const t = micTrackRef.current;
    if (!t) return;
    talkingRef.current = true;
    setIsTalking(true);
    try { await t.unmute(); } catch (_) {}
  }, []);

  const stopTalking = useCallback(async () => {
    if (!talkingRef.current) return;
    talkingRef.current = false;
    setIsTalking(false);
    const t = micTrackRef.current;
    if (!t) return;
    try { await t.mute(); } catch (_) {}
  }, []);

  // Global spacebar PTT
  useEffect(() => {
    if (state !== "connected") return;
    const onDown = (e) => {
      if (e.code === "Space" && !e.repeat && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        startTalking();
      }
    };
    const onUp = (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        stopTalking();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [state, startTalking, stopTalking]);

  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  const handleMuteRemote = async (p) => {
    if (!p.trackSid) { toast.error("No mic track to mute yet"); return; }
    try {
      await api.post("/room/mute", { identity: p.identity, track_sid: p.trackSid });
      toast.success(`Muted ${p.name}`);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const handleKick = async (p) => {
    if (!window.confirm(`Kick ${p.name} from the room?`)) return;
    try {
      await api.post("/room/kick", { identity: p.identity });
      toast.success(`Kicked ${p.name}`);
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const remoteCount = Math.max(participants.length - 1, 0);

  // Idle / pre-connect view
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
            <Button variant="outline" onClick={() => navigate(user?.role === "room_admin" ? "/admin" : -1)} className="rounded-md border-[#E8E8E3]">
              Back
            </Button>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="max-w-md w-full text-center">
            <div className="text-[11px] tracking-widest uppercase text-[#666] mb-3" data-testid={TID.roomStatusIndicator}>Ready to join</div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-3">
              {isHost ? "Enter your room as host" : "Join your team's channel"}
            </h1>
            <p className="text-sm text-[#666] mb-8 leading-relaxed">
              Your browser will ask for microphone access. Hold the <kbd className="font-mono bg-[#F2F2F0] border border-[#E8E8E3] rounded px-1.5 py-0.5 text-xs">Space</kbd> bar (or the on-screen button) to speak. Release to listen.
            </p>
            {state === "error" && (
              <div className="text-sm text-[#C84C4C] border border-[#C84C4C]/30 bg-[#FBEDED] rounded-md p-4 mb-6 text-left">
                <div className="font-semibold mb-1">Couldn't connect</div>
                <div className="text-[#111]">{errorMsg}</div>
              </div>
            )}
            <Button
              data-testid={TID.roomEnter}
              onClick={connect}
              disabled={state === "connecting"}
              className="bg-[#3A4F41] hover:bg-[#2f4136] text-[#FCFCFB] h-12 px-8 rounded-md text-[15px]"
            >
              {state === "connecting" ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting…</>) : "Join audio room"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Connected — main room UI
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
          <Button
            data-testid={TID.roomLeave}
            variant="outline"
            onClick={disconnect}
            className="rounded-md border-[#C84C4C]/40 text-[#C84C4C] hover:bg-[#FBEDED]"
          >
            <PhoneOff className="w-4 h-4 mr-1.5" /> Leave
          </Button>
        </div>
      </header>

      <div className="flex-1 max-w-6xl mx-auto w-full px-8 py-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" data-testid={TID.roomParticipantList}>
          {participants.map((p) => (
            <div
              key={p.identity}
              className={`bg-white border rounded-md p-5 flex flex-col items-start gap-3 relative transition-colors duration-200 ${
                p.isSpeaking && !p.isMuted ? "border-[#4C7D5B] speaking-ring" : "border-[#E8E8E3]"
              }`}
            >
              <div className="w-full flex items-center justify-between">
                <div className="w-11 h-11 rounded-md bg-[#F2F2F0] flex items-center justify-center font-bold text-[#111]">
                  {p.name.split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase()}
                </div>
                {p.role === "room_admin" && (
                  <span className="text-[10px] tracking-widest uppercase text-[#3A4F41] border border-[#3A4F41]/40 rounded-sm px-1.5 py-0.5">Host</span>
                )}
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
                  <Button
                    data-testid={`${TID.participantMutePrefix}${p.identity}`}
                    size="sm"
                    variant="outline"
                    onClick={() => handleMuteRemote(p)}
                    className="h-7 text-[11px] rounded-md border-[#E8E8E3]"
                  >
                    <VolumeX className="w-3 h-3 mr-1" strokeWidth={2} /> Mute
                  </Button>
                  <Button
                    data-testid={`${TID.participantKickPrefix}${p.identity}`}
                    size="sm"
                    variant="outline"
                    onClick={() => handleKick(p)}
                    className="h-7 text-[11px] rounded-md border-[#E8E8E3] hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]"
                  >
                    <UserX className="w-3 h-3 mr-1" strokeWidth={2} /> Kick
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Floating PTT bar */}
      <div className="sticky bottom-0 left-0 right-0 px-8 pb-8 pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <div className="bg-[#111] text-[#FCFCFB] rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.18)] px-2 py-2 flex items-center justify-between gap-3">
            <div className="pl-4 pr-2 text-[11px] tracking-widest uppercase opacity-70 hidden sm:block">
              Hold <kbd className="font-mono bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-[10px] ml-1">Space</kbd>
            </div>
            <button
              data-testid={TID.roomPttButton}
              onMouseDown={startTalking}
              onMouseUp={stopTalking}
              onMouseLeave={stopTalking}
              onTouchStart={(e) => { e.preventDefault(); startTalking(); }}
              onTouchEnd={(e) => { e.preventDefault(); stopTalking(); }}
              className={`flex-1 rounded-full py-4 font-extrabold tracking-widest uppercase text-sm select-none transition-colors ${
                isTalking ? "bg-[#4C7D5B] text-white" : "bg-white/10 text-white hover:bg-white/15"
              }`}
              style={{ WebkitUserSelect: "none", touchAction: "none" }}
            >
              {isTalking ? (<><Mic className="w-4 h-4 inline mr-2" strokeWidth={2.25} /> Talking…</>) : (<><Mic className="w-4 h-4 inline mr-2" strokeWidth={2.25} /> Hold to talk</>)}
            </button>
            <div className="pl-2 pr-4 text-[11px] tracking-widest uppercase opacity-70 hidden sm:block">
              {remoteCount} listening
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
