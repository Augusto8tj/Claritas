// src/features/trading/services/predictive-logic.ts
'use client';

import type { AssertivenessData } from '../hooks/use-master-autopilot';

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
  horizons: { name: string; ticks: number; window: number }[]
) {
  let newTriggerSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let newTriggerReason = 'Nenhuma confirmação dupla de assertividade (> 70%).';
  let newTriggeredBy: [string, string] | null = null;
  const riskManager = { assertivenessThreshold: 70 }; // Simplified for this pure function

  for (let i = 1; i < horizons.length; i++) {
    const currentHorizonName = horizons[i].name;
    const prevHorizonName = horizons[i-1].name;
    const currentExpert = newAssertiveness[currentHorizonName];
    const prevExpert = newAssertiveness[prevHorizonName];

    // Effective vote calculation based on accuracy
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

    if (currentEffectiveAccuracy > riskManager.assertivenessThreshold && prevEffectiveAccuracy > riskManager.assertivenessThreshold) {
      if (currentVote === prevVote && currentVote !== 'HOLD') {
        newTriggerSignal = currentVote;
        newTriggeredBy = [prevHorizonName, currentHorizonName];
        newTriggerReason = `Sinal ${currentVote} confirmado por ${prevHorizonName} (${prevEffectiveAccuracy.toFixed(0)}%) e ${currentHorizonName} (${currentEffectiveAccuracy.toFixed(0)}%). Executando...`;
        break; 
      }
    }
  }

  return { newTriggerSignal, newTriggerReason, newTriggeredBy };
}
