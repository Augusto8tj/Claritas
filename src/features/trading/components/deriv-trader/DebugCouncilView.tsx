// src/features/trading/components/deriv-trader/DebugCouncilView.tsx
'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { useRobotCouncilV2 } from '../../hooks/use-robot-council-v2';
import type { MarketRegime } from '@/lib/types';
import {
  BrainCircuit, Activity, Waves, CandlestickChart, Bot, LayoutGrid, BarChart,
  TrendingUp, Cloud, HelpCircle, CheckCircle, XCircle, Trophy, Database, Timer, HardDrive, Brain, Zap, Scale, ShieldAlert, ShieldCheck, ShieldX
} from 'lucide-react';

// ============================================================================
// TIPOS E ÍCONES
// ============================================================================

interface DebugCouncilViewProps {
  councilState: ReturnType<typeof useRobotCouncilV2>;
  isCouncilAutopilotOn: boolean;
}

const indicatorIcons: { [key: string]: React.ReactNode } = {
  RSI: <Trophy className="h-4 w-4 text-amber-500" />,
  STOCHASTIC: <Trophy className="h-4 w-4 text-slate-400" />,
  MACD_CROSS: <Activity className="h-4 w-4 text-blue-500" />,
  ADX_TREND: <TrendingUp className="h-4 w-4 text-purple-500" />,
  AWESOME_OSCILLATOR: <BarChart className="h-4 w-4 text-orange-500" />,
  TRIX: <Activity className="h-4 w-4 text-indigo-500" />,
  ROC: <Activity className="h-4 w-4 text-pink-500" />,
  BOLLINGER_BANDS: <Waves className="h-4 w-4 text-cyan-500" />,
  ICHIMOKU_CLOUD: <Cloud className="h-4 w-4 text-sky-500" />,
  PRICE_ACTION_PATTERN: <CandlestickChart className="h-4 w-4 text-emerald-500" />,
  DEFAULT: <Bot className="h-4 w-4 text-gray-500" />
};

const voteIcons: { [key: string]: React.ReactNode } = {
  RISE: <CheckCircle className="h-4 w-4 text-green-500" />,
  FALL: <XCircle className="h-4 w-4 text-red-500" />,
  HOLD: <HelpCircle className="h-4 w-4 text-yellow-500" />,
};

const regimeLabels: Record<MarketRegime, string> = {
  trending_bull: 'Tendência de Alta',
  trending_bear: 'Tendência de Baixa',
  ranging: 'Lateralizado (Ranging)',
  high_volatility: 'Alta Volatilidade',
  breakout: 'Rompimento (Breakout)'
};

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
};

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

export function DebugCouncilView({ councilState, isCouncilAutopilotOn }: DebugCouncilViewProps) {
  
  const { 
      bayesianVotes, 
      currentRegime, 
      systemMetrics, 
      robotPerformance, 
      consensusDecision,
      microstructure
  } = councilState;

  if (!isCouncilAutopilotOn || !currentRegime || !systemMetrics) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="font-headline flex items-center gap-2">
                    <BarChart className="h-5 w-5 text-primary" />
                    Diagnóstico Avançado da Mesa V2.5
                </CardTitle>
                 <CardDescription>
                    Aguardando ativação e o primeiro ciclo de análise...
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="text-center text-muted-foreground p-8 border-2 border-dashed rounded-lg">
                    <Bot className="h-10 w-10 mx-auto mb-2 opacity-50"/>
                    <p>Ative a Mesa Operacional para iniciar a depuração em tempo real.</p>
                </div>
            </CardContent>
        </Card>
    );
  }

  const sortedVotes = bayesianVotes ? Object.entries(bayesianVotes).sort(([, a], [, b]) => {
    const activeA = a.vote !== 'HOLD' ? 1 : 0;
    const activeB = b.vote !== 'HOLD' ? 1 : 0;
    if (activeA !== activeB) return activeB - activeA;
    return b.bayesianProbability - a.bayesianProbability;
  }) : [];

  const regimeProbabilities = Object.entries(currentRegime.probabilities)
    .map(([key, value]) => ({ regime: key as MarketRegime, probability: value }))
    .sort((a,b) => b.probability - a.probability);

  // --- LÓGICA DE DECISÃO FINAL (ESPELHO DO HOOK) ---
  const kellyStake = consensusDecision.stake;
  const microstructureVeto = microstructure?.pressure === 'sell' && consensusDecision.direction === 'RISE' ||
                             microstructure?.pressure === 'buy' && consensusDecision.direction === 'FALL';

  let finalDecisionStatus: 'EXECUTADO' | 'VETO' | 'HOLD' = 'HOLD';
  let finalDecisionReason = "Consenso insuficiente ou sem vantagem.";
  
  if (consensusDecision.direction !== 'HOLD' && kellyStake > 0) {
      if (microstructureVeto) {
          finalDecisionStatus = 'VETO';
          finalDecisionReason = `Veto da Microestrutura (Pressão Contrária de ${microstructure?.pressure === 'buy' ? 'Compra' : 'Venda'}).`;
      } else {
          finalDecisionStatus = 'EXECUTADO';
          finalDecisionReason = `Ordem ${consensusDecision.direction} enviada com stake de $${kellyStake.toFixed(2)}.`;
      }
  }


  return (
    <Card className="shadow-lg border-muted">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="font-headline flex items-center gap-2 text-xl">
                <BarChart className="h-6 w-6 text-primary" />
                Diagnóstico Avançado da Mesa V2.5
                </CardTitle>
                <CardDescription>
                Visão profunda do Cérebro Cognitivo, Microestrutura e Votação Bayesiana.
                </CardDescription>
            </div>
             <Badge variant={finalDecisionStatus === 'EXECUTADO' ? 'default' : finalDecisionStatus === 'VETO' ? 'destructive' : 'secondary'} className="text-sm px-3 py-1">
                DECISÃO: {consensusDecision.direction} ({(consensusDecision.probability * 100).toFixed(0)}%)
             </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">

        {/* 1. Métricas de Saúde do Sistema */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard 
                icon={<Timer className="h-4 w-4 text-blue-500" />}
                label="Tempo Sessão"
                value={formatDuration(systemMetrics.sessionDuration)}
            />
            <MetricCard 
                icon={<Database className="h-4 w-4 text-purple-500" />}
                label="Trades Virtuais"
                value={`${systemMetrics.activeVirtualTrades} / ${systemMetrics.totalVirtualTrades}`}
                subtext="Ativos / Total"
            />
             <MetricCard 
                icon={<Bot className="h-4 w-4 text-green-500" />}
                label="Robôs Ativos"
                value={`${systemMetrics.activeRobotsCount} / ${robotPerformance?.length || 22}`}
            />
             <MetricCard 
                icon={<HardDrive className="h-4 w-4 text-orange-500" />}
                label="Memória (MB)"
                value={systemMetrics.memoryUsageMB.toFixed(1)}
            />
             <MetricCard 
                icon={<Zap className="h-4 w-4 text-yellow-500" />}
                label="Status Ciclo"
                value={systemMetrics.isExecuting ? "Executando" : "Ocioso"}
                highlight={systemMetrics.isExecuting}
            />
        </div>

        <Separator />
        
        {/* NOVA SEÇÃO: DECISÃO FINAL */}
        <div>
            <h3 className="font-semibold mb-3 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-gray-500" />
                Status da Execução Final
            </h3>
             <div className={cn("p-4 rounded-lg border text-center", 
                finalDecisionStatus === 'EXECUTADO' && 'bg-green-500/10 border-green-500/30 text-green-700',
                finalDecisionStatus === 'VETO' && 'bg-red-500/10 border-red-500/30 text-red-700',
                finalDecisionStatus === 'HOLD' && 'bg-amber-500/10 border-amber-500/30 text-amber-700'
             )}>
                <div className="flex items-center justify-center gap-2 font-bold text-lg mb-1">
                    {finalDecisionStatus === 'EXECUTADO' && <ShieldCheck />}
                    {finalDecisionStatus === 'VETO' && <ShieldX />}
                    {finalDecisionStatus === 'HOLD' && <ShieldAlert />}
                    <span>{finalDecisionStatus}</span>
                </div>
                <p className="text-xs">{finalDecisionReason}</p>
            </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
            {/* 2. Análise de Regime de Mercado */}
            <div>
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Brain className="h-5 w-5 text-indigo-500" />
                    Regime de Mercado (HMM)
                </h3>
                <div className="space-y-3 bg-muted/30 p-4 rounded-lg">
                    {regimeProbabilities.map(({ regime, probability }) => (
                    <div key={regime}>
                        <div className="flex justify-between mb-1 text-sm">
                        <span>{regimeLabels[regime]}</span>
                        <span className={cn("font-medium", probability > 0.4 ? "text-primary" : "text-muted-foreground")}>
                            {(probability * 100).toFixed(1)}%
                        </span>
                        </div>
                        <Progress value={probability * 100} className={cn("h-2", probability > 0.4 ? "bg-primary/20" : "")} />
                    </div>
                    ))}
                </div>
            </div>

            {/* 3. Análise de Microestrutura (Order Flow) */}
            <div>
                 <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <Scale className="h-5 w-5 text-teal-500" />
                    Microestrutura & Fluxo
                </h3>
                <div className="grid grid-cols-2 gap-3 bg-muted/30 p-4 rounded-lg h-full">
                    <div className="flex flex-col justify-center items-center p-3 bg-background rounded border">
                        <span className="text-xs text-muted-foreground mb-1">Pressão Compradora</span>
                        <span className={cn("text-xl font-bold", (microstructure?.volumeImbalance || 0.5) > 0.5 ? "text-green-500" : "text-red-500")}>
                            {((microstructure?.volumeImbalance || 0.5) * 100).toFixed(0)}%
                        </span>
                        <Progress value={(microstructure?.volumeImbalance || 0.5) * 100} className="h-1.5 w-full mt-2" />
                    </div>
                     <div className="flex flex-col justify-center items-center p-3 bg-background rounded border">
                        <span className="text-xs text-muted-foreground mb-1">Velocidade (Ticks/s)</span>
                        <span className="text-xl font-bold text-primary">
                            {microstructure?.tickVelocity.toFixed(2) || "0.00"}
                        </span>
                        <span className="text-[10px] text-muted-foreground mt-1">
                            {microstructure?.tickVelocity && microstructure.tickVelocity > 1.5 ? "Alta Frequência" : "Normal"}
                        </span>
                    </div>
                     <div className="flex flex-col justify-center items-center p-3 bg-background rounded border col-span-2">
                         <div className="flex justify-between w-full text-xs mb-1">
                             <span className="text-muted-foreground">Volatilidade (Yang-Zhang)</span>
                             <span className="font-mono">{microstructure?.yangZhangVolatility.toFixed(5) || "0.00000"}</span>
                         </div>
                         <Progress value={(microstructure?.yangZhangVolatility || 0) * 1000} className="h-1.5 w-full" />
                    </div>
                </div>
            </div>
        </div>

        <Separator />

        {/* 4. Tabela de Votação Detalhada */}
        <div>
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-pink-500" />
            Conselho de Estratégias (Votação Bayesiana)
          </h3>
          <ScrollArea className="h-[350px] w-full rounded-md border">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0">
                <TableRow>
                  <TableHead className="w-[200px]">Estratégia</TableHead>
                  <TableHead className="text-center w-[100px]">Win Rate</TableHead>
                  <TableHead className="text-center w-[100px]">Voto</TableHead>
                  <TableHead className="text-center w-[120px]">Confiança</TableHead>
                  <TableHead className="text-right w-[100px]">Prob. Final</TableHead>
                  <TableHead className="text-right">Razão / Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVotes.length > 0 ? (
                  sortedVotes.map(([robotId, voteData], index) => {
                    const perf = robotPerformance?.find(p => p.id === robotId);
                    const totalTrades = (perf?.wins || 0) + (perf?.losses || 0);
                    const isHolding = voteData.vote === 'HOLD';

                    return (
                        <TableRow key={`${robotId}-${index}`} className={cn(isHolding ? "opacity-60 hover:opacity-100" : "bg-muted/10")}>
                        <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                                {indicatorIcons[voteData.strategy?.strategyType || 'DEFAULT'] || <Bot className="h-4 w-4" />}
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold">{voteData.strategy?.strategyType}</span>
                                    <span className="text-[10px] text-muted-foreground truncate w-24" title={robotId}>{robotId}</span>
                                </div>
                            </div>
                        </TableCell>
                        <TableCell className="text-center">
                             <div className="flex flex-col items-center">
                                 <span className={cn("text-xs font-bold", (perf?.winRate || 0) > 55 ? "text-green-600" : "text-foreground")}>
                                     {perf?.winRate ? perf.winRate.toFixed(0) : '0'}%
                                 </span>
                                 <span className="text-[10px] text-muted-foreground">{totalTrades} trades</span>
                             </div>
                        </TableCell>
                        <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1.5">
                                {voteIcons[voteData.vote]}
                                <span className={cn("text-xs font-bold", 
                                    voteData.vote === 'RISE' ? "text-green-600" : 
                                    voteData.vote === 'FALL' ? "text-red-600" : "text-yellow-600"
                                )}>
                                    {voteData.vote}
                                </span>
                            </div>
                        </TableCell>
                        <TableCell className="text-center">
                            <div className="w-full px-2">
                                <span className="text-xs">{voteData.rawConfidence.toFixed(0)}%</span>
                                <Progress value={voteData.rawConfidence} className="h-1 mt-1" />
                            </div>
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-primary">
                             {!isHolding ? (voteData.bayesianProbability * 100).toFixed(1) + '%' : '-'}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground max-w-[200px] truncate" title={voteData.reason}>
                            {voteData.reason || "Aguardando sinal..."}
                        </TableCell>
                        </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                          <LayoutGrid className="h-8 w-8 opacity-20" />
                          <p>Carregando dados dos analistas...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
};

// Componente Auxiliar para Cards de Métrica
function MetricCard({ icon, label, value, subtext, highlight = false }: { icon: React.ReactNode, label: string, value: string, subtext?: string, highlight?: boolean }) {
    return (
        <div className={cn("p-3 rounded-lg border bg-background flex flex-col items-center justify-center text-center transition-colors", highlight ? "border-primary/50 bg-primary/5" : "border-border")}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                {icon}
                <span>{label}</span>
            </div>
            <span className="text-lg font-bold tracking-tight">{value}</span>
            {subtext && <span className="text-[10px] text-muted-foreground">{subtext}</span>}
        </div>
    );
}
