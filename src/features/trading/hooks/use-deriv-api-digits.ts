// /src/features/trading/hooks/use-deriv-api-digits.ts
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import type { TradeResult } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import type { Operation, OperationInitiator, DurationUnit, TickData, Asset } from '@/lib/types';
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
};

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
}

const MAX_TICKS = 1000;
const marketNameMapping: Record<string, string> = { 'synthetic_index': 'Índices Sintéticos' };

export const DerivApiContextDigits = createContext<DerivApiContextTypeDigits | undefined>(undefined);

export function useDerivApiDigitsState() {
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
  const activeSubscriptionIdRef = useRef<string | null>(null);
  
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
                if(op && op.id) uniqueOpsMap.set(op.id, op);
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

    const makeRequest = useCallback((request: object, noResponse = false): Promise<any> => {
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
                    resolve: (value: any) => { clearTimeout(timeoutId); resolve(value); },
                    reject: (reason: any) => { clearTimeout(timeoutId); reject(reason); }
                });
            }
            ws.send(JSON.stringify(payload));
            if (noResponse) resolve({} as any);
        });
    }, []);

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

        const proposal = proposalResponse.proposal;
        if (proposalResponse.error) throw new Error(proposalResponse.error.message);
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

    const subscribeToTicks = useCallback(async (symbol: string) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        if (activeSubscriptionIdRef.current) {
            try { await makeRequest({ forget: activeSubscriptionIdRef.current }, true); } catch (e) { }
        }
        setPriceTicks([]); 
        try {
            const history: any = await makeRequest({ ticks_history: symbol, end: "latest", count: MAX_TICKS, adjust_start_time: 1 });
            if (history.error) throw new Error(history.error.message);
            setPriceTicks(history.history.times.map((t: number, i: number) => ({ epoch: t, price: history.history.prices[i] })));
            const subResponse: any = await makeRequest({ ticks: symbol, subscribe: 1 });
            if(subResponse.error) throw new Error(subResponse.error.message);
            if(subResponse.subscription?.id) activeSubscriptionIdRef.current = subResponse.subscription.id;
        } catch (error: any) {
            console.error(`[Market Data - Digits] Error for ${symbol}:`, error);
        }
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
        if (!activeToken || isLoading) {
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
                            if (response.error) promise.reject(new Error(response.error.message));
                            else promise.resolve(response);
                            promisesRef.current.delete(String(reqId));
                        }
                        return; 
                    }
                    if (response.error && response.error.message) {
                        if (response.error.code !== 'AlreadySubscribed') console.error(`[Deriv WS Digits] Error:`, response.error.message);
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
                                        updatedLog[existingOpIndex] = { ...op, status: newStatus, result: contract.profit, exitPrice: parseFloat(contract.exit_tick_display_value), exitTimestamp: new Date(contract.sell_time * 1000).toISOString() };
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
                                setPriceTicks(prev => [...prev, newTick].slice(-MAX_TICKS));
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
                    const filteredSymbols = assetsRes.active_symbols.filter((symbol: any) => 
                        symbol.market === 'synthetic_index' && symbol.available_contract_types?.some((c: string) => c.startsWith('DIGIT'))
                    );
                    const groupedAssets: { [key: string]: Asset[] } = {};
                    filteredSymbols.forEach((symbol: any) => {
                        const groupName = marketNameMapping[symbol.market] || 'Outros';
                        if (!groupedAssets[groupName]) groupedAssets[groupName] = [];
                        groupedAssets[groupName].push({ value: symbol.symbol, label: symbol.display_name, marketIsOpen: symbol.exchange_is_open === 1, submarket: symbol.submarket, market: symbol.market, minDuration: '5t' });
                    });
                    setAssetGroups(Object.keys(groupedAssets).map(label => ({ label, options: groupedAssets[label] })));
                    setIsAssetsLoading(false);
                } catch (error: any) {
                    reconnectInProgressRef.current = false;
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    let errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao conectar';
                    setConnectionError(`Falha na autorização: ${errorMessage}`);
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
                    console.error(`[WS] Conexão falhou permanentemente (provavelmente token inválido). Auto-reconexão desativada.`);
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
    }, [activeToken, isLoading, triggerReconnect, makeRequest, setAndPersistOperationsLog, startConnectionMonitor]);

    useEffect(() => {
        if (isConnected && activeSymbol) subscribeToTicks(activeSymbol);
    }, [isConnected, activeSymbol, subscribeToTicks]);

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
    }), [
        isConnected, isConnecting, connectionError, demoToken, realToken, activeToken, accountType, 
        accountBalance, operationsLog, assetGroups, isAssetsLoading, activeSymbol, 
        priceTicks, setAccountType, setTokens, disconnect, reconnect, executeTrade, sellContract, setActiveSymbol
    ]);

    return contextValue;
}

export function DerivApiProviderDigits({ children }: { children: React.ReactNode }) {
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
