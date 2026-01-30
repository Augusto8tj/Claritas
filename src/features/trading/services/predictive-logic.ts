// src/features/trading/services/predictive-logic.ts
'use client';

import type { AssertivenessData } from '../hooks/use-master-autopilot';
import type { MarketRegime } from '@/lib/types';


function isRegimeCompatible(contract: string, regime: MarketRegime): boolean {
    switch(contract) {
        case 'Accumulators':
            return regime === 'ranging';
        case 'Multipliers':
            return regime === 'trending_bull' || regime === 'trending_bear' || regime === 'breakout';
        case 'Rise/Fall':
            return true;
        default:
            return false;
    }
}

const getEffectiveVote = (expert: AssertivenessData | undefined): 'RISE' | 'FALL' | 'HOLD' => {
    if (!expert) return 'HOLD';
    // Lógica pura de inversão, sem limiar.
    return expert.accuracy > 50 
        ? expert.vote 
        : (expert.vote === 'RISE' ? 'FALL' : (expert.vote === 'FALL' ? 'RISE' : 'HOLD'));
};

/**
 * Re-evaluates trigger conditions based on the latest assertiveness data.
 * This function is designed to be pure and testable.
 * 
 * @param newAssertiveness - The most recent assertiveness data for all horizons.
 * @param horizons - The configuration for all temporal horizons.
 * @returns An object containing the detected signal, the reason, and the triggering horizons.
 */
export function evaluateTriggerConditions(
  newAssertiveness: Record<string, AssertivenessData>,
  horizons: { name: string; ticks: number; window: number }[],
  thresholds: Record<string, number>,
  contractType: string,
  currentRegime: MarketRegime,
  macroTrend: 'UP' | 'DOWN' | 'NONE',
  isNeighborConfirmationEnabled: boolean,
  isMacroTrendCheckEnabled: boolean,
  highFrequencyThresholdSeconds: number, // NOVO
) {
  let newTriggerSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let newTriggerReason = 'Nenhuma condição de gatilho atendida.';
  let newTriggeredBy: [string, string] | null = null;
  
  if (!isRegimeCompatible(contractType, currentRegime)) {
    newTriggerReason = `Contrato (${contractType}) incompatível com regime atual (${currentRegime}).`;
    return { newTriggerSignal, newTriggerReason, newTriggeredBy };
  }

  if (isNeighborConfirmationEnabled) {
    // LÓGICA DE CONFIRMAÇÃO DUPLA (VIZINHOS)
    newTriggerReason = 'Nenhuma confirmação dupla de assertividade.';
    for (let i = 1; i < horizons.length; i++) {
        const currentHorizonName = horizons[i].name;
        const prevHorizonName = horizons[i-1].name;
        const currentExpert = newAssertiveness[currentHorizonName];
        const prevExpert = newAssertiveness[prevHorizonName];

        const currentVote = getEffectiveVote(currentExpert);
        const prevVote = getEffectiveVote(prevExpert);

        const currentEffectiveAccuracy = currentExpert ? Math.max(currentExpert.accuracy, 100 - currentExpert.accuracy) : 0;
        const prevEffectiveAccuracy = prevExpert ? Math.max(prevExpert.accuracy, 100 - prevExpert.accuracy) : 0;

        const currentThreshold = thresholds[currentHorizonName] || 80;
        const prevThreshold = thresholds[prevHorizonName] || 80;

        if (currentEffectiveAccuracy >= currentThreshold && prevEffectiveAccuracy >= prevThreshold) {
            if (currentVote === prevVote && currentVote !== 'HOLD') {
                
                // --- LÓGICA DE ALTA FREQUÊNCIA ---
                const horizonDurationMatch = currentHorizonName.match(/(\d+)([st])/);
                let horizonSeconds = Infinity;
                if (horizonDurationMatch) {
                    const value = parseInt(horizonDurationMatch[1], 10);
                    const unit = horizonDurationMatch[2];
                    horizonSeconds = unit === 't' ? value * 2 : value; 
                }
                const isHighFrequencySignal = horizonSeconds <= highFrequencyThresholdSeconds;
                
                if (isMacroTrendCheckEnabled && !isHighFrequencySignal) {
                    if ((currentVote === 'RISE' && macroTrend !== 'UP') || (currentVote === 'FALL' && macroTrend !== 'DOWN')) {
                        newTriggerReason = `Sinal ${currentVote} bloqueado. Desalinhado com a tendência macro (${macroTrend}).`;
                        continue; 
                    }
                }
                
                newTriggerSignal = currentVote;
                newTriggeredBy = [prevHorizonName, currentHorizonName];
                newTriggerReason = `Sinal ${currentVote} (${isHighFrequencySignal ? 'HF' : 'Padrão'}) confirmado por ${prevHorizonName} (${prevEffectiveAccuracy.toFixed(0)}%) e ${currentHorizonName} (${currentEffectiveAccuracy.toFixed(0)}%).`;
                
                if (!isMacroTrendCheckEnabled && !isHighFrequencySignal) newTriggerReason += ' Filtro macro ignorado.';
                if (isHighFrequencySignal) newTriggerReason += ' Sinal de alta frequência, filtro macro ignorado.';
                
                break;
            }
        }
    }
  } else {
    // LÓGICA DE ESPECIALISTA ÚNICO MAIS FORTE
    newTriggerReason = 'Nenhum especialista único atingiu o limiar de assertividade.';
    let bestAccuracy = 0;
    let bestHorizon: string | null = null;
    let strongestVote: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';

    for (const horizonName of horizons.map(h => h.name)) {
        const expert = newAssertiveness[horizonName];
        if (!expert) continue;

        const effectiveAccuracy = Math.max(expert.accuracy, 100 - expert.accuracy);
        const threshold = thresholds[horizonName] || 80;

        if (effectiveAccuracy >= threshold && effectiveAccuracy > bestAccuracy) {
            bestAccuracy = effectiveAccuracy;
            bestHorizon = horizonName;
            strongestVote = getEffectiveVote(expert);
        }
    }

    if (strongestVote !== 'HOLD' && bestHorizon) {
        const horizonDurationMatch = bestHorizon.match(/(\d+)([st])/);
        let horizonSeconds = Infinity;
        if(horizonDurationMatch) {
            const value = parseInt(horizonDurationMatch[1], 10);
            const unit = horizonDurationMatch[2];
            horizonSeconds = unit === 't' ? value * 2 : value;
        }
        const isHighFrequencySignal = horizonSeconds <= highFrequencyThresholdSeconds;

        if (isMacroTrendCheckEnabled && !isHighFrequencySignal) {
            if ((strongestVote === 'RISE' && macroTrend !== 'UP') || (strongestVote === 'FALL' && macroTrend !== 'DOWN')) {
                 newTriggerReason = `Sinal ${strongestVote} (${bestHorizon}) bloqueado. Desalinhado com a tendência macro (${macroTrend}).`;
            } else {
                newTriggerSignal = strongestVote;
                newTriggeredBy = [bestHorizon, bestHorizon];
                newTriggerReason = `Sinal ${strongestVote} confirmado por especialista único (${bestHorizon}) com ${bestAccuracy.toFixed(1)}% de assertividade.`;
            }
        } else {
            newTriggerSignal = strongestVote;
            newTriggeredBy = [bestHorizon, bestHorizon];
            newTriggerReason = `Sinal ${strongestVote} (${isHighFrequencySignal ? 'HF' : 'Padrão'}) confirmado por especialista único (${bestHorizon}) com ${bestAccuracy.toFixed(1)}%.`;
        }
    }
  }

  return { newTriggerSignal, newTriggerReason, newTriggeredBy };
}
