// src/features/trading/hooks/use-deriv-api-accumulators.tsx
'use client';

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult, Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { getDerivWebSocketUrl } from '@/app/actions';

const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_ACCUMULATORS_LOG_KEY = 'derivAccumulatorsOperationsLog_v4';
const DERIV_APP_ID = "34lwuJiPbEzxjgEdnEhbX"; 

const ACCOUNT_IDS = {
    demo: 'DOT93059550',
    real: 'ROT91769363'
};

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

export interface ConnectionEvent {
    timestamp: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
}

interface DerivApiAccumulatorsContextType {
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
  tradeAnnotations: TradeAnnotation[];
  connectionEvents: ConnectionEvent[];

  setAccountType: (type: AccountType) => void;
  setTokens: (tokens: { demo?: string; real?: string }) => void;
  disconnect: (type: AccountType) => void;
  reconnect: () => Promise<boolean>;
  executeTrade: (
    stake: number,
    growth_rate: number,
    symbol: string,
    initiator: OperationInitiator,
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<any[]>;
  clearActiveContracts: () => void;
}

const DerivApiAccumulatorsContext = createContext<DerivApiAccumulatorsContextType | undefined>(undefined);

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

const MAX_DATA_POINTS = 1000;
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

export const DerivApiProviderAccumulators = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [realToken, setRealToken] = useState<string | null>(null);
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const sellingContractsRef = useRef<Set<number>>(new Set());
  
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const [toastQueue, setToastQueue] = useState<any[]>([]);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);
  const [connectionEvents, setConnectionEvents] = useState<ConnectionEvent[]>([]);

  const [activeSymbol, setActiveSymbol] = useState<string | null>('1HZ10V');
  const activeSymbolRef = useRef<string | null>('1HZ10V');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [botCandleData, setBotCandleData] = useState<CandleData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]); 
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const chartTypeRef = useRef(chartType);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('1m');
  const timePeriodRef = useRef(timePeriod);
  const [dataVersion, setDataVersion] = useState(0); 
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const botSubscriptionIdRef = useRef<string | null>(null);

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
  
  const addEvent = useCallback((message: string, type: ConnectionEvent['type'] = 'info') => {
      setConnectionEvents(prev => [{ timestamp: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
  }, []);

  const setAndPersistOperationsLog = useCallback((updater: React.SetStateAction<Operation[]>) => {
      setOperationsLog(prevLog => {
          const newLog = typeof updater === 'function' ? updater(prevLog) : updater;
          try {
              localStorage.setItem(DERIV_ACCUMULATORS_LOG_KEY, JSON.stringify(newLog));
          } catch (error) {
              console.error("Failed to save accumulators log to localStorage:", error);
          }
          return newLog;
      });
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

  const clearActiveContracts = useCallback(() => {
    setAndPersistOperationsLog([]);
    setTradeAnnotations([]);
  }, [setAndPersistOperationsLog]);

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
      const storedLog = localStorage.getItem(DERIV_ACCUMULATORS_LOG_KEY);

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
            return resolve({ error: { message: "WebSocket não está conectado." } } as any);
        }
  
        const req_id = Date.now() + Math.floor(Math.random() * 1000000);
        const payload = { ...request, req_id };
        
        if (!noResponse) {
            const timeoutId = setTimeout(() => {
                if (promisesRef.current.has(String(req_id))) {
                    const promise = promisesRef.current.get(String(req_id));
                    promise?.resolve({ error: { message: `O pedido à API expirou.` } } as any);
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
  
  const getHistoricalData = useCallback(async (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod): Promise<any[]> => {
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
          if (response.error) throw new Error(response.error.message);

          if (response.history) {
              return response.history.times.map((time: number, index: number) => ({
                  epoch: time,
                  price: response.history.prices[index],
              }));
          }
        
          if (response.candles) {
              return response.candles.map((candle: any) => ({
                  epoch: candle.epoch,
                  open: parseFloat(candle.open),
                  high: parseFloat(candle.high),
                  low: parseFloat(candle.low),
                  close: parseFloat(candle.close),
                  volume: candle.tick_count || 1,
              }));
          }
          
          return [];
      } catch (error: any) {
          console.error('[getHistoricalData] Error:', error);
          throw error;
      }
  }, [makeRequest]);

  const executeTrade = useCallback(async (
    stake: number,
    growth_rate: number,
    symbol: string,
    initiator: OperationInitiator = 'Manual'
  ): Promise<TradeResult> => {
    try {
      if (!wsRef.current || !isConnected) {
        throw new Error("A conexão com a API da Deriv não está ativa.");
      }
      
      const sanitizedStake = parseFloat(stake.toFixed(2));
      const sanitizedGrowthRate = parseFloat(growth_rate.toFixed(2));
      
      const proposalResponse: any = await makeRequest({
          proposal: 1,
          contract_type: "ACCU",
          symbol: symbol,
          amount: sanitizedStake,
          basis: "stake",
          currency: "USD",
          growth_rate: sanitizedGrowthRate,
      });

      if (proposalResponse.error) throw new Error(proposalResponse.error.message);

      const proposal = proposalResponse.proposal;
      if (!proposal || !proposal.id) {
          throw new Error("Falha ao obter uma proposta de negociação da API.");
      }
      
      const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": sanitizedStake });
      if (buyResponse.error) throw new Error(buyResponse.error.message);
      
      const buyResult = buyResponse.buy;
      const contractId = buyResult.contract_id;
      if (!contractId) {
        throw new Error("Falha na compra do contrato, ID não retornado.");
      }
      
      const entryPrice = buyResult.entry_spot_display_value ? parseFloat(buyResult.entry_spot_display_value) : 0;
      const purchaseTime = buyResult.purchase_time || Math.floor(Date.now() / 1000);

      const newOperation: Operation = {
          id: contractId,
          asset: symbol,
          direction: 'rise',
          stake: sanitizedStake,
          status: 'pending',
          timestamp: new Date(purchaseTime * 1000).toISOString(),
          initiator,
          entryPrice: entryPrice,
          isSellable: true,
          contractType: 'ACCU',
          duration: 0,
          durationUnit: 's',
          multiplier: 1,
      };
      setAndPersistOperationsLog(prevLog => [newOperation, ...prevLog]);

      addTradeAnnotation({
        contractId: String(contractId),
        entryTime: purchaseTime,
        entryPrice: entryPrice,
        direction: 'rise',
        status: 'pending',
        stake: sanitizedStake,
        symbol,
        expirationTime: undefined,
        contractType: 'accumulator'
      });

      return {
        success: true,
        message: `Contrato Acumulador comprado.`,
        contractId: contractId,
        entryPrice: entryPrice,
      };
    } catch (error) {
       console.error("[Deriv Hook] Erro ao negociar Acumuladores:", error);
       const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
       return { success: false, message };
    }
  }, [isConnected, makeRequest, setAndPersistOperationsLog, addTradeAnnotation]);

  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) {
        return { success: false, message: "Conexão inativa." };
    }
    if (sellingContractsRef.current.has(contractId)) {
        return { success: false, message: `Venda já em curso.` };
    }

    sellingContractsRef.current.add(contractId);

    try {
        const sellResponse: any = await makeRequest({ sell: contractId, price: 0 });

        if (sellResponse.error) {
            const message = sellResponse.error.message || 'Erro de API';
            sellingContractsRef.current.delete(contractId);
            return { success: false, message };
        }

        return { success: true, message: `Venda enviada.` };
    } catch (error: any) {
        sellingContractsRef.current.delete(contractId);
        return { success: false, message: error.message || "Erro de rede." };
    }
  }, [isConnected, makeRequest]);
  
  const subscribeToStreams = useCallback(async (symbol: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    
    if (activeSubscriptionIdRef.current) {
        try { await makeRequest({ forget: activeSubscriptionIdRef.current }, true); } catch (e) {}
    }
    if (botSubscriptionIdRef.current) {
        try { await makeRequest({ forget: botSubscriptionIdRef.current }, true); } catch (e) {}
    }

    activeSubscriptionIdRef.current = null;
    botSubscriptionIdRef.current = null;

    setIsChartLoading(true);
    setChartError(null);
    setChartData([]);
    setBotCandleData([]);
    setPriceTicks([]);
    
    try {
        const botHistory = await getHistoricalData(symbol, 'candles', 1000, '1m') as CandleData[];
        setBotCandleData(botHistory);
        
        const botSubRequest = { ticks_history: symbol, style: 'candles', granularity: 60, subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 };
        const botSubResponse: any = await makeRequest(botSubRequest);
        if(botSubResponse.subscription?.id) botSubscriptionIdRef.current = botSubResponse.subscription.id;

        if (chartTypeRef.current === 'Area') {
            const tickHistory = await getHistoricalData(symbol, 'ticks', 1000);
            setChartData(tickHistory as TickData[]);
            setPriceTicks(tickHistory as TickData[]);
            const tickSubResponse: any = await makeRequest({ ticks: symbol, subscribe: 1 });
            if(tickSubResponse.subscription?.id) activeSubscriptionIdRef.current = tickSubResponse.subscription.id;
        } else {
            const uiHistory = await getHistoricalData(symbol, 'candles', 1000, timePeriodRef.current);
            setChartData(uiHistory as CandleData[]);
            const uiSubRequest = { ticks_history: symbol, style: 'candles', granularity: getGranularityForTimePeriod(timePeriodRef.current), subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 };
            const uiSubResponse: any = await makeRequest(uiSubRequest);
            if(uiSubResponse.subscription?.id) activeSubscriptionIdRef.current = uiSubResponse.subscription.id;
        }
    } catch (error: any) {
        setChartError(error.message || 'Falha ao carregar dados.');
    } finally {
        setIsChartLoading(false);
    }
  }, [getHistoricalData, makeRequest]);
  
  const startConnectionMonitor = useCallback(() => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    pingIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            try { wsRef.current.send(JSON.stringify({ ping: 1 })); } catch (error) {}
        }
    }, 30000);
  }, []);
  
  useEffect(() => {
    if (!user || !activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
      return;
    }
    const connect = async () => {
        setIsConnecting(true);
        setConnectionError(null);
        setIsAssetsLoading(true);
        addEvent(`Iniciando handshake OTP...`, 'info');

        const accountId = ACCOUNT_IDS[accountType];
        const otpResult = await getDerivWebSocketUrl(activeToken.trim(), accountId);
        
        if (!otpResult.success || !otpResult.url) {
            const msg = otpResult.error || 'Falha no túnel OTP.';
            setConnectionError(msg);
            addEvent(msg, 'error');
            setIsConnecting(false); setIsConnected(false); setIsAssetsLoading(false);
            return;
        }

        if (wsRef.current) wsRef.current.close();
        const ws = new WebSocket(otpResult.url);
        wsRef.current = ws;
        
        ws.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                const reqId = response.req_id;
                if (reqId && promisesRef.current.has(String(reqId))) {
                    const promise = promisesRef.current.get(String(reqId));
                    if (promise) {
                        if (response.error) promise.resolve(response);
                        else promise.resolve(response);
                        promisesRef.current.delete(String(reqId));
                    }
                    return;
                }
                
                switch (response.msg_type) {
                    case 'balance':
                        setAccountBalance({ balance: response.balance.balance, currency: response.balance.currency, loading: false });
                        break;
                    case 'proposal_open_contract':
                        const contract = response.proposal_open_contract;
                        if (!contract || contract.contract_type !== 'ACCU') return;
                        setAndPersistOperationsLog(prevLog => {
                            const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                            const isSold = contract.is_sold === 1;
                            if (existingOpIndex !== -1) {
                                const updatedLog = [...prevLog];
                                const op = updatedLog[existingOpIndex];
                                const updatedOp: Operation = { ...op, result: contract.profit };
                                if (isSold) {
                                    sellingContractsRef.current.delete(contract.contract_id);
                                    const newStatus = contract.profit >= 0 ? 'won' : 'lost';
                                    updatedOp.status = newStatus;
                                    updatedOp.exitPrice = parseFloat(contract.sell_spot || '0');
                                    updatedOp.exitTimestamp = new Date(contract.sell_time * 1000).toISOString();
                                    updateTradeAnnotation(String(contract.contract_id), { status: newStatus, profit: contract.profit, exitPrice: updatedOp.exitPrice, exitTime: contract.sell_time });
                                    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({"balance": 1}));
                                }
                                updatedLog[existingOpIndex] = updatedOp;
                                return updatedLog;
                            }
                            return prevLog;
                        });
                        break;
                    case 'tick':
                        if (response.tick?.symbol === activeSymbolRef.current) {
                            const newTick = { epoch: response.tick.epoch, price: response.tick.quote };
                            setPriceTicks(prev => [...prev, newTick].slice(-MAX_DATA_POINTS));
                            if (chartTypeRef.current === 'Area') setChartData(prev => addDataPoint(prev, newTick));
                            setDataVersion(v => v + 1);
                        }
                        break;
                    case 'ohlc':
                    case 'candles':
                        const candleData = response.ohlc || (response.candles && response.candles[0]);
                        if (candleData && candleData.symbol === activeSymbolRef.current) {
                             const newCandle: CandleData = {
                                epoch: candleData.open_time || candleData.epoch,
                                open: parseFloat(candleData.open), high: parseFloat(candleData.high),
                                low: parseFloat(candleData.low), close: parseFloat(candleData.close),
                                volume: candleData.tick_count || 1
                             };
                             if(response.subscription?.id === botSubscriptionIdRef.current) {
                                setBotCandleData(prev => addDataPoint(prev, newCandle) as CandleData[]);
                             }
                             if (response.subscription?.id === activeSubscriptionIdRef.current) {
                                setChartData(prev => addDataPoint(prev, newCandle));
                             }
                             setDataVersion(v => v + 1);
                        }
                        break;
                }
            } catch (e) { console.error('[Deriv WS] Parse error:', e); }
        };
        ws.onopen = async () => {
            try {
                reconnectInProgressRef.current = false;
                if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                
                const authRes: any = await makeRequest({ authorize: activeToken });
                if (authRes.error) throw new Error(authRes.error.message);
                
                setIsConnected(true); setIsConnecting(false); setConnectionError(null);
                addEvent('Conexão OTP v3 estabelecida.', 'success');
                
                ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
                ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
                
                startConnectionMonitor();
                const assetsRes: any = await makeRequest({ active_symbols: 'full' });
                if (assetsRes.error) throw new Error(assetsRes.error.message);

                const filtered = assetsRes.active_symbols.filter((s: any) => s.market === 'synthetic_index' && s.allow_accumulator_contracts === 1);
                const groupedAssets: { [key: string]: Asset[] } = {};
                filtered.forEach((s: any) => {
                    const groupName = marketNameMapping[s.market] || 'Outros';
                    if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                    groupedAssets[groupName].push({ value: s.symbol, label: s.display_name, marketIsOpen: s.exchange_is_open === 1, submarket: s.submarket, market: s.market, minDuration: 'N/A' });
                });
                setAssetGroups(Object.keys(groupedAssets).map(label => ({ label, options: groupedAssets[label].sort((a,b)=>a.label.localeCompare(b.label)) })));
                setIsAssetsLoading(false);
            } catch (error: any) {
                const msg = error instanceof Error ? error.message : 'Erro desconhecido';
                setConnectionError(msg);
                addEvent(msg, 'error');
                setIsConnected(false); setIsConnecting(false); setIsAssetsLoading(false);
                allowAutoReconnectRef.current = false;
                if (ws.readyState === WebSocket.OPEN) ws.close();
            }
        };
        ws.onclose = (event) => {
          if (!wsRef.current || reconnectInProgressRef.current) return;
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          promisesRef.current.forEach((p) => p.reject(new Error("WS Closed")));
          promisesRef.current.clear();
          if (!event.wasClean && allowAutoReconnectRef.current) {
            reconnectInProgressRef.current = true;
            addEvent('Conexão perdida. Reconectando...', 'warning');
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(() => {
                reconnectInProgressRef.current = false;
                setTriggerReconnect(c => c + 1);
            }, 3000);
          }
          setIsConnected(false); setIsConnecting(false);
          setAccountBalance({ balance: null, currency: null, loading: false });
          wsRef.current = null;
        };
    };
    connect();
    return () => {
      allowAutoReconnectRef.current = false;
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectInProgressRef.current = false;
    };
  }, [activeToken, isLoading, triggerReconnect, accountType, addEvent, makeRequest, startConnectionMonitor, setAndPersistOperationsLog, updateTradeAnnotation, addTradeAnnotation]);

  useEffect(() => {
    if (isConnected && activeSymbol && !isConnecting) subscribeToStreams(activeSymbol);
  }, [isConnected, activeSymbol, isConnecting, chartType, timePeriod, subscribeToStreams]);
  
  const reconnect = useCallback(async (): Promise<boolean> => {
    setTriggerReconnect(c => c + 1);
    return true;
  }, []);

  const contextValue: DerivApiAccumulatorsContextType = useMemo(() => ({
    ws: wsRef.current, isConnected, isConnecting, connectionError, demoToken, realToken, activeToken,
    accountType, accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, 
    setActiveSymbol: (s) => { setActiveSymbol(s); activeSymbolRef.current = s; }, 
    chartData, botCandleData, isChartLoading, chartError, chartType, setChartType, 
    timePeriod, setTimePeriod, dataVersion, tradeAnnotations, priceTicks, connectionEvents,
    setAccountType: (t) => { localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, t); setAccountTypeState(t); setTriggerReconnect(c => c + 1); },
    setTokens: (t) => { if(t.demo) localStorage.setItem(DERIV_DEMO_TOKEN_KEY, t.demo); if(t.real) localStorage.setItem(DERIV_REAL_TOKEN_KEY, t.real); setTriggerReconnect(c => c + 1); },
    disconnect: (t) => { if(t === 'demo') localStorage.removeItem(DERIV_DEMO_TOKEN_KEY); else localStorage.removeItem(DERIV_REAL_TOKEN_KEY); setTriggerReconnect(c => c + 1); },
    reconnect, 
    executeTrade, sellContract, getHistoricalData, 
    clearActiveContracts
  }), [
    isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, 
    accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol,
    chartData, botCandleData, isChartLoading, chartError, chartType, timePeriod, dataVersion, 
    tradeAnnotations, priceTicks, connectionEvents, executeTrade, sellContract, getHistoricalData, clearActiveContracts, reconnect
  ]);

  return (
    <DerivApiAccumulatorsContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiAccumulatorsContext.Provider>
  );
}

export function useDerivApiAccumulators() {
  const context = useContext(DerivApiAccumulatorsContext);
  if (context === undefined) {
    throw new Error('useDerivApiAccumulators must be used within a DerivApiProviderAccumulators');
  }
  return context;
}
