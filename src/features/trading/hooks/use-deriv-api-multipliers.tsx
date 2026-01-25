
// /src/features/trading/hooks/use-deriv-api-multipliers.tsx
'use client';

// ESTE ARQUIVO É UMA CÓPIA DEDICADA PARA O SISTEMA DE MULTIPLIERS

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef } from 'react';
import type { TradeResult } from '@/services/deriv-api-service';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';


const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_MULTIPLIERS_LOG_KEY = 'derivMultipliersOperationsLog_v3'; // Chave para persistência
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
    multiplier: number,
    takeProfit?: number,
    stopLoss?: number,
    cancellation?: string,
    initiator?: OperationInitiator,
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  updateContract: (contractId: number, takeProfit?: number, stopLoss?: number) => Promise<TradeResult>;
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<ApiHistoricalData[]>;
  clearActiveContracts: () => void;
  tradeAnnotations: TradeAnnotation[];
  durationLimits: DurationLimits | null;
  multiplierOptions: number[];
}

const DerivApiMultipliersContext = createContext<DerivApiContextType | undefined>(undefined);

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
    // Apenas substitui o último ponto se for uma VELA com a mesma época.
    // Para ticks, sempre adiciona.
    if (data.length > 0 && isCandle(newPoint) && data[data.length - 1].epoch === newPoint.epoch) {
        data[data.length - 1] = newPoint;
        return data;
    }
    data.push(newPoint);
    if (data.length > MAX_DATA_POINTS) {
        return data.slice(data.length - MAX_DATA_POINTS);
    }
    return data;
};

export const DerivApiProviderMultipliers = ({ children }: { children: ReactNode }) => {
  const [demoToken, setDemoToken] = useState<string | null>('ljUGk6wbLSrtEDo');
  const [realToken, setRealToken] = useState<string | null>('GU5MwbX1kwvSoyw');
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const operationsLogRef = useRef(operationsLog);
  const sellingContractsRef = useRef<Set<number>>(new Set());
  const trailingStateRef = useRef<Map<number, { highestProfit: number }>>(new Map());
  useEffect(() => {
      operationsLogRef.current = operationsLog;
  }, [operationsLog]);
  
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const { toast } = useToast();
  const [toastQueue, setToastQueue] = useState<any[]>([]);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);

  const [activeSymbol, setActiveSymbol] = useState<string | null>('R_75');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [botCandleData, setBotCandleData] = useState<CandleData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]); 
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const chartTypeRef = useRef(chartType);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('5m');
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const botSubscriptionIdRef = useRef<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0); 
  const [durationLimits, setDurationLimits] = useState<DurationLimits | null>(null);
  const [multiplierOptions, setMultiplierOptions] = useState<number[]>([50, 100, 200, 500]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const promisesRef = useRef<Map<string, PromiseCallbacks>>(new Map());
  const [triggerReconnect, setTriggerReconnect] = useState(0);
  const [lastPingTime, setLastPingTime] = useState<number>(Date.now());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
    const setAndPersistOperationsLog = useCallback((updater: React.SetStateAction<Operation[]>) => {
        setOperationsLog(prevLog => {
            const newLogWithPotentialDuplicates = typeof updater === 'function' ? updater(prevLog) : updater;
            
            const uniqueOpsMap = new Map<number, Operation>();
            for(const op of newLogWithPotentialDuplicates) {
                if(op && op.id) { // GARANTIA DE INTEGRIDADE
                    uniqueOpsMap.set(op.id, op);
                }
            }
            const newLog = Array.from(uniqueOpsMap.values());
            
            try {
                localStorage.setItem(DERIV_MULTIPLIERS_LOG_KEY, JSON.stringify(newLog));
            } catch (error) {
                console.error("Failed to save operations log to localStorage:", error);
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

  useEffect(() => {
    chartTypeRef.current = chartType;
  }, [chartType]);

  useEffect(() => {
    try {
      const storedDemoToken = localStorage.getItem(DERIV_DEMO_TOKEN_KEY);
      const storedRealToken = localStorage.getItem(DERIV_REAL_TOKEN_KEY);
      const storedAccountType = localStorage.getItem(DERIV_ACCOUNT_TYPE_KEY) as AccountType | null;
      const storedLog = localStorage.getItem(DERIV_MULTIPLIERS_LOG_KEY);

      if (storedDemoToken) setDemoToken(storedDemoToken);
      if (storedRealToken) setRealToken(storedRealToken);
      if (storedAccountType) setAccountTypeState(storedAccountType);
      if (storedLog) {
        const parsedLog = JSON.parse(storedLog);
        if(Array.isArray(parsedLog)) {
             setOperationsLog(parsedLog.filter(op => op && op.id)); // Filtra entradas inválidas
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
                    reject(new Error(`O pedido à API expirou (60s).`));
                }
            }, 60000);
            
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
        
        try {
            ws.send(JSON.stringify(payload));
        } catch (sendError) {
            console.error('[makeRequest] Send failed:', sendError);
            if (!noResponse && promisesRef.current.has(String(req_id))) {
                promisesRef.current.delete(String(req_id));
                reject(sendError);
            }
        }
        
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

  const updateContract = useCallback(async (
    contractId: number,
    takeProfit?: number,
    stopLoss?: number
  ): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) {
        return { success: false, message: "A conexão com a API da Deriv não está ativa." };
    }

    try {
        if (takeProfit === undefined && stopLoss === undefined) {
            return { success: true, message: "Nenhuma alteração nos limites de risco." };
        }

        const updateRequest: any = {
            contract_update: contractId,
            limit_order: {}
        };
        
        if (takeProfit !== undefined) {
            updateRequest.limit_order.take_profit = parseFloat(takeProfit.toFixed(2));
        }
        
        if (stopLoss !== undefined) {
            updateRequest.limit_order.stop_loss = parseFloat(stopLoss.toFixed(2));
        }

        const response: any = await makeRequest(updateRequest);
        
        if (response.error) {
             throw new Error(response.error.message);
        }

        const updateResult = response.contract_update;

        if (updateResult) {
            setAndPersistOperationsLog(prevLog => {
                return prevLog.map(op => {
                    if (op.id === contractId) {
                        return {
                            ...op,
                            takeProfit: updateResult.limit_order?.take_profit?.order_amount,
                            stopLoss: updateResult.limit_order?.stop_loss?.order_amount,
                        };
                    }
                    return op;
                });
            });
            
            return { 
                success: true, 
                message: `Limites de risco atualizados para o contrato #${contractId}.` 
            };
        } else {
            throw new Error("A resposta da API não continha os dados de atualização esperados.");
        }

    } catch (error) {
        console.error(`[Deriv Hook] Erro ao atualizar contrato #${contractId}:`, error);
        const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
        return { success: false, message };
    }
  }, [isConnected, makeRequest, setAndPersistOperationsLog]);
  
  const executeTrade = useCallback(async (
    contractType: string,
    stake: number,
    symbol: string,
    multiplier: number,
    takeProfit?: number,
    stopLoss?: number,
    cancellation?: string,
    initiator: OperationInitiator = 'Manual'
  ): Promise<TradeResult> => {
    try {
      if (!wsRef.current || !isConnected) {
        throw new Error("A conexão com a API da Deriv não está ativa.");
      }

      const sanitizedStake = parseFloat(stake.toFixed(2));

      const buyRequest: any = {
        buy: "1",
        price: sanitizedStake,
        parameters: {
            amount: sanitizedStake,
            basis: "stake",
            contract_type: contractType,
            currency: "USD",
            symbol: symbol,
            multiplier: multiplier,
        }
      };
      
      if (cancellation && cancellation !== 'none') {
        buyRequest.parameters.cancellation = cancellation;
      }
      
      const buyResponse: any = await makeRequest(buyRequest);
      
      if (buyResponse.error) {
          throw new Error(buyResponse.error.message);
      }

      const buyResult = buyResponse.buy;
      const contractId = buyResult.contract_id;

      if (!contractId) {
        throw new Error("Falha na compra do contrato, ID não retornado.");
      }
      
      if (takeProfit || stopLoss) {
        setTimeout(async () => {
          try {
            await updateContract(contractId, takeProfit, stopLoss);
          } catch (error) {
            console.warn('Falha ao definir limites de risco automaticamente:', error);
            setToastQueue(prev => [...prev, {
              title: 'Aviso de Risco',
              description: `Posição #${contractId} aberta, mas os limites de risco não foram aplicados. Defina-os manualmente.`,
              variant: 'default',
            }]);
          }
        }, 500);
      }
      
      const latestTick = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1].price : 0;
      const entryPrice = buyResult.entry_tick_display_value 
        ? parseFloat(buyResult.entry_tick_display_value) 
        : (buyResult.entry_spot_display_value ? parseFloat(buyResult.entry_spot_display_value) : latestTick);

      const purchaseTime = buyResult.purchase_time || Math.floor(Date.now() / 1000);
      const purchaseTimeMs = purchaseTime * 1000;

      const newOperation: Operation = {
          id: contractId,
          asset: symbol,
          direction: contractType === 'MULTUP' ? 'rise' : 'fall',
          stake: sanitizedStake,
          status: 'pending',
          timestamp: new Date(purchaseTimeMs).toISOString(),
          initiator,
          entryPrice: entryPrice,
          isSellable: true,
          contractType,
          multiplier,
          duration: 0, 
          durationUnit: 's', 
          takeProfit: takeProfit,
          stopLoss: stopLoss,
      };
      setAndPersistOperationsLog(prevLog => [newOperation, ...prevLog]);

      addTradeAnnotation({
          contractId: String(contractId),
          entryTime: purchaseTime,
          entryPrice: entryPrice,
          direction: contractType === 'MULTUP' ? 'rise' : 'fall',
          status: 'pending',
          stake: sanitizedStake,
          symbol,
          expirationTime: undefined,
          contractType: 'multiplier'
      });

      return {
        success: true,
        message: `Ordem executada para ${symbol}.`,
        contractId: contractId,
        entryPrice,
      };
    } catch (error) {
       console.error("[Deriv Hook] Erro durante a negociação de Multiplicadores:", error);
       const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
       return { success: false, message };
    }
  }, [isConnected, makeRequest, priceTicks, addTradeAnnotation, setAndPersistOperationsLog, updateContract, setToastQueue]);

  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) {
        return { success: false, message: "A conexão com a API da Deriv não está ativa." };
    }
    
    if (sellingContractsRef.current.has(contractId)) {
        return { success: false, message: `A venda do contrato #${contractId} já está em andamento.` };
    }

    try {
        sellingContractsRef.current.add(contractId);
        const sellResponse: any = await makeRequest({ "sell": contractId, "price": 0 });

        if (sellResponse.error) {
            throw new Error(sellResponse.error.message);
        }

        const sellResult = sellResponse.sell;
        if (sellResult) {
            return { success: true, message: `Ordem de venda para o contrato ${contractId} enviada.` };
        } else {
            sellingContractsRef.current.delete(contractId);
            throw new Error("A resposta da API não continha os dados de venda esperados.");
        }
    } catch (error) {
        console.error("[Deriv Hook] Erro ao vender o contrato de multiplicador:", error);
        sellingContractsRef.current.delete(contractId);
        const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu ao vender o contrato.";
        return { success: false, message };
    }
  }, [isConnected, makeRequest]);
  
  const subscribeToMarketData = useCallback(async (symbol: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    if (activeSubscriptionIdRef.current) {
        try { 
            await makeRequest({ forget: activeSubscriptionIdRef.current }, true); 
        } catch (e) { 
            console.log('[Market Data] Previous UI subscription cancelled'); 
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
        setDataVersion(v => v + 1);

        let subRequest: any;
        if (chartType === 'Candle') {
            subRequest = { ticks_history: symbol, style: 'candles', granularity: getGranularityForTimePeriod(timePeriod), subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 };
        } else {
            subRequest = { ticks: symbol, subscribe: 1 };
        }
        const subResponse: any = await makeRequest(subRequest);
        if (subResponse.subscription?.id) {
            activeSubscriptionIdRef.current = subResponse.subscription.id;
        }
    } catch (error: any) {
        setChartError(error.message || 'Falha ao carregar dados do mercado.');
    } finally {
        setIsChartLoading(false);
    }
  }, [getHistoricalData, makeRequest, chartType, timePeriod]);

  const subscribeToBotData = useCallback(async (symbol: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    if (botSubscriptionIdRef.current) {
        try {
            await makeRequest({ forget: botSubscriptionIdRef.current }, true);
        } catch (e) {
            console.log('[Bot Data] Previous bot subscription cancelled');
        }
        botSubscriptionIdRef.current = null;
    }

    setBotCandleData([]); 

    try {
        const history = await getHistoricalData(symbol, 'candles', 1000, '1m') as CandleData[];
        setBotCandleData(history);
        
        const subRequest = { 
            ticks_history: symbol, 
            style: 'candles', 
            granularity: 60,
            subscribe: 1, 
            end: "latest", 
            count: 1, 
            adjust_start_time: 1 
        };
        const subResponse: any = await makeRequest(subRequest);
        if (subResponse.subscription?.id) {
            botSubscriptionIdRef.current = subResponse.subscription.id;
        }
    } catch (error: any) {
        console.error(`[Bot Data] Error for ${symbol}:`, error);
    }
  }, [getHistoricalData, makeRequest]);

  const startConnectionMonitor = useCallback(() => {
  if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
  }
  
  pingIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
          try {
              wsRef.current.send(JSON.stringify({ ping: 1 }));
              setLastPingTime(Date.now());
          } catch (error) {
              console.warn('[Ping] Failed:', error);
          }
      }
  }, 30000);
}, []);
  
  const renewSubscriptions = useCallback(async () => {
  if (!isConnected || !activeSymbol) return;
  
  console.log('[Subscriptions] Renewing...');
  
  try {
      await Promise.all([
          subscribeToMarketData(activeSymbol),
          subscribeToBotData(activeSymbol)
      ]);
      console.log('[Subscriptions] Renewed successfully');
  } catch (error) {
      console.error('[Subscriptions] Renewal failed:', error);
  }
}, [isConnected, activeSymbol, subscribeToMarketData, subscribeToBotData]);


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
        
        setLastPingTime(Date.now());
        
        if (response.msg_type === 'ping' || response.pong) {
            return;
        }
        
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
             if (response.error.code !== 'AlreadySubscribed' && 
                 response.error.code !== 'SellNotAvailable' && 
                 response.error.code !== 'ContractSellNotAvailable') {
              console.error(`[Deriv WS] Error:`, response.error.message);
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
                if (!contract || !(contract.contract_type || '').startsWith('MULT')) {
                    return;
                }

                setAndPersistOperationsLog(prevLog => {
                    const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                    const isSold = contract.is_sold === 1;
                    
                    if (existingOpIndex !== -1) {
                        const updatedLog = [...prevLog];
                        const op = updatedLog[existingOpIndex];
                        
                        const updatedOp: Operation = {
                            ...op,
                            result: contract.profit,
                            takeProfit: contract.limit_order?.take_profit?.order_amount || op.takeProfit,
                            stopLoss: contract.limit_order?.stop_loss?.order_amount || op.stopLoss,
                            trailingStop: op.trailingStop,
                        };

                        if (!isSold && op.initiator === 'Piloto' && contract.profit > 0) {
                            const trailingState = trailingStateRef.current.get(op.id) || { highestProfit: 0 };
                            const activationThreshold = op.stake * 0.15; 
                            const trailingDistance = op.stake * 0.10;   

                            if (contract.profit > trailingState.highestProfit) {
                                trailingState.highestProfit = contract.profit;
                                trailingStateRef.current.set(op.id, trailingState);
                            }

                            if (trailingState.highestProfit > activationThreshold) {
                                const rawNewStop = trailingState.highestProfit - trailingDistance;
                                const newStopLoss = parseFloat(rawNewStop.toFixed(2));
                                updatedOp.trailingStop = newStopLoss;

                                if (newStopLoss > (op.stopLoss || 0)) {
                                    updateContract(op.id, undefined, newStopLoss);
                                }
                            }
                        }

                        if (isSold) {
                            sellingContractsRef.current.delete(contract.contract_id);
                            trailingStateRef.current.delete(contract.contract_id);

                            const newStatus = contract.profit >= 0 ? 'won' : 'lost';
                            const exitPrice = contract.exit_tick_display_value 
                                ? parseFloat(contract.exit_tick_display_value) 
                                : contract.sell_spot 
                                ? parseFloat(contract.sell_spot) 
                                : op.exitPrice;
                            const sellTime = contract.sell_time 
                                ? new Date(contract.sell_time * 1000).toISOString() 
                                : new Date().toISOString();
                            
                            updatedOp.status = newStatus;
                            updatedOp.exitPrice = exitPrice;
                            updatedOp.exitTimestamp = sellTime;

                            updateTradeAnnotation(String(contract.contract_id), { 
                                status: newStatus, 
                                profit: contract.profit, 
                                exitPrice, 
                                exitTime: contract.sell_time 
                            });
                            
                            setToastQueue(prev => [...prev, {
                                title: `Posição Fechada (${op.asset})`,
                                description: `Resultado: ${contract.currency} ${contract.profit.toFixed(2)}`,
                                variant: newStatus === 'won' ? 'default' : 'destructive',
                            }]);

                            if (wsRef.current?.readyState === WebSocket.OPEN) {
                                wsRef.current.send(JSON.stringify({"balance": 1}));
                            }
                        }
                        
                        updatedLog[existingOpIndex] = updatedOp;
                        return updatedLog;
                    } else if (!isSold) {
                        const direction = (contract.contract_type || '').includes('MULTUP') ? 'rise' : 'fall';
                        const purchaseTime = contract.purchase_time || Math.floor(Date.now() / 1000);

                        const newOperation: Operation = {
                            id: contract.contract_id,
                            asset: contract.symbol || 'Símbolo desconhecido',
                            direction: direction,
                            stake: contract.buy_price || 0,
                            status: 'pending',
                            result: contract.profit,
                            timestamp: new Date(purchaseTime * 1000).toISOString(),
                            initiator: 'Manual',
                            entryPrice: parseFloat(contract.entry_spot_display_value || contract.entry_tick_display_value || '0'),
                            isSellable: contract.is_sellable === 1,
                            expirationTime: contract.date_expiry ? contract.date_expiry * 1000 : undefined,
                            duration: contract.date_expiry ? (contract.date_expiry - purchaseTime) : 0,
                            durationUnit: 's',
                            multiplier: contract.multiplier,
                            contractType: contract.contract_type,
                            takeProfit: contract.limit_order?.take_profit?.order_amount,
                            stopLoss: contract.limit_order?.stop_loss?.order_amount
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
                            contractType: 'multiplier'
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
                            return newTicks.slice(newTicks.length - MAX_DATA_POINTS);
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
        await makeRequest({ authorize: activeToken });
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionError(null);
        setLastPingTime(Date.now());
        
        ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
        ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
        
        startConnectionMonitor();
        
        const assetsRes: any = await makeRequest({ active_symbols: 'full', product_type: 'basic' });
        
        const filteredSymbols = assetsRes.active_symbols.filter((symbol: any) => 
            symbol.market === 'synthetic_index' || symbol.market === 'forex'
        );

        const groupedAssets: { [key: string]: Asset[] } = {};
        filteredSymbols.forEach((symbol: any) => {
            const marketKey = (symbol.market === 'synthetic_index' && symbol.submarket === 'basket_index') 
                ? 'basket_index' 
                : symbol.market;
            const groupName = marketNameMapping[marketKey] || 'Outros';
            if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
            groupedAssets[groupName].push({
                value: symbol.symbol,
                label: symbol.display_name,
                marketIsOpen: symbol.exchange_is_open === 1,
                submarket: symbol.submarket,
                market: marketKey,
                minDuration: 'N/A', 
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
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        setConnectionError(`Falha na autorização: ${errorMessage}`);
        setIsConnected(false);
        setIsConnecting(false);
        setIsAssetsLoading(false);
        if (ws.readyState === WebSocket.OPEN) ws.close();
    }
};
      
        ws.onclose = (event) => {
  if (!wsRef.current) return;
  
  if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
  }
  
  promisesRef.current.forEach((p) => {
    if (p && typeof p.reject === 'function') {
      p.reject(new Error("WebSocket fechado"))
    }
  });
  promisesRef.current.clear();

  if (!event.wasClean) {
    console.warn(`[WS] Fechado inesperadamente. Código: ${event.code}`);
    setConnectionError(`Conexão perdida. Reconectando...`);
    
    if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectTimeoutRef.current = setTimeout(() => {
        console.log('[Auto-Reconnect] Tentando reconectar...');
        setTriggerReconnect(c => c + 1);
    }, 3000);
  }
  
  setIsConnected(false);
  setIsConnecting(false);
  setAccountBalance({ balance: null, currency: null, loading: false });
  wsRef.current = null;
};
      
        ws.onerror = () => {
          // Silencioso - onclose tratará o erro
        };
    };

    connect();
  
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
      }
      if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [activeToken, isLoading, makeRequest, toast, triggerReconnect, updateTradeAnnotation, addTradeAnnotation, setAndPersistOperationsLog, setToastQueue, updateContract, startConnectionMonitor]);

  
  useEffect(() => {
  if (isConnected && !isConnecting) {
      const checkInterval = setInterval(() => {
          const timeSinceLastPing = Date.now() - lastPingTime;
          if (timeSinceLastPing > 45000 && wsRef.current?.readyState === WebSocket.OPEN) {
              console.warn('[Health Check] Sem resposta há 45s, reconectando...');
              setTriggerReconnect(c => c + 1);
          }
      }, 10000);
      
      return () => clearInterval(checkInterval);
  }
}, [isConnected, isConnecting, lastPingTime]);

  useEffect(() => {
  if (isConnected && activeSymbol && !isConnecting) {
      const timer = setTimeout(() => {
          renewSubscriptions();
      }, 1000);
      
      return () => clearTimeout(timer);
  }
}, [isConnected, isConnecting, activeSymbol, renewSubscriptions]);


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
    
    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            resolve(false);
        }, 10000);

        const checkConnection = () => {
            if (wsRef.current?.readyState === WebSocket.OPEN && isConnected) {
                clearTimeout(timeout);
                resolve(true);
            } else if (connectionError) {
                clearTimeout(timeout);
                resolve(false);
            } else {
                setTimeout(checkConnection, 500); 
            }
        };
        setTimeout(checkConnection, 500); 
    });
  }, [isConnected, connectionError]);


  const clearActiveContracts = () => {
    setAndPersistOperationsLog([]);
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
    botCandleData,
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
    updateContract,
    clearActiveContracts,
    tradeAnnotations,
    durationLimits,
    multiplierOptions,
    getHistoricalData
  };

  return (
    <DerivApiMultipliersContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiMultipliersContext.Provider>
  );
}

export function useDerivApiMultipliers() {
  const context = useContext(DerivApiMultipliersContext);
  if (context === undefined) {
    throw new Error('useDerivApiMultipliers must be used within a DerivApiProviderMultipliers');
  }
  return context;
}

    