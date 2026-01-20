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

  const [activeSymbol, setActiveSymbol] = useState<string | null>('1HZ75V');
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
                    reject(new Error(`O pedido à API expirou (req_id: ${req_id}). O token pode ser inválido ou a rede está lenta.`));
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
              }));
          }
        
          if (response.candles) {
              return response.candles.map((candle: any) => ({
                  epoch: candle.epoch,
                  open: candle.open,
                  high: candle.high,
                  low: candle.low,
                  close: candle.close,
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
        price: 10000,
        parameters: {
            amount: sanitizedStake,
            basis: "stake",
            contract_type: contractType,
            currency: "USD",
            symbol: symbol,
            multiplier: multiplier,
        }
      };

      if (takeProfit !== undefined) buyRequest.parameters.take_profit = takeProfit;
      if (stopLoss !== undefined) buyRequest.parameters.stop_loss = stopLoss;
      if (cancellation && cancellation !== 'none') buyRequest.parameters.cancellation = cancellation;
      
      const buyResponse: any = await makeRequest(buyRequest);
      const buyResult = buyResponse.buy;
      const contractId = buyResult.contract_id;

      if (!contractId) {
        throw new Error("Falha na compra do contrato, ID não retornado.");
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
        message: `Ordem do tipo "${contractType}" para ${symbol} no valor de ${sanitizedStake} USD executada com sucesso.`,
        contractId: contractId,
        entryPrice,
      };
    } catch (error) {
       console.error("[Deriv Hook] Erro durante a negociação de Multiplicadores:", error);
       const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
       return { success: false, message };
    }
  }, [isConnected, makeRequest, priceTicks, addTradeAnnotation, setAndPersistOperationsLog]);


  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) {
        return { success: false, message: "A conexão com a API da Deriv não está ativa." };
    }
    
    if (sellingContractsRef.current.has(contractId)) {
        return { success: false, message: `A venda do contrato #${contractId} já está em andamento.` };
    }

    try {
        sellingContractsRef.current.add(contractId);
        const sellResponse: any = await makeRequest({ 
            "sell": contractId,
            "price": 0,
        });

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
  
  const updateContract = useCallback(async (
    contractId: number,
    takeProfit?: number,
    stopLoss?: number
): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) {
        return { success: false, message: "A conexão com a API da Deriv não está ativa." };
    }

    try {
        const updateRequest: any = { contract_update: contractId };
        let hasUpdate = false;

        // A API da Deriv espera 'null' para remover um limite. 'undefined' não funciona.
        updateRequest.take_profit = takeProfit !== undefined && takeProfit > 0 ? takeProfit : null;
        updateRequest.stop_loss = stopLoss !== undefined && stopLoss > 0 ? stopLoss : null;
        
        // O pedido só é válido se pelo menos um dos valores for alterado (incluindo para null)
        const originalContract = operationsLogRef.current.find(op => op.id === contractId);
        if (!originalContract) return { success: false, message: "Contrato não encontrado no log." };
        
        if (updateRequest.take_profit !== originalContract.takeProfit || updateRequest.stop_loss !== originalContract.stopLoss) {
             hasUpdate = true;
        }

        if (!hasUpdate) {
            return { success: true, message: "Nenhuma alteração nos limites de risco foi feita." };
        }

        const response: any = await makeRequest(updateRequest);
        const updateResult = response.contract_update;

        if (updateResult) {
             setAndPersistOperationsLog(prevLog => {
                const newLog = prevLog.map(op => {
                    if (op.id === contractId) {
                        return {
                            ...op,
                            takeProfit: updateResult.take_profit?.order_amount,
                            stopLoss: updateResult.stop_loss?.order_amount,
                        };
                    }
                    return op;
                });
                return newLog;
            });
            return { success: true, message: `Contrato #${contractId} atualizado com sucesso.` };
        } else {
            throw new Error("A resposta da API não continha os dados de atualização esperados.");
        }

    } catch (error) {
        console.error("[Deriv Hook] Erro ao atualizar contrato:", error);
        const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
        return { success: false, message };
    }
}, [isConnected, makeRequest, setAndPersistOperationsLog]);
  
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

  // Specific data subscription for the bot (1-minute candles)
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

    setBotCandleData([]); // Reset bot data

    try {
        const history = await getHistoricalData(symbol, 'candles', 1000, '1m') as CandleData[];
        setBotCandleData(history);
        
        const subRequest = { 
            ticks_history: symbol, 
            style: 'candles', 
            granularity: 60, // 1 minute
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


  useEffect(() => {
    if (!activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
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
                     if (response.error.code !== 'AlreadySubscribed' && response.error.code !== 'SellNotAvailable' && response.error.code !== 'ContractSellNotAvailable') {
                      console.error(`[Deriv WS] Error:`, response.error.message);
                    }
                     return;
                }
    
                switch (response.msg_type) {
                    case 'balance':
                        setAccountBalance({ balance: response.balance.balance, currency: response.balance.currency, loading: false });
                        break;
                    case 'proposal_open_contract':
                        const contract = response.proposal_open_contract;
                        if (!contract) return;
                        
                        if (!(contract.contract_type || '').startsWith('MULT')) {
                            return;
                        }
    
                        setAndPersistOperationsLog(prevLog => {
                            const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                            const isSold = contract.is_sold === 1;
    
                            if (isSold) {
                                sellingContractsRef.current.delete(contract.contract_id);
                                trailingStateRef.current.delete(contract.contract_id);
                            }

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
                                        
                                        if(typeof updateTradeAnnotation === 'function') {
                                            updateTradeAnnotation(String(contract.contract_id), { status: newStatus, profit: contract.profit, exitPrice, exitTime: contract.sell_time });
                                        }
                                        
                                        const toastMessage = {
                                            title: `Posição Fechada (${op.asset})`,
                                            description: `Resultado: ${contract.currency} ${contract.profit.toFixed(2)}`,
                                            variant: newStatus === 'won' ? 'default' : 'destructive',
                                        };
                                        
                                        if (typeof setToastQueue === 'function') {
                                            setToastQueue(prev => [...prev, toastMessage]);
                                        } else if(typeof toast === 'function') {
                                            toast(toastMessage);
                                        }
    
                                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                                            wsRef.current.send(JSON.stringify({"balance": 1}));
                                        }
                                        return updatedLog;
                                    } else if ((op.contractType || '').startsWith('MULT') && contract.profit !== op.result) {
                                        updatedLog[existingOpIndex] = { ...op, result: contract.profit };
                                        return updatedLog;
                                    }
                                }
                                return prevLog;
    
                            } else if (!isSold) {
                                // ADD NEW EXTERNALLY OPENED OPERATION
                                const direction = (contract.contract_type || '').includes('MULTUP') ? 'rise' : 'fall';
                                const purchaseTime = contract.purchase_time || Math.floor(Date.now() / 1000);
                                const purchaseTimeMs = purchaseTime * 1000;
                                const durationInSeconds = contract.date_expiry ? (contract.date_expiry - purchaseTime) : 0;
                                const durationUnit: DurationUnit = 's'; // Safe default
    
                                const newOperation: Operation = {
                                    id: contract.contract_id,
                                    asset: contract.symbol || 'Símbolo desconhecido',
                                    direction: direction,
                                    stake: contract.buy_price || 0,
                                    status: 'pending',
                                    result: contract.profit,
                                    timestamp: new Date(purchaseTimeMs).toISOString(),
                                    initiator: 'Manual',
                                    entryPrice: parseFloat(contract.entry_spot_display_value || contract.entry_tick_display_value || '0'),
                                    isSellable: contract.is_sellable === 1,
                                    expirationTime: contract.date_expiry ? contract.date_expiry * 1000 : undefined,
                                    duration: durationInSeconds,
                                    durationUnit: durationUnit,
                                    multiplier: contract.multiplier,
                                    contractType: contract.contract_type,
                                    takeProfit: contract.take_profit?.order_amount,
                                    stopLoss: contract.stop_loss?.order_amount
                                };
                                
                                if(typeof addTradeAnnotation === 'function') {
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
                                }
    
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
                        
                        const isForUI = response.subscription?.id === activeSubscriptionIdRef.current;
                        const isForBot = response.subscription?.id === botSubscriptionIdRef.current;
    
                        if (candleData && candleData.symbol === activeSymbol) {
                            const newCandle: CandleData = {
                                epoch: candleData.open_time || candleData.epoch,
                                open: parseFloat(candleData.open),
                                high: parseFloat(candleData.high),
                                low: parseFloat(candleData.low),
                                close: parseFloat(candleData.close),
                            };
    
                            if (isForUI && chartTypeRef.current === 'Candle') {
                                setChartData(prev => addDataPoint(prev, newCandle));
                            }
                            if (isForBot) {
                                setBotCandleData(prev => addDataPoint(prev, newCandle) as CandleData[]);
                            }
                            
                            const newTickFromCandle: TickData = {
                                epoch: newCandle.epoch,
                                price: newCandle.close,
                            };
                            setPriceTicks(prev => {
                                const newTicks = [...prev, newTickFromCandle];
                                if (newTicks.length > MAX_DATA_POINTS) {
                                    return newTicks.slice(1);
                                }
                                return newTicks;
                            });
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
                
                const filteredSymbols = assetsRes.active_symbols.filter((symbol: any) => 
                    symbol.market === 'synthetic_index' || symbol.market === 'forex'
                );
    
                const groupedAssets: { [key: string]: Asset[] } = {};
                filteredSymbols.forEach((symbol: any) => {
                    const marketKey = (symbol.market === 'synthetic_index' && symbol.submarket === 'basket_index') ? 'basket_index' : symbol.market;
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
              promisesRef.current.forEach((p) => {
                if (p && typeof p.reject === 'function') {
                  p.reject(new Error("WebSocket connection closed."))
                }
              });
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
      
        ws.onerror = (error) => {
          console.error('[Deriv WS] WebSocket error:', error);
          if (promisesRef.current) {
              promisesRef.current.forEach((p) => {
                if (p && typeof p.reject === 'function') {
                  p.reject(new Error("WebSocket error occurred."))
                }
              });
              promisesRef.current.clear();
          }
          setConnectionError("Falha na conexão com a API da Deriv. Verifique o seu token e a ligação à internet.");
          setIsConnecting(false);
          setIsConnected(false);
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
  }, [activeToken, isLoading, makeRequest, toast, triggerReconnect, updateTradeAnnotation, addTradeAnnotation, setAndPersistOperationsLog]);

  
  useEffect(() => {
    if (isConnected && activeSymbol) {
      subscribeToMarketData(activeSymbol);
      subscribeToBotData(activeSymbol);
    }
  }, [isConnected, chartType, timePeriod, activeSymbol, subscribeToMarketData, subscribeToBotData]);

  // Client-side Trailing Stop and Take Profit/Stop Loss watcher
    useEffect(() => {
        if (!isConnecting && !isConnected && operationsLogRef.current.some(op => op.status === 'pending')) {
            return;
        }

        const trailingStopInterval = setInterval(() => {
            const openMultiplierOps = operationsLogRef.current.filter(
                op => op.status === 'pending' && op.contractType?.startsWith('MULT')
            );
            
            if (openMultiplierOps.length === 0) return;

            let logNeedsUpdate = false;
            const updatedOps = [...operationsLogRef.current];

            openMultiplierOps.forEach(op => {
                const currentProfit = op.result || 0;
                
                // --- Take Profit & Stop Loss (Client-Side Fallback) ---
                let shouldSell = false;
                let reason = '';

                if (op.takeProfit && currentProfit >= op.takeProfit) {
                    shouldSell = true;
                    reason = `🎯 Alvo de Lucro Atingido! (Cliente)`;
                } else if (op.stopLoss && currentProfit <= -(op.stopLoss)) {
                    shouldSell = true;
                    reason = `🛡️ Stop Loss Atingido! (Cliente)`;
                }
                
                // --- Trailing Stop Logic ---
                if (currentProfit > 0) { // Only trail when in profit
                    if (!trailingStateRef.current.has(op.id)) {
                        trailingStateRef.current.set(op.id, { highestProfit: 0 });
                    }
                    const state = trailingStateRef.current.get(op.id)!;
                    
                    if (currentProfit > state.highestProfit) {
                        state.highestProfit = currentProfit;
                        trailingStateRef.current.set(op.id, state);
                    }

                    const trailingDistance = op.stake * 0.5; // Trail by 50% of initial stake
                    const newTrailingStopLevel = state.highestProfit - trailingDistance;

                    const opIndex = updatedOps.findIndex(logOp => logOp.id === op.id);
                    if (opIndex !== -1 && newTrailingStopLevel > (updatedOps[opIndex].trailingStop || 0)) {
                        updatedOps[opIndex] = { ...updatedOps[opIndex], trailingStop: newTrailingStopLevel };
                        logNeedsUpdate = true;
                    }
                    
                    if (opIndex !== -1 && currentProfit < (updatedOps[opIndex]?.trailingStop || -Infinity)) {
                        shouldSell = true;
                        reason = `📈 Trailing Stop Acionado!`;
                    }
                }

                // --- Execute Sell Order ---
                if (shouldSell && !sellingContractsRef.current.has(op.id)) {
                    sellingContractsRef.current.add(op.id);
                    sellContract(op.id).then(result => {
                         if (result.success) {
                            setToastQueue(prev => [...prev, {
                                title: reason,
                                description: `Posição #${op.id} fechada com um resultado de $${currentProfit.toFixed(2)}.`,
                                variant: reason.includes('Stop Loss') ? 'destructive' : 'default',
                            }]);
                        } else {
                           sellingContractsRef.current.delete(op.id);
                        }
                    });
                }
            });

            if (logNeedsUpdate) {
                setAndPersistOperationsLog(updatedOps);
            }

        }, 1500); // Check every 1.5 seconds

        return () => clearInterval(trailingStopInterval);
    }, [sellContract, setAndPersistOperationsLog, isConnected, isConnecting]);


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
