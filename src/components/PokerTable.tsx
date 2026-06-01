import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, WifiOff, Award, Sparkles } from 'lucide-react';
import { RoomState, Player, Card } from '../types';
import CardView from './CardView';

interface PokerTableProps {
  roomState: RoomState;
  selfPlayerId: string;
  onSitDown: (seatIndex: number, buyIn: number) => void;
  onStandUp: () => void;
}

// 8 symmetric seat coordinate layout percentages around the oval table
const seatPositions = [
  { left: '50%', top: '85%', transform: 'translate(-50%, -20%)' },  // Seat 0: Bottom Center (hero seat)
  { left: '15%', top: '74%', transform: 'translate(-50%, -50%)' },  // Seat 1: Bottom Left
  { left: '6%', top: '48%', transform: 'translate(-50%, -50%)' },   // Seat 2: Middle Left
  { left: '15%', top: '22%', transform: 'translate(-50%, -50%)' },  // Seat 3: Top Left
  { left: '50%', top: '10%', transform: 'translate(-50%, -80%)' },  // Seat 4: Top Center
  { left: '85%', top: '22%', transform: 'translate(-50%, -50%)' },  // Seat 5: Top Right
  { left: '94%', top: '48%', transform: 'translate(-50%, -50%)' },  // Seat 6: Middle Right
  { left: '85%', top: '74%', transform: 'translate(-50%, -50%)' }   // Seat 7: Bottom Right
];

// Helper to check if card is part of the winning combination at showdown
function isWinningCard(card: Card, winningCards: Card[] | undefined): boolean {
  if (!winningCards || winningCards.length === 0) return false;
  return winningCards.some(wc => wc.suit === card.suit && wc.value === card.value);
}

export default function PokerTable({ roomState, selfPlayerId, onSitDown, onStandUp }: PokerTableProps) {
  const { players, communityCards, pot, currentBet, dealerIndex, currentPlayerId, phase, winners, sbIndex, bbIndex } = roomState;

  // Find player by seat index helper
  const getPlayerAtSeat = (seatIndex: number): Player | null => {
    return Object.values(players).find(p => p.seatIndex === seatIndex) || null;
  };

  // Check if self is currently sitting in ANY seat
  const selfPlayer = players[selfPlayerId];
  const isSelfSitting = selfPlayer && selfPlayer.seatIndex >= 0;

  return (
    <div className="w-full relative select-none flex flex-col items-center">
      
      {/* Outer boundary of the premium casino table container */}
      <div className="w-full max-w-[900px] aspect-[16/10] bg-transparent rounded-3xl p-4 flex items-center justify-center relative overflow-hidden">
        
        {/* Giant textured background oval representing the elite green felt */}
        <div className="absolute inset-0 m-6 md:m-10 rounded-[100px] md:rounded-[150px] bg-gradient-to-b from-[#0e4b31] to-[#072a1a] border-[12px] border-[#1a130f] shadow-[0_0_80px_rgba(0,0,0,0.8),inset_0_0_100px_rgba(0,0,0,0.5)] flex items-center justify-center">
          <div className="absolute inset-2 border-2 border-emerald-500/20 rounded-[96px] md:rounded-[142px]" />
          
          {/* Subtle felt watermarking pattern */}
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
 
          {/* Golden branding text watermark */}
          <div className="absolute text-[8vw] md:text-5xl font-black text-emerald-950/20 pointer-events-none select-none tracking-[0.25em] italic uppercase font-sans">
            ROYAL HOLD'EM
          </div>
        </div>

        {/* --- Multi Player Seats Layout --- */}
        {seatPositions.map((pos, idx) => {
          const player = getPlayerAtSeat(idx);
          const isCurrentTurn = player && currentPlayerId === player.id && phase !== 'SHOWDOWN' && phase !== 'WAITING';
          const isSmallBlind = idx === sbIndex;
          const isBigBlind = idx === bbIndex;
          const hasButton = idx === dealerIndex;

          return (
            <div
              key={idx}
              className="absolute z-10"
              style={{
                left: pos.left,
                top: pos.top,
                transform: pos.transform
              }}
            >
              {player ? (
                // Seat occupied by player
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={`flex flex-col items-center transition-all ${
                    player.folded ? 'opacity-50 grayscale-[30%]' : ''
                  }`}
                >
                  {/* Floating Action Overlay Badge */}
                  <AnimatePresence>
                    {player.lastAction && (
                      <motion.div
                        initial={{ scale: 0.5, y: 15, opacity: 0 }}
                        animate={{ scale: 1, y: -2, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        className={`absolute -top-7 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white shadow shadow-black/40 ${
                          player.lastAction.includes('sube') || player.lastAction.includes('All-In')
                            ? 'bg-red-600 border border-red-500'
                            : player.lastAction.includes('Ciega')
                            ? 'bg-yellow-600 border border-yellow-500'
                            : player.lastAction.includes('Iguala')
                            ? 'bg-blue-600 border border-blue-500'
                            : player.lastAction.includes('Paso')
                            ? 'bg-slate-700 border border-slate-600'
                            : 'bg-slate-850 text-slate-400'
                        }`}
                      >
                        {player.lastAction}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Player Cards (Placed Above Avatar Ring) */}
                  {!player.folded && (
                    <div className="flex gap-1 mb-1 shadow-lg h-12 md:h-14 items-center">
                    {player.cards && player.cards.length > 0 ? (
                      player.cards.map((card, cIdx) => {
                        // Check if this card won at showdown to apply highlights
                        const isWinner = winners?.some(w => 
                          isWinningCard(card, w.winningCards)
                        );
                        return (
                          <CardView 
                            key={cIdx} 
                            card={card} 
                            size="sm" 
                            index={cIdx} 
                            highlight={isWinner}
                          />
                        );
                      })
                    ) : (
                      // Hole cards exist but are hidden (spectator mode or other player cards face-down during game)
                      phase !== 'WAITING' && phase !== 'SHOWDOWN' ? (
                        <>
                          <CardView card={null} size="sm" index={0} />
                          <CardView card={null} size="sm" index={1} />
                        </>
                      ) : null
                    )}
                    </div>
                  )}

                  {/* Seat Avatar Ring */}
                  <div
                    className={`w-16 h-16 md:w-[72px] md:h-[72px] rounded-2xl flex flex-col items-center justify-center border-2 relative ${
                      isCurrentTurn
                        ? 'border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.5)] animate-pulse'
                        : player.id === selfPlayerId
                        ? 'border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                        : 'border-white/10'
                    } ${
                      player.isConnected ? 'bg-black/80 text-white' : 'bg-black/90 text-slate-500'
                    }`}
                  >
                    {/* Disconnected state check */}
                    {!player.isConnected && (
                      <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center z-10">
                        <WifiOff size={16} className="text-red-500 animate-pulse" />
                      </div>
                    )}

                    {/* Seat Avatar Number or Tag */}
                    <span className="text-[9px] uppercase text-slate-400 font-semibold tracking-wider">Asiento {idx + 1}</span>
                    <span className="font-bold text-xs md:text-sm truncate max-w-[62px] px-0.5 leading-tight">{player.name}</span>
                    <span className="text-[10px] text-amber-400 font-bold mt-0.5 font-mono">
                      {player.chips > 0 ? `${player.chips} 🪙` : 'BUSTED'}
                    </span>

                    {/* Dealer Button Token near Avatar */}
                    {hasButton && (
                      <motion.div
                        layoutId="dealerButton"
                        className="absolute -right-2 bottom-1 w-5 h-5 rounded-full bg-yellow-550 bg-amber-400 border border-[#1a130f] text-slate-950 flex items-center justify-center font-black text-[10px] shadow"
                      >
                        D
                      </motion.div>
                    )}

                    {/* blind text */}
                    {(isSmallBlind || isBigBlind) && (
                      <span className="absolute -left-3 top-1 bg-amber-600 text-slate-950 text-[8px] font-black px-1 rounded shadow-sm">
                        {isSmallBlind ? 'SB' : 'BB'}
                      </span>
                    )}
                  </div>

                  {/* Current Active Wager adjacent to seat */}
                  {player.currentBet > 0 && (
                    <div className="mt-1 bg-black/70 backdrop-blur-sm border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 shadow">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                      <span className="text-[10px] font-bold font-mono text-emerald-400">{player.currentBet}</span>
                    </div>
                  )}
                </motion.div>
              ) : (
                // Seat vacant
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  className="flex flex-col items-center"
                >
                  {!isSelfSitting ? (
                    <button
                      onClick={() => onSitDown(idx, 1000)}
                      className="px-3 py-1.5 bg-black/40 hover:bg-black/70 border border-dashed border-white/20 text-slate-300 hover:text-white rounded-xl text-[10px] font-bold tracking-wider uppercase transition flex items-center gap-1 shadow backdrop-blur-md"
                    >
                      + Unirse
                    </button>
                  ) : (
                    <div className="w-8 h-8 rounded-full border border-dashed border-white/10 bg-black/30 flex items-center justify-center opacity-45">
                      <span className="text-[10px] text-slate-600 font-bold">{idx + 1}</span>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          );
        })}

        {/* --- Poker Table Centerfelt Stage --- */}
        <div className="flex flex-col items-center justify-center w-full max-w-[400px] z-0 text-center select-none font-sans mt-4">
          
          {/* Active Total Pot Bank */}
          {pot > 0 && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-black/60 border border-yellow-550/30 backdrop-blur-md px-3.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-xl mb-4"
            >
              <div className="flex -space-x-1">
                <span className="w-4 h-4 rounded-full bg-red-600 border border-white text-[8px] flex items-center justify-center text-white font-bold shadow">🪙</span>
                <span className="w-4 h-4 rounded-full bg-blue-600 border border-white text-[8px] flex items-center justify-center text-white font-bold shadow">🪙</span>
              </div>
              <span className="text-xs text-amber-300 font-semibold uppercase tracking-wider">Pozo Total:</span>
              <span className="text-sm font-bold font-mono text-yellow-400 tracking-wider font-semibold">{pot}</span>
            </motion.div>
          )}

          {/* Current Bet to match (if any) */}
          {currentBet > 0 && phase !== 'SHOWDOWN' && phase !== 'WAITING' && (
            <div className="text-[10px] text-slate-350 bg-slate-950/45 px-2 py-0.5 rounded-md font-medium mb-3.5 tracking-wider border border-slate-800 uppercase">
              Apuesta máxima actual: <span className="text-amber-400 font-bold font-mono text-xs">{currentBet}</span>
            </div>
          )}

          {/* Community Shared Board (Flop, Turn, River) */}
          <div className="flex gap-1.5 md:gap-2 justify-center py-2 relative min-h-[60px] md:min-h-[85px] w-full">
            {communityCards && communityCards.length > 0 ? (
              communityCards.map((card, cIdx) => {
                // Highlighting card checks
                const isWinner = winners?.some(w => 
                  isWinningCard(card, w.winningCards)
                );
                return (
                  <CardView 
                    key={cIdx} 
                    card={card} 
                    size="md" 
                    index={cIdx} 
                    highlight={isWinner}
                  />
                );
              })
            ) : (
              phase !== 'WAITING' && (
                <div className="border border-dashed border-emerald-600/30 rounded-lg w-full flex items-center justify-center py-5 opacity-40">
                  <span className="text-xs uppercase text-emerald-400/50 font-semibold tracking-wider">Esperando Flop...</span>
                </div>
              )
            )}
          </div>

          {/* Showdown Winners Spotlight Banners */}
          <AnimatePresence>
            {phase === 'SHOWDOWN' && winners && winners.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-3.5 bg-slate-900 border-2 border-yellow-500/80 rounded-xl p-3 shadow-2xl relative max-w-[280px] md:max-w-[320px] backdrop-blur"
              >
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-500 text-slate-950 px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow">
                  <Award size={12} className="fill-current" />
                  <span className="text-[9px] font-black uppercase tracking-wider">GANADOR</span>
                </div>

                <div className="mt-1 text-center space-y-1">
                  {winners.map((win, idx) => (
                    <div key={idx} className="flex flex-col items-center">
                      <h4 className="font-extrabold text-sm text-yellow-400 inline-flex items-center gap-1 select-none">
                        <Sparkles size={13} className="text-amber-500" />
                        {win.name}
                        <Sparkles size={13} className="text-amber-500" />
                      </h4>
                      <p className="text-xs text-white font-mono leading-tight">Ganó {win.amountWon} fichas</p>
                      <span className="text-[10px] text-slate-300 italic font-medium">{win.description}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Waiting for Players Banner */}
          {phase === 'WAITING' && (
            <div className="bg-slate-950/70 border border-slate-800 py-3.5 px-6 rounded-2xl shadow-xl flex flex-col items-center backdrop-blur">
              <span className="text-sm font-bold text-slate-100 tracking-wide">Listo para jugar con amigos</span>
              <p className="text-[11px] text-slate-400 mt-1 max-w-[200px]">Siéntate en una de las posiciones y dale a Iniciar Partida!</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
