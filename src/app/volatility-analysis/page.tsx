'use client';

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';
import { Calculator, TrendingUp, Activity, BarChart3 } from 'lucide-react';

// Aproximação da função quantil normal inversa
const normalQuantile = (p: number) => {
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

export default function VolatilityAnalysisPage() {
  const [activeTab, setActiveTab] = useState('simulation');
  const [priceData, setPriceData] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [volatilityData, setVolatilityData] = useState<any[]>([]);
  const [qqData, setQQData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});

  // Função para gerar número aleatório normal (Box-Muller)
  const normalRandom = () => {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  // Simular preços usando Geometric Brownian Motion
  const simulatePrices = (n = 500) => {
    const S0 = 100;
    const sigma = 0.10;
    const dt = 1; // 1 segundo
    const mu = 0;
    
    const prices:any[] = [{ time: 0, price: S0, theoreticalPrice: S0 }];
    const logReturns: any[] = [];
    const volData: any[] = [];
    
    let S = S0;
    
    for (let i = 1; i < n; i++) {
      const Z = normalRandom();
      const drift = (mu - 0.5 * sigma * sigma) * dt;
      const diffusion = sigma * Math.sqrt(dt) * Z;
      
      S = S * Math.exp(drift + diffusion);
      
      const logReturn = Math.log(S / prices[i-1].price);
      logReturns.push(logReturn);
      
      prices.push({
        time: i,
        price: parseFloat(S.toFixed(4)),
        theoreticalPrice: S0
      });
      
      // Calcular volatilidade realizada em janela móvel de 50 períodos
      if (i >= 50) {
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
    }
    
    // Calcular estatísticas dos retornos
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (logReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    
    // Skewness
    const skewness = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 3), 0) / logReturns.length;
    
    // Kurtosis
    const kurtosis = logReturns.reduce((sum, r) => sum + Math.pow((r - mean) / stdDev, 4), 0) / logReturns.length - 3;
    
    // Preparar dados de retornos para histograma
    const returnHistogram = logReturns.map((r, i) => ({
      return: parseFloat((r * 100).toFixed(4)),
      index: i
    }));
    
    // Q-Q Plot data
    const sortedReturns = [...logReturns].sort((a, b) => a - b);
    const qqPlotData = sortedReturns.map((r, i) => {
      const p = (i + 0.5) / sortedReturns.length;
      const theoreticalQuantile = normalQuantile(p) * stdDev + mean;
      return {
        theoretical: parseFloat((theoreticalQuantile * 100).toFixed(4)),
        empirical: parseFloat((r * 100).toFixed(4))
      };
    });
    
    setPriceData(prices);
    setReturns(returnHistogram);
    setVolatilityData(volData);
    setQQData(qqPlotData);
    setStats({
      mean: (mean * 100).toFixed(6),
      stdDev: (stdDev * 100).toFixed(6),
      annualizedVol: (stdDev * Math.sqrt(31536000) * 100).toFixed(4),
      skewness: skewness.toFixed(4),
      kurtosis: kurtosis.toFixed(4),
      observations: logReturns.length
    });
  };

  useEffect(() => {
    simulatePrices();
  }, []);

  return (
    <div className="flex-1 space-y-4 p-4 sm:p-8 pt-6">
    <div className="w-full max-w-7xl mx-auto bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Análise Matemática Avançada - 1HZ10V</h1>
        <p className="text-slate-600 mb-4">Modelo Estocástico de Movimento Browniano Geométrico</p>
        
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-4">
          <h3 className="font-semibold text-blue-900 mb-2">Equação Diferencial Estocástica (SDE)</h3>
          <div className="font-mono text-sm bg-white p-3 rounded">
            dS(t) = μS(t)dt + σS(t)dW(t)
          </div>
          <p className="text-sm text-blue-800 mt-2">
            Onde: μ = drift (≈0), σ = 0.10 (volatilidade), W(t) = processo de Wiener
          </p>
        </div>

        <div className="bg-green-50 border-l-4 border-green-500 p-4 mb-6">
          <h3 className="font-semibold text-green-900 mb-2">Solução Analítica</h3>
          <div className="font-mono text-sm bg-white p-3 rounded">
            S(t) = S(0) × exp((μ - σ²/2)t + σW(t))
          </div>
          <p className="text-sm text-green-800 mt-2">
            Para Δt = 1s: S(t+1) = S(t) × exp(-0.005 + 0.10 × Z), onde Z ~ N(0,1)
          </p>
        </div>

        <button
          onClick={() => simulatePrices()}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors mb-6"
        >
          Gerar Nova Simulação
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            { id: 'simulation', icon: TrendingUp, label: 'Trajetória de Preços' },
            { id: 'returns', icon: Activity, label: 'Retornos Logarítmicos' },
            { id: 'volatility', icon: BarChart3, label: 'Volatilidade Realizada' },
            { id: 'qq', icon: Calculator, label: 'Q-Q Plot' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'simulation' && (
          <div>
            <h3 className="text-xl font-semibold mb-4 text-slate-800">Trajetória Simulada do Preço</h3>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={priceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" label={{ value: 'Tempo (segundos)', position: 'insideBottom', offset: -5 }} />
                <YAxis label={{ value: 'Preço', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="price" stroke="#2563eb" strokeWidth={2} dot={false} name="Preço Simulado" />
                <Line type="monotone" dataKey="theoreticalPrice" stroke="#dc2626" strokeWidth={1} strokeDasharray="5 5" dot={false} name="Preço Inicial (S₀)" />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-4 p-4 bg-slate-50 rounded">
              <p className="text-sm text-slate-700">
                <strong>Interpretação:</strong> O processo segue um caminho aleatório sem tendência (μ=0), 
                oscilando em torno do preço inicial com variações controladas pela volatilidade σ=10%.
              </p>
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
                <XAxis dataKey="theoretical" label={{ value: 'Quantis Teóricos N(0,σ²)', position: 'insideBottom', offset: -5 }} />
                <YAxis dataKey="empirical" label={{ value: 'Quantis Empíricos', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Scatter data={qqData} fill="#f59e0b" />
                <Line 
                  data={[
                    { theoretical: -0.5, empirical: -0.5 },
                    { theoretical: 0.5, empirical: 0.5 }
                  ]} 
                  dataKey="empirical"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-slate-800">Estatísticas dos Retornos</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded">
              <span className="text-slate-600">Média (μ̂):</span>
              <span className="font-mono font-semibold">{stats.mean}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded">
              <span className="text-slate-600">Desvio Padrão (σ̂):</span>
              <span className="font-mono font-semibold">{stats.stdDev}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-blue-50 rounded border-l-4 border-blue-500">
              <span className="text-blue-800 font-semibold">Vol. Anualizada:</span>
              <span className="font-mono font-semibold text-blue-900">{stats.annualizedVol}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded">
              <span className="text-slate-600">Assimetria (Skewness):</span>
              <span className="font-mono font-semibold">{stats.skewness}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded">
              <span className="text-slate-600">Curtose (Kurtosis):</span>
              <span className="font-mono font-semibold">{stats.kurtosis}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-slate-50 rounded">
              <span className="text-slate-600">Observações:</span>
              <span className="font-mono font-semibold">{stats.observations}</span>
            </div>
          </div>
          <div className="mt-4 p-3 bg-yellow-50 border-l-4 border-yellow-500">
            <p className="text-xs text-yellow-800">
              <strong>Nota:</strong> Skewness ≈ 0 e Kurtosis ≈ 0 indicam distribuição normal. 
              Desvios sugerem assimetria ou caudas pesadas.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold mb-4 text-slate-800">Propriedades Teóricas</h3>
          <div className="space-y-4 text-sm text-slate-700">
            <div className="p-3 bg-slate-50 rounded">
              <h4 className="font-semibold mb-2">Processo de Wiener</h4>
              <p>W(t) ~ N(0, t) com incrementos independentes</p>
              <p className="font-mono text-xs mt-1">dW(t) ~ N(0, dt)</p>
            </div>
            
            <div className="p-3 bg-slate-50 rounded">
              <h4 className="font-semibold mb-2">Lema de Itô</h4>
              <p className="font-mono text-xs">
                df(S,t) = (∂f/∂t + μS∂f/∂S + ½σ²S²∂²f/∂S²)dt + σS∂f/∂S dW
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded">
              <h4 className="font-semibold mb-2">Distribuição do Preço</h4>
              <p className="font-mono text-xs">
                ln(S(T)/S(0)) ~ N((μ - σ²/2)T, σ²T)
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded">
              <h4 className="font-semibold mb-2">Momentos</h4>
              <p className="font-mono text-xs">
                E[S(t)] = S(0)e^(μt)
              </p>
              <p className="font-mono text-xs">
                Var[S(t)] = S(0)²e^(2μt)(e^(σ²t) - 1)
              </p>
            </div>

            <div className="p-3 bg-green-50 rounded border-l-4 border-green-500">
              <h4 className="font-semibold mb-2 text-green-900">Para 1HZ10V</h4>
              <p className="text-green-800">μ = 0, σ = 0.10, Δt = 1s</p>
              <p className="font-mono text-xs text-green-800 mt-1">
                E[S(t)] = S(0) (martingale)
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
        <h3 className="text-xl font-semibold mb-4 text-slate-800">Fórmulas Essenciais</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-blue-50 rounded border-l-4 border-blue-500">
            <h4 className="font-semibold text-blue-900 mb-2">Volatilidade Histórica</h4>
            <p className="font-mono text-sm">σ̂ = √(1/n × Σ(r_i - r̄)²) × √(N)</p>
            <p className="text-xs text-blue-800 mt-2">N = número de períodos por ano (31.536.000 para 1s)</p>
          </div>

          <div className="p-4 bg-purple-50 rounded border-l-4 border-purple-500">
            <h4 className="font-semibold text-purple-900 mb-2">Intervalo de Confiança</h4>
            <p className="font-mono text-sm">IC₉₅% = S(t) × e^(±1.96σ√Δt)</p>
            <p className="text-xs text-purple-800 mt-2">Para Δt=1s: ±1.96×0.10×1 = ±0.196</p>
          </div>

          <div className="p-4 bg-orange-50 rounded border-l-4 border-orange-500">
            <h4 className="font-semibold text-orange-900 mb-2">Sharpe Ratio</h4>
            <p className="font-mono text-sm">SR = (μ - r_f) / σ</p>
            <p className="text-xs text-orange-800 mt-2">Para μ=0, SR=0 (sem excesso de retorno)</p>
          </div>

          <div className="p-4 bg-green-50 rounded border-l-4 border-green-500">
            <h4 className="font-semibold text-green-900 mb-2">Maximum Drawdown</h4>
            <p className="font-mono text-sm">MDD = max(0, max(S) - S(t)) / max(S)</p>
            <p className="text-xs text-green-800 mt-2">Perda máxima desde pico histórico</p>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};
