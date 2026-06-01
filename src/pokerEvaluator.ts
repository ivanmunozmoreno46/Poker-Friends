import { Card } from './types';

// Card rank to numeric value mapping
const CARD_VALUES: { [key: string]: number } = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const HAND_RANKINGS = {
  ROYAL_FLUSH: 9,
  STRAIGHT_FLUSH: 8,
  FOUR_OF_A_KIND: 7,
  FULL_HOUSE: 6,
  FLUSH: 5,
  STRAIGHT: 4,
  THREE_OF_A_KIND: 3,
  TWO_PAIR: 2,
  ONE_PAIR: 1,
  HIGH_CARD: 0
};

export interface HandEvaluation {
  rank: number; // 0 to 9
  tieBreakers: number[]; // Numeric values for comparison
  description: string; // Human-readable poker hand phrase
  cards: Card[]; // The chosen 5 card combination
}

// Full 5-card evaluator
export function evaluate5CardHand(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) {
    throw new Error('Must evaluate exactly 5 cards');
  }

  // Pre-calculate frequencies
  const values = cards.map(c => CARD_VALUES[c.value]).sort((a, b) => b - a);
  const valueCounts: { [val: number]: number } = {};
  values.forEach(v => { valueCounts[v] = (valueCounts[v] || 0) + 1; });

  const suits = cards.map(c => c.suit);
  const suitCounts: { [suit: string]: number } = {};
  suits.forEach(s => { suitCounts[s] = (suitCounts[s] || 0) + 1; });

  // Check characteristics
  const isFlush = Object.values(suitCounts).some(count => count === 5);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;
  
  // Unique values sorted descending
  const uniqueVals = Array.from(new Set(values)).sort((a, b) => b - a);
  if (uniqueVals.length === 5) {
    if (uniqueVals[0] - uniqueVals[4] === 4) {
      isStraight = true;
      straightHigh = uniqueVals[0];
    } else if (
      uniqueVals[0] === 14 && // Ace
      uniqueVals[1] === 5 &&
      uniqueVals[2] === 4 &&
      uniqueVals[3] === 3 &&
      uniqueVals[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5; // A-5-4-3-2 straight, 5 is the high card
    }
  }

  // Value frequency arrays
  const occurrences = Object.entries(valueCounts).map(([val, count]) => ({
    val: parseInt(val),
    count
  })).sort((a, b) => b.count - a.count || b.val - a.val);

  // 1. Straight Flush / Royal Flush
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return {
        rank: HAND_RANKINGS.ROYAL_FLUSH,
        tieBreakers: [14],
        description: 'Royal Flush',
        cards
      };
    }
    return {
      rank: HAND_RANKINGS.STRAIGHT_FLUSH,
      tieBreakers: [straightHigh],
      description: `Straight Flush (${getCardLabel(straightHigh)} High)`,
      cards
    };
  }

  // 2. Four of a kind
  if (occurrences[0].count === 4) {
    return {
      rank: HAND_RANKINGS.FOUR_OF_A_KIND,
      tieBreakers: [occurrences[0].val, occurrences[1].val],
      description: `Póker de ${getPluralLabel(occurrences[0].val)}`,
      cards
    };
  }

  // 3. Full House
  if (occurrences[0].count === 3 && occurrences[1].count >= 2) {
    return {
      rank: HAND_RANKINGS.FULL_HOUSE,
      tieBreakers: [occurrences[0].val, occurrences[1].val],
      description: `Full House (${getPluralLabel(occurrences[0].val)} con ${getPluralLabel(occurrences[1].val)})`,
      cards
    };
  }

  // 4. Flush
  if (isFlush) {
    return {
      rank: HAND_RANKINGS.FLUSH,
      tieBreakers: values,
      description: `Color de ${getCardLabel(values[0])} alto`,
      cards
    };
  }

  // 5. Straight
  if (isStraight) {
    return {
      rank: HAND_RANKINGS.STRAIGHT,
      tieBreakers: [straightHigh],
      description: `Escalera al ${getCardLabel(straightHigh)}`,
      cards
    };
  }

  // 6. Three of a kind
  if (occurrences[0].count === 3) {
    return {
      rank: HAND_RANKINGS.THREE_OF_A_KIND,
      tieBreakers: [occurrences[0].val, occurrences[1].val, occurrences[2].val],
      description: `Trio de ${getPluralLabel(occurrences[0].val)}`,
      cards
    };
  }

  // 7. Two Pair
  if (occurrences[0].count === 2 && occurrences[1].count === 2) {
    return {
      rank: HAND_RANKINGS.TWO_PAIR,
      tieBreakers: [occurrences[0].val, occurrences[1].val, occurrences[2].val],
      description: `Doble Pareja de ${getPluralLabel(occurrences[0].val)} y ${getPluralLabel(occurrences[1].val)}`,
      cards
    };
  }

  // 8. One Pair
  if (occurrences[0].count === 2) {
    return {
      rank: HAND_RANKINGS.ONE_PAIR,
      tieBreakers: [occurrences[0].val, ...values.filter(v => v !== occurrences[0].val)],
      description: `Pareja de ${getPluralLabel(occurrences[0].val)}`,
      cards
    };
  }

  // 9. High Card
  return {
    rank: HAND_RANKINGS.HIGH_CARD,
    tieBreakers: values,
    description: `Carta Alta ${getCardLabel(values[0])}`,
    cards
  };
}

// Generate all combinations of k items from array
function getCombinations<T>(array: T[], k: number): T[][] {
  const result: T[][] = [];
  function fork(index: number, current: T[]) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    if (index >= array.length) return;
    // Include
    current.push(array[index]);
    fork(index + 1, current);
    current.pop();
    // Exclude
    fork(index + 1, current);
  }
  fork(0, []);
  return result;
}

// 7-card evaluator - evaluates combinations and finds the best 5 card hand
export function evaluate7CardHand(handCards: Card[], communityCards: Card[]): HandEvaluation {
  const allCards = [...handCards, ...communityCards];
  if (allCards.length < 5) {
    // Insufficient cards (pre-flop, flop, etc.) - evaluate best high cards or whatever
    const safeCards = allCards.slice(0, 5);
    while (safeCards.length < 5) {
      safeCards.push({ suit: 'S', value: '2' }); // Placeholder
    }
    return evaluate5CardHand(safeCards);
  }

  const combinations = getCombinations(allCards, 5);
  let bestHand: HandEvaluation | null = null;

  for (const combo of combinations) {
    const handEval = evaluate5CardHand(combo);
    if (!bestHand) {
      bestHand = handEval;
    } else {
      // Compare hands
      if (compareEvaluations(handEval, bestHand) > 0) {
        bestHand = handEval;
      }
    }
  }

  return bestHand!;
}

// Compare two hand evaluations (returns >0 if a is stronger, <0 if b is stronger, 0 if equal)
export function compareEvaluations(a: HandEvaluation, b: HandEvaluation): number {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }
  for (let i = 0; i < Math.max(a.tieBreakers.length, b.tieBreakers.length); i++) {
    const valA = a.tieBreakers[i] || 0;
    const valB = b.tieBreakers[i] || 0;
    if (valA !== valB) {
      return valA - valB;
    }
  }
  return 0;
}

function getCardLabel(numericVal: number): string {
  const labels: { [key: number]: string } = {
    14: 'As', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7',
    6: '6', 5: '5', 4: '4', 3: '3', 2: '2'
  };
  return labels[numericVal] || numericVal.toString();
}

function getPluralLabel(numericVal: number): string {
  const label = getCardLabel(numericVal);
  if (label === 'As') return 'Ases';
  if (label === 'K') return 'Reyes';
  if (label === 'Q') return 'Reinas';
  if (label === 'J') return 'Jotas';
  if (label === '10') return 'Decas';
  return label + 's';
}
