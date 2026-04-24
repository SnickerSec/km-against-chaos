"use client";

import { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { getSocket, waitForAuth } from "./socket";
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
import { useFriendsStore } from "./friendsStore";
import { usePartyStore } from "./partyStore";
import { useBlackjackStore } from "./blackjackStore";
import { toast } from "sonner";

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
    addVotedPlayer,
    setWinnerInfo,
    setVoteTally,
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

    // Don't re-register if game listeners are already attached
    if (socket.listeners("lobby:updated").length > 0) return;

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

    // session:reconnected is handled in socket.ts (registered at creation time
    // to avoid missing the event on page refresh before useEffect runs)

    socket.on("error", (message: string) => toast.error(message));

    // ── Game Events ──

    socket.on("game:round-start", (view: PlayerGameView) => {
      setGameView(view);
      setScreen("game");
    });

    socket.on("game:player-submitted", (playerId: string) => {
      addSubmittedPlayer(playerId);
    });

    socket.on("game:player-voted" as any, (playerId: string) => {
      addVotedPlayer(playerId);
    });

    // Server force-submitted our cards because the submit timer ran out.
    // Surface it so players don't see cards "just appear" without a reason.
    socket.on("game:auto-submitted" as any, () => {
      toast.info("Time ran out — random cards auto-submitted for you");
    });

    // Server auto-picked a winner because the czar's judging timer expired.
    socket.on("game:auto-picked" as any, () => {
      toast.info("Time ran out — a random winner was picked for you");
    });

    socket.on("game:vote-tally" as any, (tally: Record<string, number>) => {
      setVoteTally(tally);
    });

    socket.on("game:judging", (submissions: Submission[], _chaosCard: ChaosCard) => {
      setSubmissions(submissions);
    });

    socket.on(
      "game:round-winner",
      (winnerId: string, winnerName: string, cards: KnowledgeCard[], scores: Record<string, number>, audiencePick?: string | null) => {
        setWinnerInfo({ winnerId, winnerName, cards, audiencePick });
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
        votedPlayers: new Set(),
        selectedCards: [],
        winnerInfo: null,
        voteTally: null,
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
      toast.warning("You were removed from the lobby");
      setScreen("home");
    });

    socket.on("media:sticker" as any, (url: string, playerName: string) => {
      setActiveSticker({ url, playerName });
      setTimeout(() => setActiveSticker(null), 1500);
    });

    // ── Uno Events ──

    // ── Codenames Events ──

    socket.on("codenames:update" as any, (view: any) => {
      // Ignore stragglers after a clean leave — otherwise a late update from
      // the game engine would drag us back onto the game screen.
      if (!useGameStore.getState().lobby) return;
      useGameStore.getState().setCodenamesView(view);
      if (useGameStore.getState().screen !== "game") {
        setScreen("game");
      }
    });

    socket.on("blackjack:update" as any, (view: any) => {
      if (!useGameStore.getState().lobby) return;
      useGameStore.getState().setGameType("blackjack");
      useBlackjackStore.getState().setView(view);
      if (useGameStore.getState().screen !== "game") {
        setScreen("game");
      }
    });

    socket.on("uno:turn-update" as any, (view: UnoPlayerView) => {
      if (!useGameStore.getState().lobby) return;
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

    // ── Friends events ──
    socket.on("friend:online" as any, ({ userId }: { userId: string }) => {
      useFriendsStore.getState().setUserOnline(userId);
    });
    socket.on("friend:offline" as any, ({ userId }: { userId: string }) => {
      useFriendsStore.getState().setUserOffline(userId);
    });
    socket.on("invite:received" as any, (invite: any) => {
      useFriendsStore.getState().addInvite({
        id: `${invite.lobbyCode}-${Date.now()}`,
        ...invite,
        timestamp: Date.now(),
      });
    });
    socket.on("dm:received" as any, (msg: any) => {
      const { dmOpen } = useFriendsStore.getState();
      if (dmOpen !== msg.sender_id) {
        useFriendsStore.getState().incrementUnread(msg.sender_id);
      }
    });
    socket.on("notification:new" as any, (notification: any) => {
      useFriendsStore.getState().addNotification(notification);
    });

    // ── Party events ──
    socket.on("party:updated" as any, (party: any) => {
      usePartyStore.getState().setParty(party);
    });
    socket.on("party:disbanded" as any, () => {
      usePartyStore.getState().setParty(null);
    });
    socket.on("party:invite" as any, (invite: any) => {
      usePartyStore.getState().addInvite({ ...invite, timestamp: Date.now() });
    });
    socket.on("sound:received" as any, ({ mp3, title: _title, playerName: _playerName }: { mp3: string; title: string; playerName: string }) => {
      if (typeof window === "undefined") return;
      new Audio(mp3).play().catch(() => {});
    });

    socket.on("party:game-starting" as any, ({ lobbyCode }: { lobbyCode: string }) => {
      // Auto-join the lobby when party leader starts a game
      const partyState = usePartyStore.getState().party;
      if (partyState) {
        const myName = partyState.members.find(m => m.userId !== partyState.leaderId)?.name || "Player";
        socket.emit("lobby:join", lobbyCode, myName, (response: any) => {
          if (response.success && response.lobby) {
            useGameStore.getState().setLobby(response.lobby);
            useGameStore.getState().setScreen("lobby");
          }
        });
      }
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
    addVotedPlayer,
    setWinnerInfo,
    setVoteTally,
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

    const doCreate = () => {
      socket.emit(
        "lobby:create",
        playerName,
        deckId || "km-against-chaos",
        (response: { success: boolean; lobby?: LobbyState; error?: string }) => {
          if (response.success && response.lobby) {
            setLobby(response.lobby);
            setScreen("lobby");
          } else if (response.error === "You are already in a lobby") {
            // Auto-leave stale lobby and retry
            socket.emit("lobby:leave");
            setTimeout(doCreate, 100);
          } else {
            setError(response.error || "Failed to create lobby");
          }
        }
      );
    };
    doCreate();
  };

  const joinLobby = (code: string, playerName: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    const doJoin = () => {
      socket.emit(
        "lobby:join",
        code,
        playerName,
        (response: { success: boolean; lobby?: LobbyState; error?: string }) => {
          if (response.success && response.lobby) {
            setLobby(response.lobby);
            setScreen("lobby");
          } else if (response.error === "You are already in a lobby") {
            // Auto-leave stale lobby and retry
            socket.emit("lobby:leave");
            setTimeout(doJoin, 100);
          } else {
            setError(response.error || "Failed to join lobby");
          }
        }
      );
    };
    doJoin();
  };

  const leaveLobby = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:leave");
    setLobby(null);
    setScreen("home");
  };

  const changeDeck = (deckId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:change-deck" as any, deckId, (response: any) => {
      if (!response.success) {
        setError(response.error || "Failed to change deck");
      }
    });
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
          toast.error(response.error || "Failed to play setup card");
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
          toast.error(response.error || "Failed to submit cards");
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
          toast.error(response.error || "Failed to pick winner");
        }
      }
    );
  };

  const spectatorVote = (votedForId: string) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit(
      "game:spectator-vote" as any,
      votedForId,
      (response: { success: boolean; error?: string }) => {
        if (!response.success && response.error !== "Already voted") {
          toast.error(response.error || "Failed to vote");
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
    socket.emit("lobby:add-bot" as any, (response: { success: boolean; lobby?: LobbyState; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to add bot");
      } else if (response.lobby) {
        setLobby(response.lobby);
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

  const voteRematch = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:vote-rematch" as any, (response: any) => {
      if (!response.success) {
        setError(response.error || "Failed to vote");
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
        toast.error(response.error || "Failed to play card");
      }
      useGameStore.setState({ selectedUnoCard: null, choosingColor: false });
    });
  };

  const drawUnoCard = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("uno:draw-card" as any, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        toast.error(response.error || "Failed to draw card");
      }
    });
  };

  const callUno = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("uno:call-uno" as any, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        toast.error(response.error || "Can't call Uno");
      }
    });
  };

  const challengeUno = (targetId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("uno:challenge-uno" as any, targetId, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        toast.error(response.error || "Can't challenge");
      }
    });
  };

  const unoNextRound = () => {
    const socket = socketRef.current;
    if (!socket) return;
    useGameStore.setState({ unoRoundWinner: null });
    socket.emit("uno:next-round" as any);
  };

  const codenamesJoinTeam = (team: string, asSpymaster: boolean) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("codenames:join-team" as any, team, asSpymaster, (res: any) => {
      if (!res.success) toast.error(res.error || "Couldn't join team");
    });
  };

  const codenamesStartRound = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("codenames:start-round" as any, (res: any) => {
      if (!res.success) toast.error(res.error || "Couldn't start round");
    });
  };

  const codenamesGiveClue = (word: string, count: number) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("codenames:give-clue" as any, word, count, (res: any) => {
      if (!res.success) toast.error(res.error || "Couldn't give clue");
    });
  };

  const codenamesGuess = (wordIndex: number) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("codenames:guess" as any, wordIndex, (res: any) => {
      if (!res.success) toast.error(res.error || "Couldn't guess");
    });
  };

  const codenamesPass = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("codenames:pass" as any, (res: any) => {
      if (!res.success) toast.error(res.error || "Couldn't pass");
    });
  };

  const setHouseRules = (houseRules: { unoStacking?: boolean; botCzar?: boolean }) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:set-house-rules" as any, houseRules, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to set house rules");
      }
    });
  };

  const setMaxPlayers = (maxPlayers: number) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("lobby:set-max-players" as any, maxPlayers, (response: { success: boolean; error?: string }) => {
      if (!response.success) {
        setError(response.error || "Failed to set player limit");
      }
    });
  };

  const sendInvite = (targetUserId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("invite:send" as any, targetUserId);
  };

  const sendDm = (targetUserId: string, content: string, callback?: (res: any) => void) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("dm:send" as any, targetUserId, content, callback);
  };

  const createParty = async (callback?: (res: any) => void) => {
    const socket = socketRef.current;
    if (!socket) return;
    await waitForAuth();
    socket.emit("party:create" as any, (res: any) => {
      if (res.success) {
        usePartyStore.getState().setParty(res.party);
      }
      callback?.(res);
    });
  };

  const inviteToParty = (targetUserId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("party:invite" as any, targetUserId);
  };

  const leaveParty = () => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("party:leave" as any, () => {
      usePartyStore.getState().setParty(null);
    });
  };

  const startPartyGame = (deckId: string, callback?: (res: any) => void) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("party:start-game" as any, deckId, callback);
  };

  const sendDmTyping = (targetUserId: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("dm:typing" as any, targetUserId);
  };

  const playLobbySound = (mp3: string, title: string) => {
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit("sound:play" as any, { mp3, title });
  };

  return {
    socket: socketRef.current,
    createLobby,
    joinLobby,
    leaveLobby,
    changeDeck,
    startGame,
    czarSetup,
    submitCards,
    pickWinner,
    spectatorVote,
    nextRound,
    sendChat,
    sendGif,
    sendSticker,
    addBot,
    removeBot,
    kickPlayer,
    spectateGame,
    rematch,
    voteRematch,
    playUnoCard,
    drawUnoCard,
    callUno,
    challengeUno,
    unoNextRound,
    setHouseRules,
    setMaxPlayers,
    sendInvite,
    sendDm,
    sendDmTyping,
    createParty,
    inviteToParty,
    leaveParty: leaveParty as any,
    startPartyGame,
    codenamesJoinTeam,
    codenamesStartRound,
    codenamesGiveClue,
    codenamesGuess,
    codenamesPass,
    playLobbySound,
  };
}
