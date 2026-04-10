"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth";
import { fetchMyStats, fetchLeaderboard, fetchGameHistory } from "@/lib/api";
import GameTypeBadge from "@/components/GameTypeBadge";

interface PlayerStats {
  totalGames: number;
  wins: number;
  winRate: number;
  totalPoints: number;
  favoriteGameType: string | null;
  breakdown: { gameType: string; games: number; wins: number }[];
  recentGames: {
    id: string;
    deckName: string;
    gameType: string;
    endedAt: string;
    playerCount: number;
    finalScore: number;
    isWinner: boolean;
  }[];
}

interface LeaderboardEntry {
  name: string;
  picture: string;
  userId: string;
  totalGames: number;
  wins: number;
  winRate: number;
}

export default function StatsPage() {
  const user = useAuthStore((s) => s.user);
  const [myStats, setMyStats] = useState<PlayerStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [gameTypeFilter, setGameTypeFilter] = useState<string>("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyData, setHistoryData] = useState<{ results: PlayerStats["recentGames"]; total: number; page: number; pages: number } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const lb = await fetchLeaderboard(gameTypeFilter || undefined);
        setLeaderboard(lb);
        if (user) {
          try {
            const stats = await fetchMyStats();
            setMyStats(stats);
          } catch {
            // Not logged in or no stats yet
          }
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user, gameTypeFilter]);

  useEffect(() => {
    if (!user) return;
    setHistoryLoading(true);
    fetchGameHistory(historyPage, 20)
      .then(setHistoryData)
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [user, historyPage]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 min-h-screen">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-white">Stats</h1>
        <Link
          href="/"
          className="text-gray-400 hover:text-white text-sm transition-colors"
        >
          Back to Decked
        </Link>
      </div>

      {error && (
        <p className="text-red-400 text-center text-sm mb-6">{error}</p>
      )}

      {/* Personal Stats */}
      {user && myStats && myStats.totalGames > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold text-white mb-4">Your Stats</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <StatCard label="Games Played" value={myStats.totalGames} />
            <StatCard label="Wins" value={myStats.wins} />
            <StatCard label="Win Rate" value={`${myStats.winRate}%`} />
            <StatCard label="Total Points" value={myStats.totalPoints} />
          </div>

          {myStats.favoriteGameType && (
            <p className="text-gray-400 text-sm mb-4">
              Favorite game type:{" "}
              <GameTypeBadge gameType={myStats.favoriteGameType} />
            </p>
          )}

          {/* Per-game-type breakdown */}
          {myStats.breakdown.length > 1 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wide">
                By Game Type
              </h3>
              <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
                {myStats.breakdown.map((b) => (
                  <div
                    key={b.gameType}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <GameTypeBadge gameType={b.gameType} />
                    <span className="text-gray-500 text-sm">
                      {b.wins}W / {b.games}G
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Game History */}
          {historyData && historyData.results.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wide">
                Game History
              </h3>
              <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
                {historyData.results.map((g) => (
                  <div
                    key={g.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div>
                      <span className="text-gray-200">{g.deckName}</span>
                      <GameTypeBadge gameType={g.gameType} />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 text-sm">
                        {g.finalScore} pts
                      </span>
                      {g.isWinner && (
                        <span className="text-yellow-400 text-xs font-semibold">
                          WIN
                        </span>
                      )}
                      <span className="text-gray-600 text-xs">
                        {new Date(g.endedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {historyData.pages > 1 && (
                <div className="flex items-center justify-between mt-3">
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage <= 1 || historyLoading}
                    className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 text-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors"
                  >
                    Prev
                  </button>
                  <span className="text-gray-500 text-sm">
                    Page {historyData.page} of {historyData.pages}
                  </span>
                  <button
                    onClick={() => setHistoryPage((p) => Math.min(historyData!.pages, p + 1))}
                    disabled={historyPage >= historyData.pages || historyLoading}
                    className="px-3 py-1.5 text-sm bg-gray-800 border border-gray-700 text-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {user && myStats && myStats.totalGames === 0 && (
        <section className="mb-10">
          <p className="text-gray-500 text-center py-8">
            No games played yet. Start a game to see your stats!
          </p>
        </section>
      )}

      {!user && (
        <section className="mb-10">
          <p className="text-gray-500 text-center py-4">
            Sign in with Google to track your personal stats.
          </p>
        </section>
      )}

      {/* Leaderboard */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">Leaderboard</h2>
          <select
            value={gameTypeFilter}
            onChange={(e) => setGameTypeFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-purple-500"
          >
            <option value="">All Games</option>
            <option value="cah">Cards Against Humanity</option>
            <option value="joking_hazard">Joking Hazard</option>
            <option value="apples_to_apples">Apples to Apples</option>
            <option value="uno">Uno</option>
          </select>
        </div>

        {loading ? (
          <p className="text-gray-500 text-center py-8">Loading...</p>
        ) : leaderboard.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            No games recorded yet. Play some games to populate the leaderboard!
          </p>
        ) : (
          <div className="bg-gray-900 rounded-lg border border-gray-800 divide-y divide-gray-800">
            {leaderboard.map((entry, i) => (
              <div
                key={entry.userId}
                className="flex items-center gap-4 px-4 py-3"
              >
                <span
                  className={`text-lg font-bold w-8 text-center ${
                    i === 0
                      ? "text-yellow-400"
                      : i === 1
                      ? "text-gray-300"
                      : i === 2
                      ? "text-amber-600"
                      : "text-gray-600"
                  }`}
                >
                  {i + 1}
                </span>
                {entry.picture ? (
                  <img
                    src={entry.picture}
                    alt=""
                    className="w-8 h-8 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-700" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-gray-200 truncate block">
                    {entry.name}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-white font-semibold">
                    {entry.wins}W
                  </span>
                  <span className="text-gray-500 text-sm ml-1">
                    / {entry.totalGames}G
                  </span>
                  <span className="text-gray-600 text-xs ml-2">
                    ({entry.winRate}%)
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-center">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
