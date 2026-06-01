import { Peer, DataConnection } from 'peerjs';
import { 
  RoomState, Player, Card, ChatMessage, GamePhase, 
  ClientMessage, ServerMessage, WinnerInfo 
} from '../types';
import { evaluate7CardHand, compareEvaluations } from '../pokerEvaluator';

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

// Formatting community cards for chat readable representations
function formatCards(cards: Card[]): string {
  const suitsStr: { [key: string]: string } = { H: '❤️', D: '♦️', C: '♣️', S: '♠️' };
  return cards.map(c => `${c.value}${suitsStr[c.suit]}`).join(' ');
}

// Side pot wager helper matching server.ts structure
interface PlayerWager {
  id: string;
  wager: number;
  folded: boolean;
  scoreRank: number;
  evaluation: any;
}

export class P2PManager {
  private peer: Peer | null = null;
  private isHost: boolean = false;
  private roomCode: string = '';
  private boundPlayerId: string = '';
  private onMessageCallback: (msg: ServerMessage) => void;
  private onConnectionStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;

  // Guest fields
  private hostConnection: DataConnection | null = null;

  // Host state authoritative data
  private roomState: RoomState | null = null;
  private deck: Card[] = [];
  private playerHands: { [playerId: string]: Card[] } = {};
  private activeConnections: { [playerId: string]: DataConnection } = {};
  private activeTimers: any = null;
  private totalHandWagers: { [playerId: string]: number } = {};

  constructor(
    playerId: string,
    onMessage: (msg: ServerMessage) => void,
    onConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') => void
  ) {
    this.boundPlayerId = playerId;
    this.onMessageCallback = onMessage;
    this.onConnectionStatusChange = onConnectionStatus;
  }

  // --- PUBLIC API FOR FRONTEND ---

  public createRoom(name: string, smallBlind: number, turnTimeout: number) {
    this.isHost = true;
    this.onConnectionStatusChange('connecting');

    // Generate room code
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.roomCode = code;

    // Connect to PeerJS Broker using application namespace
    const peerId = `poker-friends-${code}`;
    this.peer = new Peer(peerId);

    this.peer.on('open', (id) => {
      console.log('Host PeerJS channel online. Peer ID:', id);
      this.onConnectionStatusChange('connected');

      // Initialize the authoritative RoomState
      this.roomState = {
        code,
        creatorId: this.boundPlayerId,
        phase: 'WAITING',
        players: {
          [this.boundPlayerId]: {
            id: this.boundPlayerId,
            name,
            chips: 1000,
            seatIndex: -1, // Spectating by default
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

      // Welcome message for host self
      this.onMessageCallback({ type: 'welcome', payload: { playerId: this.boundPlayerId } });
      this.sendSystemChat(`✨ Nueva sala creada. Código de Sala: ${code}`);
      this.broadcastState();
    });

    this.peer.on('connection', (conn) => {
      this.setupHostConnectionListeners(conn);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Host Error:', err);
      this.onMessageCallback({ type: 'error', payload: { message: `Error de servidor P2P: ${err.message}` } });
      this.onConnectionStatusChange('disconnected');
    });
  }

  public joinRoom(name: string, code: string) {
    this.isHost = false;
    this.roomCode = code.toUpperCase().trim();
    this.onConnectionStatusChange('connecting');

    // Generate a unique anonymous peer ID for the guest player
    const guestPeerId = `poker-friends-guest-${Math.random().toString(36).substring(2, 9)}`;
    this.peer = new Peer(guestPeerId);

    this.peer.on('open', () => {
      // Connect to the Host
      const targetId = `poker-friends-${this.roomCode}`;
      const conn = this.peer!.connect(targetId);
      this.hostConnection = conn;

      conn.on('open', () => {
        console.log('Guest WebRTC channel connected to Host:', targetId);
        this.onConnectionStatusChange('connected');

        // Welcome player with their computed local ID
        this.onMessageCallback({ type: 'welcome', payload: { playerId: this.boundPlayerId } });

        // Direct request to join room
        this.emit({
          type: 'join_room',
          payload: { name, roomCode: this.roomCode }
        });
      });

      conn.on('data', (data: any) => {
        try {
          const rawMessage = JSON.parse(data as string) as ServerMessage;
          this.onMessageCallback(rawMessage);
        } catch (e) {
          console.error('Guest raw payload parsing exception:', e);
        }
      });

      conn.on('close', () => {
        console.warn('Host connection closed.');
        this.onConnectionStatusChange('disconnected');
        this.onMessageCallback({ type: 'error', payload: { message: 'El anfitrión cerró la partida o se desconectó.' } });
      });

      conn.on('error', (err) => {
        console.error('Guest connection WebRTC exception:', err);
        this.onConnectionStatusChange('disconnected');
      });
    });

    this.peer.on('error', (err) => {
      console.error('Guest PeerJS Error:', err);
      this.onMessageCallback({ type: 'error', payload: { message: 'No se pudo conectar a la sala. Comprueba el código de sala.' } });
      this.onConnectionStatusChange('disconnected');
    });
  }

  public emit(msg: ClientMessage) {
    if (this.isHost) {
      // Direct pass to host action process bypass
      this.processHostMessage(this.boundPlayerId, msg);
    } else if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(JSON.stringify(msg));
    }
  }

  public destroy() {
    this.clearTimer();
    if (this.peer) {
      this.peer.destroy();
    }
  }

  // --- HOST WEBRTC CONNECTION HANDLING ---

  private setupHostConnectionListeners(conn: DataConnection) {
    let connectionPlayerId: string = '';

    conn.on('open', () => {
      console.log('Host established RTC pipe with dynamic peer:', conn.peer);
    });

    conn.on('data', (data: any) => {
      try {
        const raw = JSON.parse(data as string) as ClientMessage;

        // If join_room is triggered, map connection ID to a player ID
        if (raw.type === 'join_room') {
          connectionPlayerId = Math.random().toString(36).substring(2, 9);
          this.activeConnections[connectionPlayerId] = conn;
        }

        if (connectionPlayerId) {
          this.processHostMessage(connectionPlayerId, raw);
        }
      } catch (e) {
        console.error('Host exception processing message:', e);
      }
    });

    conn.on('close', () => {
      if (connectionPlayerId) {
        console.log(`Connection closed for client: ${connectionPlayerId}`);
        this.handleClientDisconnect(connectionPlayerId);
      }
    });

    conn.on('error', (err) => {
      console.error(`Host connection error on pipe with ${connectionPlayerId}:`, err);
      if (connectionPlayerId) {
        this.handleClientDisconnect(connectionPlayerId);
      }
    });
  }

  private handleClientDisconnect(playerId: string) {
    const r = this.roomState;
    if (!r) return;

    const player = r.players[playerId];
    if (player) {
      player.isConnected = false;
      this.sendSystemChat(`🔌 ${player.name} se desconectó.`);

      // If playing on current active turn, auto fold their turn
      if (r.currentPlayerId === playerId && r.phase !== 'WAITING' && r.phase !== 'SHOWDOWN') {
        this.processPlayerAction(playerId, 'fold');
      } else {
        // Delete immediately if spectating
        if (player.seatIndex === -1) {
          delete r.players[playerId];
        }
        this.broadcastState();
      }
    }

    delete this.activeConnections[playerId];
  }

  // --- HOST AUTHORITATIVE STATE & GAME LOOP ENGINE ---

  private processHostMessage(playerId: string, msg: ClientMessage) {
    const r = this.roomState;
    if (!r) return;

    switch (msg.type) {
      case 'create_room':
        // Handled synchronously in open listener
        break;

      case 'join_room': {
        const { name } = msg.payload;
        
        // Add as a spectator initially
        r.players[playerId] = {
          id: playerId,
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

        // Welcome custom payload with client ID
        const targetPipe = this.activeConnections[playerId];
        if (targetPipe && targetPipe.open) {
          targetPipe.send(JSON.stringify({
            type: 'welcome',
            payload: { playerId }
          }));
        }

        this.sendSystemChat(`👋 ${name} se unió como espectador.`);
        this.broadcastState();
        break;
      }

      case 'sit_down': {
        const { seatIndex, buyIn } = msg.payload;
        // Verify seat target is empty
        const isOccupied = Object.values(r.players).some(p => p.seatIndex === seatIndex);
        if (isOccupied) {
          this.sendPrivateError(playerId, 'Este asiento ya está ocupado.');
          break;
        }

        const player = r.players[playerId];
        if (player) {
          player.seatIndex = seatIndex;
          player.chips = buyIn || 1000;
          player.folded = false;
          player.isAllIn = false;
          player.currentBet = 0;
          player.lastAction = '';

          this.sendSystemChat(`🪑 ${player.name} se sentó en el Asiento ${seatIndex + 1} con ${player.chips} fichas.`);
          this.broadcastState();
        }
        break;
      }

      case 'stand_up': {
        const player = r.players[playerId];
        if (player && player.seatIndex >= 0) {
          const oldSeat = player.seatIndex;
          player.seatIndex = -1;
          player.cards = [];
          this.sendSystemChat(`🚶 ${player.name} se levantó del Asiento ${oldSeat + 1}.`);

          if (r.currentPlayerId === playerId && r.phase !== 'WAITING' && r.phase !== 'SHOWDOWN') {
            this.processPlayerAction(playerId, 'fold');
          } else {
            this.broadcastState();
          }
        }
        break;
      }

      case 'send_chat': {
        const { text } = msg.payload;
        const player = r.players[playerId];
        const name = player ? player.name : 'Espectador';

        const chatMsg: ChatMessage = {
          id: Math.random().toString(36).substring(2, 9),
          sender: name,
          text,
          timestamp: Date.now(),
          isSystem: false
        };

        this.broadcastToAll({
          type: 'chat_message',
          payload: chatMsg
        });
        break;
      }

      case 'start_game':
        this.startNewHand();
        break;

      case 'action': {
        const { actionType, amount } = msg.payload;
        this.processPlayerAction(playerId, actionType, amount);
        break;
      }

      case 'rebuy': {
        const player = r.players[playerId];
        if (player && player.chips <= 0) {
          player.chips = 1000;
          player.folded = false;
          player.isAllIn = false;
          player.currentBet = 0;
          player.lastAction = '';

          this.sendSystemChat(`💰 ${player.name} hizo recompra (Rebuy) de 1000 fichas.`);
          this.broadcastState();
        }
        break;
      }

      case 'ping':
        this.sendPrivateMessage(playerId, { type: 'error', payload: { message: 'pong' } });
        break;
    }
  }

  // --- GAME SYSTEM ROUTINES (Ported from server.ts) ---

  private getSittingPlayers(): Player[] {
    if (!this.roomState) return [];
    return Object.values(this.roomState.players)
      .filter(p => p.seatIndex >= 0)
      .sort((a, b) => a.seatIndex - b.seatIndex);
  }

  private findNextSeatClockwise(startIndex: number): number {
    if (!this.roomState) return -1;
    const players = this.getSittingPlayers();
    if (players.length === 0) return -1;

    for (let offset = 1; offset <= 8; offset++) {
      const seat = (startIndex + offset) % 8;
      const playerAtSeat = Object.values(this.roomState.players).find(p => p.seatIndex === seat);
      if (playerAtSeat && !playerAtSeat.folded && !playerAtSeat.isAllIn && playerAtSeat.chips > 0) {
        return seat;
      }
    }
    return -1;
  }

  private clearTimer() {
    if (this.activeTimers) {
      clearInterval(this.activeTimers);
      this.activeTimers = null;
    }
  }

  private startTurnTimer() {
    this.clearTimer();
    const r = this.roomState;
    if (!r || !r.currentPlayerId) return;

    r.timeLeft = r.turnTimeout;

    this.activeTimers = setInterval(() => {
      const state = this.roomState;
      if (!state) {
        this.clearTimer();
        return;
      }

      state.timeLeft -= 1;

      if (state.timeLeft <= 0) {
        this.clearTimer();
        this.handleTimeout();
      } else {
        this.broadcastState();
      }
    }, 1000);
  }

  private handleTimeout() {
    const r = this.roomState;
    if (!r || !r.currentPlayerId) return;

    const player = r.players[r.currentPlayerId];
    if (!player) return;

    const needsToCall = r.currentBet - player.currentBet;
    this.sendSystemChat(`⏱️ Tiempo agotado para ${player.name}.`);

    if (needsToCall <= 0) {
      this.processPlayerAction(r.currentPlayerId, 'check');
    } else {
      this.processPlayerAction(r.currentPlayerId, 'fold');
    }
  }

  private startNewHand() {
    this.clearTimer();
    const r = this.roomState;
    if (!r) return;

    const playersAtTable = this.getSittingPlayers();
    const activePlayers = playersAtTable.filter(p => p.chips > 0);

    if (activePlayers.length < 2) {
      r.phase = 'WAITING';
      r.winners = [];
      r.communityCards = [];
      r.pot = 0;
      r.currentPlayerId = null;
      this.sendSystemChat('⚠️ Esperando por al menos 2 jugadores activos con fichas para comenzar.');
      this.broadcastState();
      return;
    }

    // Initialize round variables
    for (const p of playersAtTable) {
      if (p.chips > 0) {
        p.folded = false;
        p.isAllIn = false;
        p.currentBet = 0;
        p.lastAction = '';
      } else {
        p.folded = true;
        p.isAllIn = false;
        p.currentBet = 0;
        p.lastAction = 'Sin fichas';
      }
    }

    r.communityCards = [];
    r.winners = [];
    r.showdownCards = {};
    r.pot = 0;
    r.handId += 1;

    // Reset wagers
    this.totalHandWagers = {};

    // Shuffler
    this.deck = createDeck();
    shuffle(this.deck);

    // Pick dealer button
    if (r.dealerIndex === -1) {
      r.dealerIndex = activePlayers[Math.floor(Math.random() * activePlayers.length)].seatIndex;
    } else {
      let nextDealer = this.findNextSeatClockwise(r.dealerIndex);
      if (nextDealer === -1) {
        nextDealer = activePlayers[0].seatIndex;
      }
      r.dealerIndex = nextDealer;
    }

    // Post blinds
    const sbAmount = r.smallBlind;
    const bbAmount = r.bigBlind;

    let sbSeat = -1;
    let bbSeat = -1;

    if (activePlayers.length === 2) {
      sbSeat = r.dealerIndex;
      bbSeat = activePlayers.find(p => p.seatIndex !== r.dealerIndex)!.seatIndex;
    } else {
      sbSeat = this.findNextSeatClockwise(r.dealerIndex);
      bbSeat = this.findNextSeatClockwise(sbSeat);
    }

    r.sbIndex = sbSeat;
    r.bbIndex = bbSeat;

    const sbPlayer = Object.values(r.players).find(p => p.seatIndex === sbSeat);
    const bbPlayer = Object.values(r.players).find(p => p.seatIndex === bbSeat);

    if (sbPlayer) {
      const sbPost = Math.min(sbPlayer.chips, sbAmount);
      sbPlayer.chips -= sbPost;
      sbPlayer.currentBet = sbPost;
      sbPlayer.lastAction = 'Ciega Chica';
      if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;
      this.recordWager(sbPlayer.id, sbPost);
    }

    if (bbPlayer) {
      const bbPost = Math.min(bbPlayer.chips, bbAmount);
      bbPlayer.chips -= bbPost;
      bbPlayer.currentBet = bbPost;
      bbPlayer.lastAction = 'Ciega Grande';
      if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;
      this.recordWager(bbPlayer.id, bbPost);
    }

    r.currentBet = bbAmount;
    r.minRaise = bbAmount;

    // Deal private cards
    this.playerHands = {};
    for (const p of activePlayers) {
      if (this.deck.length >= 2) {
        this.playerHands[p.id] = [this.deck.shift()!, this.deck.shift()!];
      }
    }

    r.phase = 'PREFLOP';

    let firstActorSeat = -1;
    if (activePlayers.length === 2) {
      firstActorSeat = sbSeat;
    } else {
      firstActorSeat = this.findNextSeatClockwise(bbSeat);
    }

    const actor = Object.values(r.players).find(p => p.seatIndex === firstActorSeat);
    r.currentPlayerId = actor ? actor.id : null;

    this.sendSystemChat(`🏁 Comienza la Mano #${r.handId}. Repartiendo cartas.`);
    this.sendSystemChat(`Dealer: Seat-${r.dealerIndex + 1}. Ciega Chica: Seat-${r.sbIndex + 1}. Ciega Grande: Seat-${r.bbIndex + 1}.`);

    this.startTurnTimer();
  }

  private recordWager(playerId: string, amount: number) {
    this.totalHandWagers[playerId] = (this.totalHandWagers[playerId] || 0) + amount;
  }

  private processPlayerAction(pId: string, actionType: 'check' | 'call' | 'raise' | 'fold', raiseAmount?: number) {
    const r = this.roomState;
    if (!r || r.currentPlayerId !== pId) return;

    const player = r.players[pId];
    if (!player || player.folded || player.isAllIn) return;

    const currentHighestBet = r.currentBet;
    const playerPaidThisRound = player.currentBet;
    const needsToCall = currentHighestBet - playerPaidThisRound;

    let announceText = '';

    if (actionType === 'fold') {
      player.folded = true;
      player.lastAction = 'No voy';
      announceText = `❌ ${player.name} no va (Fold).`;
    } else if (actionType === 'check') {
      if (needsToCall > 0) {
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
      this.recordWager(player.id, callAmount);

      if (player.chips === 0) {
        player.isAllIn = true;
        announceText = `🚀 ${player.name} iguala y va ALL-IN con ${player.currentBet}!`;
      } else {
        announceText = `💵 ${player.name} iguala (${player.currentBet}).`;
      }
    } else if (actionType === 'raise') {
      const totalBetToPlace = raiseAmount || (currentHighestBet + r.minRaise);
      const addedChipsNeeded = totalBetToPlace - playerPaidThisRound;

      const minRequiredTotal = currentHighestBet + r.minRaise;
      const isAllInRaise = addedChipsNeeded >= player.chips;

      let actualBet = totalBetToPlace;
      let actualAdded = addedChipsNeeded;

      if (isAllInRaise) {
        actualAdded = player.chips;
        actualBet = playerPaidThisRound + actualAdded;
        player.isAllIn = true;
        player.lastAction = 'All-In';
        announceText = `🔥 ${player.name} sube ALL-IN a ${actualBet}!`;
      } else {
        if (totalBetToPlace < minRequiredTotal) {
          actualBet = minRequiredTotal;
          actualAdded = actualBet - playerPaidThisRound;
        }

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
      this.recordWager(player.id, actualAdded);

      const raiseDiff = actualBet - currentHighestBet;
      if (raiseDiff > 0) {
        r.minRaise = Math.max(raiseDiff, r.bigBlind);
      }
      r.currentBet = actualBet;

      // Reset others
      for (const other of Object.values(r.players)) {
        if (other.id !== pId && other.seatIndex >= 0 && !other.folded && !other.isAllIn) {
          if (other.lastAction !== '') {
            other.lastAction = '';
          }
        }
      }
    }

    this.sendSystemChat(announceText);

    // Check if round resolved
    const nonFolded = Object.values(r.players).filter(p => p.seatIndex >= 0 && !p.folded);
    const eligibleActors = nonFolded.filter(p => !p.isAllIn);

    if (nonFolded.length === 1) {
      this.declareSingleWinner(nonFolded[0]);
      return;
    }

    const allMatched = eligibleActors.every(p => p.currentBet === r.currentBet && p.lastAction !== '');

    if (allMatched || eligibleActors.length === 0) {
      this.advanceBettingRound();
    } else {
      const nextSeat = this.findNextSeatClockwise(player.seatIndex);
      if (nextSeat !== -1) {
        const nextPlayer = Object.values(r.players).find(p => p.seatIndex === nextSeat);
        r.currentPlayerId = nextPlayer ? nextPlayer.id : null;
        this.startTurnTimer();
      } else {
        this.advanceBettingRound();
      }
    }
  }

  private advanceBettingRound() {
    const r = this.roomState;
    if (!r) return;

    let collectedThisRound = 0;
    for (const p of Object.values(r.players)) {
      collectedThisRound += p.currentBet;
      p.currentBet = 0;
      p.lastAction = '';
    }
    r.pot += collectedThisRound;
    r.currentBet = 0;
    r.minRaise = r.bigBlind;

    const nonFolded = Object.values(r.players).filter(p => p.seatIndex >= 0 && !p.folded);
    const nonFoldedNotAllIn = nonFolded.filter(p => !p.isAllIn);

    if (nonFolded.length === 1) {
      this.declareSingleWinner(nonFolded[0]);
      return;
    }

    // Run out cards since everyone is either all-in or folded except max 1 player
    if (nonFoldedNotAllIn.length <= 1) {
      if (r.phase === 'PREFLOP') {
        if (this.deck.length >= 5) {
          this.deck.shift(); // burn
          r.communityCards.push(this.deck.shift()!, this.deck.shift()!, this.deck.shift()!); // flop
          this.deck.shift();
          r.communityCards.push(this.deck.shift()!); // turn
          this.deck.shift();
          r.communityCards.push(this.deck.shift()!); // river
        }
      } else if (r.phase === 'FLOP') {
        if (this.deck.length >= 3) {
          this.deck.shift();
          r.communityCards.push(this.deck.shift()!); // turn
          this.deck.shift();
          r.communityCards.push(this.deck.shift()!); // river
        }
      } else if (r.phase === 'TURN') {
        if (this.deck.length >= 2) {
          this.deck.shift();
          r.communityCards.push(this.deck.shift()!); // river
        }
      }
      r.phase = 'SHOWDOWN';
      this.evaluateShowdown();
      return;
    }

    // Advance street
    if (r.phase === 'PREFLOP') {
      r.phase = 'FLOP';
      if (this.deck.length >= 4) {
        this.deck.shift(); // burn
        r.communityCards.push(this.deck.shift()!, this.deck.shift()!, this.deck.shift()!);
      }
      this.sendSystemChat(`🃏 --- FLOP: ${formatCards(r.communityCards)} ---`);
      this.startStreetBetting();
    } else if (r.phase === 'FLOP') {
      r.phase = 'TURN';
      if (this.deck.length >= 2) {
        this.deck.shift(); // burn
        r.communityCards.push(this.deck.shift()!);
      }
      this.sendSystemChat(`🃏 --- TURN: ${formatCards([r.communityCards[3]])} ---`);
      this.startStreetBetting();
    } else if (r.phase === 'TURN') {
      r.phase = 'RIVER';
      if (this.deck.length >= 2) {
        this.deck.shift(); // burn
        r.communityCards.push(this.deck.shift()!);
      }
      this.sendSystemChat(`🃏 --- RIVER: ${formatCards([r.communityCards[4]])} ---`);
      this.startStreetBetting();
    } else if (r.phase === 'RIVER') {
      r.phase = 'SHOWDOWN';
      this.evaluateShowdown();
    }
  }

  private startStreetBetting() {
    const r = this.roomState;
    if (!r) return;

    for (const p of Object.values(r.players)) {
      if (p.seatIndex >= 0) {
        p.lastAction = '';
      }
    }

    const firstSeat = this.findNextSeatClockwise(r.dealerIndex);
    if (firstSeat !== -1) {
      const firstPlayer = Object.values(r.players).find(p => p.seatIndex === firstSeat);
      r.currentPlayerId = firstPlayer ? firstPlayer.id : null;
      this.startTurnTimer();
    } else {
      this.advanceBettingRound();
    }
  }

  private declareSingleWinner(winner: Player) {
    this.clearTimer();
    const r = this.roomState;
    if (!r) return;

    let collected = 0;
    for (const p of Object.values(r.players)) {
      collected += p.currentBet;
      p.currentBet = 0;
      p.lastAction = '';
    }

    const totalWinnings = r.pot + collected;
    winner.chips += totalWinnings;
    r.pot = 0;

    r.phase = 'SHOWDOWN';
    r.currentPlayerId = null;
    r.winners = [{
      playerId: winner.id,
      name: winner.name,
      amountWon: totalWinnings,
      description: 'Todos los oponentes se retiraron',
      winningCards: []
    }];

    r.showdownCards = {};

    this.sendSystemChat(`🏆 ${winner.name} gana el pozo de ${totalWinnings} fichas (todos se retiraron).`);
    this.broadcastState();
    this.setAutoRestartTimer();
  }

  private setAutoRestartTimer() {
    this.clearTimer();
    const r = this.roomState;
    if (!r) return;

    r.timeLeft = 12;
    this.activeTimers = setInterval(() => {
      const state = this.roomState;
      if (!state) {
        this.clearTimer();
        return;
      }
      state.timeLeft -= 1;
      if (state.timeLeft <= 0) {
        this.clearTimer();
        this.startNewHand();
      } else {
        this.broadcastState();
      }
    }, 1000);
  }

  private evaluateShowdown() {
    this.clearTimer();
    const r = this.roomState;
    if (!r) return;

    const sitting = this.getSittingPlayers();
    const survivors = sitting.filter(p => !p.folded);

    // Compute evaluation scores
    const evaluations: { [pId: string]: any } = {};
    for (const p of survivors) {
      const privateHand = this.playerHands[p.id] || [];
      evaluations[p.id] = evaluate7CardHand(privateHand, r.communityCards);
    }

    r.showdownCards = {};
    for (const p of sitting) {
      if (!p.folded) {
        r.showdownCards[p.id] = this.playerHands[p.id] || [];
      }
    }

    const wagers = this.totalHandWagers;
    for (const p of sitting) {
      if (wagers[p.id] === undefined) {
        wagers[p.id] = 0;
      }
    }

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
    let remainingWagers = playerWagers.map(pw => ({ ...pw }));

    while (remainingWagers.some(rw => rw.wager > 0)) {
      const eligibleUnfolded = remainingWagers.filter(rw => !rw.folded && rw.wager > 0);

      if (eligibleUnfolded.length === 0) {
        const remainingFolded = remainingWagers.filter(rw => rw.wager > 0);
        for (const rf of remainingFolded) {
          const playerRecord = r.players[rf.id];
          if (playerRecord) {
            playerRecord.chips += rf.wager;
            this.sendSystemChat(`Devueltas ${rf.wager} fichas al jugador retirado ${playerRecord.name}`);
          }
          rf.wager = 0;
        }
        break;
      }

      const contributors = remainingWagers.filter(rw => rw.wager > 0);
      const minWager = Math.min(...contributors.map(c => c.wager));

      let subPotSize = 0;
      for (const rw of remainingWagers) {
        if (rw.wager > 0) {
          const contribution = Math.min(rw.wager, minWager);
          subPotSize += contribution;
          rw.wager -= contribution;
        }
      }

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

      const share = Math.floor(subPotSize / winningWagers.length);
      const remainder = subPotSize % winningWagers.length;

      winningWagers.forEach((ww, idx) => {
        const bonus = idx === 0 ? remainder : 0;
        const payout = share + bonus;

        const playerRecord = r.players[ww.id];
        if (playerRecord) {
          playerRecord.chips += payout;

          const existingWinner = winnersList.find(w => w.playerId === ww.id);
          if (existingWinner) {
            existingWinner.amountWon += payout;
          } else {
            winnersList.push({
              playerId: ww.id,
              name: playerRecord.name,
              amountWon: payout,
              description: ww.evaluation.description,
              winningCards: ww.evaluation.cards
            });
          }
        }
      });
    }

    r.pot = 0;
    r.winners = winnersList;
    r.currentPlayerId = null;

    for (const w of winnersList) {
      this.sendSystemChat(`🏆 ${w.name} gana ${w.amountWon} fichas con ${w.description}!`);
    }

    this.totalHandWagers = {};
    this.broadcastState();
    this.setAutoRestartTimer();
  }

  // --- COMMUNICATION INTERNALS ---

  private sendSystemChat(text: string) {
    const chatMsg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      sender: 'Sistema',
      text,
      timestamp: Date.now(),
      isSystem: true
    };

    this.broadcastToAll({
      type: 'chat_message',
      payload: chatMsg
    });
  }

  private sendPrivateError(playerId: string, message: string) {
    this.sendPrivateMessage(playerId, {
      type: 'error',
      payload: { message }
    });
  }

  private sendPrivateMessage(playerId: string, msg: ServerMessage) {
    if (playerId === this.boundPlayerId) {
      this.onMessageCallback(msg);
    } else {
      const conn = this.activeConnections[playerId];
      if (conn && conn.open) {
        conn.send(JSON.stringify(msg));
      }
    }
  }

  private broadcastToAll(msg: ServerMessage) {
    // Deliver to self local layout
    this.onMessageCallback(msg);

    // Deliver to all guests over WebRTC
    for (const conn of Object.values(this.activeConnections)) {
      if (conn.open) {
        conn.send(JSON.stringify(msg));
      }
    }
  }

  private broadcastState() {
    const r = this.roomState;
    if (!r) return;

    // We tailor the state for EVERY player so players can't see each other's hole cards (anti-cheat)
    const audienceIds = Array.from(new Set([
      this.boundPlayerId,
      ...Object.keys(this.activeConnections)
    ]));

    for (const targetId of audienceIds) {
      const tailoredPlayers: { [id: string]: Player } = {};

      for (const [pId, player] of Object.entries(r.players)) {
        const privateHand = this.playerHands[pId] || [];

        let visibleCards: Card[] = [];
        if (r.phase === 'SHOWDOWN') {
          if (!player.folded && player.seatIndex >= 0) {
            visibleCards = privateHand;
          }
        } else if (pId === targetId) {
          visibleCards = privateHand;
        }

        tailoredPlayers[pId] = {
          ...player,
          cards: visibleCards
        };
      }

      const tailoredState: RoomState = {
        ...r,
        players: tailoredPlayers,
        deckSize: this.deck.length
      };

      const payload: ServerMessage = {
        type: 'state_update',
        payload: {
          state: tailoredState,
          selfPlayerId: targetId
        }
      };

      this.sendPrivateMessage(targetId, payload);
    }
  }
}
