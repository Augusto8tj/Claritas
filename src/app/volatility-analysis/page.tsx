'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { Calculator, TrendingUp, Activity, BarChart3, Bot, FlaskConical } from 'lucide-react';
import { DerivApiProviderAccumulators, useDerivApiAccumulators } from "@/features/trading/hooks/use-deriv-api-accumulators";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { AssetSelectorAccumulators } from "@/features/trading/components/deriv-trader/asset-selector-accumulators";
import { ApiStatusIndicatorAccumulators } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorAccumulators";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChartData, CandleData } from '@/lib/types';


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

function StochasticLab({ realData }: { realData: ChartData[] }) {
  const [activeTab, setActiveTab] = useState('prediction');
  const [priceData, setPriceData] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  
  // States para a Previsão
  const [predictionData, setPredictionData] = useState<any[]>([]);
  const [predictionError, setPredictionError] = useState({ mae: 0, rmse: 0, count: 0 });

  const normalRandom = (): number => {
    let u1 = 0;
    while (u1 === 0) { // Previne Math.log(0) que resulta em -Infinity
      u1 = Math.random();
    }
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };


  useEffect(() => {
    const analyzeData = (data: ChartData[]) => {
      if (data.length < 50) {
        setPriceData([]); setReturns([]); setVolatilityData([]); setQQData([]); setStats({}); setPredictionData([]); setPredictionError({ mae: 0, rmse: 0, count: 0 });
        return;
      }
      
      const prices = data.map(d => isCandle(d) ? d.close : d.price);
      setPriceData(data.map((d, i) => ({ time: i, price: isCandle(d) ? d.close : d.price })));

      const logReturns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        if(prices[i-1] > 0) logReturns.push(Math.log(prices[i] / prices[i - 1]));
      }
      
      const volData: any[] = [];
      for (let i = 50; i < logReturns.length; i++) {
        const window = logReturns.slice(i - 50, i);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (window.length - 1);
        volData.push({ time: i, realizedVol: parseFloat((Math.sqrt(variance) * 100).toFixed(4)), targetVol: 10 });
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

      // --- Lógica de Previsão ---
      const newPredictionData: any[] = [];
      const errors: number[] = [];
      const sigma = 0.10, dt = 1, mu = 0;

      for (let i = 1; i < prices.length; i++) {
          const S_prev = prices[i-1];
          const S_real = prices[i];
          const Z = normalRandom();
          const drift = (mu - 0.5 * sigma * sigma) * dt;
          const diffusion = sigma * Math.sqrt(dt) * Z;
          const S_predicted = S_prev * Math.exp(drift + diffusion);

          // Adicionada verificação para garantir que apenas números finitos são adicionados
          if (Number.isFinite(S_real) && Number.isFinite(S_predicted)) {
              newPredictionData.push({ time: i, real: S_real, predicted: S_predicted });
              errors.push(S_real - S_predicted);
          }
      }
      
      if (errors.length > 0) {
          const sumSquaredErrors = errors.reduce((a, e) => a + e * e, 0);
          const sumAbsErrors = errors.reduce((a, e) => a + Math.abs(e), 0);
          setPredictionError({
              mae: sumAbsErrors / errors.length, rmse: Math.sqrt(sumSquaredErrors / errors.length), count: errors.length
          });
      }
      setPredictionData(newPredictionData.slice(-200));
    };

    analyzeData(realData);
  }, [realData]);

  const lineData = useMemo(() => {
    if (qqData.length === 0) return [];
    const allValues = [...qqData.map(d => d.theoretical), ...qqData.map(d => d.empirical)];
    const minVal = Math.min(...allValues);
    const maxVal = Math.max(...allValues);
    return [{ theoretical: minVal, empirical: minVal }, { theoretical: maxVal, empirical: maxVal }];
  }, [qqData]);

  return (
    <Card className="h-full flex flex-col">
        <CardHeader>
            <CardTitle className="font-headline flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-purple-600" />
                Laboratório Estocástico (Dados Reais)
            </CardTitle>
            <CardDescription>O cientista de IA valida o modelo GBM contra o mercado para prever o próximo movimento.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
            <ScrollArea className="flex-1">
                <div className="p-1 space-y-6">
                    <div className="flex gap-2 mb-6 flex-wrap">
                      {[
                        { id: 'prediction', icon: TrendingUp, label: 'Previsão' },
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
                                <h3 className="text-lg font-semibold mb-2">Previsão vs. Realidade (1 Tick à Frente)</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                  <LineChart data={predictionData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" label={{ value: 'Tempo (ticks)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} label={{ value: 'Preço', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="real" stroke="#2563eb" strokeWidth={2.5} dot={false} name="Preço Real" />
                                    <Line type="monotone" dataKey="predicted" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="Previsão GBM" />
                                  </LineChart>
                                </ResponsiveContainer>
                                <div className="mt-4 grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-slate-50 rounded border">
                                        <p className="text-xs text-muted-foreground">Erro Médio Absoluto (MAE)</p>
                                        <p className="text-lg font-bold font-mono">{predictionError.mae.toFixed(4)}</p>
                                    </div>
                                    <div className="p-3 bg-slate-50 rounded border">
                                        <p className="text-xs text-muted-foreground">Raiz do Erro Quadrático Médio (RMSE)</p>
                                        <p className="text-lg font-bold font-mono">{predictionError.rmse.toFixed(4)}</p>
                                    </div>
                                </div>
                              </div>
                            )}
                            {activeTab === 'returns' && (
                              <div>
                                <h3 className="text-xl font-semibold mb-4 text-slate-800">Retornos Logarítmicos</h3>
                                <ResponsiveContainer width="100%" height={400}>
                                  <ScatterChart>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="index" label={{ value: 'Observação', position: 'insideBottom', offset: -5 }} />
                                    <YAxis label={{ value: 'Retorno (%)', angle: -90, position: 'insideLeft' }} />
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
                                <h3 className="text-xl font-semibold mb-4 text-slate-800">Volatilidade Realizada vs. Alvo</h3>
                                <ResponsiveContainer width="100%" height={400}>
                                  <LineChart data={volatilityData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" label={{ value: 'Tempo (segundos)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis label={{ value: 'Volatilidade (%)', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="realizedVol" stroke="#059669" strokeWidth={2} dot={false} name="Volatilidade Realizada (50-período)" />
                                    <Line type="monotone" dataKey="targetVol" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Volatilidade Alvo (10%)" />
                                  </LineChart>
                                </ResponsiveContainer>
                                <div className="mt-4 p-4 bg-slate-50 rounded">
                                  <p className="text-sm text-slate-700 mb-2">
                                    <strong>Cálculo:</strong> σ̂ = √(1/(n-1) × Σ(r_i - r̄)²)
                                  </p>
                                  <p className="text-sm text-slate-700">
                                    A volatilidade realizada oscila em torno do valor alvo de 10% devido à variação amostral. 
                                    Com janelas maiores, a estimativa converge para o valor teórico.
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
                                      dataKey="theoretical"
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

function IsolatedMarketChart() {
    const { activeSymbol, chartData, isChartLoading, chartError, chartType, setChartType, timePeriod, setTimePeriod } = useDerivApiAccumulators();
    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <CardTitle className="font-headline">Gráfico em Tempo Real ({activeSymbol})</CardTitle>
                <CardDescription>Desempenho real do ativo selecionado.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
                <MarketChart activeSymbol={activeSymbol || ''} chartData={chartData} isChartLoading={isChartLoading} chartError={chartError} chartType={chartType} setChartType={setChartType} timePeriod={timePeriod} setTimePeriod={setTimePeriod} operations={[]} indicators={null} tradeAnnotations={[]} />
            </CardContent>
        </Card>
    );
};

function PageContent() {
    const { chartData } = useDerivApiAccumulators();
    return (
        <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
            <Header />
            <div className="grid md:grid-cols-2 gap-6 items-start">
                <IsolatedMarketChart />
                <StochasticLab realData={chartData} />
            </div>
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
