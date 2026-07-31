import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Room, RoomEvent, Track, ConnectionState } from "livekit-client";
import { Mic, MicOff, PhoneOff, Radio, Volume2, VolumeX, UserX, Loader2, Zap, Settings, CircleDot, Square, Users2, Play, Pause, Download, Trash2, FileAudio2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TID } from "@/lib/testIds";
import { listClips, addClip, deleteClip } from "@/lib/clipStore";
import { toast } from "sonner";

/**
 * ClipRow — one row in the "My PTT clips" popover for regular users.
 * Play/pause via a lazily-created blob URL, download link, delete button.
 */
function ClipRow({ clip, index, onDelete }) {
  const audioRef = useRef(null);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const u = URL.createObjectURL(clip.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [clip.blob]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => {}); }
    else { a.pause(); setPlaying(false); }
  };

  const secs = (clip.duration_ms / 1000).toFixed(1);
  const kb = (clip.size / 1024).toFixed(1);
  const when = new Date(clip.created_at);
  const filename = `talknet-clip-${when.toISOString().replace(/[:.]/g, "-")}.${clip.mime_type.includes("webm") ? "webm" : "ogg"}`;

  return (
    <li data-testid={`${TID.myClipsRowPrefix}${index}`} className="flex items-center gap-2 px-4 py-2.5">
      <Button
        data-testid={`${TID.myClipsPlayPrefix}${index}`}
        variant="outline"
        size="sm"
        onClick={toggle}
        className="h-8 w-8 p-0 shrink-0 rounded-full border-[#E8E8E3]"
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </Button>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-[#111] truncate">
          {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          <span className="ml-2 text-[10px] font-mono text-[#666] tracking-widest uppercase">{secs}s · {kb} KB</span>
        </div>
        <div className="text-[10px] font-mono text-[#666] truncate">{when.toLocaleDateString()}</div>
      </div>
      <a
        data-testid={`${TID.myClipsDownloadPrefix}${index}`}
        href={url}
        download={filename}
        className="h-8 w-8 shrink-0 rounded-md border border-[#E8E8E3] flex items-center justify-center hover:bg-[#F2F2F0] text-[#666]"
        title="Download"
      >
        <Download className="w-3.5 h-3.5" />
      </a>
      <Button
        data-testid={`${TID.myClipsDeletePrefix}${index}`}
        variant="outline"
        size="sm"
        onClick={onDelete}
        className="h-8 w-8 p-0 shrink-0 rounded-md border-[#E8E8E3] hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]"
        title="Delete"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
      <audio ref={audioRef} src={url} preload="none" onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} className="hidden" />
    </li>
  );
}


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

  // Speaker history — last N unique-by-identity speakers, most recent first
  const [speakerHistory, setSpeakerHistory] = useState([]); // { identity, name, email, role, at }
  const speakerHistoryRef = useRef([]);
  const lastSpokeAtRef = useRef({}); // { [identity]: timestamp } — tracks last-active moment for 2.5s color persistence
  const [nowTick, setNowTick] = useState(Date.now());

  const roomRef = useRef(null);
  const micTrackRef = useRef(null);
  const talkingRef = useRef(false);
  // ─── User-side per-PTT clip recorder (client-only, IndexedDB) ───
  const clipRecorderRef = useRef(null);
  const clipChunksRef = useRef([]);
  const clipCtxRef = useRef(null);
  const clipDestRef = useRef(null);
  const clipSourcesRef = useRef(new Map());
  const clipStopTimerRef = useRef(null);
  const clipStartAtRef = useRef(0);
  const [clips, setClips] = useState([]);
  const [clipsOpen, setClipsOpen] = useState(false);
  const [isClipRecording, setIsClipRecording] = useState(false);
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

  // Tick every 500ms — needed so the 2.5s speaking-color persistence and "N s ago" strip stay accurate.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // ---------- Participants snapshot ----------
  const refreshParticipants = useCallback(() => {
    const r = roomRef.current;
    if (!r) return;
    const build = (p, isLocal) => {
      let meta = {};
      try { meta = p.metadata ? JSON.parse(p.metadata) : {}; } catch (_) {}
      let pubs = [];
      try {
        if (p.trackPublications && typeof p.trackPublications.forEach === "function") {
          p.trackPublications.forEach((v) => pubs.push(v));
        } else if (p.audioTrackPublications && typeof p.audioTrackPublications.forEach === "function") {
          p.audioTrackPublications.forEach((v) => pubs.push(v));
        }
      } catch (_) {}
      const audioPub = pubs.find((x) => x.kind === Track.Kind.Audio || x.source === Track.Source.Microphone) || pubs[0];
      return {
        identity: p.identity,
        name: meta.name || p.name || p.identity,
        email: meta.email || meta.username || "",
        role: meta.role || (isLocal ? user?.role : "user"),
        isLocal,
        isSpeaking: !!p.isSpeaking,
        isMuted: audioPub ? !!audioPub.isMuted : true,
        trackSid: audioPub?.trackSid,
        connectionQuality: p.connectionQuality || "unknown",
      };
    };
    const list = [build(r.localParticipant, true)];
    const remotes = r.remoteParticipants;
    if (remotes) {
      if (typeof remotes.forEach === "function") {
        remotes.forEach((p) => list.push(build(p, false)));
      } else if (typeof remotes === "object") {
        Object.values(remotes).forEach((p) => list.push(build(p, false)));
      }
    }
    setParticipants(list);

    // Update per-identity last-spoke timestamps (used for 2.5s color persistence after speech ends).
    const nowTs = Date.now();
    for (const p of list) {
      if (p.isSpeaking && !p.isMuted) lastSpokeAtRef.current[p.identity] = nowTs;
    }

    // Track speaker history — de-dupe head, cap at 10, debounce 1.5s
    const speaking = list.filter((p) => p.isSpeaking && !p.isMuted);
    if (speaking.length) {
      const now = Date.now();
      const cur = speakerHistoryRef.current;
      const next = [...cur];
      let changed = false;
      for (const sp of speaking) {
        const idx = next.findIndex((e) => e.identity === sp.identity);
        if (idx === 0 && now - next[0].at < 1500) continue;
        if (idx >= 0) next.splice(idx, 1);
        next.unshift({ identity: sp.identity, name: sp.name, email: sp.email, role: sp.role, at: now });
        changed = true;
      }
      if (changed) {
        speakerHistoryRef.current = next.slice(0, 10);
        setSpeakerHistory(speakerHistoryRef.current);
      }
    }
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
  // ═══════════════════════════════════════════════════════════════════
  // USER-SIDE CLIP RECORDER — captures composite (local mic + all remote)
  // on every PTT press. Stops 5s after release. Stored in IndexedDB only.
  // ═══════════════════════════════════════════════════════════════════
  const startClipRecording = useCallback(async () => {
    if (isHost) return;
    if (clipRecorderRef.current) return;
    const room = roomRef.current;
    if (!room) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const dest = ctx.createMediaStreamDestination();
      clipCtxRef.current = ctx;
      clipDestRef.current = dest;
      clipSourcesRef.current = new Map();

      // Local mic
      const localPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (localPub?.track?.mediaStreamTrack) {
        try {
          const s = new MediaStream([localPub.track.mediaStreamTrack]);
          const src = ctx.createMediaStreamSource(s);
          src.connect(dest);
          clipSourcesRef.current.set("__local__", src);
        } catch (_) {}
      }
      // All remote audio tracks
      room.remoteParticipants.forEach((p) => {
        p.trackPublications.forEach((pub) => {
          if (pub.track && pub.kind === Track.Kind.Audio) {
            try {
              const s = new MediaStream([pub.track.mediaStreamTrack]);
              const src = ctx.createMediaStreamSource(s);
              src.connect(dest);
              clipSourcesRef.current.set(pub.track.sid, src);
            } catch (_) {}
          }
        });
      });

      let mimeType = "audio/webm;codecs=opus";
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "";
      const rec = new MediaRecorder(dest.stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
      clipChunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) clipChunksRef.current.push(e.data); };
      rec.start(1000);
      clipRecorderRef.current = rec;
      clipStartAtRef.current = Date.now();
      setIsClipRecording(true);
    } catch (e) {
      try { clipCtxRef.current?.close(); } catch (_) {}
      clipCtxRef.current = null; clipDestRef.current = null;
    }
  }, [isHost]);

  const stopClipRecording = useCallback(async () => {
    const rec = clipRecorderRef.current;
    if (!rec) return;
    return new Promise((resolve) => {
      rec.onstop = async () => {
        try {
          const mimeType = rec.mimeType || "audio/webm";
          const blob = new Blob(clipChunksRef.current, { type: mimeType });
          for (const src of clipSourcesRef.current.values()) { try { src.disconnect(); } catch (_) {} }
          clipSourcesRef.current.clear();
          try { clipCtxRef.current?.close(); } catch (_) {}
          clipCtxRef.current = null; clipDestRef.current = null;
          clipRecorderRef.current = null;
          clipChunksRef.current = [];
          setIsClipRecording(false);
          if (blob.size < 800) { resolve(); return; }
          const clip = {
            id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`),
            room_id: roomId,
            room_name: roomMeta?.name || "",
            created_at: new Date().toISOString(),
            duration_ms: Math.max(0, Date.now() - clipStartAtRef.current),
            size: blob.size,
            mime_type: mimeType,
            blob,
          };
          try {
            await addClip(clip);
            setClips((prev) => [clip, ...prev]);
            toast.success(`Clip saved · ${(clip.duration_ms / 1000).toFixed(1)}s`);
          } catch (e) { /* silent — recording is best-effort */ }
        } finally { resolve(); }
      };
      try { rec.stop(); } catch (_) { resolve(); }
    });
  }, [roomId, roomMeta]);

  // Load existing clips on mount (users only).
  useEffect(() => {
    if (isHost) return;
    listClips(roomId).then(setClips).catch(() => {});
  }, [isHost, roomId]);

  const handleDeleteClip = useCallback(async (id) => {
    try { await deleteClip(id); setClips((prev) => prev.filter((c) => c.id !== id)); toast.success("Clip deleted"); }
    catch { toast.error("Could not delete clip"); }
  }, []);

  const startTalking = useCallback(async () => {
    if (continuousRef.current) return;
    if (talkingRef.current) return;
    // Listener-only users cannot talk (Plan C), unless the host has granted them a mic
    if (listenerOnly && !continuousRef.current) return;
    const t = micTrackRef.current; if (!t) return;
    talkingRef.current = true; setIsTalking(true);
    try { await t.unmute(); } catch (_) {}
    // ─── User-side clip recorder: start on press, or extend if within the 5s grace window
    if (!isHost) {
      if (clipStopTimerRef.current) { clearTimeout(clipStopTimerRef.current); clipStopTimerRef.current = null; }
      if (!clipRecorderRef.current) {
        try { await startClipRecording(); } catch (_) {}
      }
    }
  }, [listenerOnly, isHost]);

  const stopTalking = useCallback(async () => {
    if (continuousRef.current) return;
    if (!talkingRef.current) return;
    talkingRef.current = false; setIsTalking(false);
    const t = micTrackRef.current; if (t) { try { await t.mute(); } catch (_) {} }
    // ─── User-side clip recorder: stop 5s after release (extendable)
    if (!isHost && clipRecorderRef.current && !clipStopTimerRef.current) {
      clipStopTimerRef.current = setTimeout(() => {
        clipStopTimerRef.current = null;
        stopClipRecording().catch(() => {});
      }, 5000);
    }
  }, [isHost]);

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
        .on(RoomEvent.ConnectionQualityChanged, refreshParticipants)
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
    // Cancel any pending clip stop and flush current clip if any
    if (clipStopTimerRef.current) { clearTimeout(clipStopTimerRef.current); clipStopTimerRef.current = null; }
    if (clipRecorderRef.current) { try { await stopClipRecording(); } catch (_) {} }
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
  }, [stopRecording, stopClipRecording]);

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
    <div className="h-screen bg-[#FCFCFB] flex flex-col overflow-hidden">
      {/* Broadcasting banner — visible when host is on open-mic */}
      {hostBroadcasting && (
        <div data-testid={TID.roomHostBroadcastBanner} className="bg-[#C84C4C] text-white px-6 py-2 flex items-center justify-center gap-2 text-[11px] tracking-widest uppercase font-bold shrink-0">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          {isHost ? "You are broadcasting" : `${hostBroadcasterName || "Host"} is broadcasting`}
        </div>
      )}
      {!isHost && grantedByHost && !hostBroadcasting && (
        <div className="bg-[#4C7D5B] text-white px-6 py-2 flex items-center justify-center gap-2 text-[11px] tracking-widest uppercase font-bold shrink-0">
          <Mic className="w-3 h-3" strokeWidth={2.5} /> The host has given you the mic — talk freely
        </div>
      )}

      <header className="border-b border-[#E8E8E3] bg-white shrink-0">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-[#3A4F41] flex items-center justify-center">
              <Radio className="w-4 h-4 text-[#FCFCFB]" strokeWidth={1.75} />
            </div>
            <div>
              <div className="font-extrabold tracking-tight leading-tight">{roomMeta?.name}</div>
              <div className="text-[11px] tracking-widest uppercase text-[#666]" data-testid={TID.roomStatusIndicator}>
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#4C7D5B] mr-1.5 align-middle animate-pulse" />
                Live · {isHost ? `${participants.length} ${participants.length === 1 ? "person" : "people"}` : `Host + you`}
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
            {!isHost && (
              <Popover open={clipsOpen} onOpenChange={setClipsOpen}>
                <PopoverTrigger asChild>
                  <Button data-testid={TID.myClipsTrigger} variant="outline" className="rounded-md border-[#E8E8E3] h-9 relative">
                    <FileAudio2 className="w-4 h-4 mr-1.5" strokeWidth={1.75} />
                    <span className="text-[11px] tracking-widest uppercase">My clips</span>
                    {clips.length > 0 && (
                      <span data-testid={TID.myClipsCount} className="ml-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#3A4F41] text-white text-[10px] font-bold inline-flex items-center justify-center">{clips.length}</span>
                    )}
                    {isClipRecording && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#C84C4C] animate-pulse" title="Recording…" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[22rem] p-0 bg-white border-[#E8E8E3] rounded-md" data-testid={TID.myClipsPanel}>
                  <div className="px-4 py-3 border-b border-[#E8E8E3] flex items-center gap-2">
                    <FileAudio2 className="w-4 h-4 text-[#3A4F41]" strokeWidth={1.75} />
                    <div className="text-[11px] tracking-widest uppercase text-[#666]">Your PTT clips</div>
                    <div className="ml-auto text-[10px] tracking-widest uppercase text-[#666]">{clips.length} saved</div>
                  </div>
                  {clips.length === 0 ? (
                    <div className="p-6 text-center text-sm text-[#666] italic">
                      No clips yet. Press <kbd className="font-mono bg-[#F2F2F0] border border-[#E8E8E3] rounded px-1.5 py-0.5 text-xs">Space</kbd> to talk — a clip is auto-recorded on every press.
                    </div>
                  ) : (
                    <ol className="max-h-[24rem] overflow-y-auto divide-y divide-[#E8E8E3]">
                      {clips.map((clip, i) => (
                        <ClipRow
                          key={clip.id}
                          clip={clip}
                          index={i}
                          onDelete={() => handleDeleteClip(clip.id)}
                        />
                      ))}
                    </ol>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <Button data-testid={TID.roomLeave} variant="outline" onClick={disconnect} className="rounded-md border-[#C84C4C]/40 text-[#C84C4C] hover:bg-[#FBEDED] h-9">
              <PhoneOff className="w-4 h-4 mr-1.5" /> Leave
            </Button>
          </div>
        </div>
      </header>

      {/* Host Live — thin status strip below header (admin only). Replaces the Recent Speakers bar. */}
      {isHost && (() => {
        const hostP = participants.find((p) => p.role === "room_admin" && p.isLocal) || participants.find((p) => p.role === "room_admin");
        const lastHostSpoke = hostP ? (lastSpokeAtRef.current[hostP.identity] || 0) : 0;
        const hostSpeakingActive = hostP && ((hostP.isSpeaking || (nowTick - lastHostSpoke < 2500)) && !hostP.isMuted);
        const stateLabel = !hostP ? "Off-air" : hostSpeakingActive ? "Speaking" : hostP.isMuted ? "Muted" : "Live";
        const stateColor = !hostP ? "bg-[#B0B0B0]" : hostSpeakingActive ? "bg-[#E68A3B]" : hostP.isMuted ? "bg-[#C84C4C]" : "bg-[#4C7D5B]";
        return (
          <div data-testid={TID.hostLiveStrip} data-host-state={stateLabel.toLowerCase()} className="border-b border-[#E8E8E3] bg-[#F7F7F4] shrink-0">
            <div className="max-w-6xl mx-auto px-4 sm:px-8 py-1.5 flex items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1.5 shrink-0 tracking-widest uppercase text-[#666]">
                <span className={`w-2 h-2 rounded-full ${stateColor} ${hostSpeakingActive ? "animate-pulse" : ""}`} aria-hidden="true" />
                <span className="font-semibold text-[#111]">Host</span>
                <span className="text-[#666]">·</span>
                <span className="text-[#111]">{stateLabel}</span>
              </div>
              {hostP && (
                <div className="flex items-center gap-1.5 min-w-0 text-[#666]">
                  <span className="hidden sm:inline">·</span>
                  <span className="font-semibold text-[#111] truncate max-w-[12rem]" title={hostP.name}>{hostP.name}</span>
                  {hostP.email && <span className="font-mono text-[10px] hidden sm:inline truncate max-w-[14rem]" title={hostP.email}>{hostP.email}</span>}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div ref={audioContainerRef} data-lk-audio-sink aria-hidden="true" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} />

      <main className="flex-1 min-h-0 max-w-6xl mx-auto w-full px-4 sm:px-8 py-4 flex flex-col gap-3 overflow-hidden">
        {/* ─── ADMIN SECTION — always visible at the top ─── */}
        {(() => {
          const admins = participants.filter((p) => p.role === "room_admin");
          const users = participants.filter((p) => p.role !== "room_admin");
          // Non-admin viewer only ever sees admin + themselves.
          const visibleUsers = isHost ? users : users.filter((p) => p.isLocal);

          // Admin view: rank the top-3 most recent speakers among users, sort them to the top.
          // Non-admin view: no reordering.
          const rankMap = {};
          if (isHost) {
            let r = 1;
            for (const s of speakerHistory) {
              if (r > 3) break;
              // Only rank users (skip host from ranking) and only if they are visible in the users grid.
              const inUsers = users.some((u) => u.identity === s.identity);
              if (!inUsers) continue;
              if (rankMap[s.identity]) continue;
              rankMap[s.identity] = r++;
            }
          }
          const orderedUsers = isHost
            ? [...visibleUsers].sort((a, b) => {
                const ra = rankMap[a.identity] || 99;
                const rb = rankMap[b.identity] || 99;
                return ra - rb;
              })
            : visibleUsers;

          // Admin view: layout mirrors user's spec — Host on top, then rows of 3 users each.
          // Non-admin view: keep the previous auto-scale behavior.
          const userGridCols = isHost ? 3 : Math.min(6, Math.max(1, Math.ceil(Math.sqrt(visibleUsers.length || 1))));
          const compact = visibleUsers.length > 9;

          const getCardState = (p) => {
            const lastSpoke = lastSpokeAtRef.current[p.identity] || 0;
            const justSpoke = nowTick - lastSpoke < 2500;
            const speakingActive = (p.isSpeaking || justSpoke) && !p.isMuted;
            if (speakingActive) {
              return p.role === "room_admin"
                ? { key: "speaking-admin", card: "bg-[#E68A3B] border-[#B87226] text-white", colored: true, label: "Speaking", Icon: Volume2 }
                : { key: "speaking-user", card: "bg-[#4C7D5B] border-[#3A6046] text-white", colored: true, label: "Speaking", Icon: Volume2 };
            }
            if (p.isMuted) {
              return { key: "muted", card: "bg-[#C84C4C] border-[#a63c3c] text-white", colored: true, label: "Muted", Icon: MicOff };
            }
            return { key: "idle", card: "bg-white border-[#E8E8E3] text-[#111]", colored: false, label: "Idle", Icon: Mic };
          };

          /**
           * Map LiveKit ConnectionQuality → 3-level UI signal.
           *  excellent/good → 🟢 Good, poor → 🟡 Weak, lost/unknown → 🔴 Poor.
           */
          const getQuality = (q) => {
            switch (q) {
              case "excellent":
              case "good":
                return { level: "good", label: "Good", dot: "bg-[#4C7D5B]", ring: "ring-[#4C7D5B]/40", emoji: "🟢" };
              case "poor":
                return { level: "weak", label: "Weak", dot: "bg-[#E5B93B]", ring: "ring-[#E5B93B]/40", emoji: "🟡" };
              default:
                return { level: "poor", label: "Poor", dot: "bg-[#C84C4C]", ring: "ring-[#C84C4C]/40", emoji: "🔴" };
            }
          };

          const renderCard = (p, size /* 'large' | 'normal' | 'compact' */) => {
            const st = getCardState(p);
            const granted = grantedMicSet.has(p.identity);
            const c = size === "compact";
            const lg = size === "large";
            const initials = p.name.split(" ").slice(0, 2).map((s) => s[0]).join("").toUpperCase() || "?";
            const subText = st.colored ? "text-white/75" : "text-[#666]";
            const outlineBtn = st.colored
              ? "border-white/40 text-white hover:bg-white/10"
              : "border-[#E8E8E3]";
            const rank = rankMap[p.identity]; // 1 | 2 | 3 | undefined
            const rankColors = { 1: "bg-[#D4A94A] text-white", 2: "bg-[#B0B0B0] text-white", 3: "bg-[#B87226] text-white" };
            return (
              <div
                key={p.identity}
                data-testid={`${TID.participantCardPrefix}${p.identity}`}
                data-state={st.key}
                data-rank={rank || undefined}
                className={`relative border rounded-md ${c ? "p-2" : lg ? "p-4 sm:p-5" : "p-3 sm:p-4"} flex flex-col justify-between gap-1.5 min-w-0 min-h-0 overflow-hidden transition-colors duration-300 ${st.card} ${rank ? "ring-2 ring-offset-1 ring-[#D4A94A]/60" : ""}`}
              >
                {rank && (
                  <span
                    data-testid={`${TID.participantRankPrefix}${p.identity}`}
                    data-rank-number={rank}
                    className={`absolute top-1 left-1 ${c ? "w-5 h-5 text-[10px]" : "w-6 h-6 text-xs"} rounded-full ${rankColors[rank]} flex items-center justify-center font-extrabold shadow-sm z-10`}
                    title={rank === 1 ? "Most recent speaker" : rank === 2 ? "2nd most recent" : "3rd most recent"}
                  >
                    #{rank}
                  </span>
                )}
                <div className="w-full flex items-start justify-between gap-2 min-w-0">
                  <div className={`${c ? "w-8 h-8 text-xs" : lg ? "w-12 h-12 sm:w-14 sm:h-14 text-base" : "w-10 h-10 sm:w-11 sm:h-11"} shrink-0 rounded-md font-bold flex items-center justify-center ${st.colored ? "bg-white/25 text-white" : "bg-[#F2F2F0] text-[#111]"}`}>
                    {initials}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {(() => {
                      const q = getQuality(p.connectionQuality);
                      return (
                        <span
                          data-testid={`${TID.participantQualityPrefix}${p.identity}`}
                          data-quality={q.level}
                          title={`Network: ${q.label}`}
                          className={`inline-flex items-center gap-1 text-[9px] tracking-widest uppercase rounded-sm px-1 py-0.5 border ${st.colored ? "border-white/50 text-white" : "border-[#E8E8E3] text-[#666]"}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${q.dot} ring-2 ${q.ring}`} aria-hidden="true" />
                          {q.label}
                        </span>
                      );
                    })()}
                    {p.role === "room_admin" && (
                      <span className={`text-[9px] tracking-widest uppercase rounded-sm px-1 py-0.5 border ${st.colored ? "border-white/50 text-white" : "border-[#3A4F41]/40 text-[#3A4F41]"}`}>Host</span>
                    )}
                    {granted && p.role !== "room_admin" && (
                      <span className={`text-[9px] tracking-widest uppercase rounded-sm px-1 py-0.5 border ${st.colored ? "border-white/50 text-white" : "border-[#4C7D5B]/40 text-[#4C7D5B]"}`}>Mic</span>
                    )}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className={`font-semibold ${c ? "text-xs" : lg ? "text-base" : "text-sm"} leading-tight truncate`}>
                    {p.name} {p.isLocal && <span className={`font-normal ${subText}`}>(you)</span>}
                  </div>
                  {p.email && !c && <div className={`text-[10px] font-mono truncate mt-0.5 ${subText}`} title={p.email}>{p.email}</div>}
                  <div className={`${c ? "text-[10px]" : "text-xs"} mt-0.5 inline-flex items-center gap-1`}>
                    <st.Icon className="w-3 h-3" strokeWidth={st.label === "Speaking" ? 2 : 1.75} />
                    {st.label}
                  </div>
                </div>
                {isHost && !p.isLocal && !c && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button data-testid={`${TID.participantGrantMicPrefix}${p.identity}`} size="sm" variant="outline" onClick={() => toggleGrantMic(p.identity, !granted)} className={`h-6 text-[10px] px-2 rounded-md ${outlineBtn} ${granted && !st.colored ? "border-[#4C7D5B] text-[#4C7D5B]" : ""}`}>
                      <Zap className="w-3 h-3 mr-0.5" strokeWidth={2} /> {granted ? "Revoke" : "Mic"}
                    </Button>
                    <Button data-testid={`${TID.participantMutePrefix}${p.identity}`} size="sm" variant="outline" onClick={() => handleMuteRemote(p)} className={`h-6 text-[10px] px-2 rounded-md ${outlineBtn}`}>
                      <VolumeX className="w-3 h-3 mr-0.5" strokeWidth={2} /> Mute
                    </Button>
                    <Button data-testid={`${TID.participantKickPrefix}${p.identity}`} size="sm" variant="outline" onClick={() => setParticipantToKick(p)} className={`h-6 text-[10px] px-2 rounded-md ${outlineBtn} ${!st.colored ? "hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]" : ""}`}>
                      <UserX className="w-3 h-3" strokeWidth={2} />
                    </Button>
                  </div>
                )}
                {isHost && !p.isLocal && c && (
                  <div className="flex gap-1">
                    <Button data-testid={`${TID.participantGrantMicPrefix}${p.identity}`} size="sm" variant="outline" onClick={() => toggleGrantMic(p.identity, !granted)} className={`h-6 w-6 p-0 rounded-md ${outlineBtn} ${granted && !st.colored ? "border-[#4C7D5B] text-[#4C7D5B]" : ""}`} title={granted ? "Revoke mic" : "Give mic"}>
                      <Zap className="w-3 h-3" strokeWidth={2} />
                    </Button>
                    <Button data-testid={`${TID.participantMutePrefix}${p.identity}`} size="sm" variant="outline" onClick={() => handleMuteRemote(p)} className={`h-6 w-6 p-0 rounded-md ${outlineBtn}`} title="Mute">
                      <VolumeX className="w-3 h-3" strokeWidth={2} />
                    </Button>
                    <Button data-testid={`${TID.participantKickPrefix}${p.identity}`} size="sm" variant="outline" onClick={() => setParticipantToKick(p)} className={`h-6 w-6 p-0 rounded-md ${outlineBtn} ${!st.colored ? "hover:bg-[#FBEDED] hover:text-[#C84C4C] hover:border-[#C84C4C]" : ""}`} title="Kick">
                      <UserX className="w-3 h-3" strokeWidth={2} />
                    </Button>
                  </div>
                )}
              </div>
            );
          };

          return (
            <>
              {/* Admin cards — pinned strip at the top, always visible. */}
              <section data-testid={TID.roomAdminSection} className="shrink-0">
                <div className="flex items-center gap-2 mb-1.5 text-[10px] tracking-widest uppercase text-[#666]">
                  <Radio className="w-3 h-3" strokeWidth={2} />
                  <span>Room Host</span>
                </div>
                {admins.length === 0 ? (
                  <div className="border border-dashed border-[#E8E8E3] rounded-md p-4 text-center text-sm text-[#666] italic bg-white">
                    Waiting for the room host to join…
                  </div>
                ) : (
                  <div
                    className="grid gap-2 sm:gap-3"
                    style={{ gridTemplateColumns: `repeat(${Math.min(admins.length, 3)}, minmax(0, 1fr))` }}
                  >
                    {admins.map((a) => renderCard(a, "large"))}
                  </div>
                )}
              </section>

              {/* User cards — flexible area below. For non-admin viewer this is just themselves. */}
              <section
                data-testid={TID.roomUserSection}
                className="flex-1 min-h-0 flex flex-col overflow-hidden"
              >
                <div className="flex items-center gap-2 mb-1.5 text-[10px] tracking-widest uppercase text-[#666] shrink-0">
                  <Users2 className="w-3 h-3" strokeWidth={2} />
                  <span>{isHost ? `Members (${visibleUsers.length})` : "You"}</span>
                </div>
                {visibleUsers.length === 0 ? (
                  <div className="flex-1 min-h-0 border border-dashed border-[#E8E8E3] rounded-md flex items-center justify-center text-sm text-[#666] italic bg-white">
                    {isHost ? "No members have joined yet." : "Waiting…"}
                  </div>
                ) : (
                  <div
                    className="flex-1 min-h-0 grid gap-2 sm:gap-3 overflow-hidden"
                    data-testid={TID.roomParticipantList}
                    style={{
                      gridTemplateColumns: `repeat(${userGridCols}, minmax(0, 1fr))`,
                      gridAutoRows: "minmax(0, 1fr)",
                    }}
                  >
                    {orderedUsers.map((u) => renderCard(u, compact ? "compact" : "normal"))}
                  </div>
                )}
              </section>
            </>
          );
        })()}
      </main>

      {/* PTT bar — pinned at the bottom, part of the flex column */}
      <div className="shrink-0 px-4 sm:px-8 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
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
