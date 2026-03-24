"use client";

import { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { getSocket } from "./socket";
import {
  useGameStore,
  LobbyState,
  PlayerGameView,
  Submission,
  ChaosCard,
  KnowledgeCard,
  ChatMessage,
} from "./store";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const {
    setConnected,
    setLobby,
    setError,
    setScreen,
    setGameView,
    setSubmissions,
    addSubmittedPlayer,
    setWinnerInfo,
    setScores,
    addChatMessage,
  } = useGameStore();

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    // Don't re-register if listeners are already attached
    if (socket.listeners("connect").length > 0) return;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("lobby:updated", (state: LobbyState) => setLobby(state));

    socket.on("lobby:host-changed", (newHostId: string) => {
      const currentLobby = useGameStore.getState().lobby;
      if (currentLobby) {
        setLobby({
          ...currentLobby,
          hostId: newHostId,
          players: currentLobby.players.map((p) => ({
            ...p,
            isHost: p.id === newHostId,
          })),
        });
      }
    });

    socket.on("lobby:started", () => {
      setScreen("game");
    });

    socket.on("session:reconnected" as any, (data: { lobby: LobbyState; gameView: PlayerGameView | null; screen: "lobby" | "game" }) => {
      setLobby(data.lobby);
      if (data.gameView) {
        setGameView(data.gameView);
      }
      setScreen(data.screen);
    });

    socket.on("error", (message: string) => setError(message));

    // ── Game Events ──

    socket.on("game:round-start", (view: PlayerGameView) => {
      setGameView(view);
      setScreen("game");
    });

    socket.on("game:player-submitted", (playerId: string) => {
      addSubmittedPlayer(playerId);
    });

    socket.on("game:judging", (submissions: Submission[], _chaosCard: ChaosCard) => {
      setSubmissions(submissions);
    });

    socket.on(
      "game:round-winner",
      (winnerId: string, winnerName: string, cards: KnowledgeCard[], scores: Record<string, number>) => {
        setWinnerInfo({ winnerId, winnerName, cards });
        setScores(scores);
      }
    );

    socket.on("game:over", (scores: Record<string, number>) => {
      setScores(scores);
      setScreen("gameover");
    });

    socket.on("chat:message", (msg: ChatMessage) => {
      addChatMessage(msg);
    });

    return () => {
      // Don't disconnect — the socket is a singleton that persists across screen changes
    };
  }, [
    setConnected,
    setLobby,
    setError,
    setScreen,
    setGameView,
    setSubmissions,
    addSubmittedPlayer,
    setWinnerInfo,
    setScores,
    addChatMessage,
  ]);

  const createLobby = (playerName: string, deckId?: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit(
      "lobby:create",
      playerName,
      deckId || "km-against-chaos",
      (response: { success: boolean; lobby?: LobbyState; error?: string }) => {
        if (response.success && response.lobby) {
          setLobby(response.lobby);
          setScreen("lobby");
        } else {
          setError(response.error || "Failed to create lobby");
        }
      }
    );
  };

  const joinLobby = (code: string, playerName: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit(
      "lobby:join",
      code,
      playerName,
      (response: { success: boolean; lobby?: LobbyState; error?: string }) => {
        if (response.success && response.lobby) {
          setLobby(response.lobby);
          setScreen("lobby");
        } else {
          setError(response.error || "Failed to join lobby");
        }
      }
    );
  };

  const leaveLobby = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:leave");
    setLobby(null);
    setScreen("home");
  };

  const startGame = () => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit(
      "lobby:start",
      (response: { success: boolean; error?: string }) => {
        if (!response.success) {
          setError(response.error || "Failed to start game");
        }
      }
    );
  };

  const submitCards = (cardIds: string[]) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit(
      "game:submit",
      cardIds,
      (response: { success: boolean; error?: string }) => {
        if (response.success) {
          useGameStore.getState().setHasSubmitted(true);
          useGameStore.getState().toggleCardSelection("", 0); // clear selection
          useGameStore.setState({ selectedCards: [] });
        } else {
          setError(response.error || "Failed to submit cards");
        }
      }
    );
  };

  const pickWinner = (playerId: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit(
      "game:pick-winner",
      playerId,
      (response: { success: boolean; error?: string }) => {
        if (!response.success) {
          setError(response.error || "Failed to pick winner");
        }
      }
    );
  };

  const nextRound = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("game:next-round");
  };

  const sendChat = (message: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("chat:send", message);
  };

  return {
    socket: socketRef.current,
    createLobby,
    joinLobby,
    leaveLobby,
    startGame,
    submitCards,
    pickWinner,
    nextRound,
    sendChat,
  };
}
