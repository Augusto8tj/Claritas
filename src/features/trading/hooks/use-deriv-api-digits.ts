// /src/features/trading/hooks/use-deriv-api-digits.ts
'use client';

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/firebase-error-listener';

const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_DIGITS_LOG_KEY = 'derivDigitsOperationsLog_v5';
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
    price: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
};

interface DerivApiContextTypeDigits {
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
  priceTicks: TickData[]; 
  isChartLoading: boolean;
  chartError: string | null;
  chartType: ChartType;
  setChartType: (type: ChartType) => void;
  timePeriod: TimePeriod;
  setTimePeriod: (period: TimePeriod) => void;

  setAccountType: (type: AccountType) => void;
  setTokens: (tokens: { demo?: string; real?: string }) => void;
  disconnect: (type: AccountType) => void;
  reconnect: () => Promise<boolean>;
  executeTrade: (
    contractType: 'DIGITMATCH' | 'DIGITDIFF',
    stake: number,
    symbol: string,
    last_digit: number,
    duration: number,
    durationUnit: DurationUnit,
    initiator: OperationInitiator,
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<ApiHistoricalData[]>;
  clearActiveContracts: () => void;
  tradeAnnotations: TradeAnnotation[];
  durationLimits: DurationLimits | null;
}

const DerivApiContextDigits = createContext<DerivApiContextTypeDigits | undefined>(undefined);

const marketNameMapping: Record<string, string> = {
    'synthetic_index': 'Índices Sintéticos',
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

const getDurationInSeconds = (duration: number, unit: DurationUnit): number => {
    switch (unit) {
        case 't': return duration * 2; 
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration;
    }
};

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

export const DerivApiProviderDigits = ({ children }: { children: ReactNode }) => {
  const [demoToken, setDemoToken] = useState<string | null>('ljUGk6wbLSrtEDo');
  const [realToken, setRealToken] = useState<string | null>('GU5MwbX1kwvSoyw');
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const { toast } = useToast();
  
  const [toastQueue, setToastQueue] = useState<any[]>([]);

  const [activeSymbol, setActiveSymbol] = useState<string | null>('R_100');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]); 
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const chartTypeRef = useRef(chartType);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('5m');
  const timePeriodRef = useRef(timePeriod);
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);
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

    const setAndPersistOperationsLog = useCallback((updater: React.SetStateAction<Operation[]>) => {
    setOperationsLog(prevLog => {
        const newLogWithPotentialDuplicates = typeof updater === 'function' ? updater(prevLog) : updater;
        
        const uniqueOpsMap = new Map<number, Operation>();
        for(const op of newLogWithPotentialDuplicates) {
            if(op && op.id) {
                uniqueOpsMap.set(op.id, op);
            }
        }
        const newLog = Array.from(uniqueOpsMap.values());

        try {
            localStorage.setItem(DERIV_DIGITS_LOG_KEY, JSON.stringify(newLog));
        } catch (error) {
            console.error("Failed to save Digits operations log to localStorage:", error);
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
      const storedLog = localStorage.getItem(DERIV_DIGITS_LOG_KEY);

      if (storedDemoToken) setDemoToken(storedDemoToken);
      if (storedRealToken) setRealToken(storedRealToken);
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

  // Client-side timer to check for expired contracts
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;
      const updatedOps = operationsLog.map(op => {
        if (op.status === 'pending' && op.expirationTime && now > op.expirationTime) {
          hasChanges = true;
          updateTradeAnnotation(String(op.id), { status: 'lost', profit: -op.stake });
          // CORREÇÃO: Adicionar o exitTimestamp na expiração por timer
          return { ...op, status: 'lost' as const, result: -op.stake, exitTimestamp: new Date().toISOString() };
        }
        return op;
      });

      if (hasChanges) {
        setAndPersistOperationsLog(updatedOps);
      }
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [operationsLog, updateTradeAnnotation, setAndPersistOperationsLog]);
  
  const activeToken = accountType === 'demo' ? demoToken : realToken;

  useEffect(() => {
    if (toastQueue.length > 0) {
      toastQueue.forEach(t => toast(t));
      setToastQueue([]);
    }
  }, [toastQueue, toast]);


  const makeRequest = useCallback((request: object, noResponse = false): Promise<any> => {
    return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return reject(new Error("WebSocket não está conectado. Verifique o token e a conexão."));
        }
        
        const req_id = Date.now() + Math.floor(Math.random() * 1000000);
        const payload = { ...request, req_id };
        
        if (!noResponse) {
            const timeoutId = setTimeout(() => {
                if (promisesRef.current.has(String(req_id))) {
                    promisesRef.current.delete(String(req_id));
                    reject(new Error(`O pedido à API expirou (60s) para req_id: ${req_id}. O token pode ser inválido ou a rede está lenta.`));
                }
            }, 60000); // Aumentado para 60 segundos
            
            promisesRef.current.set(String(req_id), {
                resolve: (value: any) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                },
                reject: (reason: any) => {
                    clearTimeout(timeoutId);
                    reject(reason);
                }
            });
        }

        ws.send(JSON.stringify(payload));

        if (noResponse) {
            resolve({} as any);
        }
    });
  }, []);

const getHistoricalData = useCallback(async (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod): Promise<ApiHistoricalData[]> => {
    const request: any = {
        ticks_history: symbol,
        end: "latest",
        count,
        adjust_start_time: 1,
        style: style,
    };
    
    if (style === 'candles' && period) {
        request.granularity = getGranularityForTimePeriod(period);
    }
    
    try {
        const response: any = await makeRequest(request);

        if (response.history) {
            return response.history.times.map((time: number, index: number) => ({
                epoch: time,
                price: response.history.prices[index],
            }));
        }
      
        if (response.candles) {
            return response.candles.map((candle: any) => ({
                epoch: candle.epoch,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                price: candle.close,
            }));
        }
        
        return [];
    } catch (error: any) {
        console.error('[getHistoricalData] Error:', error);
        throw error;
    }
}, [makeRequest]);

const executeTrade = useCallback(async (
    contractType: 'DIGITMATCH' | 'DIGITDIFF',
    stake: number,
    symbol: string,
    last_digit: number,
    duration: number,
    durationUnit: DurationUnit,
    initiator: OperationInitiator
  ): Promise<TradeResult> => {
      try {
        if (!wsRef.current || !isConnected) {
          throw new Error("A conexão com a API da Deriv não está ativa.");
        }

        const sanitizedStake = parseFloat(stake.toFixed(2));
        const sanitizedDuration = Math.round(duration);

        const proposalResponse: any = await makeRequest({ 
            "proposal": 1,
            "amount": sanitizedStake,
            "basis": "stake",
            "contract_type": contractType,
            "currency": "USD",
            "duration": sanitizedDuration,
            "duration_unit": durationUnit,
            "symbol": symbol,
            "last_digit": last_digit,
        });

        const proposal = proposalResponse.proposal;
        if (!proposal || !proposal.id) {
          throw new Error("Falha ao obter uma proposta de negociação da API.");
        }
        
        const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": proposal.ask_price });
        const buyResult = buyResponse.buy;
        
        const entryPrice = buyResult.entry_tick_display_value ? parseFloat(buyResult.entry_tick_display_value) : 0;
        const purchaseTimeMs = (buyResult.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
        const expirationTimeMs = buyResult.expiry_time * 1000;

        const newOperation: Operation = {
            id: buyResult.contract_id,
            asset: symbol,
            direction: contractType === 'DIGITMATCH' ? 'rise' : 'fall',
            stake: sanitizedStake,
            status: 'pending',
            timestamp: new Date(purchaseTimeMs).toISOString(),
            duration: sanitizedDuration,
            durationUnit: durationUnit,
            initiator,
            entryPrice: entryPrice,
            isSellable: false,
            expirationTime: expirationTimeMs,
            contractType: contractType,
        };
        setAndPersistOperationsLog(prevLog => [newOperation, ...prevLog]);

        return {
          success: true,
          message: `Ordem executada com sucesso.`,
          contractId: buyResult.contract_id,
          entryPrice,
        };
      } catch (error) {
         console.error("[Deriv Hook - Digits] Erro durante a negociação:", error);
         const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
         return { success: false, message };
      }
  }, [isConnected, makeRequest, setAndPersistOperationsLog]);

  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    return { success: false, message: "Contratos de dígitos não podem ser vendidos antecipadamente." };
  }, []);

  const subscribeToMarketData = useCallback(async (symbol: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    if (activeSubscriptionIdRef.current) {
        try { await makeRequest({ forget: activeSubscriptionIdRef.current }, true); } catch (e) { }
        activeSubscriptionIdRef.current = null;
    }

    setIsChartLoading(true);
    setChartError(null);
    setChartData([]);
    setPriceTicks([]); 

    try {
        const contractsRes: any = await makeRequest({ contracts_for: symbol });
        const tradingPeriod = contractsRes.contracts_for?.trading_period;
        
        const newLimits: DurationLimits = { t: {min:0, max:0}, s: {min:0, max:0}, m: {min:0, max:0}, h: {min:0, max:0}, d: {min:0, max:0} };
        
        const digitPeriod = tradingPeriod?.digits?.['tick'];
        if (digitPeriod) {
            newLimits.t = { min: digitPeriod.min, max: digitPeriod.max };
        }
        setDurationLimits(newLimits);
        
        const history = await getHistoricalData(symbol, 'ticks', 1000);
        setChartData(history as TickData[]);
        setPriceTicks(history as TickData[]);
        
        const subRequest = { ticks: symbol, subscribe: 1 };
        const subResponse: any = await makeRequest(subRequest);
        if(subResponse.subscription?.id) activeSubscriptionIdRef.current = subResponse.subscription.id;

    } catch (error: any) {
        console.error(`[Market Data - Digits] Error for ${symbol}:`, error);
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
                    const promise = promisesRef.current.get(String(reqId));
                    if (promise) {
                        if (response.error) {
                            promise.reject(new Error(response.error.message));
                        } else {
                            promise.resolve(response);
                        }
                        promisesRef.current.delete(String(reqId));
                    }
                    return; 
                }
    
                if (response.error && response.error.message) {
                     if (response.error.code !== 'AlreadySubscribed') {
                      console.error(`[Deriv WS Digits] Error:`, response.error.message);
                    }
                     return; 
                }
    
                switch (response.msg_type) {
                    case 'balance':
                        setAccountBalance({ balance: response.balance.balance, currency: response.balance.currency, loading: false });
                        break;
                   case 'proposal_open_contract':
                        const contract = response.proposal_open_contract;
                        if (!contract || !contract.contract_type?.startsWith('DIGIT')) return;
                    
                        setAndPersistOperationsLog(prevLog => {
                            const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                            const isSold = contract.is_sold === 1;
                    
                            if (existingOpIndex !== -1 && prevLog[existingOpIndex]?.status === 'pending') {
                                const updatedLog = [...prevLog];
                                const op = updatedLog[existingOpIndex]!;
                    
                                if (isSold) {
                                    const newStatus = contract.is_valid_to_sell === 1 && contract.profit > 0 ? 'won' : 'lost';
                                    const exitPrice = contract.exit_tick_display_value ? parseFloat(contract.exit_tick_display_value) : op.exitPrice;
                                    const exitTimestamp = contract.sell_time ? new Date(contract.sell_time * 1000).toISOString() : new Date().toISOString();
                                    
                                    updatedLog[existingOpIndex] = { ...op, status: newStatus, result: contract.profit, exitPrice, exitTimestamp };
                                    
                                    setToastQueue(prev => [...prev, {
                                        title: `Posição Fechada (${op.asset})`,
                                        description: `Resultado: ${contract.currency} ${contract.profit.toFixed(2)}`,
                                        variant: newStatus === 'won' ? 'default' : 'destructive',
                                    }]);
                
                                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                                        wsRef.current.send(JSON.stringify({"balance": 1}));
                                    }
                                    return updatedLog;
                                }
                            }
                            return prevLog;
                        });
                        break;
                    case 'tick':
                        if (response.subscription?.id === activeSubscriptionIdRef.current) {
                            const tick = response.tick;
                            const newTick = { epoch: tick.epoch, price: tick.quote };
                            setChartData(prev => addDataPoint(prev, newTick));
                            setPriceTicks(prev => {
                                const newTicks = [...prev, newTick];
                                 if (newTicks.length > MAX_DATA_POINTS) return newTicks.slice(1);
                                return newTicks;
                            });
                        }
                        break;
                }
            } catch (parseError) {
                console.error('[Deriv WS Digits] Parse error:', parseError);
            }
        };
    
        ws.onopen = async () => {
          try {
              reconnectInProgressRef.current = false;
              if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

              const authResponse: any = await makeRequest({ authorize: activeToken });
              if (authResponse.error) throw new Error(authResponse.error.message);

              setIsConnected(true);
              setIsConnecting(false);
              setConnectionError(null);
              
              ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
              ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
              
              startConnectionMonitor();
              
              const assetsRes: any = await makeRequest({ active_symbols: 'full', product_type: 'basic' });
              if (assetsRes.error) throw new Error(assetsRes.error.message);
              
              const filteredSymbols = assetsRes.active_symbols.filter((symbol: any) => 
                symbol.market === 'synthetic_index' && symbol.available_contract_types?.some((c: string) => c.startsWith('DIGIT'))
              );
              
              const groupedAssets: { [key: string]: Asset[] } = {};
              filteredSymbols.forEach((symbol: any) => {
                  const groupName = marketNameMapping[symbol.market] || 'Outros';
                  if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                  groupedAssets[groupName].push({
                      value: symbol.symbol,
                      label: symbol.display_name,
                      marketIsOpen: symbol.exchange_is_open === 1,
                      submarket: symbol.submarket,
                      market: symbol.market,
                      minDuration: '5t', // Digits contracts are typically in ticks
                  });
              });
              
              setAssetGroups(Object.keys(groupedAssets)
                  .map(label => ({ label, options: groupedAssets[label].sort((a, b) => a.label.localeCompare(b.label)) }))
                  .sort((a, b) => a.label.localeCompare(b.label)));
              setIsAssetsLoading(false);
      
          } catch (error: any) {
              reconnectInProgressRef.current = false;
              if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
              
              let errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao conectar';
              setConnectionError(`Falha na autorização: ${errorMessage}`);
              setIsConnected(false);
              setIsConnecting(false);
              setIsAssetsLoading(false);
              setAccountBalance({ balance: null, currency: null, loading: false });
              allowAutoReconnectRef.current = false;
              if (ws.readyState === WebSocket.OPEN) ws.close();
          }
      };
    
        ws.onclose = (event) => {
          if (!wsRef.current || reconnectInProgressRef.current) return;
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          
          promisesRef.current.forEach((p) => p.reject(new Error("WebSocket connection closed.")));
          promisesRef.current.clear();
    
          if (!event.wasClean && allowAutoReconnectRef.current) {
            reconnectInProgressRef.current = true;
            setConnectionError(`Conexão perdida. Reconectando...`);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(() => {
                reconnectInProgressRef.current = false;
                setTriggerReconnect(c => c + 1);
            }, 3000);
          } else if (!event.wasClean && !allowAutoReconnectRef.current) {
             setConnectionError(`Authorization failed. Please check your API token.`);
          }
          
          setIsConnected(false);
          setIsConnecting(false);
          setAccountBalance({ balance: null, currency: null, loading: false });
          wsRef.current = null;
        };
    };

    connect();
  
    return () => {
      allowAutoReconnectRef.current = false;
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectInProgressRef.current = false;
    };
  }, [activeToken, isLoading, triggerReconnect]);

  useEffect(() => {
    if (isConnected && activeSymbol) {
        subscribeToMarketData(activeSymbol);
    }
  }, [isConnected, activeSymbol, subscribeToMarketData, timePeriod, chartType]);

  const setAccountType = useCallback((type: AccountType) => {
    try {
        localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, type);
        setAccountTypeState(type);
        allowAutoReconnectRef.current = true;
        setTriggerReconnect(c => c + 1);
    } catch (error) {
        console.error("Failed to save account type:", error);
    }
  }, []);

  const setTokens = useCallback((tokens: { demo?: string; real?: string }) => {
    try {
      if (tokens.demo) { localStorage.setItem(DERIV_DEMO_TOKEN_KEY, tokens.demo); setDemoToken(tokens.demo); }
      if (tokens.real) { localStorage.setItem(DERIV_REAL_TOKEN_KEY, tokens.real); setRealToken(tokens.real); }
      allowAutoReconnectRef.current = true;
      setTriggerReconnect(c => c + 1);
    } catch (error) {
      console.error("Failed to save token:", error);
    }
  }, []);

  const disconnect = useCallback((type: AccountType) => {
    try {
      if (type === 'demo') { localStorage.removeItem(DERIV_DEMO_TOKEN_KEY); setDemoToken(null); } 
      else { localStorage.removeItem(DERIV_REAL_TOKEN_KEY); setRealToken(null); }
    } catch (error) {
        console.error("Failed to remove token:", error);
    }
  }, []);
  
  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;

  const connectionErrorRef = useRef(connectionError);
  connectionErrorRef.current = connectionError;

  const reconnect = useCallback(async (): Promise<boolean> => {
    allowAutoReconnectRef.current = true;
    setTriggerReconnect(c => c + 1);
    
    return new Promise(resolve => {
        const checkStartTime = Date.now();
        const checkInterval = setInterval(() => {
            const isTimeout = Date.now() - checkStartTime > 10000;
            if (isConnectedRef.current) {
                clearInterval(checkInterval);
                resolve(true);
            } else if (connectionErrorRef.current || isTimeout) {
                clearInterval(checkInterval);
                resolve(false);
            }
        }, 200);
    });
  }, []);

  const clearActiveContracts = useCallback(() => {
    setAndPersistOperationsLog([]);
    setTradeAnnotations([]);
  }, [setAndPersistOperationsLog]);

  const contextValue: DerivApiContextTypeDigits = useMemo(() => ({
    ws: wsRef.current, isConnected, isConnecting, connectionError, demoToken, realToken, activeToken,
    accountType, accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, 
    setActiveSymbol, chartData, priceTicks, isChartLoading, chartError, chartType, setChartType, 
    timePeriod, setTimePeriod, setAccountType, setTokens, disconnect, reconnect, executeTrade, 
    sellContract, getHistoricalData, clearActiveContracts, tradeAnnotations, durationLimits, dataVersion: 0
  }), [
    isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, 
    accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, chartData, priceTicks, 
    isChartLoading, chartError, chartType, timePeriod, durationLimits,
    setAccountType, setTokens, disconnect, reconnect, executeTrade, sellContract, 
    getHistoricalData, clearActiveContracts, tradeAnnotations, setActiveSymbol, setChartType, setTimePeriod
  ]);

  return (
    <DerivApiContextDigits.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiContextDigits.Provider>
  );
}

export function useDerivApiDigits() {
  const context = useContext(DerivApiContextDigits);
  if (context === undefined) {
    throw new Error('useDerivApiDigits must be used within a DerivApiProviderDigits');
  }
  return context;
}
