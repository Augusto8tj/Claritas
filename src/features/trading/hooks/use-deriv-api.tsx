// /src/features/trading/hooks/use-deriv-api.tsx
'use client';

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult } from '@/services/deriv-api-service';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/firebase-error-listener';


const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
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
  
  // Data for consumers
  activeSymbol: string | null;
  setActiveSymbol: (symbol: string | null) => void;
  chartData: ChartData[];
  priceTicks: TickData[]; // Expose price ticks for the arena
  isChartLoading: boolean;
  chartError: string | null;
  chartType: ChartType;
  setChartType: (type: ChartType) => void;
  timePeriod: TimePeriod;
  setTimePeriod: (period: TimePeriod) => void;
  dataVersion: number; // NOVO: Sinal de atualização de dados

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

const DerivApiContext = createContext<DerivApiContextType | undefined>(undefined);

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

const addDataPoint = (prevData: ChartData[], newPoint: ChartData): ChartData[] => {
    let data = [...prevData];
    if (data.length > 0 && data[data.length - 1].epoch === newPoint.epoch) {
        data[data.length - 1] = newPoint;
        return data;
    }
    data.push(newPoint);
    if (data.length > MAX_DATA_POINTS) {
        return data.slice(1);
    }
    return data;
};

// Função central para obter os limites de duração de um ativo
const getDurationLimitsForAsset = (minDurationStr: string | undefined): DurationLimits => {
    const defaultLimits: DurationLimits = {
        t: { min: 5, max: 10 },
        s: { min: 15, max: 365 * 24 * 3600 },
        m: { min: 1, max: 365 * 24 * 60 },
        h: { min: 1, max: 365 * 24 },
        d: { min: 1, max: 365 },
    };

    if (!minDurationStr) return defaultLimits;
    
    try {
        const unit = minDurationStr.slice(-1) as DurationUnit;
        const value = parseInt(minDurationStr.slice(0, -1), 10);
    
        if (isNaN(value) || !defaultLimits[unit]) return defaultLimits;
        
        // Cria uma cópia para não mutar o default
        const specificLimits = JSON.parse(JSON.stringify(defaultLimits));
        specificLimits[unit].min = value;
    
        return specificLimits;
    } catch {
        return defaultLimits;
    }
};

const getDurationInSeconds = (duration: number, unit: 't' | 's' | 'm' | 'h' | 'd'): number => {
    switch (unit) {
        case 't': return duration * 2; // Aproximação para vol-indices
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration; // Fallback seguro
    }
};


export const DerivApiProvider = ({ children }: { children: ReactNode }) => {
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [realToken, setRealToken] = useState<string | null>(null);
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const { toast } = useToast();
  
  const [toastQueue, setToastQueue] = useState<any[]>([]);

  const [activeSymbol, setActiveSymbol] = useState<string | null>('1HZ10V');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]);
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('5m');
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);
  const [dataVersion, setDataVersion] = useState(0); 

  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const promisesRef = useRef<Map<string, PromiseCallbacks>>(new Map());
  const [triggerReconnect, setTriggerReconnect] = useState(0);

  useEffect(() => {
    try {
      const storedDemoToken = localStorage.getItem(DERIV_DEMO_TOKEN_KEY) || process.env.NEXT_PUBLIC_DERIV_DEMO_TOKEN;
      const storedRealToken = localStorage.getItem(DERIV_REAL_TOKEN_KEY) || process.env.NEXT_PUBLIC_DERIV_REAL_TOKEN;
      const storedAccountType = localStorage.getItem(DERIV_ACCOUNT_TYPE_KEY) as AccountType | null;
      
      if (storedDemoToken) setDemoToken(storedDemoToken);
      if (storedRealToken) setRealToken(storedRealToken);
      if (storedAccountType) setAccountTypeState(storedAccountType);
      
    } catch (error) {
      console.error("Failed to access localStorage:", error);
    }
    setIsLoading(false);
  }, []);
  
  const activeToken = accountType === 'demo' ? demoToken : realToken;

  const durationLimits = useMemo(() => {
    if (!activeSymbol || assetGroups.length === 0) {
      return getDurationLimitsForAsset(undefined);
    }
    const allAssets = assetGroups.flatMap(g => g.options);
    const asset = allAssets.find(a => a.value === activeSymbol);
    return getDurationLimitsForAsset(asset?.minDuration);
  }, [activeSymbol, assetGroups]);

  // Process toast queue safely
  useEffect(() => {
    if (toastQueue.length > 0) {
      toastQueue.forEach(t => toast(t));
      setToastQueue([]);
    }
  }, [toastQueue, toast]);


  const makeRequest = useCallback(<T,>(request: object): Promise<T> => {
    return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return reject(new Error("WebSocket is not connected."));
        }

        const req_id = Date.now() + Math.floor(Math.random() * 1000000);
        const payload = { ...request, req_id };
        
        const timeoutId = setTimeout(() => {
            if (promisesRef.current.has(String(req_id))) {
                promisesRef.current.delete(String(req_id));
                reject(new Error(`Request timed out for req_id: ${req_id}`));
            }
        }, 15000);
        
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

        ws.send(JSON.stringify(payload));
    });
  }, []); 
  
    const addTradeAnnotation = useCallback((annotation: Omit<TradeAnnotation, 'id'>) => {
      const newAnnotation: TradeAnnotation = {
        ...annotation,
        createdAt: performance.now(),
        id: `annotation-${annotation.contractId}`,
      };
      setTradeAnnotations(prev => [...prev, newAnnotation]);
    }, []);

    const updateTradeAnnotation = useCallback((contractId: string, updates: Partial<TradeAnnotation>) => {
      setTradeAnnotations(prev => prev.map(ann => 
        ann.contractId === contractId ? { ...ann, ...updates } : ann
      ));
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
                    volume: 1, // Ticks têm volume 1
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
          if (!wsRef.current || !isConnected) {
            throw new Error("A conexão com a API da Deriv não está ativa.");
          }

          const sanitizedStake = parseFloat(stake.toFixed(2));

          try {
            const proposalResponse: any = await makeRequest({ 
                "proposal": 1,
                "amount": sanitizedStake,
                "basis": "stake",
                "contract_type": contractType,
                "currency": "USD",
                "duration": duration,
                "duration_unit": durationUnit,
                "symbol": symbol,
            });

            const proposal = proposalResponse.proposal;
            if (!proposal || !proposal.id) {
              throw new Error("Falha ao obter uma proposta de negociação da API.");
            }
            
            const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": proposal.ask_price });
            const buyResult = buyResponse.buy;
            
            const entryPrice = buyResult.entry_tick_display_value ? parseFloat(buyResult.entry_tick_display_value) : buyResult.buy_price;

            const isSellable = durationUnit !== 't';
            
            // Calcula o tempo de expiração em milissegundos
            const durationInSeconds = getDurationInSeconds(duration, durationUnit);
            const purchaseTimeMs = (buyResult.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
            const expirationTimeMs = purchaseTimeMs + durationInSeconds * 1000;

            const newOperation: Operation = {
                id: buyResult.contract_id,
                asset: symbol,
                direction: tradeDirection,
                stake: sanitizedStake,
                status: 'pending',
                timestamp: new Date(purchaseTimeMs).toISOString(),
                duration: duration,
                durationUnit: durationUnit,
                initiator,
                entryPrice: entryPrice,
                isSellable,
                expirationTime: expirationTimeMs,
            };
            setOperationsLog(prevLog => [newOperation, ...prevLog]);

            const entryTime = buyResult.purchase_time;
            
            addTradeAnnotation({
                contractId: String(buyResult.contract_id),
                entryTime: entryTime,
                entryPrice,
                direction: tradeDirection,
                status: 'pending',
                stake: sanitizedStake,
                symbol,
            });

            return {
              success: true,
              message: `Ordem do tipo "${contractType}" para ${symbol} no valor de ${sanitizedStake} USD executada com sucesso.`,
              contractId: buyResult.contract_id,
            };
          } catch (error) {
             console.error("[Deriv Hook] Erro durante a negociação:", error);
             const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
             return { success: false, message };
          }
      }, [isConnected, makeRequest, addTradeAnnotation]);

  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) {
        return { success: false, message: "A conexão com a API da Deriv não está ativa." };
    }

    const contract = operationsLog.find(op => op.id === contractId);
    if (contract && contract.expirationTime) {
      const remainingTime = contract.expirationTime - Date.now();
      if (remainingTime < 15000) { 
        return { success: false, message: `O contrato ${contractId} está no período de bloqueio final e não pode ser vendido.` };
      }
    }

    try {
        const sellResponse: any = await makeRequest({ 
            "sell": contractId,
            "price": 0, // Sell at market price
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


  useEffect(() => {
    if (!activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
      return;
    }
  
    const connect = () => {
      setIsConnecting(true);
      setAccountBalance({ balance: null, currency: null, loading: true });
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
              const reqId = response.req_id;
              
              if (reqId && promisesRef.current.has(String(reqId))) {
                  const promise = promisesRef.current.get(String(reqId));
                  promisesRef.current.delete(String(reqId));
                  if (response.error) {
                      const errorMessage = response.error.message || `Unknown API error. Code: ${response.error.code || 'N/A'}`;
                      const errorDetails = JSON.stringify(response.error);
                      promise?.reject(new Error(`${errorMessage} | Details: ${errorDetails}`));
                  } else {
                      queueMicrotask(() => promise?.resolve(response));
                  }
              }
              
              if (response.error && response.error.message) {
                   if (
                      response.error.code !== 'AlreadySubscribed' && 
                      response.error.code !== 'SellNotAvailable'
                   ) {
                    console.error(`[Deriv WS] Error:`, response.error.message);
                  }
              }
              
              if (response.subscription && response.subscription.id) {
                  const req = response.echo_req;
                  if (req && (req.ticks || req.ticks_history)) {
                      activeSubscriptionIdRef.current = response.subscription.id;
                  }
              }
  
              switch (response.msg_type) {
                  case 'balance':
                      setAccountBalance({ balance: response.balance.balance, currency: response.balance.currency, loading: false });
                      break;
                  case 'proposal_open_contract':
                      const contract = response.proposal_open_contract;
                      if (!contract) return;
                      
                      const contractId = contract.contract_id;
                      
                      setOperationsLog(prevLog => prevLog.map(op => {
                          if (op.id === contractId) {
                              const newStatus = contract.is_sold ? (contract.profit >= 0 ? 'won' : 'lost') : 'pending';
                              
                              if (contract.is_sold) {
                                  setToastQueue(prev => [...prev, {
                                      title: "Negociação Encerrada",
                                      description: `Contrato ${contractId}: ${contract.profit >= 0 ? `Lucro de ${contract.currency} ${contract.profit.toFixed(2)}` : `Prejuízo de ${contract.currency} ${Math.abs(contract.profit).toFixed(2)}`}`,
                                      variant: contract.profit < 0 ? "destructive" : "default",
                                  }]);
                                  
                                  const sellTime = contract.sell_time ? contract.sell_time * 1000 : Date.now();
                                  
                                  updateTradeAnnotation(String(contractId), {
                                      exitTime: contract.sell_time || Math.floor(Date.now() / 1000),
                                      exitPrice: parseFloat(contract.exit_tick_display_value),
                                      status: newStatus,
                                      profit: contract.profit,
                                  });
                                  
                                  // Refresh balance after a trade closes
                                  if (wsRef.current?.readyState === WebSocket.OPEN) {
                                      wsRef.current.send(JSON.stringify({"balance": 1}));
                                  }
  
                                  return { ...op, status: newStatus, result: contract.profit, exitPrice: parseFloat(contract.exit_tick_display_value), exitTimestamp: new Date(sellTime).toISOString() };
                              } else {
                                  // Update current profit for open contracts
                                  return { ...op, result: contract.profit };
                              }
                          }
                          return op;
                      }));
                      
                      break;
                  case 'tick':
                      if (response.tick?.symbol === activeSymbol) {
                          const tick = response.tick;
                          const newTick = { epoch: tick.epoch, price: tick.quote };
                          if (chartType === 'Area') {
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
                      if (chartType === 'Candle' && candleData && candleData.symbol === activeSymbol) {
                          const newCandle: CandleData = {
                              epoch: candleData.open_time || candleData.epoch,
                              open: parseFloat(candleData.open),
                              high: parseFloat(candleData.high),
                              low: parseFloat(candleData.low),
                              close: parseFloat(candleData.close),
                              volume: candleData.tick_count || 1,
                          };
                          setChartData(prev => addDataPoint(prev, newCandle));
                          setDataVersion(v => v + 1);
                      }
                      break;
              }
          } catch (parseError) {
              console.error('[Deriv WS] Failed to parse message:', parseError);
          }
      };
  
      ws.onopen = async () => {
          try {
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
                      minDuration: symbol.min_contract_duration ?? '5t', // Fallback
                  });
              });
              
              setAssetGroups(Object.keys(groupedAssets)
                  .map(label => ({ label, options: groupedAssets[label].sort((a, b) => a.label.localeCompare(b.label)) }))
                  .sort((a, b) => a.label.localeCompare(b.label)));
              setIsAssetsLoading(false);
      
          } catch (error: any) {
              let errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao conectar';
              setConnectionError(`Falha na autorização: ${errorMessage}`);
              setIsConnected(false);
              setIsConnecting(false);
              setIsAssetsLoading(false);
              setAccountBalance({ balance: null, currency: null, loading: false });
              if (ws.readyState === WebSocket.OPEN) ws.close();
          }
      };
    
      ws.onclose = (event) => {
        if (!wsRef.current) return;
        const { wasClean, code, reason } = event;
        if (promisesRef.current) {
          promisesRef.current.forEach((p) => p.reject(new Error("WebSocket connection closed.")));
          promisesRef.current.clear();
        }
        
        if (!wasClean) {
          setConnectionError(`A conexão foi encerrada inesperadamente. Código: ${code}. Razão: ${reason || 'N/A'}.`);
        }
        setIsConnected(false);
        setIsConnecting(false);
        setAccountBalance({ balance: null, currency: null, loading: false });
        wsRef.current = null;
      };
    
      ws.onerror = (errorEvent) => {
        console.error('[Deriv WS] WebSocket error occurred.');
        setAccountBalance({ balance: null, currency: null, loading: false });
      };
    };
    
    connect();

    return () => {
      if (wsRef.current) {
          wsRef.current.onclose = null;
          wsRef.current.close();
      }
    };
  }, [activeToken, isLoading, makeRequest, updateTradeAnnotation, toast, triggerReconnect]);

  const subscribeToMarketData = useCallback(async (symbol: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    if (activeSubscriptionIdRef.current) {
        try { 
            await makeRequest({ forget: activeSubscriptionIdRef.current });
        } catch (e) { 
            // Ignore if forget fails, we will subscribe to the new one anyway.
        }
        activeSubscriptionIdRef.current = null;
    }

    setIsChartLoading(true);
    setChartError(null);
    setChartData([]);
    setPriceTicks([]); 

    try {
        const historyStyle = chartType === 'Candle' ? 'candles' : 'ticks';
        const history = await getHistoricalData(symbol, historyStyle, 1000, timePeriod);
        
        const chartHistory = history.map(h => {
            if(historyStyle === 'candles') {
                return { epoch: h.epoch, open: h.open, high: h.high, low: h.low, close: h.close, volume: h.volume } as CandleData;
            }
            return { epoch: h.epoch, price: h.price } as TickData;
        });

        setChartData(chartHistory as ChartData[]);
        if (historyStyle === 'ticks') {
            setPriceTicks(history as TickData[]);
        }
        setDataVersion(v => v + 1);

        let subRequest: any;
        if (chartType === 'Candle') {
            subRequest = { 
                ticks_history: symbol, 
                style: 'candles', 
                granularity: getGranularityForTimePeriod(timePeriod), 
                subscribe: 1,
                end: "latest",
                count: 1,
                adjust_start_time: 1
            };
        } else {
            subRequest = { 
                ticks: symbol, 
                subscribe: 1 
            };
        }
        
        // For subscriptions, we don't wait for a response in the promise queue
        wsRef.current.send(JSON.stringify(subRequest));
        console.log(`[Market Data] Subscription request sent for ${symbol} (${chartType}).`);

    } catch (error: any) {
        console.error(`[Market Data] Error for ${symbol}:`, error);
        setChartError(error.message || 'Falha ao carregar dados do mercado.');
    } finally {
        setIsChartLoading(false);
    }
  }, [getHistoricalData, makeRequest, chartType, timePeriod]);
  
  useEffect(() => {
    if (isConnected && activeSymbol) {
        subscribeToMarketData(activeSymbol);
    }
  }, [isConnected, activeSymbol, subscribeToMarketData, chartType, timePeriod]);

  const setAccountType = useCallback((type: AccountType) => {
    try {
        localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, type);
        setAccountTypeState(type);
        setTriggerReconnect(c => c + 1); // Trigger a full reconnect
    } catch (error) {
        console.error("Failed to save account type to localStorage:", error);
    }
  }, []);

  const setTokens = (tokens: { demo?: string; real?: string }) => {
    try {
      if (tokens.demo) {
        localStorage.setItem(DERIV_DEMO_TOKEN_KEY, tokens.demo);
        setDemoToken(tokens.demo);
      }
      if (tokens.real) {
        localStorage.setItem(DERIV_REAL_TOKEN_KEY, tokens.real);
        setRealToken(tokens.real);
      }
    } catch (error) {
      console.error("Failed to save token to localStorage:", error);
    }
  };

  const disconnect = (type: AccountType) => {
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
  };
  
 const reconnect = useCallback(async (): Promise<boolean> => {
    setIsConnecting(true);
    setConnectionError(null);
    setTriggerReconnect(c => c + 1);
    
    // Espera um tempo para que o useEffect de conexão seja acionado e resolva
    return new Promise(resolve => {
        const checkConnection = () => {
            if (wsRef.current?.readyState === WebSocket.OPEN && isConnected) {
                resolve(true);
            } else if (connectionError) {
                resolve(false);
            } else {
                setTimeout(checkConnection, 500); // Tenta novamente
            }
        };
        setTimeout(checkConnection, 500); // Inicia a verificação
    });
}, [isConnected, connectionError]);

  const clearActiveContracts = () => {
    setOperationsLog([]);
    setTradeAnnotations([]);
  };

  const contextValue: DerivApiContextType = {
    ws: wsRef.current,
    isConnected,
    isConnecting,
    connectionError,
    demoToken,
    realToken,
    activeToken,
    accountType,
    setAccountType,
    setTokens,
    disconnect,
    reconnect,
    accountBalance,
    operationsLog,
    assetGroups,
    isAssetsLoading,
    activeSymbol,
    setActiveSymbol,
    chartData,
    priceTicks,
    isChartLoading,
    chartError,
    chartType,
    setChartType,
    timePeriod,
    setTimePeriod,
    dataVersion,
    executeTrade,
    sellContract,
    getHistoricalData,
    clearActiveContracts,
    tradeAnnotations,
    durationLimits
  };

  return (
    <DerivApiContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiContext.Provider>
  );
}

export function useDerivApi() {
  const context = useContext(DerivApiContext);
  if (context === undefined) {
    throw new Error('useDerivApi must be used within a DerivApiProvider');
  }
  return context;
}
