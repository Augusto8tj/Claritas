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
      
      const currentEffectiveVote = getEffectiveVote(currentExpert);
      const prevEffectiveVote = getEffectiveVote(prevExpert);

      if (currentEffectiveVote !== 'HOLD' && currentEffectiveVote === prevEffectiveVote) {
        
        const currentEffectiveAccuracy = Math.max(currentExpert.accuracy, 100 - currentExpert.accuracy);
        const prevEffectiveAccuracy = Math.max(prevExpert.accuracy, 100 - prevExpert.accuracy);
        const currentThreshold = thresholds[currentHorizonName] || 80;
        const prevThreshold = thresholds[prevHorizonName] || 80;
        
        const bothPassThreshold = currentEffectiveAccuracy >= currentThreshold && prevEffectiveAccuracy >= prevThreshold;
        
        if (!bothPassThreshold) {
          newTriggerReason = `Acordo de ${currentEffectiveVote} entre ${prevHorizonName} e ${currentHorizonName}, mas limiares não atingidos.`;
          continue;
        }
        
        const agreedVote = currentEffectiveVote;
        
        // 1. PRIMEIRO: Verificar se é HF
        const shorterHorizonSeconds = Math.min(calcularSegundos(currentHorizonName), calcularSegundos(prevHorizonName));
        const isHighFrequencySignal = shorterHorizonSeconds <= highFrequencyThresholdSeconds;
        
        // 2. SE não for HF E filtro macro estiver ligado, ENTÃO validar com EMA
        if (!isHighFrequencySignal && isMacroTrendCheckEnabled) {
          const longerHorizonSeconds = Math.max(calcularSegundos(currentHorizonName), calcularSegundos(prevHorizonName));
          
          // AJUSTE CONFORME SOLICITADO PELO UTILIZADOR
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
          
          // Validação estrita
          if ((agreedVote === 'RISE' && dynamicTrend !== 'UP') ||
              (agreedVote === 'FALL' && dynamicTrend !== 'DOWN')) {
            newTriggerReason = `Sinal ${agreedVote} bloqueado: preço ${currentPrice.toFixed(4)} vs EMA(${dynamicPeriod})=${dynamicEMA.toFixed(4)} (${dynamicTrend})`;
            continue;
          }
        }
        
        // 3. Se passou, aprovar
        newTriggerSignal = agreedVote;
        newTriggeredBy = [prevHorizonName, currentHorizonName];
        newTriggerReason = `✅ ${agreedVote} confirmado por ${prevHorizonName}+${currentHorizonName}`;
        if (isHighFrequencySignal) newTriggerReason += ' [HF, macro ignorado]';
        break;
      }
    }
  } else {
    // Lógica para especialista único (pode ser adicionada aqui se necessário)
  }
  
  return { newTriggerSignal, newTriggerReason, newTriggeredBy };
}
