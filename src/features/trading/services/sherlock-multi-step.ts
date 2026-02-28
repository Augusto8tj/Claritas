// src/features/trading/services/sherlock-multi-step.ts
'use client';
import type { TickData } from '@/lib/types';

export interface BlockProbs {
    even: number;
    odd: number;
    above4: number;
    below5: number;
}

function getLastDigit(price: number, decimalPlaces: number): number {
  if (isNaN(price) || !Number.isFinite(price)) return 0;
  const priceString = price.toFixed(decimalPlaces);
  return parseInt(priceString.slice(-1), 10);
};

export function buildTransitionMatrix(ticks: TickData[], decimalPlaces: number): { transitionMatrix: number[][], lastDigit: number } {
    const matrix = Array(10).fill(0).map(() => Array(10).fill(0));
    const totals = Array(10).fill(0);
    
    for (let i = 1; i < ticks.length; i++) {
        const prevTick = ticks[i - 1];
        const currTick = ticks[i];
        if (!prevTick || !currTick) continue;

        const prevDigit = getLastDigit(prevTick.price, decimalPlaces);
        const currDigit = getLastDigit(currTick.price, decimalPlaces);
        
        matrix[prevDigit][currDigit]++;
        totals[prevDigit]++;
    }
    
    // Normalize to probabilities
    for (let i = 0; i < 10; i++) {
        if (totals[i] > 0) {
            for (let j = 0; j < 10; j++) {
                matrix[i][j] /= totals[i];
            }
        } else {
             // If no data, assume uniform distribution
             for (let j = 0; j < 10; j++) {
                matrix[i][j] = 0.1;
            }
        }
    }
    
    const lastTick = ticks[ticks.length - 1];
    return {
        transitionMatrix: matrix,
        lastDigit: lastTick ? getLastDigit(lastTick.price, decimalPlaces) : 0,
    };
}

function matrixMultiply(A: number[], B: number[][]): number[] {
    const result = new Array(10).fill(0);
    for (let j = 0; j < 10; j++) { // for each column in B
        let sum = 0;
        for (let i = 0; i < 10; i++) { // for each row in A (which is a vector)
            sum += A[i] * B[i][j];
        }
        result[j] = sum;
    }
    return result;
}


export function predictNTicksAhead(
  lastDigit: number,
  transitionMatrix: number[][],
  steps: number = 1
): { digitProbs: number[], blockProbs: BlockProbs } {
  
  let currentProbs = new Array(10).fill(0);
  currentProbs[lastDigit] = 1.0;
  
  for (let step = 0; step < steps; step++) {
    currentProbs = matrixMultiply(currentProbs, transitionMatrix);
  }
  
  const blockProbs: BlockProbs = {
    even: 0,
    odd: 0,
    above4: 0,
    below5: 0,
  };

  for(let i=0; i<10; i++) {
    const prob = currentProbs[i];
    if (i % 2 === 0) blockProbs.even += prob;
    else blockProbs.odd += prob;

    if (i > 4) blockProbs.above4 += prob;
    else if (i < 5) blockProbs.below5 += prob;
  }
  
  return { digitProbs: currentProbs, blockProbs };
}
