// src/features/trading/hooks/use-deriv-api-digits.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import type { TradeResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, TickData, Asset, ChartData, CandleData, TimePeriod, ChartType, TradeAnnotation, DurationLimits } from '@/lib/types';
import { FirebaseErrorListener } from '@/components/firebase-error-listener';
import { useAuth } from '@/features/auth/hooks/use-auth';

// --- CONSTANTS ---
const DERIV_DEMO_TOKEN_KEY = 'derivDemoApiToken';
const DERIV_REAL_TOKEN_KEY = 'derivRealApiToken';
const DERIV_ACCOUNT_TYPE_KEY = 'derivAccountType';
const DERIV_DIGITS_LOG_KEY = 'derivDigitsOperationsLog_v5';
const DERIV_APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || "1089";
const MAX_TICKS = 1000;
const marketNameMapping: Record<string, string> = { 'synthetic_index': 'Índices Sintéticos' };

// --- TYPES ---
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

export interface ApiHistoricalData {
    epoch: number;
    price?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
}

export interface DerivApiContextTypeDigits {
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
  priceTicks: TickData[]; 
  chartData: ChartData[];
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
    contractType: 'DIGITMATCH' | 'DIGITDIFF',
    stake: number,
    symbol: string,
    last_digit: number,
    duration: number,
    durationUnit: DurationUnit,
    initiator: OperationInitiator,
  ) => Promise<TradeResult>;
  sellContract: (contractId: number) => Promise<TradeResult>;
  tradeAnnotations: TradeAnnotation[];
  durationLimits: DurationLimits | null;
}

export const DerivApiContextDigits = createContext<DerivApiContextTypeDigits | undefined>(undefined);

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

const addDataPoint = (prevData: ChartData[], newPoint: ChartData): ChartData[] => {
    const data = [...prevData, newPoint];
    if (data.length > MAX_TICKS) {
        return data.slice(-MAX_TICKS);
    }
    return data;
};

// This is the main state logic hook
export function useDerivApiDigitsState() {
  const { user } = useAuth();
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
  const [priceTicks, setPriceTicks] = useState<TickData[]>([]); 
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>('Area');
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('1m');
  const [dataVersion, setDataVersion] = useState(0);
  const [durationLimits, setDurationLimits] = useState<DurationLimits | null>(null);
  const chartTypeRef = useRef(chartType);
  const timePeriodRef = useRef(timePeriod);
  const activeSubscriptionIdRef = useRef<string | null>(null);
  const [tradeAnnotations, setTradeAnnotations] = useState<TradeAnnotation[]>([]);
  
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
            for (const op of newLogWithPotentialDuplicates){
                if (op && op.id) uniqueOpsMap.set(op.id, op);
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

    const makeRequest = useCallback(<T,>(request: object): Promise<T> => {
        return new Promise((resolve) => {
            const ws = wsRef.current;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                return resolve({ error: { message: "WebSocket não está conectado." } } as any);
            }
            const req_id = Date.now() + Math.floor(Math.random() * 1000000);
            const payload = { ...request, req_id };
            const timeoutId = setTimeout(() => {
                if (promisesRef.current.has(String(req_id))) {
                    const promise = promisesRef.current.get(String(req_id));
                    promise?.resolve({ error: { message: `O pedido à API expirou (60s).` } } as any);
                    promisesRef.current.delete(String(req_id));
                }
            }, 60000);
            promisesRef.current.set(String(req_id), {
                resolve: (value: any) => { clearTimeout(timeoutId); resolve(value); },
                reject: (reason: any) => { 
                  clearTimeout(timeoutId); 
                  resolve({ error: { message: reason?.message || 'Erro interno na Promise.' } } as any);
                }
            });
            ws.send(JSON.stringify(payload));
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

    const startConnectionMonitor = useCallback(() => {
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                try { wsRef.current.send(JSON.stringify({ ping: 1 })); } catch (error) { console.warn('[Ping] Failed:', error); }
            }
        }, 30000);
    }, []);

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
                if(Array.isArray(parsedLog)) setOperationsLog(parsedLog.filter(op => op && op.id));
            }
        } catch (error) { console.error("Failed to access localStorage:", error); }
        setIsLoading(false);
    }, []);

    const activeToken = accountType === 'demo' ? demoToken : realToken;

    useEffect(() => {
        if (!user || !activeToken || isLoading) {
            if (wsRef.current) wsRef.current.close();
            return;
        }
        const connect = () => {
            setIsConnecting(true); setConnectionError(null); setIsAssetsLoading(true);
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
                                if (response.error.code === 'AlreadySubscribed') promise.resolve(response);
                                else promise.resolve({ error: { message: response.error.message } });
                            } else promise.resolve(response);
                            promisesRef.current.delete(String(reqId));
                        }
                        return; 
                    }
                    if (response.error && response.error.message) {
                        if (response.error.code !== 'AlreadySubscribed') console.warn(`[Deriv WS Digits] Error:`, response.error.message);
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
                                if (existingOpIndex !== -1 && prevLog[existingOpIndex]?.status === 'pending') {
                                    const updatedLog = [...prevLog];
                                    const op = updatedLog[existingOpIndex]!;
                                    if (contract.is_sold === 1) {
                                        const newStatus = contract.status === 'won' ? 'won' : 'lost';
                                        const exitPrice = contract.exit_tick ? parseFloat(String(contract.exit_tick).slice(-1)) : op.exitPrice;
                                        updatedLog[existingOpIndex] = { ...op, status: newStatus, result: contract.profit, exitPrice: exitPrice, exitTimestamp: new Date(contract.sell_time * 1000).toISOString() };
                                        if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({"balance": 1}));
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
                                setPriceTicks(prev => addDataPoint(prev, newTick));
                                if (chartTypeRef.current === 'Area') {
                                    setChartData(prev => addDataPoint(prev, newTick));
                                }
                                setDataVersion(v => v + 1);
                            }
                            break;
                        case 'ohlc':
                             if (response.subscription?.id === activeSubscriptionIdRef.current) {
                                const candle = response.ohlc;
                                const newCandle: CandleData = { epoch: candle.open_time, open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low), close: parseFloat(candle.close) };
                                setChartData(prev => addDataPoint(prev, newCandle));
                                setPriceTicks(prev => addDataPoint(prev, { epoch: newCandle.epoch, price: newCandle.close }));
                                setDataVersion(v => v + 1);
                             }
                             break;
                    }
                } catch (parseError) { console.error('[Deriv WS Digits] Parse error:', parseError); }
            };
            
            ws.onopen = async () => {
                try {
                    reconnectInProgressRef.current = false;
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    const authResponse: any = await makeRequest({ authorize: activeToken });
                    if (authResponse.error) throw new Error(authResponse.error.message);
                    setIsConnected(true); setIsConnecting(false); setConnectionError(null);
                    ws.send(JSON.stringify({ "proposal_open_contract": 1, "subscribe": 1 }));
                    ws.send(JSON.stringify({ "balance": 1, "subscribe": 1 }));
                    startConnectionMonitor();
                    const assetsRes: any = await makeRequest({ active_symbols: 'full', product_type: 'basic' });
                    if (assetsRes.error) throw new Error(assetsRes.error.message);
                    const filteredSymbols = assetsRes.active_symbols.filter((s: any) => 
                        s.market === 'synthetic_index' && s.available_contract_types?.some((c: string) => c.startsWith('DIGIT'))
                    );
                    const groupedAssets: { [key: string]: Asset[] } = {};
                    filteredSymbols.forEach((s: any) => {
                        const groupName = marketNameMapping[s.market] || 'Outros';
                        if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                        groupedAssets[groupName].push({ value: s.symbol, label: s.display_name, marketIsOpen: s.exchange_is_open === 1, submarket: s.submarket, market: s.market, minDuration: '5t' });
                    });
                    setAssetGroups(Object.keys(groupedAssets).map(label => ({ label, options: groupedAssets[label] })));
                    setIsAssetsLoading(false);
                } catch (error: any) {
                    reconnectInProgressRef.current = false;
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    setConnectionError(`Falha na autorização: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
                    setIsConnected(false); setIsConnecting(false); setIsAssetsLoading(false);
                    setAccountBalance({ balance: null, currency: null, loading: false });
                    allowAutoReconnectRef.current = false;
                    if (ws.readyState === WebSocket.OPEN) ws.close();
                }
            };
            
            ws.onclose = (event) => {
                if (!wsRef.current || reconnectInProgressRef.current) return;
                if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
                promisesRef.current.forEach(p => p.reject(new Error("WebSocket fechado.")));
                promisesRef.current.clear();
                if (!event.wasClean && allowAutoReconnectRef.current) {
                    reconnectInProgressRef.current = true;
                    setConnectionError(`Conexão perdida. Reconectando...`);
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = setTimeout(() => { reconnectInProgressRef.current = false; setTriggerReconnect(c => c + 1); }, 3000);
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
    }, [user, activeToken, isLoading, triggerReconnect, makeRequest, setAndPersistOperationsLog, startConnectionMonitor]);

    const executeTrade = useCallback(async (
        contractType: 'DIGITMATCH' | 'DIGITDIFF', stake: number, symbol: string, last_digit: number,
        duration: number, durationUnit: DurationUnit, initiator: OperationInitiator
    ): Promise<TradeResult> => {
      try {
        if (!wsRef.current || !isConnected) throw new Error("A conexão com a API não está ativa.");
        const sanitizedStake = parseFloat(stake.toFixed(2));
        const sanitizedDuration = Math.round(duration);

        const proposalResponse: any = await makeRequest({ 
            "proposal": 1, "amount": sanitizedStake, "basis": "stake", "contract_type": contractType,
            "currency": "USD", "duration": sanitizedDuration, "duration_unit": durationUnit,
            "symbol": symbol, "last_digit": last_digit,
        });

        if (proposalResponse.error) throw new Error(proposalResponse.error.message);
        const proposal = proposalResponse.proposal;
        if (!proposal || !proposal.id) throw new Error("Falha ao obter uma proposta de negociação.");
        
        const buyResponse: any = await makeRequest({ "buy": proposal.id, "price": proposal.ask_price });
        if (buyResponse.error) throw new Error(buyResponse.error.message);
        const buyResult = buyResponse.buy;
        
        const purchaseTimeMs = (buyResult.purchase_time || Math.floor(Date.now() / 1000)) * 1000;
        const expirationTimeMs = buyResult.expiry_time * 1000;

        const newOperation: any = {
            id: buyResult.contract_id, asset: symbol,
            direction: contractType === 'DIGITMATCH' ? 'rise' : 'fall',
            stake: sanitizedStake, status: 'pending',
            timestamp: new Date(purchaseTimeMs).toISOString(),
            duration: sanitizedDuration, durationUnit: durationUnit, initiator,
            entryPrice: buyResult.entry_tick_display_value ? parseFloat(buyResult.entry_tick_display_value) : 0,
            isSellable: false, expirationTime: expirationTimeMs, contractType: contractType, last_digit_prediction: last_digit,
        };
        setAndPersistOperationsLog(prevLog => [newOperation, ...prevLog]);
        return { success: true, message: `Ordem executada.`, contractId: buyResult.contract_id };
      } catch (error) {
         console.error("[Deriv Hook - Digits] Erro:", error);
         const message = error instanceof Error ? error.message : "Um erro desconhecido ocorreu.";
         return { success: false, message };
      }
    }, [isConnected, makeRequest, setAndPersistOperationsLog]);

    const sellContract = useCallback(async (contractId: number): Promise<TradeResult> => {
        return { success: false, message: "Contratos de dígitos não podem ser vendidos." };
    }, []);

    const subscribeToMarketData = useCallback(async (symbol: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        if (activeSubscriptionIdRef.current) {
            try { await makeRequest({ forget: activeSubscriptionIdRef.current }); } catch (e) { /* ignore */ }
        }
        setPriceTicks([]); setChartData([]); setIsChartLoading(true);
        try {
            const historyStyle = chartTypeRef.current === 'Candle' ? 'candles' : 'ticks';
            const history = await getHistoricalData(symbol, historyStyle, MAX_TICKS, timePeriodRef.current);
            setChartData(history as ChartData[]);
            if (historyStyle === 'ticks') setPriceTicks(history as TickData[]);
            else setPriceTicks(history.map(c => ({ epoch: c.epoch, price: c.close || 0 })));
            setDataVersion(v => v + 1);

            let subRequest: any;
            if (chartTypeRef.current === 'Candle') {
                subRequest = { ticks_history: symbol, style: 'candles', granularity: getGranularityForTimePeriod(timePeriodRef.current), subscribe: 1, end: "latest", count: 1, adjust_start_time: 1 };
            } else {
                subRequest = { ticks: symbol, subscribe: 1 };
            }
            const subResponse: any = await makeRequest(subRequest);
            if (subResponse.error) throw new Error(subResponse.error.message);
            activeSubscriptionIdRef.current = subResponse.subscription?.id || null;
        } catch (error: any) {
            console.error(`[Market Data - Digits] Error for ${symbol}:`, error);
        } finally {
            setIsChartLoading(false);
        }
    }, [makeRequest, getHistoricalData]);

    useEffect(() => {
        if (isConnected && activeSymbol && !isConnecting) subscribeToMarketData(activeSymbol);
    }, [isConnected, activeSymbol, isConnecting, subscribeToMarketData, chartType, timePeriod]);

    const setAccountType = useCallback((type: AccountType) => {
        try { localStorage.setItem(DERIV_ACCOUNT_TYPE_KEY, type); setAccountTypeState(type); allowAutoReconnectRef.current = true; setTriggerReconnect(c => c + 1); } catch (e) {}
    }, []);

    const setTokens = useCallback((tokens: { demo?: string; real?: string }) => {
        try {
            if (tokens.demo) { localStorage.setItem(DERIV_DEMO_TOKEN_KEY, tokens.demo); setDemoToken(tokens.demo); }
            if (tokens.real) { localStorage.setItem(DERIV_REAL_TOKEN_KEY, tokens.real); setRealToken(tokens.real); }
            allowAutoReconnectRef.current = true; setTriggerReconnect(c => c + 1);
        } catch (e) {}
    }, []);

    const disconnect = useCallback((type: AccountType) => {
        try {
            if (type === 'demo') { localStorage.removeItem(DERIV_DEMO_TOKEN_KEY); setDemoToken(null); } 
            else { localStorage.removeItem(DERIV_REAL_TOKEN_KEY); setRealToken(null); }
        } catch (e) {}
    }, []);
    
    const isConnectedRef = useRef(isConnected);
    isConnectedRef.current = isConnected;
    const connectionErrorRef = useRef(connectionError);
    connectionErrorRef.current = connectionError;

    const reconnect = useCallback(async (): Promise<boolean> => {
        allowAutoReconnectRef.current = true; setTriggerReconnect(c => c + 1);
        return new Promise(resolve => {
            const start = Date.now();
            const interval = setInterval(() => {
                if (isConnectedRef.current) { clearInterval(interval); resolve(true); } 
                else if (connectionErrorRef.current || Date.now() - start > 10000) { clearInterval(interval); resolve(false); }
            }, 200);
        });
    }, []);
    
    const contextValue: DerivApiContextTypeDigits = useMemo(() => ({
        ws: wsRef.current, isConnected, isConnecting, connectionError, demoToken, realToken, activeToken,
        accountType, accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, 
        setActiveSymbol, priceTicks, setAccountType, setTokens,
        disconnect, reconnect, executeTrade, sellContract,
        chartData, isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod, dataVersion, tradeAnnotations,
        durationLimits
    }), [
        isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, 
        accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, 
        priceTicks, setAccountType, setTokens, disconnect, reconnect, executeTrade, sellContract, setActiveSymbol,
        chartData, isChartLoading, chartError, chartType, timePeriod, dataVersion, tradeAnnotations,
        durationLimits
    ]);

    return contextValue;
}

export function DerivApiProviderDigits({ children }: { children: ReactNode }) {
    const contextValue = useDerivApiDigitsState();
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
