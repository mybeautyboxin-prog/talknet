import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Room, RoomEvent, Track, ConnectionState } from "livekit-client";
import { Mic, MicOff, PhoneOff, Radio, Volume2, VolumeX, UserX, Loader2, Zap, Settings, CircleDot, Square } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TID } from "@/lib/testIds";
import { toast } from "sonner";

const enc = new TextEncoder();
const dec = new TextDecoder();

export default function RoomPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const roomId = params.get("id");

  const [state, setState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [participants, setParticipants] = useState([]);
  const [isTalking, setIsTalking] = useState(false);
  const [continuousMic, setContinuousMic] = useState(false);
  const [listenerOnly, setListenerOnly] = useState(false);
  const [roomMeta, setRoomMeta] = useState(null);
  const [participantToKick, setParticipantToKick] = useState(null);

  // Broadcasting banner state
  const [hostBroadcasting, setHostBroadcasting] = useState(false);
  const [hostBroadcasterName, setHostBroadcasterName] = useState("");
  // Set of user identities who have been granted continuous mic by the host
  const [grantedMicSet, setGrantedMicSet] = useState(() => new Set());
  const [grantedByHost, setGrantedByHost] = useState(false); // "am I currently granted?" (user side)

  // Devices
  const [devices, setDevices] = useState({ mics: [], speakers: [] });
  const [micId, setMicId] = useState("default");
  const [speakerId, setSpeakerId] = useState("default");

  // Recording
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);

  const roomRef = useRef(null);
  const micTrackRef = useRef(null);
  const talkingRef = useRef(false);
  const continuousRef = useRef(false);
  const sessionIdRef = useRef(null);
  const audioContainerRef = useRef(null);
  const grantedRef = useRef(new Set());
  const isBroadcastingRef = useRef(false);

  // Recording refs
  const audioCtxRef = useRef(null);
  const mixDestRef = useRef(null);
  const recorderRef = useRef(null);
  const recSourcesRef = useRef(new Map()); // trackSid -> MediaStreamAudioSourceNode
  const recChunksRef = useRef([]);
  const recStartTimeRef = useRef(0);

  const isHost = user?.role === "room_admin";

  useEffect(() => {
    if (!roomId) {
      navigate(user?.role === "room_admin" ? "/admin" : "/rooms", { replace: true });
    }
  }, [roomId, navigate, user]);

  useEffect(() => {
    if (!roomId) return;
    (async () => {
      try {
        const res = await api.get(`/room/info/${roomId}`);
        setRoomMeta(res.data.room);
      } catch (e) { setErrorMsg(formatApiError(e)); }
    })();
  }, [roomId]);

  // ---------- Participants snapshot ----------
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

  // ---------- Data message helpers ----------
  const publishJSON = useCallback(async (payload, destinationIdentities) => {
    const r = roomRef.current;
    if (!r) return;
    try {
      await r.localParticipant.publishData(enc.encode(JSON.stringify(payload)), {
        reliable: true,
        ...(destinationIdentities ? { destinationIdentities } : {}),
      });
    } catch (_) {}
  }, []);

  // Announce full host state to (possibly just-joined) participants
  const announceHostState = useCallback(async (destinationIdentities) => {
    if (!isHost) return;
    await publishJSON({ type: "openMic", on: isBroadcastingRef.current, name: user?.name }, destinationIdentities);
    await publishJSON({ type: "grantMicSet", grants: Array.from(grantedRef.current) }, destinationIdentities);
  }, [isHost, publishJSON, user]);

  // ---------- Devices ----------
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        mics: list.filter((d) => d.kind === "audioinput"),
        speakers: list.filter((d) => d.kind === "audiooutput"),
      });
    } catch (_) {}
  }, []);

  const changeMic = useCallback(async (deviceId) => {
    setMicId(deviceId);
    const r = roomRef.current;
    if (!r) return;
    try {
      await r.switchActiveDevice("audioinput", deviceId);
      const pub = r.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (pub?.track) micTrackRef.current = pub.track;
    } catch (e) { toast.error(`Mic switch failed: ${e.message || e}`); }
  }, []);

  const changeSpeaker = useCallback(async (deviceId) => {
    setSpeakerId(deviceId);
    const r = roomRef.current;
    if (r) { try { await r.switchActiveDevice("audiooutput", deviceId); } catch (_) {} }
    // Also apply to already-attached audio elements
    const container = audioContainerRef.current;
    if (container) {
      for (const el of container.querySelectorAll("audio")) {
        if (typeof el.setSinkId === "function") {
          try { await el.setSinkId(deviceId); } catch (_) {}
        }
      }
    }
  }, []);

  // ---------- Mic control ----------
  const startTalking = useCallback(async () => {
    if (continuousRef.current) return;
    if (talkingRef.current) return;
    // Listener-only users cannot talk (Plan C), unless the host has granted them a mic
    if (listenerOnly && !continuousRef.current) return;
    const t = micTrackRef.current; if (!t) return;
    talkingRef.current = true; setIsTalking(true);
    try { await t.unmute(); } catch (_) {}
  }, [listenerOnly]);

  const stopTalking = useCallback(async () => {
    if (continuousRef.current) return;
    if (!talkingRef.current) return;
    talkingRef.current = false; setIsTalking(false);
    const t = micTrackRef.current; if (!t) return;
    try { await t.mute(); } catch (_) {}
  }, []);

  const setContinuousLocal = useCallback(async (next) => {
    continuousRef.current = next;
    setContinuousMic(next);
    const t = micTrackRef.current;
    if (!t) return;
    try {
      if (next) { await t.unmute(); talkingRef.current = false; setIsTalking(false); }
      else { await t.mute(); }
    } catch (_) {}
  }, []);

  const toggleContinuous = useCallback(async (next) => {
    if (!isHost) return;
    isBroadcastingRef.current = next;
    setHostBroadcasting(next);
    setHostBroadcasterName(user?.name || "Host");
    await setContinuousLocal(next);
    await publishJSON({ type: "openMic", on: next, name: user?.name });
  }, [isHost, publishJSON, setContinuousLocal, user]);

  const toggleGrantMic = useCallback(async (identity, on) => {
    if (!isHost) return;
    if (on) grantedRef.current.add(identity);
    else grantedRef.current.delete(identity);
    setGrantedMicSet(new Set(grantedRef.current));
    await publishJSON({ type: "grantMic", target: identity, on });
  }, [isHost, publishJSON]);

  // ---------- Audio attach + Recording graph ----------
  const attachAudioForRecording = useCallback((track) => {
    if (track.kind !== "audio") return;
    if (!recorderRef.current) return; // recording not running
    try {
      const ctx = audioCtxRef.current;
      const dest = mixDestRef.current;
      if (!ctx || !dest) return;
      const stream = new MediaStream([track.mediaStreamTrack]);
      const src = ctx.createMediaStreamSource(stream);
      src.connect(dest);
      recSourcesRef.current.set(track.sid, src);
    } catch (_) {}
  }, []);

  const detachAudioForRecording = useCallback((track) => {
    const src = recSourcesRef.current.get(track.sid);
    if (src) {
      try { src.disconnect(); } catch (_) {}
      recSourcesRef.current.delete(track.sid);
    }
  }, []);

  // ---------- Connect / Disconnect ----------
  const connect = useCallback(async () => {
    if (!roomId) return;
    setState("connecting"); setErrorMsg("");
    try {
      const tokenRes = await api.post("/room/token", { room_id: roomId });
      const { token, livekit_url, listener_only } = tokenRes.data;
      setListenerOnly(!!listener_only);
      if (!livekit_url || livekit_url.includes("placeholder")) {
        throw new Error("LiveKit isn't configured yet.");
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
          if (speakerId && typeof el.setSinkId === "function") {
            el.setSinkId(speakerId).catch(() => {});
          }
          audioContainerRef.current?.appendChild(el);
        } catch (_) {}
        attachAudioForRecording(track);
      };
      const detachAudio = (track) => {
        if (track.kind !== "audio") return;
        try { track.detach().forEach((el) => el.remove()); } catch (_) {}
        detachAudioForRecording(track);
      };

      room
        .on(RoomEvent.ParticipantConnected, async (p) => {
          refreshParticipants();
          // Late-joiner catches up on our broadcast + grant state
          await announceHostState([p.identity]);
        })
        .on(RoomEvent.ParticipantDisconnected, refreshParticipants)
        .on(RoomEvent.TrackMuted, refreshParticipants)
        .on(RoomEvent.TrackUnmuted, refreshParticipants)
        .on(RoomEvent.TrackPublished, refreshParticipants)
        .on(RoomEvent.TrackUnpublished, refreshParticipants)
        .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
          attachAudio(track, participant);
          refreshParticipants();
        })
        .on(RoomEvent.TrackUnsubscribed, (track) => { detachAudio(track); refreshParticipants(); })
        .on(RoomEvent.ActiveSpeakersChanged, refreshParticipants)
        .on(RoomEvent.DataReceived, (payload, participant) => {
          try {
            const msg = JSON.parse(dec.decode(payload));
            let senderMeta = {};
            try { senderMeta = participant?.metadata ? JSON.parse(participant.metadata) : {}; } catch (_) {}
            const senderIsHost = senderMeta.role === "room_admin";
            if (msg.type === "openMic" && senderIsHost) {
              setHostBroadcasting(!!msg.on);
              setHostBroadcasterName(msg.name || participant?.name || "Host");
            } else if (msg.type === "grantMic" && senderIsHost) {
              if (msg.target === room.localParticipant.identity && !isHost) {
                setGrantedByHost(!!msg.on);
                setContinuousLocal(!!msg.on);
                toast[msg.on ? "success" : "message"](msg.on ? "The host gave you the mic" : "The host revoked your mic");
              }
            } else if (msg.type === "grantMicSet" && senderIsHost) {
              const set = new Set(msg.grants || []);
              setGrantedMicSet(set);
              if (!isHost) {
                const on = set.has(room.localParticipant.identity);
                setGrantedByHost(on);
                setContinuousLocal(on);
              }
            }
          } catch (_) {}
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (!room.canPlaybackAudio) toast.warning("Browser blocked audio autoplay — click anywhere.");
        })
        .on(RoomEvent.Disconnected, () => { setState("idle"); setParticipants([]); })
        .on(RoomEvent.ConnectionStateChanged, (cs) => { if (cs === ConnectionState.Connected) { setState("connected"); refreshParticipants(); } })
        .on(RoomEvent.Reconnected, refreshParticipants);

      await room.connect(livekit_url, token);
      try { await room.startAudio(); } catch (_) {}

      // Backfill already-subscribed tracks
      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => {
          if (pub.track && pub.kind === Track.Kind.Audio) attachAudio(pub.track, p);
        });
      });

      await room.localParticipant.setMicrophoneEnabled(true);
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (pub?.track) { await pub.mute(); micTrackRef.current = pub.track; }
      setState("connected");
      refreshParticipants();
      // Trailing refresh — some SDK versions populate remoteParticipants slightly after connect resolves
      setTimeout(refreshParticipants, 400);
      setTimeout(refreshParticipants, 1200);
      refreshDevices();

      try {
        const s = await api.post("/room/session/start", { room_id: roomId });
        sessionIdRef.current = s.data.session_id;
      } catch (_) {}
    } catch (e) {
      const msg = e?.message || formatApiError(e);
      setErrorMsg(msg); toast.error(msg); setState("error");
    }
  }, [roomId, refreshParticipants, announceHostState, isHost, setContinuousLocal, speakerId, attachAudioForRecording, detachAudioForRecording, refreshDevices]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    return new Promise((resolve) => {
      rec.onstop = async () => {
        try {
          const blob = new Blob(recChunksRef.current, { type: rec.mimeType || "audio/webm" });
          // Cleanup graph
          for (const src of recSourcesRef.current.values()) { try { src.disconnect(); } catch (_) {} }
          recSourcesRef.current.clear();
          try { audioCtxRef.current?.close(); } catch (_) {}
          audioCtxRef.current = null; mixDestRef.current = null;
          recorderRef.current = null;
          setRecording(false);

          if (blob.size < 500) { toast.error("Recording was empty"); resolve(); return; }
          // Upload
          setUploading(true);
          const fd = new FormData();
          const ext = blob.type.includes("webm") ? "webm" : (blob.type.includes("ogg") ? "ogg" : "webm");
          fd.append("file", blob, `rec.${ext}`);
          fd.append("duration_sec", String(Math.max(0, Math.floor((Date.now() - recStartTimeRef.current) / 1000))));
          fd.append("started_at", new Date(recStartTimeRef.current).toISOString());
          fd.append("ext", ext);
          try {
            await api.post("/admin/recordings", fd, { headers: { "Content-Type": "multipart/form-data" } });
            toast.success("Recording saved");
          } catch (e) { toast.error(formatApiError(e)); }
          finally { setUploading(false); }
        } finally { resolve(); }
      };
      try { rec.stop(); } catch (_) { resolve(); }
    });
  }, []);

  const startRecording = useCallback(async () => {
    if (!isHost) return;
    if (recorderRef.current) return;
    const room = roomRef.current;
    if (!room) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = ctx.createMediaStreamDestination();
      audioCtxRef.current = ctx;
      mixDestRef.current = dest;

      // Add local mic
      const localPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (localPub?.track?.mediaStreamTrack) {
        const s = new MediaStream([localPub.track.mediaStreamTrack]);
        const src = ctx.createMediaStreamSource(s);
        src.connect(dest);
        recSourcesRef.current.set("__local__", src);
      }
      // Add all remote audio tracks
      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => {
          if (pub.track && pub.kind === Track.Kind.Audio) {
            try {
              const s = new MediaStream([pub.track.mediaStreamTrack]);
              const src = ctx.createMediaStreamSource(s);
              src.connect(dest);
              recSourcesRef.current.set(pub.track.sid, src);
            } catch (_) {}
          }
        });
      });

      let mimeType = "audio/webm;codecs=opus";
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "";
      const rec = new MediaRecorder(dest.stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
      recChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunksRef.current.push(e.data); };
      rec.start(1000);
      recorderRef.current = rec;
      recStartTimeRef.current = Date.now();
      setRecording(true);
      toast.success("Recording started");
    } catch (e) {
      toast.error(`Could not start recording: ${e.message || e}`);
      try { audioCtxRef.current?.close(); } catch (_) {}
      audioCtxRef.current = null; mixDestRef.current = null;
    }
  }, [isHost]);

  const disconnect = useCallback(async () => {
    if (recorderRef.current) { try { await stopRecording(); } catch (_) {} }
    if (sessionIdRef.current) {
      try { await api.post("/room/session/end", { session_id: sessionIdRef.current }); } catch (_) {}
      sessionIdRef.current = null;
    }
    try { const c = audioContainerRef.current; if (c) while (c.firstChild) c.removeChild(c.firstChild); } catch (_) {}
    try { await roomRef.current?.disconnect(); } catch (_) {}
    roomRef.current = null; micTrackRef.current = null;
    talkingRef.current = false; continuousRef.current = false;
    isBroadcastingRef.current = false;
    grantedRef.current = new Set();
    setIsTalking(false); setContinuousMic(false);
    setHostBroadcasting(false); setGrantedByHost(false);
    setGrantedMicSet(new Set());
    setState("idle"); setParticipants([]);
  }, [stopRecording]);

  // Spacebar PTT (users only, admin uses toggle)
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

  // ---------- Pre-connect view ----------
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
            <Button variant="outline" onClick={() => navigate(user?.role === "room_admin" ? "/admin" : "/rooms")} className="rounded-md border-[#E8E8E3]">Back</Button>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="max-w-md w-full text-center">
            <div className="text-[11px] tracking-widest uppercase text-[#666] mb-3" data-testid={TID.roomStatusIndicator}>
              {roomMeta ? `Ready · ${roomMeta.name}` : "Ready to join"}
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-3">{isHost ? "Enter as host" : "Join the channel"}</h1>
            <p className="text-sm text-[#666] mb-8 leading-relaxed">
              Your browser will ask for microphone access. Hold the{" "}
              <kbd className="font-mono bg-[#F2F2F0] border border-[#E8E8E3] rounded px-1.5 py-0.5 text-xs">Space</kbd>{" "}
              bar (or the on-screen button) to speak.
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
      {/* Broadcasting banner — visible when host is on open-mic */}
      {hostBroadcasting && (
        <div data-testid={TID.roomHostBroadcastBanner} className="bg-[#C84C4C] text-white px-6 py-2 flex items-center justify-center gap-2 text-[11px] tracking-widest uppercase font-bold">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          {isHost ? "You are broadcasting" : `${hostBroadcasterName || "Host"} is broadcasting`}
        </div>
      )}
      {!isHost && grantedByHost && !hostBroadcasting && (
        <div className="bg-[#4C7D5B] text-white px-6 py-2 flex items-center justify-center gap-2 text-[11px] tracking-widest uppercase font-bold">
          <Mic className="w-3 h-3" strokeWidth={2.5} /> The host has given you the mic — talk freely
        </div>
      )}

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
                {recording && <span className="ml-3 text-[#C84C4C] font-bold">● REC</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isHost && (
              <Button
                data-testid={TID.roomRecordToggle}
                variant="outline"
                onClick={recording ? stopRecording : startRecording}
                disabled={uploading}
                className={`rounded-md h-9 ${recording ? "border-[#C84C4C]/40 text-[#C84C4C] hover:bg-[#FBEDED]" : "border-[#E8E8E3]"}`}
              >
                {recording ? <><Square className="w-3.5 h-3.5 mr-1.5 fill-current" strokeWidth={0} /> Stop</> : uploading ? "Uploading…" : <><CircleDot className="w-3.5 h-3.5 mr-1.5" strokeWidth={2} /> Record</>}
              </Button>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button data-testid={TID.roomDevicePicker} variant="outline" size="icon" className="rounded-md border-[#E8E8E3] h-9 w-9" onClick={refreshDevices}>
                  <Settings className="w-4 h-4" strokeWidth={1.75} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 bg-white border-[#E8E8E3] rounded-md">
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] tracking-widest uppercase text-[#666] mb-1.5">Microphone</div>
                    <Select value={micId} onValueChange={changeMic}>
                      <SelectTrigger data-testid={TID.roomMicSelect} className="h-9 rounded-md border-[#E8E8E3] text-sm">
                        <SelectValue placeholder="Default" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {devices.mics.map((d) => <SelectItem key={d.deviceId} value={d.deviceId || "default"}>{d.label || "Microphone"}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className="text-[11px] tracking-widest uppercase text-[#666] mb-1.5">Speaker</div>
                    <Select value={speakerId} onValueChange={changeSpeaker}>
                      <SelectTrigger data-testid={TID.roomSpeakerSelect} className="h-9 rounded-md border-[#E8E8E3] text-sm">
                        <SelectValue placeholder="Default" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {devices.speakers.length === 0 && <SelectItem value="default">Default</SelectItem>}
                        {devices.speakers.map((d) => <SelectItem key={d.deviceId} value={d.deviceId || "default"}>{d.label || "Speaker"}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <Button data-testid={TID.roomLeave} variant="outline" onClick={disconnect} className="rounded-md border-[#C84C4C]/40 text-[#C84C4C] hover:bg-[#FBEDED] h-9">
              <PhoneOff className="w-4 h-4 mr-1.5" /> Leave
            </Button>
          </div>
        </div>
      </header>

      <div ref={audioContainerRef} data-lk-audio-sink aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} />

      <div className="flex-1 max-w-6xl mx-auto w-full px-8 py-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4" data-testid={TID.roomParticipantList}>
          {participants.map((p) => {
            const granted = grantedMicSet.has(p.identity);
            return (
              <div key={p.identity} className={`bg-white border rounded-md p-5 flex flex-col items-start gap-3 transition-colors duration-200 ${p.isSpeaking && !p.isMuted ? "border-[#4C7D5B] speaking-ring" : "border-[#E8E8E3]"}`}>
                <div className="w-full flex items-center justify-between">
                  <div className="w-11 h-11 rounded-md bg-[#F2F2F0] flex items-center justify-center font-bold text-[#111]">
                    {p.name.split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase()}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.role === "room_admin" && <span className="text-[10px] tracking-widest uppercase text-[#3A4F41] border border-[#3A4F41]/40 rounded-sm px-1.5 py-0.5">Host</span>}
                    {granted && p.role !== "room_admin" && <span className="text-[10px] tracking-widest uppercase text-[#4C7D5B] border border-[#4C7D5B]/40 rounded-sm px-1.5 py-0.5">Open mic</span>}
                  </div>
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
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button data-testid={`${TID.participantGrantMicPrefix}${p.identity}`} size="sm" variant="outline" onClick={() => toggleGrantMic(p.identity, !granted)} className={`h-7 text-[11px] rounded-md ${granted ? "border-[#4C7D5B] text-[#4C7D5B]" : "border-[#E8E8E3]"}`}>
                      <Zap className="w-3 h-3 mr-1" strokeWidth={2} /> {granted ? "Revoke" : "Give mic"}
                    </Button>
                    <Button data-testid={`${TID.participantMutePrefix}${p.identity}`} size="sm" variant="outline" onClick={() => handleMuteRemote(p)} className="h-7 text-[11px] rounded-md border-[#E8E8E3]">
                      <VolumeX className="w-3 h-3 mr-1" strokeWidth={2} /> Mute
                    </Button>
                    <Button data-testid={`${TID.participantKickPrefix}${p.identity}`} size="sm" variant="outline" onClick={() => setParticipantToKick(p)} className="h-7 text-[11px] rounded-md border-[#E8E8E3] hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]">
                      <UserX className="w-3 h-3 mr-1" strokeWidth={2} /> Kick
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* PTT bar */}
      <div className="sticky bottom-0 left-0 right-0 px-8 pb-8 pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          {isHost && (
            <div className="mb-3 flex items-center justify-end gap-3 text-[11px] tracking-widest uppercase text-[#666]">
              <Zap className={`w-3.5 h-3.5 ${continuousMic ? "text-[#4C7D5B]" : "text-[#666]"}`} strokeWidth={2} />
              <span>Open mic</span>
              <Switch data-testid={TID.roomContinuousToggle} checked={continuousMic} onCheckedChange={toggleContinuous} className="data-[state=checked]:bg-[#4C7D5B]" />
            </div>
          )}
          <div className="bg-[#111] text-[#FCFCFB] rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.18)] px-2 py-2 flex items-center justify-between gap-3">
            <div className="pl-4 pr-2 text-[11px] tracking-widest uppercase opacity-70 hidden sm:block">
              {listenerOnly && !continuousMic ? "Listener mode" : (continuousMic ? "Mic open" : (<>Hold <kbd className="font-mono bg-white/10 border border-white/20 rounded px-1.5 py-0.5 text-[10px] ml-1">Space</kbd></>))}
            </div>
            <button
              data-testid={TID.roomPttButton}
              onMouseDown={startTalking}
              onMouseUp={stopTalking}
              onMouseLeave={stopTalking}
              onTouchStart={(e) => { e.preventDefault(); startTalking(); }}
              onTouchEnd={(e) => { e.preventDefault(); stopTalking(); }}
              disabled={continuousMic || (listenerOnly && !continuousMic)}
              className={`flex-1 rounded-full py-4 font-extrabold tracking-widest uppercase text-sm select-none transition-colors ${
                listenerOnly && !continuousMic ? "bg-white/5 text-white/50 cursor-not-allowed"
                : continuousMic ? "bg-[#4C7D5B] text-white cursor-default"
                : isTalking ? "bg-[#4C7D5B] text-white" : "bg-white/10 text-white hover:bg-white/15"
              }`}
              style={{ WebkitUserSelect: "none", touchAction: "none" }}
            >
              {listenerOnly && !continuousMic ? (<><MicOff className="w-4 h-4 inline mr-2" strokeWidth={2.25} /> Listening only</>)
                : continuousMic ? (<><Mic className="w-4 h-4 inline mr-2" strokeWidth={2.25} /> Broadcasting…</>)
                : isTalking ? (<><Mic className="w-4 h-4 inline mr-2" strokeWidth={2.25} /> Talking…</>)
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
            <AlertDialogDescription className="text-[#666]">They will be disconnected immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-md">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid={TID.participantKickConfirm} onClick={doKick} className="rounded-md bg-[#C84C4C] hover:bg-[#a63c3c] text-white">Kick</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
