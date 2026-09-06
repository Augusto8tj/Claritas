// src/features/trading/hooks/use-deriv-api-v2.tsx
'use client';

// ESTE ARQUIVO É UMA CÓPIA DEDICADA PARA O SISTEMA V2.5
// ATUALIZADO COM INSTRUMENTAÇÃO DE DIAGNÓSTICO OPERACIONAL

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { savePredictiveTradeLog } from '@/services/financial-data-service';


const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_V2_LOG_KEY = 'derivV2OperationsLog_v2.5';
const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || "1089";

export type AccountType = 'demo' | 'real';

export interface AccountBalance {
  balance: number | null;
  currency: string | null;
  loading: boolean;
}

export type PromiseCallbacks = { 
  resolve: (value: any) => void; 
  reject: (reason?: any) => void 
};

export interface AssetGroup {
  label: string;
  options: Asset[];
}

export type ApiHistoricalData = {
    epoch: number;
    price?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
};

export interface ConnectionEvent {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success' | 'warning';
}

export interface DerivApiContextTypeV2 {
  ws: WebSocket | null;
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  demoToken: string | null;
  realToken: string | null;
  activeToken: string | null;
  accountType: AccountType;
  accountBalance: AccountBalance;
  operationsLog: Operation[];
  assetGroups: AssetGroup[];
  isAssetsLoading: boolean;
  
  // Data for consumers
  activeSymbol: string | null;
  setActiveSymbol: (symbol: string | null) => void;
  chartData: ChartData[];
  botCandleData: CandleData[];
  priceTicks: TickData[]; 
  isChartLoading: boolean;
  chartError: string | null;
  chartType: ChartType;
  setChartType: (type: ChartType) => void;
  timePeriod: TimePeriod;
  setTimePeriod: (period: TimePeriod) => void;
  dataVersion: number;

  setAccountType: (type: AccountType) => void;
  setTokens: (tokens: { demo?: string; real?: string }) => void;
  disconnect: (type: AccountType) => void;
  reconnect: () => Promise<boolean>;
  executeTrade: (
    contractType: string,
    stake: number,
    symbol: string,
    tradeDirection: 'rise' | 'fall',
    duration: number,
    durationUnit: DurationUnit,
    initiator: OperationInitiator,
    strategy?: string
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<ApiHistoricalData[]>;
  clearActiveContracts: () => void;
  tradeAnnotations: TradeAnnotation[];
  durationLimits: DurationLimits | null;

  // Campos para Diagnóstico Avançado
  connectionEvents: ConnectionEvent[];
  rawErrorCode: string | null;
  tokenSource: 'localStorage' | 'none';
  maskedToken: string | null;
  appId: string;
  hookVersion: string;
}

const DerivApiContextV2 = createContext<DerivApiContextTypeV2 | undefined>(undefined);

const marketNameMapping: Record<string, string> = {
    'synthetic_index': 'Índices Sintéticos',
    'forex': 'Forex',
    'commodities': 'Matérias-Primas',
    'stock_index': 'Índices de Ações',
    'cryptocurrency': 'Criptomoedas',
    'basket_index': 'Cestas'
};

const getGranularityForTimePeriod = (timePeriod: TimePeriod): number => {
    switch(timePeriod) {
        case '1m': return 60;
        case '2m': return 120;
        case '3m': return 180;
        case '5m': return 300;
        case '10m': return 600;
        case '15m': return 900;
        case '30m': return 1800;
        case '1h': return 3600;
        case '8h': return 28800;
        case '1d': return 86400;
        default: return 60;
    }
}

const MAX_DATA_POINTS = 5000;
const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

const addDataPoint = (prevData: ChartData[], newPoint: ChartData): ChartData[] => {
    let data = [...prevData];
    if (isCandle(newPoint) && data.length > 0 && data[data.length - 1].epoch === newPoint.epoch) {
        data[data.length - 1] = newPoint;
        return data;
    }
    data.push(newPoint);
    if (data.length > MAX_DATA_POINTS) {
        return data.slice(1);
    }
    return data;
};

const getDurationInSeconds = (duration: number, unit: DurationUnit, symbol?: string): number => {
    switch (unit) {
        case 't':
          const tickSec = (symbol && symbol.startsWith('1HZ')) ? 1 : 2;
          return duration * tickSec;
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration * 2;
    }
};

export const DerivApiProviderV2 = ({ children }: { children: ReactNode }) => {
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [realToken, setRealToken] = useState<string | null>(null);
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [toastQueue, setToastQueue] = useState<any[]>([]);

  const [activeSymbol, setActiveSymbol] = useState<string | null>('1HZ10V');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [botCandleData, setBotCandleData] = useState<CandleData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]); 
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const chartTypeRef = useRef(chartType);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('1m');
  const timePeriodRef = useRef(timePeriod);
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const botSubscriptionIdRef = useRef<string | null>(null);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);
  const [dataVersion, setDataVersion] = useState(0); 
  const [durationLimits, setDurationLimits] = useState<DurationLimits | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const promisesRef = useRef<Map<string, PromiseCallbacks>>(new Map());
  const [triggerReconnect, setTriggerReconnect] = useState(0);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const allowAutoReconnectRef = useRef(true);
  const reconnectInProgressRef = useRef(false);

  // Estados de Diagnóstico Operacional
  const [connectionEvents, setConnectionEvents] = useState<ConnectionEvent[]>([]);
  const [rawErrorCode, setRawErrorCode] = useState<string | null>(null);
  const [tokenSource, setTokenSource] = useState<'localStorage' | 'none'>('none');

  const addEvent = useCallback((message: string, type: ConnectionEvent['type'] = 'info') => {
    setConnectionEvents(prev => [{
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
      message,
      type
    }, ...prev].slice(0, 20));
  }, []);

  const maskedToken = useMemo(() => {
    const token = accountType === 'demo' ? demoToken : realToken;
    if (!token) return null;
    if (token.length < 15) return "****";
    return `${token.substring(0, 8)}...${token.substring(token.length - 6)}`;
  }, [demoToken, realToken, accountType]);

  const recentlyCreatedContractsRef = useRef<Set<number>>(new Set());

  const setAndPersistOperationsLog = useCallback((updater: React.SetStateAction<Operation[]>) => {
    setOperationsLog(prevLog => {
      const newLogWithPotentialDuplicates = typeof updater === 'function' ? updater(prevLog) : updater;
      const uniqueOpsMap = new Map<number, Operation>();
      for(const op of newLogWithPotentialDuplicates) {
          if(op && op.id) uniqueOpsMap.set(op.id, op);
      }
      const newLog = Array.from(uniqueOpsMap.values());
      try {
          localStorage.setItem(DERIV_V2_LOG_KEY, JSON.stringify(newLog));
      } catch (error) {
          console.error("Failed to save V2 operations log to localStorage:", error);
      }
      return newLog;
    });
  }, []);
  
  useEffect(() => {
    chartTypeRef.current = chartType;
  }, [chartType]);
  
  useEffect(() => {
    timePeriodRef.current = timePeriod;
  }, [timePeriod]);

  useEffect(() => {
    try {
      const storedDemoToken = localStorage.getItem(DERIV_DEMO_TOKEN_KEY);
      const storedRealToken = localStorage.getItem(DERIV_REAL_TOKEN_KEY);
      const storedAccountType = localStorage.getItem(DERIV_ACCOUNT_TYPE_KEY) as AccountType | null;
      const storedLog = localStorage.getItem(DERIV_V2_LOG_KEY);

      if (storedDemoToken) {
          setDemoToken(storedDemoToken.trim());
          setTokenSource('localStorage');
      }
      if (storedRealToken) {
          setRealToken(storedRealToken.trim());
          setTokenSource('localStorage');
      }
      if (storedAccountType) setAccountTypeState(storedAccountType);
      if (storedLog) {
        const parsedLog = JSON.parse(storedLog);
        if(Array.isArray(parsedLog)) {
            setOperationsLog(parsedLog.filter(op => op && op.id));
        }
      }
    } catch (error) {
      console.error("Failed to access localStorage:", error);
    }
    setIsLoading(false);
  }, []);

  const addTradeAnnotation = useCallback((annotation: Omit<TradeAnnotation, 'id'>) => {
    const newAnnotation: TradeAnnotation = {
      ...annotation,
      id: `annotation-${annotation.contractId}`,
    };
    setTradeAnnotations(prev => [...prev, newAnnotation]);
  }, []);

  const updateTradeAnnotation = useCallback((contractId: string, updates: Partial<TradeAnnotation>) => {
      setTradeAnnotations(prev => prev.map(ann => 
        ann.contractId === contractId ? { ...ann, ...updates } : ann
      ));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;
      const updatedOps = operationsLog.map(op => {
        if (op.status === 'pending' && op.expirationTime && now > op.expirationTime) {
          hasChanges = true;
          updateTradeAnnotation(String(op.id), { status: 'lost', profit: -op.stake });
          return { ...op, status: 'lost' as const, result: -op.stake, exitTimestamp: new Date().toISOString() };
        }
        return op;
      });

      if (hasChanges) {
        setAndPersistOperationsLog(updatedOps);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [operationsLog, updateTradeAnnotation, setAndPersistOperationsLog]);
  
  const activeToken = accountType === 'demo' ? demoToken : realToken;

  useEffect(() => {
    if (toastQueue.length > 0) {
      toastQueue.forEach(t => toast(t));
      setToastQueue([]);
    }
  }, [toastQueue, toast]);


  const makeRequest = useCallback(<T,>(request: object, noResponse = false): Promise<T> => {
    return new Promise((resolve) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return resolve({ error: { message: "WebSocket não está conectado." } } as any);
        }
        
        const req_id = Date.now() + Math.floor(Math.random() * 1000000);
        const payload = { ...request, req_id };
        
        if (!noResponse) {
            const timeoutId = setTimeout(() => {
                if (promisesRef.current.has(String(req_id))) {
                    const promise = promisesRef.current.get(String(req_id));
                    promise?.resolve({ error: { message: `O pedido à API expirou (60s).` } } as any);
                    promisesRef.current.delete(String(req_id));
                }
            }, 60000);
            
            promisesRef.current.set(String(req_id), {
                resolve: (value: any) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                },
                reject: (reason: any) => {
                    clearTimeout(timeoutId);
                    resolve({ error: { message: reason?.message || 'Erro interno na Promise.' } } as any);
                }
            });
        }
        
        ws.send(JSON.stringify(payload));
        if (noResponse) resolve({} as T);
    });
  }, []); 

  const getHistoricalData = useCallback(async (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod): Promise<ApiHistoricalData[]> => {
      const request: any = { ticks_history: symbol, end: "latest", count, adjust_start_time: 1, style };
      if (style === 'candles' && period) request.granularity = getGranularityForTimePeriod(period);
      try {
          const response: any = await makeRequest(request);
          if (response.error) throw new Error(response.error.message);
          if (response.history) return response.history.times.map((time: number, index: number) => ({ epoch: time, price: response.history.prices[index], volume: 1 }));
          if (response.candles) return response.candles.map((c: any) => ({ epoch: c.epoch, open: parseFloat(c.open), high: parseFloat(c.high), low: parseFloat(c.low), close: parseFloat(c.close), volume: c.tick_count || 1 }));
          return [];
      } catch (error) { throw error; }
  }, [makeRequest]);
    
  const subscribeToStreams = useCallback(async (symbol: string) => {
    try {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        if (activeSubscriptionIdRef.current) {
            try { await makeRequest({ forget: activeSubscriptionIdRef.current }, true); } catch (e) {}
        }
        if (botSubscriptionIdRef.current) {
            try { await makeRequest({ forget: botSubscriptionIdRef.current }, true); } catch (e) {}
        }
        
        activeSubscriptionIdRef.current = null;
        botSubscriptionIdRef.current = null;
        setIsChartLoading(true); setChartError(null); setChartData([]); setBotCandleData([]); setPriceTicks([]); 

        const contractsRes: any = await makeRequest({ contracts_for: symbol });
        if (contractsRes.error) throw new Error(contractsRes.error.message);
        
        const available: any[] = contractsRes.contracts_for?.available || [];
        const newLimits: DurationLimits = { t: null, s: null, m: null, h: null, d: null };
        
        const parseDuration = (dStr: string): { value: number; unit: DurationUnit } | null => {
          if (!dStr) return null;
          const match = dStr.match(/^(\d+)([tsmhd])$/);
          if (!match) return null;
          return { value: parseInt(match[1], 10), unit: match[2] as DurationUnit };
        };
        
        const riseFallContracts = available.filter((c: any) => c.contract_type === 'CALL' || c.contract_type === 'PUT');
        if (riseFallContracts.length > 0) {
          for (const contract of riseFallContracts) {
            const minParsed = parseDuration(contract.min_contract_duration);
            const maxParsed = parseDuration(contract.max_contract_duration);
            if (minParsed && maxParsed && minParsed.unit === maxParsed.unit) {
              const unit = minParsed.unit;
              const existing = newLimits[unit];
              if (!existing) newLimits[unit] = { min: minParsed.value, max: maxParsed.value };
              else newLimits[unit] = { min: Math.min(existing.min, minParsed.value), max: Math.max(existing.max, maxParsed.value) };
            }
          }
        }
        
        if ((newLimits.s === null || newLimits.t === null) && symbol?.includes('1HZ')) {
            if (newLimits.t === null) newLimits.t = { min: 1, max: 10 };
            if (newLimits.s === null) newLimits.s = { min: 15, max: 3600 };
        }
        setDurationLimits(newLimits);

        const botHistory = await getHistoricalData(symbol, 'candles', 1000, '1m');
        setBotCandleData(botHistory as CandleData[]);
        
        const botSubResponse: any = await makeRequest({ ticks_history: symbol, style: 'candles', granularity: 60, subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 });
        if (botSubResponse.subscription?.id) botSubscriptionIdRef.current = botSubResponse.subscription.id;
        
        const uiHistory = await getHistoricalData(symbol, chartTypeRef.current === 'Candle' ? 'candles' : 'ticks', 1000, timePeriodRef.current);
        setChartData(uiHistory as ChartData[]);
        if (chartTypeRef.current !== 'Candle') setPriceTicks(uiHistory as TickData[]);

        const uiSubResponse: any = await makeRequest(chartTypeRef.current === 'Candle' ? { ticks_history: symbol, style: 'candles', granularity: getGranularityForTimePeriod(timePeriodRef.current), subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 } : { ticks: symbol, subscribe: 1 });
        if(uiSubResponse.subscription?.id) activeSubscriptionIdRef.current = uiSubResponse.subscription.id;
    } catch (error: any) {
        setChartError(error.message || 'Falha ao carregar dados do mercado.');
    } finally { setIsChartLoading(false); }
  }, [getHistoricalData, makeRequest]);

    const executeTrade = useCallback(async (
        contractType: string, stake: number, symbol: string, tradeDirection: 'rise' | 'fall',
        duration: number, durationUnit: DurationUnit, initiator: OperationInitiator, strategy?: string,
      ): Promise<TradeResult> => {
        try {
          if (!wsRef.current || !isConnected) throw new Error("A conexão com a API da Deriv não está ativa.");
          const sanitizedStake = parseFloat(stake.toFixed(2));
          const proposalResponse: any = await makeRequest({ "proposal": 1, "amount": sanitizedStake, "basis": "stake", "contract_type": contractType, "currency": "USD", "duration": Math.round(duration), "duration_unit": durationUnit, "symbol": symbol });
          if (proposalResponse.error) throw new Error(proposalResponse.error.message);
          
          const buyResponse: any = await makeRequest({ "buy": proposalResponse.proposal.id, "price": proposalResponse.proposal.ask_price });
          if(buyResponse.error) throw new Error(buyResponse.error.message);
          
          const contractId = buyResponse.buy.contract_id;
          recentlyCreatedContractsRef.current.add(contractId);
          setTimeout(() => recentlyCreatedContractsRef.current.delete(contractId), 5000);

          const entryPrice = buyResponse.buy.entry_tick_display_value ? parseFloat(buyResponse.buy.entry_tick_display_value) : (priceTicks[priceTicks.length - 1]?.price || 0);
          const newOperation: Operation = { id: contractId, asset: symbol, direction: tradeDirection, stake: sanitizedStake, status: 'pending', timestamp: new Date(buyResponse.buy.purchase_time * 1000).toISOString(), duration: Math.round(duration), durationUnit, initiator, strategy, entryPrice, isSellable: durationUnit !== 't', expirationTime: (buyResponse.buy.purchase_time + getDurationInSeconds(duration, durationUnit, symbol)) * 1000 };
          setAndPersistOperationsLog(prev => [newOperation, ...prev]);
          addTradeAnnotation({ contractId: String(contractId), entryTime: buyResponse.buy.purchase_time, entryPrice, direction: tradeDirection, status: 'pending', stake: sanitizedStake, symbol, expirationTime: newOperation.expirationTime, contractType: 'option' });
          return { success: true, message: "Ordem executada.", contractId, entryPrice };
        } catch (error) {
           return { success: false, message: error instanceof Error ? error.message : "Erro desconhecido" };
        }
      }, [isConnected, makeRequest, addTradeAnnotation, priceTicks, setAndPersistOperationsLog]);

  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) return { success: false, message: "Sem conexão." };
    try {
        const sellResponse: any = await makeRequest({ "sell": contractId });
        if (sellResponse.error) {
           const errMsg = sellResponse.error.message || JSON.stringify(sellResponse.error);
           throw new Error(errMsg);
        }
        return { success: true, message: "Venda enviada." };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
  }, [isConnected, makeRequest]);
  
  useEffect(() => {
    if (!activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
      return;
    }
    const connect = () => {
        setIsConnecting(true); setConnectionError(null); setIsAssetsLoading(true); setRawErrorCode(null);
        addEvent('Iniciando handshake WebSocket...');
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
        wsRef.current = ws;
        ws.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                if (response.msg_type === 'ping' || response.pong) return;
                const reqId = response.req_id;
                if (reqId && promisesRef.current.has(String(reqId))) {
                    const promise = promisesRef.current.get(String(reqId));
                    if (response.error) {
                        setRawErrorCode(response.error.code);
                        addEvent(`Erro na API (${response.error.code}): ${response.error.message}`, 'error');
                        promise?.reject(new Error(response.error.message));
                    } else {
                        addEvent(`Resposta recebida para req_id ${reqId}`, 'success');
                        promise?.resolve(response);
                    }
                    promisesRef.current.delete(String(reqId));
                    return;
                }
                switch (response.msg_type) {
                    case 'balance': setAccountBalance({ balance: response.balance.balance, currency: response.balance.currency, loading: false }); break;
                    case 'proposal_open_contract':
                        const contract = response.proposal_open_contract;
                        if (!contract) return;
                        setAndPersistOperationsLog(prevLog => {
                            const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                            if (existingOpIndex !== -1 && prevLog[existingOpIndex].status === 'pending') {
                                const updatedLog = [...prevLog];
                                if (contract.is_sold === 1) {
                                    const newStatus = contract.profit >= 0 ? 'won' : 'lost';
                                    updatedLog[existingOpIndex] = { ...updatedLog[existingOpIndex], status: newStatus, result: contract.profit, exitPrice: parseFloat(contract.sell_spot || contract.exit_tick_display_value || '0'), exitTimestamp: new Date((contract.sell_time || contract.exit_tick_time) * 1000).toISOString() };
                                    if (updatedLog[existingOpIndex].initiator === 'Piloto' && user) savePredictiveTradeLog(user.uid, { id: `pred_log_${contract.contract_id}`, result: newStatus, pnl: contract.profit });
                                    updateTradeAnnotation(String(contract.contract_id), { status: newStatus, profit: contract.profit, exitPrice: updatedLog[existingOpIndex].exitPrice, exitTime: (contract.sell_time || contract.exit_tick_time) });
                                    setToastQueue(prev => [...prev, { title: `Posição Fechada (${updatedLog[existingOpIndex].asset})`, description: `Resultado: ${contract.currency} ${contract.profit.toFixed(2)}`, variant: newStatus === 'won' ? 'default' : 'destructive' }]);
                                    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({"balance": 1}));
                                }
                                return updatedLog;
                            }
                            return prevLog;
                        });
                        break;
                    case 'tick':
                        if (response.tick?.symbol === activeSymbol) {
                            const newTick = { epoch: response.tick.epoch, price: response.tick.quote };
                            if (chartTypeRef.current === 'Area') setChartData(prev => addDataPoint(prev, newTick));
                            setPriceTicks(prev => addDataPoint(prev, newTick) as TickData[]);
                            setDataVersion(v => v + 1);
                        }
                        break;
                    case 'ohlc':
                    case 'candles':
                        const candle = response.ohlc || (response.candles && response.candles[0]);
                        if (candle && candle.symbol === activeSymbol) {
                            const newCandle: CandleData = { epoch: candle.open_time || candle.epoch, open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low), close: parseFloat(candle.close), volume: candle.tick_count || 1 };
                            if (response.subscription?.id === activeSubscriptionIdRef.current && chartTypeRef.current === 'Candle') setChartData(prev => addDataPoint(prev, newCandle));
                            if (response.subscription?.id === botSubscriptionIdRef.current) setBotCandleData(prev => addDataPoint(prev, newCandle) as CandleData[]);
                            setDataVersion(v => v + 1);
                        }
                        break;
                }
            } catch (e) {}
        };
        ws.onopen = async () => {
          try {
              addEvent('Socket aberto. Enviando Authorize...', 'success');
              const authResponse: any = await makeRequest({ authorize: activeToken });
              if (authResponse.error) throw new Error(authResponse.error.message);
              addEvent('Autorização confirmada pelo servidor.', 'success');
              setIsConnected(true); setIsConnecting(false); setConnectionError(null);
              ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
              ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
              if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
              pingIntervalRef.current = setInterval(() => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ ping: 1 })), 30000);
              const assetsRes: any = await makeRequest({ active_symbols: 'full', product_type: 'basic' });
              const groupedAssets: { [key: string]: Asset[] } = {};
              assetsRes.active_symbols.forEach((s: any) => {
                  const marketKey = (s.market === 'synthetic_index' && s.submarket === 'basket_index') ? 'basket_index' : s.market;
                  const groupName = marketNameMapping[marketKey] || 'Outros';
                  if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                  groupedAssets[groupName].push({ value: s.symbol, label: s.display_name, marketIsOpen: s.exchange_is_open === 1, submarket: s.submarket, market: marketKey, minDuration: s.min_contract_duration ?? '5t' });
              });
              setAssetGroups(Object.keys(groupedAssets).map(label => ({ label, options: groupedAssets[label].sort((a, b) => a.label.localeCompare(b.label)) })).sort((a, b) => a.label.localeCompare(b.label)));
              setIsAssetsLoading(false);
          } catch (error: any) {
              addEvent(`Falha crítica: ${error.message}`, 'error');
              setConnectionError(error.message); setIsConnected(false); setIsConnecting(false); setIsAssetsLoading(false);
              allowAutoReconnectRef.current = false; if (ws.readyState === WebSocket.OPEN) ws.close();
          }
      };
        ws.onclose = (e) => {
          addEvent(`Conexão fechada (Código: ${e.code}).`, e.wasClean ? 'info' : 'warning');
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          promisesRef.current.forEach(p => p.reject(new Error("Closed"))); promisesRef.current.clear();
          if (!e.wasClean && allowAutoReconnectRef.current) {
            reconnectInProgressRef.current = true; setConnectionError(`Conexão perdida. Reconectando...`);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(() => { reconnectInProgressRef.current = false; setTriggerReconnect(c => c + 1); }, 3000);
          }
          setIsConnected(false); setIsConnecting(false); setAccountBalance({ balance: null, currency: null, loading: false }); wsRef.current = null;
        };
    };
    connect();
    return () => {
      allowAutoReconnectRef.current = false;
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [activeToken, isLoading, triggerReconnect, user, addEvent, makeRequest]);

  useEffect(() => { if (isConnected && activeSymbol) subscribeToStreams(activeSymbol); }, [isConnected, activeSymbol, subscribeToStreams]);
  
  const contextValue: DerivApiContextTypeV2 = useMemo(() => ({
    ws: wsRef.current, isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType,
    setAccountType: (type) => { localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, type); setAccountTypeState(type); allowAutoReconnectRef.current = true; setTriggerReconnect(c => c + 1); },
    setTokens: (t) => { 
        if (t.demo) { 
            const trimmed = t.demo.trim();
            setDemoToken(trimmed); 
            localStorage.setItem(DERIV_DEMO_TOKEN_KEY, trimmed); 
        } 
        if (t.real) { 
            const trimmed = t.real.trim();
            setRealToken(trimmed); 
            localStorage.setItem(DERIV_REAL_TOKEN_KEY, trimmed); 
        } 
        allowAutoReconnectRef.current = true; setTriggerReconnect(c => c + 1); 
    },
    disconnect: (type) => { if (type === 'demo') { localStorage.removeItem(DERIV_DEMO_TOKEN_KEY); setDemoToken(null); } else { localStorage.removeItem(DERIV_REAL_TOKEN_KEY); setRealToken(null); } },
    reconnect: async () => { setTriggerReconnect(c => c + 1); return new Promise(resolve => setTimeout(() => resolve(isConnected), 5000)); },
    accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, setActiveSymbol, chartData, botCandleData, priceTicks, isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod, dataVersion, executeTrade, sellContract, getHistoricalData, clearActiveContracts: () => { setAndPersistOperationsLog([]); setTradeAnnotations([]); }, tradeAnnotations, durationLimits,
    connectionEvents, rawErrorCode, tokenSource, maskedToken, appId: DERIV_APP_ID, hookVersion: 'use-deriv-api-v2.tsx'
  }), [isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, chartData, botCandleData, priceTicks, isChartLoading, chartError, chartType, timePeriod, dataVersion, executeTrade, sellContract, getHistoricalData, tradeAnnotations, durationLimits, connectionEvents, rawErrorCode, tokenSource, maskedToken, setAndPersistOperationsLog, setActiveSymbol, setChartType, setTimePeriod]);

  return <DerivApiContextV2.Provider value={contextValue}><FirebaseErrorListener />{children}</DerivApiContextV2.Provider>;
}

export function useDerivApiV2() {
  const context = useContext(DerivApiContextV2);
  if (context === undefined) throw new Error('useDerivApiV2 must be used within a DerivApiProviderV2');
  return context;
}
