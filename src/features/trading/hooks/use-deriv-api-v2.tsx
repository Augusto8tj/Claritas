// /src/features/trading/hooks/use-deriv-api-v2.tsx
'use client';

// ESTE ARQUIVO É UMA CÓPIA DEDICADA PARA O SISTEMA V2.5

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/firebase-error-listener';
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
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<ApiHistoricalData[]>;
  clearActiveContracts: () => void;
  tradeAnnotations: TradeAnnotation[];
  durationLimits: DurationLimits | null;
}

const DerivApiContextV2 = createContext<DerivApiContextTypeV2 | undefined>(undefined);

const marketNameMapping: Record<string, string> = {
    'synthetic_index': 'Índices Sintéticos',
    'forex': 'Forex',
    'commodities': 'Matérias-Primas',
    'stock_index': 'Índices de Ações',
    'cryptocurrency': 'Criptomoedas',
    'basket_index': 'Cestas de Moedas e Matérias-Primas'
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

const getDurationInSeconds = (duration: number, unit: DurationUnit): number => {
    switch (unit) {
        case 't': return duration * 2;
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration * 2;
    }
};


export const DerivApiProviderV2 = ({ children }: { children: ReactNode }) => {
  const [demoToken, setDemoToken] = useState<string | null>('ljUGk6wbLSrtEDo');
  const [realToken, setRealToken] = useState<string | null>('GU5MwbX1kwvSoyw');
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

  // NOVO: Ref para rastrear contratos recém-criados e evitar race conditions
  const recentlyCreatedContractsRef = useRef<Set<number>>(new Set());

    const setAndPersistOperationsLog = useCallback((updater: React.SetStateAction<Operation[]>) => {
        setOperationsLog(prevLog => {
            const newLogWithPotentialDuplicates = typeof updater === 'function' ? updater(prevLog) : updater;
            
            // GARANTIA DE INTEGRIDADE: Evita chaves duplicadas no React.
            const uniqueOpsMap = new Map<number, Operation>();
            for(const op of newLogWithPotentialDuplicates) {
                if(op && op.id) {
                    uniqueOpsMap.set(op.id, op);
                }
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


  const makeRequest = useCallback(<T,>(request: object, noResponse = false): Promise<T> => {
    return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return reject(new Error("WebSocket não está conectado."));
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
            resolve({} as T);
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
                    volume: 1, 
                }));
            }
        
            if (response.candles) {
                return response.candles.map((candle: any) => ({
                    epoch: candle.epoch,
                    open: parseFloat(candle.open),
                    high: parseFloat(candle.high),
                    low: parseFloat(candle.low),
                    close: parseFloat(candle.close),
                    volume: candle.tick_count || 1 
                }));
            }
            
            return [];
        } catch (error: any) {
            console.error('[getHistoricalData] Error:', error);
            throw error;
        }
    }, [makeRequest]);

    const executeTrade = useCallback(async (
        contractType: string,
        stake: number,
        symbol: string,
        tradeDirection: 'rise' | 'fall',
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
          });

          const proposal = proposalResponse.proposal;
          if (!proposal || !proposal.id) {
            throw new Error("Falha ao obter uma proposta de negociação da API.");
          }
          
          const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": proposal.ask_price });
          const buyResult = buyResponse.buy;
          
          const contractId = buyResult.contract_id;
          if (!contractId) {
            throw new Error("Falha na compra do contrato, ID não retornado.");
          }
          
          // NOVO: Adiciona o ID ao cache de contratos recém-criados
          recentlyCreatedContractsRef.current.add(contractId);
          setTimeout(() => {
              recentlyCreatedContractsRef.current.delete(contractId);
          }, 5000); // Limpa após 5 segundos

          const latestTick = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1].price : 0;
          const entryPrice = buyResult.entry_tick_display_value 
            ? parseFloat(buyResult.entry_tick_display_value) 
            : (buyResult.entry_spot_display_value ? parseFloat(buyResult.entry_spot_display_value) : latestTick);

          const isSellable = durationUnit !== 't';
          
          const durationInSeconds = getDurationInSeconds(sanitizedDuration, durationUnit);
          const purchaseTimeMs = (buyResult.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
          const expirationTimeMs = purchaseTimeMs + durationInSeconds * 1000;

          const newOperation: Operation = {
              id: buyResult.contract_id,
              asset: symbol,
              direction: tradeDirection,
              stake: sanitizedStake,
              status: 'pending',
              timestamp: new Date(purchaseTimeMs).toISOString(),
              duration: sanitizedDuration,
              durationUnit: durationUnit,
              initiator,
              entryPrice: entryPrice,
              isSellable,
              expirationTime: expirationTimeMs,
          };
          setAndPersistOperationsLog(prevLog => [newOperation, ...prevLog]);

          const entryTime = buyResult.purchase_time;
          
          addTradeAnnotation({
              contractId: String(buyResult.contract_id),
              entryTime: entryTime,
              entryPrice: entryPrice,
              direction: tradeDirection,
              status: 'pending',
              stake: sanitizedStake,
              symbol,
              expirationTime: expirationTimeMs,
              contractType: 'option'
          });

          return {
            success: true,
            message: `Ordem do tipo "${contractType}" para ${symbol} no valor de ${sanitizedStake} USD executada com sucesso.`,
            contractId: buyResult.contract_id,
            entryPrice,
          };
        } catch (error) {
           console.error("[Deriv Hook] Erro durante a negociação:", error);
           const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
           return { success: false, message };
        }
      }, [isConnected, makeRequest, addTradeAnnotation, priceTicks, setAndPersistOperationsLog]);

  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) {
        return { success: false, message: "A conexão com a API da Deriv não está ativa." };
    }

    const contract = operationsLog.find(op => op.id === contractId);
    if (contract && contract.expirationTime) {
      const remainingTime = contract.expirationTime - Date.now();
      if (remainingTime < 1000) { 
        return { success: false, message: `O contrato #${contractId} está no período de bloqueio final e não pode ser vendido.` };
      }
    }

    try {
        const sellResponse: any = await makeRequest({ 
            "sell": contractId,
            "price": 0, 
        });

        const sellResult = sellResponse.sell;
        if (sellResult) {
            return { success: true, message: `Ordem de venda para o contrato ${contractId} enviada.` };
        } else {
            throw new Error("A resposta da API não continha os dados de venda esperados.");
        }
    } catch (error) {
        console.error("[Deriv Hook] Erro ao vender o contrato:", error);
        const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu ao vender o contrato.";
        return { success: false, message };
    }
  }, [isConnected, makeRequest, operationsLog]);
  
  const startConnectionMonitor = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    pingIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            try {
                wsRef.current.send(JSON.stringify({ ping: 1 }));
            } catch (error) {
                console.warn('[Ping] Failed:', error);
            }
        }
    }, 30000);
  }, []);
  
  const subscribeToStreams = useCallback(async (symbol: string) => {
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
    setPriceTicks([]);
    setBotCandleData([]);
    
    try {
        const currentChartType = chartTypeRef.current;
        const currentTimePeriod = timePeriodRef.current;

        const contractsRes: any = await makeRequest({ contracts_for: symbol });
        const tradingPeriod = contractsRes.contracts_for?.trading_period;
        const riseFallPeriod = tradingPeriod?.rise_fall;

        const newLimits: DurationLimits = { t: {min:0, max:0}, s: {min:0, max:0}, m: {min:0, max:0}, h: {min:0, max:0}, d: {min:0, max:0} };
        
        if (riseFallPeriod) {
            Object.keys(riseFallPeriod).forEach(unit => {
                const typedUnit = unit as keyof typeof riseFallPeriod;
                const durationData = riseFallPeriod[typedUnit];
                if(durationData && newLimits[typedUnit as DurationUnit]) {
                   newLimits[typedUnit as DurationUnit] = { min: durationData.min, max: durationData.max };
                }
            });
        }
        setDurationLimits(newLimits);
        
        const botHistory = await getHistoricalData(symbol, 'candles', 1000, '1m');
        setBotCandleData(botHistory as CandleData[]);
        
        const historyStyle = currentChartType === 'Candle' ? 'candles' : 'ticks';
        const uiHistory = await getHistoricalData(symbol, historyStyle, 1000, currentTimePeriod);
        
        const chartHistory = uiHistory.map(h => {
            if(historyStyle === 'candles' && h.open) {
                return { epoch: h.epoch, open: h.open, high: h.high, low: h.low, close: h.close, volume: h.volume } as CandleData;
            }
            return { epoch: h.epoch, price: h.price } as TickData;
        });

        setChartData(chartHistory as ChartData[]);
        if (historyStyle === 'ticks') {
            setPriceTicks(uiHistory as TickData[]);
        }
        setDataVersion(v => v + 1);

        let uiSubRequest: any;
        if (currentChartType === 'Candle') {
            uiSubRequest = { 
                ticks_history: symbol, 
                style: 'candles', 
                granularity: getGranularityForTimePeriod(currentTimePeriod), 
                subscribe: 1,
                end: "latest",
                count: 1,
                adjust_start_time: 1
            };
        } else {
            uiSubRequest = { 
                ticks: symbol, 
                subscribe: 1 
            };
        }
        const uiSubResponse: any = await makeRequest(uiSubRequest);
        if(uiSubResponse.subscription?.id) activeSubscriptionIdRef.current = uiSubResponse.subscription.id;
        
        const botSubRequest = { 
            ticks_history: symbol, 
            style: 'candles', 
            granularity: 60,
            subscribe: 1, 
            end: "latest", 
            count: 1, 
            adjust_start_time: 1 
        };
        const botSubResponse: any = await makeRequest(botSubRequest);
        if(botSubResponse.subscription?.id) botSubscriptionIdRef.current = botSubResponse.subscription.id;


    } catch (error: any) {
        console.error(`[Market Data] Error for ${symbol}:`, error);
        setChartError(error.message || 'Falha ao carregar dados do mercado.');
    } finally {
        setIsChartLoading(false);
    }
  }, [getHistoricalData, makeRequest]);
  
  useEffect(() => {
    if (!activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      return;
    }
    
    const connect = () => {
        setIsConnecting(true);
        setConnectionError(null);
        setIsAssetsLoading(true);
      
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
        wsRef.current = ws;
        
        ws.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                
                if (response.msg_type === 'ping' || response.pong) {
                    return;
                }
                
                const reqId = response.req_id;
    
                if (reqId && promisesRef.current.has(String(reqId))) {
                    const promise = promisesRef.current.get(String(reqId));
                    if (promise) {
                        if (response.error) {
                            const errorMessage = response.error.message || `Unknown API error. Code: ${response.error.code || 'N/A'}`;
                            promise.reject(new Error(`${errorMessage}`));
                        } else {
                            promise.resolve(response);
                        }
                        promisesRef.current.delete(String(reqId));
                    }
                    return; 
                }
    
                if (response.error && response.error.message) {
                     if (
                        response.error.code !== 'AlreadySubscribed' && 
                        response.error.code !== 'SellNotAvailable' && 
                        response.error.code !== 'ContractSellNotAvailable'
                     ) {
                      console.error(`[Deriv WS] Unsolicited Error:`, response.error.message);
                    }
                     return; 
                }
    
                switch (response.msg_type) {
                    case 'balance':
                        setAccountBalance({ 
                            balance: response.balance.balance, 
                            currency: response.balance.currency, 
                            loading: false 
                        });
                        break;
                    case 'proposal_open_contract':
                        const contract = response.proposal_open_contract;
                        if (!contract) return;

                        if ((contract.contract_type || '').startsWith('MULT')) {
                          return;
                        }

                        setAndPersistOperationsLog(prevLog => {
                            const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                            const isSold = contract.is_sold === 1;
                            
                            if (existingOpIndex !== -1) {
                                // UPDATE EXISTING OPERATION
                                const updatedLog = [...prevLog];
                                const op = updatedLog[existingOpIndex];
                                
                                if (op.status === 'pending') {
                                    if (isSold) {
                                        const newStatus = contract.profit >= 0 ? 'won' : 'lost';
                                        const exitPrice = contract.exit_tick_display_value ? parseFloat(contract.exit_tick_display_value) : contract.sell_spot ? parseFloat(contract.sell_spot) : op.exitPrice;
                                        const sellTime = contract.sell_time ? new Date(contract.sell_time * 1000).toISOString() : new Date().toISOString();
                                        
                                        updatedLog[existingOpIndex] = { ...op, status: newStatus, result: contract.profit, exitPrice: exitPrice, exitTimestamp: sellTime };
                                        
                                        if (op.initiator === 'Piloto' && user) {
                                            const logId = `pred_log_${contract.contract_id}`;
                                            const predictiveLogUpdate = {
                                                id: logId,
                                                result: newStatus,
                                                pnl: contract.profit,
                                            };
                                            savePredictiveTradeLog(user.uid, predictiveLogUpdate);
                                        }

                                        updateTradeAnnotation(String(contract.contract_id), { 
                                            status: newStatus, 
                                            profit: contract.profit, 
                                            exitPrice, 
                                            exitTime: contract.sell_time 
                                        });
                                        
                                        const toastMessage = {
                                            title: `Posição Fechada (${op.asset})`,
                                            description: `Resultado: ${contract.currency} ${contract.profit.toFixed(2)}`,
                                            variant: newStatus === 'won' ? 'default' : 'destructive',
                                        };
                                        
                                        setToastQueue(prev => [...prev, toastMessage]);
                    
                                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                                            wsRef.current.send(JSON.stringify({"balance": 1}));
                                        }
                                        return updatedLog;
                                    } else if (op.contractType?.startsWith('MULT') && contract.profit !== op.result) {
                                        updatedLog[existingOpIndex] = { ...op, result: contract.profit };
                                        return updatedLog;
                                    }
                                }
                                return prevLog;
                            
                            } else if (!isSold) {
                                if (recentlyCreatedContractsRef.current.has(contract.contract_id)) {
                                    return prevLog;
                                }

                                const direction = (contract.contract_type || '').includes('CALL') ? 'rise' : 'fall';
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
                                    multiplier: contract.multiplier,
                                    contractType: contract.contract_type,
                                };
                                
                                addTradeAnnotation({
                                    contractId: String(newOperation.id),
                                    entryTime: purchaseTime,
                                    entryPrice: newOperation.entryPrice!,
                                    direction: newOperation.direction,
                                    status: 'pending',
                                    stake: newOperation.stake,
                                    symbol: newOperation.asset,
                                    expirationTime: newOperation.expirationTime,
                                    contractType: (contract.contract_type || '').startsWith('MULT') ? 'multiplier' : 'option'
                                });
                    
                                return [newOperation, ...prevLog];
                            }
                            
                            return prevLog;
                        });
                        break;
                    case 'tick':
                        if (response.tick?.symbol === activeSymbol) {
                            const tick = response.tick;
                            const newTick = { epoch: tick.epoch, price: tick.quote };
                            if (chartTypeRef.current === 'Area') {
                               setChartData(prev => addDataPoint(prev, newTick));
                            }
                            setPriceTicks(prev => {
                                const newTicks = [...prev, newTick];
                                 if (newTicks.length > MAX_DATA_POINTS) {
                                    return newTicks.slice(1);
                                }
                                return newTicks;
                            });
                            setDataVersion(v => v + 1);
                        }
                        break;
                    
                    case 'ohlc':
                    case 'candles':
                        const candleData = response.ohlc || (response.candles && response.candles[0]);
                        
                        if (candleData && candleData.symbol === activeSymbol) {
                            const newCandle: CandleData = {
                                epoch: candleData.open_time || candleData.epoch,
                                open: parseFloat(candleData.open),
                                high: parseFloat(candleData.high),
                                low: parseFloat(candleData.low),
                                close: parseFloat(candleData.close),
                                volume: candleData.tick_count || 1,
                            };
    
                            const isForUI = response.subscription?.id === activeSubscriptionIdRef.current;
                            const isForBot = response.subscription?.id === botSubscriptionIdRef.current;
    
                            if (isForUI && chartTypeRef.current === 'Candle') {
                                setChartData(prev => addDataPoint(prev, newCandle));
                            }
                            if (isForBot) {
                                setBotCandleData(prev => addDataPoint(prev, newCandle) as CandleData[]);
                            }
                            
                            setPriceTicks(prev => {
                                const newTicks = [...prev, { epoch: newCandle.epoch, price: newCandle.close }];
                                if (newTicks.length > MAX_DATA_POINTS) {
                                    return newTicks.slice(newTicks.length - MAX_DATA_POINTS);
                                }
                                return newTicks;
                            });
                            setDataVersion(v => v + 1);
                        }
                        break;
                }
            } catch (parseError) {
                console.error('[Deriv WS] Parse error:', parseError);
            }
        };
    
        ws.onopen = async () => {
            try {
                reconnectInProgressRef.current = false;
                if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

                await makeRequest({ authorize: activeToken });
                setIsConnected(true);
                setIsConnecting(false);
                setConnectionError(null);
                
                ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
                ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
                
                const assetsRes: any = await makeRequest({ active_symbols: 'full', product_type: 'basic' });
                
                const groupedAssets: { [key: string]: Asset[] } = {};
                assetsRes.active_symbols.forEach((symbol: any) => {
                    const marketKey = (symbol.market === 'synthetic_index' && symbol.submarket === 'basket_index') ? 'basket_index' : symbol.market;
                    const groupName = marketNameMapping[marketKey] || 'Outros';
                    if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                    groupedAssets[groupName].push({
                        value: symbol.symbol,
                        label: symbol.display_name,
                        marketIsOpen: symbol.exchange_is_open === 1,
                        submarket: symbol.submarket,
                        market: marketKey,
                        minDuration: symbol.min_contract_duration ?? '5t', 
                    });
                });
                
                setAssetGroups(Object.keys(groupedAssets)
                    .map(label => ({ 
                        label, 
                        options: groupedAssets[label].sort((a, b) => a.label.localeCompare(b.label)) 
                    }))
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
                allowAutoReconnectRef.current = false; // PREVENT RECONNECT LOOP
                if (ws.readyState === WebSocket.OPEN) ws.close();
            }
        };
      
        ws.onclose = (event) => {
          if (!wsRef.current || reconnectInProgressRef.current) return;
          
          if (pingIntervalRef.current) {
              clearInterval(pingIntervalRef.current);
              pingIntervalRef.current = null;
          }
          
          promisesRef.current.forEach((p) => {
            if (p && typeof p.reject === 'function') {
              p.reject(new Error("WebSocket connection closed."))
            }
          });
          promisesRef.current.clear();
    
          if (!event.wasClean && allowAutoReconnectRef.current) {
            reconnectInProgressRef.current = true;
            console.warn(`[WS] Fechado inesperadamente. Código: ${event.code}. Tentando reconectar...`);
            setConnectionError(`Conexão perdida. Reconectando...`);
            
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            reconnectTimeoutRef.current = setTimeout(() => {
                reconnectInProgressRef.current = false;
                setTriggerReconnect(c => c + 1);
            }, 3000);
          } else if (!event.wasClean && !allowAutoReconnectRef.current) {
             console.error(`[WS] Conexão falhou permanentemente (provavelmente token inválido). Auto-reconexão desativada.`);
          }
          
          setIsConnected(false);
          setIsConnecting(false);
          setAccountBalance({ balance: null, currency: null, loading: false });
          wsRef.current = null;
        };
      
        ws.onerror = () => {
          // O evento onclose é mais fiável para obter o motivo do erro.
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
      if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectInProgressRef.current = false;
    };
  }, [activeToken, isLoading, triggerReconnect]);

  
  useEffect(() => {
    if (isConnected && activeSymbol && !isConnecting) {
        subscribeToStreams(activeSymbol);
    }
  }, [isConnected, isConnecting, activeSymbol, timePeriod, chartType, subscribeToStreams]);

  const setAccountType = useCallback((type: AccountType) => {
    try {
        localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, type);
        setAccountTypeState(type);
        allowAutoReconnectRef.current = true;
        setTriggerReconnect(c => c + 1); // Trigger a full reconnect
    } catch (error) {
        console.error("Failed to save account type to localStorage:", error);
    }
  }, []);

  const setTokens = useCallback((tokens: { demo?: string; real?: string }) => {
    try {
      if (tokens.demo) {
        localStorage.setItem(DERIV_DEMO_TOKEN_KEY, tokens.demo);
        setDemoToken(tokens.demo);
      }
      if (tokens.real) {
        localStorage.setItem(DERIV_REAL_TOKEN_KEY, tokens.real);
        setRealToken(tokens.real);
      }
      allowAutoReconnectRef.current = true;
      setTriggerReconnect(c => c + 1);
    } catch (error) {
      console.error("Failed to save token to localStorage:", error);
    }
  }, []);

  const disconnect = useCallback((type: AccountType) => {
    try {
      if (type === 'demo') {
        localStorage.removeItem(DERIV_DEMO_TOKEN_KEY);
        setDemoToken(null);
      } else {
        localStorage.removeItem(DERIV_REAL_TOKEN_KEY);
        setRealToken(null);
      }
    } catch (error) {
        console.error("Failed to remove token from localStorage:", error);
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

  const contextValue: DerivApiContextTypeV2 = useMemo(() => ({
    ws: wsRef.current,
    isConnected,
    isConnecting,
    connectionError,
    demoToken,
    realToken,
    activeToken,
    accountType,
    accountBalance,
    operationsLog,
    assetGroups,
    isAssetsLoading,
    activeSymbol,
    chartData,
    botCandleData,
    priceTicks,
    isChartLoading,
    chartError,
    chartType,
    timePeriod,
    dataVersion,
    tradeAnnotations,
    durationLimits,
    reconnect,
    setAccountType,
    setTokens,
    disconnect,
    setActiveSymbol,
    setChartType,
    setTimePeriod,
    executeTrade,
    sellContract,
    getHistoricalData,
    clearActiveContracts
  }), [
    isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, 
    accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, chartData, 
    botCandleData, priceTicks, isChartLoading, chartError, chartType, timePeriod, dataVersion, 
    tradeAnnotations, durationLimits, reconnect, setAccountType, setTokens, disconnect, 
    setActiveSymbol, setChartType, setTimePeriod, executeTrade, sellContract, getHistoricalData, 
    clearActiveContracts
  ]);

  return (
    <DerivApiContextV2.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiContextV2.Provider>
  );
}

export function useDerivApiV2() {
  const context = useContext(DerivApiContextV2);
  if (context === undefined) {
    throw new Error('useDerivApiV2 must be used within a DerivApiProviderV2');
  }
  return context;
}
