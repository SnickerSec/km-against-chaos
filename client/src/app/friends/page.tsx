"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth";
import { useFriendsStore, Friend } from "@/lib/friendsStore";
import GoogleSignIn from "@/components/GoogleSignIn";
import {
  fetchFriends,
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  setFriendNickname,
  fetchFriendsFeed,
  fetchFriendsLeaderboard,
  fetchFriendSuggestions,
  fetchUnreadCounts,
} from "@/lib/api";
import { useSocket } from "@/lib/useSocket";
import { useGameStore } from "@/lib/store";
import { usePartyStore } from "@/lib/partyStore";
import GameTypeBadge from "@/components/GameTypeBadge";

interface SearchResult {
  id: string;
  name: string;
  picture: string;
}

interface FeedEntry {
  id: string;
  deck_name: string;
  game_type: string;
  ended_at: string;
  player_name: string;
  name: string;
  picture: string;
  final_score: number;
  is_winner: boolean;
  user_id: string;
}

interface LeaderboardEntry {
  id: string;
  name: string;
  picture: string;
  total_games: string;
  wins: string;
  total_points: string;
}

interface Suggestion {
  id: string;
  name: string;
  picture: string;
  games_together: string;
}

function timeAgo(date: string | null): string {
  if (!date) return "Never";
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(date).toLocaleDateString();
}

function PresenceDot({ status }: { status: string }) {
  const color =
    status === "in_game"
      ? "bg-yellow-400"
      : status === "online"
      ? "bg-green-400"
      : "bg-gray-600";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color} flex-shrink-0`} />;
}

function Avatar({ name, picture, size = "md" }: { name: string; picture?: string; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "w-6 h-6 text-xs" : "w-8 h-8 text-sm";
  return picture ? (
    <img src={picture} alt="" className={`${dim} rounded-full`} referrerPolicy="no-referrer" />
  ) : (
    <div className={`${dim} rounded-full bg-gray-700 flex items-center justify-center font-bold text-gray-400`}>
      {name?.[0]?.toUpperCase()}
    </div>
  );
}

export default function FriendsPage() {
  const user = useAuthStore((s) => s.user);
  const { friends, setFriends, unreadCounts, setUnreadCounts } = useFriendsStore();
  const { sendInvite, createParty, inviteToParty } = useSocket();
  const lobby = useGameStore((s) => s.lobby);
  const party = usePartyStore((s) => s.party);

  const [tab, setTab] = useState<"friends" | "activity" | "leaderboard">("friends");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [editingNickname, setEditingNickname] = useState<string | null>(null);
  const [nicknameValue, setNicknameValue] = useState("");
  const [invitedUsers, setInvitedUsers] = useState<Set<string>>(new Set());

  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadFriends = useCallback(async () => {
    if (!user) return;
    try {
      const data = await fetchFriends();
      setFriends(data);
    } catch {}
  }, [user, setFriends]);

  // Load friends + unread counts once on mount
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!user || initialLoadDone.current) return;
    initialLoadDone.current = true;
    loadFriends();
    fetchUnreadCounts().then(setUnreadCounts).catch(() => {});
    fetchFriendSuggestions().then(setSuggestions).catch(() => {});
  }, [user, loadFriends, setUnreadCounts]);

  // Load tab-specific data only when switching tabs
  useEffect(() => {
    if (!user) return;
    if (tab === "activity") fetchFriendsFeed().then(setFeed).catch(() => {});
    if (tab === "leaderboard") fetchFriendsLeaderboard().then(setLeaderboard).catch(() => {});
  }, [user, tab]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowResults(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSearch = (value: string) => {
    setQuery(value);
    setError(null);
    setSuccess(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const data = await searchUsers(value.trim());
      setResults(data);
      setShowResults(true);
    }, 300);
  };

  const handleSendToUser = async (userId: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await sendFriendRequest(userId, true);
      setSuccess("Friend request sent!");
      setQuery("");
      setResults([]);
      setShowResults(false);
      loadFriends();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    const shareData = {
      title: "Decked",
      text: "Join me on Decked — create and play custom card games!",
      url: "https://www.decked.gg",
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      await navigator.clipboard.writeText(shareData.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleAccept = async (friendshipId: string) => {
    try {
      await acceptFriendRequest(friendshipId);
      loadFriends();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleRemove = async (friendshipId: string) => {
    try {
      await removeFriend(friendshipId);
      loadFriends();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSaveNickname = async (friendshipId: string) => {
    try {
      await setFriendNickname(friendshipId, nicknameValue);
      setEditingNickname(null);
      loadFriends();
    } catch {}
  };

  const handleInvite = (userId: string) => {
    sendInvite(userId);
    setInvitedUsers((prev) => new Set(prev).add(userId));
  };

  const accepted = friends.filter((f) => f.status === "accepted");
  const pendingReceived = friends.filter((f) => f.status === "pending" && f.direction === "received");
  const pendingSent = friends.filter((f) => f.status === "pending" && f.direction === "sent");

  // Sort accepted: online/in_game first, then offline
  const sortedAccepted = [...accepted].sort((a, b) => {
    const order = { in_game: 0, online: 1, offline: 2 };
    return (order[a.presence?.status] ?? 2) - (order[b.presence?.status] ?? 2);
  });

  return (
    <div className="max-w-lg mx-auto px-4 py-8 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-white transition-colors">&larr; Back</Link>
          <h1 className="text-2xl font-bold">Friends</h1>
        </div>
        <GoogleSignIn />
      </div>

      {!user ? (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">Sign in with Google to manage your friends list.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-6 bg-gray-800 rounded-lg p-1">
            {(["friends", "activity", "leaderboard"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                  tab === t ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                {t === "friends" ? "Friends" : t === "activity" ? "Activity" : "Leaderboard"}
              </button>
            ))}
          </div>

          {tab === "friends" && (
            <>
              {/* Party */}
              {!party && (
                <button
                  onClick={() => createParty()}
                  className="w-full mb-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium text-purple-400 transition-colors"
                >
                  Create Party
                </button>
              )}
              {party && (
                <div className="mb-4 bg-gray-800 border border-purple-700/50 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-purple-400 font-semibold uppercase">Your Party ({party.members.length})</span>
                  </div>
                  <div className="flex -space-x-1 mb-1">
                    {party.members.map((m) => (
                      <div key={m.userId} title={m.name}>
                        {m.picture ? (
                          <img src={m.picture} alt="" className="w-6 h-6 rounded-full border border-gray-900" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-6 h-6 rounded-full border border-gray-900 bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">{m.name[0]}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add Friend */}
              <div className="mb-6" ref={searchRef}>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Add Friend</h2>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name or email"
                    value={query}
                    onChange={(e) => handleSearch(e.target.value)}
                    onFocus={() => { if (results.length > 0) setShowResults(true); }}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
                  />
                  {showResults && results.length > 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
                      {results.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => handleSendToUser(r.id)}
                          disabled={loading}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700 transition-colors text-left"
                        >
                          <Avatar name={r.name} picture={r.picture} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{r.name}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {showResults && query.trim().length >= 2 && results.length === 0 && (
                    <div className="absolute left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 px-4 py-3">
                      <p className="text-sm text-gray-400 mb-2">No users found</p>
                      <button
                        onClick={handleShare}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
                        </svg>
                        Invite to Decked
                      </button>
                      {copied && <p className="text-green-400 text-xs mt-1.5 text-center">Link copied!</p>}
                    </div>
                  )}
                </div>
                {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                {success && <p className="text-green-400 text-sm mt-2">{success}</p>}
              </div>

              {/* Pending Requests */}
              {pendingReceived.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Friend Requests</h2>
                  <div className="space-y-2">
                    {pendingReceived.map((f) => (
                      <div key={f.friendship_id} className="flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar name={f.name} picture={f.picture} />
                          <span className="font-medium">{f.name}</span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleAccept(f.friendship_id)} className="px-3 py-1 bg-green-700 hover:bg-green-800 rounded text-xs font-medium transition-colors">Accept</button>
                          <button onClick={() => handleRemove(f.friendship_id)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-red-400 rounded text-xs font-medium transition-colors">Decline</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Friends List */}
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Friends{accepted.length > 0 ? ` (${accepted.length})` : ""}
                </h2>
                {sortedAccepted.length === 0 ? (
                  <p className="text-gray-400 text-sm">No friends yet. Send a request above to get started!</p>
                ) : (
                  <div className="space-y-2">
                    {sortedAccepted.map((f) => (
                      <div key={f.friendship_id} className="bg-gray-800 px-4 py-3 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative">
                              <Avatar name={f.name} picture={f.picture} />
                              <span className="absolute -bottom-0.5 -right-0.5">
                                <PresenceDot status={f.presence?.status || "offline"} />
                              </span>
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {editingNickname === f.friendship_id ? (
                                  <input
                                    autoFocus
                                    value={nicknameValue}
                                    onChange={(e) => setNicknameValue(e.target.value)}
                                    onBlur={() => handleSaveNickname(f.friendship_id)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveNickname(f.friendship_id); if (e.key === "Escape") setEditingNickname(null); }}
                                    className="bg-gray-700 text-white text-sm rounded px-1.5 py-0.5 w-32 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                    placeholder="Set nickname"
                                  />
                                ) : (
                                  <>
                                    <span className="font-medium truncate">
                                      {f.nickname || f.name}
                                    </span>
                                    {f.nickname && (
                                      <span className="text-xs text-gray-400 truncate">({f.name})</span>
                                    )}
                                    <button
                                      onClick={() => { setEditingNickname(f.friendship_id); setNicknameValue(f.nickname || ""); }}
                                      className="text-gray-600 hover:text-gray-400 transition-colors"
                                      title="Edit nickname"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                      </svg>
                                    </button>
                                  </>
                                )}
                              </div>
                              <p className="text-xs text-gray-400">
                                {f.presence?.status === "in_game"
                                  ? `Playing ${f.presence.deckName || "a game"}`
                                  : f.presence?.status === "online"
                                  ? "Online"
                                  : `Last seen ${timeAgo(f.last_seen)}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {unreadCounts[f.id] > 0 && (
                              <Link
                                href={`/friends/profile?id=${f.id}`}
                                className="bg-purple-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center"
                              >
                                {unreadCounts[f.id]}
                              </Link>
                            )}
                            {f.presence?.status === "in_game" && f.presence.lobbyCode && (
                              <Link
                                href={`/?code=${f.presence.lobbyCode}`}
                                className="px-2 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-xs font-medium transition-colors"
                              >
                                Join
                              </Link>
                            )}
                            {lobby && f.presence?.status === "online" && (
                              <button
                                onClick={() => handleInvite(f.id)}
                                disabled={invitedUsers.has(f.id)}
                                className="px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-400 rounded text-xs font-medium transition-colors"
                              >
                                {invitedUsers.has(f.id) ? "Sent" : "Invite"}
                              </button>
                            )}
                            {party && !party.members.some(m => m.userId === f.id) && (
                              <button
                                onClick={() => inviteToParty(f.id)}
                                disabled={f.presence?.status === "offline"}
                                className="px-2 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-400 rounded text-xs font-medium transition-colors"
                              >
                                + Party
                              </button>
                            )}
                            <Link
                              href={`/friends/profile?id=${f.id}`}
                              className="text-xs text-gray-400 hover:text-white transition-colors"
                            >
                              View
                            </Link>
                            <button
                              onClick={() => handleRemove(f.friendship_id)}
                              className="text-xs text-red-400 hover:text-red-300 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pending Sent */}
              {pendingSent.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Pending Sent</h2>
                  <div className="space-y-2">
                    {pendingSent.map((f) => (
                      <div key={f.friendship_id} className="flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar name={f.name} picture={f.picture} />
                          <span className="font-medium">{f.name}</span>
                          <span className="text-xs text-gray-400">Pending</span>
                        </div>
                        <button onClick={() => handleRemove(f.friendship_id)} className="text-xs text-gray-400 hover:text-red-400 transition-colors">Cancel</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">People You&apos;ve Played With</h2>
                  <div className="space-y-2">
                    {suggestions.map((s) => (
                      <div key={s.id} className="flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Avatar name={s.name} picture={s.picture} />
                          <div>
                            <span className="font-medium">{s.name}</span>
                            <p className="text-xs text-gray-400">{s.games_together} game{parseInt(s.games_together) !== 1 ? "s" : ""} together</p>
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await sendFriendRequest(s.id, true);
                              setSuggestions((prev) => prev.filter((p) => p.id !== s.id));
                              setSuccess("Friend request sent!");
                            } catch (e: any) {
                              setError(e.message);
                            }
                          }}
                          className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-xs font-medium transition-colors"
                        >
                          Add Friend
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === "activity" && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Recent Activity</h2>
              {feed.length === 0 ? (
                <p className="text-gray-400 text-sm">No recent activity from friends.</p>
              ) : (
                <div className="space-y-2">
                  {feed.map((entry, i) => (
                    <div key={`${entry.id}-${i}`} className="flex items-center gap-3 bg-gray-800 px-4 py-3 rounded-lg">
                      <Avatar name={entry.name} picture={entry.picture} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{entry.name}</span>
                          {entry.is_winner ? (
                            <span className="text-yellow-400"> won</span>
                          ) : (
                            <span className="text-gray-400"> played</span>
                          )}
                          <span className="text-gray-400"> {entry.deck_name}</span>
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <GameTypeBadge gameType={entry.game_type} />
                          <span className="text-xs text-gray-400">Score: {entry.final_score} · {timeAgo(entry.ended_at)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "leaderboard" && (
            <div>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Friend Leaderboard</h2>
              {leaderboard.length === 0 ? (
                <p className="text-gray-400 text-sm">No stats yet. Play some games with friends!</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry, i) => {
                    const isMe = entry.id === user?.id;
                    return (
                      <div
                        key={entry.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg ${
                          isMe ? "bg-purple-900/30 border border-purple-700" : "bg-gray-800"
                        }`}
                      >
                        <span className={`text-lg font-bold w-8 text-center ${
                          i === 0 ? "text-yellow-400" : i === 1 ? "text-gray-300" : i === 2 ? "text-orange-400" : "text-gray-400"
                        }`}>
                          {i + 1}
                        </span>
                        <Avatar name={entry.name} picture={entry.picture} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{entry.name} {isMe && <span className="text-gray-400 text-xs">(you)</span>}</p>
                        </div>
                        <div className="text-right text-sm">
                          <p className="text-white font-medium">{entry.wins} W</p>
                          <p className="text-xs text-gray-400">{entry.total_games} games</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
