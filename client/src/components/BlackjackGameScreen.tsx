"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useBlackjackStore, type Card, type Suit } from "@/lib/blackjackStore";
import { useGameStore } from "@/lib/store";
import { getSocket } from "@/lib/socket";
import Chat from "./Chat";

const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣", "?": "?" };
const SUIT_COLOR: Record<Suit, string> = {
  S: "text-gray-100", H: "text-red-400", D: "text-red-400", C: "text-gray-100", "?": "text-gray-400",
};

function CardChip({ card }: { card: Card }) {
  return (
    <div className="inline-flex flex-col items-center justify-center w-12 h-16 rounded bg-gray-800 border border-gray-600 mr-1">
      <span className={`text-xl font-bold ${SUIT_COLOR[card.suit]}`}>{card.rank}</span>
      <span className={`text-xl ${SUIT_COLOR[card.suit]}`}>{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}

function handTotal(cards: Card[]): number {
  const RANK_VALUE: Record<string, number> = {
    "A": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "10": 10, "J": 10, "Q": 10, "K": 10, "?": 0,
  };
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += RANK_VALUE[c.rank] || 0;
    if (c.rank === "A") aces++;
  }
  while (aces > 0 && total + 10 <= 21) { total += 10; aces--; }
  return total;
}

export default function BlackjackGameScreen() {
  const view = useBlackjackStore(s => s.view);
  const lobby = useGameStore(s => s.lobby);
  const socket = getSocket();
  const myId = socket.id;
  const [betAmount, setBetAmount] = useState<number>(0);

  // Subscribe once for blackjack:update events.
  useEffect(() => {
    const handler = (v: any) => useBlackjackStore.getState().setView(v);
    socket.on("blackjack:update" as any, handler);
    return () => { socket.off("blackjack:update" as any, handler); };
  }, [socket]);

  // Default the bet slider to the table minimum once the view loads.
  useEffect(() => {
    if (view && betAmount === 0) setBetAmount(view.config.minBet);
  }, [view, betAmount]);

  const myChips = view && myId ? view.chips[myId] ?? 0 : 0;
  const myBet = view && myId ? view.bets[myId] : null;
  const isMyTurn = view?.activePlayerId === myId;
  const eligible = useMemo(() => view ? myChips >= view.config.minBet : false, [view, myChips]);

  if (!view) return <div className="p-8 text-gray-400">Waiting for blackjack state…</div>;

  const ack = (event: string, ...args: any[]) => {
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      socket.emit(event as any, ...args, (res: any) => resolve(res));
    });
  };

  const onBet = async () => { await ack("blackjack:bet", betAmount); };
  const onSitOut = async () => { await ack("blackjack:sit-out"); };
  const onHit = async () => { await ack("blackjack:hit"); };
  const onStand = async () => { await ack("blackjack:stand"); };
  const onDouble = async () => { await ack("blackjack:double"); };
  const onSplit = async () => { await ack("blackjack:split"); };

  const myHands = view.hands[myId ?? ""] || [];
  const myActiveHand = isMyTurn ? myHands[view.activeHandIndex] : undefined;
  const canDouble = !!myActiveHand && myActiveHand.cards.length === 2 && myChips >= myActiveHand.bet;
  const canSplit = !!myActiveHand && myActiveHand.cards.length === 2
    && myActiveHand.cards[0].rank === myActiveHand.cards[1].rank
    && !myActiveHand.fromSplit
    && myChips >= myActiveHand.bet;

  return (
    <div className="min-h-screen bg-green-900 text-white p-4 flex flex-col">
      {/* Dealer */}
      <div className="text-center mb-6">
        <div className="text-sm text-gray-300 mb-1">Dealer{view.phase !== "playing" && view.phase !== "dealing" ? ` — ${handTotal(view.dealerHand)}` : ""}</div>
        <div className="flex justify-center">{view.dealerHand.map((c, i) => <CardChip key={i} card={c} />)}</div>
      </div>

      {/* Players */}
      <div className="flex flex-wrap justify-center gap-4 mb-6">
        {view.playerIds.map(pid => {
          const player = lobby?.players.find(p => p.id === pid);
          const name = player?.name ?? pid;
          const chips = view.chips[pid] ?? 0;
          const bet = view.bets[pid];
          const hands = view.hands[pid] || [];
          const isActive = view.activePlayerId === pid;
          const isEliminated = chips < view.config.minBet && view.phase !== "betting";
          return (
            <div key={pid} className={`p-3 rounded border ${isActive ? "border-yellow-400" : "border-gray-700"} ${isEliminated ? "opacity-50" : ""} bg-gray-900`}>
              <div className="flex items-center justify-between mb-1 text-sm">
                <span className="font-bold">{name}{pid === myId ? " (you)" : ""}</span>
                <span className="text-yellow-300 ml-3">🪙 {chips}</span>
              </div>
              <div className="text-xs text-gray-400 mb-1">
                {bet === "sitting_out" ? "sitting out" : bet ? `bet ${bet}` : view.phase === "betting" ? "…" : ""}
              </div>
              {hands.map((h, hi) => (
                <div key={hi} className={`mb-1 ${isActive && view.activeHandIndex === hi ? "ring-2 ring-yellow-400 rounded p-1" : ""}`}>
                  <div className="flex">{h.cards.map((c, i) => <CardChip key={i} card={c} />)}</div>
                  <div className="text-xs text-gray-300 mt-1">total {handTotal(h.cards)}{h.doubled ? " · doubled" : ""}{h.resolved ? " · done" : ""}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Action bar */}
      {view.phase === "betting" && eligible && myBet === null && (
        <div className="bg-gray-900 rounded p-4 max-w-md mx-auto">
          <div className="text-sm mb-2">Place your bet (min {view.config.minBet}, max {Math.min(view.config.maxBet, myChips)})</div>
          <input
            type="range"
            min={view.config.minBet}
            max={Math.min(view.config.maxBet, myChips)}
            value={betAmount}
            onChange={e => setBetAmount(Number(e.target.value))}
            className="w-full"
          />
          <div className="text-center text-lg font-bold my-2">🪙 {betAmount}</div>
          <div className="flex justify-center gap-2">
            <button onClick={onBet} className="bg-yellow-500 text-black px-4 py-2 rounded font-bold">Bet</button>
            <button onClick={onSitOut} className="bg-gray-700 px-4 py-2 rounded">Sit out</button>
          </div>
        </div>
      )}

      {view.phase === "playing" && isMyTurn && myActiveHand && (
        <div className="flex justify-center gap-2 mb-4">
          <button onClick={onHit} className="bg-blue-600 px-4 py-2 rounded font-bold">Hit</button>
          <button onClick={onStand} className="bg-gray-700 px-4 py-2 rounded font-bold">Stand</button>
          <button onClick={onDouble} disabled={!canDouble} className="bg-purple-600 px-4 py-2 rounded font-bold disabled:opacity-40">Double</button>
          <button onClick={onSplit} disabled={!canSplit} className="bg-green-600 px-4 py-2 rounded font-bold disabled:opacity-40">Split</button>
        </div>
      )}

      {view.phase === "settle" && view.lastSettlement && (
        <div className="bg-black/40 rounded p-3 max-w-lg mx-auto text-center">
          <div className="font-bold mb-1">Round results</div>
          {view.lastSettlement.map((s, i) => {
            const name = lobby?.players.find(p => p.id === s.playerId)?.name ?? s.playerId;
            return <div key={i} className="text-sm">{name}: {s.outcome} ({s.delta >= 0 ? "+" : ""}{s.delta - (view.hands[s.playerId]?.[s.handIndex]?.bet ?? 0)})</div>;
          })}
        </div>
      )}

      {view.phase === "gameOver" && (
        <div className="text-center text-2xl font-bold mt-4">
          <Icon icon="mdi:trophy" className="inline mr-2" />
          Game over — last player standing wins
        </div>
      )}

      <div className="mt-auto"><Chat /></div>
    </div>
  );
}
