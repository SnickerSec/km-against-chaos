"use client";

import { useEffect, useRef } from "react";
import { useGameStore } from "./store";
import { getSocket } from "./socket";
import { playSound, preloadSounds } from "./sounds";

export function useSounds() {
  const {
    screen, scores,
    winnerInfo, activeMetaEffect,
    unoTurn, unoRoundWinner,
  } = useGameStore();

  const prevScreen        = useRef(screen);
  const prevWinnerInfo    = useRef(winnerInfo);
  const prevMetaEffect    = useRef(activeMetaEffect);
  const prevUnoWinner     = useRef(unoRoundWinner);
  const prevUnoCalledBy   = useRef(unoTurn?.unoCalledBy);
  const prevLastAction    = useRef(unoTurn?.lastAction);

  // Preload all sounds when game starts
  useEffect(() => {
    if (screen === "game") preloadSounds();
  }, [screen]);

  // CAH/JH/A2A: round winner revealed
  useEffect(() => {
    if (!prevWinnerInfo.current && winnerInfo) {
      const myId = getSocket().id ?? "";
      playSound(winnerInfo.winnerId === myId ? "win" : "lose");
    }
    prevWinnerInfo.current = winnerInfo;
  }, [winnerInfo]);

  // Meta card triggered
  useEffect(() => {
    if (!prevMetaEffect.current && activeMetaEffect) {
      const myId = getSocket().id ?? "";
      const affectsMe = activeMetaEffect.affectedPlayerIds.includes(myId);
      if (affectsMe && activeMetaEffect.effectType === "hand_reset") {
        playSound("reset");
      } else if (affectsMe && activeMetaEffect.effectType === "score_subtract") {
        playSound("stolen");
      } else {
        playSound("meta");
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
      playSound(myScore > 0 && myScore >= maxScore ? "victory" : "defeat");
    }
    prevScreen.current = screen;
  }, [screen, scores]);

  // Uno: round winner
  useEffect(() => {
    if (!prevUnoWinner.current && unoRoundWinner) {
      const myId = getSocket().id ?? "";
      playSound(unoRoundWinner.winnerId === myId ? "win" : "lose");
    }
    prevUnoWinner.current = unoRoundWinner;
  }, [unoRoundWinner]);

  // Uno: someone called UNO!
  useEffect(() => {
    if (!prevUnoCalledBy.current && unoTurn?.unoCalledBy) {
      playSound("uno");
    }
    prevUnoCalledBy.current = unoTurn?.unoCalledBy;
  }, [unoTurn?.unoCalledBy]);

  // Uno: wild draw 4 / skip
  useEffect(() => {
    const action = unoTurn?.lastAction;
    if (action && action !== prevLastAction.current) {
      if (action.includes("wild_draw_four") || action.includes("draw_four")) {
        playSound("draw4");
      } else if (action.includes("skip")) {
        playSound("skip");
      }
    }
    prevLastAction.current = unoTurn?.lastAction;
  }, [unoTurn?.lastAction]);
}
