// src/features/trading/hooks/use-ai-quant-terminal-v3.tsx
'use client';

/**
 * @fileOverview TERMINAL QUANT V3.9.5 (COUNCIL EDITION)
 * V3.9.5: Posições Órfãs, Backtest Pagina e Sentinela Histerese.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TickData, CandleData, OperationInitiator, DurationUnit, Operation, OllamaConfig } from '@/lib/types';
import { useDerivApiV2 as useDerivApi, type AccountType, type ApiHistoricalData } from './use-deriv-api-v2';
import { calculateAllIndicators } from '../services/indicator-service';
import { initialCouncilStrategies } from '../services/council-strategies';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { TradeMemoryManager } from '../services/trade-memory-service';
import { runQuantCouncil, MIN_EXEC_CONFIDENCE } from '../services/quant-council-engine';
import { CouncilDecision, TradeMemoryBuffer, AgentOpinion, CouncilTelemetry, AllowedContractsV3, AllowedActionsV3, PortfolioRiskState, AssetExecutionPermission } from '../types/council';
import { getOllamaResponse } from '@/app/actions';
import { computeSignalFeatures, evaluateSignals, SIGNAL_TRIGGER_SCORE, type SignalCandidate, type SignalFeatures } from '../services/signal-engine';
import { backtestCandles, mergeStats, type RuleReport } from '../services/backtest';

const SETTINGS_KEY = 'quantV3Settings';
const REAL_MARKET_RE = /^(frx|cry|OTC_)/;

const AGENT_PERSONAS = {
  CHAIRMAN: "o CHAIRMAN do conselho: sintetiza a visão técnica de forma executiva",
  MOMENTUM: "o analista QUANT MOMENTUM: força do preço, momentum e velocidade",
  RISK_CRITIC: "o RISK CRITIC: cético, aponta riscos e razões para NÃO operar",
  ARCHIVIST: "o PATTERN ARCHIVIST: memória de trades e padrões passados"
};

export interface RadarAssetStatus {
    symbol: string;
    lastAction: 'RISE' | 'FALL' | 'HOLD';
    lastPrice?: number;
    confidence: number;
    timestamp: number;
    isQualified: boolean;
    executedVia: string;
    opinions: AgentOpinion[];
    recommendedContract?: string;
    holdReason?: string;
    debugVotes?: string;
    indicators?: {
        rsi: number;
        bbw: number;
        adx: number;
    };
    isFallback?: boolean;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    time: string;
    agentName?: string;
    isError?: boolean;
}

export interface LogEntry {
    ts: string; 
    time: string;
    message: string;
    type: 'info' | 'decision' | 'execution' | 'error' | 'warning' | 'radar' | 'sentinel';
    details?: string[];
    symbol?: string;
}

export interface CouncilStats {
    total: number;
    call: number;
    put: number;
    hold: number;
    vetoes: number;
    fallbacks: number;
    avgLatencyMs: number;
}

const isOrphanOp = (op: Operation) => {
    const ageMs = Date.now() - new Date(op.timestamp).getTime();
    const isExpired = op.expirationTime && Date.now() > op.expirationTime + 60000;
    const isVeryOld = ageMs > 24 * 3600 * 1000;
    return isExpired || isVeryOld;
};

const groupOf = (sym: string) => REAL_MARKET_RE.test(sym) ? 'REAIS' : 'SINTETICOS';

export function useAIQuantTerminalV3(
    activeSymbol: string | null,
    priceTicks: TickData[],
    chartData: CandleData[]
) {
    const { 
        isConnected, executeTrade, operationsLog, accountBalance, 
        watchedSymbols, setWatchedSymbols, multiAssetCandles, 
        clearActiveContracts, accountType, setAccountType,
        botCandleData, durationLimits, getHistoricalData 
    } = useDerivApi();
    const { user } = useAuth();
    const { toast } = useToast();

    // ESTADOS DE CONTROLE
    const [isAutoMode, setIsAutoMode] = useState(false);
    const [isShadowMode, setIsShadowMode] = useState(true);

    // CONFIGURAÇÕES (PERSISTENTES)
    const [analysisInterval, setAnalysisInterval] = useState(120); 
    const [backgroundIntervalSec, setBackgroundIntervalSec] = useState(60);
    const [sentinelIntervalSec, setSentinelIntervalSec] = useState(1);
    const [stakeValue, setStakeValue] = useState(1.0);
    const [maxConcurrentTrades, setMaxConcurrentTrades] = useState(5);
    const [dailyBalance, setDailyBalance] = useState(10.0);
    const [dailyTarget, setDailyTarget] = useState(5.0);
    const [allowedActions, setAllowedActions] = useState<AllowedActionsV3>({ 'CALL': true, 'PUT': true });
    const [allowedContracts, setAllowedContracts] = useState<AllowedContractsV3>({ 'OPTIONS': true, 'ACCUMULATORS': true, 'MULTIPLIERS': true });

    const [timeToNextAnalysis, setTimeToNextAnalysis] = useState(0);
    const [lastDecision, setLastDecision] = useState<CouncilDecision | null>(null);
    const [councilStats, setCouncilStats] = useState<CouncilStats>({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
    
    // BACKTEST
    const [backtest, setBacktest] = useState<{
        running: boolean;
        progress: string;
        ts: number | null;
        payoutPct: number;
        merged: Record<string, { recent: RuleReport[] | null, older: RuleReport[] | null }>;
        perAsset: Record<string, { recent: RuleReport[], older?: RuleReport[] }>;
        assetCounts: Record<string, number>;
    }>({ running: false, progress: '', ts: null, payoutPct: 85, merged: {}, perAsset: {}, assetCounts: {} });

    // LOGS E TELEMETRIA
    const [reasoningLog, setReasoningLog] = useState<LogEntry[]>([]);
    const [telemetry, setTelemetry] = useState<CouncilTelemetry>({
        avgTokensPerSec: 0,
        totalTokens: 0,
        consensusEntropy: 0,
        jitterMs: 0,
        inferenceHealth: 100
    });
    
    // MEMÓRIA E RADAR
    const [memoryBuffer, setMemoryBuffer] = useState<TradeMemoryBuffer>({ wins: [], losses: [] });
    const [radarStatus, setRadarStatus] = useState<Record<string, RadarAssetStatus>>({});
    const [sentinel, setSentinel] = useState<Record<string, { features: SignalFeatures | null, candidates: SignalCandidate[], ts: number }>>({});
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isChatLoading, setIsChatLoading] = useState(false);

    // REFS PARA ESTABILIDADE
    const chartDataRef = useRef(chartData);
    const multiAssetCandlesRef = useRef(multiAssetCandles);
    const watchedSymbolsRef = useRef(watchedSymbols);
    const activeSymbolRef = useRef(activeSymbol);
    const analysisIntervalRef = useRef(analysisInterval);
    const backgroundIntervalRef = useRef(backgroundIntervalSec);
    const priceTicksRef = useRef(priceTicks);
    const operationsLogRef = useRef(operationsLog);
    const scheduleRef = useRef<Record<string, number>>({});
    const executionLockRef = useRef(false);
    const botCandleDataRef = useRef(botCandleData);
    const durationLimitsRef = useRef(durationLimits);
    const lastDecisionBySymbolRef = useRef<Record<string, { ts: number, decision: CouncilDecision }>>({});
    const chatBusyRef = useRef(false);
    const pendingChatOrderRef = useRef<{ symbol: string, ts: number } | null>(null);
    const lastSkipLogRef = useRef<Record<string, number>>({});
    const sentinelEpisodeRef = useRef<Record<string, { start: number, lastAbove: number, peak: number }>>({});
    const [sentinelCounts, setSentinelCounts] = useState<Record<string, number>>({ OPTIONS: 0, MULTIPLIERS: 0, ACCUMULATORS: 0 });
    const interlockLoggedRef = useRef(false);

    const executeTradeRef = useRef(executeTrade);
    useEffect(() => { executeTradeRef.current = executeTrade; }, [executeTrade]);

    useEffect(() => { chartDataRef.current = chartData; }, [chartData]);
    useEffect(() => { multiAssetCandlesRef.current = multiAssetCandles; }, [multiAssetCandles]);
    useEffect(() => { watchedSymbolsRef.current = watchedSymbols; }, [watchedSymbols]);
    useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);
    useEffect(() => { analysisIntervalRef.current = analysisInterval; }, [analysisInterval]);
    useEffect(() => { backgroundIntervalRef.current = backgroundIntervalSec; }, [backgroundIntervalSec]);
    useEffect(() => { priceTicksRef.current = priceTicks; }, [priceTicks]);
    useEffect(() => { operationsLogRef.current = operationsLog; }, [operationsLog]);
    useEffect(() => { botCandleDataRef.current = botCandleData; }, [botCandleData]);
    useEffect(() => { durationLimitsRef.current = durationLimits; }, [durationLimits]);

    const [ollamaConfig, setOllamaConfigState] = useState<OllamaConfig | null>(null);
    const [availableModels, setAvailableModels] = useState<any[]>([]);
    
    // PERSISTÊNCIA DE CONFIGURAÇÕES
    useEffect(() => {
        const savedOllama = localStorage.getItem('ollamaConfig');
        if (savedOllama) {
            try { setOllamaConfigState(JSON.parse(savedOllama) as OllamaConfig); } catch (e) { console.error(e); }
        }

        const savedSettings = localStorage.getItem(SETTINGS_KEY);
        if (savedSettings) {
            try {
                const s = JSON.parse(savedSettings);
                if (s.analysisInterval) setAnalysisInterval(s.analysisInterval);
                if (s.backgroundIntervalSec) setBackgroundIntervalSec(s.backgroundIntervalSec);
                if (s.sentinelIntervalSec) setSentinelIntervalSec(s.sentinelIntervalSec);
                if (s.stakeValue) setStakeValue(s.stakeValue);
                if (s.maxConcurrentTrades) setMaxConcurrentTrades(s.maxConcurrentTrades);
                if (s.dailyBalance) setDailyBalance(s.dailyBalance);
                if (s.dailyTarget) setDailyTarget(s.dailyTarget);
                if (s.allowedActions) setAllowedActions(s.allowedActions);
                if (s.allowedContracts) setAllowedContracts(s.allowedContracts);
            } catch (e) { console.error("Falha ao carregar settings", e); }
        }
    }, []);

    // SEGURANÇA DE MODO: SHADOW -> REAL
    const prevShadowModeRef = useRef(isShadowMode);
    useEffect(() => {
        if (prevShadowModeRef.current === true && isShadowMode === false) {
            setIsAutoMode(false);
            setReasoningLog(prev => [{
                ts: `modo-${Date.now()}`,
                time: new Date().toLocaleTimeString(),
                message: "[MODO] REAL ativado: piloto automático desligado por segurança. Ligue manualmente se desejar.",
                type: 'warning'
            }, ...prev].slice(0, 300));
        }
        prevShadowModeRef.current = isShadowMode;
    }, [isShadowMode]);

    // MÉTRICAS DE PERFORMANCE (Agregadas)
    const sessionStats = useMemo(() => {
        const finishedTrades = operationsLog.filter(op => 
            op.status !== 'pending' && op.initiator === 'Conselho_V3'
        );
        const wins = finishedTrades.filter(op => op.status === 'won').length;
        const total = finishedTrades.length;
        const winRate = total > 0 ? (wins / total) * 100 : null;
        const pnl = finishedTrades.reduce((acc, op) => acc + (Number(op.result) || 0), 0);
        return { pnl: Number(pnl) || 0, winRate, total };
    }, [operationsLog]);

    useEffect(() => {
        const settings = {
            analysisInterval, backgroundIntervalSec, sentinelIntervalSec,
            stakeValue, maxConcurrentTrades, dailyBalance, dailyTarget,
            allowedActions, allowedContracts
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }, [analysisInterval, backgroundIntervalSec, sentinelIntervalSec, stakeValue, maxConcurrentTrades, dailyBalance, dailyTarget, allowedActions, allowedContracts]);

    const addLog = useCallback((message: string, type: LogEntry['type'] = 'info', details?: string[], symbol?: string) => {
        setReasoningLog(prev => [{
            ts: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
            time: new Date().toLocaleTimeString(),
            message,
            type,
            details,
            symbol
        }, ...prev].slice(0, 300));
    }, []);

    const getCandlesFor = useCallback((symbol: string): CandleData[] => {
        const multi = multiAssetCandlesRef.current[symbol];
        if (multi && multi.length >= 30) return multi as CandleData[];
        if (symbol === activeSymbolRef.current && botCandleDataRef.current.length >= 30)
            return botCandleDataRef.current;
        return (multi ?? []) as CandleData[];
    }, []);

    const fetchCandlesPaged = async (sym: string, target: number): Promise<CandleData[]> => {
        let all: CandleData[] = [];
        let endEpoch: number | undefined = undefined;
        
        for (let pageIdx = 0; pageIdx < 40; pageIdx++) {
            const count = Math.min(5000, target - all.length);
            if (count <= 0) break;
            
            const page = await getHistoricalData(sym, 'candles', count, '1m', endEpoch);
            const valid = page.filter(h => h.open !== undefined && h.high !== undefined && h.low !== undefined && h.close !== undefined) as CandleData[];
            
            if (valid.length === 0) break;
            
            const minEpoch = Math.min(...valid.map(v => v.epoch));
            const existingMin = all.length > 0 ? Math.min(...all.map(a => a.epoch)) : Infinity;
            
            if (minEpoch >= existingMin && all.length > 0) break;

            all = [...valid, ...all].sort((a,b) => a.epoch - b.epoch);
            const uniqueMap = new Map<number, CandleData>();
            all.forEach(c => uniqueMap.set(c.epoch, c));
            all = Array.from(uniqueMap.values());
            
            endEpoch = minEpoch - 1;
            setBacktest(prev => ({ ...prev, progress: `Baixando ${sym}: ${all.length}/${target}` }));
            
            if (all.length >= target) break;
            await new Promise(r => setTimeout(r, 150));
        }
        return all;
    };

    const runBacktest = async (payoutPct = 85, targetCount = 40000, extraSymbols: string[] = []) => {
        if (backtest.running) return;
        setBacktest(prev => ({ ...prev, running: true, progress: 'Iniciando...', payoutPct, merged: {}, perAsset: {}, assetCounts: {} }));
        const perAsset: Record<string, { recent: RuleReport[], older?: RuleReport[] }> = {};
        const assetCounts: Record<string, number> = {};
        
        const baseSymbols = new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean));
        extraSymbols.forEach(s => { if(s.trim()) baseSymbols.add(s.trim()); });
        const symbols = Array.from(baseSymbols);

        try {
            for (const sym of symbols) {
                if (!sym) continue;
                setBacktest(prev => ({ ...prev, progress: `Baixando ${sym}...` }));
                const candles = await fetchCandlesPaged(sym, targetCount);
                const n = candles.length;
                assetCounts[sym] = n;
                
                if (n < 1000) {
                    addLog(`[BACKTEST] ${sym}: histórico insuficiente (${n}/1000).`, 'warning');
                    continue;
                }

                const dataIni = new Date(candles[0].epoch * 1000).toLocaleDateString();
                const dataFim = new Date(candles[n - 1].epoch * 1000).toLocaleDateString();
                const dias = ((candles[n-1].epoch - candles[0].epoch) / 86400).toFixed(1);
                addLog(`[BACKTEST] ${sym}: ${n} candles (${dias} dias, de ${dataIni} a ${dataFim})`, 'info', undefined, sym);

                if (n >= 30000) {
                    const mid = Math.floor(n / 2);
                    const olderCandles = candles.slice(0, mid);
                    const recentCandles = candles.slice(mid);
                    
                    setBacktest(prev => ({ ...prev, progress: `Calculando ${sym} (período Recente)...` }));
                    const recentReport = backtestCandles(recentCandles as any, { payoutPct });
                    await new Promise(r => setTimeout(r, 0));
                    
                    setBacktest(prev => ({ ...prev, progress: `Calculando ${sym} (período Anterior)...` }));
                    const olderReport = backtestCandles(olderCandles as any, { payoutPct });
                    
                    perAsset[sym] = { recent: recentReport, older: olderReport };
                } else {
                    setBacktest(prev => ({ ...prev, progress: `Calculando ${sym} (${n} candles)...` }));
                    perAsset[sym] = { recent: backtestCandles(candles as any, { payoutPct }) };
                }
            }

            const groups = ['SINTETICOS', 'REAIS'];
            const merged: Record<string, { recent: RuleReport[] | null, older: RuleReport[] | null }> = {};

            groups.forEach(g => {
                const assetsInGroup = Object.keys(perAsset).filter(sym => groupOf(sym) === g);
                if (assetsInGroup.length === 0) return;

                const recentReports = assetsInGroup.map(sym => perAsset[sym].recent);
                const olderReports = assetsInGroup.map(sym => perAsset[sym].older).filter(Boolean) as RuleReport[][];

                merged[g] = {
                    recent: mergeStats(recentReports, payoutPct),
                    older: olderReports.length > 0 ? mergeStats(olderReports, payoutPct) : null
                };

                // Logs formatados
                const logGroup = (period: 'RECENTE' | 'ANTERIOR', reports: RuleReport[]) => {
                    reports.forEach(r => {
                        const { n, rate, lo, hi } = r.stat;
                        const b = (r.baseline * 100).toFixed(1);
                        const moveStr = r.move ? ` | mov=${r.move.mean.toFixed(3)} ATR t=${r.move.t.toFixed(1)}` : '';
                        const msg = `[BACKTEST] [${g}] [${period}] ${r.rule}: n=${n} acerto=${(rate*100).toFixed(1)}% IC95[${(lo*100).toFixed(0)}%, ${(hi*100).toFixed(0)}%] base=${b}%${moveStr} → ${r.verdict}`;
                        
                        const details = [
                            ...r.buckets.map(b => `${b.label}: ${(b.stat.rate * 100).toFixed(1)}% (n=${b.stat.n})`),
                            '--- Por Ativo ---',
                            ...assetsInGroup.map(sym => {
                                const rep = (period === 'RECENTE' ? perAsset[sym].recent : perAsset[sym].older)?.find(x => x.rule === r.rule);
                                return `${sym}: ${((rep?.stat.rate ?? 0) * 100).toFixed(1)}% (n=${rep?.stat.n || 0})`;
                            })
                        ];
                        addLog(msg, 'info', details);
                    });
                };

                if (merged[g].recent) logGroup('RECENTE', merged[g].recent!);
                if (merged[g].older) logGroup('ANTERIOR', merged[g].older!);
            });

            setBacktest(prev => ({ ...prev, merged, perAsset, assetCounts, ts: Date.now(), progress: '' }));

        } catch (e: any) {
            addLog(`[BACKTEST] Erro fatal: ${e.message}`, 'error');
        } finally {
            setBacktest(prev => ({ ...prev, running: false, progress: '' }));
        }
    };

    const buildBacktestReport = useCallback(() => {
        if (Object.keys(backtest.merged).length === 0) return "Nenhum backtest realizado.";
        let report = `RELATÓRIO DE BACKTEST (Dividido em metades quando n >= 30k)\n\n`;
        
        Object.entries(backtest.merged).forEach(([group, periods]) => {
            report += `### MERCADOS: ${group}\n`;
            if (periods.recent) {
                report += `PERÍODO RECENTE:\n`;
                periods.recent.forEach(r => {
                    const moveStr = r.move ? ` | mov=${r.move.mean.toFixed(3)} ATR` : '';
                    report += `- ${r.rule}: n=${r.stat.n} acerto=${(r.stat.rate*100).toFixed(1)}% base=${(r.baseline*100).toFixed(1)}%${moveStr} -> ${r.verdict}\n`;
                });
            }
            if (periods.older) {
                report += `PERÍODO ANTERIOR (CONFIRMAÇÃO):\n`;
                periods.older.forEach(r => {
                    const moveStr = r.move ? ` | mov=${r.move.mean.toFixed(3)} ATR` : '';
                    report += `- ${r.rule}: n=${r.stat.n} acerto=${(r.stat.rate*100).toFixed(1)}% base=${(r.baseline*100).toFixed(1)}%${moveStr} -> ${r.verdict}\n`;
                });
            }
            report += '\n';
        });

        report += `Observações:\nn conta episódios (anti-sobreposição de 5 candles).\nOpções = direção do candle de 60s seguinte; Multiplicadores = direção após 5 candles (sem TP/SL); Acumuladores = proxy de calma (não é o contrato real). Payout assumido ${backtest.payoutPct}%. Várias regras/faixas aumentam a chance de falso positivo.`;
        return report;
    }, [backtest]);

    // SENTINEL MONITOR (1s)
    useEffect(() => {
        const interval = setInterval(() => {
            const symbols = Array.from(new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean)));
            const newSentinel: Record<string, any> = {};
            const now = Date.now();

            symbols.forEach(sym => {
                if (!sym) return;
                const candles = getCandlesFor(sym);
                const features = computeSignalFeatures(candles as any);
                const candidates = features ? evaluateSignals(sym, features) : [];
                
                newSentinel[sym] = { features, candidates, ts: now };

                candidates.forEach(c => {
                    const logKey = `${sym}-${c.contract}`;
                    const episode = sentinelEpisodeRef.current[logKey];
                    const HYS = 10; // Histerese

                    if (c.score >= SIGNAL_TRIGGER_SCORE && !episode) {
                        sentinelEpisodeRef.current[logKey] = { start: now, lastAbove: now, peak: c.score };
                        setSentinelCounts(prev => ({ ...prev, [c.contract]: prev[c.contract] + 1 }));
                        addLog(`[SENTINEL] ${sym} ${c.contract} ${c.direction} score=${c.score} rule=${c.rule} (${c.reasons.join(', ')})`, 'sentinel', undefined, sym);
                    } else if (episode) {
                        if (c.score >= SIGNAL_TRIGGER_SCORE - HYS) {
                            episode.lastAbove = now;
                            episode.peak = Math.max(episode.peak, c.score);
                        } else if (now - episode.lastAbove > 30000) {
                            const durS = Math.round((now - episode.start) / 1000);
                            addLog(`[SENTINEL-FIM] ${sym} ${c.contract} duração ${durS}s pico ${episode.peak}`, 'sentinel', undefined, sym);
                            delete sentinelEpisodeRef.current[logKey];
                        }
                    }
                });
            });

            setSentinel(newSentinel);
        }, sentinelIntervalSec * 1000);

        return () => clearInterval(interval);
    }, [getCandlesFor, addLog, sentinelIntervalSec]);

    const runAnalysisForSymbol = useCallback(async (symbol: string, candles: CandleData[], isManualTrigger: boolean = false): Promise<CouncilDecision | undefined> => {
        if (!isConnected) { addLog(`[SKIP] ${symbol}: WebSocket desconectado.`, 'warning', undefined, symbol); return undefined; }
        if (!ollamaConfig) { addLog(`[SKIP] ${symbol}: ollamaConfig ausente.`, 'warning', undefined, symbol); return undefined; }
        if (candles.length < 30) { addLog(`[SKIP] ${symbol}: candles insuficientes (${candles.length}/30).`, 'warning', undefined, symbol); return undefined; }
        if (!user) { addLog(`[SKIP] ${symbol}: usuário nulo.`, 'warning', undefined, symbol); return undefined; }
        
        const isFocused = symbol === activeSymbolRef.current;
        
        try {
            const buffer = await TradeMemoryManager.getBuffer(user.uid, symbol);
            const indicators = calculateAllIndicators(candles, [], '1m', { duration: 15, unit: 's' });
            
            if (!indicators || !Number.isFinite(indicators.rsi)) {
                addLog(`[SKIP-DADOS] ${symbol}: indicadores inválidos.`, 'warning', undefined, symbol);
                return undefined;
            }

            const feats = computeSignalFeatures(candles as any);
            const trend = (indicators.adx || 0) > 25 ? 'Trending' : 'Ranging';
            const currentPrice = isFocused 
                ? (priceTicksRef.current[priceTicksRef.current.length - 1]?.price ?? candles[candles.length - 1]?.close)
                : candles[candles.length - 1].close;

            const snapshot = {
                symbol, price: currentPrice, rsi: feats?.rsi ?? indicators.rsi, bbw: indicators.bbw, adx: indicators.adx, trend,
                ...(feats ? { bbPos: feats.bbPos, bwPct: feats.bwPct, atrRatio: feats.atrRatio, er: feats.er, mom5: feats.mom5, mom15: feats.mom15, streak: feats.streak } : {})
            };

            const nonOrphanOps = operationsLogRef.current.filter(op => !isOrphanOp(op));
            const portfolioState: PortfolioRiskState = {
                openPositions: nonOrphanOps.filter(op => op.status === 'pending').length,
                maxConcurrentPositions: maxConcurrentTrades,
                totalExposure: nonOrphanOps.filter(op => op.status === 'pending').reduce((sum, op) => sum + op.stake, 0),
                maxTotalExposure: dailyBalance,
                lockedSymbols: new Set(),
                plannedStake: stakeValue
            };

            const initialPermissions: AssetExecutionPermission = {
                symbol, enabled: true, maxStake: stakeValue * 2,
                allowedContracts: Object.keys(allowedContracts).filter(k => allowedContracts[k as keyof typeof allowedContracts]) as any[],
                allowedActions: Object.keys(allowedActions).filter(k => allowedActions[k as keyof typeof allowedActions]) as any[]
            };

            if (!isShadowMode) {
              const filteredContracts = initialPermissions.allowedContracts.filter(c => c === 'OPTIONS');
              if (filteredContracts.length < initialPermissions.allowedContracts.length) {
                if (!interlockLoggedRef.current) {
                   addLog(`[INTERLOCK] Bloqueando categorias sem saída automática em modo REAL.`, 'warning', undefined, symbol);
                   interlockLoggedRef.current = true;
                }
                initialPermissions.allowedContracts = filteredContracts as any;
              }
            }

            const decision = await runQuantCouncil(snapshot, buffer, ollamaConfig, isShadowMode, isFocused, initialPermissions, portfolioState);
            lastDecisionBySymbolRef.current[symbol] = { ts: Date.now(), decision };
            
            const { finalAction: action, consensusConfidence: conf, executedVia: via, recommendedContract: contract, debugVotes: votes, t2tLatencyMs: lat } = decision;

            addLog(`[CONSELHO] ${symbol}: ${action} ${conf}% | ${contract} | via=${via} | votos[${votes}] | ${lat}ms`, 'decision', 
                [`ENTRADA: ${JSON.stringify(snapshot)}`, ...(decision.trace ?? []), decision.holdReason ? `MOTIVO HOLD: ${decision.holdReason}` : ''].filter(Boolean), symbol);

            if (isFocused) {
                setLastDecision(decision);
                setTelemetry(decision.telemetry);
            }

            setRadarStatus(prev => ({
                ...prev,
                [symbol]: {
                    symbol, lastAction: decision.finalAction, lastPrice: currentPrice, confidence: decision.consensusConfidence,
                    timestamp: Date.now(), isQualified: decision.finalAction !== 'HOLD' && decision.consensusConfidence >= MIN_EXEC_CONFIDENCE,
                    executedVia: decision.executedVia, opinions: decision.opinions, 
                    recommendedContract: decision.finalAction === 'HOLD' ? '—' : decision.recommendedContract,
                    holdReason: decision.holdReason, debugVotes: decision.debugVotes,
                    indicators: { rsi: snapshot.rsi || 50, bbw: indicators.bbw || 0, adx: indicators.adx || 0 },
                    isFallback: decision.executedVia === 'MATH_FALLBACK'
                }
            }));

            setCouncilStats(prev => ({
                total: prev.total + 1,
                call: prev.call + (action === 'CALL' ? 1 : 0),
                put: prev.put + (action === 'PUT' ? 1 : 0),
                hold: prev.hold + (action === 'HOLD' ? 1 : 0),
                vetoes: prev.vetoes + (via === 'COUNCIL_VETO' ? 1 : 0),
                fallbacks: prev.fallbacks + (via === 'MATH_FALLBACK' ? 1 : 0),
                avgLatencyMs: prev.total === 0 ? lat : (prev.avgLatencyMs * 0.8) + (lat * 0.2)
            }));

            const shouldExecute = isManualTrigger || (isAutoMode && decision.finalAction !== 'HOLD' && decision.consensusConfidence >= MIN_EXEC_CONFIDENCE);

            if (shouldExecute && decision.finalAction !== 'HOLD') {
                let finalContractType = 'CALL';
                switch (decision.recommendedContract) {
                    case 'ACCUMULATORS': finalContractType = 'ACCU'; break;
                    case 'MULTIPLIERS': finalContractType = decision.finalAction === 'CALL' ? 'MULTUP' : 'MULTDOWN'; break;
                    default: finalContractType = decision.finalAction === 'CALL' ? 'CALL' : 'PUT';
                }

                const hasOpen = operationsLogRef.current.filter(o => !isOrphanOp(o)).some(op => op.asset === symbol && op.status === 'pending' && op.contractType === finalContractType);
                
                if (!hasOpen) {
                    const stake = Math.max(0.35, Number((stakeValue * (decision.stakeRatio || 1)).toFixed(2)));
                    if (isShadowMode) {
                        addLog(`[SHADOW] ${symbol}: ${decision.finalAction} simulado em modo sombra.`, 'radar', undefined, symbol);
                    } else {
                        const tradeDirection: 'rise' | 'fall' = decision.finalAction === 'CALL' ? 'rise' : 'fall';
                        const optionsDuration = (indicators.adx || 20) > 40 ? 10 : (indicators.adx || 20) > 25 ? 15 : 30;
                        const minS = durationLimitsRef.current?.s?.min ?? 15;
                        const finalDuration = decision.recommendedContract === 'OPTIONS' ? Math.max(minS, optionsDuration) : 15;

                        const res = await executeTradeRef.current(finalContractType, stake, symbol, tradeDirection, finalDuration, 's', 'Conselho_V3', `V3_${decision.executedVia}`);
                        if (res.success) addLog(`[EXEC] ${symbol} ${decision.finalAction} enviado. ID=${res.contractId}`, 'execution', undefined, symbol);
                        else addLog(`[EXEC-FALHA] ${symbol} ${finalContractType}: ${res.message}`, 'error', undefined, symbol);
                    }
                }
            }
            return decision;
        } catch (error: any) {
            if (isFocused) addLog(`Erro em ${symbol}: ${error.message}`, 'error', undefined, symbol);
            return undefined;
        }
    }, [isConnected, ollamaConfig, isShadowMode, user, isAutoMode, allowedContracts, allowedActions, maxConcurrentTrades, dailyBalance, addLog, stakeValue]);

    // RADAR SCANNER (5s)
    const runMultiAssetCycle = useCallback(async () => {
        if (executionLockRef.current || chatBusyRef.current || !isConnected || !ollamaConfig) {
            const now = Date.now();
            const reason = chatBusyRef.current ? 'chat em andamento' : !isConnected ? 'WebSocket desconectado' : !ollamaConfig ? 'ollamaConfig ausente' : null;
            if (reason && now - (lastSkipLogRef.current[reason] || 0) > 30000) {
                addLog(`[CICLO-PULADO] ${reason}`, 'warning');
                lastSkipLogRef.current[reason] = now;
            }
            return;
        }
        executionLockRef.current = true;

        const startTime = Date.now();
        try {
            const currentActive = activeSymbolRef.current;
            const watchListDue = watchedSymbolsRef.current.filter(sym => (scheduleRef.current[sym] || 0) <= startTime);
            const focusIsDue = currentActive && !watchListDue.includes(currentActive) && (scheduleRef.current[currentActive] || 0) <= startTime;
            const dueSymbols = focusIsDue ? [currentActive, ...watchListDue] : watchListDue;
            
            if (dueSymbols.length === 0) {
                executionLockRef.current = false;
                return;
            }

            addLog(`[CICLO] due=[${dueSymbols.join(', ')}]`, 'info');
            dueSymbols.sort((a, b) => (a === currentActive ? -1 : (b === currentActive ? 1 : 0)));

            for (const symbol of dueSymbols) {
                const candles = getCandlesFor(symbol);
                if (candles && candles.length >= 30) {
                    const isFoco = symbol === currentActive;
                    const nextInt = Math.max(10, isFoco ? analysisIntervalRef.current : backgroundIntervalRef.current);
                    scheduleRef.current[symbol] = Date.now() + nextInt * 1000;
                    try { await runAnalysisForSymbol(symbol, candles as CandleData[]); } catch (e: any) {}
                }
            }
        } finally {
            executionLockRef.current = false;
        }
    }, [isConnected, ollamaConfig, runAnalysisForSymbol, getCandlesFor, addLog]);

    const runMultiAssetCycleRef = useRef(runMultiAssetCycle);
    useEffect(() => { runMultiAssetCycleRef.current = runMultiAssetCycle; }, [runMultiAssetCycle]);

    useEffect(() => {
        const first = setTimeout(() => { runMultiAssetCycleRef.current(); }, 1500);
        const id = setInterval(() => { runMultiAssetCycleRef.current(); }, 5000);
        return () => { clearTimeout(first); clearInterval(id); };
    }, []);

    const resetSession = useCallback(() => {
        setIsAutoMode(false);
        setIsShadowMode(true);
        clearActiveContracts();
        setRadarStatus({});
        setReasoningLog([]);
        setChatMessages([]);
        setCouncilStats({ total: 0, call: 0, put: 0, hold: 0, vetoes: 0, fallbacks: 0, avgLatencyMs: 0 });
        scheduleRef.current = {};
        setLastDecision(null);
        setMemoryBuffer({ wins: [], losses: [] });
        interlockLoggedRef.current = false;
        setSentinelCounts({ OPTIONS: 0, MULTIPLIERS: 0, ACCUMULATORS: 0 });
        sentinelEpisodeRef.current = {};
        toast({ title: "Sessão Reiniciada", description: "Todos os dados voláteis foram limpos." });
    }, [clearActiveContracts, toast]);

    const getScoreLabel = (cat: string, cands: SignalCandidate[]) => {
        const c = cands.find(x => x.contract === cat);
        if (!c) return "--";
        const arrow = c.direction === 'CALL' ? '↑CALL' : (c.direction === 'PUT' ? '↓PUT' : '');
        return `${c.score}${arrow}`;
    };

    const buildStatusReport = useCallback(() => {
        const nowStr = new Date().toLocaleTimeString('pt-BR', { hour12: false });
        const mode = isShadowMode ? 'SHADOW' : 'REAL';
        const pilot = isAutoMode ? 'ON' : 'OFF';
        const stats = councilStats;
        const nonOrphanOps = operationsLogRef.current.filter(o => !isOrphanOp(o));
        const positions = operationsLogRef.current.filter(o => o.status === 'pending');
        const symbols = Array.from(new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean)));
        
        let report = `RELATÓRIO ${nowStr} | ${mode} | piloto ${pilot} | conta ${accountType} | saldo $${accountBalance.balance}\n`;
        report += `Conselho: ${stats.total} avaliações | HOLD ${stats.total > 0 ? Math.round(stats.hold/stats.total*100) : 0}% | CALL ${stats.call} | PUT ${stats.put} | vetos ${stats.vetoes} | fallbacks ${stats.fallbacks} | ${(stats.avgLatencyMs/1000).toFixed(1)}s/ativo\n`;
        report += `Posições abertas: ${nonOrphanOps.filter(o => o.status === 'pending').length}/${maxConcurrentTrades}\n`;
        report += `Episódios do Sentinela: O ${sentinelCounts.OPTIONS} | M ${sentinelCounts.MULTIPLIERS} | A ${sentinelCounts.ACCUMULATORS}\n\n`;

        if (positions.length > 0) {
            report += `POSIÇÕES ABERTAS (${positions.length}):\n`;
            positions.forEach(op => {
                const ageMs = Date.now() - new Date(op.timestamp).getTime();
                const min = Math.floor(ageMs / 60000);
                const orphan = isOrphanOp(op);
                const ageStr = min > 1440 ? `${(min/1440).toFixed(1)}d` : `${min}min`;
                report += `- #${op.id} ${op.asset} ${op.contractType || 'OPTIONS'} $${op.stake} há ${ageStr} por ${op.initiator}${orphan ? ' (órfã, ignorada nos limites)' : ''}\n`;
            });
            report += "\n";
        }

        symbols.forEach(sym => {
            if (!sym) return;
            const sentData = sentinel[sym];
            const price = sentData?.features?.price ?? (getCandlesFor(sym).slice(-1)[0]?.close || 0);
            report += `${sym} $${price.toFixed(4)}\n`;
            if (sentData?.features) {
                const f = sentData.features;
                report += `  RSI ${f.rsi} | %B ${f.bbPos.toFixed(2)} | ER ${f.er.toFixed(2)} | vol x${f.atrRatio.toFixed(2)} | mom15 ${f.mom15.toFixed(1)} ATR | seq ${f.streak}\n`;
                report += `  Sentinela: Opções ${getScoreLabel('OPTIONS', sentData.candidates)} | Multiplicadores ${getScoreLabel('MULTIPLIERS', sentData.candidates)} | Acumuladores ${getScoreLabel('ACCUMULATORS', sentData.candidates)}\n`;
            }
            
            const hist = lastDecisionBySymbolRef.current[sym];
            if (hist) {
                const age = Math.round((Date.now() - hist.ts) / 1000);
                const d = hist.decision;
                const contractDisplay = d.finalAction === 'HOLD' ? '—' : d.recommendedContract;
                report += `  Conselho: há ${age}s ${d.finalAction} ${d.consensusConfidence}% ${contractDisplay} votos[${d.debugVotes}] ${d.holdReason ? d.holdReason.slice(0, 100) : ''}\n`;
            } else {
                report += `  Conselho: ainda não avaliou\n`;
            }
            report += `  Posições: ${nonOrphanOps.filter(o => o.status === 'pending' && o.asset === sym).length}\n\n`;
        });

        const candidates = Object.values(sentinel)
            .flatMap(s => s.candidates)
            .filter(c => c.score >= 55)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

        report += `MELHORES CANDIDATOS (score >= 55):\n`;
        if (candidates.length > 0) {
            candidates.forEach(c => {
                const hist = lastDecisionBySymbolRef.current[c.symbol];
                const lastAct = hist?.decision.finalAction || 'ainda não avaliou';
                report += `  ${c.symbol} ${c.contract} ${c.direction !== 'NONE' ? c.direction : 'sem direção'} score ${c.score} regra ${c.rule} (${c.reasons.join(', ')}) | Conselho: não avalia candidatos (última varredura periódica: ${lastAct})\n`;
            });
        } else {
            report += `  nenhum candidato acima do gatilho\n`;
        }

        report += `\nSinais são hipóteses sobre índices sintéticos aleatórios; validar no Shadow.`;
        return report;
    }, [isShadowMode, isAutoMode, accountType, accountBalance.balance, councilStats, maxConcurrentTrades, sentinel, getCandlesFor, sentinelCounts]);

    const buildAssetReport = useCallback((sym: string) => {
        const sentData = sentinel[sym];
        const hist = lastDecisionBySymbolRef.current[sym];
        const lastCandle = getCandlesFor(sym).slice(-1)[0];
        
        let report = `ANÁLISE DETALHADA: ${sym}\n`;
        report += `Preço: $${(lastCandle?.close || 0).toFixed(4)}\n\n`;

        if (sentData?.features) {
            const f = sentData.features;
            report += `MÉTRICAS AO VIVO:\n`;
            report += `- RSI: ${f.rsi}\n- %B (Posição Bandas): ${f.bbPos.toFixed(3)}\n- ER (Eficiência): ${f.er.toFixed(2)}\n- Volatilidade: x${f.atrRatio.toFixed(2)}\n- Momentum 15: ${f.mom15.toFixed(1)} ATR\n- Streak: ${f.streak}\n\n`;
            
            report += `SENTINELA (CANDIDATOS):\n`;
            sentData.candidates.forEach(c => {
                report += `- ${c.contract}: score ${c.score} [${c.rule}] -> ${c.reasons.join(', ')}\n`;
            });
            report += '\n';
        }

        if (hist) {
            const d = hist.decision;
            const age = Math.round((Date.now() - hist.ts) / 1000);
            const contractDisplay = d.finalAction === 'HOLD' ? '—' : d.recommendedContract;
            report += `ÚLTIMA DELIBERAÇÃO (há ${age}s):\n`;
            report += `Veredito: ${d.finalAction} ${d.consensusConfidence}% (${contractDisplay})\n`;
            if (d.holdReason) report += `Hold Reason: ${d.holdReason}\n`;
            
            report += `\nOPINIÕES DOS AGENTES:\n`;
            d.opinions.forEach(o => {
                report += `- ${o.agentName}: ${o.action} ${o.confidence}% ${o.action === 'HOLD' ? '—' : o.recommendedContract} — ${o.reasoning.slice(0, 160)}\n`;
            });

            if (d.trace && d.trace.length > 0) {
                report += `\nTRACE DO CHAIRMAN:\n`;
                d.trace.forEach(t => report += `  > ${t}\n`);
            }
        } else {
            report += `Conselho ainda não realizou varredura para este ativo.`;
        }

        return report;
    }, [sentinel, getCandlesFor]);

    const buildShortContextForLLM = useCallback(() => {
        const symbols = Array.from(new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean)));
        let context = "LEGENDA: Sentinela = pontuação 0-100 por tipo de contrato (Opções, Multiplicadores, Acumuladores); >= 55 é gatilho; ↑ CALL, ↓ PUT; Acumuladores não têm direção. %B 0-1 (posição nas bandas); ER 0-1 (1 = tendência limpa); vol xN = volatilidade atual / mediana; mom15 em ATRs.\n\n";
        
        symbols.forEach(sym => {
            if (!sym) return;
            const sentData = sentinel[sym];
            const price = sentData?.features?.price ?? 0;
            const hist = lastDecisionBySymbolRef.current[sym];
            
            context += `${sym}: $${price.toFixed(4)}\n`;
            if (sentData?.features) {
                const f = sentData.features;
                context += `  Metrics: RSI ${f.rsi} | %B ${f.bbPos.toFixed(2)} | ER ${f.er.toFixed(2)} | vol x${f.atrRatio.toFixed(2)} | mom15 ${f.mom15.toFixed(1)} | streak ${f.streak}\n`;
                context += `  Sentinel: O:${getScoreLabel('OPTIONS', sentData.candidates)} M:${getScoreLabel('MULTIPLIERS', sentData.candidates)} A:${getScoreLabel('ACCUMULATORS', sentData.candidates)}\n`;
            }
            if (hist) {
                const age = Math.round((Date.now() - hist.ts) / 1000);
                const d = hist.decision;
                const contractDisplay = d.finalAction === 'HOLD' ? '—' : d.recommendedContract;
                context += `  Council (${age}s ago): ${d.finalAction} ${d.consensusConfidence}% [${d.debugVotes}] ${d.holdReason || ''} contract=${contractDisplay}\n`;
            }
            context += "\n";
        });
        
        return context.slice(0, 2200);
    }, [sentinel]);

    const sendMessage = async (content: string, targetAgent: string = 'CHAIRMAN') => {
        if (!ollamaConfig || !content.trim() || !user) return;
        
        const time = new Date().toLocaleTimeString();
        const userMsg: ChatMessage = { role: 'user', content, time };
        setChatMessages(prev => [...prev, userMsg]);

        const CONFIRM = /^\s*confirmo[\s.!]*$/i;
        const CMD = /^\s*(por favor[, ]*)?(compre|comprar|venda|vender|execute|executar|opere|operar|abra|abrir|entre|entrar)\b\s*(.*)/i;
        const WHY = /(por\s?que|porque|motivo|explique|explica|como est[aá])/i;
        const REPORT = /(situa[cç][aã]o|status|auditoria|listagem|relat[oó]rio|resumo|quais ativos|que ativos|monitorando|oportunidades?|chances?|vantaj\w*|melhor(es)?|promissor\w*)/i;
        const BACKTEST_RE = /(backtest|retroteste|teste estat[ií]stic)/i;

        const symbols = Array.from(new Set([...watchedSymbolsRef.current, activeSymbolRef.current].filter(Boolean)));

        if (content.match(CONFIRM)) {
            if (pendingChatOrderRef.current && (Date.now() - pendingChatOrderRef.current.ts) < 60000 && !isShadowMode) {
                const sym = pendingChatOrderRef.current.symbol;
                const decision = await runAnalysisForSymbol(sym, getCandlesFor(sym), true);
                setChatMessages(prev => [...prev, { 
                    role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                    content: `[REAL] Execução para ${sym} via chat: ${decision?.finalAction} ${decision?.consensusConfidence}% via=${decision?.executedVia}.`
                }]);
                pendingChatOrderRef.current = null;
            } else {
                setChatMessages(prev => [...prev, { 
                    role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                    content: "Nenhum pedido pendente ou modo Real desativado."
                }]);
                pendingChatOrderRef.current = null;
            }
            return;
        }

        const cmdMatch = content.match(CMD);
        if (cmdMatch) {
            const found = symbols.filter(s => s && content.toUpperCase().includes(s.toUpperCase()));
            if (found.length === 0) {
                setChatMessages(prev => [...prev, { 
                    role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                    content: `Informe o ativo (ex.: compre 1HZ10V). Ativos monitorados: ${symbols.join(', ')}`
                }]);
            } else if (found.length > 1) {
                setChatMessages(prev => [...prev, { 
                    role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                    content: `Múltiplos ativos detectados (${found.join(', ')}). Por favor, escolha apenas UM para o comando.`
                }]);
            } else {
                const symbol = found[0];
                if (isShadowMode) {
                    const decision = await runAnalysisForSymbol(symbol, getCandlesFor(symbol), true);
                    setChatMessages(prev => [...prev, { 
                        role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                        content: `[SHADOW] Auditoria para ${symbol}: ${decision?.finalAction} ${decision?.consensusConfidence}% (${decision?.recommendedContract}) votos:[${decision?.debugVotes}] ${decision?.holdReason ? 'hold='+decision.holdReason : ''}`
                    }]);
                } else {
                    pendingChatOrderRef.current = { symbol, ts: Date.now() };
                    setChatMessages(prev => [...prev, { 
                        role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                        content: `⚠️ Ordem REAL para ${symbol} detectada. Digite "CONFIRMO" em até 60s para autorizar a execução. O Conselho decidirá a direção final.`
                    }]);
                }
            }
            return;
        }

        const hasSym = symbols.find(s => s && content.toUpperCase().includes(s.toUpperCase()));
        if (hasSym && content.match(WHY)) {
            setChatMessages(prev => [...prev, { 
                role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                content: buildAssetReport(hasSym)
            }]);
            return;
        }

        if (content.match(BACKTEST_RE)) {
            setChatMessages(prev => [...prev, { 
                role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                content: (Object.keys(backtest.merged).length > 0) ? buildBacktestReport() : "Rode o backtest no painel."
            }]);
            return;
        }

        if (content.match(REPORT)) {
            setChatMessages(prev => [...prev, { 
                role: 'assistant', agentName: 'SISTEMA', time: new Date().toLocaleTimeString(),
                content: buildStatusReport()
            }]);
            return;
        }

        setIsChatLoading(true);
        chatBusyRef.current = true;
        try {
            const context = buildShortContextForLLM();
            const persona = (AGENT_PERSONAS as any)[targetAgent] || AGENT_PERSONAS.CHAIRMAN;
            const systemPrompt = `Você é ${persona}. Responda em português do Brasil, em primeira pessoa.\n\n${context}\n\nREGRAS: usar somente estes dados; citar números; se faltar dado, dizer que não tem. Ao explicar uma decisão, cite os votos, os números e o motivo do HOLD. Não preveja preço (cenários "se X, então Y" como hipóteses); índices sintéticos aleatórios, nunca afirmar certeza de lucro; sinais são hipóteses a validar no Shadow. Até 120 palavras, salvo pedido de relatório.`;

            const response = await getOllamaResponse(ollamaConfig, content, [
                { role: 'system', content: systemPrompt }, 
                ...chatMessages.slice(-8).map(m => ({ role: m.role, content: m.content }))
            ]);
            
            if (response.success) {
                setChatMessages(prev => [...prev, { role: 'assistant', content: response.success!, time: new Date().toLocaleTimeString(), agentName: targetAgent }]);
            }
        } catch (error: any) {
            setChatMessages(prev => [...prev, { role: 'assistant', content: `Erro: ${error.message}.`, time: new Date().toLocaleTimeString(), agentName: 'SISTEMA', isError: true }]);
        } finally {
            chatBusyRef.current = false;
            setIsChatLoading(false);
        }
    };

    const updateOllamaConfig = (updates: Partial<OllamaConfig>) => {
        if (!ollamaConfig) return;
        const newConfig = { ...ollamaConfig, ...updates };
        setOllamaConfigState(newConfig);
        localStorage.setItem('ollamaConfig', JSON.stringify(newConfig));
    };

    const fetchAvailableModels = async () => {
        if (!ollamaConfig) return;
        try {
            const url = ollamaConfig.baseUrl.replace(/\/+$/, '') + '/api/tags';
            const headers: Record<string, string> = { 'ngrok-skip-browser-warning': 'true' };
            if (ollamaConfig.apiKey) {
                headers['Authorization'] = `Bearer ${ollamaConfig.apiKey}`;
            }
            const res = await fetch(url, { headers });
            if (res.ok) {
                const data = await res.json();
                setAvailableModels(data.models || []);
            }
        } catch (e) { console.error("Falha ao buscar modelos", e); }
    };

    useEffect(() => {
        const timer = setInterval(() => {
            const nextTs = scheduleRef.current[activeSymbolRef.current ?? ''] ?? Date.now();
            setTimeToNextAnalysis(Math.max(0, Math.round((nextTs - Date.now()) / 1000)));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return {
        isAutoMode, setIsAutoMode,
        isShadowMode, setIsShadowMode,
        lastDecision, timeToNextAnalysis, analysisInterval, setAnalysisInterval,
        backgroundIntervalSec, setBackgroundIntervalSec, sentinelIntervalSec, setSentinelIntervalSec,
        allowedActions, setAllowedActions,
        allowedContracts, setAllowedContracts, 
        maxConcurrentTrades, setMaxConcurrentTrades,
        stakeValue, setStakeValue, dailyBalance, setDailyBalance, dailyTarget, setDailyTarget,
        sessionStats, councilStats, reasoningLog, memoryBuffer, accountBalance, radarStatus, sentinel,
        watchedSymbols, setWatchedSymbols, resetSession, chatMessages, isChatLoading, sendMessage,
        executeManualDecision: () => activeSymbolRef.current && runAnalysisForSymbol(activeSymbolRef.current, getCandlesFor(activeSymbolRef.current), true),
        telemetry, ollamaConfig, availableModels, updateOllamaConfig, fetchAvailableModels,
        setAccountType, accountType, runBacktest, backtest
    };
}
