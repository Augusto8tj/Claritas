'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { RobotPerformance, TickData, RobotStrategy } from '@/lib/types';
import { useDerivApiDigits } from './use-deriv-api-digits';

// ============================================================================
// TIPOS E CONFIGURAÇÕES
// ============================================================================
export type DigitStats = {
    digit: number;
    count: number;
    probability: number;
};

type CouncilStrategy = {
  id: string;
  type: 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
  description: string;
  prediction?: number;
};

type VirtualTrade = {
  id: string;
  robotId: string;
  contractType: CouncilStrategy['type'];
  prediction?: number;
  entryEpoch: number;
  exitEpoch: number;
};

const councilStrategies: CouncilStrategy[] = [
  { id: 'diff_most_freq', type: 'DIGITDIFF', description: 'Difere do dígito mais frequente' },
  { id: 'match_least_freq', type: 'DIGITMATCH', description: 'Combina com o dígito menos frequente' },
  { id: 'over_4', type: 'DIGITOVER', prediction: 4, description: 'Acima de 4' },
  { id: 'under_5', type: 'DIGITUNDER', prediction: 5, description: 'Abaixo de 5' },
  { id: 'even', type: 'DIGITEVEN', description: 'O resultado é Par' },
  { id: 'odd', type: 'DIGITODD', description: 'O resultado é Ímpar' },
];

// ============================================================================
// HOOK PRINCIPAL
// ============================================================================
export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[]) {
  const { toast } = useToast();
  const { executeTrade } = useDerivApiDigits();

  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(25);
  const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const performanceRef = useRef<RobotPerformance[]>([]);

  useEffect(() => {
    performanceRef.current = robotPerformance;
  }, [robotPerformance]);
  
  useEffect(() => {
    // Inicializa o estado de performance quando as estratégias são definidas
    const initialPerformance = councilStrategies.map(strat => ({
      id: strat.id,
      strategyType: strat.type,
      strategy: { description: strat.description } as any, // Simplificado para exibição
      wins: 0,
      losses: 0,
      totalProfit: 0,
      winRate: 0,
    }));
    setRobotPerformance(initialPerformance);
  }, []);

  const digitStats: DigitStats[] = useMemo(() => {
    if (priceTicks.length < 100) {
      return Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, probability: 10 }));
    }
    const counts = Array(10).fill(0);
    const last100Ticks = priceTicks.slice(-100);
    last100Ticks.forEach(tick => {
      let price = tick.price;
      while (Math.abs(price - Math.round(price)) > 1e-9 && price < Number.MAX_SAFE_INTEGER / 10) price *= 10;
      const lastDigit = Math.round(price) % 10;
      if (!isNaN(lastDigit)) counts[lastDigit]++;
    });

    const total = counts.reduce((a, b) => a + b, 0);
    return counts.map((count, i) => ({
      digit: i,
      count: count,
      probability: total > 0 ? (count / total) * 100 : 10,
    }));
  }, [priceTicks]);

  // Lógica de Autopilot (mantida como antes)
  const councilDecision = useMemo(() => {
    if (digitStats.every(s => s.probability === 10)) return { type: 'hold', digit: -1, probability: 0 };
    const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
    const mostProbable = sortedByProb[0];
    if (mostProbable.probability > consensusThreshold) {
      return { type: 'differs', digit: mostProbable.digit, probability: mostProbable.probability };
    }
    return { type: 'hold', digit: -1, probability: 0 };
  }, [digitStats, consensusThreshold]);
  
  const autopilotExecutionRef = useRef(false);
  useEffect(() => {
    if (!isCouncilAutopilotOn || !activeSymbol || autopilotExecutionRef.current) return;
    const runAutopilot = async () => {
      autopilotExecutionRef.current = true;
      const { type, digit } = councilDecision;
      if (type === 'differs' && digit !== -1) {
        await executeTrade('DIGITDIFF', 0.35, activeSymbol, 5, 't', 'Piloto', digit);
      }
      setTimeout(() => { autopilotExecutionRef.current = false }, 2000);
    };
    runAutopilot();
  }, [isCouncilAutopilotOn, councilDecision, activeSymbol, executeTrade]);

  // Arena Virtual: Processa trades
  useEffect(() => {
    if (priceTicks.length < 2) return;
    const currentTick = priceTicks[priceTicks.length - 1];
    const tradesToRemove: string[] = [];
    let performanceChanged = false;

    virtualTradesRef.current.forEach(trade => {
      if (currentTick.epoch >= trade.exitEpoch) {
        tradesToRemove.push(trade.id);
        const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
        let price = exitTick.price;
        while (Math.abs(price - Math.round(price)) > 1e-9 && price < Number.MAX_SAFE_INTEGER / 10) price *= 10;
        const lastDigit = Math.round(price) % 10;
        
        let isWin = false;
        switch (trade.contractType) {
          case 'DIGITDIFF': isWin = lastDigit !== trade.prediction; break;
          case 'DIGITMATCH': isWin = lastDigit === trade.prediction; break;
          case 'DIGITOVER': isWin = lastDigit > trade.prediction!; break;
          case 'DIGITUNDER': isWin = lastDigit < trade.prediction!; break;
          case 'DIGITEVEN': isWin = lastDigit % 2 === 0; break;
          case 'DIGITODD': isWin = lastDigit % 2 !== 0; break;
        }

        const perfIndex = performanceRef.current.findIndex(p => p.id === trade.robotId);
        if (perfIndex !== -1) {
          const perf = performanceRef.current[perfIndex];
          perf.wins += isWin ? 1 : 0;
          perf.losses += isWin ? 0 : 1;
          perf.totalProfit += isWin ? 0.33 : -0.35; // Payout ~95%
          const total = perf.wins + perf.losses;
          perf.winRate = total > 0 ? (perf.wins / total) * 100 : 0;
          performanceChanged = true;
        }
      }
    });

    if (tradesToRemove.length > 0) {
      virtualTradesRef.current = virtualTradesRef.current.filter(t => !tradesToRemove.includes(t.id));
    }
    if(performanceChanged) {
        setRobotPerformance([...performanceRef.current]);
    }
  }, [priceTicks]);

  // Arena Virtual: Cria novos trades
  useEffect(() => {
    if (!isCouncilAutopilotOn || priceTicks.length < 100) return;

    const currentTick = priceTicks[priceTicks.length - 1];
    const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
    const mostProbable = sortedByProb[0];
    const leastProbable = sortedByProb[sortedByProb.length - 1];

    councilStrategies.forEach(strategy => {
      if (virtualTradesRef.current.some(t => t.robotId === strategy.id)) return;

      let shouldTrade = false;
      let prediction = strategy.prediction;

      switch (strategy.id) {
        case 'diff_most_freq':
          if (mostProbable.probability > 20) {
             shouldTrade = true;
             prediction = mostProbable.digit;
          }
          break;
        case 'match_least_freq':
           if (leastProbable.probability < 5) {
             shouldTrade = true;
             prediction = leastProbable.digit;
          }
          break;
        case 'over_4':
        case 'under_5':
        case 'even':
        case 'odd':
          shouldTrade = true; 
          break;
      }
      
      if (shouldTrade) {
        virtualTradesRef.current.push({
          id: `vt_${strategy.id}_${Date.now()}`,
          robotId: strategy.id,
          contractType: strategy.type,
          prediction: prediction,
          entryEpoch: currentTick.epoch,
          exitEpoch: currentTick.epoch + (5 * 2), // 5 ticks, 2s/tick
        });
      }
    });
  }, [digitStats, isCouncilAutopilotOn, priceTicks]);

  const fetchStrategyCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(true);
    toast({ title: 'Piloto Automático de Dígitos Ativado' });
  }, [toast]);

  const dissolveCouncil = useCallback(() => {
    setIsCouncilAutopilotOn(false);
    toast({ title: 'Piloto Automático de Dígitos Desativado' });
  }, [toast]);
  
  return {
    isCouncilAutopilotOn,
    isFetchingCouncil: false,
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    fetchStrategyCouncil, dissolveCouncil,
    digitStats,
    councilDecision,
    robotPerformance, // Para o TradingDeskDigits
    // Placeholders
    evolutionHistory: [],
  };
}
