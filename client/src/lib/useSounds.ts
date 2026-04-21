"use client";

import { useEffect, useRef } from "react";
import { useGameStore } from "./store";
import { useBlackjackStore } from "./blackjackStore";
import { getSocket } from "./socket";
import { playSound, playUrl, preloadSounds, SoundKey } from "./sounds";
import { fetchDeck } from "./api";

export function useSounds() {
  const {
    screen, scores, round,
    winnerInfo, activeMetaEffect,
    unoTurn, unoRoundWinner,
    lobby,
  } = useGameStore();
  const blackjackView = useBlackjackStore(s => s.view);

  const soundOverridesRef = useRef<Record<string, string | null> | null>(null);
  const deckId = lobby?.deckId;
  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    fetchDeck(deckId).then((d) => {
      if (!cancelled) soundOverridesRef.current = d.soundOverrides || null;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [deckId]);

  function play(key: SoundKey) {
    const url = soundOverridesRef.current?.[key];
    if (url) playUrl(url);
    else playSound(key);
  }

  const prevScreen        = useRef(screen);
  const prevWinnerInfo    = useRef(winnerInfo);
  const prevMetaEffect    = useRef(activeMetaEffect);
  const prevUnoWinner     = useRef(unoRoundWinner);
  const prevUnoCalledBy   = useRef(unoTurn?.unoCalledBy);
  const prevLastAction    = useRef(unoTurn?.lastAction);
  const prevBjSettlement  = useRef(blackjackView?.lastSettlement);
  const prevBjPhase       = useRef(blackjackView?.phase);

  // Preload all sounds when game starts
  useEffect(() => {
    if (screen === "game") preloadSounds();
  }, [screen]);

  // CAH/JH/A2A: round winner revealed (czar doesn't get win/lose — they picked)
  useEffect(() => {
    if (!prevWinnerInfo.current && winnerInfo) {
      const myId = getSocket().id ?? "";
      const isCzar = round?.czarId === myId;
      if (!isCzar) {
        play(winnerInfo.winnerId === myId ? "win" : "lose");
      }
    }
    prevWinnerInfo.current = winnerInfo;
  }, [winnerInfo, round?.czarId]);

  // Meta card triggered
  useEffect(() => {
    if (!prevMetaEffect.current && activeMetaEffect) {
      const myId = getSocket().id ?? "";
      const affectsMe = activeMetaEffect.affectedPlayerIds.includes(myId);
      if (affectsMe && activeMetaEffect.effectType === "hand_reset") {
        play("reset");
      } else if (affectsMe && activeMetaEffect.effectType === "score_subtract") {
        play("stolen");
      } else {
        play("meta");
      }
    }
    prevMetaEffect.current = activeMetaEffect;
  }, [activeMetaEffect]);

  // Game over
  useEffect(() => {
    if (prevScreen.current === "game" && screen === "gameover") {
      const myId = getSocket().id ?? "";
      const vals = Object.values(scores);
      const myScore = scores[myId] ?? 0;
      const maxScore = vals.length ? Math.max(...vals) : 0;
      play(myScore > 0 && myScore >= maxScore ? "victory" : "defeat");
    }
    prevScreen.current = screen;
  }, [screen, scores]);

  // Uno: round winner
  useEffect(() => {
    if (!prevUnoWinner.current && unoRoundWinner) {
      const myId = getSocket().id ?? "";
      play(unoRoundWinner.winnerId === myId ? "win" : "lose");
    }
    prevUnoWinner.current = unoRoundWinner;
  }, [unoRoundWinner]);

  // Uno: someone called UNO!
  useEffect(() => {
    if (!prevUnoCalledBy.current && unoTurn?.unoCalledBy) {
      play("uno");
    }
    prevUnoCalledBy.current = unoTurn?.unoCalledBy;
  }, [unoTurn?.unoCalledBy]);

  // Uno: wild draw 4 / skip
  useEffect(() => {
    const action = unoTurn?.lastAction;
    if (action && action !== prevLastAction.current) {
      if (action.includes("wild_draw_four") || action.includes("draw_four")) {
        play("draw4");
      } else if (action.includes("skip")) {
        play("skip");
      }
    }
    prevLastAction.current = unoTurn?.lastAction;
  }, [unoTurn?.lastAction]);

  // Blackjack: hand settled — prioritize win/blackjack over lose when a
  // player has multiple hands (e.g. split) with mixed outcomes. Push-only
  // settlements stay silent.
  useEffect(() => {
    const cur = blackjackView?.lastSettlement;
    if (!prevBjSettlement.current && cur && cur.length > 0) {
      const myId = getSocket().id ?? "";
      const mine = cur.filter(s => s.playerId === myId);
      const hasWin = mine.some(s => s.outcome === "win" || s.outcome === "blackjack");
      const hasLose = mine.some(s => s.outcome === "lose");
      if (hasWin) play("win");
      else if (hasLose) play("lose");
    }
    prevBjSettlement.current = cur;
  }, [blackjackView?.lastSettlement]);

  // Blackjack: game over — decide victory/defeat by final chip stack.
  useEffect(() => {
    const cur = blackjackView?.phase;
    if (prevBjPhase.current !== "gameOver" && cur === "gameOver") {
      const myId = getSocket().id ?? "";
      const chips = blackjackView?.chips ?? {};
      const vals = Object.values(chips);
      const myChips = chips[myId] ?? 0;
      const maxChips = vals.length ? Math.max(...vals) : 0;
      play(myChips > 0 && myChips >= maxChips ? "victory" : "defeat");
    }
    prevBjPhase.current = cur;
  }, [blackjackView?.phase, blackjackView?.chips]);
}
