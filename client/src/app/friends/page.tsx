"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth";
import GoogleSignIn from "@/components/GoogleSignIn";
import {
  fetchFriends,
  searchUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
} from "@/lib/api";

interface Friend {
  id: string;
  name: string;
  picture: string;
  friendship_id: string;
  status: string;
  direction: string;
  created_at: string;
}

interface SearchResult {
  id: string;
  name: string;
  picture: string;
  email: string;
}

export default function FriendsPage() {
  const user = useAuthStore((s) => s.user);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const loadFriends = useCallback(async () => {
    if (!user) return;
    try {
      const data = await fetchFriends();
      setFriends(data);
    } catch {
      // ignore
    }
  }, [user]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

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

  const handleSendToUser = async (email: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await sendFriendRequest(email);
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

  const accepted = friends.filter((f) => f.status === "accepted");
  const pendingReceived = friends.filter(
    (f) => f.status === "pending" && f.direction === "received"
  );
  const pendingSent = friends.filter(
    (f) => f.status === "pending" && f.direction === "sent"
  );

  return (
    <div className="max-w-lg mx-auto px-4 py-8 min-h-screen">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-gray-400 hover:text-white transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-2xl font-bold">Friends</h1>
        </div>
        <GoogleSignIn />
      </div>

      {!user ? (
        <div className="text-center py-16">
          <p className="text-gray-400 mb-4">
            Sign in with Google to manage your friends list.
          </p>
        </div>
      ) : (
        <>
          {/* Add Friend */}
          <div className="mb-8" ref={searchRef}>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Add Friend
            </h2>
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
                      onClick={() => handleSendToUser(r.email)}
                      disabled={loading}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700 transition-colors text-left"
                    >
                      {r.picture ? (
                        <img src={r.picture} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-400">
                          {r.name[0]}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{r.name}</p>
                        <p className="text-xs text-gray-500 truncate">{r.email}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {showResults && query.trim().length >= 2 && results.length === 0 && (
                <div className="absolute left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 px-4 py-3">
                  <p className="text-sm text-gray-500">No users found</p>
                </div>
              )}
            </div>
            {error && (
              <p className="text-red-400 text-sm mt-2">{error}</p>
            )}
            {success && (
              <p className="text-green-400 text-sm mt-2">{success}</p>
            )}
          </div>

          {/* Pending Requests Received */}
          {pendingReceived.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Friend Requests
              </h2>
              <div className="space-y-2">
                {pendingReceived.map((f) => (
                  <div
                    key={f.friendship_id}
                    className="flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {f.picture ? (
                        <img
                          src={f.picture}
                          alt=""
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-400">
                          {f.name[0]}
                        </div>
                      )}
                      <span className="font-medium">{f.name}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAccept(f.friendship_id)}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-medium transition-colors"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleRemove(f.friendship_id)}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-red-400 rounded text-xs font-medium transition-colors"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Accepted Friends */}
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Friends{accepted.length > 0 ? ` (${accepted.length})` : ""}
            </h2>
            {accepted.length === 0 ? (
              <p className="text-gray-500 text-sm">
                No friends yet. Send a request above to get started!
              </p>
            ) : (
              <div className="space-y-2">
                {accepted.map((f) => (
                  <div
                    key={f.friendship_id}
                    className="flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {f.picture ? (
                        <img
                          src={f.picture}
                          alt=""
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-400">
                          {f.name[0]}
                        </div>
                      )}
                      <span className="font-medium">{f.name}</span>
                    </div>
                    <button
                      onClick={() => handleRemove(f.friendship_id)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Sent */}
          {pendingSent.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Pending Sent
              </h2>
              <div className="space-y-2">
                {pendingSent.map((f) => (
                  <div
                    key={f.friendship_id}
                    className="flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      {f.picture ? (
                        <img
                          src={f.picture}
                          alt=""
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-gray-400">
                          {f.name[0]}
                        </div>
                      )}
                      <span className="font-medium">{f.name}</span>
                      <span className="text-xs text-gray-500">Pending</span>
                    </div>
                    <button
                      onClick={() => handleRemove(f.friendship_id)}
                      className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
