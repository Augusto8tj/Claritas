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
  macroTrend: 'UP' | 'DOWN' | 'NONE'
) {
  let newTriggerSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let newTriggerReason = 'Nenhuma confirmação dupla de assertividade.';
  let newTriggeredBy: [string, string] | null = null;
  
  if (!isRegimeCompatible(contractType, currentRegime)) {
    newTriggerReason = `Contrato (${contractType}) incompatível com regime atual (${currentRegime}).`;
    return { newTriggerSignal, newTriggerReason, newTriggeredBy };
  }


  for (let i = 1; i < horizons.length; i++) {
    const currentHorizonName = horizons[i].name;
    const prevHorizonName = horizons[i-1].name;
    const currentExpert = newAssertiveness[currentHorizonName];
    const prevExpert = newAssertiveness[prevHorizonName];

    const getEffectiveVote = (expert: AssertivenessData) => {
        if (!expert) return 'HOLD';
        return expert.accuracy > 50 
            ? expert.vote 
            : (expert.vote === 'RISE' ? 'FALL' : (expert.vote === 'FALL' ? 'RISE' : 'HOLD'));
    };

    const currentVote = getEffectiveVote(currentExpert);
    const prevVote = getEffectiveVote(prevExpert);

    const currentEffectiveAccuracy = currentExpert ? Math.max(currentExpert.accuracy, 100 - currentExpert.accuracy) : 0;
    const prevEffectiveAccuracy = prevExpert ? Math.max(prevExpert.accuracy, 100 - prevExpert.accuracy) : 0;

    const currentThreshold = thresholds[currentHorizonName] || 80;
    const prevThreshold = thresholds[prevHorizonName] || 80;

    if (currentEffectiveAccuracy > currentThreshold && prevEffectiveAccuracy > prevThreshold) {
      if (currentVote === prevVote && currentVote !== 'HOLD') {
        
        // Confirmação de Tendência Macro para contratos direcionais
        if (contractType === 'Rise/Fall' || contractType === 'Multipliers') {
            if ((currentVote === 'RISE' && macroTrend !== 'UP') || (currentVote === 'FALL' && macroTrend !== 'DOWN')) {
                newTriggerReason = `Sinal ${currentVote} bloqueado. desalinhado com a tendência macro (${macroTrend}).`;
                continue; // Pula para o próximo par de horizontes
            }
        }
        
        newTriggerSignal = currentVote;
        newTriggeredBy = [prevHorizonName, currentHorizonName];
        newTriggerReason = `Sinal ${currentVote} confirmado por ${prevHorizonName} (${prevEffectiveAccuracy.toFixed(0)}% > ${prevThreshold}%) e ${currentHorizonName} (${currentEffectiveAccuracy.toFixed(0)}% > ${currentThreshold}%). Executando...`;
        break; 
      }
    }
  }

  return { newTriggerSignal, newTriggerReason, newTriggeredBy };
}
