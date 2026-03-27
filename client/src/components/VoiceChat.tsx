"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Icon } from "@iconify/react";
import { getSocket } from "@/lib/socket";
import { useGameStore } from "@/lib/store";

interface VoiceUser {
  id: string;
  name: string;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function createVAD(stream: MediaStream, onSpeaking: (v: boolean) => void): () => void {
  let ctx: AudioContext | null = null;
  let animId: number;
  let speaking = false;

  try {
    ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const isSpeaking = avg > 12;
      if (isSpeaking !== speaking) {
        speaking = isSpeaking;
        onSpeaking(speaking);
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
  } catch {
    // AudioContext not available
  }

  return () => {
    cancelAnimationFrame(animId);
    ctx?.close();
  };
}

export default function VoiceChat() {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [joiningError, setJoiningError] = useState<string | null>(null);
  const [voiceUsers, setVoiceUsers] = useState<VoiceUser[]>([]);
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());

  const lobby = useGameStore((s) => s.lobby);
  const socket = getSocket();

  // Refs — mutable without triggering re-renders
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElemsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const localVadRef = useRef<(() => void) | null>(null);
  const remoteVadRefs = useRef<Map<string, () => void>>(new Map());

  const setSpeaking = useCallback((id: string, speaking: boolean) => {
    setSpeakingIds((prev) => {
      const next = new Set(prev);
      speaking ? next.add(id) : next.delete(id);
      return next;
    });
  }, []);

  // Create (or get existing) RTCPeerConnection for a peer
  const getOrCreatePeer = useCallback((peerId: string): RTCPeerConnection => {
    if (peerConnsRef.current.has(peerId)) return peerConnsRef.current.get(peerId)!;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnsRef.current.set(peerId, pc);

    // Add local tracks
    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    // ICE candidates → relay through server
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("voice:ice-candidate" as any, peerId, e.candidate.toJSON());
      }
    };

    // Incoming remote track → attach to <audio>
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;

      let audio = audioElemsRef.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audioElemsRef.current.set(peerId, audio);
      }
      audio.srcObject = stream;

      // VAD on remote stream
      const cleanup = remoteVadRefs.current.get(peerId);
      cleanup?.();
      const stop = createVAD(stream, (speaking) => setSpeaking(peerId, speaking));
      remoteVadRefs.current.set(peerId, stop);
    };

    return pc;
  }, [socket, setSpeaking]);

  const closePeer = useCallback((peerId: string) => {
    peerConnsRef.current.get(peerId)?.close();
    peerConnsRef.current.delete(peerId);
    audioElemsRef.current.get(peerId)?.remove();
    audioElemsRef.current.delete(peerId);
    remoteVadRefs.current.get(peerId)?.();
    remoteVadRefs.current.delete(peerId);
    setSpeaking(peerId, false);
  }, [setSpeaking]);

  // Attach socket signaling listeners
  useEffect(() => {
    const onUserJoined = async (user: VoiceUser) => {
      setVoiceUsers((prev) => [...prev.filter((u) => u.id !== user.id), user]);
      if (!joined) return;
      // We're already in voice — initiate connection to the new user
      const pc = getOrCreatePeer(user.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("voice:offer" as any, user.id, offer);
    };

    const onUserLeft = (userId: string) => {
      setVoiceUsers((prev) => prev.filter((u) => u.id !== userId));
      closePeer(userId);
    };

    const onOffer = async (fromId: string, sdp: RTCSessionDescriptionInit) => {
      if (!joined) return;
      const pc = getOrCreatePeer(fromId);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("voice:answer" as any, fromId, answer);
    };

    const onAnswer = async (fromId: string, sdp: RTCSessionDescriptionInit) => {
      const pc = peerConnsRef.current.get(fromId);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    };

    const onIce = async (fromId: string, candidate: RTCIceCandidateInit) => {
      const pc = peerConnsRef.current.get(fromId);
      try {
        await pc?.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale ICE candidates
      }
    };

    socket.on("voice:user-joined" as any, onUserJoined);
    socket.on("voice:user-left" as any, onUserLeft);
    socket.on("voice:offer" as any, onOffer);
    socket.on("voice:answer" as any, onAnswer);
    socket.on("voice:ice-candidate" as any, onIce);

    return () => {
      socket.off("voice:user-joined" as any, onUserJoined);
      socket.off("voice:user-left" as any, onUserLeft);
      socket.off("voice:offer" as any, onOffer);
      socket.off("voice:answer" as any, onAnswer);
      socket.off("voice:ice-candidate" as any, onIce);
    };
  }, [socket, joined, getOrCreatePeer, closePeer]);

  const handleJoin = async () => {
    setJoiningError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;

      // Local VAD
      localVadRef.current = createVAD(stream, (speaking) => setSpeaking(socket.id ?? "", speaking));

      // Tell server we joined; get existing voice users
      socket.emit("voice:join" as any, (res: { voiceUsers: VoiceUser[] }) => {
        setVoiceUsers(res.voiceUsers);
        setJoined(true);

        // Existing voice users will send us offers — nothing to initiate here;
        // they receive voice:user-joined and open connections toward us.
      });
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        setPermissionDenied(true);
      } else {
        setJoiningError("Could not access microphone");
      }
    }
  };

  const handleLeave = () => {
    socket.emit("voice:leave" as any);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    localVadRef.current?.();
    localVadRef.current = null;
    for (const id of [...peerConnsRef.current.keys()]) closePeer(id);
    setJoined(false);
    setVoiceUsers([]);
    setSpeakingIds(new Set());
  };

  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = muted; // muted=true means track was disabled, now re-enable
    setMuted(!muted);
    setSpeaking(socket.id ?? "", false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (joined) {
        socket.emit("voice:leave" as any);
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localVadRef.current?.();
        for (const id of [...peerConnsRef.current.keys()]) closePeer(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myId = socket.id ?? "";
  const myName = lobby?.players.find((p) => p.id === myId)?.name || "You";
  const allVoiceParticipants: VoiceUser[] = joined
    ? [{ id: myId, name: myName }, ...voiceUsers]
    : voiceUsers;

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:microphone" width={15} className="text-green-400" />
          <span className="text-xs font-semibold text-gray-300">Voice Chat</span>
          {allVoiceParticipants.length > 0 && (
            <span className="text-xs text-gray-500">· {allVoiceParticipants.length} in voice</span>
          )}
        </div>
        {joined ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggleMute}
              title={muted ? "Unmute" : "Mute"}
              className={`p-1.5 rounded-lg transition-colors ${
                muted ? "bg-red-600/30 text-red-400" : "bg-gray-800 text-gray-300 hover:text-white"
              }`}
            >
              <Icon icon={muted ? "mdi:microphone-off" : "mdi:microphone"} width={14} />
            </button>
            <button
              onClick={handleLeave}
              className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 border border-red-600/40 rounded-lg text-red-400 text-xs font-semibold transition-colors"
            >
              Leave
            </button>
          </div>
        ) : (
          <button
            onClick={handleJoin}
            disabled={permissionDenied}
            className="px-2.5 py-1 bg-green-600/20 hover:bg-green-600/30 border border-green-600/40 rounded-lg text-green-400 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Join Voice
          </button>
        )}
      </div>

      {permissionDenied && (
        <p className="text-xs text-red-400 mt-1">Microphone access denied. Allow it in your browser settings.</p>
      )}
      {joiningError && (
        <p className="text-xs text-red-400 mt-1">{joiningError}</p>
      )}

      {allVoiceParticipants.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {allVoiceParticipants.map((user) => {
            const isSpeaking = speakingIds.has(user.id);
            const isMe = user.id === myId;
            const isMutedMe = isMe && muted;
            return (
              <div
                key={user.id}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all ${
                  isSpeaking
                    ? "bg-green-600/30 border border-green-500/60 text-green-200"
                    : "bg-gray-800 border border-gray-700 text-gray-400"
                }`}
              >
                <Icon
                  icon={isMutedMe ? "mdi:microphone-off" : isSpeaking ? "mdi:microphone" : "mdi:microphone-outline"}
                  width={12}
                  className={isMutedMe ? "text-red-400" : isSpeaking ? "text-green-400" : "text-gray-500"}
                />
                <span>{isMe ? `${user.name} (you)` : user.name}</span>
              </div>
            );
          })}
        </div>
      )}

      {allVoiceParticipants.length === 0 && !joined && (
        <p className="text-xs text-gray-600">No one in voice yet</p>
      )}
    </div>
  );
}
