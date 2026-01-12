// src/features/trading/hooks/use-deriv-api-v1.tsx
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
};

interface DerivApiContextTypeV1 {
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

const DerivApiContextV1 = createContext<DerivApiContextTypeV1 | undefined>(undefined);

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
        
        const specificLimits = JSON.parse(JSON.stringify(defaultLimits));
        specificLimits[unit].min = value;
    
        return specificLimits;
    } catch {
        return defaultLimits;
    }
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


export const DerivApiProviderV1 = ({ children }: { children: ReactNode }) => {
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [realToken, setRealToken] = useState<string | null>(null);
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const { toast } = useToast();

  const [activeSymbol, setActiveSymbol] = useState<string | null>('1HZ10V');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]);
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('5m');
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const promisesRef = useRef<Map<string, PromiseCallbacks>>(new Map());
  const [triggerReconnect, setTriggerReconnect] = useState(0);

  useEffect(() => {
    try {
      const storedDemoToken = localStorage.getItem(DERIV_DEMO_TOKEN_KEY);
      const storedRealToken = localStorage.getItem(DERIV_REAL_TOKEN_KEY);
      const storedAccountType = localStorage.getItem(DERIV_ACCOUNT_TYPE_KEY) as AccountType | null;

      if (storedDemoToken) setDemoToken(storedDemoToken);
      else setDemoToken("ljUGk6wbLSrtEDo"); // Default Demo Key

      if (storedRealToken) setRealToken(storedRealToken);
      else setRealToken("GU5MwbX1kwvSoyw"); // Default Real Key
      
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
        
        const originalResolve = resolve;
        const originalReject = reject;
        
        promisesRef.current.set(String(req_id), {
            resolve: (value: any) => {
                clearTimeout(timeoutId);
                originalResolve(value);
            },
            reject: (reason: any) => {
                clearTimeout(timeoutId);
                originalReject(reason);
            }
        });

        ws.send(JSON.stringify(payload));
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


const subscribeToMarketData = useCallback(async (symbol: string) => {
    if (activeSubscriptionIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        try { 
            await makeRequest({ forget: activeSubscriptionIdRef.current }); 
        } catch (e) { 
            console.log('[Market Data] Previous subscription cancelled'); 
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
        setChartData(history as ChartData[]);
        if (historyStyle === 'ticks') {
            setPriceTicks(history as TickData[]);
        }

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
        
        const subResponse: any = await makeRequest(subRequest);
        
        if (subResponse.subscription?.id) {
            activeSubscriptionIdRef.current = subResponse.subscription.id;
            console.log(`[Market Data] Subscribed to ${symbol} (${chartType}) - ID: ${subResponse.subscription.id}`);
        }

    } catch (error: any) {
        console.error(`[Market Data] Error for ${symbol}:`, error);
        setChartError(error.message || 'Falha ao carregar dados do mercado.');
    } finally {
        setIsChartLoading(false);
    }
}, [getHistoricalData, makeRequest, chartType, timePeriod]);


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

          try {
            const proposalResponse: any = await makeRequest({ 
                "proposal": 1,
                "amount": stake,
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

            const isSellable = durationUnit === 's';

            const newOperation: Operation = {
                id: buyResult.contract_id,
                asset: symbol,
                direction: tradeDirection,
                stake: stake,
                status: 'pending',
                timestamp: new Date().toISOString(),
                duration: duration,
                durationUnit: durationUnit,
                initiator,
                entryPrice: entryPrice,
                isSellable,
            };
            setOperationsLog(prevLog => [newOperation, ...prevLog]);

            const entryTime = buyResult.purchase_time;
            
            addTradeAnnotation({
                contractId: String(buyResult.contract_id),
                entryTime: entryTime,
                entryPrice,
                direction: tradeDirection,
                status: 'pending',
                stake,
                symbol,
            });

            return {
              success: true,
              message: `Ordem do tipo "${contractType}" para ${symbol} no valor de ${stake} USD executada com sucesso.`,
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

    try {
        const sellResponse: any = await makeRequest({ 
            "sell": contractId,
            "price": 0, // Vende pelo preço atual de mercado
        });

        const sellResult = sellResponse.sell;
        if (sellResult) {
            // A atualização do contrato virá da subscrição 'proposal_open_contract'
            return { success: true, message: `Ordem de venda para o contrato ${contractId} enviada.` };
        } else {
            throw new Error("A resposta da API não continha os dados de venda esperados.");
        }
    } catch (error) {
        console.error("[Deriv Hook] Erro ao vender o contrato:", error);
        const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu ao vender o contrato.";
        return { success: false, message };
    }
  }, [isConnected, makeRequest]);


  useEffect(() => {
    if (!activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
      return;
    }

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

            if (response.error && response.error.message) {
                if (response.error.code !== 'AlreadySubscribed') {
                  console.error(`[Deriv WS] Error:`, response.error.message);
                }
            }
            
            const reqId = response.req_id;
            if (reqId && promisesRef.current.has(String(reqId))) {
                const promise = promisesRef.current.get(String(reqId));
                promisesRef.current.delete(String(reqId));
                if (response.error) {
                    const errorMessage = response.error.message || `Unknown API error. Code: ${response.error.code || 'N/A'}`;
                    const errorDetails = JSON.stringify(response.error);
                    promise?.reject(new Error(`${errorMessage} | Details: ${errorDetails}`));
                } else {
                    promise?.resolve(response);
                }
                return;
            }

            switch (response.msg_type) {
                case 'balance':
                    setAccountBalance({ balance: response.balance.balance, currency: response.balance.currency, loading: false });
                    break;
                case 'proposal_open_contract':
                    const contract = response.proposal_open_contract;
                    if (!contract || !contract.is_sold) return;

                    const profit = parseFloat(contract.profit);
                    const isLoss = profit < 0;

                    toast({
                        title: "Negociação Encerrada",
                        description: `Contrato ${contract.contract_id}: ${profit >= 0 ? `Lucro de ${contract.currency} ${profit.toFixed(2)}` : `Prejuízo de ${contract.currency} ${Math.abs(profit).toFixed(2)}`}`,
                        variant: isLoss ? "destructive" : "default",
                    });

                    setOperationsLog(prevLog => prevLog.map(op =>
                        op.id === contract.contract_id 
                        ? { ...op, status: profit >= 0 ? 'won' : 'lost', result: profit, exitPrice: parseFloat(contract.exit_tick_display_value) } 
                        : op
                    ));

                    updateTradeAnnotation(String(contract.contract_id), {
                        exitTime: contract.sell_time || Math.floor(Date.now() / 1000),
                        exitPrice: parseFloat(contract.exit_tick_display_value),
                        status: profit >= 0 ? 'won' : 'lost',
                        profit,
                    });
                    
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({"balance": 1, "req_id": Date.now()}));
                    }
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
                    }
                    break;
                
                case 'ohlc':
                    if (chartType === 'Candle' && response.ohlc?.symbol === activeSymbol) {
                        const ohlc = response.ohlc;
                        const newCandle: CandleData = {
                            epoch: ohlc.open_time,
                            open: parseFloat(ohlc.open),
                            high: parseFloat(ohlc.high),
                            low: parseFloat(ohlc.low),
                            close: parseFloat(ohlc.close),
                        };
                        setChartData(prev => addDataPoint(prev, newCandle));
                    }
                    break;
                
                case 'candles':
                    if (chartType === 'Candle' && response.candles?.length > 0) {
                        const candle = response.candles[0];
                        if (candle && (!activeSymbol || response.echo_req?.ticks_history === activeSymbol)) {
                            const newCandle: CandleData = {
                                epoch: candle.epoch,
                                open: parseFloat(candle.open),
                                high: parseFloat(candle.high),
                                low: parseFloat(candle.low),
                                close: parseFloat(candle.close),
                            };
                            setChartData(prev => addDataPoint(prev, newCandle));
                        }
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
            if (ws.readyState === WebSocket.OPEN) ws.close();
        }
    };
  
    ws.onclose = (event) => {
      const { wasClean, code, reason } = event;
      if (!wasClean) {
        setConnectionError(`A conexão foi fechada: Código ${code} (${reason || 'Fecho Anormal'}).`);
      }
      setIsConnected(false);
      setIsConnecting(false);
      wsRef.current = null;
    };
  
    ws.onerror = (error) => {
      console.error('[Deriv WS] WebSocket error:', error);
      setConnectionError("Falha na conexão com a API da Deriv. Verifique o seu token e a ligação à internet.");
      setIsConnecting(false);
      setIsConnected(false);
    };
  
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [activeToken, isLoading, makeRequest, toast, triggerReconnect]);

  
  useEffect(() => {
    if (isConnected && activeSymbol) {
        subscribeToMarketData(activeSymbol);
    }
    return () => {
        if (activeSubscriptionIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
            try {
                wsRef.current.send(JSON.stringify({ forget: activeSubscriptionIdRef.current }));
            } catch (e) {
                console.warn('[Deriv WS] Could not unsubscribe on cleanup:', e);
            }
            activeSubscriptionIdRef.current = null;
        }
    };
  }, [isConnected, chartType, timePeriod, activeSymbol, subscribeToMarketData]);

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
    setTriggerReconnect(c => c + 1);
    // Espera um tempo para que o useEffect de conexão seja acionado e resolva
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(wsRef.current?.readyState === WebSocket.OPEN && isConnected);
        }, 3000);
    });
  }, [isConnected]);

  const clearActiveContracts = () => {
    setOperationsLog([]);
    setTradeAnnotations([]);
  };

  const contextValue: DerivApiContextTypeV1 = {
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
    executeTrade,
    sellContract,
    clearActiveContracts,
    tradeAnnotations,
    durationLimits
  };

  return (
    <DerivApiContextV1.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiContextV1.Provider>
  );
}

export function useDerivApiV1() {
  const context = useContext(DerivApiContextV1);
  if (context === undefined) {
    throw new Error('useDerivApiV1 must be used within a DerivApiProviderV1');
  }
  return context;
}
