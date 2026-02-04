// src/features/trading/hooks/use-robot-council-digits.ts
'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import type { RobotPerformance, TickData, Asset, Operation } from '@/lib/types';
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

export type AutopilotStatus = 'PAUSED' | 'WARMING_UP' | 'TRADING' | 'RECOVERING';
const WARMUP_DURATION_MS = 60000; // 1 minuto

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
export function useRobotCouncilDigits(activeSymbol: string | null, priceTicks: TickData[], activeAsset: Asset | null) {
  const { toast } = useToast();
  const { executeTrade, operationsLog } = useDerivApiDigits();

  const [isCouncilAutopilotOn, setIsCouncilAutopilotOn] = useState(false);
  const [dailyBalance, setDailyBalance] = useState(10);
  const [dailyTarget, setDailyTarget] = useState(5);
  const [consensusThreshold, setConsensusThreshold] = useState(25);
  const [robotPerformance, setRobotPerformance] = useState<RobotPerformance[]>([]);
  const virtualTradesRef = useRef<VirtualTrade[]>([]);
  const performanceRef = useRef<RobotPerformance[]>([]);

  // Estados da nova lógica de piloto
  const [autopilotStatus, setAutopilotStatus] = useState<AutopilotStatus>('PAUSED');
  const [warmupTimeLeft, setWarmupTimeLeft] = useState(WARMUP_DURATION_MS);
  const [championRobotId, setChampionRobotId] = useState<string | null>(null);
  const [recoveryState, setRecoveryState] = useState({
    isActive: false,
    martingaleLevel: 0,
    stakeToRecover: 0,
  });
  const processedLossesRef = useRef<Set<number>>(new Set());
  const autopilotStartTimeRef = useRef<number | null>(null);
  const warmupIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    performanceRef.current = robotPerformance;
  }, [robotPerformance]);
  
  useEffect(() => {
    const initialPerformance = councilStrategies.map(strat => ({
      id: strat.id,
      strategyType: strat.type,
      strategy: { description: strat.description } as any,
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
        const priceString = tick.price.toFixed(activeAsset?.pip ?? 2);
        const lastChar = priceString.slice(-1);
        const digit = parseInt(lastChar, 10);
        if (!isNaN(digit)) {
            counts[digit]++;
        }
    });

    const total = counts.reduce((a, b) => a + b, 0);
    return counts.map((count, i) => ({
      digit: i,
      count: count,
      probability: total > 0 ? (count / total) * 100 : 10,
    }));
  }, [priceTicks, activeAsset]);

  const toggleAutopilot = useCallback(() => {
    setIsCouncilAutopilotOn(prev => {
      const isActivating = !prev;
      if (isActivating) {
        setAutopilotStatus('WARMING_UP');
        autopilotStartTimeRef.current = Date.now();
        setWarmupTimeLeft(WARMUP_DURATION_MS);
        if (warmupIntervalRef.current) clearInterval(warmupIntervalRef.current);
        warmupIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - (autopilotStartTimeRef.current || Date.now());
          setWarmupTimeLeft(Math.max(0, WARMUP_DURATION_MS - elapsed));
        }, 1000);
        toast({ title: 'Piloto Automático Ativado', description: 'Período de aquecimento de 1 minuto iniciado.' });
      } else {
        setAutopilotStatus('PAUSED');
        if (warmupIntervalRef.current) clearInterval(warmupIntervalRef.current);
        setChampionRobotId(null);
        setRecoveryState({ isActive: false, martingaleLevel: 0, stakeToRecover: 0 });
        toast({ title: 'Piloto Automático Desativado' });
      }
      return isActivating;
    });
  }, [toast]);
  
  useEffect(() => {
    if (autopilotStatus === 'WARMING_UP' && warmupTimeLeft <= 0) {
      if (warmupIntervalRef.current) clearInterval(warmupIntervalRef.current);

      const eligibleRobots = robotPerformance.filter(r => (r.wins + r.losses) >= 5);
      if (eligibleRobots.length === 0) {
        toast({ title: 'Aquecimento Estendido', description: 'Nenhum robô com dados suficientes. Aguardando mais trades virtuais.' });
        autopilotStartTimeRef.current = Date.now();
        setWarmupTimeLeft(WARMUP_DURATION_MS);
        return;
      }

      const champion = eligibleRobots.reduce((best, current) => 
        (current.totalProfit > best.totalProfit) ? current : best
      );

      setChampionRobotId(champion.id);
      setAutopilotStatus('TRADING');
      toast({ title: '🏆 Campeão da Arena Selecionado!', description: `Robô '${champion.strategy.description}' assume o controlo.` });
    }
  }, [autopilotStatus, warmupTimeLeft, robotPerformance, toast]);
  
  useEffect(() => {
    const lastPilotTrade = operationsLog.find(op => op.initiator === 'Piloto' && !processedLossesRef.current.has(op.id) && op.status !== 'pending');
    if (!lastPilotTrade) return;

    processedLossesRef.current.add(lastPilotTrade.id);

    if (lastPilotTrade.status === 'lost') {
        if (recoveryState.isActive) {
            const nextLevel = recoveryState.martingaleLevel + 1;
            if (nextLevel > 2) {
                toast({ title: '🚨 Falha na Recuperação', description: 'Limite de Martingale atingido. Resetando para stake normal.', variant: 'destructive' });
                setRecoveryState({ isActive: false, martingaleLevel: 0, stakeToRecover: 0 });
                setAutopilotStatus('TRADING');
            } else {
                toast({ title: `⚠️ Recuperação Nível ${recoveryState.martingaleLevel} Falhou`, description: `Aumentando para nível ${nextLevel}.`, variant: 'destructive' });
                setRecoveryState(prev => ({ ...prev, martingaleLevel: nextLevel, stakeToRecover: prev.stakeToRecover + lastPilotTrade.stake }));
            }
        } else {
            toast({ title: '📉 Perda Detectada!', description: 'Ativando modo de recuperação de risco.', variant: 'destructive' });
            setRecoveryState({ isActive: true, martingaleLevel: 1, stakeToRecover: lastPilotTrade.stake });
            setAutopilotStatus('RECOVERING');
        }
    } else if (lastPilotTrade.status === 'won' && recoveryState.isActive) {
        toast({ title: '✅ Recuperação Bem-sucedida!', description: 'Voltando ao modo de trading normal.' });
        setRecoveryState({ isActive: false, martingaleLevel: 0, stakeToRecover: 0 });
        setAutopilotStatus('TRADING');
    }
  }, [operationsLog, recoveryState.isActive, toast]);

  const autopilotExecutionRef = useRef(false);
  useEffect(() => {
    if (!isCouncilAutopilotOn || !activeSymbol || autopilotExecutionRef.current) return;
    if (autopilotStatus !== 'TRADING' && autopilotStatus !== 'RECOVERING') return;

    const runAutopilot = async () => {
        autopilotExecutionRef.current = true;
        
        const champion = robotPerformance.find(r => r.id === championRobotId);
        if (!champion) {
            autopilotExecutionRef.current = false;
            return;
        }

        const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
        const mostProbable = sortedByProb[0];
        
        let signalType: CouncilStrategy['type'] | null = null;
        let predictionDigit: number | undefined;

        if (champion.id === 'diff_most_freq') {
            const threshold = recoveryState.isActive ? 40 : consensusThreshold;
            if (mostProbable.probability > threshold) {
                signalType = 'DIGITDIFF';
                predictionDigit = mostProbable.digit;
            }
        }

        if (signalType) {
            const stake = recoveryState.isActive ? (0.35 * Math.pow(2, recoveryState.martingaleLevel)) : 0.35;
            await executeTrade(signalType, stake, activeSymbol, 5, 't', 'Piloto', predictionDigit);
        }

        setTimeout(() => { autopilotExecutionRef.current = false; }, 2000);
    };

    runAutopilot();
  }, [isCouncilAutopilotOn, autopilotStatus, championRobotId, digitStats, consensusThreshold, activeSymbol, executeTrade, recoveryState, robotPerformance]);

  useEffect(() => {
    if (priceTicks.length < 2) return;
    const currentTick = priceTicks[priceTicks.length - 1];
    const tradesToRemove: string[] = [];
    let performanceChanged = false;

    virtualTradesRef.current.forEach(trade => {
      if (currentTick.epoch >= trade.exitEpoch) {
        tradesToRemove.push(trade.id);
        const exitTick = priceTicks.find(t => t.epoch >= trade.exitEpoch) || currentTick;
        const priceString = exitTick.price.toFixed(activeAsset?.pip ?? 2);
        const lastDigit = parseInt(priceString.slice(-1), 10);
        
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
          const payoutRate = trade.contractType === 'DIGITMATCH' ? 8.09 : 0.099;
          perf.wins = (perf.wins || 0) + (isWin ? 1 : 0);
          perf.losses = (perf.losses || 0) + (isWin ? 0 : 1);
          perf.totalProfit = (perf.totalProfit || 0) + (isWin ? (0.35 * payoutRate) : -0.35);
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
  }, [priceTicks, activeAsset]);

  useEffect(() => {
    if (!isCouncilAutopilotOn || priceTicks.length < 100) return;

    const currentTick = priceTicks[priceTicks.length - 1];
    const sortedByProb = [...digitStats].sort((a, b) => b.probability - a.probability);
    const mostProbable = sortedByProb[0];
    const leastProbable = sortedByProb[sortedByProb.length - 1];
    
    const sumProb = (digits: number[]) => digits.reduce((sum, d) => sum + (digitStats.find(s => s.digit === d)?.probability || 0), 0);
    const probOver4 = sumProb([5,6,7,8,9]);
    const probUnder5 = sumProb([0,1,2,3,4]);
    const probEven = sumProb([0,2,4,6,8]);
    const probOdd = sumProb([1,3,5,7,9]);

    councilStrategies.forEach(strategy => {
      if (virtualTradesRef.current.some(t => t.robotId === strategy.id)) return;

      let shouldTrade = false;
      let prediction = strategy.prediction;

      switch (strategy.id) {
        case 'diff_most_freq':
          if (mostProbable.probability > 15) {
             shouldTrade = true;
             prediction = mostProbable.digit;
          }
          break;
        case 'match_least_freq':
           if (leastProbable.probability < 8) {
             shouldTrade = true;
             prediction = leastProbable.digit;
          }
          break;
        case 'over_4': if (probOver4 > 55) shouldTrade = true; break;
        case 'under_5': if (probUnder5 > 55) shouldTrade = true; break;
        case 'even': if (probEven > 55) shouldTrade = true; break;
        case 'odd': if (probOdd > 55) shouldTrade = true; break;
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
  
  return {
    isCouncilAutopilotOn,
    dailyBalance, setDailyBalance,
    dailyTarget, setDailyTarget,
    consensusThreshold, setConsensusThreshold,
    digitStats,
    robotPerformance,
    evolutionHistory: [], // Placeholder
    toggleAutopilot,
    autopilotStatus,
    warmupTimeLeft,
    championRobotId,
    recoveryState,
  };
}
