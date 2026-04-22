"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useBlackjackStore, type Card, type Suit, type Hand } from "@/lib/blackjackStore";
import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import { useSounds } from "@/lib/useSounds";
import PlayerAvatar from "./PlayerAvatar";
import ScoreBar from "./ScoreBar";
import RoundTimer from "./RoundTimer";
import ReactionBar from "./ReactionBar";
import ReactionOverlay from "./ReactionOverlay";
import StickerOverlay from "./StickerOverlay";
import GifOverlay from "./GifOverlay";
import VoiceChat from "./VoiceChat";
import Chat from "./Chat";
import SoundPicker from "./SoundPicker";

// ── Card rendering ───────────────────────────────────────────────────────────

const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣", "?": "" };
const SUIT_COLOR: Record<Suit, string> = {
  S: "text-gray-900", H: "text-red-600", D: "text-red-600", C: "text-gray-900", "?": "text-gray-400",
};

function PlayingCard({
  card,
  size = "md",
  animation = "deal-in",
}: {
  card: Card;
  size?: "sm" | "md" | "lg";
  animation?: "deal-in" | "flip-reveal";
}) {
  const dims = size === "lg"
    ? "w-16 h-24 text-2xl"
    : size === "sm"
    ? "w-10 h-14 text-sm"
    : "w-12 h-18 text-lg";

  const anim = animation === "flip-reveal" ? "animate-flip-reveal" : "animate-deal-in";

  if (card.suit === "?") {
    return (
      <div className={`${dims} rounded-md bg-gradient-to-br from-red-900 to-red-700 border-2 border-white/60 shadow-lg flex items-center justify-center ${anim}`}>
        <div className="w-full h-full rounded-sm border-2 border-red-950/50 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.2)_4px,rgba(0,0,0,0.2)_8px)]" />
      </div>
    );
  }

  const color = SUIT_COLOR[card.suit];
  return (
    <div className={`${dims} rounded-md bg-white border border-gray-300 shadow-lg flex flex-col items-center justify-between p-1 select-none ${anim}`}>
      <span className={`self-start leading-none font-bold ${color}`}>{card.rank}</span>
      <span className={`leading-none ${color}`}>{SUIT_GLYPH[card.suit]}</span>
      <span className={`self-end leading-none font-bold rotate-180 ${color}`}>{card.rank}</span>
    </div>
  );
}

// ── Hand evaluation (client-side, matches the server) ────────────────────────

function handTotal(cards: Card[]): number {
  const RANK_VALUE: Record<string, number> = {
    A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "10": 10, J: 10, Q: 10, K: 10, "?": 0,
  };
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.suit === "?") continue; // hole card is hidden
    total += RANK_VALUE[c.rank] || 0;
    if (c.rank === "A") aces++;
  }
  while (aces > 0 && total + 10 <= 21) { total += 10; aces--; }
  return total;
}

function handDisplay(cards: Card[]): string {
  const visible = cards.filter(c => c.suit !== "?");
  if (visible.length < cards.length) return `${handTotal(cards)}+`; // hole card hidden
  const t = handTotal(cards);
  if (t > 21) return `${t} · BUST`;
  if (visible.length === 2 && t === 21) return "BLACKJACK";
  return String(t);
}

// ── Active-seat timer bar ────────────────────────────────────────────────────
// Thin depleting bar along the top of the active seat during the playing phase.
// Independent interval so the seat re-renders at 4 Hz without touching the
// whole screen.

function SeatTimerBar({ deadline, totalMs }: { deadline: number; totalMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, deadline - now);
  const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
  const urgent = remaining <= 10_000;
  return (
    <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl overflow-hidden bg-black/30">
      <div
        className={`h-full transition-[width] duration-200 ease-linear ${
          urgent ? "bg-red-400" : "bg-yellow-300"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Chip stack ───────────────────────────────────────────────────────────────

function ChipStack({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return (
    <div className="flex items-center gap-1 text-yellow-300 font-semibold">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-yellow-400 text-yellow-900 text-[10px] font-black border border-yellow-600">$</span>
      <span className="tabular-nums">{amount}</span>
    </div>
  );
}

// ── Side-bet input ───────────────────────────────────────────────────────────

function SideBetInput({
  label, subtitle, value, onChange, maxChips,
}: {
  label: string;
  subtitle: string;
  value: number;
  onChange: (n: number) => void;
  maxChips: number;
}) {
  const safeMax = Math.max(0, maxChips);
  const clamp = (n: number) => Math.max(0, Math.min(safeMax, Math.floor(n || 0)));
  return (
    <div className="bg-black/40 rounded-lg p-2 border border-white/10">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-300 font-semibold">{label}</span>
        <span className="text-[9px] text-gray-500">{subtitle}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(0)}
          className="w-5 h-5 rounded text-[10px] text-gray-400 hover:text-white hover:bg-white/10"
          title="Clear"
        >×</button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value || ""}
          placeholder="0"
          onChange={e => onChange(clamp(Number(e.target.value)))}
          className="flex-1 bg-black/50 border border-white/20 rounded px-2 py-0.5 text-sm text-yellow-200 placeholder-gray-600 text-right tabular-nums focus:outline-none focus:border-yellow-400"
        />
      </div>
    </div>
  );
}

// ── Settlement badge ─────────────────────────────────────────────────────────

function OutcomeBadge({ outcome }: { outcome: "win" | "lose" | "push" | "blackjack" | "surrender" }) {
  const map: Record<string, { label: string; cls: string }> = {
    blackjack: { label: "BLACKJACK!", cls: "bg-yellow-400 text-black" },
    win:       { label: "WIN",        cls: "bg-green-500 text-white" },
    push:      { label: "PUSH",       cls: "bg-gray-500 text-white" },
    lose:      { label: "LOSE",       cls: "bg-red-600 text-white" },
    surrender: { label: "SURRENDER",  cls: "bg-orange-500 text-white" },
  };
  const m = map[outcome];
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide ${m.cls}`}>
      {m.label}
    </span>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────

export default function BlackjackGameScreen() {
  const view = useBlackjackStore(s => s.view);
  const lobby = useGameStore(s => s.lobby);
  const { leaveLobby, playLobbySound } = useSocket();
  useSounds();
  const socket = getSocket();
  const myId = socket.id;

  const [betAmount, setBetAmount] = useState<number>(0);
  const [ppBet, setPpBet] = useState<number>(0);
  const [tpBet, setTpBet] = useState<number>(0);
  const [sideBetsOpen, setSideBetsOpen] = useState<boolean>(false);
  const [soundPickerOpen, setSoundPickerOpen] = useState<boolean>(false);

  useEffect(() => {
    const handler = (v: any) => useBlackjackStore.getState().setView(v);
    socket.on("blackjack:update" as any, handler);
    return () => { socket.off("blackjack:update" as any, handler); };
  }, [socket]);

  // Default the bet to the table minimum once the view loads.
  useEffect(() => {
    if (view && betAmount === 0) setBetAmount(view.config.minBet);
  }, [view, betAmount]);

  const myChips = view && myId ? view.chips[myId] ?? 0 : 0;
  const myBet = view && myId ? view.bets[myId] : null;
  const isMyTurn = view?.activePlayerId === myId;
  const canBet = useMemo(() => !!view && myChips >= view.config.minBet, [view, myChips]);

  if (!view) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-emerald-950">
        <p className="text-gray-400 text-lg">Dealing you in…</p>
      </div>
    );
  }

  const ack = (event: string, ...args: any[]) =>
    new Promise<{ success: boolean; error?: string }>((resolve) => {
      socket.emit(event as any, ...args, (res: any) => resolve(res));
    });

  const onBet = async () => {
    const res = await ack("blackjack:bet", betAmount, { perfectPairs: ppBet, twentyOnePlusThree: tpBet });
    // Reset side-bet inputs for the next round so old stakes don't stick.
    if (res.success) { setPpBet(0); setTpBet(0); }
    return res;
  };
  const onSitOut = () => ack("blackjack:sit-out");
  const onHit = () => ack("blackjack:hit");
  const onStand = () => ack("blackjack:stand");
  const onDouble = () => ack("blackjack:double");
  const onSplit = () => ack("blackjack:split");
  const onSurrender = () => ack("blackjack:surrender");
  const onInsurance = () => ack("blackjack:insurance");
  const onDeclineInsurance = () => ack("blackjack:decline-insurance");

  const myHands = view.hands[myId ?? ""] || [];
  const myActiveHand: Hand | undefined = isMyTurn ? myHands[view.activeHandIndex] : undefined;
  const canDouble = !!myActiveHand && myActiveHand.cards.length === 2 && myChips >= myActiveHand.bet;
  const canSplit = !!myActiveHand
    && myActiveHand.cards.length === 2
    && myActiveHand.cards[0].rank === myActiveHand.cards[1].rank
    && !myActiveHand.fromSplit
    && myChips >= myActiveHand.bet;
  const canSurrender = !!myActiveHand
    && myActiveHand.cards.length === 2
    && !myActiveHand.fromSplit;

  const phaseLabel =
    view.phase === "betting" ? "Place your bets"
    : view.phase === "dealing" ? "Dealing…"
    : view.phase === "insurance" ? "Insurance?"
    : view.phase === "playing" ? (isMyTurn ? "Your turn" : `${lobby?.players.find(p => p.id === view.activePlayerId)?.name ?? "…"}'s turn`)
    : view.phase === "dealer" ? "Dealer draws"
    : view.phase === "settle" ? "Round results"
    : "Game over";

  // Insurance computed values
  const myInsuranceDecision = myId ? view.insuranceDecisions?.[myId] : undefined;
  const myMainBet = typeof myBet === "number" ? myBet : 0;
  const myInsuranceAmount = Math.floor(myMainBet / 2);
  const canBuyInsurance = view.phase === "insurance"
    && myInsuranceDecision === null
    && myInsuranceAmount > 0
    && myChips >= myInsuranceAmount;

  // Chip quick-picks that scale with table limits. Clamp to max allowed.
  const chipValues = [
    view.config.minBet,
    view.config.minBet * 5,
    view.config.minBet * 10,
    view.config.minBet * 25,
    view.config.minBet * 50,
  ].filter(v => v <= Math.min(view.config.maxBet, myChips));

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden text-white
      bg-[radial-gradient(ellipse_at_center,_#14532d_0%,_#052e16_70%,_#000_100%)]">
      {/* Overlays */}
      <ReactionOverlay />
      <StickerOverlay />
      <GifOverlay />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-4 py-2 bg-black/40 backdrop-blur border-b border-white/10">
        <div className="flex items-center gap-3">
          <button onClick={leaveLobby} className="text-gray-400 hover:text-white text-sm flex items-center gap-1">
            <Icon icon="mdi:exit-to-app" /> Leave
          </button>
          <span className="text-xs text-gray-400">Round {view.roundNumber}</span>
          <span className="text-xs text-gray-500">· Shoe {view.shoeRemaining}</span>
        </div>
        <div className="flex items-center gap-3">
          {(view.phase === "betting" || view.phase === "insurance" || view.phase === "playing") && view.phaseDeadline > Date.now() && (
            <div className="flex items-center gap-1">
              <Icon icon="mdi:timer-outline" className="text-gray-400 text-base" />
              <RoundTimer deadline={view.phaseDeadline} />
            </div>
          )}
          <ScoreBar />
        </div>
      </div>

      {/* Felt table */}
      <div className="relative z-0 flex-1 flex flex-col items-center justify-between px-4 py-6 gap-4">
        {/* Dealer */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-yellow-200/80 uppercase tracking-widest">
            <Icon icon="mdi:account-tie" /> Dealer
            {view.dealerHand.length > 0 && view.phase !== "playing" && view.phase !== "dealing" && (
              <span className="text-white/90 font-bold text-sm">· {handDisplay(view.dealerHand)}</span>
            )}
          </div>
          <div className="flex gap-1.5 min-h-[6rem]">
            {view.dealerHand.length === 0
              ? <div className="text-gray-500 text-sm italic self-center">waiting…</div>
              : view.dealerHand.map((c, i) => (
                  <PlayingCard
                    key={`${view.roundNumber}-d-${i}-${c.rank}${c.suit}`}
                    card={c}
                    size="lg"
                    // Hole card (index 1) flips from back to face on reveal;
                    // the upcard and any subsequent draws use the standard deal-in.
                    animation={i === 1 && c.suit !== "?" ? "flip-reveal" : "deal-in"}
                  />
                ))}
          </div>
        </div>

        {/* Phase label */}
        <div className="text-center text-lg font-bold tracking-wider text-yellow-200 drop-shadow">
          {phaseLabel}
        </div>

        {/* Player seats */}
        <div className="flex flex-wrap justify-center gap-3 w-full max-w-6xl">
          {view.playerIds.map(pid => {
            const player = lobby?.players.find(p => p.id === pid);
            const name = player?.name ?? pid;
            const isBot = !!player?.isBot;
            const isMe = pid === myId;
            const chips = view.chips[pid] ?? 0;
            const bet = view.bets[pid];
            const hands = view.hands[pid] || [];
            const isActive = view.activePlayerId === pid;
            // Only mark eliminated when the player has no live bet this round.
            // Betting a full stack drops chips below minBet, but the hand still
            // needs to play out before they're actually out.
            const isEliminated = chips < view.config.minBet && view.phase !== "betting" && typeof bet !== "number";
            const mySettlements = view.lastSettlement?.filter(s => s.playerId === pid) || [];
            const myInsuranceResult = view.insuranceSettlement?.find(s => s.playerId === pid);
            // Net insurance chip change: delta - amount (won → +amount, lost → -amount, declined → 0)
            const insuranceNet = myInsuranceResult ? myInsuranceResult.delta - myInsuranceResult.amount : 0;
            const sideBetStakes = view.sideBets?.[pid];
            const sideBetTotal = (sideBetStakes?.perfectPairs ?? 0) + (sideBetStakes?.twentyOnePlusThree ?? 0);
            const mySideResult = view.sideBetSettlement?.find(s => s.playerId === pid);
            const sideNet = mySideResult
              ? (mySideResult.perfectPairs.delta - mySideResult.perfectPairs.stake)
                + (mySideResult.twentyOnePlusThree.delta - mySideResult.twentyOnePlusThree.stake)
              : 0;

            return (
              <div
                key={pid}
                className={`relative rounded-xl p-3 min-w-[200px] border-2 transition-all ${
                  isActive ? "border-yellow-400 shadow-[0_0_24px_rgba(250,204,21,0.4)] bg-emerald-900/70"
                  : isEliminated ? "border-gray-700 bg-black/30 opacity-50"
                  : isMe ? "border-emerald-400/60 bg-emerald-900/50"
                  : "border-emerald-700/50 bg-emerald-900/40"
                }`}
              >
                {/* Active-seat turn timer (playing phase only) */}
                {isActive && view.phase === "playing" && view.phaseDeadline > Date.now() && (
                  <SeatTimerBar deadline={view.phaseDeadline} totalMs={30_000} />
                )}

                {/* Name + chips */}
                <div className="flex items-center gap-2 mb-2">
                  <PlayerAvatar name={name} isBot={isBot} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">
                      {name}{isMe && <span className="text-emerald-300 font-normal"> (you)</span>}
                    </div>
                    <ChipStack amount={chips} />
                  </div>
                </div>

                {/* Bet status */}
                <div className="min-h-5 text-xs mb-2 flex items-center gap-1.5 flex-wrap">
                  {bet === "sitting_out" ? (
                    <span className="text-gray-400 italic">sitting out</span>
                  ) : typeof bet === "number" ? (
                    <span className="text-yellow-300">Bet: <span className="font-bold">{bet}</span></span>
                  ) : view.phase === "betting" ? (
                    <span className="text-gray-400 animate-pulse">choosing…</span>
                  ) : null}
                  {sideBetTotal > 0 && view.phase !== "betting" && (
                    <span
                      title={`Perfect Pairs ${sideBetStakes?.perfectPairs ?? 0} · 21+3 ${sideBetStakes?.twentyOnePlusThree ?? 0}`}
                      className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-600/30 text-purple-200 border border-purple-500/40"
                    >
                      Side ${sideBetTotal}
                    </span>
                  )}
                  {view.phase === "insurance" && view.insuranceDecisions?.[pid] === "insured" && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-500/30 text-yellow-200 border border-yellow-500/50">
                      Insured
                    </span>
                  )}
                  {view.phase === "insurance" && view.insuranceDecisions?.[pid] === null && (
                    <span className="text-gray-400 animate-pulse">deciding…</span>
                  )}
                </div>

                {/* Hands */}
                <div className="space-y-2 min-h-[6rem]">
                  {hands.length === 0 && view.phase !== "betting" && (
                    <div className="text-gray-500 italic text-xs">—</div>
                  )}
                  {hands.map((h, hi) => {
                    const handActive = isActive && view.activeHandIndex === hi;
                    const settlement = mySettlements.find(s => s.handIndex === hi);
                    // Net chip change: delta already includes the returned stake.
                    // Net = delta - bet  (win: +bet, blackjack: +1.5*bet, push: 0, lose: -bet)
                    const netDelta = settlement ? settlement.delta - h.bet : 0;
                    return (
                      <div
                        key={hi}
                        className={`relative rounded-md p-1.5 ${
                          handActive ? "ring-2 ring-yellow-400 bg-yellow-400/10" : ""
                        }`}
                      >
                        <div className="flex gap-1">
                          {h.cards.map((c, i) => (
                            <PlayingCard key={`${view.roundNumber}-${pid}-${hi}-${i}-${c.rank}${c.suit}`} card={c} size="sm" />
                          ))}
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-gray-200">
                          <span>{handDisplay(h.cards)}{h.doubled ? " · 2x" : ""}</span>
                          {settlement && <OutcomeBadge outcome={settlement.outcome} />}
                        </div>
                        {settlement && netDelta !== 0 && (
                          <div
                            key={`delta-${view.roundNumber}-${hi}`}
                            className={`pointer-events-none absolute left-1/2 -translate-x-1/2 -top-1 text-sm font-black tabular-nums animate-chip-float drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] ${
                              netDelta > 0 ? "text-yellow-300" : "text-red-400"
                            }`}
                          >
                            {netDelta > 0 ? `+$${netDelta}` : `-$${Math.abs(netDelta)}`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Insurance chip-delta — floats from the top of the seat when
                    settlement is revealed, so insured players see their 2:1 hit
                    (or their lost stake) without having to spot it in the chip
                    totals. */}
                {view.lastSettlement && insuranceNet !== 0 && (
                  <div
                    key={`ins-${view.roundNumber}-${pid}`}
                    className={`pointer-events-none absolute left-1/2 -translate-x-1/2 top-1 text-xs font-black tabular-nums animate-chip-float drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] ${
                      insuranceNet > 0 ? "text-yellow-300" : "text-red-400"
                    }`}
                  >
                    {insuranceNet > 0 ? `+$${insuranceNet} ins.` : `-$${Math.abs(insuranceNet)} ins.`}
                  </div>
                )}

                {/* Side-bet chip-delta — offset below the insurance delta so both
                    can be visible at once when a player had both going. */}
                {view.lastSettlement && sideNet !== 0 && (
                  <div
                    key={`side-${view.roundNumber}-${pid}`}
                    className={`pointer-events-none absolute left-1/2 -translate-x-1/2 top-5 text-xs font-black tabular-nums animate-chip-float drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)] ${
                      sideNet > 0 ? "text-purple-200" : "text-red-400"
                    }`}
                  >
                    {sideNet > 0 ? `+$${sideNet} side` : `-$${Math.abs(sideNet)} side`}
                  </div>
                )}

                {isEliminated && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
                    <span className="text-red-400 font-bold uppercase tracking-widest text-sm">Busted out</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Action dock */}
      <div className="relative z-10 bg-black/60 backdrop-blur border-t border-white/10 px-4 py-3">
        {/* Betting controls */}
        {view.phase === "betting" && canBet && myBet === null && (
          <div className="max-w-xl mx-auto">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-xs text-gray-400 uppercase tracking-wider">Your bet</span>
              <span className="text-2xl font-black text-yellow-300 tabular-nums">${betAmount}</span>
            </div>
            <div className="flex gap-1.5 flex-wrap mb-2">
              {chipValues.map(v => (
                <button
                  key={v}
                  onClick={() => setBetAmount(v)}
                  className={`px-2.5 py-1 rounded-full text-xs font-bold border-2 transition-colors ${
                    betAmount === v
                      ? "bg-yellow-400 text-black border-yellow-600"
                      : "bg-emerald-800/60 text-yellow-200 border-yellow-700/50 hover:bg-emerald-700/70"
                  }`}
                >
                  ${v}
                </button>
              ))}
            </div>
            <input
              type="range"
              min={view.config.minBet}
              max={Math.min(view.config.maxBet, myChips)}
              value={betAmount}
              onChange={e => setBetAmount(Number(e.target.value))}
              className="w-full accent-yellow-400"
            />
            <div className="flex justify-between text-[10px] text-gray-400 mb-2 tabular-nums">
              <span>min ${view.config.minBet}</span>
              <span>max ${Math.min(view.config.maxBet, myChips)}</span>
            </div>

            {/* Optional side bets — Perfect Pairs (25:1 top) and 21+3 (100:1 top) */}
            <div className="border-t border-white/10 pt-2 mb-2">
              <button
                type="button"
                onClick={() => setSideBetsOpen(o => !o)}
                className="w-full flex items-center justify-between text-[11px] text-gray-400 hover:text-white"
              >
                <span className="uppercase tracking-wider">
                  Side bets {(ppBet + tpBet > 0) && <span className="text-yellow-300 font-semibold">· ${ppBet + tpBet}</span>}
                </span>
                <Icon icon={sideBetsOpen ? "mdi:chevron-up" : "mdi:chevron-down"} width={14} />
              </button>
              {sideBetsOpen && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <SideBetInput
                    label="Perfect Pairs"
                    subtitle="up to 25:1"
                    value={ppBet}
                    onChange={setPpBet}
                    maxChips={myChips - betAmount - tpBet}
                  />
                  <SideBetInput
                    label="21+3"
                    subtitle="up to 100:1"
                    value={tpBet}
                    onChange={setTpBet}
                    maxChips={myChips - betAmount - ppBet}
                  />
                </div>
              )}
            </div>

            <div className="flex justify-center gap-2">
              <button
                onClick={onBet}
                className="px-6 py-2 rounded-full bg-yellow-400 hover:bg-yellow-300 text-black font-black uppercase tracking-wider text-sm shadow-lg"
              >
                Place Bet{(ppBet + tpBet > 0) && ` · $${betAmount + ppBet + tpBet} total`}
              </button>
              <button
                onClick={onSitOut}
                className="px-4 py-2 rounded-full bg-gray-700 hover:bg-gray-600 text-white text-sm"
              >
                Sit out
              </button>
            </div>
          </div>
        )}

        {/* Betting wait state */}
        {view.phase === "betting" && myBet !== null && (
          <div className="text-center text-sm text-gray-300">
            {myBet === "sitting_out"
              ? "Sitting out this round — waiting on others…"
              : <>Bet locked in. Waiting on the table…</>}
          </div>
        )}

        {/* Betting blocked (broke) */}
        {view.phase === "betting" && !canBet && (
          <div className="text-center text-sm text-red-300">
            Not enough chips to meet the minimum (${view.config.minBet}).
          </div>
        )}

        {/* Insurance prompt */}
        {view.phase === "insurance" && myInsuranceDecision === null && myMainBet > 0 && (
          <div className="max-w-xl mx-auto text-center">
            <p className="text-xs text-gray-300 mb-2">
              Dealer shows an Ace. Place insurance for <span className="text-yellow-300 font-bold">${myInsuranceAmount}</span> — pays 2:1 if dealer has blackjack.
            </p>
            <div className="flex justify-center gap-2 flex-wrap">
              <button
                onClick={onInsurance}
                disabled={!canBuyInsurance}
                className="px-5 py-2 rounded-full bg-yellow-500 hover:bg-yellow-400 text-black disabled:bg-gray-800 disabled:text-gray-600 font-black uppercase tracking-wider text-sm shadow-lg"
              >
                Insure (${myInsuranceAmount})
              </button>
              <button
                onClick={onDeclineInsurance}
                className="px-5 py-2 rounded-full bg-gray-700 hover:bg-gray-600 text-white font-bold uppercase tracking-wider text-sm shadow-lg"
              >
                No Insurance
              </button>
            </div>
          </div>
        )}

        {view.phase === "insurance" && myInsuranceDecision !== null && myInsuranceDecision !== undefined && (
          <div className="text-center text-sm text-gray-300">
            {myInsuranceDecision === "insured"
              ? <>Insurance placed. Peeking…</>
              : <>Insurance declined. Peeking…</>}
          </div>
        )}

        {view.phase === "insurance" && myMainBet === 0 && (
          <div className="text-center text-sm text-gray-400">
            Dealer shows an Ace — waiting on other players.
          </div>
        )}

        {/* Turn actions */}
        {view.phase === "playing" && isMyTurn && myActiveHand && (
          <div className="flex justify-center gap-2 flex-wrap">
            <button onClick={onHit} className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-500 font-bold uppercase tracking-wider text-sm shadow-lg">
              Hit
            </button>
            <button onClick={onStand} className="px-5 py-2 rounded-full bg-gray-700 hover:bg-gray-600 font-bold uppercase tracking-wider text-sm shadow-lg">
              Stand
            </button>
            <button
              onClick={onDouble}
              disabled={!canDouble}
              className="px-5 py-2 rounded-full bg-purple-600 hover:bg-purple-500 disabled:bg-gray-800 disabled:text-gray-600 font-bold uppercase tracking-wider text-sm shadow-lg"
            >
              Double
            </button>
            <button
              onClick={onSplit}
              disabled={!canSplit}
              className="px-5 py-2 rounded-full bg-green-600 hover:bg-green-500 disabled:bg-gray-800 disabled:text-gray-600 font-bold uppercase tracking-wider text-sm shadow-lg"
            >
              Split
            </button>
            <button
              onClick={onSurrender}
              disabled={!canSurrender}
              title="Forfeit the hand for half your bet back"
              className="px-5 py-2 rounded-full bg-orange-600 hover:bg-orange-500 disabled:bg-gray-800 disabled:text-gray-600 font-bold uppercase tracking-wider text-sm shadow-lg"
            >
              Surrender
            </button>
          </div>
        )}

        {view.phase === "playing" && !isMyTurn && (
          <div className="text-center text-sm text-gray-300">
            Waiting for {lobby?.players.find(p => p.id === view.activePlayerId)?.name ?? "next player"}…
          </div>
        )}

        {view.phase === "settle" && view.lastSettlement && (
          <div className="text-center text-sm text-gray-200">
            Next round in <RoundTimer deadline={view.phaseDeadline} />…
          </div>
        )}

        <div className="flex justify-center mt-2">
          <ReactionBar />
        </div>
      </div>

      {/* Floating soundboard button — sits directly above the Chat button so
          the column reads: soundboard, chat (with voice-chat to the left). */}
      <button
        onClick={() => setSoundPickerOpen(true)}
        className="fixed bottom-20 right-4 z-40 w-12 h-12 bg-purple-600 hover:bg-purple-700 rounded-full flex items-center justify-center shadow-lg transition-colors"
        title="Soundboard"
      >
        <Icon icon="entypo:sound-mix" className="text-xl" />
      </button>
      {soundPickerOpen && (
        <SoundPicker
          onPlay={(mp3, title) => playLobbySound(mp3, title)}
          onClose={() => setSoundPickerOpen(false)}
        />
      )}

      <VoiceChat floating />
      <Chat />
    </div>
  );
}
