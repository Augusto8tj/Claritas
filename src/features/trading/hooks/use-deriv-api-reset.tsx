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
    contractType: 'RESETCALL' | 'RESETPUT',
    stake: number,
    symbol: string,
    reset_barrier_offset: string,
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
  const [demoToken, setDemoToken] = useState<string | null>('ljUGk6wbLSrtEDo');
  const [realToken, setRealToken] = useState<string | null>('GU5MwbX1kwvSoyw');
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

  const executeTrade = useCallback(async (
    contractType: 'RESETCALL' | 'RESETPUT',
    stake: number,
    symbol: string,
    reset_barrier_offset: string,
    duration: number,
    durationUnit: DurationUnit,
    initiator: OperationInitiator = 'Manual'
  ): Promise<TradeResult> => {
    try {
      if (!wsRef.current || !isConnected) throw new Error("A conexão com a API da Deriv não está ativa.");

      const sanitizedStake = parseFloat(stake.toFixed(2));
      const sanitizedDuration = Math.round(duration);

      const proposalRequest: any = {
        proposal: 1,
        amount: sanitizedStake,
        basis: 'stake',
        contract_type: contractType,
        currency: 'USD',
        duration: sanitizedDuration,
        duration_unit: durationUnit,
        symbol: symbol,
        reset_barrier_offset: reset_barrier_offset,
      };

      const proposalResponse: any = await makeRequest(proposalRequest);

      if (proposalResponse.error) throw new Error(proposalResponse.error.message);
      
      const proposal = proposalResponse.proposal;
      if (!proposal || !proposal.id) {
        throw new Error("Falha ao obter uma proposta de negociação.");
      }

      const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": proposal.ask_price });
      if (buyResponse.error) throw new Error(buyResponse.error.message);

      const buyResult = buyResponse.buy;
      const contractId = buyResult.contract_id;
      if (!contractId) throw new Error("Falha na compra do contrato, ID não retornado.");

      const newOperation: any = {
        id: contractId,
        asset: symbol,
        direction: contractType === 'RESETCALL' ? 'rise' : 'fall',
        stake: sanitizedStake,
        status: 'pending',
        timestamp: new Date().toISOString(),
        initiator,
        entryPrice: parseFloat(buyResult.entry_spot_display_value),
        contractType,
        reset_barrier_offset,
        duration: sanitizedDuration,
        durationUnit
      };

      setAndPersistOperationsLog(prev => [newOperation, ...prev]);
      return { success: true, message: `Contrato ${contractType} executado.`, contractId };
    } catch (error) {
      console.error("[Deriv Hook - Reset] Erro na execução:", error);
      const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
      return { success: false, message };
    }
  }, [isConnected, makeRequest, setAndPersistOperationsLog]);

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
        const resetContracts = availableContracts.filter((c:any) => c.contract_type === 'RESETCALL' || c.contract_type === 'RESETPUT');

        const parseDuration = (dStr: string): { value: number; unit: DurationUnit } | null => {
            const match = dStr.match(/^(\d+)([tsmhd])$/);
            if (!match) return null;
            return { value: parseInt(match[1], 10), unit: match[2] as DurationUnit };
        };
        
        if (resetContracts.length > 0) {
            const sampleContract = resetContracts[0];
            const minParsed = parseDuration(sampleContract.min_contract_duration);
            const maxParsed = parseDuration(sampleContract.max_contract_duration);

            if (minParsed && (!newLimits[minParsed.unit] || newLimits[minParsed.unit]!.min > minParsed.value)) {
                if (!newLimits[minParsed.unit]) newLimits[minParsed.unit] = { min: 0, max: Infinity };
                newLimits[minParsed.unit]!.min = minParsed.value;
            }
            if (maxParsed && (!newLimits[maxParsed.unit] || newLimits[maxParsed.unit]!.max < maxParsed.value)) {
                if (!newLimits[maxParsed.unit]) newLimits[maxParsed.unit] = { min: 0, max: Infinity };
                newLimits[maxParsed.unit]!.max = maxParsed.value;
            }
        } else {
           console.warn(`Nenhum contrato RESET encontrado para ${symbol}`);
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
                        setAndPersistOperationsLog(prev => prev.map(op => op.id === contract.contract_id ? { ...op, status: contract.status, result: contract.profit, exitPrice: parseFloat(contract.sell_spot || contract.exit_tick_display_value || '0'), exitTimestamp: new Date(contract.sell_time * 1000).toISOString() } : op));
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
                const filteredSymbols = assetsRes.active_symbols.filter((s: any) => 
                    s.available_contracts?.some((c:any) => c.contract_type === 'RESETCALL')
                );
                const groupedAssets: { [key: string]: Asset[] } = {};
                filteredSymbols.forEach((s: any) => {
                    const groupName = marketNameMapping[s.market] || 'Outros';
                    if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                    groupedAssets[groupName].push({ value: s.symbol, label: s.display_name, marketIsOpen: s.exchange_is_open === 1, submarket: s.submarket, market: s.market, minDuration: s.min_contract_duration || '1m' });
                });
                setAssetGroups(Object.keys(groupedAssets).map(label => ({ label, options: groupedAssets[label] })));
                setIsAssetsLoading(false);

                // Initialize with the first available asset if none is selected
                if (!activeSymbol && filteredSymbols.length > 0) {
                    setActiveSymbol(filteredSymbols[0].symbol);
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
  }, [activeToken, isLoading, triggerReconnect]);

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
```
- src/features/trading/hooks/use-reset-call-put-strategy.ts:
```ts
// src/features/trading/hooks/use-reset-call-put-strategy.ts
'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useDerivApiReset } from './use-deriv-api-reset';
import { useToast } from '@/hooks/use-toast';
import type { CandleData, Operation } from '@/lib/types';
import { useFormContext } from 'react-hook-form';
import type { ResetFormValues } from '../components/deriv-trader/deriv-trader-interface-reset.types';
import { calculateAllIndicators, type Indicators } from '@/features/trading/services/indicator-service';
import { getCouncilStrategies } from '@/features/trading/services/council-strategies';

type BotStatus = 'PAUSED' | 'MONITORING' | 'SIGNAL_FOUND' | 'EXECUTING' | 'RISK_PAUSE';
type TrendDirection = 'UP' | 'DOWN' | 'NONE';
export type SignalStrength = 'STRONG' | 'MEDIUM' | 'WEAK' | 'NONE';
export type ResetMode = 'CLASSIC' | 'HARVESTING';

export function useResetCallPutStrategy(
    activeSymbol: string | null,
    botCandleData: CandleData[],
    accountBalance: number | null
) {
    const { executeTrade, isConnected, operationsLog } = useDerivApiReset();
    const { toast } = useToast();
    const form = useFormContext<ResetFormValues>();

    const [isAutopilotOn, setIsAutopilotOn] = useState(false);
    const [botStatus, setBotStatus] = useState<BotStatus>('PAUSED');
    const [trend, setTrend] = useState<TrendDirection>('NONE');
    const [calculatedBarrier, setCalculatedBarrier] = useState('+0.0');

    // --- Gestão de Risco ---
    const [isMartingaleEnabled, setIsMartingaleEnabled] = useState(true);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(1.8);
    const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(5);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [nextStake, setNextStake] = useState(form.getValues('stake'));
    const lastProcessedOpId = useRef<number | null>(null);

    // --- Parâmetros de Estratégia ---
    const [adxThreshold, setAdxThreshold] = useState(25);
    const [atrMultiplier, setAtrMultiplier] = useState(2.5);
    const [useAdaptiveDuration, setUseAdaptiveDuration] = useState(false);
    const [resetMode, setResetMode] = useState<ResetMode>('CLASSIC');
    const [minConfirmations, setMinConfirmations] = useState(2);

    // --- Estado de Sinal (para UI) ---
    const [signalStrength, setSignalStrength] = useState<SignalStrength>('NONE');
    const [confirmationCount, setConfirmationCount] = useState(0);
    const [currentRsi, setCurrentRsi] = useState<number | null>(null);
    const [currentAdx, setCurrentAdx] = useState<number | null>(null);

    const prevRsiRef = useRef<number | null>(null);
    const executionCooldownRef = useRef<number>(0);

    const toggleAutopilot = useCallback(() => {
        setIsAutopilotOn(prev => !prev);
    }, []);

    const resetRiskSession = useCallback(() => {
        setConsecutiveLosses(0);
        setNextStake(form.getValues('stake'));
        setBotStatus('MONITORING');
        lastProcessedOpId.current = null;
        toast({ title: "Sessão de Risco Reiniciada", description: "Contador e aposta resetados." });
    }, [form, toast]);

    const indicators = useMemo((): Indicators | null => {
        if (botCandleData.length < 100) return null;
        return calculateAllIndicators(botCandleData, getCouncilStrategies(), '15m', { duration: 15, unit: 'm' });
    }, [botCandleData]);

    // --- Processar resultado do último trade ---
    useEffect(() => {
        const lastOp = operationsLog.find(
            op => op.initiator === 'Piloto' && op.status !== 'pending' && op.id !== lastProcessedOpId.current
        );
        if (!lastOp) return;
        lastProcessedOpId.current = lastOp.id;

        if (lastOp.status === 'lost') {
            const newLossCount = consecutiveLosses + 1;
            setConsecutiveLosses(newLossCount);
            if (newLossCount >= maxConsecutiveLosses) {
                setBotStatus('RISK_PAUSE');
                toast({ title: '🛑 Piloto Pausado por Risco', description: `${maxConsecutiveLosses} perdas consecutivas atingidas.`, variant: 'destructive' });
            } else if (isMartingaleEnabled) {
                const newStake = parseFloat((nextStake * martingaleMultiplier).toFixed(2));
                setNextStake(newStake);
                toast({ title: '⚠️ Martingale Ativado', description: `Próxima aposta: $${newStake}` });
            }
        } else {
            setConsecutiveLosses(0);
            setNextStake(form.getValues('stake'));
        }
    }, [operationsLog, consecutiveLosses, maxConsecutiveLosses, isMartingaleEnabled, nextStake, martingaleMultiplier, form, toast]);

    // --- Duração Adaptativa ---
    const getAdaptiveDuration = useCallback((): number => {
        if (!useAdaptiveDuration || !indicators?.atr) return form.getValues('duration');
        const basePrice = botCandleData[botCandleData.length - 1]?.close || 1;
        const atrPercent = (indicators.atr / basePrice) * 100;
        if (atrPercent > 1.5) return 1;
        if (atrPercent > 0.8) return 2;
        return 5;
    }, [useAdaptiveDuration, indicators, botCandleData, form]);

    // --- Lógica Principal ---
    useEffect(() => {
        if (!isAutopilotOn || !isConnected || !activeSymbol || !indicators || botStatus === 'RISK_PAUSE') {
            if (!isAutopilotOn) setBotStatus('PAUSED');
            return;
        }

        const executionLogic = setTimeout(() => {
            const now = Date.now();
            if (now < executionCooldownRef.current) return;

            setBotStatus('MONITORING');

            const { adx, pdi, ndi, rsi, atr } = indicators;
            const lastCandle = botCandleData[botCandleData.length - 1];
            const prevCandle = botCandleData[botCandleData.length - 2];

            setCurrentRsi(rsi ?? null);
            setCurrentAdx(adx ?? null);

            let currentTrend: TrendDirection = 'NONE';
            if (adx && adx > adxThreshold && pdi && ndi) {
                currentTrend = pdi > ndi ? 'UP' : 'DOWN';
            }
            setTrend(currentTrend);
            
            const barrierOffset = atr ? `+${(atr * atrMultiplier).toFixed(4)}` : '+0.0';
            setCalculatedBarrier(barrierOffset);

            let signal: 'call' | 'put' | null = null;
            const rsiValue = rsi ?? 50;
            const prevRsiValue = prevRsiRef.current ?? 50;

            if (resetMode === 'CLASSIC') {
                if (currentTrend === 'UP' && rsiValue < 40 && prevRsiValue >= 40) signal = 'call';
                else if (currentTrend === 'DOWN' && rsiValue > 60 && prevRsiValue <= 60) signal = 'put';
            } else if (resetMode === 'HARVESTING') {
                if (rsiValue > 65) signal = 'put';
                else if (rsiValue < 35) signal = 'call';
            }

            prevRsiRef.current = rsiValue;
            
            let confirmations = 0;
            if (signal === 'call') {
                if (rsiValue < 50) confirmations++;
                if (adx && adx > 30) confirmations++;
                if (pdi && ndi && pdi > ndi) confirmations++;
                if (lastCandle && lastCandle.close > lastCandle.open) confirmations++;
            } else if (signal === 'put') {
                if (rsiValue > 50) confirmations++;
                if (adx && adx > 30) confirmations++;
                if (pdi && ndi && ndi > pdi) confirmations++;
                if (lastCandle && lastCandle.close < lastCandle.open) confirmations++;
            }

            setConfirmationCount(confirmations);
            let strength: SignalStrength = 'NONE';
            if (signal) {
                if (confirmations >= 3) strength = 'STRONG';
                else if (confirmations >= 2) strength = 'MEDIUM';
                else strength = 'WEAK';
            }
            setSignalStrength(strength);

            if (signal && confirmations >= minConfirmations) {
                setBotStatus('SIGNAL_FOUND');
                const stakeToUse = nextStake;
                const duration = getAdaptiveDuration();

                executeTrade(
                    signal === 'call' ? 'RESETCALL' : 'RESETPUT',
                    stakeToUse,
                    activeSymbol,
                    barrierOffset, // Envia sempre o offset positivo
                    duration,
                    form.getValues('duration_unit'),
                    'Piloto'
                ).then(result => {
                    if (result.success) {
                        executionCooldownRef.current = Date.now() + 8000;
                        toast({ title: `🤖 ${signal === 'call' ? '📈 Reset CALL' : '📉 Reset PUT'} Executado!`, description: `Stake: $${stakeToUse} | Força: ${strength} (${confirmations}/4)` });
                    } else {
                        toast({ title: "❌ Falhou", description: result.message, variant: 'destructive' });
                    }
                    setBotStatus('MONITORING');
                });
            }
        }, 2000);

        return () => clearTimeout(executionLogic);
    }, [
        isAutopilotOn, isConnected, activeSymbol, indicators, botCandleData,
        executeTrade, form, toast, calculatedBarrier, nextStake, botStatus,
        adxThreshold, atrMultiplier, resetMode, minConfirmations, getAdaptiveDuration
    ]);
    
    return {
        isAutopilotOn,
        toggleAutopilot,
        botStatus,
        trend,
        calculatedBarrier,
        isMartingaleEnabled, setIsMartingaleEnabled,
        martingaleMultiplier, setMartingaleMultiplier,
        maxConsecutiveLosses, setMaxConsecutiveLosses,
        consecutiveLosses,
        isPausedByRisk: botStatus === 'RISK_PAUSE',
        currentStake: nextStake,
        resetRiskSession,
        adxThreshold, setAdxThreshold,
        atrMultiplier, setAtrMultiplier,
        signalStrength,
        confirmationCount,
        currentRsi,
        currentAdx,
        useAdaptiveDuration, setUseAdaptiveDuration,
        resetMode, setResetMode,
        minConfirmations, setMinConfirmations,
        rsiThreshold: 50,
        setRsiThreshold: (_: number) => {},
    };
}
```
