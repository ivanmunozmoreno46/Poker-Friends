import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Play, RotateCcw, LogOut, Pocket, Flame } from 'lucide-react';
import { RoomState, Player } from '../types';

interface ControlPanelProps {
  roomState: RoomState;
  selfPlayerId: string;
  onTakeAction: (type: 'check' | 'call' | 'raise' | 'fold', amount?: number) => void;
  onStartGame: () => void;
  onRebuy: () => void;
  onStandUp: () => void;
}

export default function ControlPanel({
  roomState,
  selfPlayerId,
  onTakeAction,
  onStartGame,
  onRebuy,
  onStandUp
}: ControlPanelProps) {
  const { phase, currentBet, minRaise, currentPlayerId, timeLeft, turnTimeout, players, smallBlind, pot } = roomState;

  const player = players[selfPlayerId];
  const isCurrentTurn = currentPlayerId === selfPlayerId;
  const isBusted = player && player.seatIndex >= 0 && player.chips === 0 && !player.folded;

  // Local state for raise sizing
  const [raiseValue, setRaiseValue] = useState<number>(currentBet + minRaise);

  // Sync raise state whenever the turn starts or required raise boundaries shift
  useEffect(() => {
    const defaultRaise = Math.max(currentBet + minRaise, currentBet + smallBlind * 2);
    setRaiseValue(defaultRaise);
  }, [currentPlayerId, currentBet, minRaise]);

  if (!player) return null;

  const isSitting = player.seatIndex >= 0;
  const needsToCall = currentBet - player.currentBet;
  const canCheck = needsToCall <= 0;

  // Active playing candidates (for lobby check)
  const sittingPlayers = Object.values(players).filter(p => p.seatIndex >= 0);
  const eligiblePlayersCount = sittingPlayers.filter(p => p.chips > 0).length;

  // Handle raise slider caps
  const maxPossibleRaise = player.chips + player.currentBet; // Total chips they can wager
  const minPossibleRaise = Math.min(maxPossibleRaise, currentBet + minRaise);

  const handleQuickBetShortcut = (multiplier: number, type: 'bb' | 'pot') => {
    if (type === 'bb') {
      const BBVal = smallBlind * 2;
      const targetTotal = BBVal * multiplier;
      setRaiseValue(Math.min(maxPossibleRaise, Math.max(minPossibleRaise, targetTotal)));
    } else if (type === 'pot') {
      // Pot sizing
      const totalPotPlusCalculatedCurrentBets = pot + Object.values(players).reduce((acc, p) => acc + p.currentBet, 0);
      const targetRaise = Math.round(totalPotPlusCalculatedCurrentBets * multiplier) + currentBet;
      setRaiseValue(Math.min(maxPossibleRaise, Math.max(minPossibleRaise, targetRaise)));
    }
  };

  return (
    <div className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 shadow-2xl select-none relative overflow-hidden font-sans">
      
      {/* 1. Timer countdown bar if it's currently anyone's turn */}
      {phase !== 'WAITING' && phase !== 'SHOWDOWN' && currentPlayerId && (
        <div className="absolute top-0 left-0 w-full h-[5px] bg-[#0a0f0d]/40">
          <motion.div
            initial={{ width: '100%' }}
            animate={{ width: `${(timeLeft / turnTimeout) * 100}%` }}
            transition={{ duration: 1, ease: 'linear' }}
            className={`h-full ${timeLeft <= 5 ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-emerald-500'}`}
          />
        </div>
      )}

      {/* 2. Room Lobby Controls - WAITING / Setup phase */}
      {phase === 'WAITING' && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-2">
          <div className="text-center sm:text-left">
            <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5 justify-center sm:justify-start">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
              Lobby de Espera
            </h4>
            <span className="text-xs text-slate-400">
              Jugadores sentados: <span className="text-emerald-400 font-mono font-bold">{sittingPlayers.length} / 8</span>
              {sittingPlayers.length < 2 && ' (Necesitas al menos 2 jugadores para jugar)'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isSitting && (
              <button
                onClick={onStandUp}
                className="px-3 py-1.5 border border-white/10 hover:bg-white/5 text-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition active:scale-95"
              >
                <LogOut size={13} /> Levantarse
              </button>
            )}

            {eligiblePlayersCount >= 2 ? (
              <button
                onClick={onStartGame}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs tracking-wider uppercase border-b-4 border-emerald-800 flex items-center gap-1.5 shadow-lg shadow-emerald-600/15 transition active:scale-95"
              >
                <Play size={13} className="fill-current" /> Iniciar Partida
              </button>
            ) : (
              <button
                disabled
                className="px-5 py-2.5 bg-white/5 border border-white/10 text-slate-500 rounded-xl text-xs font-bold tracking-wider uppercase cursor-not-allowed flex items-center gap-1.5"
              >
                <Play size={13} /> Esperando Amigos
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. Rebuy / Top-up trigger for busted players */}
      {isSitting && player.chips <= 0 && (
        <div className="flex flex-col items-center justify-center p-3 border-2 border-dashed border-red-500/25 bg-red-950/15 rounded-xl text-center space-y-2">
          <p className="text-xs font-semibold text-slate-300">¡Te quedaste sin fichas en esta partida!</p>
          <button
            onClick={onRebuy}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-lg shadow-red-600/10 transition active:scale-95"
          >
            <RotateCcw size={13} /> Hacer Recompra (1000 🪙)
          </button>
        </div>
      )}

      {/* 4. Active Hand In-Game Turn actions */}
      {phase !== 'WAITING' && isSitting && player.chips > 0 && (
        <div className="w-full space-y-4">
          
          {/* If it's my active turn, show rich decision console */}
          {isCurrentTurn ? (
            <motion.div
              initial={{ y: 15, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="space-y-4"
            >
              {/* Header turn tag */}
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-amber-500 uppercase tracking-widest flex items-center gap-1.5 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-400/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                  Tu turno para actuar • {timeLeft}s
                </span>
                <span className="text-slate-400 font-medium text-xs">
                  Tus Fichas: <span className="text-white font-black">{player.chips} 🪙</span>
                </span>
              </div>

              {/* Action main buttons */}
              <div className="grid grid-cols-3 gap-2.5">
                {/* Fold */}
                <button
                  onClick={() => onTakeAction('fold')}
                  className="py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black uppercase tracking-widest border-b-4 border-slate-950 transition active:scale-95 shadow"
                >
                  No Voy (Fold)
                </button>

                {/* Check / Call */}
                {canCheck ? (
                  <button
                    onClick={() => onTakeAction('check')}
                    className="py-3 bg-slate-800 hover:bg-slate-705 text-white rounded-xl text-xs font-black uppercase tracking-widest border-b-4 border-slate-950 transition active:scale-95 shadow"
                  >
                    Pasar (Check)
                  </button>
                ) : (
                  <button
                    onClick={() => onTakeAction('call')}
                    className="py-3 bg-blue-705 bg-blue-700 hover:bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-widest border-b-4 border-blue-900 transition active:scale-95 shadow relative"
                  >
                    Ver ({needsToCall} 🪙)
                    {needsToCall >= player.chips && (
                      <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 bg-red-600 text-[8px] px-1 rounded shadow font-bold">ALL-IN</span>
                    )}
                  </button>
                )}

                {/* Raise option toggle */}
                <button
                  disabled={player.chips <= needsToCall}
                  onClick={() => onTakeAction('raise', raiseValue)}
                  className={`py-3 rounded-xl text-xs font-black uppercase tracking-widest transition active:scale-95 shadow border-0 ${
                    player.chips <= needsToCall
                      ? 'bg-[#151a18] text-slate-600 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white border-b-4 border-emerald-800'
                  }`}
                >
                  Subir a {raiseValue}
                </button>
              </div>

              {/* Raise sizing slider controls (only if capable of raising) */}
              {player.chips > needsToCall && (
                <div className="bg-black/60 border border-white/5 rounded-xl p-3 space-y-3">
                  <div className="flex justify-between items-center text-xs text-slate-350">
                    <span className="flex items-center gap-1">
                      <Flame size={12} className="text-orange-500 animate-pulse" /> Sintonizar Subida:
                    </span>
                    <span className="text-yellow-400 font-bold font-mono">
                      {raiseValue} 🪙 {raiseValue >= maxPossibleRaise ? '(ALL-IN)' : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-500 font-bold font-mono">{minPossibleRaise}</span>
                    <input
                      type="range"
                      min={minPossibleRaise}
                      max={maxPossibleRaise}
                      step={Math.max(1, smallBlind)}
                      value={raiseValue}
                      onChange={(e) => setRaiseValue(parseInt(e.target.value))}
                      className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <span className="text-[10px] text-slate-500 font-bold font-mono">{maxPossibleRaise}</span>
                  </div>

                  {/* Sizing Shortcuts */}
                  <div className="flex flex-wrap items-center gap-2 justify-center pt-2.5 border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => handleQuickBetShortcut(2, 'bb')}
                      className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-[10px] text-slate-300 border border-white/5 font-extrabold rounded-lg"
                    >
                      Min (2BB)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickBetShortcut(3, 'bb')}
                      className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-[10px] text-slate-300 border border-white/5 font-extrabold rounded-lg"
                    >
                      3BB
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickBetShortcut(4, 'bb')}
                      className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-[10px] text-slate-300 border border-white/5 font-extrabold rounded-lg"
                    >
                      4BB
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickBetShortcut(0.5, 'pot')}
                      className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-[10px] text-amber-400 border border-amber-500/10 font-extrabold rounded-lg"
                    >
                      1/2 POZO
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickBetShortcut(1, 'pot')}
                      className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-[10px] text-amber-400 border border-amber-500/10 font-extrabold rounded-lg"
                    >
                      POZO
                    </button>
                    <button
                      type="button"
                      onClick={() => setRaiseValue(maxPossibleRaise)}
                      className="px-2.5 py-1 bg-red-955/15 hover:bg-red-500/30 text-[10px] text-red-400 font-black border border-red-500/20 rounded-lg flex items-center gap-0.5"
                    >
                      All-In 🔥
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            // Facing an opponent's turn, display a beautiful glass-morphic waitbar
            <div className="flex flex-col sm:flex-row justify-between items-center text-xs text-slate-400 py-2 gap-2 select-none">
              <span className="flex items-center gap-2 font-semibold">
                <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                Esperando acción de:{' '}
                <span className="font-bold text-white uppercase text-xs">
                  {players[currentPlayerId!] ? players[currentPlayerId!].name : 'Oponente'}
                </span>
              </span>

              {/* Exit/Sit controls */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 bg-white/5 border border-white/5 px-2.5 py-1 rounded-lg font-bold font-mono">
                  Tienes: <span className="text-amber-400 font-black">{player.chips} 🪙</span>
                </span>
                <button
                  onClick={onStandUp}
                  className="px-2.5 py-1 bg-black/60 hover:bg-black/90 text-[10px] font-bold text-red-400 border border-white/10 rounded-lg flex items-center gap-1 transition animate-none"
                >
                  <LogOut size={11} /> Levantarse de mesa
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5. Spectator instructions overlay if they are inside the room but not sitting */}
      {!isSitting && (
        <div className="flex flex-col sm:flex-row items-center justify-between text-xs p-1.5 gap-3">
          <div className="text-center sm:text-left">
            <span className="font-bold text-slate-100 block">Modo Espectador</span>
            <p className="text-[10px] text-slate-400 mt-0.5">Estás observando el juego en vivo. Elige un asiento libre en la mesa para unirte a la acción!</p>
          </div>
          <div className="text-[11px] font-black text-amber-400 font-mono tracking-wider bg-white/5 px-2.5 py-1 rounded border border-white/10 uppercase">
            Disfrutando con Amigos
          </div>
        </div>
      )}
    </div>
  );
}
