import express from 'express';
import path from 'path';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

import { 
  RoomState, Player, Card, ChatMessage, GamePhase, 
  ClientMessage, ServerMessage, WinnerInfo 
} from './src/types.js';

import { evaluate7CardHand, compareEvaluations } from './src/pokerEvaluator.js';

// Server state
const rooms: { [code: string]: RoomState } = {};
const decks: { [code: string]: Card[] } = {};
const playerHands: { [code: string]: { [playerId: string]: Card[] } } = {};
const activeTimers: { [code: string]: NodeJS.Timeout | null } = {};
const clientRooms: { [playerId: string]: string } = {}; // Mapping player ID -> room code
const clientNames: { [playerId: string]: string } = {}; // Mapping player ID -> player name
const activeSockets: { [playerId: string]: WebSocket } = {};

const PORT = 3000;

// Standard 52 Poker Deck Builder
function createDeck(): Card[] {
  const suits: ('H' | 'D' | 'C' | 'S')[] = ['H', 'D', 'C', 'S'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value });
    }
  }
  return deck;
}

// Fisher-Yates shuffle
function shuffle(deck: Card[]) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

// Helper to generate a room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Helper to send message to a client
function sendToClient(ws: WebSocket, msg: ServerMessage) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// Helper to broadcast room state to all players in that room
function broadcastState(roomCode: string) {
  const room = rooms[roomCode];
  if (!room) return;

  // Find all active socket IDs in this room
  const playerIds = Object.keys(room.players);
  const allSocketsInRoom = Object.entries(clientRooms)
    .filter(([_, rCode]) => rCode === roomCode)
    .map(([pId, _]) => pId);

  // Merge the IDs of sockets and formal players
  const audienceIds = Array.from(new Set([...playerIds, ...allSocketsInRoom]));

  for (const targetId of audienceIds) {
    const ws = activeSockets[targetId];
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Build a tailored RoomState: hide other players' hole cards unless in SHOWDOWN
      const tailoredPlayers: { [id: string]: Player } = {};
      
      for (const [pId, player] of Object.entries(room.players)) {
        const privateHand = playerHands[roomCode]?.[pId] || [];
        
        let visibleCards: Card[] = [];
        if (room.phase === 'SHOWDOWN') {
          // Send hole cards if player survived to showdown and did not fold
          if (!player.folded && player.seatIndex >= 0) {
            visibleCards = privateHand;
          }
        } else if (pId === targetId) {
          // Always let players see their own cards
          visibleCards = privateHand;
        }

        tailoredPlayers[pId] = {
          ...player,
          cards: visibleCards
        };
      }

      const tailoredState: RoomState = {
        ...room,
        players: tailoredPlayers,
        deckSize: decks[roomCode]?.length || 0
      };

      sendToClient(ws, {
        type: 'state_update',
        payload: {
          state: tailoredState,
          selfPlayerId: targetId
        }
      });
    }
  }
}

// Broadcast a chat message to all room connections
function broadcastChat(roomCode: string, msg: ChatMessage) {
  const room = rooms[roomCode];
  if (!room) return;

  const visitorIds = Object.entries(clientRooms)
    .filter(([_, rCode]) => rCode === roomCode)
    .map(([pId, _]) => pId);

  const playerIds = Object.keys(room.players);
  const audienceIds = Array.from(new Set([...playerIds, ...visitorIds]));

  for (const targetId of audienceIds) {
    const ws = activeSockets[targetId];
    if (ws) {
      sendToClient(ws, {
        type: 'chat_message',
        payload: msg
      });
    }
  }
}

// Post a system chat message
function sendSystemChat(roomCode: string, text: string) {
  const chatMsg: ChatMessage = {
    id: Math.random().toString(36).substr(2, 9),
    sender: 'Sistema',
    text,
    timestamp: Date.now(),
    isSystem: true
  };
  broadcastChat(roomCode, chatMsg);
}

// Helper to get active sitting players sorted by seat index
function getSittingPlayers(room: RoomState): Player[] {
  return Object.values(room.players)
    .filter(p => p.seatIndex >= 0)
    .sort((a, b) => a.seatIndex - b.seatIndex);
}

// Helper to get sitting players capable of making actions (has chips, not folded, not all-in)
function getActiveSittingPlayers(room: RoomState): Player[] {
  return Object.values(room.players)
    .filter(p => p.seatIndex >= 0 && !p.folded && !p.isAllIn && p.chips > 0);
}

// Find next active sitting player clockwise from starting seat model
function findNextSeatClockwise(room: RoomState, startIndex: number): number {
  const players = getSittingPlayers(room);
  if (players.length === 0) return -1;

  // Let's sweep seats from startIndex + 1, looping around back to 7
  for (let offset = 1; offset <= 8; offset++) {
    const seat = (startIndex + offset) % 8;
    const playerAtSeat = Object.values(room.players).find(p => p.seatIndex === seat);
    if (playerAtSeat && !playerAtSeat.folded && !playerAtSeat.isAllIn && playerAtSeat.chips > 0) {
      return seat;
    }
  }
  return -1;
}

// Helper to clear timer
function clearRoomTimer(roomCode: string) {
  if (activeTimers[roomCode]) {
    clearInterval(activeTimers[roomCode]!);
    activeTimers[roomCode] = null;
  }
}

// Start player turn timer
function startTurnTimer(roomCode: string) {
  clearRoomTimer(roomCode);
  
  const room = rooms[roomCode];
  if (!room || !room.currentPlayerId) return;

  room.timeLeft = room.turnTimeout;
  
  activeTimers[roomCode] = setInterval(() => {
    const r = rooms[roomCode];
    if (!r) {
      clearRoomTimer(roomCode);
      return;
    }

    r.timeLeft -= 1;

    if (r.timeLeft <= 0) {
      clearRoomTimer(roomCode);
      // Timeout auto-action: check if free, else fold
      handleTimeoutAction(roomCode);
    } else {
      // Periodic update (not too aggressive, just broadcast state so clients see countdown ticking)
      broadcastState(roomCode);
    }
  }, 1000);
}

// Auto-action when user's time runs out
function handleTimeoutAction(roomCode: string) {
  const room = rooms[roomCode];
  if (!room || !room.currentPlayerId) return;

  const player = room.players[room.currentPlayerId];
  if (!player) return;

  const needsToCall = room.currentBet - player.currentBet;
  
  sendSystemChat(roomCode, `⏱️ Tiempo agotado para ${player.name}.`);

  if (needsToCall <= 0) {
    // Free check
    processPlayerAction(roomCode, room.currentPlayerId, 'check');
  } else {
    // Fold
    processPlayerAction(roomCode, room.currentPlayerId, 'fold');
  }
}

// Handle transition to next state or phase
function advanceBettingRound(roomCode: string) {
  const room = rooms[roomCode];
  if (!room) return;

  // 1. Gather all bets into standard pool
  let collectedThisRound = 0;
  for (const p of Object.values(room.players)) {
    collectedThisRound += p.currentBet;
    p.currentBet = 0;
    p.lastAction = '';
  }
  room.pot += collectedThisRound;
  room.currentBet = 0;
  room.minRaise = room.bigBlind;

  // Check remaining active players who haven't folded
  const nonFolded = Object.values(room.players).filter(p => p.seatIndex >= 0 && !p.folded);
  const nonFoldedNotAllIn = nonFolded.filter(p => !p.isAllIn);

  // If everyone else folded except one, award pot immediately
  if (nonFolded.length === 1) {
    declareSingleWinner(roomCode, nonFolded[0]);
    return;
  }

  // If everyone is all-in or only at most one can act, skipping straight to showdown
  if (nonFoldedNotAllIn.length <= 1) {
    // Run-out remaining community cards
    const deck = decks[roomCode];
    if (room.phase === 'PREFLOP') {
      // Deal flop + turn + river
      if (deck.length >= 5) {
        deck.shift(); // burn card
        room.communityCards.push(deck.shift()!, deck.shift()!, deck.shift()!); // flop
        deck.shift(); // burn
        room.communityCards.push(deck.shift()!); // turn
        deck.shift(); // burn
        room.communityCards.push(deck.shift()!); // river
      }
    } else if (room.phase === 'FLOP') {
      if (deck.length >= 3) {
        deck.shift(); // burn
        room.communityCards.push(deck.shift()!); // turn
        deck.shift(); // burn
        room.communityCards.push(deck.shift()!); // river
      }
    } else if (room.phase === 'TURN') {
      if (deck.length >= 2) {
        deck.shift(); // burn
        room.communityCards.push(deck.shift()!); // river
      }
    }
    
    room.phase = 'SHOWDOWN';
    evaluateShowdown(roomCode);
    return;
  }

  // Advance to next street
  if (room.phase === 'PREFLOP') {
    room.phase = 'FLOP';
    const deck = decks[roomCode];
    if (deck.length >= 4) {
      deck.shift(); // burn
      room.communityCards.push(deck.shift()!, deck.shift()!, deck.shift()!);
    }
    sendSystemChat(roomCode, `🃏 --- FLOP: ${formatCards(room.communityCards)} ---`);
    startStreetBetting(roomCode);
  } else if (room.phase === 'FLOP') {
    room.phase = 'TURN';
    const deck = decks[roomCode];
    if (deck.length >= 2) {
      deck.shift(); // burn
      room.communityCards.push(deck.shift()!);
    }
    sendSystemChat(roomCode, `🃏 --- TURN: ${formatCards([room.communityCards[3]])} ---`);
    startStreetBetting(roomCode);
  } else if (room.phase === 'TURN') {
    room.phase = 'RIVER';
    const deck = decks[roomCode];
    if (deck.length >= 2) {
      deck.shift(); // burn
      room.communityCards.push(deck.shift()!);
    }
    sendSystemChat(roomCode, `🃏 --- RIVER: ${formatCards([room.communityCards[4]])} ---`);
    startStreetBetting(roomCode);
  } else if (room.phase === 'RIVER') {
    room.phase = 'SHOWDOWN';
    evaluateShowdown(roomCode);
  }
}

function formatCards(cards: Card[]): string {
  const suitsStr: { [key: string]: string } = { H: '❤️', D: '♦️', C: '♣️', S: '♠️' };
  return cards.map(c => `${c.value}${suitsStr[c.suit]}`).join(' ');
}

// Start betting on a brand new street (postflop)
function startStreetBetting(roomCode: string) {
  const room = rooms[roomCode];
  if (!room) return;

  // Clean last action of active players
  for (const p of Object.values(room.players)) {
    if (p.seatIndex >= 0) {
      p.lastAction = '';
    }
  }

  // Find first active player clockwise from dealer button
  const firstSeat = findNextSeatClockwise(room, room.dealerIndex);
  if (firstSeat !== -1) {
    const firstPlayer = Object.values(room.players).find(p => p.seatIndex === firstSeat);
    room.currentPlayerId = firstPlayer ? firstPlayer.id : null;
    startTurnTimer(roomCode);
  } else {
    advanceBettingRound(roomCode);
  }
}

// Trigger single survivor hand win
function declareSingleWinner(roomCode: string, winner: Player) {
  clearRoomTimer(roomCode);
  const room = rooms[roomCode];
  if (!room) return;

  // Collect any remaining bets on table
  let collected = 0;
  for (const p of Object.values(room.players)) {
    collected += p.currentBet;
    p.currentBet = 0;
    p.lastAction = '';
  }
  const totalWinnings = room.pot + collected;
  winner.chips += totalWinnings;
  room.pot = 0;

  room.phase = 'SHOWDOWN';
  room.currentPlayerId = null;
  room.winners = [{
    playerId: winner.id,
    name: winner.name,
    amountWon: totalWinnings,
    description: 'Todos los oponentes se retiraron',
    winningCards: []
  }];

  // Keep player hole cards in showdown payload (none because single fold win keeps them closed, but self lets you see them)
  room.showdownCards = {};

  sendSystemChat(roomCode, `🏆 ${winner.name} gana el pozo de ${totalWinnings} fichas (todos se retiraron).`);
  broadcastState(roomCode);

  // Set timeout to auto-start next hand in 12 seconds
  setAutoRestartTimer(roomCode);
}

// Set up 12 seconds auto-restart hand timer
function setAutoRestartTimer(roomCode: string) {
  clearRoomTimer(roomCode);
  const room = rooms[roomCode];
  if (!room) return;

  room.timeLeft = 12;
  activeTimers[roomCode] = setInterval(() => {
    const r = rooms[roomCode];
    if (!r) {
      clearRoomTimer(roomCode);
      return;
    }
    r.timeLeft -= 1;
    if (r.timeLeft <= 0) {
      clearRoomTimer(roomCode);
      startNewHand(roomCode);
    } else {
      broadcastState(roomCode);
    }
  }, 1000);
}

// Side pot and standard pot distribution algorithm at showdown
interface PlayerWager {
  id: string;
  wager: number;
  folded: boolean;
  scoreRank: number; // evaluation ranking
  evaluation: any; // complete evaluation object
}

function evaluateShowdown(roomCode: string) {
  clearRoomTimer(roomCode);
  const room = rooms[roomCode];
  if (!room) return;

  const sitting = getSittingPlayers(room);
  const survivors = sitting.filter(p => !p.folded);

  // Calculate hands for survivors
  const evaluations: { [pId: string]: any } = {};
  for (const p of survivors) {
    const privateHand = playerHands[roomCode]?.[p.id] || [];
    evaluations[p.id] = evaluate7CardHand(privateHand, room.communityCards);
  }

  // Capture actual cards in showdownCards for reveal
  room.showdownCards = {};
  for (const p of sitting) {
    if (!p.folded) {
      room.showdownCards[p.id] = playerHands[roomCode]?.[p.id] || [];
    }
  }

  // Track wagers contributed by players this hand to process side pots correctly
  // To keep it simple but strictly correct: we use total contributions!
  // In modern poker, the total wager is chips lost during the hand. We tracked chips at the start of hand:
  // Since we haven't stored initial chips, let's keep track of total chips wagered by players. 
  // Let's retrieve each player's wager. We can store a hand wagers map "handWagers"
  // Wait, let's retrieve or compute wagers based on our custom tracker, or we can approximate it.
  // Wait! Let's ensure we track wagers on action and keep it on our private wagers map!
  // Let's verify: does our server have room.players[playerId].chips wagers?
  // Let's create an in-memory wager record `const totalHandWagers: { [roomCode: string]: { [playerId: string]: number } } = {};`
  // Yes! We will populate `totalHandWagers[roomCode][playerId]` every time a chip is put into BB/SB, calls, raises, or all-ins!
  // Let's check:
  if (!totalHandWagers[roomCode]) {
    totalHandWagers[roomCode] = {};
  }
  const wagers = totalHandWagers[roomCode];

  // For any sat player, default their wager to 0 if not tracked
  for (const p of sitting) {
    if (wagers[p.id] === undefined) {
      wagers[p.id] = 0;
    }
  }

  // Compile active players wagers
  const playerWagers: PlayerWager[] = sitting.map(p => {
    const hasEval = evaluations[p.id];
    return {
      id: p.id,
      wager: wagers[p.id],
      folded: p.folded,
      scoreRank: hasEval ? hasEval.rank : -1,
      evaluation: hasEval || null
    };
  });

  const winnersList: WinnerInfo[] = [];

  // All-In Side Pot Split Algorithm:
  // While there are wagers left in the pool and unfolded players
  let remainingWagers = playerWagers.map(pw => ({ ...pw }));

  while (remainingWagers.some(rw => rw.wager > 0)) {
    // 1. Find all unfolded players that have wagers remaining
    const eligibleUnfolded = remainingWagers.filter(rw => !rw.folded && rw.wager > 0);

    if (eligibleUnfolded.length === 0) {
      // If no unfolded players are left with wagers, return remaining to folded contributors!
      const remainingFolded = remainingWagers.filter(rw => rw.wager > 0);
      for (const rf of remainingFolded) {
        const p = room.players[rf.id];
        if (p) {
          p.chips += rf.wager;
          sendSystemChat(roomCode, `Returned ${rf.wager} chips to folded player ${p.name}`);
        }
        rf.wager = 0;
      }
      break;
    }

    // 2. Find minimum wager among active contributors to split side pots
    const contributors = remainingWagers.filter(rw => rw.wager > 0);
    const minWager = Math.min(...contributors.map(c => c.wager));

    // 3. Create a sub-pot consisting of up to minWager from ALL contributors
    let subPotSize = 0;
    for (const rw of remainingWagers) {
      if (rw.wager > 0) {
        const contribution = Math.min(rw.wager, minWager);
        subPotSize += contribution;
        rw.wager -= contribution;
      }
    }

    // 4. Find the best hand among unfolded players eligible for this sub-pot (i.e. those in eligibleUnfolded)
    // Rank them
    let bestEval: any = null;
    let winningWagers: PlayerWager[] = [];

    for (const eu of eligibleUnfolded) {
      if (!bestEval) {
        bestEval = eu.evaluation;
        winningWagers = [eu];
      } else {
        const comp = compareEvaluations(eu.evaluation, bestEval);
        if (comp > 0) {
          bestEval = eu.evaluation;
          winningWagers = [eu];
        } else if (comp === 0) {
          winningWagers.push(eu);
        }
      }
    }

    // 5. Split this sub-pot among the winners of this tier
    const share = Math.floor(subPotSize / winningWagers.length);
    const remainder = subPotSize % winningWagers.length;

    winningWagers.forEach((ww, idx) => {
      const bonus = idx === 0 ? remainder : 0; // Dealer / first winner gets the odd chip
      const payout = share + bonus;
      
      const p = room.players[ww.id];
      if (p) {
        p.chips += payout;
        
        // Add to winners summary list
        const existingWinner = winnersList.find(w => w.playerId === ww.id);
        if (existingWinner) {
          existingWinner.amountWon += payout;
        } else {
          winnersList.push({
            playerId: ww.id,
            name: p.name,
            amountWon: payout,
            description: ww.evaluation.description,
            winningCards: ww.evaluation.cards
          });
        }
      }
    });
  }

  room.pot = 0;
  room.winners = winnersList;
  room.currentPlayerId = null;

  // Log winners in chats
  for (const w of winnersList) {
    sendSystemChat(roomCode, `🏆 ${w.name} gana ${w.amountWon} fichas con ${w.description}!`);
  }

  // Clear hand wagers for next round
  delete totalHandWagers[roomCode];

  broadcastState(roomCode);
  setAutoRestartTimer(roomCode);
}

const totalHandWagers: { [roomCode: string]: { [playerId: string]: number } } = {};

function recordWager(roomCode: string, playerId: string, amount: number) {
  if (!totalHandWagers[roomCode]) {
    totalHandWagers[roomCode] = {};
  }
  totalHandWagers[roomCode][playerId] = (totalHandWagers[roomCode][playerId] || 0) + amount;
}

// Start a fresh Hand (dealing cards, placing blinds, setting dealer)
function startNewHand(roomCode: string) {
  clearRoomTimer(roomCode);
  const room = rooms[roomCode];
  if (!room) return;

  // Filter playing players (having chips > 0)
  const playersAtTable = getSittingPlayers(room);
  const activePlayers = playersAtTable.filter(p => p.chips > 0);

  if (activePlayers.length < 2) {
    room.phase = 'WAITING';
    room.winners = [];
    room.communityCards = [];
    room.pot = 0;
    room.currentPlayerId = null;
    sendSystemChat(roomCode, '⚠️ Esperando por al menos 2 jugadores activos con fichas para comenzar.');
    broadcastState(roomCode);
    return;
  }

  // Set active players to un-folded, clean bets and details
  for (const p of playersAtTable) {
    if (p.chips > 0) {
      p.folded = false;
      p.isAllIn = false;
      p.currentBet = 0;
      p.lastAction = '';
    } else {
      // Auto-fold or spectate players out of chips
      p.folded = true;
      p.isAllIn = false;
      p.currentBet = 0;
      p.lastAction = 'Sin fichas';
    }
  }

  // Clear previous hand data
  room.communityCards = [];
  room.winners = [];
  room.showdownCards = {};
  room.pot = 0;
  room.handId += 1;

  // Reset side-pot wagers
  totalHandWagers[roomCode] = {};

  // Build deck
  const deck = createDeck();
  shuffle(deck);
  decks[roomCode] = deck;

  // Move dealer button. If it's a new game, dealer is random or 0.
  if (room.dealerIndex === -1) {
    room.dealerIndex = activePlayers[Math.floor(Math.random() * activePlayers.length)].seatIndex;
  } else {
    // Find next seat clockwise from previous dealer that has an active player
    let nextDealerSeat = findNextSeatClockwise(room, room.dealerIndex);
    if (nextDealerSeat === -1) {
      nextDealerSeat = activePlayers[0].seatIndex;
    }
    room.dealerIndex = nextDealerSeat;
  }

  // Blinds allocation
  const sbAmount = room.smallBlind;
  const bbAmount = room.bigBlind;

  // In Heads-Up (2 players):
  // Dealer is Small Blind. Other player is Big Blind.
  // SB (Dealer) acts first preflop, BB acts last. Post-flop, BB acts first.
  let sbSeat = -1;
  let bbSeat = -1;

  if (activePlayers.length === 2) {
    sbSeat = room.dealerIndex;
    bbSeat = activePlayers.find(p => p.seatIndex !== room.dealerIndex)!.seatIndex;
  } else {
    // Standard ring game blinds:
    // SB = next active seat clockwise of dealer
    // BB = next active seat clockwise of SB
    sbSeat = findNextSeatClockwise(room, room.dealerIndex);
    bbSeat = findNextSeatClockwise(room, sbSeat);
  }

  room.sbIndex = sbSeat;
  room.bbIndex = bbSeat;

  const sbPlayer = Object.values(room.players).find(p => p.seatIndex === sbSeat);
  const bbPlayer = Object.values(room.players).find(p => p.seatIndex === bbSeat);

  // Post SB
  if (sbPlayer) {
    const sbPost = Math.min(sbPlayer.chips, sbAmount);
    sbPlayer.chips -= sbPost;
    sbPlayer.currentBet = sbPost;
    sbPlayer.lastAction = 'Ciega Chica';
    if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;
    recordWager(roomCode, sbPlayer.id, sbPost);
  }

  // Post BB
  if (bbPlayer) {
    const bbPost = Math.min(bbPlayer.chips, bbAmount);
    bbPlayer.chips -= bbPost;
    bbPlayer.currentBet = bbPost;
    bbPlayer.lastAction = 'Ciega Grande';
    if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;
    recordWager(roomCode, bbPlayer.id, bbPost);
  }

  room.currentBet = bbAmount;
  room.minRaise = bbAmount;

  // Deal Private Cards
  playerHands[roomCode] = {};
  for (const p of activePlayers) {
    if (deck.length >= 2) {
      playerHands[roomCode][p.id] = [deck.shift()!, deck.shift()!];
    }
  }

  room.phase = 'PREFLOP';

  // First player to act preflop:
  // Heads Up: SB (Dealer) has button and acts first.
  // Ring Game: Clockwise of BB (UTG).
  let firstActorSeat = -1;
  if (activePlayers.length === 2) {
    firstActorSeat = sbSeat;
  } else {
    firstActorSeat = findNextSeatClockwise(room, bbSeat);
  }

  const actor = Object.values(room.players).find(p => p.seatIndex === firstActorSeat);
  room.currentPlayerId = actor ? actor.id : null;

  sendSystemChat(roomCode, `🏁 Comienza la Mano #${room.handId}. Repartiendo cartas.`);
  sendSystemChat(roomCode, `Dealer: Seat-${room.dealerIndex + 1}. Ciega Chica: Seat-${room.sbIndex + 1}. Ciega Grande: Seat-${room.bbIndex + 1}.`);

  startTurnTimer(roomCode);
}

// Main logic router for Check/Call/Raise/Fold poker actions
function processPlayerAction(roomCode: string, pId: string, actionType: 'check' | 'call' | 'raise' | 'fold', raiseAmount?: number) {
  const room = rooms[roomCode];
  if (!room || room.currentPlayerId !== pId) return;

  const player = room.players[pId];
  if (!player || player.folded || player.isAllIn) return;

  const currentHighestBet = room.currentBet;
  const playerPaidThisRound = player.currentBet;
  const needsToCall = currentHighestBet - playerPaidThisRound;

  let announceText = '';

  if (actionType === 'fold') {
    player.folded = true;
    player.lastAction = 'No voy';
    announceText = `❌ ${player.name} no va (Fold).`;
  } else if (actionType === 'check') {
    if (needsToCall > 0) {
      // Cannot check if there's a facing bet! Auto Call/Fold instead
      player.folded = true;
      player.lastAction = 'No voy';
      announceText = `❌ ${player.name} no va (Check inválido).`;
    } else {
      player.lastAction = 'Paso';
      announceText = `🤝 ${player.name} pasa (Check).`;
    }
  } else if (actionType === 'call') {
    const callAmount = Math.min(player.chips, needsToCall);
    player.chips -= callAmount;
    player.currentBet += callAmount;
    player.lastAction = 'Igualo';
    recordWager(roomCode, player.id, callAmount);
    
    if (player.chips === 0) {
      player.isAllIn = true;
      announceText = `🚀 ${player.name} iguala y va ALL-IN con ${player.currentBet}!`;
    } else {
      announceText = `💵 ${player.name} iguala (${player.currentBet}).`;
    }
  } else if (actionType === 'raise') {
    // Raise total amount
    const totalBetToPlace = raiseAmount || (currentHighestBet + room.minRaise);
    const addedChipsNeeded = totalBetToPlace - playerPaidThisRound;
    
    // Validate raise amount
    const minRequiredTotal = currentHighestBet + room.minRaise;
    const isAllInRaise = addedChipsNeeded >= player.chips;

    let actualBet = totalBetToPlace;
    let actualAdded = addedChipsNeeded;

    if (isAllInRaise) {
      // All in is a valid raise size regardless
      actualAdded = player.chips;
      actualBet = playerPaidThisRound + actualAdded;
      player.isAllIn = true;
      player.lastAction = 'All-In';
      announceText = `🔥 ${player.name} sube ALL-IN a ${actualBet}!`;
    } else {
      if (totalBetToPlace < minRequiredTotal) {
        // Correct illegal raise to minRaise
        actualBet = minRequiredTotal;
        actualAdded = actualBet - playerPaidThisRound;
      }
      
      // Safety guard on chips
      if (actualAdded > player.chips) {
        actualAdded = player.chips;
        actualBet = playerPaidThisRound + actualAdded;
        player.isAllIn = true;
        player.lastAction = 'All-In';
        announceText = `🔥 ${player.name} sube ALL-IN a ${actualBet}!`;
      } else {
        player.lastAction = `Sube (${actualBet})`;
        announceText = `📈 ${player.name} sube a ${actualBet}.`;
      }
    }

    player.chips -= actualAdded;
    player.currentBet = actualBet;
    recordWager(roomCode, player.id, actualAdded);

    // Update rules for next raiser
    const raiseDiff = actualBet - currentHighestBet;
    if (raiseDiff > 0) {
      room.minRaise = Math.max(raiseDiff, room.bigBlind);
    }
    room.currentBet = actualBet;

    // Reset lastAction/acting constraints on other non-folded, non-all-in players
    for (const other of Object.values(room.players)) {
      if (other.id !== pId && other.seatIndex >= 0 && !other.folded && !other.isAllIn) {
        // Reset so they get option to act against the new raise
        if (other.lastAction !== '') {
          other.lastAction = '';
        }
      }
    }
  }

  sendSystemChat(roomCode, announceText);

  // Check if street betting is finished
  const nonFolded = Object.values(room.players).filter(p => p.seatIndex >= 0 && !p.folded);
  const eligibleActors = nonFolded.filter(p => !p.isAllIn);

  // If everyone folded except one, end hand immediately
  if (nonFolded.length === 1) {
    declareSingleWinner(roomCode, nonFolded[0]);
    return;
  }

  // To check if betting round is completed:
  // Everyone eligible and active must:
  // 1. Have had their action registered (lastAction must NOT be empty or must have matched current highest bet)
  // 2. Their currentBet must match room's currentBet
  const allMatched = eligibleActors.every(p => p.currentBet === room.currentBet && p.lastAction !== '');

  if (allMatched || eligibleActors.length === 0) {
    advanceBettingRound(roomCode);
  } else {
    // Advance clockwise to next eligible actor
    const currentSeat = player.seatIndex;
    const nextSeat = findNextSeatClockwise(room, currentSeat);
    if (nextSeat !== -1) {
      const nextPlayer = Object.values(room.players).find(p => p.seatIndex === nextSeat);
      room.currentPlayerId = nextPlayer ? nextPlayer.id : null;
      startTurnTimer(roomCode);
    } else {
      advanceBettingRound(roomCode);
    }
  }
}

// Main Express app setup
const app = express();
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', activeRoomsCount: Object.keys(rooms).length });
});

// Dev vs Prod settings
const isProduction = process.env.NODE_ENV === 'production';

if (!isProduction) {
  createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  }).then((vite) => {
    app.use(vite.middlewares);
  });
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// WebSocket connection routing
wss.on('connection', (ws) => {
  let boundPlayerId = Math.random().toString(36).substr(2, 9);
  activeSockets[boundPlayerId] = ws;

  sendToClient(ws, { type: 'welcome', payload: { playerId: boundPlayerId } });

  ws.on('message', (messageData: string) => {
    try {
      const raw = JSON.parse(messageData) as ClientMessage;
      
      switch (raw.type) {
        case 'ping':
          sendToClient(ws, { type: 'error', payload: { message: 'pong' } }); // standard small ping keepalive
          break;

        case 'create_room': {
          const { name, smallBlind, turnTimeout } = raw.payload;
          const code = generateRoomCode();
          
          clientRooms[boundPlayerId] = code;
          clientNames[boundPlayerId] = name;

          rooms[code] = {
            code,
            creatorId: boundPlayerId,
            phase: 'WAITING',
            players: {
              [boundPlayerId]: {
                id: boundPlayerId,
                name,
                chips: 1000,
                seatIndex: -1, // joins first as spectator
                cards: [],
                currentBet: 0,
                folded: false,
                isAllIn: false,
                isConnected: true,
                lastAction: '',
                showCardsAtShowdown: true
              }
            },
            communityCards: [],
            pot: 0,
            mainPot: 0,
            currentBet: 0,
            minRaise: smallBlind * 2,
            dealerIndex: -1,
            sbIndex: -1,
            bbIndex: -1,
            currentPlayerId: null,
            turnTimeout: turnTimeout || 30,
            timeLeft: 0,
            smallBlind,
            bigBlind: smallBlind * 2,
            handId: 0,
            winners: [],
            showdownCards: {},
            deckSize: 0
          };

          sendSystemChat(code, `✨ Nueva sala creada. Código: ${code}`);
          broadcastState(code);
          break;
        }

        case 'join_room': {
          const { roomCode, name } = raw.payload;
          const cleanCode = roomCode.toUpperCase().trim();
          const r = rooms[cleanCode];

          if (!r) {
            sendToClient(ws, { type: 'error', payload: { message: `La sala con código ${cleanCode} no existe.` } });
            break;
          }

          clientRooms[boundPlayerId] = cleanCode;
          clientNames[boundPlayerId] = name;

          // Add as spectator
          r.players[boundPlayerId] = {
            id: boundPlayerId,
            name,
            chips: 1000,
            seatIndex: -1,
            cards: [],
            currentBet: 0,
            folded: false,
            isAllIn: false,
            isConnected: true,
            lastAction: '',
            showCardsAtShowdown: true
          };

          sendSystemChat(cleanCode, `👋 ${name} se unió como espectador.`);
          broadcastState(cleanCode);
          break;
        }

        case 'sit_down': {
          const code = clientRooms[boundPlayerId];
          const r = rooms[code];
          if (!r) break;

          const { seatIndex, buyIn } = raw.payload;
          // Verify seat index is empty
          const seatTaken = Object.values(r.players).some(p => p.seatIndex === seatIndex);
          if (seatTaken) {
            sendToClient(ws, { type: 'error', payload: { message: 'Este asiento ya está ocupado.' } });
            break;
          }

          const player = r.players[boundPlayerId];
          if (player) {
            player.seatIndex = seatIndex;
            player.chips = buyIn || 1000;
            player.folded = false;
            player.isAllIn = false;
            player.currentBet = 0;
            player.lastAction = '';
            
            sendSystemChat(code, `🪑 ${player.name} se sentó en el Asiento ${seatIndex + 1} con ${player.chips} fichas.`);
            broadcastState(code);
          }
          break;
        }

        case 'stand_up': {
          const code = clientRooms[boundPlayerId];
          const r = rooms[code];
          if (!r) break;

          const player = r.players[boundPlayerId];
          if (player && player.seatIndex >= 0) {
            const oldSeat = player.seatIndex;
            player.seatIndex = -1;
            player.cards = [];
            
            sendSystemChat(code, `🚶 ${player.name} se levantó del Asiento ${oldSeat + 1}.`);

            // If it was their turn, progress it
            if (r.currentPlayerId === boundPlayerId && r.phase !== 'WAITING' && r.phase !== 'SHOWDOWN') {
              processPlayerAction(code, boundPlayerId, 'fold');
            } else {
              broadcastState(code);
            }
          }
          break;
        }

        case 'send_chat': {
          const code = clientRooms[boundPlayerId];
          if (!code) break;

          const { text } = raw.payload;
          const senderName = clientNames[boundPlayerId] || 'Espectador';

          const chatMsg: ChatMessage = {
            id: Math.random().toString(36).substr(2, 9),
            sender: senderName,
            text,
            timestamp: Date.now(),
            isSystem: false
          };

          broadcastChat(code, chatMsg);
          break;
        }

        case 'start_game': {
          const code = clientRooms[boundPlayerId];
          const r = rooms[code];
          if (!r) break;

          // Check if user is the creator (or allow anybody for relaxed offline-friends testing)
          startNewHand(code);
          break;
        }

        case 'action': {
          const code = clientRooms[boundPlayerId];
          if (!code) break;
          const { actionType, amount } = raw.payload;
          processPlayerAction(code, boundPlayerId, actionType, amount);
          break;
        }

        case 'rebuy': {
          const code = clientRooms[boundPlayerId];
          const r = rooms[code];
          if (!r) break;

          const player = r.players[boundPlayerId];
          if (player && player.chips <= 0) {
            player.chips = 1000;
            player.folded = false;
            player.isAllIn = false;
            player.currentBet = 0;
            player.lastAction = '';
            
            sendSystemChat(code, `💰 ${player.name} hizo recompra (Rebuy) de 1000 fichas.`);
            broadcastState(code);
          }
          break;
        }
      }
    } catch (err) {
      console.error('Error handling websocket message:', err);
    }
  });

  ws.on('close', () => {
    const code = clientRooms[boundPlayerId];
    if (code && rooms[code]) {
      const room = rooms[code];
      const player = room.players[boundPlayerId];
      if (player) {
        player.isConnected = false;
        sendSystemChat(code, `🔌 ${player.name} se desconectó.`);

        // If player is sitting, do not delete them so they can reconnect!
        // Just fold if it is their turn active right now which secures the flow
        if (room.currentPlayerId === boundPlayerId && room.phase !== 'WAITING' && room.phase !== 'SHOWDOWN') {
          processPlayerAction(code, boundPlayerId, 'fold');
        } else {
          // If they were spectating, we can delete them immediately to keep list clean
          if (player.seatIndex === -1) {
            delete room.players[boundPlayerId];
          }
          broadcastState(code);
        }
      }
    }
    delete activeSockets[boundPlayerId];
    delete clientRooms[boundPlayerId];
    delete clientNames[boundPlayerId];
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Express and WebSocket server running on http://0.0.0.0:${PORT}`);
});
