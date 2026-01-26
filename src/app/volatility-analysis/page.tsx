'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { Calculator, TrendingUp, Activity, BarChart3, Bot, FlaskConical, Target } from 'lucide-react';
import { DerivApiProviderAccumulators, useDerivApiAccumulators } from "@/features/trading/hooks/use-deriv-api-accumulators";
import { AssetSelectorAccumulators } from "@/features/trading/components/deriv-trader/asset-selector-accumulators";
import { ApiStatusIndicatorAccumulators } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorAccumulators";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChartData, CandleData } from '@/lib/types';
import { Progress } from "@/components/ui/progress";


// Aproximação da função quantil normal inversa
const normalQuantile = (p: number): number => {
  const a1 = -39.69683028665376; const a2 = 220.9460984245205; const a3 = -275.9285104469687; const a4 = 138.357751867269; const a5 = -30.66479806614716; const a6 = 2.506628277459239;
  const b1 = -54.47609879822406; const b2 = 161.5858368580409; const b3 = -155.6989798598866; const b4 = 66.80131188771972; const b5 = -13.28068155288572;
  const c1 = -0.007784894002430293; const c2 = -0.3223964580411365; const c3 = -2.400758277161838; const c4 = -2.549732539343734; const c5 = 4.374664141464968; const c6 = 2.938163982698783;
  const d1 = 0.007784695709041462; const d2 = 0.3224671290700398; const d3 = 2.445134137142996; const d4 = 3.754408661907416;
  const pLow = 0.02425; const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a1*r+a2)*r+a3)*r+a4)*r+a5)*r+a6)*q / (((((b1*r+b2)*r+b3)*r+b4)*r+b5)*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1-p));
    return -(((((c1*q+c2)*q+c3)*q+c4)*q+c5)*q+c6) / ((((d1*q+d2)*q+d3)*q+d4)*q+1);
  }
};

const isCandle = (d: ChartData): d is CandleData => d != null && 'close' in d;

function StochasticLab({ realData, activeSymbol }: { realData: ChartData[], activeSymbol: string | null }) {
  const [activeTab, setActiveTab] = useState('prediction');
  const [priceData, setPriceData] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  
  // --- States para Previsão ---
  const [predictionData, setPredictionData] = useState<any[]>([]);
  const [futurePath6t, setFuturePath6t] = useState<any[]>([]);
  const [futurePath10s, setFuturePath10s] = useState<any[]>([]);
  const [futurePath20s, setFuturePath20s] = useState<any[]>([]);
  const [futurePath40s, setFuturePath40s] = useState<any[]>([]);
  const [predictionError, setPredictionError] = useState({ mae: 0, rmse: 0, count: 0 });

  // --- Estados para Assertividade da Projeção ---
  const [predictionAccuracyHistory, setPredictionAccuracyHistory] = useState<boolean[]>([]);
  const [predictionAccuracy10sHistory, setPredictionAccuracy10sHistory] = useState<boolean[]>([]);
  const [predictionAccuracy20sHistory, setPredictionAccuracy20sHistory] = useState<boolean[]>([]);
  const [predictionAccuracy40sHistory, setPredictionAccuracy40sHistory] = useState<boolean[]>([]);


  const pendingPredictionsRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions10sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions20sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);
  const pendingPredictions40sRef = useRef<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>([]);


  const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) { u1 = Math.random(); }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };


  useEffect(() => {
    const analyzeData = (data: ChartData[]) => {
      const VOL_WINDOW = 50;
      const mu = 0; // Drift (agora será ajustado)
      const dt = 1; // Time step
      
      if (data.length < VOL_WINDOW) {
        setPriceData([]); setReturns([]); setVolatilityData([]); setQQData([]); setStats({}); 
        setPredictionData([]); setFuturePath6t([]); setFuturePath10s([]); setFuturePath20s([]); setFuturePath40s([]);
        setPredictionError({ mae: 0, rmse: 0, count: 0 });
        return;
      }
      
      const prices = data.map(d => isCandle(d) ? d.close : d.price);
      setPriceData(data.map((d, i) => ({ time: i, price: isCandle(d) ? d.close : d.price })));

      const logReturns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
      }
      
      const volData: any[] = [];
      const annualizationFactor = Math.sqrt(31536000); // Ticks por segundo (para anualizar)
      for (let i = VOL_WINDOW; i < logReturns.length; i++) {
        const window = logReturns.slice(i - VOL_WINDOW, i);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (window.length - 1);
        const realizedVol = Math.sqrt(variance) * annualizationFactor * 100;
        volData.push({ time: i, realizedVol: parseFloat(realizedVol.toFixed(4)), targetVol: 10 });
      }

      if (logReturns.length > 1) {
        const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
        const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
        const stdDev = Math.sqrt(variance);
        const skewness = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / logReturns.length;
        const kurtosis = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / logReturns.length - 3;
        const returnHistogram = logReturns.map((r, i) => ({ 'return': parseFloat((r * 100).toFixed(4)), index: i }));
        const sortedReturns = [...logReturns].sort((a, b) => a - b);
        const qqPlotData = sortedReturns.map((r, i) => {
          const p = (i + 0.5) / sortedReturns.length;
          const theoreticalQuantile = normalQuantile(p) * stdDev + mean;
          return { theoretical: parseFloat((theoreticalQuantile * 100).toFixed(4)), empirical: parseFloat((r * 100).toFixed(4)) };
        });
        setReturns(returnHistogram); setQQData(qqPlotData);
        setStats({
          mean: (mean * 100).toFixed(6), stdDev: (stdDev * 100).toFixed(6), annualizedVol: (stdDev * Math.sqrt(31536000) * 100).toFixed(4),
          skewness: skewness.toFixed(4), kurtosis: kurtosis.toFixed(4), observations: logReturns.length
        });
      }
      setVolatilityData(volData);

      const newPredictionData: any[] = [];
      const errors: number[] = [];
      
      for (let i = VOL_WINDOW; i < prices.length; i++) {
          const S_prev = prices[i-1];
          const S_real = prices[i];
          
          const pastLogReturns = logReturns.slice(i - VOL_WINDOW, i);
          const meanPastReturn = pastLogReturns.reduce((a, b) => a + b, 0) / VOL_WINDOW;
          const variance = pastLogReturns.reduce((s, r) => s + Math.pow(r - meanPastReturn, 2), 0) / (VOL_WINDOW - 1);
          const sigma = Math.sqrt(variance);

          const Z = normalRandom();
          const drift = (mu - 0.5 * sigma * sigma) * dt;
          const diffusion = sigma * Math.sqrt(dt) * Z;
          const S_predicted_1_tick = S_prev * Math.exp(drift + diffusion);
          
          if (Number.isFinite(S_real) && Number.isFinite(S_predicted_1_tick)) {
              newPredictionData.push({ time: i, real: S_real, predicted_1_tick: S_predicted_1_tick });
              errors.push(S_real - S_predicted_1_tick);
          }
      }
      
      if (errors.length > 0) {
          const sumSquaredErrors = errors.reduce((a, e) => a + e * e, 0);
          const sumAbsErrors = errors.reduce((a, e) => a + Math.abs(e), 0);
          setPredictionError({
              mae: sumAbsErrors / errors.length, rmse: Math.sqrt(sumSquaredErrors / errors.length), count: errors.length
          });
      }

      if (prices.length > VOL_WINDOW) {
        const lastPrice = prices[prices.length - 1];
        const lastLogReturns = logReturns.slice(-VOL_WINDOW);
        const meanLastReturn = lastLogReturns.reduce((a, b) => a + b, 0) / VOL_WINDOW;
        const lastVariance = lastLogReturns.reduce((s, r) => s + Math.pow(r - meanLastReturn, 2), 0) / (VOL_WINDOW - 1);
        const lastSigma = Math.sqrt(lastVariance);
        const lastTime = prices.length - 1;

        const projectPath = (steps: number) => {
          let currentSimPrice = lastPrice;
          const path = [{ time: lastTime, price: lastPrice }];
          for (let i = 1; i <= steps; i++) {
            const Z = normalRandom();
            const drift_future = (mu - 0.5 * lastSigma * lastSigma) * dt;
            const diffusion_future = lastSigma * Math.sqrt(dt) * Z;
            currentSimPrice = currentSimPrice * Math.exp(drift_future + diffusion_future);
            if (Number.isFinite(currentSimPrice)) {
              path.push({ time: lastTime + i, price: currentSimPrice });
            } else {
              path.push({ time: lastTime + i, price: path[path.length - 1].price });
            }
          }
          return path;
        };

        const processPredictionHorizon = (
            horizonTicks: number,
            prices: number[],
            pendingPredictionsRef: React.MutableRefObject<{ startTimeIndex: number; startPrice: number; predictedEndPrice: number }[]>,
            setAccuracyHistory: React.Dispatch<React.SetStateAction<boolean[]>>,
            projectPathFn: (steps: number) => { time: number; price: number }[]
        ) => {
            const newFuturePath = projectPathFn(horizonTicks);
            const currentTimeIndex = prices.length - 1;
            const completedIndices: number[] = [];

            pendingPredictionsRef.current.forEach((pred, index) => {
                if (currentTimeIndex >= pred.startTimeIndex + horizonTicks) {
                    const actualEndPrice = prices[pred.startTimeIndex + horizonTicks];
                    if (actualEndPrice === undefined) return;
                    const predictedDirection = pred.predictedEndPrice > pred.startPrice ? 'RISE' : 'FALL';
                    const actualDirection = actualEndPrice > pred.startPrice ? 'RISE' : 'FALL';
                    const isHit = predictedDirection === actualDirection;
                    setAccuracyHistory(prev => [...prev, isHit]);
                    completedIndices.push(index);
                }
            });

            if (completedIndices.length > 0) {
                pendingPredictionsRef.current = pendingPredictionsRef.current.filter((_, index) => !completedIndices.includes(index));
            }

            if (newFuturePath.length === horizonTicks + 1) {
                const newPredictionTimeIndex = newFuturePath[0].time;
                const alreadyPending = pendingPredictionsRef.current.some(p => p.startTimeIndex === newPredictionTimeIndex);
                if (!alreadyPending) {
                    pendingPredictionsRef.current.push({
                        startTimeIndex: newPredictionTimeIndex,
                        startPrice: newFuturePath[0].price,
                        predictedEndPrice: newFuturePath[horizonTicks].price,
                    });
                }
            }
        };

        const horizons = [
            { ticks: 6, ref: pendingPredictionsRef, setAccuracyHistory: setPredictionAccuracyHistory },
            { ticks: 5, ref: pendingPredictions10sRef, setAccuracyHistory: setPredictionAccuracy10sHistory }, // 10s
            { ticks: 10, ref: pendingPredictions20sRef, setAccuracyHistory: setPredictionAccuracy20sHistory }, // 20s
            { ticks: 20, ref: pendingPredictions40sRef, setAccuracyHistory: setPredictionAccuracy40sHistory }, // 40s
        ];
        
        horizons.forEach(h => {
            processPredictionHorizon(h.ticks, prices, h.ref, h.setAccuracyHistory, projectPath);
        });

        setFuturePath6t(projectPath(6).map(p => ({ time: p.time, predicted_6t_ahead: p.price })));
        setFuturePath10s(projectPath(5).map(p => ({ time: p.time, predicted_10s_ahead: p.price })));
        setFuturePath20s(projectPath(10).map(p => ({ time: p.time, predicted_20s_ahead: p.price })));
        setFuturePath40s(projectPath(20).map(p => ({ time: p.time, predicted_40s_ahead: p.price })));
      }
      
      setPredictionData(newPredictionData.slice(-200));

    };

    analyzeData(realData);
  }, [realData]);

  const chartDisplayData = useMemo(() => {
    const combined = [...predictionData.filter(p => p && (p.real || p.predicted_1_tick))];
    
    const mergePath = (path: any[]) => {
        path.forEach(point => {
          const existingPointIndex = combined.findIndex(p => p.time === point.time);
          if (existingPointIndex !== -1) {
            combined[existingPointIndex] = { ...combined[existingPointIndex], ...point };
          } else {
            combined.push(point);
          }
        });
    };

    mergePath(futurePath6t);
    mergePath(futurePath10s);
    mergePath(futurePath20s);
    mergePath(futurePath40s);

    return combined;
  }, [predictionData, futurePath6t, futurePath10s, futurePath20s, futurePath40s]);

  const lineData = useMemo(() => {
    if (qqData.length === 0) return [];
    const allValues = [...qqData.map(d => d.theoretical), ...qqData.map(d => d.empirical)].filter(v => Number.isFinite(v));
    if (allValues.length === 0) return [{ theoretical: 0, empirical: 0}, { theoretical: 0, empirical: 0}];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    return [{ theoretical: minVal, empirical: minVal }, { theoretical: maxVal, empirical: maxVal }];
  }, [qqData]);

  const calculateRollingAccuracy = (history: boolean[], windowSize: number) => {
    const recentHistory = history.slice(-windowSize);
    const hits = recentHistory.filter(h => h).length;
    const total = recentHistory.length;
    const percentage = total > 0 ? (hits / total) * 100 : 0;
    return { hits, total, percentage };
  };

  const accuracy6t = calculateRollingAccuracy(predictionAccuracyHistory, 6);
  const accuracy10s = calculateRollingAccuracy(predictionAccuracy10sHistory, 10);
  const accuracy20s = calculateRollingAccuracy(predictionAccuracy20sHistory, 10);
  const accuracy40s = calculateRollingAccuracy(predictionAccuracy40sHistory, 10);

  return (
    <Card className="h-full flex flex-col">
        <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                Laboratório Preditivo (Cientista de IA) - {activeSymbol}
            </CardTitle>
            <CardDescription>O cientista usa GBM para prever o próximo tick (histórico) e projetar 6 ticks no futuro.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
            <ScrollArea className="flex-1">
                <div className="p-1 space-y-6">
                    <div className="flex gap-2 mb-6 flex-wrap">
                      {[
                        { id: 'prediction', icon: TrendingUp, label: 'Previsão & Projeção' },
                        { id: 'returns', icon: Activity, label: 'Retornos' },
                        { id: 'volatility', icon: BarChart3, label: 'Volatilidade' },
                        { id: 'qq', icon: Calculator, label: 'Q-Q Plot' }
                      ].map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${ activeTab === tab.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80' }`}
                        >
                          <tab.icon size={16} />{tab.label}
                        </button>
                      ))}
                    </div>
                    
                    {priceData.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <Bot className="w-12 h-12 mb-4 opacity-30" />
                            <p className="font-semibold">Aguardando dados suficientes do mercado...</p>
                            <p className="text-sm">É necessário um histórico mínimo para a análise estatística.</p>
                        </div>
                    ) : (
                        <div className="min-h-[450px]">
                            {activeTab === 'prediction' && (
                              <div>
                                <h3 className="text-lg font-semibold mb-2">Previsão (1-Tick) & Projeções Futuras</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                  <LineChart data={chartDisplayData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" label={{ value: 'Tempo (ticks)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} label={{ value: 'Preço', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="real" stroke="#2563eb" strokeWidth={2.5} dot={false} name="Preço Real" />
                                    <Line type="monotone" dataKey="predicted_1_tick" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="Previsão (1-Tick)" />
                                    <Line type="monotone" dataKey="predicted_6t_ahead" stroke="#ef4444" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (6 Ticks)" />
                                    <Line type="monotone" dataKey="predicted_10s_ahead" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (10s)" />
                                    <Line type="monotone" dataKey="predicted_20s_ahead" stroke="#3b82f6" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (20s)" />
                                    <Line type="monotone" dataKey="predicted_40s_ahead" stroke="#10b981" strokeWidth={2} strokeDasharray="8 4" dot={false} name="Projeção (40s)" />
                                  </LineChart>
                                </ResponsiveContainer>
                                <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div className="p-3 bg-slate-50 rounded border">
                                        <p className="text-xs text-muted-foreground">Erro Médio Absoluto (MAE)</p>
                                        <p className="text-lg font-bold font-mono">{predictionError.mae.toFixed(4)}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded border">
                                        <p className="text-xs text-muted-foreground">Raiz do Erro Quadrático Médio (RMSE)</p>
                                        <p className="text-lg font-bold font-mono">{predictionError.rmse.toFixed(4)}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded border">
                                        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (6 Ticks)</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-lg font-bold font-mono">
                                                {accuracy6t.percentage.toFixed(1)}%
                                            </p>
                                            <span className="text-xs text-muted-foreground">({accuracy6t.hits} de {accuracy6t.total})</span>
                                        </div>
                                    </div>
                                     <div className="p-3 bg-slate-50 rounded border">
                                        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (10s)</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-lg font-bold font-mono">
                                                {accuracy10s.percentage.toFixed(1)}%
                                            </p>
                                            <span className="text-xs text-muted-foreground">({accuracy10s.hits} de {accuracy10s.total})</span>
                                        </div>
                                    </div>
                                     <div className="p-3 bg-slate-50 rounded border">
                                        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (20s)</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-lg font-bold font-mono">
                                                {accuracy20s.percentage.toFixed(1)}%
                                            </p>
                                            <span className="text-xs text-muted-foreground">({accuracy20s.hits} de {accuracy20s.total})</span>
                                        </div>
                                    </div>
                                     <div className="p-3 bg-slate-50 rounded border">
                                        <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Target className="h-4 w-4"/>Assertividade (40s)</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-lg font-bold font-mono">
                                                {accuracy40s.percentage.toFixed(1)}%
                                            </p>
                                            <span className="text-xs text-muted-foreground">({accuracy40s.total > 0 ? `${accuracy40s.hits} de ${accuracy40s.total}` : '0 de 0'})</span>
                                        </div>
                                    </div>
                                </div>
                              </div>
                            )}
                            {activeTab === 'returns' && (
                              <div>
                                <h3 className="text-xl font-semibold mb-4 text-slate-800">Distribuição de Retornos Reais</h3>
                                <ResponsiveContainer width="100%" height={400}>
                                  <ScatterChart>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="index" label={{ value: 'Observação', position: 'insideBottom', offset: -5 }} />
                                    <YAxis label={{ value: 'Retorno Log. por Tick (%)', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Scatter data={returns} fill="#8b5cf6" />
                                  </ScatterChart>
                                </ResponsiveContainer>
                                <div className="mt-4 p-4 bg-slate-50 rounded">
                                  <p className="text-sm text-slate-700 mb-2">
                                    <strong>Retorno Logarítmico:</strong> r(t) = ln(S(t)/S(t-1))
                                  </p>
                                  <p className="text-sm text-slate-700">
                                    Sob GBM, os retornos logarítmicos são independentes e identicamente distribuídos (i.i.d.) 
                                    seguindo distribuição normal: r(t) ~ N(μ - σ²/2, σ²)
                                  </p>
                                </div>
                              </div>
                            )}
                            {activeTab === 'volatility' && (
                              <div>
                                <h3 className="text-xl font-semibold mb-4 text-slate-800">Volatilidade Anualizada vs. Alvo</h3>
                                <ResponsiveContainer width="100%" height={400}>
                                  <LineChart data={volatilityData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" label={{ value: 'Tempo (segundos)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis label={{ value: 'Vol. Anualizada (%)', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="realizedVol" stroke="#059669" strokeWidth={2} dot={false} name="Volatilidade Realizada (50-período)" />
                                    <Line type="monotone" dataKey="targetVol" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Volatilidade Alvo (10%)" />
                                  </LineChart>
                                </ResponsiveContainer>
                                <div className="mt-4 p-4 bg-slate-50 rounded">
                                  <p className="text-sm text-slate-700 mb-2">
                                    <strong>Cálculo:</strong> σ̂ = √(Var(r)) × √N_ano
                                  </p>
                                  <p className="text-sm text-slate-700">
                                    A volatilidade realizada (verde) deve flutuar em torno do valor alvo de 10% (vermelho). 
                                    Grandes desvios indicam mudanças no comportamento do mercado.
                                  </p>
                                </div>
                              </div>
                            )}
                            {activeTab === 'qq' && (
                                <div>
                                <h3 className="text-xl font-semibold mb-4 text-slate-800">Q-Q Plot (Normalidade dos Retornos)</h3>
                                <ResponsiveContainer width="100%" height={400}>
                                  <ScatterChart>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="theoretical" name="Quantis Teóricos" label={{ value: 'Quantis Teóricos N(0,σ²)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis type="number" dataKey="empirical" name="Quantis Empíricos" label={{ value: 'Quantis Empíricos', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                                    <Scatter data={qqData} fill="#f59e0b" />
                                    <Line
                                      type="monotone"
                                      data={lineData}
                                      dataKey="empirical"
                                      stroke="#dc2626"
                                      strokeWidth={2}
                                      dot={false}
                                      name="Referência (y=x)"
                                    />
                                  </ScatterChart>
                                </ResponsiveContainer>
                                <div className="mt-4 p-4 bg-slate-50 rounded">
                                  <p className="text-sm text-slate-700">
                                    <strong>Interpretação:</strong> Pontos próximos à linha diagonal (vermelho) indicam que os 
                                    retornos seguem distribuição normal, confirmando a adequação do modelo GBM. Desvios nas 
                                    caudas podem indicar eventos extremos (fat tails).
                                  </p>
                                </div>
                              </div>
                            )}
                        </div>
                    )}
                    
                     {stats.observations > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                            <div className="bg-white rounded-lg shadow-inner p-4 border">
                              <h3 className="text-lg font-semibold mb-3 text-slate-700">Estatísticas dos Retornos Reais</h3>
                              <div className="space-y-2 text-sm">
                                <div className="flex justify-between items-center p-2 bg-slate-50 rounded">
                                  <span className="text-slate-600">Média (μ̂):</span>
                                  <span className="font-mono font-semibold">{stats.mean}%</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-slate-50 rounded">
                                  <span className="text-slate-600">Desvio Padrão (σ̂):</span>
                                  <span className="font-mono font-semibold">{stats.stdDev}%</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-blue-50 rounded border-l-4 border-blue-500">
                                  <span className="text-blue-800 font-semibold">Vol. Anualizada:</span>
                                  <span className="font-mono font-semibold text-blue-900">{stats.annualizedVol}%</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-slate-50 rounded">
                                  <span className="text-slate-600">Assimetria (Skewness):</span>
                                  <span className="font-mono font-semibold">{stats.skewness}</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-slate-50 rounded">
                                  <span className="text-slate-600">Curtose (Kurtosis):</span>
                                  <span className="font-mono font-semibold">{stats.kurtosis}</span>
                                </div>
                                <div className="flex justify-between items-center p-2 bg-slate-50 rounded">
                                  <span className="text-slate-600">Observações:</span>
                                  <span className="font-mono font-semibold">{stats.observations}</span>
                                </div>
                              </div>
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>
        </CardContent>
    </Card>
  );
};


function Header() {
    const { activeSymbol, setActiveSymbol, assetGroups, isAssetsLoading } = useDerivApiAccumulators();
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left"> Análise de Volatilidade </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelectorAccumulators selectedAsset={activeSymbol || ""} onAssetChange={(asset) => setActiveSymbol(asset)} assetGroups={assetGroups} isAssetsLoading={isAssetsLoading} />
                </div>
                <div className="flex justify-center"> <ApiStatusIndicatorAccumulators /> </div>
            </div>
        </div>
    );
};

function PageContent() {
    const { chartData, activeSymbol } = useDerivApiAccumulators();
    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <Header />
            <StochasticLab realData={chartData} activeSymbol={activeSymbol} />
        </div>
    );
}

export default function VolatilityAnalysisPage() {
    return (
        <DerivApiProviderAccumulators>
            <PageContent />
        </DerivApiProviderAccumulators>
    );
}
