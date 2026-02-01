// src/features/trading/services/predictive-logic.ts
'use client';

import type { AssertivenessData } from '../hooks/use-master-autopilot';
import type { MarketRegime, CandleData } from '@/lib/types';

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
    // Se a precisão é < 50%, o modelo está ativamente errado, então invertemos o voto.
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
  if (!match) return Infinity; // Should not happen with valid names
  const value = parseInt(match[1], 10);
  return match[2] === 't' ? value * 2 : value; // Approximation: 1 tick = 2 seconds
}


export function evaluateTriggerConditions(
  newAssertiveness: Record<string, AssertivenessData>,
  horizons: { name: string; type: 'tick' | 'second'; window: number }[],
  thresholds: Record<string, number>,
  contractType: string,
  currentRegime: MarketRegime,
  currentPrice: number,
  botCandleData: CandleData[],
  isNeighborConfirmationEnabled: boolean,
  isTripleConfirmationEnabled: boolean,
  isMacroTrendCheckEnabled: boolean,
  highFrequencyThresholdSeconds: number,
) {
  let newTriggerSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let newTriggerReason = 'Nenhuma condição de gatilho atendida.';
  let newTriggeredBy: string[] | null = null;
  
  if (!isRegimeCompatible(contractType, currentRegime)) {
    newTriggerReason = `Contrato (${contractType}) incompatível com regime atual (${currentRegime}).`;
    return { newTriggerSignal, newTriggerReason, newTriggeredBy };
  }
  
  if (isNeighborConfirmationEnabled) {
    newTriggerReason = isTripleConfirmationEnabled 
      ? 'Nenhuma confirmação tripla de assertividade.' 
      : 'Nenhuma confirmação dupla de assertividade.';

    const loopStart = 1;
    const loopEnd = isTripleConfirmationEnabled ? horizons.length - 1 : horizons.length;

    for (let i = loopStart; i < loopEnd; i++) {
      const prevExpert = newAssertiveness[horizons[i-1].name];
      const currentExpert = newAssertiveness[horizons[i].name];
      if (!currentExpert || !prevExpert) continue;

      const prevEffectiveVote = getEffectiveVote(prevExpert);
      const currentEffectiveVote = getEffectiveVote(currentExpert);

      let agreement = (currentEffectiveVote !== 'HOLD' && currentEffectiveVote === prevEffectiveVote);
      let partners = [horizons[i - 1].name, horizons[i].name];

      if (isTripleConfirmationEnabled) {
        if (i + 1 >= horizons.length) continue; // Boundary check
        const nextExpert = newAssertiveness[horizons[i+1].name];
        if (!nextExpert) continue;
        const nextEffectiveVote = getEffectiveVote(nextExpert);
        agreement = agreement && currentEffectiveVote === nextEffectiveVote;
        if(agreement) partners.push(horizons[i+1].name);
      }
        
      if (agreement) {
        const allPassThreshold = partners.every(partnerName => {
            const expert = newAssertiveness[partnerName];
            const effectiveAccuracy = Math.max(expert.accuracy, 100 - expert.accuracy);
            const threshold = thresholds[partnerName] || 80;
            return effectiveAccuracy >= threshold;
        });

        if (!allPassThreshold) {
          newTriggerReason = `Acordo de ${currentEffectiveVote} entre ${partners.join(', ')}, mas limiares não atingidos.`;
          continue;
        }
        
        const agreedVote = currentEffectiveVote;
        
        const shorterHorizonSeconds = Math.min(...partners.map(p => calcularSegundos(p)));
        const isHighFrequencySignal = shorterHorizonSeconds <= highFrequencyThresholdSeconds;
        
        if (!isHighFrequencySignal && isMacroTrendCheckEnabled) {
          const longerHorizonSeconds = Math.max(...partners.map(p => calcularSegundos(p)));
          const dynamicPeriod = Math.max(5, longerHorizonSeconds);
          const dynamicEMA = calculateDynamicEMA(botCandleData, dynamicPeriod);
          
          if (dynamicEMA === null) {
            newTriggerReason = `EMA(${dynamicPeriod}) indisponível (dados insuficientes).`;
            continue;
          }
          
          const deadZone = dynamicEMA * 0.0005;
          let dynamicTrend: 'UP' | 'DOWN' | 'NONE' = 'NONE';
          if (currentPrice > dynamicEMA + deadZone) dynamicTrend = 'UP';
          else if (currentPrice < dynamicEMA - deadZone) dynamicTrend = 'DOWN';
          
          // CORREÇÃO: Apenas bloquear se a tendência for EXPLICITAMENTE oposta. Permitir em tendência NEUTRA.
          if ((agreedVote === 'RISE' && dynamicTrend === 'DOWN') || (agreedVote === 'FALL' && dynamicTrend === 'UP')) {
            newTriggerReason = `Sinal ${agreedVote} bloqueado por tendência macro oposta: Preço ${currentPrice.toFixed(4)} vs EMA(${dynamicPeriod}) ${dynamicEMA.toFixed(4)} (${dynamicTrend})`;
            continue;
          }
        }
        
        newTriggerSignal = agreedVote;
        newTriggeredBy = partners;
        newTriggerReason = `✅ ${agreedVote} confirmado por ${partners.join(' + ')}`;
        if (isHighFrequencySignal && isMacroTrendCheckEnabled) newTriggerReason += ' [HF, macro ignorado]';
        break; // Primeira condição de gatilho encontrada é suficiente
      }
    }
  } else {
    // This logic branch handles when neighbor confirmation is off.
    // It should find the single best expert.
    newTriggerReason = 'Confirmação de vizinhos está desativada.';
    
    let bestSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let bestAccuracy = 0;
    let bestHorizon: string | null = null;
    
    for (const horizon of horizons) {
        const expert = newAssertiveness[horizon.name];
        if(!expert) continue;
        
        const effectiveAccuracy = Math.max(expert.accuracy, 100 - expert.accuracy);
        const threshold = thresholds[horizon.name] || 80;

        if (effectiveAccuracy >= threshold && effectiveAccuracy > bestAccuracy) {
            bestAccuracy = effectiveAccuracy;
            bestSignal = getEffectiveVote(expert);
            bestHorizon = horizon.name;
        }
    }

    if (bestHorizon && bestSignal !== 'HOLD') {
        newTriggerSignal = bestSignal;
        newTriggeredBy = [bestHorizon];
        newTriggerReason = `✅ ${bestSignal} confirmado pelo especialista mais forte: ${bestHorizon} (${bestAccuracy.toFixed(1)}%)`;
    }
  }
  
  return { newTriggerSignal, newTriggerReason, newTriggeredBy };
}

export function evaluateManualTrigger(
  newAssertiveness: Record<string, AssertivenessData>
): { manualTriggerSignal: 'RISE' | 'FALL' | 'HOLD', manualTriggerReason: string } {
    const manualSignalVotes = Object.values(newAssertiveness).map(getEffectiveVote);
    const riseCount = manualSignalVotes.filter(v => v === 'RISE').length;
    const fallCount = manualSignalVotes.filter(v => v === 'FALL').length;
    const totalVotes = riseCount + fallCount;
    
    let manualTriggerSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
    let manualTriggerReason = 'Aguardando consenso majoritário.';

    if (totalVotes > 0) {
        if (riseCount / totalVotes > 0.6) {
            manualTriggerSignal = 'RISE';
            manualTriggerReason = `Consenso de Alta (${riseCount}/${totalVotes})`;
        } else if (fallCount / totalVotes > 0.6) {
            manualTriggerSignal = 'FALL';
            manualTriggerReason = `Consenso de Queda (${fallCount}/${totalVotes})`;
        }
    }

    return { manualTriggerSignal, manualTriggerReason };
}