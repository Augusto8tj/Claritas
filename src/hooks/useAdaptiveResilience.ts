// /src/hooks/useAdaptiveResilience.ts
'use client';

import { useState, useCallback, useRef } from 'react';

/**
 * useAdaptiveResilience - Motor de Governança V4.2
 * Gerencia o rigor da IA, o estresse de liquidez e o gate de WinRate-to-Breakeven.
 */

const MIN_RIGOR = 0.65;
const MAX_RIGOR = 0.85;
const LIQUIDITY_GAP_THRESHOLD_MS = 2500; 

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

  /**
   * Validação soberana de execução V4.2
   * @param confidence Confiança atual do sinal (0-100)
   * @param pHatLower Limite inferior do Win Rate (Wilson Interval)
   * @param breakeven Ponto de equilíbrio calculado (1 / (1 + payout))
   */
  const validateExecution = useCallback((
    symbol: string, 
    confidence: number, 
    pHatLower?: number, 
    breakeven?: number
  ): { allowed: boolean; reason?: string } => {
    const currentRigor = thresholds[symbol] || MIN_RIGOR;
    const isStable = checkStability(symbol);
    
    if (!isStable) return { allowed: false, reason: "INSTABILIDADE: Gap de liquidez detectado." };
    if (confidence < (currentRigor * 100)) return { allowed: false, reason: `RIGOR: Confiança ${confidence.toFixed(0)}% abaixo do exigido (${(currentRigor * 100).toFixed(0)}%).` };

    // Phase 3.7: Desativação automática se win rate < breakeven
    if (pHatLower !== undefined && breakeven !== undefined && pHatLower < breakeven) {
      return { allowed: false, reason: `EDGE: Win Rate (${(pHatLower * 100).toFixed(1)}%) abaixo do breakeven (${(breakeven * 100).toFixed(1)}%).` };
    }

    return { allowed: true };
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
