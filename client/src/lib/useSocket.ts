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
  MetaEffectNotification,
  UnoPlayerView,
  UnoCard,
  UnoColor,
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
    setActiveSticker,
    setActiveMetaEffect,
    setHandBlurred,
    setIconsRandomized,
    setCountdown,
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

    socket.on("lobby:countdown" as any, (count: number) => {
      setCountdown(count > 0 ? count : null);
    });

    socket.on("lobby:started", () => {
      setCountdown(null);
      setScreen("game");
    });

    socket.on("session:reconnected" as any, (data: { lobby: LobbyState; gameView: PlayerGameView | null; chatHistory: ChatMessage[]; screen: "lobby" | "game" }) => {
      setLobby(data.lobby);
      if (data.gameView) {
        setGameView(data.gameView);
      }
      if (data.chatHistory?.length) {
        useGameStore.setState({ chatMessages: data.chatHistory });
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

    socket.on("game:rematch" as any, () => {
      // Reset game state but keep lobby
      useGameStore.setState({
        hand: [],
        round: null,
        scores: {},
        roundNumber: 0,
        maxRounds: 0,
        hasSubmitted: false,
        submittedPlayers: new Set(),
        selectedCards: [],
        winnerInfo: null,
      });
      setScreen("lobby");
    });

    socket.on("game:meta-effect" as any, (payload: MetaEffectNotification) => {
      setActiveMetaEffect(payload);
      // Auto-dismiss notification after 4 seconds
      setTimeout(() => setActiveMetaEffect(null), 4000);

      const myId = socket.id ?? "";
      const isAffected = myId ? payload.affectedPlayerIds.includes(myId) : false;

      if (isAffected) {
        if (payload.effectType === "hide_cards") {
          setHandBlurred(true);
          const duration = 20000;
          setTimeout(() => setHandBlurred(false), duration);
        } else if (payload.effectType === "randomize_icons") {
          setIconsRandomized(true);
          const duration = 15000;
          setTimeout(() => setIconsRandomized(false), duration);
        }
      }
    });

    socket.on("game:hand-updated" as any, (hand: KnowledgeCard[]) => {
      useGameStore.setState({ hand });
    });

    socket.on("chat:message", (msg: ChatMessage) => {
      addChatMessage(msg);
    });

    socket.on("lobby:kicked" as any, () => {
      setLobby(null);
      setError("You were removed from the lobby");
      setScreen("home");
    });

    socket.on("media:sticker" as any, (url: string, playerName: string) => {
      setActiveSticker({ url, playerName });
      setTimeout(() => setActiveSticker(null), 1500);
    });

    // ── Uno Events ──

    socket.on("uno:turn-update" as any, (view: UnoPlayerView) => {
      useGameStore.getState().setUnoGameView(view);
      if (useGameStore.getState().screen !== "game") {
        setScreen("game");
      }
    });

    socket.on("uno:round-over" as any, (winnerId: string, winnerName: string, scores: Record<string, number>, roundPoints: number) => {
      useGameStore.getState().setUnoRoundWinner({ winnerId, winnerName, roundPoints });
      setScores(scores);
    });

    socket.on("uno:game-over" as any, (scores: Record<string, number>) => {
      setScores(scores);
      setScreen("gameover");
    });

    socket.on("uno:uno-called" as any, (_playerId: string, _playerName: string) => {
      // Could add a toast/animation here
    });

    socket.on("uno:uno-penalty" as any, (_playerId: string, _playerName: string) => {
      // Could add a toast/animation here
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
    setActiveSticker,
    setActiveMetaEffect,
    setHandBlurred,
    setIconsRandomized,
    setCountdown,
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

  const czarSetup = (cardId: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit(
      "game:czar-setup" as any,
      cardId,
      (response: { success: boolean; error?: string }) => {
        if (!response.success) {
          setError(response.error || "Failed to play setup card");
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

  const sendGif = (gifUrl: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("chat:gif" as any, gifUrl);
  };

  const sendSticker = (url: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("media:sticker" as any, url);
  };

  const addBot = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:add-bot" as any, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to add bot");
      }
    });
  };

  const rematch = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("game:rematch" as any, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to start rematch");
      }
    });
  };

  const spectateGame = (code: string, playerName: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit(
      "lobby:spectate" as any,
      code,
      playerName,
      (response: { success: boolean; lobby?: LobbyState; error?: string }) => {
        if (response.success && response.lobby) {
          setLobby(response.lobby);
          setScreen("lobby");
        } else {
          setError(response.error || "Failed to spectate");
        }
      }
    );
  };

  const kickPlayer = (playerId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:kick" as any, playerId, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to kick player");
      }
    });
  };

  const removeBot = (botId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:remove-bot" as any, botId, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to remove bot");
      }
    });
  };

  const playUnoCard = (cardId: string, chosenColor?: UnoColor) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("uno:play-card" as any, cardId, chosenColor || null, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to play card");
      }
      useGameStore.setState({ selectedUnoCard: null, choosingColor: false });
    });
  };

  const drawUnoCard = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("uno:draw-card" as any, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to draw card");
      }
    });
  };

  const callUno = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("uno:call-uno" as any, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Can't call Uno");
      }
    });
  };

  const challengeUno = (targetId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("uno:challenge-uno" as any, targetId, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Can't challenge");
      }
    });
  };

  const unoNextRound = () => {
    const socket = socketRef.current;
    if (!socket) return;
    useGameStore.setState({ unoRoundWinner: null });
    socket.emit("uno:next-round" as any);
  };

  return {
    socket: socketRef.current,
    createLobby,
    joinLobby,
    leaveLobby,
    startGame,
    czarSetup,
    submitCards,
    pickWinner,
    nextRound,
    sendChat,
    sendGif,
    sendSticker,
    addBot,
    removeBot,
    kickPlayer,
    spectateGame,
    rematch,
    playUnoCard,
    drawUnoCard,
    callUno,
    challengeUno,
    unoNextRound,
  };
}
