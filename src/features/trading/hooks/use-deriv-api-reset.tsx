
// src/features/trading/hooks/use-deriv-api-reset.tsx
'use client';

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';

const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_RESET_LOG_KEY = 'derivResetOperationsLog_v1';
const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || "1089";

export type AccountType = 'demo' | 'real';
export type AllContractTypes = 'RESETCALL' | 'RESETPUT' | 'CALL' | 'PUT' | 'ONETOUCH' | 'NOTOUCH';


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

interface DerivApiContextType {
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
    contractType: AllContractTypes,
    stake: number,
    symbol: string,
    barrierOffset: string,
    duration: number,
    durationUnit: DurationUnit,
    initiator?: OperationInitiator,
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<ApiHistoricalData[]>;
  clearActiveContracts: () => void;
  tradeAnnotations: TradeAnnotation[];
  durationLimits: DurationLimits | null;
}

const DerivApiResetContext = createContext<DerivApiContextType | undefined>(undefined);

const marketNameMapping: Record<string, string> = {
    'synthetic_index': 'Índices Sintéticos',
    'forex': 'Forex',
};

const getGranularityForTimePeriod = (timePeriod: TimePeriod): number => {
    switch(timePeriod) {
        case '1m': return 60;
        case '5m': return 300;
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
const getDisplayPrice = (d: ChartData | null): number => {
    if (!d) return 0;
    const price = isCandle(d) ? d.close : d.price;
    return Number.isFinite(price) ? price : 0;
};


const addDataPoint = (prevData: ChartData[], newPoint: ChartData): ChartData[] => {
    let data = [...prevData];
    if (data.length > 0 && isCandle(newPoint) && data[data.length - 1].epoch === newPoint.epoch) {
        data[data.length - 1] = newPoint;
        return data;
    }
    data.push(newPoint);
    if (data.length > MAX_DATA_POINTS) {
        return data.slice(1);
    }
    return data;
};

export const DerivApiProviderReset = ({ children }: { children: ReactNode }) => {
  const [demoToken, setDemoToken] = useState<string | null>('pat_d2df2ff2027411214c07f1ce13961948d64554282475ea77b5343b288575d504');
  const [realToken, setRealToken] = useState<string | null>('pat_d2df2ff2027411214c07f1ce13961948d64554282475ea77b5343b288575d504');
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const sellingContractsRef = useRef<Set<number>>(new Set());
  
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const { toast } = useToast();
  const [toastQueue, setToastQueue] = useState<any[]>([]);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);

  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [botCandleData, setBotCandleData] = useState<CandleData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]); 
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Candle');
  const chartTypeRef = useRef(chartType);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('5m');
  const timePeriodRef = useRef(timePeriod);
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const botSubscriptionIdRef = useRef<string | null>(null);
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
  const reconnectInProgressRef = useRef(false);
  const allowAutoReconnectRef = useRef(true);
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
                localStorage.setItem(DERIV_RESET_LOG_KEY, JSON.stringify(newLog));
            } catch (error) {
                console.error("Failed to save operations log to localStorage:", error);
            }
            return newLog;
        });
    }, []);

    const addTradeAnnotation = useCallback((annotation: Omit<TradeAnnotation, 'id'>) => {
    const newAnnotation: TradeAnnotation = { ...annotation, id: `annotation-${annotation.contractId}` };
    setTradeAnnotations(prev => [...prev, newAnnotation]);
  }, []);

  const updateTradeAnnotation = useCallback((contractId: string, updates: Partial<TradeAnnotation>) => {
      setTradeAnnotations(prev => prev.map(ann => ann.contractId === contractId ? { ...ann, ...updates } : ann));
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
      const storedLog = localStorage.getItem(DERIV_RESET_LOG_KEY);

      if (storedDemoToken) setDemoToken(storedDemoToken);
      if (storedRealToken) setRealToken(storedRealToken);
      if (storedAccountType) setAccountTypeState(storedAccountType);
      if (storedLog) {
        const parsedLog = JSON.parse(storedLog);
        if(Array.isArray(parsedLog)) setOperationsLog(parsedLog.filter(op => op && op.id));
      }
    } catch (error) {
      console.error("Failed to access localStorage:", error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (toastQueue.length > 0) {
      toastQueue.forEach(t => toast(t));
      setToastQueue([]);
    }
  }, [toastQueue, toast]);
  
  const activeToken = accountType === 'demo' ? demoToken : realToken;

  const makeRequest = useCallback(<T,>(request: object, noResponse = false): Promise<T> => {
    return new Promise((resolve) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return resolve({ error: { message: "WebSocket não está conectado. Verifique o token e a conexão." } } as any);
        }
  
        const req_id = Date.now() + Math.floor(Math.random() * 1000000);
        const payload = { ...request, req_id };
        
        if (!noResponse) {
            const timeoutId = setTimeout(() => {
                if (promisesRef.current.has(String(req_id))) {
                    const promise = promisesRef.current.get(String(req_id));
                    promise?.resolve({ error: { message: `O pedido à API expirou (60s). O token pode ser inválido ou a rede está lenta.` } } as any);
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
        
        try {
            ws.send(JSON.stringify(payload));
        } catch (sendError) {
            console.error('[makeRequest] Send failed:', sendError);
            if (!noResponse && promisesRef.current.has(String(req_id))) {
                const promise = promisesRef.current.get(String(req_id));
                promise?.resolve({ error: { message: 'Falha ao enviar pedido via WebSocket.' } } as any);
                promisesRef.current.delete(String(req_id));
            }
        }
        
        if (noResponse) {
            resolve({} as T);
        }
    });
  }, []);
  
  const getHistoricalData = useCallback(async (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod): Promise<ApiHistoricalData[]> => {
      const request: any = { ticks_history: symbol, end: "latest", count, adjust_start_time: 1, style };
      if (style === 'candles' && period) request.granularity = getGranularityForTimePeriod(period);
      try {
        const response: any = await makeRequest(request);
        if (response.error) throw new Error(response.error.message);
        if (response.history) return response.history.times.map((time: number, index: number) => ({ epoch: time, price: response.history.prices[index] }));
        if (response.candles) return response.candles.map((c: any) => ({ epoch: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close }));
        return [];
      } catch (error) { throw error; }
    }, [makeRequest]);

  const executeTrade = useCallback(
    async (
      contractType: AllContractTypes,
      stake: number,
      symbol: string,
      barrierOffset: string,
      duration: number,
      durationUnit: DurationUnit,
      initiator: OperationInitiator = 'Manual',
    ): Promise<TradeResult> => {
      try {
        if (!wsRef.current || !isConnected) {
          throw new Error("A conexão com a API da Deriv não está ativa.");
        }
        
        const sanitizedStake = parseFloat(stake.toFixed(2));
        const sanitizedDuration = Math.round(duration);

        const proposalRequest: any = {
          proposal: 1,
          amount: sanitizedStake,
          basis: 'stake',
          contract_type: contractType,
          currency: accountBalance.currency || 'USD',
          duration: sanitizedDuration,
          duration_unit: durationUnit,
          symbol: symbol,
        };

        if (!['RESETCALL', 'RESETPUT'].includes(contractType) && barrierOffset) {
          proposalRequest.barrier = barrierOffset;
        }
        
        const proposalResponse: any = await makeRequest(proposalRequest);
        
        if (proposalResponse.error) {
          const errorMessage = proposalResponse.error.message || JSON.stringify(proposalResponse.error);
          console.error("[Deriv API Reset] Erro na Proposta:", errorMessage, proposalResponse);
          throw new Error(`Erro na Proposta: ${errorMessage}`);
        }

        const proposal = proposalResponse.proposal;
        if (!proposal || !proposal.id) {
          throw new Error("Falha ao obter uma proposta de negociação da API.");
        }

        const buyRequest = { buy: proposal.id, price: sanitizedStake };
        const buyResponse: any = await makeRequest(buyRequest);

        if (buyResponse.error) {
           const errorMessage = buyResponse.error.message || JSON.stringify(buyResponse.error);
           console.error("[Deriv API Reset] Erro na Compra:", errorMessage, buyResponse);
           throw new Error(`Erro na Compra: ${errorMessage}`);
        }

        const buyResult = buyResponse.buy;
        const contractId = buyResult.contract_id;
        if (!contractId) throw new Error("Falha na compra do contrato, ID não retornado.");

        recentlyCreatedContractsRef.current.add(contractId);
        setTimeout(() => {
            recentlyCreatedContractsRef.current.delete(contractId);
        }, 5000); 

        const latestTick = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1].price : 0;
        const entryPrice = buyResult.entry_tick_display_value 
            ? parseFloat(buyResult.entry_tick_display_value) 
            : (buyResult.entry_spot_display_value ? parseFloat(buyResult.entry_spot_display_value) : latestTick);

        const newOperation: Operation = {
          id: contractId,
          asset: symbol,
          direction: (contractType.includes('CALL') || contractType.includes('ONETOUCH')) ? 'rise' : 'fall',
          stake: sanitizedStake,
          status: 'pending',
          timestamp: new Date(buyResult.purchase_time * 1000).toISOString(),
          initiator,
          entryPrice: entryPrice,
          contractType,
          duration: sanitizedDuration,
          durationUnit
        };

        setAndPersistOperationsLog(prev => [newOperation, ...prev]);
        return { success: true, message: `Contrato ${contractType} executado.`, contractId, entryPrice: newOperation.entryPrice };
      } catch (error: any) {
        console.error("[Deriv Hook - Reset] Erro na execução:", error);
        toast({ title: 'Erro de Execução', description: error.message, variant: 'destructive' });
        return { success: false, message: error.message };
      }
    }, [isConnected, makeRequest, setAndPersistOperationsLog, toast, accountBalance.currency, priceTicks]
  );


  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    return { success: false, message: "Contratos de Reset não podem ser vendidos." };
  }, []);
  
  const subscribeToMarketData = useCallback(async (symbol: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    if (activeSubscriptionIdRef.current) {
        try { await makeRequest({ forget: activeSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
    }
    if (botSubscriptionIdRef.current) {
        try { await makeRequest({ forget: botSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
    }
    
    activeSubscriptionIdRef.current = null;
    botSubscriptionIdRef.current = null;

    setIsChartLoading(true);
    setChartError(null);
    setChartData([]);
    setBotCandleData([]);
    setPriceTicks([]); 

    try {
        const contractsRes: any = await makeRequest({ contracts_for: symbol });
        if (contractsRes.error) throw new Error(contractsRes.error.message);
        
        const newLimits: DurationLimits = { t: null, s: null, m: null, h: null, d: null };
        const availableContracts = contractsRes.contracts_for?.available || [];
        const relevantContracts = availableContracts.filter((c:any) => 
            c.contract_type === 'RESETCALL' || c.contract_type === 'RESETPUT' ||
            c.contract_type === 'CALL' || c.contract_type === 'PUT' ||
            c.contract_type === 'ONETOUCH' || c.contract_type === 'NOTOUCH'
        );

        const parseDuration = (dStr: string): { value: number; unit: DurationUnit } | null => {
            const match = dStr.match(/^(\d+)([tsmhd])$/);
            if (!match) return null;
            return { value: parseInt(match[1], 10), unit: match[2] as DurationUnit };
        };
        
        if (relevantContracts.length > 0) {
            relevantContracts.forEach(contract => {
                const minParsed = parseDuration(contract.min_contract_duration);
                const maxParsed = parseDuration(contract.max_contract_duration);

                if (minParsed) {
                    if (!newLimits[minParsed.unit] || newLimits[minParsed.unit]!.min > minParsed.value) {
                        if (!newLimits[minParsed.unit]) newLimits[minParsed.unit] = { min: Infinity, max: 0 };
                        newLimits[minParsed.unit]!.min = minParsed.value;
                    }
                }
                if (maxParsed) {
                     if (!newLimits[maxParsed.unit] || newLimits[maxParsed.unit]!.max < maxParsed.value) {
                        if (!newLimits[maxParsed.unit]) newLimits[maxParsed.unit] = { min: Infinity, max: 0 };
                        newLimits[maxParsed.unit]!.max = maxParsed.value;
                    }
                }
            });
        } else {
           console.warn(`Nenhum contrato relevante encontrado para ${symbol}`);
        }
        setDurationLimits(newLimits);

        const currentChartType = chartTypeRef.current;
        const currentTimePeriod = timePeriodRef.current;
        
        const botHistory = await getHistoricalData(symbol, 'candles', 1000, '1m') as CandleData[];
        setBotCandleData(botHistory);
        
        const botSubRequest = { ticks_history: symbol, style: 'candles', granularity: 60, subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 };
        const botSubResponse: any = await makeRequest(botSubRequest);
        if (botSubResponse.error && botSubResponse.error.code !== 'AlreadySubscribed') throw new Error(`Bot Sub: ${botSubResponse.error.message}`);
        if(botSubResponse.subscription?.id) botSubscriptionIdRef.current = botSubResponse.subscription.id;

        const historyStyle = currentChartType === 'Candle' ? 'candles' : 'ticks';
        const uiHistory = await getHistoricalData(symbol, historyStyle, 1000, currentTimePeriod);
        setChartData(uiHistory as ChartData[]);
        setPriceTicks(uiHistory.map(p => ({ epoch: p.epoch, price: p.price || (p as CandleData).close })) as TickData[]);
        setDataVersion(v => v + 1);

        let uiSubRequest: any;
        if (currentChartType === 'Candle') {
            uiSubRequest = { ticks_history: symbol, style: 'candles', granularity: getGranularityForTimePeriod(currentTimePeriod), subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 };
        } else {
            uiSubRequest = { ticks: symbol, subscribe: 1 };
        }
        
        const uiSubResponse: any = await makeRequest(uiSubRequest);
        if (uiSubResponse.error && uiSubResponse.error.code !== 'AlreadySubscribed') throw new Error(`UI Sub: ${uiSubResponse.error.message}`);
        if(uiSubResponse.subscription?.id) activeSubscriptionIdRef.current = uiSubResponse.subscription.id;

    } catch (error: any) {
        setChartError(error.message || 'Falha ao carregar dados do mercado.');
    } finally {
        setIsChartLoading(false);
    }
  }, [getHistoricalData, makeRequest]);
  
  const startConnectionMonitor = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    pingIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            try { wsRef.current.send(JSON.stringify({ ping: 1 })); } catch (error) { console.warn('[Ping] Failed:', error); }
        }
    }, 30000);
  }, []);
  
  useEffect(() => {
    if (!activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
      return;
    }
    const connect = () => {
        setIsConnecting(true);
        setConnectionError(null);
        setIsAssetsLoading(true);
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
        wsRef.current = ws;
        ws.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                const reqId = response.req_id;
                if (reqId && promisesRef.current.has(String(reqId))) {
                    promisesRef.current.get(String(reqId))?.resolve(response);
                    promisesRef.current.delete(String(reqId));
                    return; 
                }
                switch (response.msg_type) {
                    case 'balance':
                        setAccountBalance({ balance: response.balance.balance, currency: response.balance.currency, loading: false });
                        break;
                    case 'proposal_open_contract':
                        const contract = response.proposal_open_contract;
                        if (!contract) return;
        
                        const relevantTypes = ['RESETCALL', 'RESETPUT', 'CALL', 'PUT', 'ONETOUCH', 'NOTOUCH'];
                        if (!relevantTypes.includes(contract.contract_type)) {
                            return;
                        }
        
                        setAndPersistOperationsLog(prevLog => {
                            const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                            const isSold = contract.is_sold === 1;

                            if (existingOpIndex !== -1) {
                                const updatedLog = [...prevLog];
                                const op = updatedLog[existingOpIndex];
        
                                if (op.status !== 'pending') {
                                    return prevLog;
                                }
        
                                if (isSold) {
                                    const newStatus = contract.profit >= 0 ? 'won' : 'lost';
                                    const exitPrice = contract.exit_tick_display_value 
                                        ? parseFloat(contract.exit_tick_display_value) 
                                        : (contract.sell_spot ? parseFloat(contract.sell_spot) : op.exitPrice);
                                    
                                    const exitTimeEpoch = contract.sell_time || contract.exit_tick_time;
                                    const exitTimestamp = exitTimeEpoch ? new Date(exitTimeEpoch * 1000).toISOString() : new Date().toISOString();
        
                                    updatedLog[existingOpIndex] = {
                                        ...op,
                                        status: newStatus,
                                        result: contract.profit,
                                        exitPrice: exitPrice,
                                        exitTimestamp: exitTimestamp,
                                    };
                                    
                                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                                        wsRef.current.send(JSON.stringify({"balance": 1}));
                                    }
        
                                    return updatedLog;
                                } else {
                                    updatedLog[existingOpIndex] = {
                                        ...op,
                                        result: contract.profit
                                    };
                                    return updatedLog;
                                }
                            } else if (!isSold) {
                                if (recentlyCreatedContractsRef.current.has(contract.contract_id)) {
                                    return prevLog;
                                }

                                const direction = (contract.contract_type || '').includes('CALL') || (contract.contract_type || '').includes('ONETOUCH') ? 'rise' : 'fall';
                                const purchaseTime = contract.purchase_time || Math.floor(Date.now() / 1000);
                                
                                const durationInSeconds = contract.date_expiry ? (contract.date_expiry - purchaseTime) : 0;
                                const durationUnit: DurationUnit = 's';
            
                                const newOperation: Operation = {
                                    id: contract.contract_id,
                                    asset: contract.symbol,
                                    direction: direction,
                                    stake: contract.buy_price || 0,
                                    status: 'pending',
                                    result: contract.profit,
                                    timestamp: new Date(purchaseTime * 1000).toISOString(),
                                    initiator: 'Manual',
                                    entryPrice: parseFloat(contract.entry_spot_display_value || contract.entry_tick_display_value || '0'),
                                    isSellable: contract.is_sellable === 1,
                                    expirationTime: contract.date_expiry ? contract.date_expiry * 1000 : undefined,
                                    duration: durationInSeconds,
                                    durationUnit: durationUnit,
                                    contractType: contract.contract_type,
                                };
                                return [newOperation, ...prevLog];
                            }
                            
                            return prevLog;
                        });
                        break;
                    case 'tick':
                         if (response.subscription?.id === activeSubscriptionIdRef.current) {
                            const newTick = { epoch: response.tick.epoch, price: response.tick.quote };
                            if (chartTypeRef.current === 'Area') setChartData(prev => addDataPoint(prev, newTick));
                            setPriceTicks(prev => addDataPoint(prev, newTick));
                            setDataVersion(v => v + 1);
                         }
                        break;
                    case 'ohlc':
                         const candle = response.ohlc;
                         const newCandle: CandleData = { epoch: candle.open_time, open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low), close: parseFloat(candle.close) };
                         if (response.subscription?.id === botSubscriptionIdRef.current) {
                             setBotCandleData(prev => addDataPoint(prev, newCandle) as CandleData[]);
                         }
                         if(response.subscription?.id === activeSubscriptionIdRef.current) {
                             if(chartTypeRef.current === 'Candle') setChartData(prev => addDataPoint(prev, newCandle));
                         }
                         setDataVersion(v => v + 1);
                         break;
                }
            } catch (e) { console.error('[WS OnMessage] Error:', e); }
        };
        ws.onopen = async () => {
            try {
                const authResponse: any = await makeRequest({ authorize: activeToken });
                if (authResponse.error) throw new Error(authResponse.error.message);
                setIsConnected(true); setIsConnecting(false); setConnectionError(null);
                ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
                ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
                startConnectionMonitor();
                const assetsRes: any = await makeRequest({ active_symbols: 'full', product_type: 'basic' });
                if (assetsRes.error) throw new Error(assetsRes.error.message);
                
                const allSymbols = assetsRes.active_symbols.filter((s:any) => s.market === 'forex' || s.market === 'synthetic_index');

                const groupedAssets: { [key: string]: Asset[] } = {};
                allSymbols.forEach((s: any) => {
                    const groupName = marketNameMapping[s.market] || 'Outros';
                    if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                    groupedAssets[groupName].push({ value: s.symbol, label: s.display_name, marketIsOpen: s.exchange_is_open === 1, submarket: s.submarket, market: s.market, minDuration: s.min_contract_duration || '1m' });
                });

                setAssetGroups(Object.keys(groupedAssets)
                    .map(label => ({ 
                        label, 
                        options: groupedAssets[label].sort((a, b) => a.label.localeCompare(b.label)) 
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label)));
                    
                setIsAssetsLoading(false);
                
                if (!activeSymbol && allSymbols.length > 0) {
                     setActiveSymbol(allSymbols[0].symbol);
                }

            } catch (error: any) {
                setConnectionError(`Falha na autorização: ${error.message}`);
                setIsConnected(false); setIsConnecting(false); setIsAssetsLoading(false);
                setAccountBalance({ balance: null, currency: null, loading: false });
                if (ws.readyState === WebSocket.OPEN) ws.close();
            }
        };
        ws.onclose = () => { setIsConnected(false); setIsConnecting(false); wsRef.current = null; };
    };
    connect();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [activeToken, isLoading, triggerReconnect, makeRequest, getHistoricalData, startConnectionMonitor]);

  useEffect(() => {
    if (isConnected && activeSymbol) {
        subscribeToMarketData(activeSymbol);
    }
  }, [isConnected, activeSymbol, subscribeToMarketData, chartType, timePeriod]);

  const setAccountType = useCallback((type: AccountType) => {
    localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, type);
    setAccountTypeState(type);
    setTriggerReconnect(c => c + 1);
  }, []);

  const setTokens = useCallback((tokens: { demo?: string; real?: string }) => {
    if (tokens.demo) { localStorage.setItem(DERIV_DEMO_TOKEN_KEY, tokens.demo); setDemoToken(tokens.demo); }
    if (tokens.real) { localStorage.setItem(DERIV_REAL_TOKEN_KEY, tokens.real); setRealToken(tokens.real); }
    setTriggerReconnect(c => c + 1);
  }, []);

  const disconnect = useCallback((type: AccountType) => {
    if (type === 'demo') { localStorage.removeItem(DERIV_DEMO_TOKEN_KEY); setDemoToken(null); } 
    else { localStorage.removeItem(DERIV_REAL_TOKEN_KEY); setRealToken(null); }
  }, []);
  
  const reconnect = useCallback(async (): Promise<boolean> => {
    setTriggerReconnect(c => c + 1);
    return new Promise(resolve => setTimeout(() => resolve(isConnected), 5000));
  }, [isConnected]);

  const clearActiveContracts = useCallback(() => {
    setAndPersistOperationsLog([]);
    setTradeAnnotations([]);
  }, [setAndPersistOperationsLog]);

  const contextValue: DerivApiContextType = useMemo(() => ({
    ws: wsRef.current, isConnected, isConnecting, connectionError, demoToken, realToken, activeToken,
    accountType, accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, 
    setActiveSymbol, chartData, botCandleData, isChartLoading, chartError, chartType, setChartType, 
    timePeriod, setTimePeriod, dataVersion, tradeAnnotations, priceTicks, setAccountType, setTokens,
    disconnect, reconnect, executeTrade, sellContract, getHistoricalData, clearActiveContracts,
    durationLimits
  }), [
    isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, 
    accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, setActiveSymbol, 
    chartData, botCandleData, isChartLoading, chartError, chartType, timePeriod, dataVersion, 
    tradeAnnotations, priceTicks, setAccountType, setTokens, disconnect, reconnect, executeTrade, 
    sellContract, getHistoricalData, clearActiveContracts, durationLimits
  ]);

  return (
    <DerivApiResetContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiResetContext.Provider>
  );
}

export function useDerivApiReset() {
  const context = useContext(DerivApiResetContext);
  if (context === undefined) {
    throw new Error('useDerivApiReset must be used within a DerivApiProviderReset');
  }
  return context;
}
