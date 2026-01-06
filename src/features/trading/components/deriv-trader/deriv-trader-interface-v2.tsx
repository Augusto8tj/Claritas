// src/features/trading/components/deriv-trader/deriv-trader-interface-v2.tsx
'use client';

import * as React from 'react';
import { useMemo, useEffect, useRef } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { ArrowDown, ArrowUp, Info, Loader2, Minus, Plus, ChevronDown } from "lucide-react";

import {
  FormField,
  FormItem,
  FormControl,
  FormLabel,
} from '@/components/ui/form';

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useDerivApiV2 as useDerivApi } from "@/features/trading/hooks/use-deriv-api-v2";
import type { DurationUnit, RiseFallFormValues, OperationInitiator } from '@/lib/types';


type TradeType = 'rise_fall' | 'higher_lower' | 'touch_no_touch';

const durationUnitLabels: Record<DurationUnit, string> = {
  t: "Ticks",
  s: "Segundos",
  m: "Minutos",
  h: "Horas",
  d: "Dias",
};

const tradeTypeLabels: Record<TradeType, string> = {
  rise_fall: "Rise/Fall",
  higher_lower: "Higher/Lower",
  touch_no_touch: "Touch/No Touch",
};

interface DerivTraderInterfaceV2Props {
  symbol: string;
}


export default function DerivTraderInterfaceV2({ symbol }: DerivTraderInterfaceV2Props) {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState<"rise" | "fall" | null>(null);
  const [tradeType, setTradeType] = React.useState<TradeType>('rise_fall');
  const [isInversionModeOn, setIsInversionModeOn] = React.useState(false);
  const { isConnected, executeTrade, durationLimits } = useDerivApi();

  const form = useFormContext<RiseFallFormValues>();
  const lastUnitRef = React.useRef<DurationUnit | null>(null);
  
  // ✅ GATILHO REATIVADO: Esta linha é crucial para garantir que o componente
  // re-renderize quando a unidade de duração muda, forçando a lógica de
  // atualização de limites a ser re-avaliada.
  const durationUnit = useWatch({
    control: form.control,
    name: 'duration_unit',
  });
  
  const allowEquals = useWatch({
    control: form.control,
    name: 'allowEquals',
  });

  const stake = useWatch({
    control: form.control,
    name: 'stake',
  });

  const payout = useMemo(() => {
    if (!stake) return "0.00";
    return (stake * 1.942).toFixed(2);
  }, [stake]);

  // Efeito para garantir que o `value` do Select é sempre válido
  React.useEffect(() => {
    if (!durationLimits || !durationUnit) return;
    
    const isUnitDisabled = durationLimits[durationUnit]?.min === 0;

    if (isUnitDisabled) {
        const firstValid = (Object.keys(durationLimits) as DurationUnit[]).find(
            (unit) => durationLimits[unit]?.min > 0
        );
        
        if (firstValid) {
            form.setValue('duration_unit', firstValid, {
                shouldDirty: false,
                shouldValidate: false,
            });
        }
    }
  }, [durationLimits, durationUnit, form]);


  // Efeito para ajustar a DURAÇÃO quando a UNIDADE muda
  React.useEffect(() => {
    if (!durationLimits || !durationUnit) return;
    
    // Proteção para não re-executar com o mesmo valor
    if (lastUnitRef.current === durationUnit) return;
    lastUnitRef.current = durationUnit;
  
    const currentDuration = form.getValues('duration');
    const limits = durationLimits[durationUnit];
    
    if (!limits) return;

    let newDuration = currentDuration;
    if (newDuration < limits.min) newDuration = limits.min;
    if (newDuration > limits.max) newDuration = limits.max;
  
    if (newDuration !== currentDuration) {
      form.setValue('duration', newDuration, {
        shouldDirty: true,
        shouldTouch: false,
        shouldValidate: false,
      });
    }
  }, [durationUnit, durationLimits, form]);


  const handleDurationChange = (amount: number) => {
    if (!durationLimits || !durationLimits[durationUnit]) return;
    const currentDuration = form.getValues('duration');
    const { min, max } = durationLimits[durationUnit];
    let newDuration = currentDuration + amount;
    if (newDuration < min) newDuration = min;
    if (newDuration > max) newDuration = max;
    form.setValue('duration', newDuration, {
      shouldDirty: true,
      shouldTouch: false,
      shouldValidate: true,
    });
  };

  const handleStakeChange = (amount: number) => {
    const currentStake = form.getValues('stake');
    form.setValue('stake', Math.max(0.35, currentStake + amount), {
        shouldDirty: true,
        shouldTouch: false,
        shouldValidate: false,
    });
  }

  const handleTrade = async (tradeDirection: "rise" | "fall") => {
    const isValid = await form.trigger();
    if (!isValid) {
        toast({
            variant: "destructive",
            title: "Entrada Inválida",
            description: "Por favor, corrija os erros no formulário antes de negociar.",
        });
        return;
    }
     if (!isConnected) {
      toast({
        variant: "destructive",
        title: "Não Conectado",
        description: "Não é possível negociar. Verifique sua conexão e token de API.",
      });
      return;
    }

    const data = form.getValues();
    setLoading(tradeDirection);

    let finalTradeDirection = tradeDirection;
    if (isInversionModeOn) {
        finalTradeDirection = tradeDirection === 'rise' ? 'fall' : 'rise';
    }

    let contractType: string;
    if (tradeType === 'rise_fall') {
      if (finalTradeDirection === 'rise') {
        contractType = data.allowEquals ? 'CALLE' : 'CALL';
      } else { // 'fall'
        contractType = data.allowEquals ? 'PUTE' : 'PUT';
      }
    } else {
        toast({ variant: "destructive", title: "Em breve", description: "Este tipo de negociação ainda não está implementado." });
        setLoading(null);
        return;
    }

    const result = await executeTrade(contractType, data.stake, symbol, finalTradeDirection, data.duration, data.duration_unit, 'Manual');
    setLoading(null);

    if (result.success && result.contractId) {
      toast({
        title: "Ordem Executada!",
        description: `Sua negociação para ${symbol} foi aberta. ${isInversionModeOn ? '(Direção Invertida)' : ''}`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "Falha na Negociação",
        description: result.message || "Não foi possível executar a ordem. Tente novamente.",
      });
    }
  };
  
  const payoutPercentage = "94.20%";
  const isButtonDisabled = !!loading || !isConnected;

  // --- STATE LOCAL HF-SAFE ---
  const [localDurationUnit, setLocalDurationUnit] = React.useState<DurationUnit | undefined>(
    form.getValues("duration_unit")
  );

  // sincroniza RHF → UI (apenas quando realmente muda)
  React.useEffect(() => {
    const subscription = form.watch((values, { name }) => {
      if (name === "duration_unit" && values.duration_unit !== localDurationUnit) {
        setLocalDurationUnit(values.duration_unit);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, localDurationUnit]);


  return (
    <div className="space-y-6">
      <Card className="bg-card/50">
        <CardContent className="p-4 space-y-4">
            
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                        <span>{tradeTypeLabels[tradeType]}</span>
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                    <RadioGroup value={tradeType} onValueChange={(val) => setTradeType(val as TradeType)}>
                        <div className="space-y-1 p-2">
                            <Label className="px-2 text-xs text-muted-foreground">Tipos de Negociação</Label>
                            <RadioGroupItem value="rise_fall" className="w-full">
                                <Label className="flex items-center justify-between w-full cursor-pointer p-2 hover:bg-accent rounded-md">
                                    <span>Rise/Fall</span>
                                </Label>
                            </RadioGroupItem>
                            <RadioGroupItem value="higher_lower" disabled className="w-full">
                                <Label className="flex items-center justify-between w-full cursor-not-allowed p-2 text-muted-foreground">
                                    <span>Higher/Lower</span>
                                    <span className="text-xs font-bold">EM BREVE</span>
                                </Label>
                            </RadioGroupItem>
                            <RadioGroupItem value="touch_no_touch" disabled className="w-full">
                                <Label className="flex items-center justify-between w-full cursor-not-allowed p-2 text-muted-foreground">
                                    <span>Touch/No Touch</span>
                                    <span className="text-xs font-bold">EM BREVE</span>
                                </Label>
                            </RadioGroupItem>
                        </div>
                    </RadioGroup>
                </PopoverContent>
            </Popover>

                <form className="space-y-4">
                    <div className="w-full">
                        
                            <div className="flex gap-2">
                                <FormField
                                  control={form.control}
                                  name="duration_unit"
                                  render={() => (
                                    <FormItem className="w-2/5">
                                      <Select
                                        value={localDurationUnit}
                                        onValueChange={(val) => {
                                          const next = val as DurationUnit;

                                          // atualiza UI primeiro
                                          setLocalDurationUnit(next);

                                          // atualiza RHF fora do ciclo de render do Select
                                          queueMicrotask(() => {
                                            form.setValue("duration_unit", next, {
                                              shouldDirty: true,
                                              shouldTouch: false,
                                              shouldValidate: false,
                                            });
                                          });
                                        }}
                                      >
                                        <FormControl>
                                          <SelectTrigger>
                                            <SelectValue placeholder="Unidade" />
                                          </SelectTrigger>
                                        </FormControl>

                                        <SelectContent>
                                          {Object.entries(durationUnitLabels).map(([value, label]) => {
                                            const disabled =
                                              durationLimits?.[value as DurationUnit]?.min === 0;

                                            return (
                                              <SelectItem
                                                key={value}
                                                value={value}
                                                disabled={disabled}
                                              >
                                                {label}
                                              </SelectItem>
                                            );
                                          })}
                                        </SelectContent>
                                      </Select>
                                    </FormItem>
                                  )}
                                />
                                <FormField
                                    control={form.control}
                                    name="duration"
                                    render={({ field }) => (
                                    <FormItem className="w-3/5">
                                        <div className="flex items-center justify-center gap-0.5">
                                            <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => handleDurationChange(-1)}><Minus className="h-4 w-4"/></Button>
                                            <div className="relative flex-1">
                                                <FormControl>
                                                    <Input 
                                                        type="number"
                                                        {...field}
                                                        onChange={e => {
                                                          const value = Number(e.target.value);
                                                          field.onChange(isNaN(value) ? 0 : value);
                                                        }}
                                                        className="font-semibold text-lg text-center border-y border-x-0 rounded-none focus-visible:ring-0 h-10"
                                                    />
                                                </FormControl>
                                            </div>
                                            <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => handleDurationChange(1)}><Plus className="h-4 w-4"/></Button>
                                        </div>
                                    </FormItem>
                                    )}
                                />
                            </div>
                        
                    </div>
                    
                    <Separator />
                    
                    <div className="w-full">
                       
                            <FormField
                                control={form.control}
                                name="stake"
                                render={({ field }) => (
                                <FormItem>
                                    <div className="flex items-center justify-center gap-2">
                                        <Button type="button" variant="outline" size="icon" onClick={() => handleStakeChange(-1)}><Minus className="h-4 w-4"/></Button>
                                        <div className="relative flex-1">
                                            <FormControl>
                                                <Input type="number" {...field} onChange={e => {
                                                  const value = Number(e.target.value);
                                                  field.onChange(isNaN(value) ? 0 : value);
                                                }} className="text-center font-bold text-lg pr-12"/>
                                            </FormControl>
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">USD</span>
                                        </div>
                                        <Button type="button" variant="outline" size="icon" onClick={() => handleStakeChange(1)}><Plus className="h-4 w-4"/></Button>
                                    </div>
                                </FormItem>
                                )}
                            />
                        
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex flex-row items-center space-x-2 space-y-0">
                            <FormField
                                control={form.control}
                                name="allowEquals"
                                render={({ field }) => (
                                    <FormItem className="flex items-center gap-2">
                                        <FormControl>
                                            <Checkbox
                                                checked={!!allowEquals}
                                                onCheckedChange={(checked) =>
                                                  form.setValue('allowEquals', !!checked, {
                                                    shouldDirty: true,
                                                    shouldValidate: false,
                                                  })
                                                }
                                                disabled={isButtonDisabled}
                                                id="allowEquals"
                                            />
                                        </FormControl>
                                        <Label htmlFor="allowEquals" className="text-sm font-normal text-muted-foreground cursor-pointer">
                                            Permitir "Equals"
                                        </Label>
                                    </FormItem>
                                )}
                            />
                            <Info className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div className="flex items-center space-x-2">
                            <Label htmlFor="inversion-modeV2" className="text-sm font-normal text-muted-foreground cursor-pointer">
                                Inverter Direção
                            </Label>
                            <Switch id="inversion-modeV2" checked={isInversionModeOn} onCheckedChange={setIsInversionModeOn} />
                        </div>
                    </div>
                </form>
            
            <div className="space-y-2 pt-2">
                <div className="text-xs text-muted-foreground flex items-center justify-between">
                    <span>Pagamento Potencial</span>
                    <span className="font-semibold text-foreground">{payout} USD</span>
                </div>
                <Button
                    variant="outline"
                    className="w-full h-14 bg-green-500/10 text-green-600 border-green-500/30 hover:bg-green-500/20 hover:text-green-700 flex justify-between items-center"
                    onClick={() => handleTrade("rise")}
                    disabled={isButtonDisabled}
                >
                    {loading === "rise" ? ( <Loader2 className="h-5 w-5 animate-spin" /> ) : (
                        <>
                            <div className="flex items-center gap-2">
                                <ArrowUp className="h-5 w-5" />
                                <span className="font-semibold">Rise</span>
                            </div>
                            <span className="text-lg font-bold">{payoutPercentage}</span>
                        </>
                    )}
                </Button>
                
                <div className="text-xs text-muted-foreground flex items-center justify-between pt-2">
                    <span>Pagamento Potencial</span>
                    <span className="font-semibold text-foreground">{payout} USD</span>
                </div>
                <Button
                    variant="outline"
                    className="w-full h-14 bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/20 hover:text-red-700 flex justify-between items-center"
                    onClick={() => handleTrade("fall")}
                    disabled={isButtonDisabled}
                >
                    {loading === "fall" ? ( <Loader2 className="h-5 w-5 animate-spin" /> ) : (
                        <>
                            <div className="flex items-center gap-2">
                                <ArrowDown className="h-5 w-5" />
                                <span className="font-semibold">Fall</span>
                            </div>
                            <span className="text-lg font-bold">{payoutPercentage}</span>
                        </>
                    )}
                </Button>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
