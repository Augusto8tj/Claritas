// src/features/trading/services/predictive-logic.ts
'use client';

import type { AssertivenessData } from '../hooks/use-master-autopilot';
import type { MarketRegime, CandleData } from '@/lib/types';
import type { Indicators } from '@/services/indicator-service';


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
    return expert.accuracy > 50 
        ? expert.vote 
        : (expert.vote === 'RISE' ? 'FALL' : (expert.vote === 'FALL' ? 'RISE' : 'HOLD'));
};

function calculateDynamicEMA(data: CandleData[], period: number): number | null {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  const relevantData = data.slice(-(period * 2));
  if (relevantData.length < period) return null;
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    if (relevantData[i]) {
        sum += relevantData[i].close;
    }
  }
  let ema = sum / period;
  
  for (let i = period; i < relevantData.length; i++) {
    if (relevantData[i]) {
        ema = (relevantData[i].close - ema) * k + ema;
    }
  }
  return ema;
}

function calcularSegundos(horizonName: string): number {
  const match = horizonName.match(/(\d+)([st])/);
  if (!match) return Infinity;
  const value = parseInt(match[1], 10);
  return match[2] === 't' ? value * 2 : value;
}

export function evaluateTriggerConditions(
  newAssertiveness: Record<string, AssertivenessData>,
  horizons: { name: string; ticks: number; window: number }[],
  thresholds: Record<string, number>,
  contractType: string,
  currentRegime: MarketRegime,
  currentPrice: number,
  botCandleData: CandleData[],
  isNeighborConfirmationEnabled: boolean,
  isMacroTrendCheckEnabled: boolean,
  highFrequencyThresholdSeconds: number,
  indicators: Indicators | null
) {
  let newTriggerSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let newTriggerReason = 'Nenhuma condição de gatilho atendida.';
  let newTriggeredBy: [string, string] | null = null;

  const atrPercent = indicators?.atr ? (indicators.atr / currentPrice) * 100 : 0;
  if (atrPercent < 0.01) { // ATR < 0.01% = mercado parado
    return {
        newTriggerSignal: 'HOLD',
        newTriggerReason: 'Mercado estagnado (ATR < 0.01%). Esperando volatilidade.',
        newTriggeredBy: null
    };
  }
  
  if (!isRegimeCompatible(contractType, currentRegime)) {
    newTriggerReason = `Contrato (${contractType}) incompatível com regime atual (${currentRegime}).`;
    return { newTriggerSignal, newTriggerReason, newTriggeredBy };
  }

  if (isNeighborConfirmationEnabled) {
    newTriggerReason = 'Nenhuma confirmação dupla de assertividade.';
    for (let i = 1; i < horizons.length; i++) {
        const currentHorizonName = horizons[i].name;
        const prevHorizonName = horizons[i-1].name;
        const currentExpert = newAssertiveness[currentHorizonName];
        const prevExpert = newAssertiveness[prevHorizonName];

        if (!currentExpert || !prevExpert) continue;

        const currentVote = getEffectiveVote(currentExpert);
        const prevVote = getEffectiveVote(prevExpert);

        const currentEffectiveAccuracy = Math.max(currentExpert.accuracy, 100 - currentExpert.accuracy);
        const prevEffectiveAccuracy = Math.max(prevExpert.accuracy, 100 - prevExpert.accuracy);

        const currentThreshold = thresholds[currentHorizonName] || 80;
        const prevThreshold = thresholds[prevHorizonName] || 80;

        if (currentEffectiveAccuracy >= currentThreshold && prevEffectiveAccuracy >= prevThreshold) {
            if (currentVote === prevVote && currentVote !== 'HOLD') {
                
                const horizonSeconds = calcularSegundos(currentHorizonName);
                const isHighFrequencySignal = horizonSeconds <= highFrequencyThresholdSeconds;
                
                if (!isHighFrequencySignal && isMacroTrendCheckEnabled) {
                  const dynamicPeriod = Math.max(Math.round(horizonSeconds), 10);
                  const dynamicEMA = calculateDynamicEMA(botCandleData, dynamicPeriod);
                  
                  if (dynamicEMA === null) {
                    newTriggerReason = `Sinal ${currentVote} bloqueado: EMA(${dynamicPeriod}) indisponível.`;
                    continue;
                  }
                  
                  const deadZone = dynamicEMA * 0.0005;
                  let dynamicTrend: 'UP' | 'DOWN' | 'NONE' = 'NONE';
                  if (currentPrice > dynamicEMA + deadZone) dynamicTrend = 'UP';
                  else if (currentPrice < dynamicEMA - deadZone) dynamicTrend = 'DOWN';
                  
                  if ((currentVote === 'RISE' && dynamicTrend === 'DOWN') ||
                      (currentVote === 'FALL' && dynamicTrend === 'UP')) {
                    newTriggerReason = `Sinal ${currentVote} bloqueado por tendência macro contrária (${dynamicTrend})`;
                    continue; // Pula para a próxima iteração do loop
                  }
                }
                
                newTriggerSignal = currentVote;
                newTriggeredBy = [prevHorizonName, currentHorizonName];
                newTriggerReason = `✅ ${currentVote} confirmado por ${prevHorizonName}+${currentHorizonName}`;
                if (isHighFrequencySignal) newTriggerReason += ' [HF, macro ignorado]';
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
        const horizonSeconds = calcularSegundos(bestHorizon);
        const isHighFrequencySignal = horizonSeconds <= highFrequencyThresholdSeconds;

        if (isMacroTrendCheckEnabled && !isHighFrequencySignal) {
            const dynamicPeriod = Math.max(Math.round(horizonSeconds), 10);
            const dynamicEMA = calculateDynamicEMA(botCandleData, dynamicPeriod);
            
            if (dynamicEMA === null) {
                 newTriggerReason = `Sinal ${strongestVote} (${bestHorizon}) bloqueado. EMA(${dynamicPeriod}) indisponível.`;
            } else {
                const deadZone = dynamicEMA * 0.0005;
                let dynamicTrend: 'UP' | 'DOWN' | 'NONE' = 'NONE';
                if (currentPrice > dynamicEMA + deadZone) dynamicTrend = 'UP';
                else if (currentPrice < dynamicEMA - deadZone) dynamicTrend = 'DOWN';

                if ((strongestVote === 'RISE' && dynamicTrend === 'DOWN') || (strongestVote === 'FALL' && dynamicTrend === 'UP')) {
                     newTriggerReason = `Sinal ${strongestVote} (${bestHorizon}) bloqueado por tendência macro contrária (${dynamicTrend}).`;
                } else {
                    newTriggerSignal = strongestVote;
                    newTriggeredBy = [bestHorizon, bestHorizon];
                    newTriggerReason = `✅ ${strongestVote} por especialista único (${bestHorizon}) com ${bestAccuracy.toFixed(1)}% de assertividade.`;
                }
            }
        } else {
            newTriggerSignal = strongestVote;
            newTriggeredBy = [bestHorizon, bestHorizon];
            newTriggerReason = `✅ ${strongestVote} (${isHighFrequencySignal ? 'HF' : 'Padrão'}) por especialista único (${bestHorizon}) com ${bestAccuracy.toFixed(1)}%.`;
        }
    }
  }

  return { newTriggerSignal, newTriggerReason, newTriggeredBy };
}
