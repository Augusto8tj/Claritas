'use client';

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { Calculator, TrendingUp, Activity, BarChart3, Bot } from 'lucide-react';
import { DerivApiProviderAccumulators, useDerivApiAccumulators } from "@/features/trading/hooks/use-deriv-api-accumulators";
import { MarketChart } from "@/features/trading/components/deriv-trader/market-chart";
import { AssetSelectorAccumulators } from "@/features/trading/components/deriv-trader/asset-selector-accumulators";
import { ApiStatusIndicatorAccumulators } from "@/features/trading/components/deriv-trader/ApiStatusIndicatorAccumulators";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChartData, CandleData } from '@/lib/types';


// Aproximação da função quantil normal inversa
const normalQuantile = (p: number): number => {
  const a1 = -39.69683028665376;
  const a2 = 220.9460984245205;
  const a3 = -275.9285104469687;
  const a4 = 138.357751867269;
  const a5 = -30.66479806614716;
  const a6 = 2.506628277459239;
  
  const b1 = -54.47609879822406;
  const b2 = 161.5858368580409;
  const b3 = -155.6989798598866;
  const b4 = 66.80131188771972;
  const b5 = -13.28068155288572;
  
  const c1 = -0.007784894002430293;
  const c2 = -0.3223964580411365;
  const c3 = -2.400758277161838;
  const c4 = -2.549732539343734;
  const c5 = 4.374664141464968;
  const c6 = 2.938163982698783;
  
  const d1 = 0.007784695709041462;
  const d2 = 0.3224671290700398;
  const d3 = 2.445134137142996;
  const d4 = 3.754408661907416;
  
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  
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

function RealDataAnalysis({ realData }: { realData: ChartData[] }) {
  const [activeTab, setActiveTab] = useState('simulation');
  const [priceData, setPriceData] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});

  useEffect(() => {
    const analyzeRealData = (data: ChartData[]) => {
      if (data.length < 50) {
        setPriceData([]);
        setReturns([]);
        setVolatilityData([]);
        setQQData([]);
        setStats({});
        return;
      }
      
      const prices = data.map(d => isCandle(d) ? d.close : d.price);

      setPriceData(data.map((d, i) => ({
          time: i,
          price: isCandle(d) ? d.close : d.price,
      })));

      const logReturns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        if(prices[i-1] > 0) {
          const logReturn = Math.log(prices[i] / prices[i - 1]);
          logReturns.push(logReturn);
        }
      }
      
      const volData: any[] = [];
      for (let i = 50; i < logReturns.length; i++) {
        const window = logReturns.slice(i - 50, i);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance = window.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (window.length - 1);
        const realizedVol = Math.sqrt(variance) * 100;
        
        volData.push({
          time: i,
          realizedVol: parseFloat(realizedVol.toFixed(4)),
          targetVol: 10
        });
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
          return {
            theoretical: parseFloat((theoreticalQuantile * 100).toFixed(4)),
            empirical: parseFloat((r * 100).toFixed(4))
          };
        });

        setReturns(returnHistogram);
        setQQData(qqPlotData);
        setStats({
          mean: (mean * 100).toFixed(6),
          stdDev: (stdDev * 100).toFixed(6),
          annualizedVol: (stdDev * Math.sqrt(31536000) * 100).toFixed(4),
          skewness: skewness.toFixed(4),
          kurtosis: kurtosis.toFixed(4),
          observations: logReturns.length
        });
      }
      setVolatilityData(volData);
    };

    analyzeRealData(realData);
  }, [realData]);

  return (
    <Card className="h-full flex flex-col">
        <CardHeader>
            <CardTitle className="font-headline">Análise Estatística (Dados Reais)</CardTitle>
            <CardDescription>Validação do modelo estocástico com dados de mercado ao vivo.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
            <ScrollArea className="flex-1">
                <div className="p-1 space-y-6">
                    <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
                      <h3 className="font-semibold text-blue-900 mb-2">Objetivo da Análise</h3>
                       <p className="text-sm text-blue-800 mt-2">
                        Comparar as propriedades estatísticas dos dados reais com as previsões do modelo GBM para validar nossas premissas.
                      </p>
                    </div>
                    <div className="flex gap-2 mb-6 flex-wrap">
                      {[
                        { id: 'simulation', icon: TrendingUp, label: 'Preços' },
                        { id: 'returns', icon: Activity, label: 'Retornos' },
                        { id: 'volatility', icon: BarChart3, label: 'Volatilidade' },
                        { id: 'qq', icon: Calculator, label: 'Q-Q Plot' }
                      ].map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                            activeTab === tab.id
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          <tab.icon size={16} />
                          {tab.label}
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
                            {activeTab === 'simulation' && (
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Trajetória do Preço (Real)</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                <LineChart data={priceData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" label={{ value: 'Tempo (ticks)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis label={{ value: 'Preço', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2} dot={false} name="Preço Real" />
                                </LineChart>
                                </ResponsiveContainer>
                            </div>
                            )}
                            {activeTab === 'returns' && (
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Retornos Logarítmicos</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                <ScatterChart>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="index" type="number" domain={['dataMin', 'dataMax']} label={{ value: 'Observação', position: 'insideBottom', offset: -5 }} />
                                    <YAxis label={{ value: 'Retorno (%)', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Scatter data={returns} fill="#8b5cf6" />
                                </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                            )}
                            {activeTab === 'volatility' && (
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Volatilidade Realizada vs. Alvo</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                <LineChart data={volatilityData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" label={{ value: 'Tempo (ticks)', position: 'insideBottom', offset: -5 }} />
                                    <YAxis label={{ value: 'Volatilidade (%)', angle: -90, position: 'insideLeft' }} />
                                    <Tooltip />
                                    <Legend />
                                    <Line type="monotone" dataKey="realizedVol" stroke="#059669" strokeWidth={2} dot={false} name="Realizada (50p)" />
                                    <Line type="monotone" dataKey="targetVol" stroke="#dc2626" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Alvo Teórico (10%)" />
                                </LineChart>
                                </ResponsiveContainer>
                            </div>
                            )}
                            {activeTab === 'qq' && (
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Q-Q Plot (Normalidade dos Retornos)</h3>
                                <ResponsiveContainer width="100%" height={350}>
                                <ScatterChart>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" dataKey="theoretical" name="Quantis Teóricos" label={{ value: 'Teóricos', position: 'insideBottom', offset: -5 }} />
                                    <YAxis type="number" dataKey="empirical" name="Quantis Empíricos" label={{ value: 'Empíricos', angle: -90, position: 'insideLeft' }}/>
                                    <Tooltip />
                                    <Scatter data={qqData} fill="#f59e0b" />
                                    <Line type="monotone" dataKey="empirical" stroke="#dc2626" strokeWidth={2} dot={false} data={[{theoretical: -0.5, empirical: -0.5}, {theoretical: 0.5, empirical: 0.5}]} />
                                </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                            )}
                        </div>
                    )}
                    
                    {stats.observations > 0 && (
                        <div className="bg-white rounded-lg shadow-inner p-4 border mt-6">
                        <h3 className="text-lg font-semibold mb-4 text-slate-800">Estatísticas dos Retornos</h3>
                        <div className="space-y-3">
                            {Object.entries(stats).map(([key, value]) => (
                                <div key={key} className="flex justify-between items-center p-2 bg-slate-50 rounded text-sm">
                                <span className="text-slate-600 capitalize">{key.replace('annualizedVol', 'Vol. Anualizada')}:</span>
                                <span className="font-mono font-semibold">{value as string}</span>
                                </div>
                            ))}
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
    const {
        activeSymbol,
        setActiveSymbol,
        assetGroups,
        isAssetsLoading,
    } = useDerivApiAccumulators();
    
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight font-headline shrink-0 text-center md:text-left">
                Análise de Volatilidade
            </h1>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="flex justify-center">
                    <AssetSelectorAccumulators
                        selectedAsset={activeSymbol || ""} 
                        onAssetChange={(asset) => setActiveSymbol(asset)} 
                        assetGroups={assetGroups}
                        isAssetsLoading={isAssetsLoading}
                    />
                </div>
                <div className="flex justify-center">
                    <ApiStatusIndicatorAccumulators />
                </div>
            </div>
        </div>
    );
};

function IsolatedMarketChart() {
    const { 
        activeSymbol, chartData, isChartLoading, chartError, 
        chartType, setChartType, timePeriod, setTimePeriod
    } = useDerivApiAccumulators();
    
    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <CardTitle className="font-headline">Gráfico em Tempo Real ({activeSymbol})</CardTitle>
                <CardDescription>Desempenho real do ativo selecionado.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
                <MarketChart
                    activeSymbol={activeSymbol || ''}
                    chartData={chartData}
                    isChartLoading={isChartLoading}
                    chartError={chartError}
                    chartType={chartType}
                    setChartType={setChartType}
                    timePeriod={timePeriod}
                    setTimePeriod={setTimePeriod}
                    operations={[]}
                    indicators={null}
                    tradeAnnotations={[]}
                />
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
                <RealDataAnalysis realData={chartData} />
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
