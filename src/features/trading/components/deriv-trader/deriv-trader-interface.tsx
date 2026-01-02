// src/features/trading/components/deriv-trader/deriv-trader-interface.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { ArrowDown, ArrowUp, Info, Loader2, Minus, Plus, ChevronDown, Repeat } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type { DurationUnit, RiseFallFormValues } from "@/lib/types";
import { useDerivApi } from "@/features/trading/hooks/use-deriv-api";
import { Switch } from "@/components/ui/switch";

type TradeType = 'rise_fall' | 'higher_lower' | 'touch_no_touch';

interface DerivTraderInterfaceProps {
  symbol: string;
}

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

function DerivTraderInterface({ symbol }: DerivTraderInterfaceProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState<"rise" | "fall" | null>(null);
  const [tradeType, setTradeType] = useState<TradeType>('rise_fall');
  const [isInversionModeOn, setIsInversionModeOn] = useState(false); // NOVO ESTADO
  const { isConnected, executeTrade, durationLimits } = useDerivApi();

  const form = useFormContext<RiseFallFormValues>();
  const durationUnit = form.watch('duration_unit');

  // Ajustado para depender apenas da mudança da unidade de duração.
  useEffect(() => {
    if (!durationLimits || !durationLimits[durationUnit]) {
      return;
    }

    const currentDuration = form.getValues('duration');
    const { min, max } = durationLimits[durationUnit];

    let newDuration = currentDuration;
    if (newDuration < min) newDuration = min;
    if (newDuration > max) newDuration = max;

    if (newDuration !== currentDuration) {
      form.setValue('duration', newDuration);
    }
  }, [durationUnit, durationLimits, form]);


  const handleDurationChange = (amount: number) => {
    if (!durationLimits) return;
    const currentDuration = form.getValues('duration');
    const { min, max } = durationLimits[durationUnit];
    let newDuration = currentDuration + amount;
    if (newDuration < min) newDuration = min;
    if (newDuration > max) newDuration = max;
    form.setValue('duration', newDuration);
    form.trigger('duration');
  };

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

    // LÓGICA DE INVERSÃO
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

  const payout = (form.watch('stake') * 1.942).toFixed(2);
  const payoutPercentage = "94.20%";
  const isButtonDisabled = !!loading || !isConnected;

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

            <Form {...form}>
                <form className="space-y-4">
                    <Tabs defaultValue="duration" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="duration">Duração</TabsTrigger>
                            <TabsTrigger value="endtime" disabled>Hora de término</TabsTrigger>
                        </TabsList>
                        <TabsContent value="duration" className="pt-2">
                            <div className="flex gap-2">
                                <FormField
                                    control={form.control}
                                    name="duration_unit"
                                    render={({ field }) => (
                                        <FormItem className="w-2/5">
                                            <Select
                                              onValueChange={(value) => {
                                                const newUnit = value as DurationUnit;
                                                field.onChange(newUnit);
                                              }}
                                              value={field.value}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Unidade" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {Object.entries(durationUnitLabels).map(([value, label]) => (
                                                        <SelectItem key={value} value={value} disabled={durationLimits ? durationLimits[value as DurationUnit].min === 0 : false}>
                                                            {label}
                                                        </SelectItem>
                                                    ))}
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
                                                        onChange={e => field.onChange(parseInt(e.target.value))}
                                                        className="font-semibold text-lg text-center border-y border-x-0 rounded-none focus-visible:ring-0 h-10"
                                                    />
                                                </FormControl>
                                            </div>
                                            <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => handleDurationChange(1)}><Plus className="h-4 w-4"/></Button>
                                        </div>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                            </div>
                        </TabsContent>
                    </Tabs>
                    
                    <Separator />
                    
                    <Tabs defaultValue="stake" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="stake">Entrada</TabsTrigger>
                            <TabsTrigger value="payout" disabled>Pagamento</TabsTrigger>
                        </TabsList>
                        <TabsContent value="stake" className="pt-2">
                            <FormField
                                control={form.control}
                                name="stake"
                                render={({ field }) => (
                                <FormItem>
                                    <div className="flex items-center justify-center gap-2">
                                        <Button type="button" variant="outline" size="icon" onClick={() => form.setValue('stake', Math.max(0.35, field.value - 1))}><Minus className="h-4 w-4"/></Button>
                                        <div className="relative flex-1">
                                            <FormControl>
                                                <Input type="number" {...field} className="text-center font-bold text-lg pr-12"/>
                                            </FormControl>
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">USD</span>
                                        </div>
                                        <Button type="button" variant="outline" size="icon" onClick={() => form.setValue('stake', field.value + 1)}><Plus className="h-4 w-4"/></Button>
                                    </div>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                        </TabsContent>
                    </Tabs>

                    <div className="flex items-center justify-between pt-2">
                        <div className="flex flex-row items-center space-x-2 space-y-0">
                            <Checkbox
                                checked={form.getValues('allowEquals')}
                                onCheckedChange={(checked) => form.setValue('allowEquals', !!checked)}
                                disabled={isButtonDisabled}
                                id="allowEquals"
                            />
                            <Label htmlFor="allowEquals" className="text-sm font-normal text-muted-foreground cursor-pointer">
                                Permitir "Equals"
                            </Label>
                            <Info className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <div className="flex items-center space-x-2">
                            <Label htmlFor="inversion-mode" className="text-sm font-normal text-muted-foreground cursor-pointer">
                                Inverter Direção
                            </Label>
                            <Switch id="inversion-mode" checked={isInversionModeOn} onCheckedChange={setIsInversionModeOn} />
                        </div>
                    </div>
                </form>
            </Form>
            
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

export default DerivTraderInterface;
