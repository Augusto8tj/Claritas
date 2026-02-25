// src/features/trading/services/repetition-detector.ts
'use client';

import type { TickData } from '@/lib/types';
import type { RepetitionSequence } from '../types/repetition-trigger';

/**
 * Extrai o último dígito de um preço
 */
export function getLastDigit(price: number, decimalPlaces: number): number {
  const priceStr = price.toFixed(decimalPlaces);
  return parseInt(priceStr.slice(-1), 10);
}

/**
 * Detecta sequências de dígitos repetidos consecutivamente
 * 
 * Retorna null se não houver sequência, ou o objeto RepetitionSequence
 */
export function detectRepetitionSequence(
  ticks: TickData[],
  decimalPlaces: number,
  minLength: number = 2,
  maxLength: number = 10
): RepetitionSequence | null {
  
  if (ticks.length < minLength) return null;
  
  const lastTick = ticks[ticks.length - 1];
  const lastDigit = getLastDigit(lastTick.price, decimalPlaces);
  
  // Conta quantos ticks consecutivos têm o mesmo dígito
  let sequenceLength = 1;
  const sequenceTicks: number[] = [lastDigit];
  let startIdx = ticks.length - 1;
  
  for (let i = ticks.length - 2; i >= 0 && sequenceLength < maxLength; i--) {
    const digit = getLastDigit(ticks[i].price, decimalPlaces);
    
    if (digit === lastDigit) {
      sequenceLength++;
      sequenceTicks.unshift(digit);
      startIdx = i;
    } else {
      break;
    }
  }
  
  // Verifica se atingiu o threshold mínimo
  if (sequenceLength < minLength) {
    return null;
  }
  
  return {
    digit: lastDigit,
    length: sequenceLength,
    startEpoch: ticks[startIdx].epoch,
    lastEpoch: lastTick.epoch,
    ticks: sequenceTicks,
  };
}

/**
 * Verifica se uma sequência ainda é válida (não expirou)
 */
export function isSequenceValid(
  sequence: RepetitionSequence,
  currentEpoch: number,
  maxWaitTime: number
): boolean {
  const elapsed = (currentEpoch - sequence.lastEpoch) * 1000; // Convert to ms
  return elapsed <= maxWaitTime;
}

/**
 * Calcula estatísticas de todas as sequências em uma janela
 */
export function analyzeSequencePatterns(
  ticks: TickData[],
  decimalPlaces: number,
  windowSize: number = 100
): {
  totalSequences: number;
  sequencesByDigit: Record<number, number>;
  sequencesByLength: Record<number, number>;
  avgSequenceLength: number;
  maxSequenceLength: number;
} {
  
  const sequencesByDigit: Record<number, number> = {};
  const sequencesByLength: Record<number, number> = {};
  let totalSequences = 0;
  let totalLength = 0;
  let maxLength = 0;
  
  const windowTicks = ticks.slice(-windowSize);
  
  let i = 1;
  while (i < windowTicks.length) {
    const prevDigit = getLastDigit(windowTicks[i - 1].price, decimalPlaces);
    const currDigit = getLastDigit(windowTicks[i].price, decimalPlaces);
    
    if (prevDigit === currDigit) {
      // Início de sequência
      let length = 2;
      let j = i + 1;
      
      while (j < windowTicks.length) {
        const nextDigit = getLastDigit(windowTicks[j].price, decimalPlaces);
        if (nextDigit === currDigit) {
          length++;
          j++;
        } else {
          break;
        }
      }
      
      // Registra estatísticas
      totalSequences++;
      sequencesByDigit[currDigit] = (sequencesByDigit[currDigit] || 0) + 1;
      sequencesByLength[length] = (sequencesByLength[length] || 0) + 1;
      totalLength += length;
      maxLength = Math.max(maxLength, length);
      
      i = j; // Pula para o fim da sequência
    } else {
      i++;
    }
  }
  
  return {
    totalSequences,
    sequencesByDigit,
    sequencesByLength,
    avgSequenceLength: totalSequences > 0 ? totalLength / totalSequences : 0,
    maxSequenceLength: maxLength,
  };
}
