// src/features/trading/components/deriv-trader/SherlockAutopilot.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Detective, Loader2 } from 'lucide-react';
import { useSherlockHolmes, SherlockSignal, SherlockAnalysis } from '@/features/trading/hooks/use-sherlock-holmes';
import { useDerivApiDigits } from '@/features/trading/hooks/use-deriv-api-digits';
import { useFormContext } from 'react-hook-form';
import type { DigitFormValues } from './deriv-trader-interface-digits.types';
import type { OperationInitiator } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

interface SherlockAutopilotProps {
  sherlock: ReturnType<typeof useSherlockHolmes>;
}

export function SherlockAutopilot({ sherlock }: SherlockAutopilotProps) {
  const { analysis } = sherlock;
  const { executeTrade, isConnected } = useDerivApiDigits();
  const { getValues } = useFormContext<DigitFormValues>();
  const { toast } = useToast();

  const [isEnabled, setIsEnabled] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(60);
  const [isExecuting, setIsExecuting] = useState(false);
  
  const [currentSignal, setCurrentSignal] = useState<SherlockSignal | null>(null);

  useEffect(() => {
    if (!analysis) {
      setCurrentSignal(null);
      return;
    }

    const { recommendedBlock, blockProbability } = analysis;
    
    let contract: SherlockSignal['contract'] | null = null;
    let barrier: number | undefined = undefined;

    switch (recommendedBlock) {
        case 'EVEN': contract = 'DIGITEVEN'; break;
        case 'ODD': contract = 'DIGITODD'; break;
        case 'OVER': contract = 'DIGITOVER'; barrier = 4; break;
        case 'UNDER': contract = 'DIGITUNDER'; barrier = 5; break;
    }

    if (contract) {
        setCurrentSignal({
            contract,
            barrier,
            confidence: blockProbability,
            reason: `Prob. de Bloco '${recommendedBlock}' é ${(blockProbability*100).toFixed(1)}%`
        });
    } else {
        setCurrentSignal(null);
    }
  }, [analysis]);
  
  // Efeito para executar o trade
  useEffect(() => {
    if (!isEnabled || !currentSignal || isExecuting) return;
    if (currentSignal.confidence * 100 >= confidenceThreshold) {
      
      const handleExecution = async () => {
        setIsExecuting(true);
        const { stake, duration, duration_unit } = getValues();
        
        await executeTrade(
          currentSignal.contract,
          stake,
          '1HZ10V', // Hardcoded for now, should come from context
          duration,
          duration_unit,
          'Piloto',
          currentSignal.barrier,
          'Sherlock'
        );
        
        toast({
          title: `🕵️ Sherlock: Ordem Executada`,
          description: `${currentSignal.contract} com ${currentSignal.confidence.toFixed(1)}% de confiança.`,
        });

        // Cooldown
        setTimeout(() => setIsExecuting(false), 5000); 
      };

      handleExecution();
    }
  }, [isEnabled, currentSignal, confidenceThreshold, isExecuting, getValues, executeTrade, toast]);


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Detective className="h-5 w-5 text-primary" />
          Piloto Especialista (Sherlock Holmes)
        </CardTitle>
        <CardDescription>
          Ativa o bot que analisa a probabilidade condicional entre dígitos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
          <Label htmlFor="sherlock-enabled" className="font-semibold">Ativar Sherlock</Label>
          <Switch
            id="sherlock-enabled"
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
            disabled={isExecuting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sherlock-threshold">
            Limiar de Confiança ({confidenceThreshold}%)
          </Label>
          <Slider
            id="sherlock-threshold"
            min={51} max={80} step={1}
            value={[confidenceThreshold]}
            onValueChange={([val]) => setConfidenceThreshold(val)}
            disabled={isEnabled}
          />
          <p className="text-xs text-muted-foreground pt-1">
            Sherlock só irá operar se a probabilidade calculada for maior que este valor.
          </p>
        </div>
        
        <div className="p-4 bg-muted/50 rounded-lg text-center">
          <p className="text-xs font-semibold text-muted-foreground mb-1">SINAL ATUAL</p>
          {isExecuting ? (
            <div className="flex items-center justify-center gap-2 text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Executando...</span>
            </div>
          ) : currentSignal ? (
            <div>
              <p className="font-bold text-lg">{currentSignal.contract} {currentSignal.barrier !== undefined ? ` (b: ${currentSignal.barrier})` : ''}</p>
              <p className="text-sm">Confiança: <span className="font-bold">{(currentSignal.confidence * 100).toFixed(1)}%</span></p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aguardando sinal válido...</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}