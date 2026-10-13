// /src/hooks/useAdaptiveResilience.ts
'use client';

import { useState, useCallback, useRef } from 'react';

/**
 * useAdaptiveResilience - Motor de Governança V4.0
 * Gerencia o rigor da IA e o estresse de liquidez de forma isolada.
 */

const MIN_RIGOR = 0.65;
const MAX_RIGOR = 0.85;
const LIQUIDITY_GAP_THRESHOLD_MS = 2500; // Limite de latência para considerar mercado instável

export function useAdaptiveResilience() {
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [consecutiveLosses, setConsecutiveLosses] = useState<Record<string, number>>({});
  const lastTickTimestamps = useRef<Record<string, number>>({});

  // Registra a pulsação do mercado
  const recordPulse = useCallback((symbol: string) => {
    lastTickTimestamps.current[symbol] = Date.now();
  }, []);

  // Verifica se a liquidez está saudável
  const checkStability = useCallback((symbol: string): boolean => {
    const last = lastTickTimestamps.current[symbol] || 0;
    return (Date.now() - last) < LIQUIDITY_GAP_THRESHOLD_MS;
  }, []);

  // Processa resultados para ajustar o rigor
  const processResult = useCallback((symbol: string, isWin: boolean) => {
    setConsecutiveLosses(prev => {
      const currentLosses = isWin ? 0 : (prev[symbol] || 0) + 1;
      
      setThresholds(tPrev => {
        let rigor = tPrev[symbol] || MIN_RIGOR;
        if (isWin) {
          rigor = Math.max(MIN_RIGOR, rigor - 0.05); // Recompensa: relaxa 5%
        } else if (currentLosses >= 2) {
          rigor = Math.min(MAX_RIGOR, rigor + 0.10); // Punição: endurece 10%
        }
        return { ...tPrev, [symbol]: rigor };
      });

      return { ...prev, [symbol]: currentLosses };
    });
  }, []);

  // Validação soberana de execução
  const validateExecution = useCallback((symbol: string, confidence: number): boolean => {
    const currentRigor = thresholds[symbol] || MIN_RIGOR;
    const isStable = checkStability(symbol);
    
    // Bloqueia se confiança for menor que rigor adaptativo ou se houver gap de liquidez
    return isStable && confidence >= (currentRigor * 100);
  }, [thresholds, checkStability]);

  return {
    thresholds,
    recordPulse,
    checkStability,
    processResult,
    validateExecution,
    MIN_RIGOR,
    MAX_RIGOR
  };
}
