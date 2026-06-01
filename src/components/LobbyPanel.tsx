import React, { useState } from 'react';
import { motion } from 'motion/react';
import { PlusCircle, ArrowRight, User, Settings, ShieldAlert, Club } from 'lucide-react';

interface LobbyPanelProps {
  onCreateRoom: (name: string, sb: number, timer: number) => void;
  onJoinRoom: (name: string, code: string) => void;
  errorMsg: string | null;
}

export default function LobbyPanel({ onCreateRoom, onJoinRoom, errorMsg }: LobbyPanelProps) {
  const [name, setName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [smallBlind, setSmallBlind] = useState(10);
  const [turnTimeout, setTurnTimeout] = useState(30);
  const [activeTab, setActiveTab] = useState<'invite' | 'create'>('invite');

  const randomPlaceholderName = () => {
    const pokerAdjectives = ['Farol', 'As', 'Dealer', 'Tiburón', 'AllIn', 'FullHouse'];
    const randomAdjective = pokerAdjectives[Math.floor(Math.random() * pokerAdjectives.length)];
    const randomNum = Math.floor(100 + Math.random() * 900);
    return `${randomAdjective}_${randomNum}`;
  };

  const getCleanName = () => {
    return name.trim() || randomPlaceholderName();
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateRoom(getCleanName(), smallBlind, turnTimeout);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCodeInput.trim()) return;
    onJoinRoom(getCleanName(), roomCodeInput.toUpperCase().trim());
  };
  return (
    <div className="w-full max-w-md bg-black/60 border border-white/10 rounded-3xl p-6 md:p-8 shadow-2xl relative overflow-hidden font-sans">
      
      {/* Decorative vector background card shapes */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-44 h-44 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Brand logo banner */}
      <div className="flex flex-col items-center text-center space-y-2 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-emerald-600 flex items-center justify-center text-white border border-white/20 shadow-lg shadow-emerald-500/20">
          <Club size={35} className="fill-current rotate-12 text-white" />
        </div>
        <h1 className="text-2xl font-black text-slate-100 uppercase tracking-widest leading-none">
          Royal Hold'em <span className="text-emerald-400 font-bold block text-xs mt-1.5 tracking-wider">SALAS PRIVADAS EN LÍNEA</span>
        </h1>
        <p className="text-xs text-slate-400 max-w-[280px]">Disfruta de una partida clásica con amigos en línea sin complicaciones.</p>
      </div>

      {errorMsg && (
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="mb-5 p-3 rounded-xl bg-red-950/30 border border-red-500/20 flex items-start gap-2 text-red-400"
        >
          <ShieldAlert size={16} className="shrink-0 mt-0.5" />
          <span className="text-xs leading-relaxed">{errorMsg}</span>
        </motion.div>
      )}

      {/* Onboarding fields */}
      <div className="space-y-5">
        
        {/* Name input */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <User size={12} className="text-emerald-450" /> Tu Apodo (Nick):
          </label>
          <input
            type="text"
            maxLength={12}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Manuel_Ases, Farolero..."
            className="w-full bg-black/60 border border-white/10 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm text-slate-100 outline-none transition placeholder-slate-705 text-white"
          />
        </div>

        {/* Navigation Selector */}
        <div className="flex border-b border-white/5 p-1 bg-black/80 rounded-2xl">
          <button
            type="button"
            onClick={() => setActiveTab('invite')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'invite'
                ? 'bg-white/10 border border-white/10 text-amber-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Unirse por Código
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all ${
              activeTab === 'create'
                ? 'bg-white/10 border border-white/10 text-amber-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Crear Sala Nueva
          </button>
        </div>

        {/* Tab 1: Join Game */}
        {activeTab === 'invite' && (
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block text-center">Código de la Sala:</label>
              <input
                type="text"
                autoFocus
                maxLength={4}
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                placeholder="Ej. ABCD"
                className="w-full bg-black/60 border border-white/10 focus:border-emerald-500 text-center uppercase text-xl font-black font-mono tracking-[0.25em] rounded-xl py-3 text-emerald-400 outline-none transition placeholder-slate-800"
              />
            </div>
            
            <button
              type="submit"
              disabled={!roomCodeInput.trim()}
              className={`w-full py-3.5 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition border-0 ${
                roomCodeInput.trim()
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-b-4 border-emerald-800 shadow-lg active:scale-[0.98]'
                  : 'bg-white/5 text-slate-500 cursor-not-allowed border-b-4 border-slate-950/20'
              }`}
            >
              Unirse a la Mesa <ArrowRight size={14} />
            </button>
          </form>
        )}

        {/* Tab 2: Create Game parameters */}
        {activeTab === 'create' && (
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3.5">
              
              {/* SB selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <Settings size={11} className="text-emerald-500" /> Ciega Chica:
                </label>
                <select
                  value={smallBlind}
                  onChange={(e) => setSmallBlind(parseInt(e.target.value))}
                  className="w-full bg-black/60 border border-white/10 focus:border-emerald-500 rounded-xl px-2.5 py-3 text-xs text-slate-100 outline-none font-mono"
                >
                  <option value={5}>5 🪙 (Cg: 10)</option>
                  <option value={10}>10 🪙 (Cg: 20)</option>
                  <option value={20}>20 🪙 (Cg: 40)</option>
                  <option value={50}>50 🪙 (Cg: 100)</option>
                  <option value={100}>100 🪙 (Cg: 200)</option>
                </select>
              </div>

              {/* Timeout selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <Settings size={11} className="text-emerald-400" /> Turno (s):
                </label>
                <select
                  value={turnTimeout}
                  onChange={(e) => setTurnTimeout(parseInt(e.target.value))}
                  className="w-full bg-black/60 border border-white/10 focus:border-emerald-500 rounded-xl px-2.5 py-3 text-xs text-slate-100 outline-none font-mono"
                >
                  <option value={20}>20 segundos</option>
                  <option value={30}>30 segundos</option>
                  <option value={45}>45 segundos</option>
                  <option value={60}>60 segundos</option>
                </select>
              </div>

            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-1.5 transition active:scale-[0.98] border-0 border-b-4 border-emerald-800 shadow-lg"
            >
              Crear Nueva Sala <PlusCircle size={14} />
            </button>
          </form>
        )}

      </div>
    </div>
  );
}
