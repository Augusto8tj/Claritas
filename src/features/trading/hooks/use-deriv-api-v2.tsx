// src/features/trading/hooks/use-deriv-api-v2.tsx
'use client';

import { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef, useMemo } from 'react';
import type { TradeResult, Operation, OperationInitiator, DurationUnit, ChartType, TimePeriod, ChartData, CandleData, TradeAnnotation, TickData, DurationLimits, Asset } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { getDerivWebSocketUrl } from '@/app/actions';
import { useToast } from '@/hooks/use-toast';

const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_V2_LOG_KEY = 'derivV2OperationsLog_v2.5';
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

export type ApiHistoricalData = {
    epoch: number;
    price?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
};

export interface ConnectionEvent {
    timestamp: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
}

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
    strategy?: string,
    extraParams?: Record<string, any>
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  getHistoricalData: (symbol: string, style: 'ticks' | 'candles', count: number, period?: TimePeriod) => Promise<ApiHistoricalData[]>;
  clearActiveContracts: () => void;
  tradeAnnotations: TradeAnnotation[];
  durationLimits: DurationLimits | null;
  connectionEvents: ConnectionEvent[];
  rawErrorCode: string | null;
  tokenSource: 'local' | 'default';
  maskedToken: string | null;
  appId: string;
  hookVersion: string;
  watchedSymbols: string[];
  setWatchedSymbols: (symbols: string[]) => void;
  multiAssetCandles: Record<string, CandleData[]>;
}

export const DerivApiContextV2 = createContext<DerivApiContextTypeV2 | undefined>(undefined);

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
        return data.slice(data.length - MAX_DATA_POINTS);
    }
    return data;
};

const getDurationInSeconds = (duration: number, unit: DurationUnit, symbol?: string): number => {
    switch (unit) {
        case 't':
          const tickSec = (symbol && symbol.startsWith('1HZ')) ? 1 : 2;
          return duration * tickSec;
        case 's': return duration;
        case 'm': return duration * 60;
        case 'h': return duration * 3600;
        case 'd': return duration * 86400;
        default: return duration * 2;
    }
};

export function useDerivApiV2State() {
  const [demoToken, setDemoToken] = useState<string | null>(null);
  const [realToken, setRealToken] = useState<string | null>(null);
  const [accountType, setAccountTypeState] = useState<AccountType>('demo');
  const [accountBalance, setAccountBalance] = useState<AccountBalance>({ balance: null, currency: null, loading: true });
  const [isLoading, setIsLoading] = useState(true);
  const [operationsLog, setOperationsLog] = useState<Operation[]>([]);
  const operationsLogRef = useRef(operationsLog);
  const [assetGroups, setAssetGroups] = useState<AssetGroup[]>([]);
  const [isAssetsLoading, setIsAssetsLoading] = useState(true);
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [toastQueue, setToastQueue] = useState<any[]>([]);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);

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
  const [durationLimits, setDurationLimits] = useState<DurationLimits | null>(null);

  const [connectionEvents, setConnectionEvents] = useState<ConnectionEvent[]>([]);
  const [rawErrorCode, setRawErrorCode] = useState<string | null>(null);
  const [tokenSource, setTokenSource] = useState<'local' | 'default'>('local');

  const WATCHED_SYMBOLS_DEFAULT = ['1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
  const [watchedSymbols, setWatchedSymbols] = useState<string[]>(WATCHED_SYMBOLS_DEFAULT);
  const [multiAssetCandles, setMultiAssetCandles] = useState<Record<string, CandleData[]>>({});
  const multiSubscriptionIdsRef = useRef<Record<string, string>>({});

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

  const recentlyCreatedContractsRef = useRef<Set<number>>(new Set());
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const botSubscriptionIdRef = useRef<string | null>(null);

  const activeToken = accountType === 'demo' ? demoToken : realToken;

  useEffect(() => {
    activeSymbolRef.current = activeSymbol;
  }, [activeSymbol]);

    useEffect(() => {
        operationsLogRef.current = operationsLog;
    }, [operationsLog]);

    const addEvent = useCallback((message: string, type: ConnectionEvent['type'] = 'info') => {
        setConnectionEvents(prev => [{ timestamp: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
    }, []);

    const setAndPersistOperationsLog = useCallback((updater: React.SetStateAction<Operation[]>) => {
        setOperationsLog(prevLog => {
            const newLogWithPotentialDuplicates = typeof updater === 'function' ? updater(prevLog) : updater;
            const uniqueOpsMap = new Map<number, Operation>();
            for(const op of newLogWithPotentialDuplicates) {
                if(op && op.id) uniqueOpsMap.set(op.id, op);
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
      const interval = setInterval(() => {
          const now = Date.now();
          const GRACE_MS = 8000; 
          let hasChanges = false;

          const updatedOps = operationsLogRef.current.map(op => {
              if (op.status === 'pending' && op.expirationTime && now > op.expirationTime + GRACE_MS) {
                  hasChanges = true;
                  const fallbackExitEpoch = Math.floor(now / 1000);
                  setTimeout(() => {
                      updateTradeAnnotation(String(op.id), {
                          status: 'lost',
                          profit: -op.stake,
                          exitTime: fallbackExitEpoch,
                          exitPrice: op.entryPrice,
                      });
                  }, 0);
                  return { ...op, status: 'lost' as const, result: -op.stake, exitTimestamp: new Date().toISOString(), resolvedBy: 'timeout' as const };
              }
              return op;
          });

          if (hasChanges) {
              setAndPersistOperationsLog(updatedOps);
          }
      }, 2000);

      return () => clearInterval(interval);
  }, [updateTradeAnnotation, setAndPersistOperationsLog]);
  
  const makeRequest = useCallback(<T,>(request: object, noResponse = false): Promise<T> => {
    return new Promise((resolve) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return resolve({ error: { message: "WebSocket não está conectado.", code: 'NotConnected' } } as any);
        }
        
        const req_id = Date.now() + Math.floor(Math.random() * 1000000);
        const payload = { ...request, req_id };
        
        if (!noResponse) {
            const timeoutId = setTimeout(() => {
                if (promisesRef.current.has(String(req_id))) {
                    const promise = promisesRef.current.get(String(req_id));
                    promise?.resolve({ error: { message: `O pedido à API expirou.`, code: 'Timeout' } } as any);
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
                    resolve({ error: { message: reason?.message || 'Erro interno na Promise.', code: 'InternalError' } } as any);
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
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return [];
        }

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
            if (response.error) {
              console.warn(`[getHistoricalData] API Error for ${symbol}:`, response.error.message);
              return [];
            }

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
            return [];
        }
    }, [makeRequest]);

    const subscribeToWatchedSymbols = useCallback(async (symbols: string[]) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        for (const [sym, subId] of Object.entries(multiSubscriptionIdsRef.current)) {
            if (!symbols.includes(sym)) {
                try { await makeRequest({ forget: subId }, true); } catch (e) {}
                delete multiSubscriptionIdsRef.current[sym];
            }
        }

        for (const symbol of symbols) {
            if (multiSubscriptionIdsRef.current[symbol]) continue;

            try {
                const history = await getHistoricalData(symbol, 'candles', 200, '1m');
                setMultiAssetCandles(prev => ({ ...prev, [symbol]: history as CandleData[] }));

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
                    multiSubscriptionIdsRef.current[symbol] = subResponse.subscription.id;
                }
            } catch (e) {
                console.warn(`[MultiAsset] Falha ao assinar ${symbol}:`, e);
            }
        }
    }, [makeRequest, getHistoricalData]);
    
  const subscribeToStreams = useCallback(async (symbol: string) => {
    try {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        if (activeSubscriptionIdRef.current) {
            try { await makeRequest({ forget: activeSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
        }
        if (botSubscriptionIdRef.current) {
            try { await makeRequest({ forget: botSubscriptionIdRef.current }, true); } catch (e) { /* silent */ }
        }
        
        activeSubscriptionIdRef.current = null;
        botSubscriptionIdRef.current = null;
        activeSymbolRef.current = symbol;

        setIsChartLoading(true);
        setChartError(null);
        setChartData([]);
        setBotCandleData([]);
        setPriceTicks([]); 

        const contractsRes: any = await makeRequest({ contracts_for: symbol });
        if (contractsRes.error) throw new Error(contractsRes.error.message);

        const available: any[] = contractsRes.contracts_for?.available || [];
        const newLimits: DurationLimits = { t: null, s: null, m: null, h: null, d: null };
        
        const parseDuration = (dStr: string): { value: number; unit: DurationUnit } | null => {
          if (!dStr) return null;
          const match = dStr.match(/^(\d+)([tsmhd])$/);
          if (!match) return null;
          return { value: parseInt(match[1], 10), unit: match[2] as DurationUnit };
        };
        
        const riseFallContracts = available.filter(
          (c: any) => c.contract_type === 'CALL' || c.contract_type === 'PUT'
        );
        
        if (riseFallContracts.length > 0) {
          for (const contract of riseFallContracts) {
            const minParsed = parseDuration(contract.min_contract_duration);
            const maxParsed = parseDuration(contract.max_contract_duration);
            
            if (minParsed && maxParsed && minParsed.unit === maxParsed.unit) {
              const unit = minParsed.unit;
              const existing = newLimits[unit];
              
              if (!existing) {
                newLimits[unit] = { min: minParsed.value, max: maxParsed.value };
              } else {
                newLimits[unit] = {
                  min: Math.min(existing.min, minParsed.value),
                  max: Math.max(existing.max, maxParsed.value),
                };
              }
            }
          }
        }
        
        if ((newLimits.s === null || newLimits.t === null) && symbol?.includes('1HZ')) {
            if (newLimits.t === null) newLimits.t = { min: 1, max: 10 };
            if (newLimits.s === null) newLimits.s = { min: 15, max: 3600 };
        }
        
        setDurationLimits(newLimits);

        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        const botHistory = await getHistoricalData(symbol, 'candles', 1000, '1m');
        setBotCandleData(botHistory as CandleData[]);
        
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
        if (botSubResponse.error && botSubResponse.error.code !== 'AlreadySubscribed') throw new Error(`Bot Sub: ${botSubResponse.error.message}`);
        if(botSubResponse.subscription?.id) botSubscriptionIdRef.current = botSubResponse.subscription.id;
        
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

        const currentChartType = chartTypeRef.current;
        const currentTimePeriod = timePeriodRef.current;
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

        if (wsRef.current?.readyState !== WebSocket.OPEN) return;

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
        if (uiSubResponse.error && uiSubResponse.error.code !== 'AlreadySubscribed') throw new Error(`UI Sub: ${uiSubResponse.error.message}`);
        if(uiSubResponse.subscription?.id) activeSubscriptionIdRef.current = uiSubResponse.subscription.id;

    } catch (error: any) {
        console.error(`[Market Data] Error for ${symbol}:`, error);
        setChartError(error.message || 'Falha ao carregar dados do mercado.');
    } finally {
        setIsChartLoading(false);
    }
  }, [getHistoricalData, makeRequest]);

    const executeTrade = useCallback(async (
        contractType: string,
        stake: number,
        symbol: string,
        tradeDirection: 'rise' | 'fall',
        duration: number,
        durationUnit: DurationUnit,
        initiator: OperationInitiator,
        strategy?: string,
        extraParams?: Record<string, any>
      ): Promise<TradeResult> => {
        try {
          if (!wsRef.current || !isConnected) {
            return { success: false, message: "A conexão com a API da Deriv não está ativa." };
          }

          if (['DIGITOVER', 'DIGITUNDER', 'DIGITDIFF'].includes(contractType) && durationUnit !== 't') {
            return { success: false, message: `Contratos de Dígitos exigem duração em ticks (unit: 't'). Recebido: ${durationUnit}` };
          }

          const sanitizedStake = parseFloat(stake.toFixed(2));
          
          let proposalPayload: any = { 
              "proposal": 1,
              "amount": sanitizedStake,
              "basis": "stake",
              "contract_type": contractType,
              "currency": "USD",
              "underlying_symbol": symbol,
              ...extraParams
          };

          if (contractType === 'ACCU') {
              proposalPayload.growth_rate = 0.03;
          } else if (contractType.startsWith('MULT')) {
              // CORREÇÃO: Usa o multiplicador enviado ou calcula um fallback inteligente baseado no ativo
              proposalPayload.multiplier = extraParams?.multiplier || (symbol?.startsWith('frx') ? 400 : 100);
          } else {
              proposalPayload.duration = Math.round(duration);
              proposalPayload.duration_unit = durationUnit;
          }

          const proposalResponse: any = await makeRequest(proposalPayload);
          if (proposalResponse.error) throw new Error(proposalResponse.error.message);

          const proposal = proposalResponse.proposal;
          if (!proposal || !proposal.id) {
            throw new Error("Falha ao obter uma proposta de negociação da API.");
          }
          
          const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": proposal.ask_price });
          if(buyResponse.error) throw new Error(buyResponse.error.message);
          const buyResult = buyResponse.buy;
          
          const contractId = buyResult.contract_id;
          if (!contractId) {
            throw new Error("Falha na compra do contrato, ID não retornado.");
          }
          
          recentlyCreatedContractsRef.current.add(contractId);
          setTimeout(() => {
              recentlyCreatedContractsRef.current.delete(contractId);
          }, 5000);

          const latestTick = priceTicks.length > 0 ? priceTicks[priceTicks.length - 1].price : 0;
          const entryPrice = buyResult.entry_tick_display_value 
            ? parseFloat(buyResult.entry_tick_display_value) 
            : (buyResult.entry_spot_display_value ? parseFloat(buyResult.entry_spot_display_value) : latestTick);

          const isSellable = durationUnit !== 't' || contractType === 'ACCU' || contractType.startsWith('MULT');
          
          const durationInSeconds = getDurationInSeconds(Math.round(duration), durationUnit, symbol);
          const purchaseTimeMs = (buyResult.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
          const expirationTimeMs = purchaseTimeMs + durationInSeconds * 1000;

          const newOperation: Operation = {
              id: buyResult.contract_id,
              asset: symbol,
              direction: tradeDirection,
              stake: sanitizedStake,
              status: 'pending',
              timestamp: new Date(purchaseTimeMs).toISOString(),
              duration: Math.round(duration),
              durationUnit: durationUnit,
              initiator,
              strategy,
              entryPrice: entryPrice,
              isSellable,
              expirationTime: (contractType === 'ACCU' || contractType.startsWith('MULT')) ? undefined : expirationTimeMs,
              contractType
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
              expirationTime: (contractType === 'ACCU' || contractType.startsWith('MULT')) ? undefined : expirationTimeMs,
              contractType: contractType === 'ACCU' ? 'accumulator' : (contractType.startsWith('MULT') ? 'multiplier' : 'option')
          });

          return {
            success: true,
            message: `Ordem executada.`,
            contractId: buyResult.contract_id,
            entryPrice,
          };
        } catch (error) {
           console.error("[Deriv Hook] Erro na execução:", error);
           const message = error instanceof Error ? error.message : "Um erro desconhecido.";
           return { success: false, message };
        }
      }, [isConnected, makeRequest, addTradeAnnotation, priceTicks, setAndPersistOperationsLog]);

  const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
    if (!wsRef.current || !isConnected) {
        return { success: false, message: "A conexão não está ativa." };
    }

    const contract = operationsLogRef.current.find(op => op.id === contractId);
    if (contract && contract.expirationTime) {
      const remainingTime = contract.expirationTime - Date.now();
      if (remainingTime < 1000) { 
        return { success: false, message: `Contrato #${contractId} bloqueado para venda.` };
      }
    }

    try {
        const sellResponse: any = await makeRequest({ "sell": contractId });
        if (sellResponse.error) throw new Error(sellResponse.error.message);
        return { success: true, message: `Venda enviada.` };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
  }, [isConnected, makeRequest]);
  
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
              if (Array.isArray(parsedLog)) {
                  setAndPersistOperationsLog(parsedLog.filter((op: any) => op && op.id));
              }
          }
          setIsLoading(false);
      } catch (e) {}
  }, [setAndPersistOperationsLog]);

  useEffect(() => {
    if (!activeToken || isLoading) {
      if (wsRef.current) wsRef.current.close();
      return;
    }
    
    const connect = async () => {
        setIsConnecting(true);
        addEvent('Iniciando conexão (handshake OTP)...', 'info');
        setConnectionError(null);
        setIsAssetsLoading(true);

        const accountId = ACCOUNT_IDS[accountType];
        const otpResult = await getDerivWebSocketUrl(activeToken.trim(), accountId);
        
        if (!otpResult.success || !otpResult.url) {
            const errMsg = otpResult.error || 'Falha ao obter URL segura (OTP).';
            setConnectionError(errMsg);
            addEvent(errMsg, 'error');
            setIsConnecting(false);
            setIsConnected(false);
            setIsAssetsLoading(false);
            return;
        }
      
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    
        const ws = new WebSocket(otpResult.url);
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
                            promise.resolve(response); 
                        } else {
                            promise.resolve(response);
                        }
                        promisesRef.current.delete(String(reqId));
                    }
                    return;
                }

                if (response.error && response.error.message) {
                    if (response.error.code !== 'AlreadySubscribed') {
                        setRawErrorCode(response.error.code || 'UNKNOWN');
                        addEvent(`Erro: ${response.error.message}`, 'error');
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
                    
                        setAndPersistOperationsLog(prevLog => {
                            const existingOpIndex = prevLog.findIndex(op => op.id === contract.contract_id);
                            const isSold = contract.is_sold === 1;
                            
                            if (existingOpIndex !== -1) {
                                const updatedLog = [...prevLog];
                                const op = updatedLog[existingOpIndex];
                                if (op.status === 'pending' || op.resolvedBy === 'timeout') {
                                    if (isSold) {
                                        const newStatus = contract.profit >= 0 ? 'won' : 'lost';
                                        const exitPrice = contract.exit_tick_display_value ? parseFloat(contract.exit_tick_display_value) : contract.sell_spot ? parseFloat(contract.sell_spot) : op.exitPrice;
                                        const exitTimeEpoch = contract.sell_time || contract.exit_tick_time;
                                        const sellTimeStr = exitTimeEpoch ? new Date(exitTimeEpoch * 1000).toISOString() : new Date().toISOString();
                                        
                                        setTimeout(() => {
                                            updateTradeAnnotation(String(contract.contract_id), { 
                                                status: newStatus, 
                                                profit: contract.profit, 
                                                exitPrice, 
                                                exitTime: exitTimeEpoch 
                                            });
                                            
                                            const profitVal = Number(contract.profit) || 0;
                                            setToastQueue(prev => [...prev, { 
                                                title: `Posição Fechada`, 
                                                description: `P&L: ${profitVal.toFixed(2)}`, 
                                                variant: newStatus === 'won' ? 'default' : 'destructive' 
                                            }]);

                                            if (wsRef.current?.readyState === WebSocket.OPEN) {
                                                wsRef.current.send(JSON.stringify({"balance": 1}));
                                            }
                                        }, 0);
                                        
                                        updatedLog[existingOpIndex] = { ...op, status: newStatus, result: contract.profit, exitPrice, exitTimestamp: sellTimeStr, resolvedBy: 'api' };
                                        return updatedLog;
                                    }
                                }
                                return prevLog;
                            } else {
                                if (recentlyCreatedContractsRef.current.has(contract.contract_id)) return prevLog;
                                
                                const direction = (contract.contract_type || '').includes('CALL') || (contract.contract_type || '').includes('MULTUP') ? 'rise' : 'fall';
                                const purchaseTime = contract.purchase_time || Math.floor(Date.now() / 1000);
                                
                                const newOp: Operation = {
                                    id: contract.contract_id, 
                                    asset: contract.underlying_symbol || contract.symbol || 'N/A', 
                                    direction, 
                                    stake: contract.buy_price || 0,
                                    status: isSold ? (contract.profit >= 0 ? 'won' : 'lost') : 'pending', 
                                    timestamp: new Date(purchaseTime * 1000).toISOString(), 
                                    duration: 0, 
                                    durationUnit: 's', 
                                    initiator: 'Manual',
                                    result: isSold ? contract.profit : undefined,
                                    contractType: contract.contract_type
                                };
                                
                                if (isSold) {
                                    const exitEpoch = contract.sell_time || contract.exit_tick_time;
                                    const exitPrice = contract.exit_tick_display_value ? parseFloat(contract.exit_tick_display_value) : contract.sell_spot ? parseFloat(contract.sell_spot) : 0;
                                    
                                    setTimeout(() => {
                                        addTradeAnnotation({
                                            contractId: String(contract.contract_id),
                                            entryTime: purchaseTime,
                                            entryPrice: parseFloat(contract.entry_spot || '0'),
                                            direction,
                                            status: contract.profit >= 0 ? 'won' : 'lost',
                                            stake: contract.buy_price || 0,
                                            symbol: contract.underlying_symbol || contract.symbol || 'N/A',
                                            exitTime: exitEpoch,
                                            exitPrice: exitPrice,
                                            profit: contract.profit,
                                            contractType: (contract.contract_type || '').startsWith('ACCU') ? 'accumulator' : ((contract.contract_type || '').startsWith('MULT') ? 'multiplier' : 'option')
                                        });
                                    }, 0);
                                }

                                return [newOp, ...prevLog];
                            }
                        });
                        break;
                    case 'tick':
                        if (response.tick?.symbol === activeSymbolRef.current) {
                            const tick = response.tick;
                            const newTick = { epoch: tick.epoch, price: tick.quote };
                            if (chartTypeRef.current === 'Area') setChartData(prev => addDataPoint(prev, newTick));
                            setPriceTicks(prev => {
                                const newTicks = [...prev, newTick];
                                return newTicks.length > MAX_DATA_POINTS ? newTicks.slice(1) : newTicks;
                            });
                            setDataVersion(v => v + 1);
                        }
                        break;
                    case 'ohlc':
                    case 'candles':
                        const candleData = response.ohlc || (response.candles && response.candles[0]);
                        if (candleData) {
                            const newCandle: CandleData = {
                                epoch: candleData.open_time || candleData.epoch,
                                open: parseFloat(candleData.open), high: parseFloat(candleData.high),
                                low: parseFloat(candleData.low), close: parseFloat(candleData.close),
                                volume: candleData.tick_count || 1,
                            };
                            
                            if (candleData.symbol === activeSymbolRef.current) {
                                if (response.subscription?.id === botSubscriptionIdRef.current) setBotCandleData(prev => addDataPoint(prev, newCandle) as CandleData[]);
                                if (response.subscription?.id === activeSubscriptionIdRef.current && chartTypeRef.current === 'Candle') setChartData(prev => addDataPoint(prev, newCandle));
                                setDataVersion(v => v + 1);
                            }

                            const matchedSymbol = Object.entries(multiSubscriptionIdsRef.current)
                                .find(([, subId]) => subId === response.subscription?.id)?.[0];
                            if (matchedSymbol) {
                                setMultiAssetCandles(prev => ({
                                    ...prev,
                                    [matchedSymbol]: addDataPoint(prev[matchedSymbol] || [], newCandle) as CandleData[]
                                }));
                            }
                        }
                        break;
                }
            } catch (e) { console.error('[Deriv WS] Parse error:', e); }
        };
    
        ws.onopen = async () => {
          try {
              reconnectInProgressRef.current = false;
              if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
              
              const authRes: any = await makeRequest({ "authorize": activeToken });
              if (authRes.error) throw new Error(authRes.error.message);

              setIsConnected(true);
              setIsConnecting(false);
              setConnectionError(null);
              addEvent('Conexão estabelecida e autenticada via OTP.', 'success');
              
              ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
              ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
              
              startConnectionMonitor();
              
              try {
                  const assetsRes: any = await makeRequest({ active_symbols: 'full' });
                  if (assetsRes.error) throw new Error(assetsRes.error.message);
                  
                  const groupedAssets: { [key: string]: Asset[] } = {};
                  assetsRes.active_symbols.forEach((symbol: any) => {
                      const marketKey = (symbol.market === 'synthetic_index' && symbol.submarket === 'basket_index') ? 'basket_index' : symbol.market;
                      const groupName = marketNameMapping[marketKey] || 'Outros';
                      if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                      
                      groupedAssets[groupName].push({
                          value: symbol.underlying_symbol || symbol.symbol, 
                          label: symbol.underlying_symbol_name || symbol.display_name, 
                          marketIsOpen: symbol.exchange_is_open === 1,
                          submarket: symbol.submarket, 
                          market: marketKey, 
                          minDuration: symbol.min_contract_duration ?? '5t', 
                          pip: symbol.pip_size || symbol.pip || 2
                      });
                  });
                  
                  setAssetGroups(Object.keys(groupedAssets)
                      .map(label => ({ label, options: groupedAssets[label].sort((a, b) => a.label.localeCompare(b.label)) }))
                      .sort((a, b) => a.label.localeCompare(b.label)));
                  setIsAssetsLoading(false);
              } catch (assetErr: any) {
                  console.warn("Falha parcial ao buscar lista de ativos, mas conexão permanece ativa.");
                  setIsAssetsLoading(false);
              }
      
          } catch (error: any) {
              addEvent(`Falha na autorização: ${error.message}`, 'error');
              setConnectionError(error.message);
              setIsConnected(false); setIsConnecting(false);
          }
      };
    
        ws.onclose = (event) => {
          if (!wsRef.current || reconnectInProgressRef.current) return;
          if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
          promisesRef.current.forEach((p) => p.reject(new Error("WS Closed")));
          promisesRef.current.clear();
          if (!event.wasClean && allowAutoReconnectRef.current) {
            reconnectInProgressRef.current = true;
            addEvent('Conexão perdida. Tentando reconectar...', 'warning');
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = setTimeout(() => {
                reconnectInProgressRef.current = false;
                setTriggerReconnect(c => c + 1);
            }, 3000);
          }
          setIsConnected(false); setIsConnecting(false);
          setAccountBalance({ balance: null, currency: null, loading: false });
          wsRef.current = null;
          multiSubscriptionIdsRef.current = {}; // Limpeza no fechamento
        };
    };

    connect();
  
    return () => {
      allowAutoReconnectRef.current = false;
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectInProgressRef.current = false;
      multiSubscriptionIdsRef.current = {};
    };
  }, [activeToken, isLoading, triggerReconnect, user, addEvent, accountType, makeRequest, startConnectionMonitor, setAndPersistOperationsLog, updateTradeAnnotation, addTradeAnnotation]);

  
  useEffect(() => {
    if (isConnected && activeSymbol && !isConnecting) subscribeToStreams(activeSymbol);
  }, [isConnected, isConnecting, activeSymbol, subscribeToStreams]);

  useEffect(() => {
    if (isConnected) subscribeToWatchedSymbols(watchedSymbols);
  }, [isConnected, watchedSymbols, subscribeToWatchedSymbols]);

  const maskedToken = useMemo(() => activeToken ? `${activeToken.substring(0, 8)}...` : null, [activeToken]);

  const contextValue: DerivApiContextTypeV2 = useMemo(() => ({
    ws: wsRef.current, isConnected, isConnecting, connectionError, demoToken, realToken, activeToken,
    accountType, setAccountType: (type) => { localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, type); setAccountTypeState(type); setTriggerReconnect(c => c + 1); },
    setTokens: (t) => { if(t.demo) { localStorage.setItem(DERIV_DEMO_TOKEN_KEY, t.demo); setDemoToken(t.demo); } if(t.real) { localStorage.setItem(DERIV_REAL_TOKEN_KEY, t.real); setRealToken(t.real); } setTriggerReconnect(c => c + 1); },
    disconnect: (type) => { if(type === 'demo') localStorage.removeItem(DERIV_DEMO_TOKEN_KEY); else localStorage.removeItem(DERIV_REAL_TOKEN_KEY); setTriggerReconnect(c => c + 1); },
    reconnect: async () => { setTriggerReconnect(c => c + 1); return true; },
    accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, setActiveSymbol, 
    chartData, botCandleData, priceTicks, isChartLoading, chartError, chartType, setChartType, 
    timePeriod, setTimePeriod, dataVersion, executeTrade, sellContract, getHistoricalData, 
    clearActiveContracts: () => { setAndPersistOperationsLog([]); setTradeAnnotations([]); }, tradeAnnotations, durationLimits,
    connectionEvents, rawErrorCode, tokenSource, maskedToken, appId: DERIV_APP_ID, hookVersion: 'v2.5.0-otp',
    watchedSymbols, setWatchedSymbols, multiAssetCandles
  }), [
      isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, accountBalance, operationsLog, assetGroups, 
      isAssetsLoading, activeSymbol, chartData, botCandleData, priceTicks, isChartLoading, chartError, chartType, timePeriod, dataVersion, 
      executeTrade, sellContract, getHistoricalData, tradeAnnotations, durationLimits, connectionEvents, rawErrorCode, tokenSource, maskedToken, setAndPersistOperationsLog, setActiveSymbol,
      watchedSymbols, multiAssetCandles
  ]);

  return (
    <DerivApiContextV2.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </DerivApiContextV2.Provider>
  );
}

export const DerivApiProviderV2 = ({ children }: { children: ReactNode }) => {
    const contextValue = useDerivApiV2State();
    return (
        <DerivApiContextV2.Provider value={contextValue}>
            {children}
        </DerivApiContextV2.Provider>
    );
};

export function useDerivApiV2() {
  const context = useContext(DerivApiContextV2);
  if (context === undefined) throw new Error('useDerivApiV2 must be used within a DerivApiProviderV2');
  return context;
}
