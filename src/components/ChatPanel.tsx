import React, { useState, useRef, useEffect } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  playerName: string;
}

export default function ChatPanel({ messages, onSendMessage, playerName }: ChatPanelProps) {
  const [inputText, setInputText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  // Keep chat scrolled to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-black/30 border border-white/10 rounded-2xl shadow-2xl relative overflow-hidden font-sans">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3.5 bg-white/5 border-b border-white/10 text-slate-100">
        <MessageSquare size={16} className="text-emerald-400" />
        <h3 className="font-bold text-xs tracking-wider uppercase text-slate-300">Chat de Grupo</h3>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-transparent">
        {messages.map((msg, index) => {
          if (msg.isSystem) {
            return (
              <div
                key={msg.id || index}
                className="text-center py-1.5 px-3 rounded-lg bg-white/5 border border-white/5 text-[10px] text-slate-400 font-medium tracking-wide uppercase font-mono"
              >
                {msg.text}
              </div>
            );
          }

          const isSelf = msg.sender === playerName;

          return (
            <div
              key={msg.id || index}
              className={`flex flex-col max-w-[85%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
            >
              {/* Sender label */}
              <span className={`text-[10px] font-bold mb-1 px-1 ${isSelf ? 'text-emerald-400' : 'text-blue-400'}`}>
                {isSelf ? 'Tú' : msg.sender}
              </span>
              {/* Message block */}
              <div
                className={`px-3 py-2 text-xs break-words shadow-md ${
                  isSelf
                    ? 'bg-emerald-600/40 text-white rounded-l-lg rounded-br-lg border border-emerald-500/20'
                    : 'bg-white/5 text-slate-300 rounded-r-lg rounded-bl-lg border border-white/10'
                }`}
              >
                {msg.text}
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Input controls form */}
      <form onSubmit={handleSubmit} className="p-4 bg-black/40 border-t border-white/10">
        <div className="relative">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Escribe un mensaje..."
            maxLength={120}
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-3 pr-10 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 placeholder-slate-600 transition"
          />
          <button
            type="submit"
            className="absolute right-2.5 top-2.5 text-emerald-500 hover:text-emerald-400 active:scale-95 transition"
          >
            <Send size={15} />
          </button>
        </div>
      </form>
    </div>
  );
}
