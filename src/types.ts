export interface Player {
  id: string; // Dynamic WS client ID
  name: string;
  chips: number;
  seatIndex: number; // -1 if spectating, 0-7 if sitting
  cards: Card[]; // Only populated/sent if owned by caller OR during showdown
  currentBet: number;
  folded: boolean;
  isAllIn: boolean;
  isConnected: boolean;
  lastAction: string; // 'Check', 'Call', 'Raise', 'Fold', 'Small Blind', 'Big Blind', or empty
  showCardsAtShowdown: boolean; // Whether player wants to show they have been called
}

export interface Card {
  suit: 'H' | 'D' | 'C' | 'S'; // Hearts, Diamonds, Clubs, Spades
  value: string; // '2'-'10', 'J', 'Q', 'K', 'A'
}

export interface ChatMessage {
  id: string;
  sender: string; // 'System' or player name
  text: string;
  timestamp: number;
  isSystem: boolean;
}

export type GamePhase = 'WAITING' | 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';

export interface RoomState {
  code: string;
  creatorId: string;
  phase: GamePhase;
  players: { [id: string]: Player };
  communityCards: Card[];
  pot: number;
  mainPot: number; // For future side-pot extensions or standard pot
  currentBet: number; // The bet to match
  minRaise: number; // Minimum amount to raise above current bet
  dealerIndex: number; // Seat index of dealer button
  sbIndex: number; // Seat index of small blind
  bbIndex: number; // Seat index of big blind
  currentPlayerId: string | null;
  turnTimeout: number; // Duration of turn in seconds (e.g. 30)
  timeLeft: number; // Time remaining for current player
  smallBlind: number;
  bigBlind: number;
  handId: number; // Serial hand number
  winners: WinnerInfo[];
  showdownCards: { [playerId: string]: Card[] }; // Cards revealed during SHOWDOWN
  deckSize: number;
}

export interface WinnerInfo {
  playerId: string;
  name: string;
  amountWon: number;
  description: string; // e.g. "Full House, Kings full of Aces"
  winningCards: Card[]; // Best 5 card combination
}

// Client to Server WebSocket Messages
export type ClientMessage =
  | { type: 'join_room'; payload: { roomCode: string; name: string } }
  | { type: 'create_room'; payload: { name: string; smallBlind: number; turnTimeout: number } }
  | { type: 'sit_down'; payload: { seatIndex: number; buyIn: number } }
  | { type: 'stand_up' }
  | { type: 'send_chat'; payload: { text: string } }
  | { type: 'start_game' }
  | { type: 'action'; payload: { actionType: 'check' | 'call' | 'raise' | 'fold'; amount?: number } }
  | { type: 'rebuy' }
  | { type: 'ping' };

// Server to Client WebSocket Messages
export type ServerMessage =
  | { type: 'welcome'; payload: { playerId: string } }
  | { type: 'state_update'; payload: { state: RoomState; selfPlayerId: string } }
  | { type: 'chat_message'; payload: ChatMessage }
  | { type: 'error'; payload: { message: string } };
