import React from 'react';
import { motion } from 'motion/react';
import { Card } from '../types';

interface CardViewProps {
  key?: React.Key;
  card: Card | null; // Null represents face-down card
  isDealerCard?: boolean;
  size?: 'sm' | 'md' | 'lg';
  index?: number; // Used for staggered dealing animations
  highlight?: boolean; // Highlight cards in the winning combination
}

const suitSymbols: { [key: string]: string } = {
  H: '♥', // Hearts
  D: '♦', // Diamonds
  C: '♣', // Clubs
  S: '♠'  // Spades
};

const suitNames: { [key: string]: string } = {
  H: 'corazones',
  D: 'diamantes',
  C: 'treboles',
  S: 'picas'
};

const suitColors: { [key: string]: string } = {
  H: 'text-red-600',
  D: 'text-rose-500', 
  C: 'text-emerald-700', // Beautiful 4-color deck (poker players love this!)
  S: 'text-slate-900'
};

const sizeClasses = {
  sm: 'w-10 h-14 text-xs rounded',
  md: 'w-14 h-20 text-sm rounded-md md:w-16 md:h-24 md:text-base',
  lg: 'w-18 h-26 text-lg rounded-lg md:w-20 md:h-30 md:text-xl'
};

export default function CardView({ card, size = 'md', index = 0, highlight = false }: CardViewProps) {
  const isFaceDown = !card;

  // Dealing animation properties
  const dealVariants = {
    hidden: { scale: 0, rotationY: 180, opacity: 0, y: -50 },
    visible: { 
      scale: 1, 
      rotationY: 0, 
      opacity: 1, 
      y: 0,
      transition: { 
        type: 'spring', 
        stiffness: 120, 
        damping: 14, 
        delay: index * 0.08 
      }
    }
  };

  if (isFaceDown) {
    return (
      <motion.div
        variants={dealVariants}
        initial="hidden"
        animate="visible"
        className={`${sizeClasses[size]} shrink-0 bg-gradient-to-br from-red-800 to-red-950 border-2 border-amber-400 p-1 flex items-center justify-center shadow-md relative overflow-hidden select-none`}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Geometric card back engraving */}
        <div className="w-full h-full border border-amber-500/30 rounded flex items-center justify-center opacity-70 relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.15)_1px,transparent_1px)] bg-[size:6px_6px]" />
          <div className="w-8 h-8 rounded-full border border-amber-400/40 flex items-center justify-center">
            <span className="text-amber-400 text-sm font-semibold opacity-80">♠</span>
          </div>
        </div>
      </motion.div>
    );
  }

  const suit = card.suit;
  const value = card.value;
  const colorClass = suitColors[suit];

  return (
    <motion.div
      variants={dealVariants}
      initial="hidden"
      animate="visible"
      className={`${sizeClasses[size]} shrink-0 bg-white border-2 ${
        highlight 
          ? 'border-yellow-400 ring-4 ring-yellow-400/50 scale-105 shadow-yellow-500/20' 
          : 'border-slate-200'
      } flex flex-col justify-between p-1 md:p-1.5 shadow-md select-none relative font-sans`}
      style={{ transformStyle: 'preserve-3d' }}
      whileHover={{ y: -4, scale: 1.03 }}
    >
      {/* Top Left Indicator */}
      <div className={`flex flex-col items-center leading-none ${colorClass}`}>
        <span className="font-bold text-xs md:text-sm">{value}</span>
        <span className="text-xs md:text-sm leading-none m-0 p-0">{suitSymbols[suit]}</span>
      </div>

      {/* Large Centered Suit Graphic */}
      <div className={`text-center flex justify-center items-center leading-none ${colorClass} text-xl md:text-3xl font-normal opacity-90`}>
        {suitSymbols[suit]}
      </div>

      {/* Bottom Right Indicator (Inverted) */}
      <div className={`flex flex-col items-center leading-none self-end rotate-180 ${colorClass}`}>
        <span className="font-bold text-xs md:text-sm">{value}</span>
        <span className="text-xs md:text-sm leading-none m-0 p-0">{suitSymbols[suit]}</span>
      </div>
    </motion.div>
  );
}
