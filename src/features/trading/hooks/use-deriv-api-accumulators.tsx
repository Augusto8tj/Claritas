// src/features/trading/hooks/use-deriv-api-accumulators.tsx
'use client';

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';

const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_ACCUMULATORS_LOG_KEY = 'derivAccumulatorsOperationsLog_v4';
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
  isChartLoading: boolean;
  chartError: string | null;
  chartType: ChartType;
  setChartType: (type: ChartType) => void;
  timePeriod: TimePeriod;
  setTimePeriod: (period: TimePeriod) => void;
  dataVersion: number;
  tradeAnnotations: TradeAnnotation[];
  priceTicks: TickData[];

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
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<ApiHistoricalData[]>;
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

export const DerivApiProviderAccumulators = ({ children }: { children: ReactNode }) => {
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
  
  const [activeSymbol, setActiveSymbol] = useState<string | null>('1HZ10V');
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [botCandleData, setBotCandleData] = useState<CandleData[]>([]);
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]); // CORREÇÃO: Variável de estado adicionada
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const chartTypeRef = useRef(chartType);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('1m');
  const timePeriodRef = useRef(timePeriod);
  const [dataVersion, setDataVersion] = useState(0); 
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const tickSubscriptionIdRef = useRef<string | null>(null);
  const botSubscriptionIdRef = useRef<string | null>(null);
  
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);

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
                reject: (reason: any) => { // This reject is now for internal/unexpected errors
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
          throw new Error("Falha ao obter uma proposta de negociação da API. A resposta não continha um ID.");
      }
      
      const sanitizedAskPrice = parseFloat(proposal.ask_price.toFixed(2));
      const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": sanitizedAskPrice });
      if (buyResponse.error) throw new Error(buyResponse.error.message);
      
      const buyResult = buyResponse.buy;
      const contractId = buyResult.contract_id;
      if (!contractId) {
        throw new Error("Falha na compra do contrato, ID não retornado.");
      }
      
      const entryPrice = buyResult.entry_spot_display_value ? parseFloat(buyResult.entry_spot_display_value) : 0;
      const purchaseTimeMs = (buyResult.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
      const purchaseTime = purchaseTimeMs / 1000;

      const newOperation: any = {
          id: contractId,
          asset: symbol,
          direction: 'rise',
          stake: sanitizedStake,
          status: 'pending',
          timestamp: new Date(purchaseTimeMs).toISOString(),
          initiator,
          entryPrice: entryPrice,
          isSellable: true,
          contractType: 'ACCU',
          duration: 0,
          durationUnit: 's',
          growth_rate: sanitizedGrowthRate,
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
        message: `Contrato Acumulador para ${symbol} comprado.`,
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
      return { success: false, message: "A conexão com a API da Deriv não está ativa." };
    }
    if (sellingContractsRef.current.has(contractId)) {
      return { success: false, message: `A venda do contrato #${contractId} já está em andamento.` };
    }
  
    sellingContractsRef.current.add(contractId);
  
    try {
      const sellResponse: any = await makeRequest({ sell: contractId, price: 0 });
  
      if (sellResponse.error) {
        const message = sellResponse.error.message || `Erro desconhecido da API: ${JSON.stringify(sellResponse.error)}`;
        
        if (message.toLowerCase().includes("contract has expired") || message.toLowerCase().includes("contract is already closed")) {
          console.warn(`[Deriv Hook] Tentativa de vender contrato #${contractId} que já estava fechado.`);
          sellingContractsRef.current.delete(contractId);
          setAndPersistOperationsLog(prevLog => prevLog.map(op => 
            op.id === contractId && op.status === 'pending'
              ? { ...op, status: 'lost', result: -op.stake, exitTimestamp: new Date().toISOString() }
              : op
          ));
          return { success: true, message: "Contrato já estava fechado no servidor." };
        }
        
        console.error(`[Deriv Hook] Erro na API de venda para o contrato #${contractId}:`, message, sellResponse.error);
        
        sellingContractsRef.current.delete(contractId);
        return { success: false, message };
      }
  
      const sellResult = sellResponse.sell;
      if (sellResult) {
        return { success: true, message: `Ordem de venda para o contrato ${contractId} enviada.` };
      } else {
        sellingContractsRef.current.delete(contractId);
        return { success: false, message: "A resposta da API para a venda estava incompleta." };
      }
    } catch (error: any) {
      const message = error.message || "Ocorreu um erro de rede ao tentar vender o contrato.";
      sellingContractsRef.current.delete(contractId);
      console.error("[Deriv Hook] Exceção ao vender o contrato:", error);
      return { success: false, message };
    }
  }, [isConnected, makeRequest, setAndPersistOperationsLog]);
  
  const subscribeToStreams = useCallback(async (symbol: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    
    if (activeSubscriptionIdRef.current) {
        try { await makeRequest({ forget: activeSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
    }
    if (botSubscriptionIdRef.current) {
        try { await makeRequest({ forget: botSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
    }
    if (tickSubscriptionIdRef.current) {
        try { await makeRequest({ forget: tickSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
    }

    activeSubscriptionIdRef.current = null;
    botSubscriptionIdRef.current = null;
    tickSubscriptionIdRef.current = null;

    setIsChartLoading(true);
    setChartError(null);
    setChartData([]);
    setBotCandleData([]);
    setPriceTicks([]); // CORREÇÃO: Resetar priceTicks
    
    try {
        const currentChartType = chartTypeRef.current;
        const currentTimePeriod = timePeriodRef.current;

        const botHistory = await getHistoricalData(symbol, 'candles', 1000, '1m') as CandleData[];
        setBotCandleData(botHistory);
        const botSubRequest = { ticks_history: symbol, style: 'candles', granularity: 60, subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 };
        const botSubResponse: any = await makeRequest(botSubRequest);
        if (botSubResponse.error) {
            if (botSubResponse.error.code !== 'AlreadySubscribed') {
                throw new Error(`Bot Sub: ${botSubResponse.error.message}`);
            } else {
                console.warn(`[Accumulators] Bot data already subscribed for ${symbol}.`);
            }
        }
        if (botSubResponse.subscription?.id) {
            botSubscriptionIdRef.current = botSubResponse.subscription.id;
        }

        const tickSubRequest = { ticks: symbol, subscribe: 1 };
        const tickSubResponse: any = await makeRequest(tickSubRequest);
        if (tickSubResponse.error) {
            if (tickSubResponse.error.code !== 'AlreadySubscribed') {
                throw new Error(`Tick Sub: ${tickSubResponse.error.message}`);
            } else {
                console.warn(`[Accumulators] Tick data already subscribed for ${symbol}.`);
            }
        }
        if (tickSubResponse.subscription?.id) {
            tickSubscriptionIdRef.current = tickSubResponse.subscription.id;
        }
        
        const isUICandle = currentChartType === 'Candle';
        const isUI1mCandle = isUICandle && currentTimePeriod === '1m';
        const isUIArea = currentChartType === 'Area';
        
        if (isUI1mCandle) {
            setChartData(botHistory);
        } else if (isUIArea) {
            const tickHistory = await getHistoricalData(symbol, 'ticks', 1000);
            setChartData(tickHistory as TickData[]);
            setPriceTicks(tickHistory as TickData[]); // CORREÇÃO: Popular a partir do histórico
        } else if (isUICandle) {
            const uiHistory = await getHistoricalData(symbol, 'candles', 1000, currentTimePeriod);
            setChartData(uiHistory as CandleData[]);
            const uiSubRequest = { ticks_history: symbol, style: 'candles', granularity: getGranularityForTimePeriod(currentTimePeriod), subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 };
            const uiSubResponse: any = await makeRequest(uiSubRequest);
            if(uiSubResponse.error) {
                if (uiSubResponse.error.code !== 'AlreadySubscribed') {
                    throw new Error(`UI Sub: ${uiSubResponse.error.message}`);
                } else {
                    console.warn(`[Accumulators] UI data already subscribed for ${symbol}.`);
                }
            }
            if (uiSubResponse.subscription?.id) {
                activeSubscriptionIdRef.current = uiSubResponse.subscription.id;
            }
        }
    } catch (error: any) {
        console.error("Error in subscribeToStreams:", error);
        setChartError(error.message || 'Falha ao subscrever aos dados do mercado.');
    } finally {
        setIsChartLoading(false);
    }
  }, [getHistoricalData, makeRequest]);
  
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
        if (wsRef.current) wsRef.current.close();
        const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
        wsRef.current = ws;
        ws.onmessage = (event) => {
            try {
                const response = JSON.parse(event.data);
                
                if (response.msg_type === 'ping' || response.pong) return;
                const reqId = response.req_id;
                if (reqId && promisesRef.current.has(String(reqId))) {
                    const promise = promisesRef.current.get(String(reqId));
                    if (promise) {
                        if (response.error) {
                            if (response.error.code === 'AlreadySubscribed') {
                                console.warn(`[Deriv WS] Ignorando erro 'AlreadySubscribed' para req_id ${reqId}. A subscrição provavelmente já existe.`);
                                promise.resolve(response);
                            } else if (response.error.code === 'ContractSellNotAvailable' && response.error.message === 'The contract has expired.') {
                                console.warn(`[Deriv WS] Tentativa de vender contrato expirado (req_id ${reqId}). Resolvendo como falha controlada.`);
                                setAndPersistOperationsLog(prevLog => prevLog.map(op =>
                                    op.id === response.echo_req.sell ? { ...op, status: 'lost', result: -op.stake, exitTimestamp: new Date().toISOString() } : op
                                ));
                                promise.resolve({ sell: { contract_id: response.echo_req.sell } });
                            } else if (response.error.code === 'ContractSellNotAvailable' && response.error.message.includes('cannot be sold at entry tick')) {
                                console.warn(`[Deriv WS] Tentativa de venda no tick de entrada para o contrato #${response.echo_req.sell}. A lógica tentará novamente no próximo tick.`);
                                promise.resolve({ sell: { status: 'too_early' } }); 
                            }
                            else {
                                promise.reject(new Error(response.error.message));
                            }
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
                        if (!contract || contract.contract_type !== 'ACCU') return;
                        setAndPersistOperationsLog(prevLog => {
                            const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                            const isSold = contract.is_sold === 1;
                            if (existingOpIndex !== -1) {
                                const updatedLog = [...prevLog];
                                const op = updatedLog[existingOpIndex];
                                const updatedOp: Operation = {
                                  ...op,
                                  result: contract.profit,
                                  entryPrice: (op.entryPrice === 0 || !op.entryPrice) && contract.entry_spot
                                    ? parseFloat(contract.entry_spot)
                                    : op.entryPrice,
                                };
                                if (isSold) {
                                    sellingContractsRef.current.delete(contract.contract_id);
                                    const newStatus = contract.profit >= 0 ? 'won' : 'lost';
                                    updatedOp.status = newStatus;
                                    updatedOp.exitPrice = parseFloat(contract.sell_spot || contract.exit_tick_display_value || '0');
                                    updatedOp.exitTimestamp = new Date(contract.sell_time * 1000).toISOString();
                                    
                                    updateTradeAnnotation(String(contract.contract_id), { 
                                        status: newStatus, 
                                        profit: contract.profit, 
                                        exitPrice: updatedOp.exitPrice, 
                                        exitTime: contract.sell_time 
                                    });

                                    setToastQueue(prev => [...prev, { title: `Posição Fechada (${op.asset})`, description: `Resultado: ${contract.currency} ${contract.profit.toFixed(2)}`, variant: newStatus === 'won' ? 'default' : 'destructive' }]);
                                    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({"balance": 1}));
                                }
                                updatedLog[existingOpIndex] = updatedOp;
                                return updatedLog;
                            }
                            return prevLog;
                        });
                        break;
                    case 'tick':
                        if (response.subscription?.id === tickSubscriptionIdRef.current) {
                            const newTick = { epoch: response.tick.epoch, price: response.tick.quote };
                            setPriceTicks(prev => { // CORREÇÃO: Atualizar o estado de ticks
                                const newTicks = [...prev, newTick];
                                if (newTicks.length > MAX_DATA_POINTS) return newTicks.slice(1);
                                return newTicks;
                            });
                    
                            if (chartTypeRef.current === 'Area') {
                                setChartData(prev => addDataPoint(prev, newTick));
                            }
                    
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
                                volume: candleData.tick_count || 1
                             };
                    
                             if(response.subscription?.id === botSubscriptionIdRef.current) {
                                setBotCandleData(prev => addDataPoint(prev, newCandle) as CandleData[]);
                                if (chartTypeRef.current === 'Candle' && timePeriodRef.current === '1m') {
                                    setChartData(prev => addDataPoint(prev, newCandle));
                                }
                             }
                             else if (response.subscription?.id === activeSubscriptionIdRef.current) {
                                setChartData(prev => addDataPoint(prev, newCandle));
                             }
                             
                             // CORREÇÃO: Atualizar ticks a partir da vela
                             setPriceTicks(prev => {
                                const newTickFromCandle = { epoch: newCandle.epoch, price: newCandle.close };
                                const newTicks = [...prev, newTickFromCandle];
                                if (newTicks.length > MAX_DATA_POINTS) return newTicks.slice(1);
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

                const filteredSymbols = assetsRes.active_symbols.filter((symbol: any) => symbol.market === 'synthetic_index' && symbol.allow_accumulator_contracts === 1);
                const groupedAssets: { [key: string]: Asset[] } = {};
                filteredSymbols.forEach((symbol: any) => {
                    const groupName = marketNameMapping[symbol.market] || 'Outros';
                    if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                    groupedAssets[groupName].push({ value: symbol.symbol, label: symbol.display_name, marketIsOpen: symbol.exchange_is_open === 1, submarket: symbol.submarket, market: symbol.market, minDuration: 'N/A' });
                });
                setAssetGroups(Object.keys(groupedAssets)
                    .map(label => ({ label, options: groupedAssets[label].sort((a, b) => a.label.localeCompare(b.label)) }))
                    .sort((a, b) => a.label.localeCompare(b.label)));
                setIsAssetsLoading(false);
            } catch (error: any) {
                reconnectInProgressRef.current = false;
                if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
                setConnectionError(`Falha na autorização: ${errorMessage}`);
                setIsConnected(false); setIsConnecting(false); setIsAssetsLoading(false);
                setAccountBalance({ balance: null, currency: null, loading: false });
                allowAutoReconnectRef.current = false; // PREVENT RECONNECT LOOP
                if (ws.readyState === WebSocket.OPEN) ws.close();
            }
        };
        ws.onclose = (event) => {
          if (!wsRef.current || reconnectInProgressRef.current) return;
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          promisesRef.current.forEach((p) => p.reject(new Error("WebSocket fechado")));
          promisesRef.current.clear();
          if (!event.wasClean && allowAutoReconnectRef.current) {
            reconnectInProgressRef.current = true;
            console.warn(`[WS] Fechado inesperadamente. Código: ${event.code}. Tentando reconectar...`);
            setConnectionError(`Conexão perdida. Reconectando...`);
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(() => {
                reconnectInProgressRef.current = false;
                setTriggerReconnect(c => c + 1);
            }, 3000);
          } else if (!event.wasClean && !allowAutoReconnectRef.current) {
             console.warn(`[WS] Conexão falhou permanentemente (provavelmente token inválido). Auto-reconexão desativada.`);
             setConnectionError(`Authorization failed. Please check your API token.`);
          }
          setIsConnected(false); setIsConnecting(false);
          setAccountBalance({ balance: null, currency: null, loading: false });
          wsRef.current = null;
        };
        ws.onerror = () => { /* Silencioso */ };
    };
    connect();
    return () => {
      allowAutoReconnectRef.current = false;
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectInProgressRef.current = false;
    };
  }, [activeToken, isLoading, makeRequest, toast, triggerReconnect, setToastQueue, startConnectionMonitor, addTradeAnnotation, updateTradeAnnotation, setAndPersistOperationsLog]);

  useEffect(() => {
    if (isConnected && activeSymbol) {
        subscribeToStreams(activeSymbol);
    }
  }, [isConnected, activeSymbol, subscribeToStreams]);
  
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

  const contextValue: DerivApiAccumulatorsContextType = useMemo(() => ({
    ws: wsRef.current, isConnected, isConnecting, connectionError, demoToken, realToken, activeToken,
    accountType, accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, 
    setActiveSymbol, chartData, botCandleData, isChartLoading, chartError, chartType, setChartType, 
    timePeriod, setTimePeriod, dataVersion, tradeAnnotations, priceTicks, setAccountType, setTokens,
    disconnect, reconnect, executeTrade, sellContract, getHistoricalData, clearActiveContracts
  }), [
    isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, 
    accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, setActiveSymbol, 
    chartData, botCandleData, isChartLoading, chartError, chartType, timePeriod, dataVersion, 
    tradeAnnotations, priceTicks, setAccountType, setTokens, disconnect, reconnect, executeTrade, 
    sellContract, getHistoricalData, clearActiveContracts
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
