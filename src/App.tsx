/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Copy, Check, Users, MessageSquare, LogOut, Code, Sparkles, HelpCircle } from 'lucide-react';

import { RoomState, ChatMessage, ClientMessage, ServerMessage, Player } from './types';
import PokerTable from './components/PokerTable';
import ControlPanel from './components/ControlPanel';
import ChatPanel from './components/ChatPanel';
import LobbyPanel from './components/LobbyPanel';

import {
  playDealCard,
  playChipClink,
  playCheckKnock,
  playFoldSigh,
  playWinnerFanfare
} from './utils/audio';

export default function App() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [username, setUsername] = useState<string>('');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [showHowToPlay, setShowHowToPlay] = useState<boolean>(false);

  const prevStateRef = useRef<RoomState | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Failsafe auto-connecting WebSocket loop
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const connectWS = () => {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        console.log('Multiplayer WS Channel connected.');
        setErrorMsg(null);
      };

      ws.onmessage = (event) => {
        try {
          const rawMessage = JSON.parse(event.data) as ServerMessage;

          switch (rawMessage.type) {
            case 'welcome':
              setPlayerId(rawMessage.payload.playerId);
              break;

            case 'state_update': {
              const nextState = rawMessage.payload.state;
              const prev = prevStateRef.current;

              // Play synthesized sounds on structural poker changes
              if (prev) {
                // 1. New card dealt to board or hands
                if (
                  (nextState.communityCards.length !== prev.communityCards.length) ||
                  (nextState.phase !== prev.phase && nextState.phase !== 'SHOWDOWN')
                ) {
                  playDealCard();
                }

                // 2. Pot size increases (chips added)
                if (nextState.pot > prev.pot) {
                  playChipClink();
                }

                // 3. Check / fold sound triggers by comparing sitting player actions
                for (const pid in nextState.players) {
                  const pPrev = prev.players[pid];
                  const pNext = nextState.players[pid];
                  if (pNext && (!pPrev || pNext.lastAction !== pPrev.lastAction)) {
                    if (pNext.lastAction === 'Paso') {
                      playCheckKnock();
                    } else if (pNext.lastAction === 'No voy') {
                      playFoldSigh();
                    } else if (pNext.lastAction.includes('Iguala') || pNext.lastAction.includes('Ciega') || pNext.lastAction.includes('sube')) {
                      playChipClink();
                    }
                  }
                }

                // 4. Showdown fanfare
                if (nextState.phase === 'SHOWDOWN' && prev.phase !== 'SHOWDOWN') {
                  playWinnerFanfare();
                }
              }

              prevStateRef.current = nextState;
              setRoomState(nextState);
              break;
            }

            case 'chat_message':
              setChatMessages((prev) => [...prev, rawMessage.payload]);
              break;

            case 'error':
              if (rawMessage.payload.message !== 'pong') {
                setErrorMsg(rawMessage.payload.message);
                // Clear error automatically after 6 seconds
                setTimeout(() => setErrorMsg(null), 6000);
              }
              break;
          }
        } catch (err) {
          console.error('Error receiving multiplayer socket payload:', err);
        }
      };

      ws.onclose = () => {
        console.warn('WS Channel disconnected. Scheduling retry...');
        // Retry connection in 3 seconds
        setTimeout(connectWS, 3000);
      };

      setSocket(ws);
    };

    connectWS();

    // Setup an interval to ping the server to keep the Cloud Run socket warm
    const pingInterval = setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    return () => {
      clearInterval(pingInterval);
      socketRef.current?.close();
    };
  }, []);

  // Action emitters
  const emitMessage = (msg: ClientMessage) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  };

  const handleCreateRoom = (name: string, sb: number, timer: number) => {
    setUsername(name);
    emitMessage({
      type: 'create_room',
      payload: { name, smallBlind: sb, turnTimeout: timer }
    });
  };

  const handleJoinRoom = (name: string, code: string) => {
    setUsername(name);
    emitMessage({
      type: 'join_room',
      payload: { name, roomCode: code }
    });
  };

  const handleSitDown = (seatIndex: number, buyIn: number) => {
    emitMessage({
      type: 'sit_down',
      payload: { seatIndex, buyIn }
    });
  };

  const handleStandUp = () => {
    emitMessage({
      type: 'stand_up'
    });
  };

  const handleSendMessage = (text: string) => {
    emitMessage({
      type: 'send_chat',
      payload: { text }
    });
  };

  const handleStartGame = () => {
    emitMessage({
      type: 'start_game'
    });
  };

  const handleAction = (type: 'check' | 'call' | 'raise' | 'fold', amount?: number) => {
    emitMessage({
      type: 'action',
      payload: { actionType: type, amount }
    });
  };

  const handleRebuy = () => {
    emitMessage({
      type: 'rebuy'
    });
  };

  const handleCopyRoomCode = () => {
    if (!roomState) return;
    navigator.clipboard.writeText(roomState.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleQuitRoom = () => {
    // Refreshing page is the cleanest way to clear ClientRooms mapping and reset state
    window.location.reload();
  };

  // Prepare active players countdown stats for spectators
  const countConnectedPlayers = roomState 
    ? (Object.values(roomState.players) as Player[]).filter(p => p.isConnected).length 
    : 0;

  return (
    <div className="min-h-screen bg-[#0a0f0d] text-slate-100 flex flex-col relative font-sans">
      
      {/* Dynamic Ambient Background Sparkles */}
      <div className="absolute inset-x-0 top-0 h-[300px] bg-gradient-to-b from-emerald-950/20 to-transparent pointer-events-none select-none blur-3xl" />

      {/* Primary Header */}
      <header className="h-16 px-6 bg-black/40 border-b border-white/10 backdrop-blur-md flex items-center justify-between z-10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center border border-white/20 text-white font-bold text-lg shadow-md shadow-emerald-555/10 select-none">
            ♠
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-wider uppercase text-emerald-400">
              Viernes de Poker • <span className="text-slate-400 font-normal">Privado</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-wider">
              {roomState ? `SALA ID: #${roomState.code}` : "MESAS DE JUEGO"}
            </p>
          </div>
        </div>

        {roomState && (
          <div className="hidden md:flex items-center gap-3">
            <div className="text-center pr-4 border-r border-white/10">
              <p className="text-[9px] uppercase text-slate-500 tracking-widest leading-none">Bote de Juego</p>
              <p className="text-lg font-black text-amber-400 font-mono mt-0.5">{roomState.pot} 🪙</p>
            </div>
            <div className="text-center">
              <p className="text-[9px] uppercase text-slate-500 tracking-widest leading-none">Apuesta Máxima</p>
              <p className="text-sm font-bold text-slate-100 font-mono mt-0.5">{roomState.currentBet || '--'}</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowHowToPlay(!showHowToPlay)}
            className="p-2 hover:bg-white/5 text-slate-400 hover:text-slate-250 border border-transparent hover:border-white/10 rounded-lg transition"
            title="Cómo jugar"
          >
            <HelpCircle size={18} />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 overflow-hidden p-3 md:p-6 flex items-center justify-center relative">
        <AnimatePresence mode="wait">
          {!roomState ? (
            // Landing Lobby
            <motion.div
              key="lobby"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <LobbyPanel
                onCreateRoom={handleCreateRoom}
                onJoinRoom={handleJoinRoom}
                errorMsg={errorMsg}
              />
            </motion.div>
          ) : (
            // Full-fidelity game room
            <motion.div
              key="game"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-7xl h-full flex flex-col lg:flex-row gap-5 items-stretch"
            >
              {/* Left Column: Outer felt desk and action console */}
              <div className="flex-1 flex flex-col gap-4">
                
                {/* Visual statistics ribbon above table */}
                <div className="flex flex-wrap items-center justify-between py-1.5 bg-white/5 border border-white/10 rounded-xl px-4 gap-3 text-xs">
                  
                  {/* Code and Copy action */}
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 uppercase tracking-wider font-extrabold text-[10px]">CÓDIGO DE SALA:</span>
                    <button
                      onClick={handleCopyRoomCode}
                      className="px-2.5 py-1 bg-black/60 hover:bg-black/95 active:scale-95 border border-white/10 rounded-lg text-yellow-400 font-black font-mono flex items-center gap-1.5 transition text-xs shadow-sm"
                    >
                      {roomState.code}
                      {copiedCode ? <Check size={12} className="text-emerald-500" /> : <Copy size={11} className="text-slate-400" />}
                    </button>
                  </div>

                  {/* Room status counters */}
                  <div className="flex items-center gap-4 text-slate-355">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Users size={14} className="text-emerald-500" />
                      Auditoria: <span className="font-bold text-emerald-400 font-mono">{countConnectedPlayers} amigos</span>
                    </span>
                    <span className="h-4 w-[1px] bg-white/10" />
                    <span className="text-[11px] font-medium text-slate-300">
                      Ciegas: <span className="text-amber-400 font-bold font-mono">{roomState.smallBlind} / {roomState.bigBlind}</span>
                    </span>
                  </div>

                  {/* Exit Lobby button */}
                  <button
                    onClick={handleQuitRoom}
                    className="text-[10px] uppercase font-bold tracking-wider text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
                  >
                    <LogOut size={12} /> Salir de Sala
                  </button>
                </div>

                {/* The visual green felt table */}
                <div className="flex-1 flex items-center justify-center">
                  <PokerTable
                    roomState={roomState}
                    selfPlayerId={playerId}
                    onSitDown={handleSitDown}
                    onStandUp={handleStandUp}
                  />
                </div>

                {/* Hand Action Dashboard */}
                <ControlPanel
                  roomState={roomState}
                  selfPlayerId={playerId}
                  onTakeAction={handleAction}
                  onStartGame={handleStartGame}
                  onRebuy={handleRebuy}
                  onStandUp={handleStandUp}
                />
              </div>

              {/* Right Column: Groups chats and dealer feed */}
              <div className="w-full lg:w-[320px] shrink-0 flex flex-col h-[280px] lg:h-auto">
                <ChatPanel
                  messages={chatMessages}
                  onSendMessage={handleSendMessage}
                  playerName={username}
                />
              </div>

            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sliding How-To-Play Guide Modal Overlay */}
      <AnimatePresence>
        {showHowToPlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl max-w-lg w-full shadow-2xl relative space-y-4"
            >
              <h3 className="text-lg font-extrabold text-yellow-405 text-amber-400 uppercase tracking-widest flex items-center gap-2">
                ♦️ Guía Práctica de Texas Hold'em
              </h3>
              
              <div className="text-xs text-slate-350 space-y-3 leading-relaxed max-h-[300px] overflow-y-auto pr-1">
                <p>
                  <strong>1. El Objetivo:</strong> Formar la mejor combinación posible de 5 cartas combinando tus 2 cartas privadas (mano) con las 5 cartas comunitarias del centro.
                </p>
                <p>
                  <strong>2. El Juego Privado:</strong> Invita a tus amigos compartiendo el código de sala de 4 letras. Puedes chatear, sentarte en cualquiera de las 8 posiciones disponibles y comenzar la partida en cuanto se sumen 2 jugadores.
                </p>
                <p>
                  <strong>3. Las Apuestas:</strong> En tu turno puedes elegir:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Pasar (Check):</strong> Continuar el juego sin apostar más de lo actual (solo si nadie ha subido antes).</li>
                  <li><strong>Igualar (Call):</strong> Igualar la apuesta máxima de la mesa.</li>
                  <li><strong>Subir (Raise):</strong> Incrementar el valor de la apuesta para forzar a otros a igualar o retirarse.</li>
                  <li><strong>No Voy (Fold):</strong> Retirarte de la mano actual y perder lo apostado.</li>
                </ul>
                <p>
                  <strong>4. All-In & Pozo de Descarte:</strong> Si te quedas sin fichas para igualar, vas automaticente "All-In". El motor del servidor calcula los pozos laterales de descarte de manera automática, garantizando la justicia del juego.
                </p>
                <p>
                  <strong>5. Recompras (Rebuys):</strong> Si pierdes todas tus fichas, puedes hacer clic instantáneo en "Hacer Recompra" para recargar 1000 fichas y continuar la diversión.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowHowToPlay(false)}
                  className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-slate-950 text-xs font-bold rounded-lg transition"
                >
                  Cerrar Guía
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
