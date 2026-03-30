"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth";
import { useFriendsStore } from "@/lib/friendsStore";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import GoogleSignIn from "@/components/GoogleSignIn";
import GameTypeBadge from "@/components/GameTypeBadge";
import {
  fetchFriendHistory,
  fetchMutualFriends,
  fetchMessages,
  markMessagesRead,
} from "@/lib/api";

interface GameEntry {
  id: string;
  deck_name: string;
  game_type: string;
  ended_at: string;
  my_score: number;
  my_win: boolean;
  friend_score: number;
  friend_win: boolean;
}

interface HistorySummary {
  games_together: string;
  my_wins: string;
  friend_wins: string;
}

interface MutualFriend {
  id: string;
  name: string;
  picture: string;
}

interface Message {
  id: string;
  sender_id: string;
  senderName?: string;
  receiver_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}

export default function FriendProfilePageWrapper() {
  return (
    <Suspense fallback={<div className="max-w-lg mx-auto px-4 py-8"><div className="h-8 w-32 bg-gray-800 rounded animate-pulse" /></div>}>
      <FriendProfilePage />
    </Suspense>
  );
}

function FriendProfilePage() {
  const searchParams = useSearchParams();
  const friendId = searchParams.get("id") || "";
  const user = useAuthStore((s) => s.user);
  const friends = useFriendsStore((s) => s.friends);
  const { clearUnread, setDmOpen } = useFriendsStore();
  const { sendDm, sendDmTyping } = useSocket();

  const friend = friends.find((f) => f.id === friendId);

  const [tab, setTab] = useState<"messages" | "stats">("messages");
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgInput, setMsgInput] = useState("");
  const [games, setGames] = useState<GameEntry[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [mutualFriends, setMutualFriends] = useState<MutualFriend[]>([]);
  const [typing, setTyping] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadMessages = useCallback(async () => {
    if (!user || !friendId) return;
    try {
      const msgs = await fetchMessages(friendId);
      setMessages(msgs);
      await markMessagesRead(friendId);
      clearUnread(friendId);
    } catch {}
  }, [user, friendId, clearUnread]);

  useEffect(() => {
    if (tab === "messages") {
      loadMessages();
      setDmOpen(friendId);
    }
    return () => setDmOpen(null);
  }, [tab, friendId, loadMessages, setDmOpen]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Listen for incoming DMs in real-time
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    const handler = (msg: Message) => {
      if (msg.sender_id === friendId) {
        setMessages((prev) => [...prev, msg]);
        markMessagesRead(friendId);
        clearUnread(friendId);
      }
    };
    socket.on("dm:received" as any, handler);

    const typingHandler = ({ userId }: { userId: string }) => {
      if (userId === friendId) {
        setTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTyping(false), 2000);
      }
    };
    socket.on("dm:typing" as any, typingHandler);

    return () => {
      socket.off("dm:received" as any, handler);
      socket.off("dm:typing" as any, typingHandler);
    };
  }, [user, friendId, clearUnread]);

  useEffect(() => {
    if (!user || tab !== "stats") return;
    fetchFriendHistory(friendId).then((data) => {
      setGames(data.games);
      setSummary(data.summary);
    }).catch(() => {});
    fetchMutualFriends(friendId).then(setMutualFriends).catch(() => {});
  }, [user, friendId, tab]);

  const handleSend = () => {
    if (!msgInput.trim()) return;
    sendDm(friendId, msgInput.trim(), (res: any) => {
      if (res?.success && res.message) {
        setMessages((prev) => [...prev, res.message]);
      }
    });
    setMsgInput("");
  };

  const handleTyping = () => {
    sendDmTyping(friendId);
  };

  if (!friendId) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8">
        <Link href="/friends" className="text-gray-400 hover:text-white">&larr; Back to Friends</Link>
        <p className="text-gray-500 mt-8 text-center">No friend selected.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8 min-h-screen flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/friends" className="text-gray-400 hover:text-white transition-colors">&larr; Friends</Link>
          {friend && (
            <div className="flex items-center gap-2">
              {friend.picture ? (
                <img src={friend.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-400">
                  {friend.name[0]}
                </div>
              )}
              <div>
                <h1 className="text-lg font-bold leading-tight">{friend.nickname || friend.name}</h1>
                {friend.nickname && <p className="text-xs text-gray-500">{friend.name}</p>}
              </div>
            </div>
          )}
          {!friend && <h1 className="text-lg font-bold">Friend Profile</h1>}
        </div>
        <GoogleSignIn />
      </div>

      {!user ? (
        <p className="text-gray-400 text-center py-16">Sign in to view this profile.</p>
      ) : (
        <>
          <div className="flex gap-1 mb-4 bg-gray-800 rounded-lg p-1">
            <button onClick={() => setTab("messages")} className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${tab === "messages" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}>Messages</button>
            <button onClick={() => setTab("stats")} className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${tab === "stats" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}>Stats</button>
          </div>

          {tab === "messages" && (
            <div className="flex flex-col flex-1">
              <div className="flex-1 overflow-y-auto space-y-2 mb-4 min-h-[300px] max-h-[60vh]">
                {messages.length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-8">No messages yet. Say hi!</p>
                )}
                {messages.map((msg) => {
                  const isMe = msg.sender_id === user.id;
                  return (
                    <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${isMe ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-200"}`}>
                        <p>{msg.content}</p>
                        <p className={`text-xs mt-0.5 ${isMe ? "text-purple-300" : "text-gray-500"}`}>{timeAgo(msg.created_at)}</p>
                      </div>
                    </div>
                  );
                })}
                {typing && (
                  <div className="flex justify-start">
                    <div className="bg-gray-800 text-gray-400 px-3 py-2 rounded-lg text-sm italic">typing...</div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={msgInput}
                  onChange={(e) => { setMsgInput(e.target.value); handleTyping(); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
                />
                <button onClick={handleSend} disabled={!msgInput.trim()} className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium text-sm transition-colors">Send</button>
              </div>
            </div>
          )}

          {tab === "stats" && (
            <div>
              {summary && (
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <div className="bg-gray-800 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-green-400">{summary.my_wins}</p>
                    <p className="text-xs text-gray-400">Your Wins</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-gray-400">{summary.games_together}</p>
                    <p className="text-xs text-gray-400">Games</p>
                  </div>
                  <div className="bg-gray-800 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-red-400">{summary.friend_wins}</p>
                    <p className="text-xs text-gray-400">Their Wins</p>
                  </div>
                </div>
              )}

              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Recent Games Together</h2>
              {games.length === 0 ? (
                <p className="text-gray-500 text-sm">No games played together yet.</p>
              ) : (
                <div className="space-y-2 mb-6">
                  {games.map((g) => (
                    <div key={g.id} className="flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{g.deck_name}</p>
                        <div className="flex items-center gap-1.5">
                          <GameTypeBadge gameType={g.game_type} />
                          <span className="text-xs text-gray-500">{timeAgo(g.ended_at)}</span>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <p className={g.my_win ? "text-green-400 font-medium" : "text-gray-400"}>You: {g.my_score}</p>
                        <p className={g.friend_win ? "text-red-400 font-medium" : "text-gray-400"}>Them: {g.friend_score}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {mutualFriends.length > 0 && (
                <>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Mutual Friends ({mutualFriends.length})</h2>
                  <div className="flex flex-wrap gap-2 mb-6">
                    {mutualFriends.map((mf) => (
                      <Link
                        key={mf.id}
                        href={`/friends/profile?id=${mf.id}`}
                        className="flex items-center gap-2 bg-gray-800 px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors"
                      >
                        {mf.picture ? (
                          <img src={mf.picture} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">{mf.name[0]}</div>
                        )}
                        <span className="text-sm">{mf.name}</span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
