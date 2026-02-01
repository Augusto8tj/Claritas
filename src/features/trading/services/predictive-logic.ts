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
  currentPrice: number, // NOVO
  botCandleData: CandleData[], // NOVO
  isNeighborConfirmationEnabled: boolean,
  isMacroTrendCheckEnabled: boolean,
  highFrequencyThresholdSeconds: number,
) {
  let newTriggerSignal: 'RISE' | 'FALL' | 'HOLD' = 'HOLD';
  let newTriggerReason = 'Nenhuma condição de gatilho atendida.';
  let newTriggeredBy: [string, string] | null = null;
  
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
      
      // PASSO 1: Determinar a direção "correta" (efetiva) de cada especialista.
      const currentEffectiveVote = getEffectiveVote(currentExpert);
      const prevEffectiveVote = getEffectiveVote(prevExpert);

      // PASSO 2: Verificar se a direção é a mesma e não é 'HOLD'.
      // Esta é a "confirmação de direção". Não precisa ser "exata" no voto bruto, mas sim na direção efetiva.
      if (currentEffectiveVote !== 'HOLD' && currentEffectiveVote === prevEffectiveVote) {
        
        // PASSO 3: Se a direção foi confirmada, agora verificamos a assertividade individual.
        const currentEffectiveAccuracy = Math.max(currentExpert.accuracy, 100 - currentExpert.accuracy);
        const prevEffectiveAccuracy = Math.max(prevExpert.accuracy, 100 - prevExpert.accuracy);
        const currentThreshold = thresholds[currentHorizonName] || 80;
        const prevThreshold = thresholds[prevHorizonName] || 80;
        
        // Condição 2: Ambos os especialistas devem atender aos seus limiares de assertividade individuais.
        const bothPassThreshold = currentEffectiveAccuracy >= currentThreshold && prevEffectiveAccuracy >= prevThreshold;
        
        if (!bothPassThreshold) {
          newTriggerReason = `Acordo de ${currentEffectiveVote} entre ${prevHorizonName} e ${currentHorizonName}, mas limiares não atingidos.`;
          continue; // Pula para o próximo par de vizinhos
        }
        
        // PASSO 4: Se tudo até aqui passou, validamos com a tendência macro (se aplicável).
        const agreedVote = currentEffectiveVote;
        const horizonSeconds = calcularSegundos(currentHorizonName);
        const isHighFrequencySignal = horizonSeconds <= highFrequencyThresholdSeconds;
        
        if (!isHighFrequencySignal && isMacroTrendCheckEnabled) {
          const dynamicPeriod = Math.max(Math.round(horizonSeconds / 2), 20);
          const dynamicEMA = calculateDynamicEMA(botCandleData, dynamicPeriod);
          
          if (dynamicEMA === null) {
            newTriggerReason = `EMA(${dynamicPeriod}) indisponível.`;
            continue;
          }
          
          const deadZone = dynamicEMA * 0.0005;
          let dynamicTrend: 'UP' | 'DOWN' | 'NONE' = 'NONE';
          if (currentPrice > dynamicEMA + deadZone) dynamicTrend = 'UP';
          else if (currentPrice < dynamicEMA - deadZone) dynamicTrend = 'DOWN';
          
          if ((agreedVote === 'RISE' && dynamicTrend !== 'UP') ||
              (agreedVote === 'FALL' && dynamicTrend !== 'DOWN')) {
            newTriggerReason = `Sinal ${agreedVote} bloqueado: preço ${currentPrice.toFixed(4)} vs EMA(${dynamicPeriod})=${dynamicEMA.toFixed(4)} (${dynamicTrend})`;
            continue;
          }
        }
        
        // Se todos os filtros passaram, temos um sinal válido!
        newTriggerSignal = agreedVote;
        newTriggeredBy = [prevHorizonName, currentHorizonName];
        newTriggerReason = `✅ ${agreedVote} confirmado por ${prevHorizonName}+${currentHorizonName}`;
        if (isHighFrequencySignal) newTriggerReason += ' [HF, macro ignorado]';
        break; // Encontramos um sinal válido, saímos do loop.
      }
    }
  }
  
  return { newTriggerSignal, newTriggerReason, newTriggeredBy };
}