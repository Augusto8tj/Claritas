// src/features/trading/components/master-autopilot/master-autopilot-interface.tsx
'use client';

import React, { useState } from 'react';
import { useMasterAutopilot } from '../../hooks/use-master-autopilot';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Crosshair, Target, Bot, Power, BarChart, TrendingUp, TrendingDown, ShieldQuestion, Brain, BarChart3, Scale, Zap, ChevronsUpDown, Send, Loader2, ShieldCheck, HelpCircle, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { MasterAutopilotState, RiskManagerStatus } from '../../hooks/use-master-autopilot';
import type { Indicators } from '@/services/indicator-service';
import type { MicrostructureFeatures, MarketRegime } from '@/lib/types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';


const getProgressColor = (percentage: number) => {
    if (percentage > 80) return 'bg-green-500';
    if (percentage > 60) return 'bg-blue-500';
    if (percentage < 40) return 'bg-red-500';
    return 'bg-gray-400';
};

const regimeLabels: Record<MarketRegime, string> = {
  trending_bull: 'Tendência de Alta',
  trending_bear: 'Tendência de Baixa',
  ranging: 'Lateralizado (Ranging)',
  high_volatility: 'Alta Volatilidade',
  breakout: 'Rompimento (Breakout)'
};


function TacticalAnalysisCard({ state, contractType }: { state: MasterAutopilotState, contractType: string }) {
    if (!state.isReady) return null;
    
    const { regime, confidence } = state.currentRegime;
    const isCompatible = isRegimeCompatible(contractType as any, regime);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-headline flex items-center gap-2">
                    <GitBranch className="h-5 w-5 text-primary" /> Análise Tática
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                 <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Regime de Mercado Atual:</span>
                    <Badge variant="outline" className="font-semibold text-base">{regimeLabels[regime] || 'Indefinido'}</Badge>
                </div>
                 <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Confiança no Regime:</span>
                    <span className="font-mono font-bold">{(confidence * 100).toFixed(1)}%</span>
                </div>
                <div className={cn(
                    "p-3 rounded-md text-center font-bold text-sm flex items-center justify-center gap-2",
                    isCompatible ? 'bg-green-500/10 text-green-700' : 'bg-destructive/10 text-destructive'
                )}>
                    {isCompatible ? <ShieldCheck className="h-4 w-4"/> : <ShieldCheck className="h-4 w-4"/>}
                    <span>Contrato de {contractType} {isCompatible ? 'é' : 'NÃO é'} compatível com o regime atual.</span>
                </div>
            </CardContent>
        </Card>
    )
}


function MasterAutopilotDashboard({ state, riskManager, macroTrend, contractType }: { state: MasterAutopilotState, riskManager: RiskManagerStatus, macroTrend: 'UP' | 'DOWN' | 'NONE', contractType: string }) {
    if (!state.isReady) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="font-headline">Painel Analítico Completo</CardTitle>
                </CardHeader>
                <CardContent className="text-center text-muted-foreground p-8">
                    Aguardando dados suficientes para a análise...
                </CardContent>
            </Card>
        );
    }
    
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Coluna 1: Assertividade */}
            <Card className="lg:col-span-1">
                <CardHeader>
                    <CardTitle className="text-lg font-headline flex items-center gap-2">
                        <Target className="h-5 w-5 text-primary" /> Assertividade Preditiva
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {Object.entries(state.assertiveness).map(([horizon, data]) => (
                        <div key={horizon}>
                            <div className="flex justify-between items-center text-xs text-muted-foreground mb-1">
                                <span className="font-semibold">{horizon}</span>
                                <div className={cn('font-bold flex items-center gap-1', data.vote === 'RISE' && 'text-green-600', data.vote === 'FALL' && 'text-red-600')}>
                                    {data.vote === 'RISE' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {data.vote}
                                </div>
                            </div>
                            <Progress value={data.accuracy} className="h-1.5" indicatorClassName={getProgressColor(data.accuracy)} />
                            <div className="text-right text-xs font-bold mt-1">{data.accuracy.toFixed(1)}%</div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Coluna 2: Análise e Risco */}
            <div className="lg:col-span-2 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <TacticalAnalysisCard state={state} contractType={contractType} />
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg font-headline flex items-center gap-2"><ShieldQuestion className="h-5 w-5" /> Risco Adaptativo</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground">Modo:</span><Badge variant={riskManager.mode === 'Cautious' ? 'destructive' : 'secondary'}>{riskManager.mode}</Badge></div>
                            <div className="flex justify-between items-center text-sm"><span className="text-muted-foreground">Limiar Atual:</span><span className="font-bold text-primary">{riskManager.assertivenessThreshold}%</span></div>
                        </CardContent>
                    </Card>
                </div>
                 <Alert className={cn("col-span-1 md:col-span-2", state.trigger.signal === 'HOLD' && 'bg-amber-500/10 border-amber-500/30 text-amber-800', state.trigger.signal !== 'HOLD' && 'bg-primary/10 border-primary/30 text-primary')}>
                    <Zap className="h-4 w-4" />
                    <AlertTitle className="font-bold">Status do Gatilho do Piloto</AlertTitle>
                    <AlertDescription className="text-xs">{state.trigger.reason}</AlertDescription>
                </Alert>
                <div className="grid grid-cols-2 gap-4">
                    {state.indicators && <IndicatorCard indicators={state.indicators} />}
                    {state.microstructure && <MicrostructureCard microstructure={state.microstructure} />}
                </div>
            </div>
        </div>
    );
}

const IndicatorCard = ({ indicators }: { indicators: Indicators }) => (
    <Card>
        <CardHeader><CardTitle className="text-base font-headline">Indicadores Chave</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs font-mono">
            <div className="flex justify-between"><span>RSI(14):</span><span className="font-bold">{indicators.rsi?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>ADX(14):</span><span className="font-bold">{indicators.adx?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>BBW(%):</span><span className="font-bold">{indicators.bbw?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span>ATR:</span><span className="font-bold">{indicators.atr?.toFixed(4)}</span></div>
        </CardContent>
    </Card>
);

const MicrostructureCard = ({ microstructure }: { microstructure: MicrostructureFeatures }) => (
    <Card>
        <CardHeader><CardTitle className="text-base font-headline">Microestrutura</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs font-mono">
            <div className="flex justify-between"><span>Pressão:</span><span className="font-bold">{microstructure.pressure}</span></div>
            <div className="flex justify-between"><span>Velocidade:</span><span className="font-bold">{microstructure.tickVelocity.toFixed(1)} t/s</span></div>
            <div className="flex justify-between"><span>Vol. YZ:</span><span className="font-bold">{(microstructure.yangZhangVolatility*1000).toFixed(2)}</span></div>
            <div className="flex justify-between"><span>Spike?:</span><span className="font-bold">{microstructure.isSpike ? 'SIM' : 'NÃO'}</span></div>
        </CardContent>
    </Card>
);

export function MasterAutopilotInterface() {
  const autopilot = useMasterAutopilot();
  const [isExecutingManual, setIsExecutingManual] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);

  const handleManualExecution = async () => {
      setIsExecutingManual(true);
      await autopilot.executeManualTrigger();
      setIsExecutingManual(false);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Controlo do Piloto Mestre
          </CardTitle>
          <CardDescription>
            Configure e ative o sistema de trading preditivo unificado.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="contract-type">Tipo de Contrato</Label>
              <Select value={autopilot.contractType} onValueChange={(value) => autopilot.setContractType(value as any)} disabled={autopilot.isAutopilotOn}>
                <SelectTrigger id="contract-type"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Rise/Fall">Rise/Fall (Direcional)</SelectItem>
                  <SelectItem value="Accumulators" disabled>Accumulators (Em Breve)</SelectItem>
                  <SelectItem value="Multipliers" disabled>Multipliers (Em Breve)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-2">
                <Label htmlFor="daily-balance">Banca do Dia (USD)</Label>
                <Input id="daily-balance" type="number" value={autopilot.dailyBalance} onChange={e => autopilot.setDailyBalance(Number(e.target.value))} disabled={autopilot.isAutopilotOn} />
            </div>
             <div className="flex-1 space-y-2">
                <Label htmlFor="daily-target">Alvo de Lucro (USD)</Label>
                <Input id="daily-target" type="number" value={autopilot.dailyTarget} onChange={e => autopilot.setDailyTarget(Number(e.target.value))} disabled={autopilot.isAutopilotOn} />
            </div>
          </div>
           <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <div className="flex items-center space-x-2 rounded-lg border p-4">
                <Label htmlFor="master-autopilot-switch" className="font-semibold text-base flex items-center gap-2">
                  <Power className={cn("h-5 w-5 transition-colors", autopilot.isAutopilotOn ? "text-green-500" : "text-muted-foreground")} />
                  Piloto Automático
                </Label>
                <Switch id="master-autopilot-switch" checked={autopilot.isAutopilotOn} onCheckedChange={autopilot.toggleAutopilot} />
              </div>
               <Button 
                variant="outline" 
                className="h-14 flex-1"
                onClick={handleManualExecution}
                disabled={autopilot.masterState.manualTrigger.signal === 'HOLD' || isExecutingManual || autopilot.isAutopilotOn}
               >
                   {isExecutingManual ? <Loader2 className="h-5 w-5 animate-spin"/> : <Send className="h-5 w-5"/>}
                   <div className="ml-2 text-left">
                       <p className="font-bold">Executar Sinal Manual</p>
                       <p className="text-xs text-muted-foreground">Sinal: {autopilot.masterState.manualTrigger.signal} ({autopilot.masterState.manualTrigger.reason})</p>
                   </div>
               </Button>
           </div>
        </CardContent>
      </Card>
      
      <Collapsible>
            <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full">
                    <ChevronsUpDown className="h-4 w-4 mr-2"/>
                    Configurações Avançadas do Piloto
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
               <Card>
                  <CardHeader>
                    <CardTitle className="text-base font-headline">Ajuste de Risco do Piloto Automático</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                        <Label htmlFor="assertiveness-threshold">Limiar de Assertividade (%)</Label>
                        <div className="flex items-center gap-4">
                            <Slider
                                id="assertiveness-threshold"
                                min={65}
                                max={95}
                                step={5}
                                value={[autopilot.riskManager.assertivenessThreshold]}
                                onValueChange={(value) => autopilot.setAssertivenessThreshold(value[0])}
                                disabled={autopilot.isAutopilotOn}
                            />
                            <span className="font-mono text-primary font-bold">{autopilot.riskManager.assertivenessThreshold}%</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Define o quão 'confiante' o piloto deve estar para executar uma ordem. Valores mais altos = menos trades, mas teoricamente mais seguros.</p>
                    </div>
                  </CardContent>
               </Card>
            </CollapsibleContent>
      </Collapsible>
      
      <Collapsible open={isDashboardOpen} onOpenChange={setIsDashboardOpen}>
          <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full">
                  <ChevronsUpDown className="h-4 w-4 mr-2"/>
                  {isDashboardOpen ? "Ocultar" : "Mostrar"} Painel Analítico Completo
              </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
              <MasterAutopilotDashboard state={autopilot.masterState} riskManager={autopilot.riskManager} macroTrend={autopilot.macroTrend} contractType={autopilot.contractType}/>
          </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function isRegimeCompatible(contractType: string, regime: MarketRegime): boolean {
    switch(contractType) {
        case 'Accumulators':
            return regime === 'ranging';
        case 'Multipliers':
            return regime === 'trending_bull' || regime === 'trending_bear';
        case 'Rise/Fall':
            return true;
        default:
            return false;
    }
}
